"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Tab = "muse" | "claude";

function steps(tab: Tab, address: string): { list: ReactNode[]; note: ReactNode } {
  if (tab === "muse") {
    return {
      list: [
        <>In Muse, open <b>Settings → Connectors</b> and tap <b>Add custom connector</b>.</>,
        <>Name it <b>GMX Sales</b> and paste the address above.</>,
        <>Tap <b>Connect</b>, sign in with your GMX Sales account and tap <b>Allow</b>.</>,
        <>Back in Muse, ask &quot;What&apos;s on my agenda today?&quot; to check it works.</>,
      ],
      note: (
        <>
          No Add custom connector option? Ask Muse in a chat: &quot;Add a custom connector for{" "}
          {address}&quot;.
        </>
      ),
    };
  }
  return {
    list: [
      <>In Claude, open <b>Settings → Connectors</b>.</>,
      <>Find <b>GMX Sales</b> (your admin added it) and tap <b>Connect</b>.</>,
      <>Sign in with your GMX Sales account and tap <b>Allow</b>.</>,
      <>In a chat, tap <b>+ → Connectors</b> and check GMX Sales is on.</>,
    ],
    note: (
      <>
        Don&apos;t see GMX Sales? Ask your Claude admin to add it as a custom connector with the
        address above, with personal sign-in.
      </>
    ),
  };
}

const TRY_SAYING = [
  "What's on my agenda this week?",
  "Just left a PK at Big Creek Boise — six people, I promised the Ipe catalog.",
  "Which PK follow-ups are past their alert?",
];

export function ConnectorGuide({ address }: { address: string }) {
  const [tab, setTab] = useState<Tab>("muse");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(address);
      ok = true;
    } catch {
      // older webviews: fall back to a throwaway textarea
      const ta = document.createElement("textarea");
      ta.value = address;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        // the address is selectable on screen
      }
      ta.remove();
    }
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  const { list, note } = steps(tab, address);

  return (
    <div className="stack-sm aic">
      <div className="card card-pad">
        <p className="aic-text">
          Your agent signs in as you. It sees and records only what you can in the app, and tells
          you what it recorded so you can correct it.
        </p>
      </div>

      <div className="card card-pad">
        <p className="sales-eyebrow aic-eyebrow">Connector address</p>
        <div className="aic-address">
          <span className="aic-url">{address}</span>
          <button type="button" className="btn-quiet" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="card card-pad">
        <div className="dl-tabs aic-tabs" role="tablist" aria-label="Which agent">
          {(["muse", "claude"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`aic-tab-${t}`}
              aria-selected={tab === t}
              aria-controls="aic-panel"
              className="dl-tab"
              aria-current={tab === t ? "page" : undefined}
              onClick={() => setTab(t)}
            >
              {t === "muse" ? "Muse" : "Claude"}
            </button>
          ))}
        </div>
        <div role="tabpanel" id="aic-panel" aria-labelledby={`aic-tab-${tab}`}>
          <ol className="aic-steps">
            {list.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p className="t-hint aic-note">{note}</p>
        </div>
      </div>

      <div className="card card-pad">
        <p className="sales-eyebrow aic-eyebrow">Try saying</p>
        <div className="aic-quotes">
          {TRY_SAYING.map((q) => (
            <q key={q} className="aic-quote">
              {q}
            </q>
          ))}
        </div>
      </div>

      <div className="card card-pad">
        <p className="sales-eyebrow aic-eyebrow">It asks you first before</p>
        <ul className="aic-bullets">
          <li>anything in someone else&apos;s name or agenda</li>
          <li>changing 5 or more records at once</li>
        </ul>
        <p className="sales-eyebrow">Changed your mind?</p>
        <p className="aic-text">
          Say &quot;undo that&quot; — it reverses what it just did. To disconnect, remove GMX Sales
          in your agent&apos;s connector settings.
        </p>
      </div>

      <div className="card card-pad">
        <p className="sales-eyebrow aic-eyebrow">Showing someone?</p>
        <p className="aic-text">Open GMX Sales, tap your name, then AI connector.</p>
      </div>
    </div>
  );
}
