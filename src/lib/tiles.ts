/**
 * What to draw for a IIIF image at a given zoom: a low-resolution base image covering
 * the whole picture, plus the tiles of the best pyramid level for the visible part.
 * Positions are in full-resolution image pixels (the same space as lib/zoom's View).
 * Pure functions; the DOM side is ui/tile-viewer.ts.
 */
import { serviceBase, type ImageService } from "./manifest.ts";
import type { Size, View } from "./zoom.ts";

export interface TileSpec { width: number; height: number; scaleFactors: number[] }

export interface ImageInfo {
  /** Service to request from: the manifest's id (info.json's own id can name an internal host). */
  service: ImageService;
  size: Size;
  tiles: TileSpec | null;
  /** Pre-rendered sizes the server offers (rounded; some servers give fractions). */
  sizes: Size[];
  /** Compliance level from info.json (more reliable than the manifest's), null if unstated. */
  level: 0 | 1 | 2 | null;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Read a decoded info.json. Throws if it has no usable width/height. */
export function parseImageInfo(json: unknown, from: ImageService): ImageInfo {
  if (!isObj(json)) throw new Error("info.json is not a JSON object");
  const w = Number(json.width), h = Number(json.height);
  if (!(w > 0 && h > 0)) throw new Error("info.json has no width/height");

  const ctx = [json["@context"]].flat().map(String).join(" ");
  const type = String(json.type ?? json["@type"] ?? "");
  const version: 2 | 3 = ctx.includes("/image/3/") || type === "ImageService3" ? 3
    : ctx.includes("/image/2/") || type === "ImageService2" ? 2 : from.version;

  const profile = [json.profile].flat().find((p) => typeof p === "string") as string | undefined;
  const m = profile?.match(/level([012])/);
  const level = m ? (Number(m[1]) as 0 | 1 | 2) : null;

  const t = [json.tiles].flat().find(isObj);
  let tiles: TileSpec | null = null;
  if (t && Number(t.width) > 0) {
    const factors = [t.scaleFactors].flat().map(Number).filter((f) => f > 0).sort((a, b) => a - b);
    tiles = { width: Number(t.width), height: Number(t.height) || Number(t.width), scaleFactors: factors.length ? factors : [1] };
  }
  const sizes = [json.sizes].flat().filter(isObj)
    .map((s) => ({ w: Math.round(Number(s.width)), h: Math.round(Number(s.height)) }))
    .filter((s) => s.w > 0 && s.h > 0)
    .sort((a, b) => a.w - b.w);

  return {
    service: { id: serviceBase(from.id), version, ...(level !== null ? { profile: `level${level}` } : {}) },
    size: { w, h }, tiles, sizes, level,
  };
}

/** A piece of the image to draw: its URL and where it goes, in full-resolution pixels. */
export interface Piece { url: string; x: number; y: number; w: number; h: number; /** pyramid scale factor */ sf: number }

/** Size parameter for an exact pixel size: "w," (Image API 2) or "w,h" (3, canonical). */
const exactSize = (svc: ImageService, w: number, h: number) => (svc.version === 3 ? `${w},${h}` : `${w},`);

/**
 * Whole-image base layer, at most `maxWidth` px wide: the largest listed size that fits
 * (level 0 can only serve listed sizes), else a scaled request, else the full image.
 */
export function basePiece(info: ImageInfo, maxWidth = 1024): Piece {
  const { service: svc, size } = info;
  const full = { x: 0, y: 0, w: size.w, h: size.h };
  let px: Size | null = null;
  if (info.sizes.length) {
    const fits = info.sizes.filter((s) => s.w <= maxWidth);
    px = fits.length ? fits[fits.length - 1] : info.sizes[0];
  } else if (info.level !== 0) {
    const w = Math.min(maxWidth, size.w);
    px = { w, h: Math.round((size.h * w) / size.w) };
  }
  const sizeParam = px ? exactSize(svc, px.w, px.h) : svc.version === 3 ? "max" : "full";
  return { ...full, url: `${svc.id}/full/${sizeParam}/0/default.jpg`, sf: px ? size.w / px.w : 1 };
}

/**
 * Pyramid level for the current zoom: the coarsest scale factor that still gives at least
 * one image pixel per device pixel (allowing 10% softness), so tiles are never blurry.
 */
export function chooseScaleFactor(factors: number[], scale: number, dpr = 1): number {
  const want = 1 / (scale * dpr); // full-res image pixels per device pixel
  let best = factors[0] ?? 1;
  for (const f of factors) if (f <= want * 1.1 && f > best) best = f;
  return best;
}

/** Tiles of the chosen level that overlap the stage (plus `margin` stage px around it). */
export function visibleTiles(info: ImageInfo, view: View, stage: Size, dpr = 1, margin = 0): Piece[] {
  const t = info.tiles;
  if (!t || view.scale <= 0) return [];
  const { w: W, h: H } = info.size;
  const sf = chooseScaleFactor(t.scaleFactors, view.scale, dpr);
  const tw = t.width * sf, th = t.height * sf; // one tile, in full-res pixels
  const x0 = Math.max(0, (-margin - view.x) / view.scale), x1 = Math.min(W, (stage.w + margin - view.x) / view.scale);
  const y0 = Math.max(0, (-margin - view.y) / view.scale), y1 = Math.min(H, (stage.h + margin - view.y) / view.scale);
  if (x1 <= x0 || y1 <= y0) return [];
  const out: Piece[] = [];
  for (let r = Math.floor(y0 / th); r * th < y1; r++) {
    for (let c = Math.floor(x0 / tw); c * tw < x1; c++) {
      const x = c * tw, y = r * th;
      const w = Math.min(tw, W - x), h = Math.min(th, H - y);
      const region = x === 0 && y === 0 && w === W && h === H ? "full" : `${x},${y},${w},${h}`;
      const size = exactSize(info.service, Math.ceil(w / sf), Math.ceil(h / sf));
      out.push({ url: `${info.service.id}/${region}/${size}/0/default.jpg`, x, y, w, h, sf });
    }
  }
  return out;
}

/** What a viewer draws: a full-size base plus (optionally) tiles for the current view. */
export interface TileSource {
  size: Size;
  base: Piece;
  tiles(view: View, stage: Size, dpr: number): Piece[];
}

export function iiifSource(info: ImageInfo): TileSource {
  return { size: info.size, base: basePiece(info), tiles: (v, s, d) => visibleTiles(info, v, s, d, 256) };
}

/** A plain image file (canvas without an Image API service): just the one picture. */
export function staticSource(url: string, size: Size): TileSource {
  return { size, base: { url, x: 0, y: 0, w: size.w, h: size.h, sf: 1 }, tiles: () => [] };
}
