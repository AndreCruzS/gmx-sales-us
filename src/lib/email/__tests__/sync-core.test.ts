// The privacy rules of §5a, proven with fixtures before any credential exists.

import { beforeEach, describe, expect, it } from "vitest";
import type {
  AttachmentInsert,
  EmailStore,
  GmailMessage,
  GmailPort,
  MatchedContact,
  MessageInsert,
  ThreadUpsert,
} from "../port";
import {
  MIN_ATTACHMENT_BYTES,
  classifyAttachment,
  parseAddr,
  syncMailbox,
} from "../sync-core";

const MAILBOX = "deon@gmxgroup.com";
const CTX = { mailbox: MAILBOX, workspaceDomain: "gmxgroup.com" };

function msg(over: Partial<GmailMessage>): GmailMessage {
  return {
    id: over.id ?? crypto.randomUUID(),
    threadId: over.threadId ?? "t-1",
    subject: "Thermo-Ayous pricing",
    from: "Mike Torres <mike@ganahl.com>",
    to: [MAILBOX],
    cc: [],
    sentAt: "2026-07-27T10:00:00Z",
    snippet: "Can you send the updated quote?",
    bodyText: "Can you send the updated quote for the Anaheim job?",
    attachments: [],
    ...over,
  };
}

class FakeGmail implements GmailPort {
  messages: GmailMessage[] = [];
  historyTooOld = false;
  attachmentData = new Map<string, Uint8Array>();
  historyCalls = 0;
  recentCalls = 0;

  async listHistory() {
    this.historyCalls += 1;
    if (this.historyTooOld) return { kind: "history_too_old" as const };
    return {
      kind: "ok" as const,
      messageIds: this.messages.map((m) => m.id),
      historyId: "h-next",
    };
  }
  async listRecentMessageIds(mailbox: string, max: number) {
    void mailbox;
    this.recentCalls += 1;
    return {
      messageIds: this.messages.slice(0, max).map((m) => m.id),
      historyId: "h-resync",
    };
  }
  async getMessage(mailbox: string, id: string) {
    void mailbox;
    return this.messages.find((x) => x.id === id) ?? null;
  }
  async getAttachment(mailbox: string, messageId: string, attachmentId: string) {
    void mailbox;
    void messageId;
    return this.attachmentData.get(attachmentId) ?? null;
  }
}

class MemoryStore implements EmailStore {
  contacts: MatchedContact[] = [
    { id: "c-1", account_id: "a-1", email: "mike@ganahl.com" },
  ];
  exclusions: string[] = [];
  threads: ThreadUpsert[] = [];
  messages: MessageInsert[] = [];
  attachments: AttachmentInsert[] = [];
  blobs = new Set<string>();
  bodies: string[] = [];
  candidates: { email: string; subject: string | null }[] = [];
  historyId: string | null = "h-0";
  savedState: { historyId: string; status: string } | null = null;

  async findContactsByEmails(emails: string[]) {
    return this.contacts.filter((c) => emails.includes(c.email));
  }
  async listExclusionPatterns() {
    return this.exclusions;
  }
  async upsertThread(t: ThreadUpsert) {
    this.threads.push(t);
    return `row-${t.gmailThreadId}`;
  }
  async insertMessage(m: MessageInsert) {
    if (this.messages.some((x) => x.gmailMessageId === m.gmailMessageId)) {
      return null;
    }
    this.messages.push(m);
    return `mrow-${m.gmailMessageId}`;
  }
  async insertAttachment(a: AttachmentInsert) {
    this.attachments.push(a);
  }
  async attachmentBlobExists(sha: string) {
    return this.blobs.has(sha);
  }
  async putAttachmentBlob(sha: string) {
    this.blobs.add(sha);
  }
  async putBodyBlob(id: string) {
    this.bodies.push(id);
    return `email/bodies/${id}`;
  }
  async hasCandidateForSender(email: string) {
    return this.candidates.some((c) => c.email === email);
  }
  async createMetadataCandidate(c: { email: string; subject: string | null }) {
    this.candidates.push({ email: c.email, subject: c.subject });
  }
  async getSyncState() {
    return { historyId: this.historyId };
  }
  async setSyncState(s: { historyId: string; status: string }) {
    this.savedState = s;
  }
}

let gmail: FakeGmail;
let store: MemoryStore;

beforeEach(() => {
  gmail = new FakeGmail();
  store = new MemoryStore();
});

describe("the privacy boundary (D35)", () => {
  it("stores a thread only when a participant matches a CRM contact", async () => {
    gmail.messages = [msg({})];
    const report = await syncMailbox(gmail, store, CTX);
    expect(report.stored).toBe(1);
    expect(store.threads[0].matchedContactId).toBe("c-1");
    expect(store.threads[0].matchedAccountId).toBe("a-1");
    expect(store.bodies).toHaveLength(1);
  });

  it("never stores a body for an unmatched sender — metadata candidate only (D36)", async () => {
    gmail.messages = [
      msg({ from: "Paula New <paula@newbuilder.com>", threadId: "t-9" }),
    ];
    const report = await syncMailbox(gmail, store, CTX);
    expect(report.stored).toBe(0);
    expect(store.threads).toHaveLength(0);
    expect(store.bodies).toHaveLength(0); // no body, ever
    expect(store.candidates).toEqual([
      { email: "paula@newbuilder.com", subject: "Thermo-Ayous pricing" },
    ]);
  });

  it("does not turn colleagues or outbound cold emails into lead candidates", async () => {
    gmail.messages = [
      // colleague writes in — own workspace domain
      msg({ from: `TJ <tj@gmxgroup.com>`, id: "m-1" }),
      // rep writes OUT to an unknown address
      msg({
        id: "m-2",
        from: `Deon <${MAILBOX}>`,
        to: ["stranger@coldlist.com"],
      }),
    ];
    store.contacts = []; // nothing matches
    const report = await syncMailbox(gmail, store, CTX);
    expect(report.metadataCandidates).toBe(0);
    expect(store.candidates).toHaveLength(0);
    expect(report.stored).toBe(0);
  });

  it("dedupes metadata candidates by sender address", async () => {
    gmail.messages = [
      msg({ id: "m-1", from: "paula@newbuilder.com", threadId: "t-1" }),
      msg({ id: "m-2", from: "paula@newbuilder.com", threadId: "t-2" }),
    ];
    store.contacts = [];
    await syncMailbox(gmail, store, CTX);
    expect(store.candidates).toHaveLength(1);
  });
});

