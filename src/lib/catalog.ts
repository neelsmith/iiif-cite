/**
 * Image catalogs: images on an ordinary web server, listed in a delimited-text file.
 *
 *   path|caption|credits|license|tags|urn
 *   leiden-pliny/IMG_1200.jpeg|Leiden, MS Lipsius 7 …|Photograph Neel Smith, 2019|Public domain (CC0)|Pliny, Leiden|urn:cite2:citeleiden:lipsius7.v1:IMG_1200
 *
 * `path` (required) is relative to the catalog's own URL; `urn` is the image's CITE2 URN.
 * caption, credits, license, tags (comma-separated), year and place are optional. The
 * delimiter is `|` unless the header line has none (then tab, then comma).
 *
 * With thumbnails, each image has one at `<its folder>/_thumbs/<file name>.jpg`:
 *   Project1/imageA.png → Project1/_thumbs/imageA.png.jpg
 *
 * A catalog is read into the same shape as a IIIF manifest (one "canvas" per image, id = its
 * path, a static image, no Image API service) plus a URN map, so the grid, viewer, selections
 * and links work unchanged. Pure.
 */
import { parseDelimited } from "./cex.ts";
import type { CanvasInfo, ManifestInfo } from "./manifest.ts";
import { CITE2_OBJECT, type UrnMap } from "./urn-map.ts";

export interface CatalogEntry {
  path: string;
  caption: string;
  credits: string;
  license: string;
  tags: string[];
  /** Optional columns; "" if absent. */
  year: string;
  place: string;
  urn: string;
}

export interface CatalogInfo {
  url: string;
  thumbs: boolean;
  /** The catalog as a manifest: canvas id = path, label = caption (or file name). */
  manifest: ManifestInfo;
  urnMap: UrnMap;
  /** Catalog rows by canvas id (path). */
  entries: Map<string, CatalogEntry>;
  /** Columns present (lower case). */
  columns: string[];
}

/** `|`, unless the first data-bearing line has none: then tab, then comma. */
export function detectDelimiter(text: string): string {
  const first = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim())
    .find((l) => l && !l.startsWith("//") && !l.startsWith("#!")) ?? "";
  return first.includes("|") ? "|" : first.includes("\t") ? "\t" : first.includes(",") ? "," : "|";
}

/** Does this text look like a catalog (a delimited header with a `path` column)? */
export function looksLikeCatalog(text: string): boolean {
  const t = parseDelimited(text.split(/\r?\n/).slice(0, 50).join("\n"), detectDelimiter(text));
  return t.headers.includes("path");
}

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** Full URL of a catalog image: its path resolved against the catalog's URL. */
export function catalogImageUrl(catalogUrl: string, path: string): string {
  return new URL(encodePath(path), catalogUrl).href;
}

/** Thumbnail URL: `<folder>/_thumbs/<file>.jpg` next to the image. */
export function catalogThumbUrl(catalogUrl: string, path: string): string {
  const i = path.lastIndexOf("/");
  return catalogImageUrl(catalogUrl, `${path.slice(0, i + 1)}_thumbs/${path.slice(i + 1)}.jpg`);
}

export function splitTags(s: string): string[] {
  return [...new Set(s.split(",").map((t) => t.trim()).filter(Boolean))];
}

/** Catalog file name for a heading: "…/images/lips7.cex" → "lips7.cex". */
export function catalogName(url: string): string {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean).pop();
    return seg ? decodeURIComponent(seg) : url;
  } catch { return url; }
}

/**
 * Read a catalog. Throws only if there is no `path` column; other problems (no `urn` column,
 * bad URNs, repeated paths) are listed in manifest.errors.
 */
export function parseCatalog(text: string, url: string, thumbs: boolean): CatalogInfo {
  const table = parseDelimited(text, detectDelimiter(text));
  if (!table.headers.includes("path")) {
    throw new Error(`${url}: not an image catalog (no "path" column in its header line)`);
  }
  const errors = [...table.errors];
  const hasUrn = table.headers.includes("urn");
  if (!hasUrn) errors.push('catalog has no "urn" column, so its images have no CITE2 URNs');
  const canvases: CanvasInfo[] = [];
  const entries = new Map<string, CatalogEntry>();
  const byCanvas = new Map<string, string>();
  const urnRow = new Map<string, string>();
  table.rows.forEach((r, i) => {
    const where = `row ${i + 1}`;
    const path = (r.path ?? "").trim().replace(/\\/g, "/").replace(/^\.?\/+/, "");
    if (!path) { errors.push(`${where}: empty path; skipped`); return; }
    if (entries.has(path)) { errors.push(`${where}: ${path} is listed twice; the first row is used`); return; }
    let urn = (r.urn ?? "").trim().split("@")[0];
    if (urn && !CITE2_OBJECT.test(urn)) { errors.push(`${where}: not a CITE2 object URN: ${urn}`); urn = ""; }
    if (urn && urnRow.has(urn)) errors.push(`${where}: URN ${urn} is also given to ${urnRow.get(urn)}`);
    else if (urn) urnRow.set(urn, path);
    if (hasUrn && !urn && !(r.urn ?? "").trim()) errors.push(`${where}: ${path} has no URN`);
    const e: CatalogEntry = {
      path, caption: r.caption ?? "", credits: r.credits ?? "", license: r.license ?? "",
      tags: splitTags(r.tags ?? ""), year: r.year ?? "", place: r.place ?? "", urn,
    };
    let imageUrl: string;
    try { imageUrl = catalogImageUrl(url, path); } catch { errors.push(`${where}: bad path ${path}; skipped`); return; }
    entries.set(path, e);
    if (urn) byCanvas.set(path, urn);
    canvases.push({
      id: path, label: e.caption || path.split("/").pop()!, width: 0, height: 0, service: null,
      imageUrl, thumbnail: thumbs ? catalogThumbUrl(url, path) : null,
    });
  });
  if (!canvases.length) errors.push("catalog lists no images");
  return {
    url, thumbs, entries, columns: table.headers,
    // version: unused for catalogs (there is no Presentation API); 3 keeps the type.
    manifest: { id: url, label: catalogName(url), version: 3, canvases, errors },
    urnMap: { byImage: new Map(), byCanvas, errors: [] },
  };
}
