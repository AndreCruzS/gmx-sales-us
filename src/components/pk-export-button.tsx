"use client";

// "Export to Excel" on the PK follow-up toolbar (spec 2026-11-02 §5): writes
// what the filters show, as the two sheets pkExportSheets builds. The writer
// is imported on click only, so nobody downloads it for a page they read.

import { useState } from "react";
import { pkExportFileName, pkExportSheets } from "@/lib/domain/pk-export";
import { bandProgress, type PkBand, type PkNote, type PkSubtask } from "@/lib/domain/pk-follow-up";

export function PkExportButton({
  visible,
  all,
  notes,
  subtasks,
  names,
  todayIso,
}: {
  /** The PKs and rows the filters leave. */
  visible: PkBand[];
  /** Every PK, whole: a band's % never changes with a filter. */
  all: PkBand[];
  notes: PkNote[];
  subtasks: PkSubtask[];
  names: Map<string, string>;
  todayIso: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run() {
    setBusy(true);
    setFailed(false);
    try {
      const progress = new Map(
        all.map((b) => [
          b.activityId,
          bandProgress(b.items, subtasks.filter((s) => b.items.some((i) => i.id === s.next_action_id))),
        ]),
      );
      const { followUps, subtasks: subRows } = pkExportSheets(visible, notes, subtasks, names, progress, todayIso);
      // The package has no root entry: the browser build is its own path.
      const { default: writeXlsxFile } = await import("write-excel-file/browser");
      await writeXlsxFile([
        {
          data: followUps,
          sheet: "Action items",
          columns: [{ width: 38 }, { width: 18 }, { width: 16 }, { width: 12 }, { width: 7 }, { width: 14 }, { width: 16 }, { width: 10 }, { width: 70 }],
          stickyRowsCount: 1,
        },
        {
          data: subRows,
          sheet: "Subtasks",
          columns: [{ width: 36 }, { width: 38 }, { width: 38 }, { width: 14 }],
          stickyRowsCount: 1,
        },
      ]).toFile(pkExportFileName(todayIso));
    } catch (e) {
      console.error(e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {failed && (
        <span className="t-sub" role="alert" style={{ color: "var(--danger)", marginRight: 8 }}>
          The file could not be made. Try again.
        </span>
      )}
      <button type="button" className="pk-btn" disabled={busy || !todayIso} onClick={() => void run()}>
        {busy ? "Making the file…" : "Export to Excel"}
      </button>
    </>
  );
}
