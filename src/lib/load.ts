/**
 * Fetch a manifest or a URN map, turning network/HTTP/JSON failures into readable messages.
 * `fetchFn` is injectable for tests.
 */
import { parseManifest, type ManifestInfo } from "./manifest.ts";
import { parseUrnMap, type UrnMap } from "./urn-map.ts";
import type { ImageService } from "./manifest.ts";
import { infoUrl } from "./image-api.ts";
import { parseImageInfo, type ImageInfo } from "./tiles.ts";

export type Fetch = (url: string) => Promise<Response>;

async function get(url: string, fetchFn: Fetch): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url);
  } catch {
    // fetch() rejects with an opaque TypeError for DNS, offline and CORS failures alike.
    throw new Error(`Could not reach ${url} (network error, or the server does not allow cross-origin requests)`);
  }
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
  return res;
}

export async function loadManifest(url: string, fetchFn: Fetch): Promise<ManifestInfo> {
  const res = await get(url, fetchFn);
  let json: unknown;
  try {
    json = JSON.parse(await res.text());
  } catch {
    throw new Error(`${url}: not JSON`);
  }
  return parseManifest(json);
}

export async function loadUrnMapUrl(url: string, fetchFn: Fetch): Promise<UrnMap> {
  return parseUrnMap(await (await get(url, fetchFn)).text());
}

/** Fetch and read a service's info.json. */
export async function loadImageInfo(svc: ImageService, fetchFn: Fetch): Promise<ImageInfo> {
  const url = infoUrl(svc);
  const res = await get(url, fetchFn);
  let json: unknown;
  try { json = JSON.parse(await res.text()); } catch { throw new Error(`${url}: not JSON`); }
  return parseImageInfo(json, svc);
}
