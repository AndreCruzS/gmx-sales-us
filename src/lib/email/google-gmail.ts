// GmailPort over the raw Gmail REST API with a service account + domain-wide
// delegation (spec §6): the SA signs a JWT with `sub` = the rep's mailbox and
// exchanges it for an access token scoped gmail.readonly. No googleapis SDK —
// two endpoints and a JWT don't justify 20MB of dependency.

import {
  serviceAccountToken,
  type ServiceAccountKey,
} from "@/lib/google/auth";
import type {
  GmailAttachmentMeta,
  GmailMessage,
  GmailPort,
  HistoryResult,
} from "./port";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const API = "https://gmail.googleapis.com/gmail/v1/users";

export class GoogleGmailPort implements GmailPort {
  constructor(private key: ServiceAccountKey) {}

  private async get(mailbox: string, path: string): Promise<Response> {
    // domain-wide delegation: act as this mailbox
    const token = await serviceAccountToken(this.key, SCOPE, mailbox);
    return fetch(`${API}/${encodeURIComponent(mailbox)}/${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async listHistory(mailbox: string, startHistoryId: string): Promise<HistoryResult> {
    const ids: string[] = [];
    let historyId = startHistoryId;
    let pageToken = "";
    do {
      const res = await this.get(
        mailbox,
        `history?startHistoryId=${startHistoryId}&historyTypes=messageAdded${
          pageToken ? `&pageToken=${pageToken}` : ""
        }`,
      );
      // Gmail signals an expired cursor with 404 (D33 → bounded resync).
      if (res.status === 404) return { kind: "history_too_old" };
      if (!res.ok) throw new Error(`history.list ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as {
        history?: { messagesAdded?: { message: { id: string } }[] }[];
        historyId?: string;
        nextPageToken?: string;
      };
      for (const h of body.history ?? []) {
        for (const m of h.messagesAdded ?? []) ids.push(m.message.id);
      }
      if (body.historyId) historyId = body.historyId;
      pageToken = body.nextPageToken ?? "";
    } while (pageToken);
    return { kind: "ok", messageIds: [...new Set(ids)], historyId };
  }

  async listRecentMessageIds(mailbox: string, maxResults: number) {
    const res = await this.get(mailbox, `messages?maxResults=${maxResults}`);
    if (!res.ok) throw new Error(`messages.list ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { messages?: { id: string }[] };
    const profile = await this.get(mailbox, "profile");
    if (!profile.ok) throw new Error(`profile ${profile.status}`);
    const { historyId } = (await profile.json()) as { historyId: string };
    return { messageIds: (body.messages ?? []).map((m) => m.id), historyId };
  }

  async getMessage(mailbox: string, messageId: string): Promise<GmailMessage | null> {
    const res = await this.get(mailbox, `messages/${messageId}?format=full`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`messages.get ${res.status}: ${await res.text()}`);
    const raw = (await res.json()) as GmailApiMessage;
    return parseGmailMessage(raw);
  }

  async getAttachment(mailbox: string, messageId: string, attachmentId: string) {
    const res = await this.get(
      mailbox,
      `messages/${messageId}/attachments/${attachmentId}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: string };
    if (!body.data) return null;
    return new Uint8Array(Buffer.from(body.data, "base64url"));
  }
}

// ── Payload parsing ──────────────────────────────────────────────────────────

interface GmailApiPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailApiPart[];
}
interface GmailApiMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailApiPart;
}

function header(part: GmailApiPart | undefined, name: string): string | null {
  return (
    part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())
      ?.value ?? null
  );
}

function splitAddrs(raw: string | null): string[] {
  if (!raw) return [];
  // split on commas outside angle brackets is overkill for our matching needs —
  // simple comma split works because we only keep the <addr> portion downstream
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseGmailMessage(raw: GmailApiMessage): GmailMessage {
  const bodyChunks: string[] = [];
  const attachments: GmailAttachmentMeta[] = [];

  const walk = (part: GmailApiPart | undefined) => {
    if (!part) return;
    const disposition = header(part, "Content-Disposition") ?? "";
    const contentId = header(part, "Content-ID");
    if (part.body?.attachmentId) {
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename || "attachment",
        mimeType: part.mimeType ?? "application/octet-stream",
        sizeBytes: part.body.size ?? 0,
        inline:
          disposition.toLowerCase().startsWith("inline") || Boolean(contentId),
      });
    } else if (part.mimeType === "text/plain" && part.body?.data) {
      bodyChunks.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
    }
    for (const p of part.parts ?? []) walk(p);
  };
  walk(raw.payload);

  return {
    id: raw.id,
    threadId: raw.threadId,
    subject: header(raw.payload, "Subject"),
    from: header(raw.payload, "From"),
    to: splitAddrs(header(raw.payload, "To")),
    cc: splitAddrs(header(raw.payload, "Cc")),
    sentAt: raw.internalDate
      ? new Date(Number(raw.internalDate)).toISOString()
      : null,
    snippet: raw.snippet ?? null,
    bodyText: bodyChunks.length ? bodyChunks.join("\n") : null,
    attachments,
  };
}
