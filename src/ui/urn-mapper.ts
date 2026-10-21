/**
 * "Map URNs" panel over the thumbnail grid: collection URN + rule (lib/urn-rules.ts), status,
 * and Download. The grid shows each canvas's draft URN (ui/app.ts) and lets you edit it by
 * hand. Nothing is saved in the browser: the map exists once downloaded.
 */
import type { CanvasInfo } from "../lib/manifest.ts";
import type { UrnMap } from "../lib/urn-map.ts";
import {
  collectionProblem, defaultRule, draftUrns, noEdits, RULE_KINDS, urnMapText,
  type Draft, type MapEdits, type RuleKind, type UrnRule,
} from "../lib/urn-rules.ts";
import { fileStem } from "../lib/selections.ts";
import { el } from "./dom.ts";

export interface UrnMapperOptions {
  /** Drafts changed: redraw the URNs under the thumbnails. */
  onChange: () => void;
  /** Download pressed: save `text` as `name` (and make it the active URN map). */
  onDownload: (text: string, name: string) => void;
  onDone: () => void;
}

export class UrnMapper {
  readonly el: HTMLElement;
  rule: UrnRule = defaultRule();
  edits: MapEdits = noEdits();
  keepExisting = true;
  drafts: Draft[] = [];
  /** Changed since the last download. */
  dirty = false;
  private canvases: CanvasInfo[] = [];
  private existing: UrnMap | null = null;
  private manifestLabel = "";
  private manifestUrl = "";
  private readonly status = el("p", { class: "map-status", role: "status" });
  private readonly collectionMsg = el("span", { class: "map-msg" });
  private readonly fields = el("span", { class: "map-fields" });
  private readonly keepRow = el("label", { class: "map-keep" });
  private readonly downloadBtn = el("button", { type: "button", class: "map-download" }, "Download map");

  constructor(private readonly opts: UrnMapperOptions) {
    const collection = el("input", { type: "text", name: "collection", size: 34, spellcheck: "false",
      placeholder: "urn:cite2:namespace:collection.version:", "aria-label": "Collection URN" });
    collection.addEventListener("input", () => { this.rule.collection = collection.value.trim(); this.changed(); });
    const kind = el("select", { name: "kind", "aria-label": "Object ids from" },
      ...RULE_KINDS.map((k) => el("option", { value: k.kind }, k.label)));
    kind.addEventListener("change", () => { this.rule.kind = kind.value as RuleKind; this.renderFields(); this.changed(); });
    const keep = el("input", { type: "checkbox", name: "keep", checked: true });
    keep.addEventListener("change", () => { this.keepExisting = keep.checked; this.changed(); });
    this.keepRow.append(keep, " Keep URNs already in the loaded map");
    this.downloadBtn.addEventListener("click", () => this.download());
    const done = el("button", { type: "button", class: "map-done" }, "Done");
    done.addEventListener("click", () => this.opts.onDone());
    this.el = el("section", { class: "mapper", "aria-label": "Map URNs" },
      el("div", { class: "map-head" }, el("h3", {}, "Map images to URNs"), done),
      el("div", { class: "map-row" }, el("label", {}, "Collection ", collection), this.collectionMsg),
      el("div", { class: "map-row" }, el("label", {}, "Object ids from ", kind), this.fields),
      this.keepRow,
      el("div", { class: "map-row" }, this.status, this.downloadBtn),
      el("p", { class: "map-hint" }, "Click a URN under a thumbnail to change it."));
  }

  /** Start (or continue) mapping a manifest. A collection is guessed from the loaded map. */
  open(canvases: CanvasInfo[], existing: UrnMap | null, manifestLabel: string, manifestUrl: string): void {
    const sameManifest = this.manifestUrl === manifestUrl && this.canvases.length === canvases.length;
    this.canvases = canvases;
    this.existing = existing;
    this.manifestLabel = manifestLabel;
    this.manifestUrl = manifestUrl;
    if (!sameManifest) { this.edits = noEdits(); this.dirty = false; }
    if (!this.rule.collection && existing) {
      const first = [...existing.byImage.values(), ...existing.byCanvas.values()][0];
      if (first) this.rule.collection = first.slice(0, first.lastIndexOf(":") + 1);
    }
    (this.el.querySelector("input[name=collection]") as HTMLInputElement).value = this.rule.collection;
    (this.el.querySelector("select[name=kind]") as HTMLSelectElement).value = this.rule.kind;
    this.keepRow.hidden = !existing;
    this.renderFields();
    this.recompute();
  }

  /** The existing (loaded) map changed, e.g. after Download made the draft the active map. */
  setExisting(existing: UrnMap | null): void {
    this.existing = existing;
    this.keepRow.hidden = !existing;
    this.recompute();
  }

  /** Hand edit: a URN for one canvas ("" = none); null = back to the rule. */
  setHand(canvasId: string, urn: string | null): void {
    if (urn === null) this.edits.hand.delete(canvasId); else this.edits.hand.set(canvasId, urn.trim());
    this.changed();
  }

  /** Numbering rule: give this canvas counter value n (later canvases follow on). */
  restartAt(canvasId: string, n: number | null): void {
    if (n === null || !Number.isFinite(n)) this.edits.restarts.delete(canvasId); else this.edits.restarts.set(canvasId, Math.round(n));
    this.changed();
  }

  private changed(): void { this.dirty = true; this.recompute(); }

  private recompute(): void {
    this.drafts = draftUrns(this.canvases, this.rule, this.edits, this.existing, this.keepExisting);
    const problem = collectionProblem(this.rule.collection);
    this.collectionMsg.textContent = problem ?? "";
    const count = (p: Draft["problem"]) => this.drafts.filter((d) => d.problem === p).length;
    const ok = count(null), none = count("none"), dup = count("duplicate"), bad = count("invalid"), clash = count("conflict");
    this.status.textContent = `${this.canvases.length} canvases · ${ok} with URNs` +
      (none ? ` · ${none} without` : "") + (dup ? ` · ${dup} duplicates` : "") + (bad ? ` · ${bad} invalid` : "") +
      (clash ? ` · ${clash} conflicting (same image as an earlier canvas)` : "");
    this.status.classList.toggle("warn", dup + bad + clash > 0);
    this.downloadBtn.disabled = ok + dup + bad === 0;
    this.opts.onChange();
  }

  private renderFields(): void {
    const r = this.rule;
    const num = (name: "start" | "pad", label: string) => {
      const i = el("input", { type: "number", name, min: name === "pad" ? 0 : null, value: r[name], style: "width:5em" });
      i.addEventListener("input", () => { r[name] = Number(i.value) || 0; this.changed(); });
      return el("label", {}, label, i);
    };
    const text = (name: "prefix" | "pattern", label: string, placeholder: string, size: number) => {
      const i = el("input", { type: "text", name, value: r[name], placeholder, size, spellcheck: "false" });
      i.addEventListener("input", () => { r[name] = i.value; this.changed(); });
      return el("label", {}, label, i);
    };
    this.fields.replaceChildren(
      ...(r.kind === "number" ? [text("prefix", "prefix ", "", 6), num("start", " start "), num("pad", " digits ")] : []),
      ...(r.kind === "pattern" ? [text("pattern", "", "regular expression, e.g. :(\\d+)$", 24)] : []),
    );
  }

  private download(): void {
    const text = urnMapText(this.manifestLabel, this.manifestUrl, this.canvases, this.drafts);
    this.dirty = false;
    this.opts.onDownload(text, `${fileStem(this.manifestLabel, "manifest")}-urns.cex`);
  }
}
