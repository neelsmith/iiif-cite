/**
 * Map IIIF canvases to CITE2 image URNs, from a separate delimited-text (CEX-style) file:
 *
 *   canvas|urn
 *   https://example.org/iiif/ms/canvas/1r|urn:cite2:hmt:vaimg.2017a:VA001RN_0002
 *
 * Header names are case-insensitive. Extra columns (e.g. a label) are allowed and ignored.
 */
import { parseDelimited } from "./cex.ts";

export interface UrnMap {
  /** canvas id → image URN (without any @region extension). */
  byCanvas: Map<string, string>;
  errors: string[];
}

const CITE2 = /^urn:cite2:[^:]+:[^:]+:[^:@]+$/;

export function parseUrnMap(text: string, delimiter = "|"): UrnMap {
  const table = parseDelimited(text, delimiter);
  const errors = [...table.errors];
  const byCanvas = new Map<string, string>();
  if (!table.headers.includes("canvas") || !table.headers.includes("urn")) {
    errors.push('header must include "canvas" and "urn" columns');
    return { byCanvas, errors };
  }
  table.rows.forEach((row, i) => {
    const canvas = row.canvas, urn = (row.urn ?? "").split("@")[0];
    const where = `row ${i + 1}`;
    if (!canvas || !urn) { errors.push(`${where}: missing canvas or urn`); return; }
    if (!CITE2.test(urn)) { errors.push(`${where}: not a CITE2 object URN: ${urn}`); return; }
    if (byCanvas.has(canvas) && byCanvas.get(canvas) !== urn) errors.push(`${where}: canvas listed twice with different URNs: ${canvas}`);
    byCanvas.set(canvas, urn);
  });
  return { byCanvas, errors };
}

export const urnForCanvas = (map: UrnMap | null, canvasId: string): string | null =>
  map?.byCanvas.get(canvasId) ?? null;
