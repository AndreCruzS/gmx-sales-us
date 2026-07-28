// The Gmail sync pass (spec §5a). Pure orchestration over the two ports —
// no Google SDK, no Supabase client — so every rule here is fixture-testable.
//
// The rules, in the order they gate:
//   D27  any participant matching an org exclusion pattern → whole message skipped
//   D35  a message is STORED only if a participant matches a CRM contact;
//        that match is the privacy boundary — no contact, no body, ever
//   D36  unknown INBOUND external sender → metadata-only lead candidate
//   D30  attachments: skip inline + <20KB (signature logos), sha256 dedupe
//   D33  historyId cursor; "history too old" → bounded full resync

import type {
  EmailStore,
  GmailMessage,
  GmailPort,
} from "./port";

export const MIN_ATTACHMENT_BYTES = 20 * 1024; // D30
export const RESYNC_MESSAGE_LIMIT = 50;

export interface SyncContext {
  mailbox: string; // the rep's dedicated commercial address
  workspaceDomain: string; // own-domain senders are colleagues, not leads
}

export interface SyncReport {
  scanned: number;
  stored: number;
  excluded: number;
  metadataCandidates: number;
  attachmentsStored: number;
}

/** `Jane Doe <jane@x.com>` → `jane@x.com` (lowercased); bare addresses pass through. */
export function parseAddr(raw: string | null): string | null {
  if (!raw) return null;
  const angled = raw.match(/<([^>]+)>/);
  const addr = (angled ? angled[1] : raw).trim().toLowerCase();
  return addr.includes("@") ? addr : null;
}

export function displayName(raw: string | null): string | null {
  if (!raw) return null;
  const name = raw.replace(/<[^>]+>/g, "").replaceAll('"', "").trim();
  return name && name.includes("@") === false ? name : null;
}

function matchesPattern(email: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  return p.includes("@") ? email === p : email.endsWith(`@${p}`);
}

// Rough classification from name+mime (D31); AI refinement is a later pass.
export function classifyAttachment(
  filename: string,
  mime: string,
): string | null {
  const f = filename.toLowerCase();
  if (/quote|quotation|estimate|proposal/.test(f)) return "QUOTE";
  if (/spec|datasheet|data-sheet|tds/.test(f)) return "SPEC_SHEET";
  if (/drawing|dwg|plan/.test(f) || f.endsWith(".dwg")) return "DRAWING";
  if (/submittal/.test(f)) return "SUBMITTAL";
  if (mime.startsWith("image/")) return "PHOTO";
  if (/invoice/.test(f)) return "INVOICE";
  return "OTHER";
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    data.slice().buffer as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function participantsOf(msg: GmailMessage): string[] {
  const all = [msg.from, ...msg.to, ...msg.cc]
    .map(parseAddr)
    .filter((a): a is string => Boolean(a));
  return [...new Set(all)];
}

export async function syncMailbox(
  gmail: GmailPort,
  store: EmailStore,
  ctx: SyncContext,
): Promise<SyncReport> {
  const report: SyncReport = {
    scanned: 0,
    stored: 0,
    excluded: 0,
    metadataCandidates: 0,
    attachmentsStored: 0,
  };

  // ── Cursor (D33) ──────────────────────────────────────────────────────────
  const { historyId: cursor } = await store.getSyncState();
  let messageIds: string[];
  let nextHistoryId: string;
  if (cursor) {
    const res = await gmail.listHistory(ctx.mailbox, cursor);
    if (res.kind === "ok") {
      messageIds = res.messageIds;
      nextHistoryId = res.historyId;
    } else {
      // history expired — bounded full resync; idempotent inserts absorb overlap
      const recent = await gmail.listRecentMessageIds(
        ctx.mailbox,
        RESYNC_MESSAGE_LIMIT,
      );
      messageIds = recent.messageIds;
      nextHistoryId = recent.historyId;
    }
  } else {
    const recent = await gmail.listRecentMessageIds(
      ctx.mailbox,
      RESYNC_MESSAGE_LIMIT,
    );
    messageIds = recent.messageIds;
    nextHistoryId = recent.historyId;
  }

  const exclusions = await store.listExclusionPatterns();

  for (const id of messageIds) {
    const msg = await gmail.getMessage(ctx.mailbox, id);
    if (!msg) continue;
    report.scanned += 1;

    const participants = participantsOf(msg);
    if (participants.length === 0) continue;

    // D27: the safety net wins over everything, including contact matches.
    if (participants.some((p) => exclusions.some((x) => matchesPattern(p, x)))) {
      report.excluded += 1;
      continue;
    }

    const fromAddr = parseAddr(msg.from);
    const direction: "INBOUND" | "OUTBOUND" =
      fromAddr === ctx.mailbox.toLowerCase() ? "OUTBOUND" : "INBOUND";

    // D35: contact matching IS the privacy boundary.
    const others = participants.filter((p) => p !== ctx.mailbox.toLowerCase());
    const matches = await store.findContactsByEmails(others);

    if (matches.length === 0) {
      // D36: no body is fetched-forward — metadata only, and only for INBOUND
      // external senders (colleagues are not leads).
      if (
        direction === "INBOUND" &&
        fromAddr &&
        !fromAddr.endsWith(`@${ctx.workspaceDomain.toLowerCase()}`) &&
        !(await store.hasCandidateForSender(fromAddr))
      ) {
        await store.createMetadataCandidate({
          email: fromAddr,
          displayName: displayName(msg.from),
          domain: fromAddr.split("@")[1] ?? "",
          subject: msg.subject,
          sentAt: msg.sentAt,
        });
        report.metadataCandidates += 1;
      }
      continue;
    }

    // ── Matched: persist thread, message, body, attachments ────────────────
    const primary = matches[0];
    const threadRowId = await store.upsertThread({
      gmailThreadId: msg.threadId,
      subject: msg.subject,
      participants,
      matchedAccountId: primary.account_id,
      matchedContactId: primary.id,
      messageAt: msg.sentAt,
      direction,
    });

    const bodyRef = msg.bodyText
      ? await store.putBodyBlob(msg.id, msg.bodyText)
      : null;

    const keepable = msg.attachments.filter(
      (a) => !a.inline && a.sizeBytes >= MIN_ATTACHMENT_BYTES,
    );
    const messageRowId = await store.insertMessage({
      threadRowId,
      gmailMessageId: msg.id,
      fromAddr,
      toAddrs: msg.to.map(parseAddr).filter((a): a is string => Boolean(a)),
      ccAddrs: msg.cc.map(parseAddr).filter((a): a is string => Boolean(a)),
      sentAt: msg.sentAt,
      direction,
      snippet: msg.snippet,
      bodyRef,
      hasAttachments: keepable.length > 0,
    });
    if (!messageRowId) continue; // already stored on a prior pass (idempotent)
    report.stored += 1;

    for (const att of keepable) {
      // D30: download EAGERLY — Gmail attachment ids are not durable handles.
      const data = await gmail.getAttachment(ctx.mailbox, msg.id, att.attachmentId);
      if (!data) continue;
      const sha = await sha256Hex(data);
      if (!(await store.attachmentBlobExists(sha))) {
        await store.putAttachmentBlob(sha, data, att.mimeType);
      }
      await store.insertAttachment({
        messageRowId,
        filename: att.filename,
        mimeType: att.mimeType,
        sizeBytes: att.sizeBytes,
        sha256: sha,
        storagePath: `email/${sha}`,
        classification: classifyAttachment(att.filename, att.mimeType),
      });
      report.attachmentsStored += 1;
    }
  }

  await store.setSyncState({ historyId: nextHistoryId, status: "idle" });
  return report;
}
