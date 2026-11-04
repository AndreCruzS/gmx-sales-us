export type CallToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

export function ok(text: string, data?: unknown): CallToolResult {
  const r: CallToolResult = { content: [{ type: "text", text }] };
  if (data !== undefined && data !== null) {
    r.structuredContent = Array.isArray(data)
      ? { items: data }
      : typeof data === "object"
        ? (data as Record<string, unknown>)
        : { value: data };
  }
  return r;
}

export function fail(text: string, data?: Record<string, unknown>): CallToolResult {
  const r: CallToolResult = { content: [{ type: "text", text }], isError: true };
  if (data) r.structuredContent = data;
  return r;
}

export function needsConfirmation(preview: string, code: string, expiresAt: string): CallToolResult {
  const text =
    `${preview}\n\nShow this to the person and ask if they want to go ahead. ` +
    `Only if they say yes, call this same tool again with the same arguments plus confirmation: "${code}" ` +
    `(valid until ${expiresAt}).`;
  return {
    content: [{ type: "text", text }],
    structuredContent: { needs_confirmation: true, confirmation: code, expires_at: expiresAt },
  };
}
