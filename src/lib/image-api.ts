/**
 * Build IIIF Image API request URLs ({id}/{region}/{size}/{rotation}/{quality}.{format})
 * and convert regions of interest (fractions 0–1, from cite-roi) to Image API pixel regions.
 */
import type { Roi } from "cite-roi";
import type { ImageService } from "./manifest.ts";

export interface Size { w: number; h: number }

/** Full size: "full" in Image API 2, "max" in 3. */
export const fullSize = (svc: ImageService) => (svc.version === 3 ? "max" : "full");

/** Size parameter for a target width and/or height (keeps aspect ratio when one is omitted). */
export function sizeParam(svc: ImageService, w?: number, h?: number): string {
  if (!w && !h) return fullSize(svc);
  const p = (v?: number) => (v ? String(Math.max(1, Math.round(v))) : "");
  return `${p(w)},${p(h)}`;
}

export function imageUrl(
  svc: ImageService,
  opts: { region?: string; size?: string; rotation?: number; quality?: string; format?: string } = {},
): string {
  const { region = "full", size = fullSize(svc), rotation = 0, quality = "default", format = "jpg" } = opts;
  return `${svc.id}/${region}/${size}/${rotation}/${quality}.${format}`;
}

export const infoUrl = (svc: ImageService) => `${svc.id}/info.json`;

export const thumbnailUrl = (svc: ImageService, width = 150) => imageUrl(svc, { size: sizeParam(svc, width) });

/**
 * A region of interest as an Image API pixel region "x,y,w,h" on an image of the given size.
 * Use the size from the image's info.json (canvas size can differ). Edges are rounded
 * to the nearest pixel and kept inside the image; width and height are at least 1.
 */
export function roiRegion(r: Roi, img: Size): string {
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  const x0 = clamp(Math.round(r.x * img.w), img.w - 1);
  const y0 = clamp(Math.round(r.y * img.h), img.h - 1);
  const x1 = clamp(Math.round((r.x + r.w) * img.w), img.w);
  const y1 = clamp(Math.round((r.y + r.h) * img.h), img.h);
  return [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)].join(",");
}

/** URL for just the region of interest, optionally scaled to a maximum width. */
export function roiImageUrl(svc: ImageService, r: Roi, img: Size, maxWidth?: number): string {
  const region = roiRegion(r, img);
  const regionW = Number(region.split(",")[2]);
  const size = maxWidth && regionW > maxWidth ? sizeParam(svc, maxWidth) : fullSize(svc);
  return imageUrl(svc, { region, size });
}

/** Image size from a decoded info.json (2.x uses "@id", 3.0 "id"; both give width/height). */
export function infoSize(info: unknown): Size | null {
  if (typeof info !== "object" || info === null) return null;
  const { width, height } = info as { width?: unknown; height?: unknown };
  const w = Number(width), h = Number(height);
  return w > 0 && h > 0 ? { w, h } : null;
}
