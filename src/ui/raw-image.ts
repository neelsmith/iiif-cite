/**
 * Getting image data in the browser: the whole file, or a region cut out at full resolution.
 *   - a catalog image: fetched (needs Access-Control-Allow-Origin on the image server), and a
 *     region cropped here on a canvas → PNG;
 *   - a IIIF image: the IIIF server cuts the region (full resolution).
 * Fetched with CORS rather than taken from the viewer's <img>, so the canvas isn't "tainted".
 */
import type { Roi } from "cite-roi";
import type { CanvasInfo } from "../lib/manifest.ts";
import { imageUrl, roiImageUrl } from "../lib/image-api.ts";
import { loadImageInfo, type Fetch } from "../lib/load.ts";
import { extFor, pixelRegion, rawFileName } from "../lib/raw.ts";

/** Browser operations, replaceable in tests (jsdom has no canvas). */
export interface ImageTools {
  /** The bytes at a URL, as fetched. */
  fetchBlob(url: string): Promise<Blob>;
  /** A region (fractions of the image) of an image file, cut out at full resolution, as PNG. */
  crop(blob: Blob, roi: Roi): Promise<Blob>;
}

export function browserImageTools(fetchFn: Fetch): ImageTools {
  return {
    async fetchBlob(url) {
      let res: Response;
      try { res = await fetchFn(url); } catch (err) {
        if (err instanceof Error && err.name === "HttpsUpgradeError") throw err;
        throw new Error(`Can't download ${url}: its server doesn't allow it from other sites ` +
          "(it must send Access-Control-Allow-Origin for images), or it can't be reached.");
      }
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return res.blob();
    },
    async crop(blob, roi) {
      const whole = await createImageBitmap(blob);
      const r = pixelRegion(roi, { w: whole.width, h: whole.height });
      const canvas = document.createElement("canvas");
      canvas.width = r.w; canvas.height = r.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser can't crop images (no canvas)");
      ctx.drawImage(whole, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      whole.close();
      return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't make the PNG"))), "image/png"));
    },
  };
}

export interface ImageData { blob: Blob; name: string }

/** The whole image (roi null) or one region of a canvas's image, with a file name. */
export async function imageData(c: CanvasInfo, roi: Roi | null, urn: string | null, tools: ImageTools, fetchFn: Fetch): Promise<ImageData> {
  if (c.service) {
    let url = imageUrl(c.service);
    if (roi) url = roiImageUrl(c.service, roi, (await loadImageInfo(c.service, fetchFn)).size);
    const blob = await tools.fetchBlob(url);
    return { blob, name: rawFileName({ urn, imageUrl: c.service.id, label: c.label, roi, ext: extFor(blob.type) }) };
  }
  if (!c.imageUrl) throw new Error("This image has no file to download");
  const file = await tools.fetchBlob(c.imageUrl);
  if (!roi) return { blob: file, name: rawFileName({ urn, imageUrl: c.imageUrl, label: c.label, roi: null, ext: extFor(file.type), keepFileName: true }) };
  return { blob: await tools.crop(file, roi), name: rawFileName({ urn, imageUrl: c.imageUrl, label: c.label, roi, ext: "png" }) };
}

/** Save a blob as a file (same-origin object URL, so the name is honoured). */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
