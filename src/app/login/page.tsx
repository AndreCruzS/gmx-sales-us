"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        Continue with Google Workspace
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
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field"
        />
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
