// Copied unchanged from imageviewer/src/lib/zoom.ts (candidate for sharing via cite-roi).
/**
 * Pure zoom/pan math for the single-photo view. The image is drawn at its natural
 * size with `transform: translate(x, y) scale(scale)` (origin top-left) inside a
 * stage of size w × h. Everything here is in stage pixels.
 */
export interface Size { w: number; h: number }
export interface View { scale: number; x: number; y: number }

/** Largest zoom: this many times the image's natural (100%) size. */
export const MAX_ZOOM = 4;

/** Scale that fits the whole image in the stage, never enlarging past 100%. */
export function fitScale(stage: Size, img: Size): number {
  if (img.w <= 0 || img.h <= 0 || stage.w <= 0 || stage.h <= 0) return 1;
  return Math.min(stage.w / img.w, stage.h / img.h, 1);
}

export function scaleLimits(stage: Size, img: Size): { min: number; max: number } {
  const min = fitScale(stage, img);
  return { min, max: Math.max(MAX_ZOOM, min) };
}

/** Center an image that is smaller than the stage; otherwise keep its edges outside the stage. */
export function clampView(v: View, stage: Size, img: Size): View {
  const axis = (pos: number, shown: number, room: number) =>
    shown <= room ? (room - shown) / 2 : Math.min(0, Math.max(room - shown, pos));
  return {
    scale: v.scale,
    x: axis(v.x, img.w * v.scale, stage.w),
    y: axis(v.y, img.h * v.scale, stage.h),
  };
}

export function fitView(stage: Size, img: Size): View {
  return clampView({ scale: fitScale(stage, img), x: 0, y: 0 }, stage, img);
}

/** Zoom by `factor`, keeping the image point under stage point (px, py) fixed. */
export function zoomAt(v: View, factor: number, px: number, py: number, stage: Size, img: Size): View {
  const { min, max } = scaleLimits(stage, img);
  const scale = Math.min(max, Math.max(min, v.scale * factor));
  const k = scale / v.scale;
  return clampView({ scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, stage, img);
}

export function panBy(v: View, dx: number, dy: number, stage: Size, img: Size): View {
  return clampView({ ...v, x: v.x + dx, y: v.y + dy }, stage, img);
}

export function isZoomed(v: View, stage: Size, img: Size): boolean {
  return v.scale > fitScale(stage, img) * 1.001;
}

/**
 * Double-click/tap: zoomed in → back to fit; at fit → 100% (or 2× fit for images
 * that are already shown at full size), centered on the clicked point.
 */
export function toggleZoom(v: View, px: number, py: number, stage: Size, img: Size): View {
  if (isZoomed(v, stage, img)) return fitView(stage, img);
  const fit = fitScale(stage, img);
  const target = fit < 1 ? 1 : 2 * fit;
  return zoomAt(v, target / v.scale, px, py, stage, img);
}

/** Wheel delta → zoom factor. Trackpad pinches arrive as wheel events with ctrlKey. */
export function wheelFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-px * (ctrlKey ? 0.01 : 0.002));
}