describe("the exclusion safety net (D27)", () => {
  it("skips the whole message when any participant matches a pattern — even a contact match", async () => {
    store.exclusions = ["ganahl.com"];
    gmail.messages = [msg({})];
    const report = await syncMailbox(gmail, store, CTX);
    expect(report.excluded).toBe(1);
    expect(report.stored).toBe(0);
    expect(store.threads).toHaveLength(0);
    expect(store.candidates).toHaveLength(0);
  });

  it("matches exact addresses as well as domains", async () => {
    store.exclusions = ["mike@ganahl.com"];
    gmail.messages = [msg({})];
    const report = await syncMailbox(gmail, store, CTX);
    expect(report.excluded).toBe(1);
  });
});

describe("attachments (D30)", () => {
  const big = new Uint8Array(MIN_ATTACHMENT_BYTES + 1).fill(7);

  it("skips inline and sub-20KB files; stores real ones with sha dedupe", async () => {
    gmail.attachmentData.set("att-quote", big);
    gmail.attachmentData.set("att-quote-2", big); // identical bytes
    gmail.messages = [
      msg({
        id: "m-1",
        attachments: [
          {
            attachmentId: "att-logo",
            filename: "logo.png",
            mimeType: "image/png",
            sizeBytes: 4096,
            inline: true,
          },
          {
            attachmentId: "att-quote",
            filename: "Quote_1042.pdf",
            mimeType: "application/pdf",
            sizeBytes: big.length,
            inline: false,
          },
        ],
      }),
      msg({
        id: "m-2",
        threadId: "t-2",
        attachments: [
          {
            attachmentId: "att-quote-2",
            filename: "Quote_1042.pdf",
            mimeType: "application/pdf",
            sizeBytes: big.length,
            inline: false,
          },
        ],
      }),
    ];
    const report = await syncMailbox(gmail, store, CTX);
    // both messages reference the attachment…
    expect(report.attachmentsStored).toBe(2);
    expect(store.attachments).toHaveLength(2);
    // …but the bytes are stored once (sha dedupe), and the logo never at all
    expect(store.blobs.size).toBe(1);
    expect(store.attachments[0].classification).toBe("QUOTE");
  });
});

describe("the cursor (D33)", () => {
  it("resumes from historyId when the server still has it", async () => {
    gmail.messages = [msg({})];
    await syncMailbox(gmail, store, CTX);
    expect(gmail.historyCalls).toBe(1);
    expect(gmail.recentCalls).toBe(0);
    expect(store.savedState?.historyId).toBe("h-next");
  });

  it("falls back to a bounded resync when history is too old", async () => {
    gmail.historyTooOld = true;
    gmail.messages = [msg({})];
    await syncMailbox(gmail, store, CTX);
    expect(gmail.recentCalls).toBe(1);
    expect(store.savedState?.historyId).toBe("h-resync");
  });

  it("does a bounded initial sync when no cursor exists yet", async () => {
    store.historyId = null;
    gmail.messages = [msg({})];
    await syncMailbox(gmail, store, CTX);
    expect(gmail.historyCalls).toBe(0);
    expect(gmail.recentCalls).toBe(1);
  });

  it("replaying the same messages inserts nothing twice (idempotent)", async () => {
    gmail.messages = [msg({ id: "m-same" })];
    await syncMailbox(gmail, store, CTX);
    const report2 = await syncMailbox(gmail, store, CTX);
    expect(report2.stored).toBe(0);
    expect(store.messages).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("parses display-name addresses and lowercases", () => {
    expect(parseAddr("Mike Torres <Mike@Ganahl.com>")).toBe("mike@ganahl.com");
    expect(parseAddr("plain@x.com")).toBe("plain@x.com");
    expect(parseAddr("not an address")).toBeNull();
  });

  it("classifies by filename and mime", () => {
    expect(classifyAttachment("Quote_1042.pdf", "application/pdf")).toBe("QUOTE");
    expect(classifyAttachment("TDS-ayous.pdf", "application/pdf")).toBe("SPEC_SHEET");
    expect(classifyAttachment("site.jpg", "image/jpeg")).toBe("PHOTO");
    expect(classifyAttachment("misc.bin", "application/octet-stream")).toBe("OTHER");
  });

  it("marks direction OUTBOUND when the mailbox is the sender", async () => {
    gmail.messages = [
      msg({ from: `Deon <${MAILBOX}>`, to: ["mike@ganahl.com"] }),
    ];
    await syncMailbox(gmail, store, CTX);
    expect(store.messages[0].direction).toBe("OUTBOUND");
    expect(store.threads[0].direction).toBe("OUTBOUND");
  });
});
