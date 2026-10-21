/**
 * Read a IIIF Presentation manifest (API 2.x or 3.0) into a flat list of canvases,
 * each with the IIIF Image API service that can deliver its image.
 * Pure functions: no fetching, no DOM.
 */

export interface ImageService {
  /** Base URI of the service (no trailing slash, no "/info.json"). */
  id: string;
  /** Image API major version. */
  version: 2 | 3;
  /** Compliance level as reported in the manifest (e.g. "level2"), if any. */
  profile?: string;
}

export interface CanvasInfo {
  id: string;
  label: string;
  /** Canvas size from the manifest. The image's own size (from info.json) may differ. */
  width: number;
  height: number;
  /** Image API service for the canvas's painted image; null if the image is a static file. */
  service: ImageService | null;
  /** The painted image resource itself (a static file, or a full-size request on the service). */
  imageUrl: string | null;
  /** Thumbnail given in the manifest, if any. */
  thumbnail: string | null;
}

export interface ManifestInfo {
  id: string;
  label: string;
  /** Presentation API major version. */
  version: 2 | 3;
  canvases: CanvasInfo[];
  /** Human-readable problems; never fatal. */
  errors: string[];
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const idOf = (o: Json): string => String(o.id ?? o["@id"] ?? "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/**
 * Text of a label in either API version:
 * v2: "string" | { "@value": "…", "@language": "en" } | an array of those;
 * v3: language map { "en": ["…"], "none": ["…"] }.
 */
export function labelText(label: unknown, lang = "en"): string {
  if (label === undefined || label === null) return "";
  if (typeof label === "string" || typeof label === "number") return String(label).trim();
  if (Array.isArray(label)) {
    const items: Json[] = label.map((l) => (isObj(l) ? l : { "@value": l }));
    const pick = items.find((l) => l["@language"] === lang) ?? items[0];
    return pick ? labelText(pick["@value"], lang) : "";
  }
  if (isObj(label)) {
    if ("@value" in label) return labelText(label["@value"], lang);
    const values = label[lang] ?? label.none ?? Object.values(label)[0];
    return asArray(values).map((v) => labelText(v, lang)).join(" ");
  }
  return "";
}

/** Normalize a service base URI: drop "/info.json" and trailing slashes. */
export function serviceBase(id: string): string {
  return id.replace(/\/info\.json$/, "").replace(/\/+$/, "");
}

function serviceVersion(s: Json, fallback: 2 | 3): 2 | 3 {
  const type = String(s.type ?? s["@type"] ?? "");
  if (type === "ImageService3") return 3;
  if (type === "ImageService2" || type === "iiif:ImageService") return 2;
  const ctx = asArray(s["@context"]).map(String).join(" ");
  if (ctx.includes("/image/3/")) return 3;
  if (ctx.includes("/image/2/")) return 2;
  const profile = asArray(s.profile).filter((p) => typeof p === "string").join(" ");
  if (profile.includes("/image/2/")) return 2;
  return fallback;
}

/** The first IIIF Image API service among a resource's services, if any. */
export function findImageService(resource: unknown, fallback: 2 | 3): ImageService | null {
  if (!isObj(resource)) return null;
  for (const s of asArray(resource.service)) {
    if (!isObj(s)) continue;
    const type = String(s.type ?? s["@type"] ?? "");
    const ctx = asArray(s["@context"]).map(String).join(" ");
    const profile = asArray(s.profile).filter((p) => typeof p === "string").join(" ");
    const looksLikeImage =
      type.startsWith("ImageService") || type === "iiif:ImageService" ||
      ctx.includes("iiif.io/api/image") || profile.includes("iiif.io/api/image") || /^level[012]$/.test(profile);
    const id = idOf(s);
    if (!looksLikeImage || !id) continue;
    const p = asArray(s.profile).find((x) => typeof x === "string") as string | undefined;
    return { id: serviceBase(id), version: serviceVersion(s, fallback), ...(p ? { profile: p.replace(/^.*\/(level[012])\.json$/, "$1") } : {}) };
  }
  return null;
}

function thumbnailOf(o: Json): string | null {
  const t = asArray(o.thumbnail)[0];
  if (typeof t === "string") return t;
  if (isObj(t)) return idOf(t) || null;
  return null;
}

/** v3 painting body may be a Choice; take its first item. */
function firstBody(body: unknown): Json | null {
  const b = asArray(body)[0];
  if (!isObj(b)) return null;
  if (b.type === "Choice" || b["@type"] === "oa:Choice") {
    const first = asArray(b.items ?? b.default)[0];
    return isObj(first) ? first : null;
  }
  return b;
}

function canvasV2(c: Json, errors: string[]): CanvasInfo {
  const anno = asArray(c.images).find(isObj) as Json | undefined;
  const res = anno ? firstBody(anno.resource) : null;
  return finishCanvas(c, res, anno ?? null, 2, errors);
}

function canvasV3(c: Json, errors: string[]): CanvasInfo {
  let res: Json | null = null, annotation: Json | null = null;
  for (const page of asArray(c.items)) {
    if (!isObj(page)) continue;
    const anno = asArray(page.items).find((a) => isObj(a) && (a.motivation === undefined || asArray(a.motivation).includes("painting")));
    if (isObj(anno)) { annotation = anno; res = firstBody(anno.body); break; }
  }
  return finishCanvas(c, res, annotation, 3, errors);
}

function finishCanvas(c: Json, res: Json | null, anno: Json | null, version: 2 | 3, errors: string[]): CanvasInfo {
  const id = idOf(c);
  const label = labelText(c.label) || id;
  const width = num(c.width), height = num(c.height);
  if (!width || !height) errors.push(`canvas ${label}: missing width or height`);
  // The spec puts the service on the image; some manifests (e.g. HMT's Venetus A) put it on
  // the painting annotation instead, so look there too.
  const service = res ? findImageService(res, version) ?? findImageService(anno, version) : null;
  if (!res) errors.push(`canvas ${label}: no painted image`);
  else if (!service) errors.push(`canvas ${label}: image has no IIIF Image API service (static image only)`);
  return {
    id, label, width, height, service,
    imageUrl: res ? idOf(res) || null : null,
    thumbnail: thumbnailOf(c),
  };
}

/** Parse a manifest (already decoded from JSON). Throws only if it is not a manifest at all. */
export function parseManifest(json: unknown): ManifestInfo {
  if (!isObj(json)) throw new Error("Not a IIIF manifest: expected a JSON object");
  const type = String(json.type ?? json["@type"] ?? "");
  const errors: string[] = [];
  if (type === "Manifest") {
    const canvases = asArray(json.items).filter((c) => isObj(c) && c.type === "Canvas") as Json[];
    if (!canvases.length) errors.push("manifest has no canvases");
    return { id: idOf(json), label: labelText(json.label), version: 3, canvases: canvases.map((c) => canvasV3(c, errors)), errors };
  }
  if (type === "sc:Manifest") {
    const seq = asArray(json.sequences).find(isObj) as Json | undefined;
    const canvases = asArray(seq?.canvases).filter(isObj) as Json[];
    if (!canvases.length) errors.push("manifest has no canvases");
    return { id: idOf(json), label: labelText(json.label), version: 2, canvases: canvases.map((c) => canvasV2(c, errors)), errors };
  }
  if (type === "Collection" || type === "sc:Collection") {
    throw new Error("This is a IIIF collection, not a manifest; choose one of its manifests");
  }
  throw new Error(`Not a IIIF manifest (type "${type || "missing"}")`);
}
