// Gmail ingestion ports (spec §5a, D26–D38). Same philosophy as D55: the sync
// core knows these interfaces, never Google or Supabase directly — so the whole
// pipeline is provable with fixtures before a single credential exists.

export interface GmailAttachmentMeta {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Content-Disposition: inline or cid-referenced — signature logos etc. */
  inline: boolean;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string | null;
  from: string | null; // raw header, may be `Name <addr>`
  to: string[];
  cc: string[];
  sentAt: string | null; // ISO
  snippet: string | null;
  bodyText: string | null;
  attachments: GmailAttachmentMeta[];
}

export type HistoryResult =
  | { kind: "ok"; messageIds: string[]; historyId: string }
  | { kind: "history_too_old" };

export interface GmailPort {
  /** Incremental: everything added since startHistoryId (D33). */
  listHistory(mailbox: string, startHistoryId: string): Promise<HistoryResult>;
  /** Bounded resync: the most recent N message ids + current historyId. */
  listRecentMessageIds(
    mailbox: string,
    maxResults: number,
  ): Promise<{ messageIds: string[]; historyId: string }>;
  getMessage(mailbox: string, messageId: string): Promise<GmailMessage | null>;
  getAttachment(
    mailbox: string,
    messageId: string,
    attachmentId: string,
  ): Promise<Uint8Array | null>;
}

// What the sync core needs to persist — implemented over the service-role
// client in production, in memory in tests.
export interface MatchedContact {
  id: string;
  account_id: string;
  email: string;
}

export interface ThreadUpsert {
  gmailThreadId: string;
  subject: string | null;
  participants: string[];
  matchedAccountId: string;
  matchedContactId: string;
  messageAt: string | null;
  direction: "INBOUND" | "OUTBOUND";
}

export interface MessageInsert {
  threadRowId: string;
  gmailMessageId: string;
  fromAddr: string | null;
  toAddrs: string[];
  ccAddrs: string[];
  sentAt: string | null;
  direction: "INBOUND" | "OUTBOUND";
  snippet: string | null;
  bodyRef: string | null;
  hasAttachments: boolean;
}

export interface AttachmentInsert {
  messageRowId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storagePath: string;
  classification: string | null;
}

export interface EmailStore {
  /** Case-normalized lookup; the D35 privacy boundary. */
  findContactsByEmails(emails: string[]): Promise<MatchedContact[]>;
  listExclusionPatterns(): Promise<string[]>;
  /** Returns the thread row id (existing or created) and updates aggregates. */
  upsertThread(t: ThreadUpsert): Promise<string>;
  /** No-op (returns null) when the gmail message id is already stored. */
  insertMessage(m: MessageInsert): Promise<string | null>;
  insertAttachment(a: AttachmentInsert): Promise<void>;
  /** sha-level dedupe (D30): true if this org already stores the blob. */
  attachmentBlobExists(sha256: string): Promise<boolean>;
  putAttachmentBlob(sha256: string, data: Uint8Array, mime: string): Promise<void>;
  putBodyBlob(gmailMessageId: string, text: string): Promise<string>; // returns body_ref
  /** D36: unknown INBOUND sender → metadata-only candidate, deduped by address. */
  hasCandidateForSender(email: string): Promise<boolean>;
  createMetadataCandidate(c: {
    email: string;
    displayName: string | null;
    domain: string;
    subject: string | null;
    sentAt: string | null;
  }): Promise<void>;
  getSyncState(): Promise<{ historyId: string | null }>;
  setSyncState(s: { historyId: string; status: string }): Promise<void>;
}
