/**
 * Grouping and filtering a catalog's images in the grid (after imageviewer's lib/group.ts):
 * group by nothing (catalog order) or by tag (an image with several tags is in several
 * groups), the optional year/place columns as drop-downs, and a text filter. Pure.
 */
import type { CanvasInfo } from "./manifest.ts";
import type { CatalogEntry, CatalogInfo } from "./catalog.ts";

export type GroupMode = "none" | "tag";
export const GROUP_MODES: { mode: GroupMode; label: string }[] = [
  { mode: "none", label: "Catalog order" },
  { mode: "tag", label: "Tag" },
];

export type Facet = "year" | "place";

export interface BrowseOptions {
  group: GroupMode;
  query: string;
  /** Exact year / place to keep; "" = any. */
  year: string;
  place: string;
}

export interface ImageGroup {
  key: string;
  /** "" for the single group of "Catalog order" (no heading). */
  label: string;
  canvases: CanvasInfo[];
}

export interface Browse {
  groups: ImageGroup[];
  /** Images shown, each once, in the order shown (for previous/next). */
  order: CanvasInfo[];
}

/** Distinct non-empty values of a column, sorted (numbers in numeric order). */
export function facetValues(cat: CatalogInfo, facet: Facet): string[] {
  const vals = new Set([...cat.entries.values()].map((e) => e[facet].trim()).filter(Boolean));
  return [...vals].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

/** Case-insensitive: every word of the query in caption, path, credits, license, tags, year, place or URN. */
export function matches(e: CatalogEntry, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = [e.caption, e.path, e.credits, e.license, e.tags.join(" "), e.year, e.place, e.urn].join(" ").toLowerCase();
  return terms.every((t) => hay.includes(t));
}

const NONE = "￿"; // sorts last

export function browse(cat: CatalogInfo, o: BrowseOptions): Browse {
  const kept = cat.manifest.canvases.filter((c) => {
    const e = cat.entries.get(c.id)!;
    return (!o.year || e.year.trim() === o.year) && (!o.place || e.place.trim() === o.place) && matches(e, o.query);
  });
  if (o.group === "none") return { groups: kept.length ? [{ key: "", label: "", canvases: kept }] : [], order: kept };
  const groups = new Map<string, ImageGroup>();
  const add = (key: string, label: string, c: CanvasInfo) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, label, canvases: [] }));
    g.canvases.push(c);
  };
  for (const c of kept) {
    const tags = cat.entries.get(c.id)!.tags;
    if (tags.length) for (const t of tags) add(t.toLowerCase(), t, c);
    else add(NONE, "Untagged", c);
  }
  const list = [...groups.values()].sort((a, b) => (a.key === NONE ? 1 : b.key === NONE ? -1 : a.key.localeCompare(b.key)));
  const seen = new Set<string>();
  const order = list.flatMap((g) => g.canvases).filter((c) => !seen.has(c.id) && !!seen.add(c.id));
  return { groups: list, order };
}
