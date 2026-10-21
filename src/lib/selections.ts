/**
 * Regions selected on canvases, and the texts made from them. Pure.
 * A region is kept as fractions of the image (cite-roi), so it can be cited as
 *   - plain `x,y,w,h`,
 *   - a CITE2 URN `urn@x,y,w,h` (when the canvas has a URN in the URN map),
 *   - a IIIF Image API URL for just that region (needs the image's full size from info.json).
 */
import { formatRoi, roiUrn, type Roi } from "cite-roi";
import type { CanvasInfo } from "./manifest.ts";
import { roiImageUrl, type Size } from "./image-api.ts";

export interface CanvasSelections {
  manifestUrl: string;
  canvas: CanvasInfo;
  rois: Roi[];
  /** Full-resolution image size (from info.json); null for a static image not yet measured. */
  imageSize: Size | null;
}

/** Width the region image links are scaled down to (if wider). */
export const REGION_IMAGE_WIDTH = 1200;

export function regionImageUrl(s: Pick<CanvasSelections, "canvas" | "imageSize">, r: Roi, maxWidth = REGION_IMAGE_WIDTH): string | null {
  return s.canvas.service && s.imageSize ? roiImageUrl(s.canvas.service, r, s.imageSize, maxWidth) : null;
}

/** Key for the per-page store: one entry per canvas of each manifest. */
export const selectionKey = (manifestUrl: string, canvasId: string) => `${manifestUrl}\u0000${canvasId}`;

/**
 * Text for "Export selections" (as in imageviewer): one CITE2 URN per region, one per line;
 * regions on canvases without a URN follow as `// <canvas id>@x,y,w,h` comments.
 */
export function selectionsText(entries: Pick<CanvasSelections, "canvas" | "rois">[], urnFor: (c: CanvasInfo) => string | null): string {
  const lines: string[] = [];
  const noUrn: string[] = [];
  for (const { canvas, rois } of entries) {
    const urn = urnFor(canvas);
    for (const r of rois) (urn ? lines : noUrn).push(urn ? roiUrn(urn, r) : `// ${canvas.id}@${formatRoi(r)}`);
  }
  if (noUrn.length) lines.push("// Canvases without a URN (add them to the URN map):", ...noUrn);
  return lines.join("\n") + "\n";
}

/** File-name stem from a manifest label or URL: "Venetus A manuscript" → "venetus-a-manuscript". */
export function fileStem(label: string, fallback = "selections"): string {
  const s = label.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return s || fallback;
}
