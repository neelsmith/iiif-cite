/** Per-canvas helpers for the thumbnail grid. Pure. */
import type { CanvasInfo, ManifestInfo } from "./manifest.ts";
import { thumbnailUrl } from "./image-api.ts";
import type { UrnMap } from "./urn-map.ts";

/** Thumbnail width requested from Image API services (tiles show at ~150 CSS px; 2× for HiDPI). */
export const THUMB_WIDTH = 300;

/**
 * Thumbnail URLs to try in order: the Image API at THUMB_WIDTH, the manifest's own thumbnail,
 * then the full image. (Level-0 services may not support arbitrary sizes.)
 */
export function thumbCandidates(c: CanvasInfo): string[] {
  const urls = [c.service ? thumbnailUrl(c.service, THUMB_WIDTH) : null, c.thumbnail, c.imageUrl];
  return [...new Set(urls.filter((u): u is string => !!u))];
}

export interface UrnCoverage {
  /** Canvases that have a URN in the map. */
  withUrn: number;
  /** Map rows whose canvas id is not in this manifest (typos, or another manifest's rows). */
  unknownCanvases: string[];
}

export function urnCoverage(m: ManifestInfo, map: UrnMap): UrnCoverage {
  const ids = new Set(m.canvases.map((c) => c.id));
  return {
    withUrn: m.canvases.filter((c) => map.byCanvas.has(c.id)).length,
    unknownCanvases: [...map.byCanvas.keys()].filter((id) => !ids.has(id)),
  };
}
