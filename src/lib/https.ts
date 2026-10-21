/**
 * A page served over https may not fetch http URLs (mixed content: fetches are blocked
 * outright; images are upgraded or blocked depending on the browser). Many IIIF servers
 * list http URLs but also answer on https (e.g. HMT), so on an https page every http URL
 * is requested over https instead. Pure.
 */
import type { CanvasInfo, ImageService, ManifestInfo } from "./manifest.ts";

export const toHttps = (url: string): string => (url.startsWith("http://") ? `https://${url.slice(7)}` : url);

/** http → https when the page is https; otherwise unchanged. */
export const forPage = (url: string, pageIsHttps: boolean): string => (pageIsHttps ? toHttps(url) : url);

/** The manifest with every image URL (services, images, thumbnails) on https. */
export function manifestForPage(m: ManifestInfo, pageIsHttps: boolean): ManifestInfo {
  if (!pageIsHttps) return m;
  const svc = (s: ImageService | null) => (s ? { ...s, id: toHttps(s.id) } : null);
  const up = (u: string | null) => (u ? toHttps(u) : null);
  const canvas = (c: CanvasInfo): CanvasInfo => ({ ...c, service: svc(c.service), imageUrl: up(c.imageUrl), thumbnail: up(c.thumbnail) });
  return { ...m, canvases: m.canvases.map(canvas) };
}

/** Origins ("http://host") of the http image URLs in a manifest. */
export function httpOrigins(m: ManifestInfo): Set<string> {
  const out = new Set<string>();
  const add = (u: string | null | undefined) => {
    if (!u?.startsWith("http://")) return;
    try { out.add(new URL(u).origin); } catch { /* not a URL */ }
  };
  for (const c of m.canvases) { add(c.service?.id); add(c.imageUrl); add(c.thumbnail); }
  return out;
}

/** Thrown when an http URL, requested over https because the page is https, can't be reached. */
export class HttpsUpgradeError extends Error {
  constructor(readonly originalUrl: string) {
    super(`Could not reach ${toHttps(originalUrl)}. The server lists only http (${originalUrl}), and this page is ` +
      "served over https, so the browser won't load it over http. Open iiif-cite from a local file or an http address instead.");
    this.name = "HttpsUpgradeError";
  }
}
