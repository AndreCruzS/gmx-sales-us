// EmailStore over the service-role client. The service role is used ONLY
// inside the org/membership scope resolved by the route — same posture as the
// voice and card pipelines. Storage paths follow D38: attachments at
// {org_id}/email/{sha256}, bodies at {org_id}/email/bodies/{message_id}.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AttachmentInsert,
  EmailStore,
  MatchedContact,
  MessageInsert,
  ThreadUpsert,
} from "./port";

export class SupabaseEmailStore implements EmailStore {
  constructor(
    private service: SupabaseClient,
    private orgId: string,
    private membershipId: string,
  ) {}

  async findContactsByEmails(emails: string[]): Promise<MatchedContact[]> {
    if (emails.length === 0) return [];
    const { data, error } = await this.service
      .from("contacts")
      .select("id, account_id, email")
      .eq("org_id", this.orgId)
      .in("email", emails);
    if (error) throw new Error(`contact match failed: ${error.message}`);
    return (data ?? []) as MatchedContact[];
  }

  async listExclusionPatterns(): Promise<string[]> {
    const { data, error } = await this.service
      .from("org_email_exclusions")
      .select("pattern")
      .eq("org_id", this.orgId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.pattern as string);
  }

  async upsertThread(t: ThreadUpsert): Promise<string> {
    const { data: existing } = await this.service
      .from("email_threads")
      .select("id, first_message_at, last_message_at")
      .eq("org_id", this.orgId)
      .eq("membership_id", this.membershipId)
      .eq("gmail_thread_id", t.gmailThreadId)
      .maybeSingle();

    if (existing) {
      const patch: Record<string, unknown> = {
        subject: t.subject,
        participants: t.participants,
        matched_account_id: t.matchedAccountId,
        matched_contact_id: t.matchedContactId,
      };
      if (t.messageAt) {
        if (!existing.first_message_at || t.messageAt < existing.first_message_at)
          patch.first_message_at = t.messageAt;
        if (!existing.last_message_at || t.messageAt > existing.last_message_at) {
          patch.last_message_at = t.messageAt;
          patch.last_direction = t.direction;
        }
      }
      await this.service.from("email_threads").update(patch).eq("id", existing.id);
      return existing.id as string;
    }

    const { data, error } = await this.service
      .from("email_threads")
      .insert({
        org_id: this.orgId,
        membership_id: this.membershipId,
        gmail_thread_id: t.gmailThreadId,
        subject: t.subject,
        participants: t.participants,
        matched_account_id: t.matchedAccountId,
        matched_contact_id: t.matchedContactId,
        first_message_at: t.messageAt,
        last_message_at: t.messageAt,
        last_direction: t.direction,
      })
      .select("id")
      .single();
    if (error) throw new Error(`thread insert failed: ${error.message}`);
    return data.id as string;
  }

  async insertMessage(m: MessageInsert): Promise<string | null> {
    const { data, error } = await this.service
      .from("email_messages")
      .upsert(
        {
          org_id: this.orgId,
          thread_id: m.threadRowId,
          gmail_message_id: m.gmailMessageId,
          from_addr: m.fromAddr,
          to_addrs: m.toAddrs,
          cc_addrs: m.ccAddrs,
          sent_at: m.sentAt,
          direction: m.direction,
          snippet: m.snippet,
          body_ref: m.bodyRef,
          has_attachments: m.hasAttachments,
        },
        { onConflict: "org_id,thread_id,gmail_message_id", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`message insert failed: ${error.message}`);
    return (data?.id as string | undefined) ?? null; // null = already stored
  }

  async insertAttachment(a: AttachmentInsert): Promise<void> {
    const { error } = await this.service.from("email_attachments").upsert(
      {
        org_id: this.orgId,
        message_id: a.messageRowId,
        filename: a.filename,
        mime_type: a.mimeType,
        size_bytes: a.sizeBytes,
        sha256: a.sha256,
        storage_path: `${this.orgId}/email/${a.sha256}`,
        classification: a.classification,
      },
      { onConflict: "org_id,message_id,sha256", ignoreDuplicates: true },
    );
    if (error) throw new Error(`attachment insert failed: ${error.message}`);
  }

  async attachmentBlobExists(sha256: string): Promise<boolean> {
    const { data } = await this.service
      .from("email_attachments")
      .select("id")
      .eq("org_id", this.orgId)
      .eq("sha256", sha256)
      .limit(1)
      .maybeSingle();
    return Boolean(data);
  }

  async putAttachmentBlob(sha256: string, data: Uint8Array, mime: string) {
    const { error } = await this.service.storage
      .from("email")
      .upload(`${this.orgId}/email/${sha256}`, data.slice().buffer as ArrayBuffer, {
        contentType: mime,
        upsert: true,
      });
    if (error) throw new Error(`attachment upload failed: ${error.message}`);
  }

  async putBodyBlob(gmailMessageId: string, text: string): Promise<string> {
    const path = `${this.orgId}/email/bodies/${gmailMessageId}`;
    const { error } = await this.service.storage
      .from("email")
      .upload(path, new Blob([text], { type: "text/plain" }), { upsert: true });
    if (error) throw new Error(`body upload failed: ${error.message}`);
    return path;
  }

  async hasCandidateForSender(email: string): Promise<boolean> {
    const { data } = await this.service
      .from("contact_candidates")
      .select("id")
      .eq("org_id", this.orgId)
      .eq("source", "EMAIL_METADATA")
      .eq("status", "PENDING")
      .contains("extracted", { sender: email })
      .limit(1)
      .maybeSingle();
    return Boolean(data);
  }

  async createMetadataCandidate(c: {
    email: string;
    displayName: string | null;
    domain: string;
    subject: string | null;
    sentAt: string | null;
  }): Promise<void> {
    // D36: metadata ONLY — the shape mirrors card extraction so the Review
    // sheet renders it with zero special-casing.
    const { error } = await this.service.from("contact_candidates").insert({
      org_id: this.orgId,
      created_by: this.membershipId,
      source: "EMAIL_METADATA",
      raw_ref: null,
      status: "PENDING",
      extracted: {
        sender: c.email, // dedupe key for hasCandidateForSender
        fields: {
          name: { value: c.displayName, confidence: c.displayName ? 0.8 : 0 },
          job_title: { value: null, confidence: 1 },
          company: { value: c.domain, confidence: 0.5 },
          email: { value: c.email, confidence: 1 },
          phone: { value: null, confidence: 1 },
          address: { value: null, confidence: 1 },
        },
        handwritten_notes: null,
        subject: c.subject,
        received_at: c.sentAt,
      },
    });
    if (error) throw new Error(`candidate insert failed: ${error.message}`);
  }

  async getSyncState(): Promise<{ historyId: string | null }> {
    const { data } = await this.service
      .from("email_sync_state")
      .select("history_id")
      .eq("org_id", this.orgId)
      .eq("membership_id", this.membershipId)
      .maybeSingle();
    return { historyId: (data?.history_id as string | undefined) ?? null };
  }

  async setSyncState(s: { historyId: string; status: string }): Promise<void> {
    const { error } = await this.service.from("email_sync_state").upsert(
      {
        org_id: this.orgId,
        membership_id: this.membershipId,
        history_id: s.historyId,
        status: s.status,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "org_id,membership_id" },
    );
    if (error) throw new Error(`sync state failed: ${error.message}`);
  }
}
