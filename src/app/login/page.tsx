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
    <div className="mx-auto flex max-w-sm flex-col gap-6 pt-10">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Commercial OS</h1>
        <p className="mt-1 text-sm opacity-60">Record once — update everything.</p>
      </div>

      <button
        onClick={signInWithGoogle}
        className="rounded-xl border border-black/15 px-4 py-3 font-medium dark:border-white/20"
      >
        Continue with Google Workspace
      </button>

      <div className="flex items-center gap-3 text-xs uppercase opacity-40">
        <div className="h-px flex-1 bg-current" />
        or
        <div className="h-px flex-1 bg-current" />
      </div>

      <form onSubmit={signInWithPassword} className="flex flex-col gap-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-xl border border-black/15 bg-transparent px-4 py-3 dark:border-white/20"
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-xl border border-black/15 bg-transparent px-4 py-3 dark:border-white/20"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-amber-500 px-4 py-3 font-semibold text-black disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {error && <p className="text-center text-sm text-red-600">{error}</p>}
    </div>
  );
}
