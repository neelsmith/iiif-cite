/**
 * Raw image data for a cited image or region: names and pixel regions. Pure.
 * (Fetching and cropping are in ui/raw-image.ts; the raw=true page in ui/raw-view.ts.)
 */
import { formatRoi, type Roi } from "cite-roi";
import { roiRegion, type Size } from "./image-api.ts";
import { lastPart } from "./urn-rules.ts";

export interface PixelRegion { x: number; y: number; w: number; h: number }

/** A region in whole pixels of an image of the given size (same rounding as IIIF region URLs). */
export function pixelRegion(r: Roi, size: Size): PixelRegion {
  const [x, y, w, h] = roiRegion(r, size).split(",").map(Number);
  return { x, y, w, h };
}

/** raw=true / raw=1 in a link. */
export const isRawParam = (v: string | null | undefined): boolean => v === "true" || v === "1";

/** A file-name stem: letters, digits, "." "_" "-" (the "@x,y,w,h" suffix is added after). */
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");

/** File extension for a downloaded image's media type. */
export function extFor(type: string, fallback = "jpg"): string {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/tiff": "tif" } as Record<string, string>)[type.split(";")[0].trim()] ?? fallback;
}

/**
 * Name for a downloaded image: the URN's object id (else the image's file name or label),
 * with "@x,y,w,h" for a region. A whole catalog file keeps its own name.
 *   IMG_1203.jpeg · IMG_1203@0.4187,0.3937,0.1598,0.0182.png · VA001RN_0002.jpg
 */
export function rawFileName(o: { urn: string | null; imageUrl: string | null; label: string; roi: Roi | null; ext: string; keepFileName?: boolean }): string {
  // last path part, then any query/fragment after it dropped (iipsrv ids are "…/iipsrv?IIIF=/…/x.tif")
  const file = o.imageUrl ? decodeURIComponent(lastPart(o.imageUrl).split(/[?#]/)[0]) : "";
  if (!o.roi && o.keepFileName && file) return safe(file);
  const stem = (o.urn ? o.urn.split("@")[0].split(":").pop()! : "") || file.replace(/\.[A-Za-z0-9]+$/, "") || o.label;
  return `${safe(stem) || "image"}${o.roi ? `@${formatRoi(o.roi)}` : ""}.${o.ext}`;
}
