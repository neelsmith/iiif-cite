/**
 * Draft a URN map for a manifest: a collection URN plus a rule that gives each canvas an
 * object id, with hand edits on top. Pure; the UI is ui/urn-mapper.ts.
 */
import type { CanvasInfo } from "./manifest.ts";
import { CITE2_OBJECT, canvasImageId, imageKey, urnForCanvas, type UrnMap } from "./urn-map.ts";

export type RuleKind = "file" | "canvas" | "label" | "number" | "pattern";

export interface UrnRule {
  /** Collection URN ending in ":", e.g. "urn:cite2:hmt:vaimg.2017a:". */
  collection: string;
  kind: RuleKind;
  /** number: object id = prefix + counter, zero-padded to `pad` digits, starting at `start`. */
  prefix: string;
  start: number;
  pad: number;
  /** pattern: regular expression tried on the image id; the first group (or the whole match) is the id. */
  pattern: string;
}

export const RULE_KINDS: { kind: RuleKind; label: string }[] = [
  { kind: "file", label: "Image file name" },
  { kind: "canvas", label: "End of canvas id" },
  { kind: "label", label: "Canvas label" },
  { kind: "number", label: "Numbers in order" },
  { kind: "pattern", label: "Pattern on image id" },
];

export const defaultRule = (): UrnRule =>
  ({ collection: "", kind: "file", prefix: "", start: 1, pad: 3, pattern: "" });

/** Hand edits: canvas id → URN ("" = deliberately none), and where numbering restarts. */
export interface MapEdits {
  hand: Map<string, string>;
  /** canvas id → counter value given to that canvas (numbering continues from it). */
  restarts: Map<string, number>;
}
export const noEdits = (): MapEdits => ({ hand: new Map(), restarts: new Map() });

/** Why a collection URN won't do, or null. Namespace, collection, optional .version, final ":". */
export function collectionProblem(c: string): string | null {
  if (!c.trim()) return "Enter a collection URN, e.g. urn:cite2:hmt:vaimg.2017a:";
  if (!/^urn:cite2:/.test(c)) return "A collection URN starts with urn:cite2:";
  if (!/^urn:cite2:[^:@\s]+:[^:@\s.]+(\.[^:@\s.]+)?:$/.test(c)) return "Expected urn:cite2:namespace:collection.version: (ending with a colon)";
  return null;
}

/** Generic clean-up for object ids: letters, digits, ".", "_" and "-" only; accents dropped. */
export function cleanId(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "").replace(/^[._-]+|[._-]+$/g, "");
}

/** Last part of an id (after the last "/"), e.g. iipsrv "…?IIIF=/a/VA001RN_0002.tif" → "VA001RN_0002.tif". */
export const lastPart = (id: string): string => id.replace(/\/+$/, "").split("/").pop() ?? id;
const IMAGE_EXT = /\.(tiff?|ptif|jp2|jpe?g|png|gif|webp)$/i;

/** Object id the rule gives one canvas (before clean-up); `n` is its counter value. */
function rawId(c: CanvasInfo, rule: UrnRule, n: number): string {
  const img = canvasImageId(c) ?? "";
  switch (rule.kind) {
    case "file": return lastPart(img).replace(IMAGE_EXT, "");
    case "canvas": return lastPart(c.id);
    case "label": return c.label;
    case "number": return rule.prefix + String(n).padStart(Math.max(0, rule.pad), "0");
    case "pattern": {
      if (!rule.pattern) return "";
      let re: RegExp;
      try { re = new RegExp(rule.pattern); } catch { return ""; }
      const m = img.match(re);
      return m ? m[1] ?? m[0] : "";
    }
  }
}

export interface Draft {
  urn: string | null;
  /** Where the URN came from: the rule, a hand edit, or the loaded URN map (kept). */
  from: "rule" | "hand" | "map";
  /** Counter value at this canvas (numbering rule). */
  n: number;
  /**
   * none: no URN; invalid: not a CITE2 object URN; duplicate: the same URN on different images;
   * conflict: an image shown on an earlier canvas too, but given a different URN here
   * (a map holds one URN per image — the earlier canvas's is the one written).
   */
  problem: null | "none" | "invalid" | "duplicate" | "conflict";
}

/**
 * URNs for every canvas. Hand edits win; then, with `keepExisting`, URNs already in the
 * loaded map; then the rule. Numbering counts every canvas in order, restarting where set.
 * Two different images with the same URN are both flagged as duplicates. An image that appears
 * on several canvases gets the URN of its first canvas from the rule (a hand edit that differs
 * is flagged as a conflict).
 */
export function draftUrns(canvases: CanvasInfo[], rule: UrnRule, edits: MapEdits, existing: UrnMap | null = null, keepExisting = false): Draft[] {
  const collectionOk = collectionProblem(rule.collection) === null;
  let n = rule.start;
  const keyOf = (c: CanvasInfo) => imageKey(canvasImageId(c) ?? c.id);
  const firstUrn = new Map<string, string | null>(); // image key → URN at its first canvas
  const drafts: Draft[] = canvases.map((c) => {
    if (edits.restarts.has(c.id)) n = edits.restarts.get(c.id)!;
    const here = n++;
    let urn: string | null, from: Draft["from"];
    if (edits.hand.has(c.id)) { urn = edits.hand.get(c.id) || null; from = "hand"; }
    else if (keepExisting && urnForCanvas(existing, c)) { urn = urnForCanvas(existing, c); from = "map"; }
    else if (firstUrn.has(keyOf(c))) { urn = firstUrn.get(keyOf(c))!; from = "rule"; } // repeated image
    else {
      const id = cleanId(rawId(c, rule, here));
      urn = collectionOk && id ? rule.collection + id : null;
      from = "rule";
    }
    const key = keyOf(c);
    const conflict = firstUrn.has(key) && firstUrn.get(key) !== urn;
    if (!firstUrn.has(key)) firstUrn.set(key, urn);
    const problem: Draft["problem"] = urn === null ? "none" : !CITE2_OBJECT.test(urn) ? "invalid" : conflict ? "conflict" : null;
    return { urn, from, n: here, problem };
  });
  // Duplicates: the same URN on different images (the same image on two canvases is fine).
  const images = new Map<string, Set<string>>();
  drafts.forEach((d, i) => {
    if (!d.urn || d.problem === "conflict") return;
    const key = keyOf(canvases[i]);
    if (!images.has(d.urn)) images.set(d.urn, new Set());
    images.get(d.urn)!.add(key);
  });
  for (const d of drafts) if (d.urn && !d.problem && images.get(d.urn)!.size > 1) d.problem = "duplicate";
  return drafts;
}

/** The map file: comments naming the manifest, then image|urn|label, one row per image. */
export function urnMapText(manifestLabel: string, manifestUrl: string, canvases: CanvasInfo[], drafts: Draft[]): string {
  const clean = (s: string) => s.replace(/[|\r\n]+/g, " ").trim();
  const lines = [`// URN map for ${clean(manifestLabel) || "manifest"}`, `// manifest: ${manifestUrl}`, "image|urn|label"];
  const seen = new Set<string>();
  canvases.forEach((c, i) => {
    const id = canvasImageId(c), urn = drafts[i]?.urn;
    if (!id || !urn) return;
    const key = imageKey(id);
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(`${id}|${urn}|${clean(c.label)}`);
  });
  return lines.join("\n") + "\n";
}
