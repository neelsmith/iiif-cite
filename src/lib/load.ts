/**
 * Fetch a manifest or a URN map, turning network/HTTP/JSON failures into readable messages.
 * `fetchFn` is injectable for tests.
 */
import { parseManifest, type ManifestInfo } from "./manifest.ts";
import { parseUrnMap, type UrnMap } from "./urn-map.ts";
import type { ImageService } from "./manifest.ts";
import { infoUrl } from "./image-api.ts";
import { parseImageInfo, type ImageInfo } from "./tiles.ts";
import { HttpsUpgradeError } from "./https.ts";
import { looksLikeCatalog, parseCatalog, type CatalogInfo } from "./catalog.ts";

export type Fetch = (url: string) => Promise<Response>;

async function get(url: string, fetchFn: Fetch): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url);
  } catch (err) {
    if (err instanceof HttpsUpgradeError) throw err;
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

export type Source = { kind: "manifest"; manifest: ManifestInfo } | { kind: "catalog"; catalog: CatalogInfo };

/**
 * Fetch a IIIF manifest or an image catalog, telling them apart by content: JSON is a
 * manifest; delimited text with a `path` column is a catalog (images relative to `url`).
 */
export async function loadSource(url: string, fetchFn: Fetch, thumbs: boolean): Promise<Source> {
  const text = await (await get(url, fetchFn)).text();
  let json: unknown;
  try { json = JSON.parse(text); } catch {
    if (looksLikeCatalog(text)) return { kind: "catalog", catalog: parseCatalog(text, url, thumbs) };
    throw new Error(`${url}: neither a IIIF manifest (JSON) nor an image catalog (delimited text with a "path" column)`);
  }
  return { kind: "manifest", manifest: parseManifest(json) };
}
