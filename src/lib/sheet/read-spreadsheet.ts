"use client";

// Reading the file a distributor actually sent.
//
// The first version of the loader took a paste, on the reasoning that two unknown
// vendor formats cannot be parsed blind. That reasoning expired the moment a real
// file arrived: they receive an .xlsx by email every month, and making somebody
// open Excel, select a range and paste it is more work than dropping the file in,
// not less. The paste stays as a second door — it is genuinely quicker for a
// three-line correction — but it is no longer the only one.
//
// EVERYTHING PARSING-RELATED IS SOMEWHERE ELSE. This module's whole job is to turn
// bytes into the same { headers, rows } shape a paste produces; the mapping,
// matching, subtotal detection and unit conversion are all in
// lib/domain/sell-through-import.ts and are untouched by which door the data came
// through. That is why the xlsx path was provably identical to the paste path on
// the first real file rather than a second implementation to keep in step.
//
// The reader is imported DYNAMICALLY. It is the largest dependency in the app and
// it is needed by one admin on one screen once a month; a rep in a truck should
// never download it.

import { parseSheet, rowsToSheet, type Sheet } from "@/lib/domain/sell-through-import";

export interface ReadSheet {
  /** What the workbook calls this tab. "Sheet" when the format has no tabs. */
  name: string;
  sheet: Sheet;
}

/** Thrown with something a person can act on, never a parser's own words. */
export class SpreadsheetError extends Error {}

const TEXT = new Set(["csv", "tsv", "txt", "tab"]);
const EXCEL = new Set(["xlsx", "xlsm"]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * Every sheet in the file, in the shape the importer already understands.
 *
 * Legacy .xls is refused by name rather than attempted: it is a completely
 * different binary format, and failing halfway through it would look like a
 * corrupt file rather than an unsupported one. Saving as .xlsx takes one menu.
 */
export async function readSpreadsheet(file: File): Promise<ReadSheet[]> {
  const ext = extensionOf(file.name);

  if (ext === "xls") {
    throw new SpreadsheetError(
      "That is the old .xls format, which this cannot read. Open it and use " +
        "File → Save As → Excel Workbook (.xlsx), then try again.",
    );
  }
  if (ext === "numbers" || ext === "ods") {
    throw new SpreadsheetError(
      `A .${ext} file cannot be read directly. Export it as .xlsx or .csv first.`,
    );
  }

  if (TEXT.has(ext)) {
    const text = await file.text();
    const sheet = parseSheet(text);
    if (sheet.headers.length === 0) {
      throw new SpreadsheetError("That file looks empty — no header row in it.");
    }
    return [{ name: "Sheet", sheet }];
  }

  if (!EXCEL.has(ext)) {
    throw new SpreadsheetError(
      `Cannot read a .${ext || "?"} file. Send the .xlsx the distributor emailed, ` +
        "or a .csv.",
    );
  }

  // Loaded here and nowhere else, so the chunk lands on this screen only. The
  // /browser subpath is deliberate: the package has no root export, and the node
  // build reaches for fs.
  const { default: readXlsxFile } = await import("read-excel-file/browser");

  let workbook: { sheet: string; data: (string | number | boolean | null)[][] }[];
  try {
    workbook = (await readXlsxFile(file)) as typeof workbook;
  } catch {
    throw new SpreadsheetError(
      "That file could not be opened as a spreadsheet. If it came as .xls, " +
        "re-save it as .xlsx.",
    );
  }

  // One entry per tab, which is where the tab names come from — a workbook with
  // several sheets needs the person to say which one is the report.
  const sheets = workbook
    .map((tab, i) => ({
      name: tab.sheet || `Sheet ${i + 1}`,
      sheet: rowsToSheet(tab.data ?? []),
    }))
    .filter((t) => t.sheet.headers.length > 0);

  if (sheets.length === 0) {
    throw new SpreadsheetError("No sheet in that workbook had anything in it.");
  }
  return sheets;
}
