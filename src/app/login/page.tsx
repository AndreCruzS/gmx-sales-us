"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({
      email,
      password,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function signInWithGoogle() {
    // Workspace sign-in (D25). Requires the Google provider to be configured
    // on the Supabase project; sign-in validates the workspace domain later.
    setError(null);
    const { error } = await getSupabaseBrowserClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) setError(error.message);
  }

  return (
    // Fixed to the viewport: the app shell pads this column for a tab bar
    // that never renders on /login, so in-flow centering is always skewed.
    // m-auto in an overflow container still scrolls cleanly on short screens.
    <div className="fixed inset-0 flex overflow-y-auto px-4">
      <div className="m-auto flex w-full max-w-sm flex-col gap-6 py-8">
      <div className="text-center">
        <h1 className="t-title text-2xl">Commercial OS</h1>
        <p className="t-meta mt-1">Record once — update everything.</p>
      </div>

      <button onClick={signInWithGoogle} className="btn-secondary w-full">
        {/* standard multicolor G per Google's sign-in branding */}
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        Continue with Google
      </button>

      <div className="t-meta flex items-center gap-3 uppercase">
        <div className="h-px flex-1 bg-current opacity-30" />
        or
        <div className="h-px flex-1 bg-current opacity-30" />
      </div>

      <form onSubmit={signInWithPassword} className="flex flex-col gap-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field"
        />
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field pr-12"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
            style={{ color: "var(--ink-muted)" }}
          >
            {showPassword ? (
              // eye-off
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68" />
                <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 8 10 8a9.74 9.74 0 0 0 5.39-1.61" />
                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                <line x1="2" x2="22" y1="2" y2="22" />
              </svg>
            ) : (
              // eye
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
        {/* desktop caps btn-primary at 340px by design — center the pill
            under the full-width fields instead of hanging it left */}
        <button type="submit" disabled={busy} className="btn-primary mx-auto w-full">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

        {error && <p className="text-center text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
