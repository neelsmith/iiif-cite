// Copied from imageviewer/src/lib/cex.ts; keep the two in step.
/**
 * Minimal reader for delimited text in the CEX style: one header line, then
 * data lines. Blank lines, `//` comments and `#!block` labels are skipped.
 */
export interface DelimitedTable {
  headers: string[];
  rows: Record<string, string>[];
  /** Human-readable problems (1-based line numbers); never fatal. */
  errors: string[];
}

export function parseDelimited(text: string, delimiter = "|"): DelimitedTable {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let headers: string[] | null = null;
  const rows: Record<string, string>[] = [];
  const errors: string[] = [];

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("//") || line.startsWith("#!")) return;
    const cells = raw.split(delimiter).map((c) => c.trim());
    if (!headers) {
      // "Cex File" and "cex_file" both become "cex_file".
      headers = cells.map((h) => h.toLowerCase().replace(/\s+/g, "_"));
      return;
    }
    if (cells.length !== headers.length) {
      errors.push(
        `line ${i + 1}: expected ${headers.length} fields, found ${cells.length}`,
      );
    }
    const row: Record<string, string> = {};
    headers.forEach((h, j) => (row[h] = cells[j] ?? ""));
    rows.push(row);
  });

  return { headers: headers ?? [], rows, errors };
}
