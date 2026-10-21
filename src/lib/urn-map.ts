/**
 * Map a manifest's images to CITE2 image URNs, from a separate delimited-text (CEX-style) file:
 *
 *   image|urn|label
 *   http://www.homermultitext.org/iipsrv?IIIF=/…/VA001RN_0002.tif|urn:cite2:hmt:vaimg.2017a:VA001RN_0002|folio 1, recto
 *
 * `image` is the IIIF Image API service id (for a canvas without a service, its image URL).
 * Image ids are matched ignoring http/https, a trailing slash and "/info.json", so a map works
 * on http and https pages and for any manifest that uses the same images. `label` (and any
 * other extra column) is for people reading the file and is ignored.
 *
 * Older maps keyed by canvas id (`canvas|urn`) are still read; a canvas row wins over an
 * image row. Header names are case-insensitive.
 */
import { parseDelimited } from "./cex.ts";
import { serviceBase, type CanvasInfo } from "./manifest.ts";

export interface UrnMap {
  /** image key (see imageKey) → image URN (without any @region extension). */
  byImage: Map<string, string>;
  /** canvas id → image URN. */
  byCanvas: Map<string, string>;
  errors: string[];
}

/** CITE2 object URN: urn:cite2:namespace:collection[.version]:object (no region). */
export const CITE2_OBJECT = /^urn:cite2:[^:@\s]+:[^:@\s]+:[^:@\s]+$/;

/** Comparable form of an image id: no scheme, no trailing slash or "/info.json". */
export const imageKey = (id: string): string => serviceBase(id.trim()).replace(/^https?:\/\//i, "");

/** The id a canvas's image is mapped by: its Image API service, else its image URL. */
export const canvasImageId = (c: CanvasInfo): string | null => c.service?.id ?? c.imageUrl;

export function parseUrnMap(text: string, delimiter = "|"): UrnMap {
  const table = parseDelimited(text, delimiter);
  const errors = [...table.errors];
  const byImage = new Map<string, string>(), byCanvas = new Map<string, string>();
  const hasImage = table.headers.includes("image"), hasCanvas = table.headers.includes("canvas");
  if (!table.headers.includes("urn") || (!hasImage && !hasCanvas)) {
    errors.push('header must include "urn" and an "image" (or "canvas") column');
    return { byImage, byCanvas, errors };
  }
  table.rows.forEach((row, i) => {
    const where = `row ${i + 1}`;
    const urn = (row.urn ?? "").split("@")[0];
    const image = hasImage ? row.image : "", canvas = hasCanvas ? row.canvas : "";
    if (!urn || (!image && !canvas)) { errors.push(`${where}: missing ${urn ? (hasImage ? "image" : "canvas") : "urn"}`); return; }
    if (!CITE2_OBJECT.test(urn)) { errors.push(`${where}: not a CITE2 object URN: ${urn}`); return; }
    const put = (m: Map<string, string>, k: string, what: string) => {
      if (m.has(k) && m.get(k) !== urn) errors.push(`${where}: ${what} listed twice with different URNs: ${k}`);
      m.set(k, urn);
    };
    if (image) put(byImage, imageKey(image), "image");
    if (canvas) put(byCanvas, canvas, "canvas");
  });
  return { byImage, byCanvas, errors };
}

export function urnForCanvas(map: UrnMap | null, c: CanvasInfo): string | null {
  if (!map) return null;
  const byCanvas = map.byCanvas.get(c.id);
  if (byCanvas) return byCanvas;
  const id = canvasImageId(c);
  return id ? map.byImage.get(imageKey(id)) ?? null : null;
}
