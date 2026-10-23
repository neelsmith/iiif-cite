// @ts-check
/**
 * Configuration of a packaged project page: a title and a list of collections (a IIIF
 * manifest + URN map, or an image catalog). Plain JavaScript (with JSDoc types) so both the app and the Node packaging script
 * (scripts/package.mjs) can use it without a build step. Pure.
 *
 *   {
 *     "title": "Complutensian Bible",
 *     "collections": [
 *       { "label": "Volume 1", "manifest": "https://…/v1-manifest.json", "urns": "https://…/vol1-urns.cex" },
 *       { "label": "Photographs", "catalog": "https://…/images/photos.cex", "thumbnails": true }
 *     ],
 *     "default": "Volume 1"
 *   }
 *
 * Each collection has either `manifest` (with an optional `urns`) or `catalog` (with an optional
 * `thumbnails`, default false). `default` (a collection's label or 0-based index) defaults to
 * the first.
 */

/**
 * @typedef {{ label: string, manifest: string | null, urns: string | null, catalog: string | null, thumbnails: boolean }} Collection
 */
/** @typedef {{ title: string, collections: Collection[], defaultIndex: number }} ProjectConfig */

/** Id of the JSON <script> block in iiif-cite.html that a packaged page fills in. */
export const CONFIG_ELEMENT_ID = "iiif-cite-config";

/** @param {unknown} v */
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** @param {unknown} v */
const isUrl = (v) => typeof v === "string" && /^https?:\/\/\S+$/.test(v);

/**
 * Check a decoded configuration. Returns the normalized config, or the problems found.
 * @param {unknown} json
 * @returns {{ config: ProjectConfig, errors: [] } | { config: null, errors: string[] }}
 */
export function validateConfig(json) {
  /** @type {string[]} */
  const errors = [];
  if (!isObj(json)) return { config: null, errors: ["configuration must be a JSON object"] };
  const o = /** @type {Record<string, unknown>} */ (json);
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!title) errors.push('"title" must be a non-empty string');
  /** @type {Collection[]} */
  const collections = [];
  if (!Array.isArray(o.collections) || o.collections.length === 0) {
    errors.push('"collections" must be a non-empty list');
  } else {
    o.collections.forEach((c, i) => {
      const where = `collection ${i + 1}`;
      if (!isObj(c)) { errors.push(`${where}: must be an object`); return; }
      const r = /** @type {Record<string, unknown>} */ (c);
      const label = typeof r.label === "string" ? r.label.trim() : "";
      if (!label) errors.push(`${where}: "label" must be a non-empty string`);
      else if (collections.some((x) => x.label === label)) errors.push(`${where}: label "${label}" is used twice`);
      const given = (/** @type {string} */ k) => r[k] !== undefined && r[k] !== null && r[k] !== "";
      if (given("catalog")) {
        if (given("manifest")) errors.push(`${where}: give either "manifest" or "catalog", not both`);
        if (!isUrl(r.catalog)) errors.push(`${where}: "catalog" must be an http(s) URL`);
        if (given("urns")) errors.push(`${where}: "urns" is for manifests (a catalog has its own URNs)`);
        if (r.thumbnails !== undefined && typeof r.thumbnails !== "boolean") errors.push(`${where}: "thumbnails" must be true or false`);
      } else {
        if (!isUrl(r.manifest)) errors.push(`${where}: "manifest" (or "catalog") must be an http(s) URL`);
        if (given("urns") && !isUrl(r.urns)) errors.push(`${where}: "urns" must be an http(s) URL`);
        if (given("thumbnails")) errors.push(`${where}: "thumbnails" is for catalogs`);
      }
      const known = new Set(["label", "manifest", "urns", "catalog", "thumbnails"]);
      for (const k of Object.keys(r)) if (!known.has(k)) errors.push(`${where}: unknown setting "${k}"`);
      collections.push(given("catalog")
        ? { label, manifest: null, urns: null, catalog: String(r.catalog), thumbnails: r.thumbnails === true }
        : { label, manifest: String(r.manifest ?? ""), urns: isUrl(r.urns) ? /** @type {string} */ (r.urns) : null, catalog: null, thumbnails: false });
    });
  }
  let defaultIndex = 0;
  if (o.default !== undefined) {
    const d = o.default;
    const i = typeof d === "number" ? d : collections.findIndex((c) => c.label === d);
    if (!Number.isInteger(i) || i < 0 || i >= collections.length) errors.push(`"default" names no collection: ${JSON.stringify(d)}`);
    else defaultIndex = i;
  }
  const known = new Set(["title", "collections", "default"]);
  for (const k of Object.keys(o)) if (!known.has(k)) errors.push(`unknown setting "${k}"`);
  return errors.length ? { config: null, errors } : { config: { title, collections, defaultIndex }, errors: [] };
}

/**
 * Read the configuration block of a page: null when it is empty (the generic iiif-cite).
 * @param {string | null | undefined} text
 * @returns {{ config: ProjectConfig | null, errors: string[] }}
 */
export function readConfigText(text) {
  if (!text || !text.trim()) return { config: null, errors: [] };
  let json;
  try { json = JSON.parse(text); } catch (e) { return { config: null, errors: [`configuration is not valid JSON: ${/** @type {Error} */ (e).message}`] }; }
  return validateConfig(json);
}
