/**
 * Address an image (and optionally a region) by its CITE2 URN:
 *   iiif-cite.html?manifest=<url>&urns=<URN map url>&urn=urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.1,0.2,0.3,0.4
 * The URN is looked up in the URN map to find the canvas. A URN without a collection version
 * (urn:cite2:hmt:vaimg:VA001RN_0002) matches whatever version the map has. Pure.
 */
import { parseRoi, type Roi } from "cite-roi";
import type { CanvasInfo } from "./manifest.ts";
import { urnForCanvas, type UrnMap } from "./urn-map.ts";

export interface Cite2 {
  namespace: string;
  collection: string;
  version: string | null;
  object: string;
  /** Text after "@", if any. */
  extension: string | null;
}

/** Parse urn:cite2:namespace:collection[.version]:object[@extension]; null if not one. */
export function parseCite2(urn: string): Cite2 | null {
  const m = urn.trim().match(/^urn:cite2:([^:@\s]+):([^:@\s.]+)(?:\.([^:@\s.]+))?:([^:@\s]+)(?:@(\S+))?$/);
  if (!m) return null;
  return { namespace: m[1], collection: m[2], version: m[3] ?? null, object: m[4], extension: m[5] ?? null };
}

/** Does `requested` name the image `mapped`? A requested URN without a version matches any version. */
export function sameObject(requested: Cite2, mapped: Cite2): boolean {
  return requested.namespace === mapped.namespace && requested.collection === mapped.collection &&
    requested.object === mapped.object && (requested.version === null || requested.version === mapped.version);
}

export type UrnLookup =
  | { ok: true; index: number; roi: Roi | null }
  | { ok: false; error: string };

/** Find the canvas a URN names, and its region if the URN has one. */
export function findByUrn(canvases: CanvasInfo[], map: UrnMap | null, urn: string): UrnLookup {
  const req = parseCite2(urn);
  if (!req) return { ok: false, error: `Not a CITE2 URN: ${urn}` };
  let roi: Roi | null = null;
  if (req.extension !== null) {
    roi = parseRoi(req.extension);
    if (!roi) return { ok: false, error: `Not a region (x,y,w,h as fractions of the image): @${req.extension}` };
  }
  if (!map) return { ok: false, error: `To find ${urn}, the link needs a URN map (urns=…)` };
  for (let i = 0; i < canvases.length; i++) {
    const mapped = urnForCanvas(map, canvases[i]);
    const m = mapped ? parseCite2(mapped) : null;
    if (m && sameObject(req, m)) return { ok: true, index: i, roi };
  }
  return { ok: false, error: `No image with URN ${urn.split("@")[0]} in the URN map for this manifest` };
}

/** Encode a link parameter, leaving URN and URL punctuation readable (: / @ , ;). */
export const encodeParam = (v: string): string =>
  encodeURIComponent(v).replace(/%3A/gi, ":").replace(/%2F/gi, "/").replace(/%40/g, "@").replace(/%2C/gi, ",").replace(/%3B/gi, ";");

/** A link: base page + ?key=value&… (null values left out). */
export function linkTo(base: string, params: [string, string | null][]): string {
  const q = params.filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}=${encodeParam(v!)}`).join("&");
  return q ? `${base}?${q}` : base;
}
