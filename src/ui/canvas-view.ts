/**
 * Full-window view of one canvas: the tiled viewer with region selection on top,
 * previous/next/close, and an info panel (label, URN, canvas id, image size) with the
 * canvas's selections — each as x,y,w,h and CITE2 URN, with a link to view just that region.
 */
import { formatRoi, roiUrn, type Roi } from "cite-roi";
import type { CanvasInfo } from "../lib/manifest.ts";
import { infoUrl } from "../lib/image-api.ts";
import { loadImageInfo, type Fetch } from "../lib/load.ts";
import { fileStem, regionImageUrl } from "../lib/selections.ts";
import { iiifSource, staticSource, type ImageInfo, type TileSource } from "../lib/tiles.ts";
import type { Size } from "../lib/zoom.ts";
import { TileViewer } from "./tile-viewer.ts";
import { RoiLayer } from "./roi-layer.ts";
import { copyText, download } from "./clipboard.ts";
import { el } from "./dom.ts";

export interface CanvasViewOptions {
  fetch: Fetch;
  /** -1 previous, 1 next. */
  onStep: (dir: -1 | 1) => void;
  onClose: () => void;
  /** The open canvas's selections changed (drawn, moved, resized, removed). */
  onRois?: (canvas: CanvasInfo, rois: Roi[], imageSize: Size | null) => void;
  /** The open canvas's image has loaded; its full-resolution size is now known. */
  onImage?: (canvas: CanvasInfo, size: Size) => void;
  /** A link to this canvas (and region): by URN when possible (`byUrn`), else by canvas id. */
  linkFor?: (canvas: CanvasInfo, rois: Roi[]) => { url: string; byUrn: boolean };
}

export interface ShowArgs {
  canvas: CanvasInfo;
  index: number;
  count: number;
  urn: string | null;
  /** True when a URN map is loaded (so a missing URN is worth pointing out). */
  haveUrnMap: boolean;
  /** Selections to show when the canvas is opened (ignored when re-showing the open canvas). */
  rois?: Roi[];
  /** The image is from an image catalog (its own URNs; no IIIF service). */
  catalog?: boolean;
  /** Catalog fields to show (caption, tags, credits, …), non-empty only. */
  details?: [string, string][];
}

export class CanvasView {
  readonly el: HTMLDivElement;
  readonly viewer: TileViewer;
  readonly roi: RoiLayer;
  private readonly panel: HTMLElement;
  private readonly selBox: HTMLElement;
  private readonly message: HTMLParagraphElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly infos = new Map<string, Promise<ImageInfo>>();
  private token = 0;
  private current: ShowArgs | null = null;
  private readonly abort = new AbortController();
  /** A note shown at the top of the info panel until another canvas is opened. */
  private note = "";
  /** Full-resolution size of the image on show, once known (regions are measured on it). */
  imageSize: Size | null = null;
  /** Resolves when the current canvas has been drawn (or failed). */
  ready: Promise<void> = Promise.resolve();

  constructor(private readonly opts: CanvasViewOptions) {
    let roi: RoiLayer | null = null;
    this.viewer = new TileViewer({
      onSwipe: (d) => { if (!roi?.isSelecting) this.opts.onStep(d); },
      onViewChange: () => roi?.render(),
      claimPointer: (e) => e.shiftKey, // Shift-drag draws a selection instead of panning
    });
    this.roi = roi = new RoiLayer(this.viewer, (rois) => {
      this.renderSelections();
      if (this.current) this.opts.onRois?.(this.current.canvas, rois, this.imageSize);
    }, this.abort.signal);
    this.viewer.controls.append(this.roi.toggle);
    this.message = el("p", { class: "stage-message", role: "status" });
    const btn = (cls: string, text: string, label: string, fn: () => void) => {
      const b = el("button", { type: "button", class: cls, "aria-label": label, title: label }, text);
      b.addEventListener("click", fn);
      return b;
    };
    this.prev = btn("nav prev", "‹", "Previous (←)", () => this.opts.onStep(-1));
    this.next = btn("nav next", "›", "Next (→)", () => this.opts.onStep(1));
    const stage = el("div", { class: "stage" }, this.viewer.el, this.roi.el, this.message, this.viewer.controls,
      this.prev, this.next, btn("close", "×", "Close (Esc)", () => this.opts.onClose()));
    this.selBox = el("section", { class: "selections" });
    this.panel = el("aside", { class: "info" });
    this.el = el("div", { class: "lightbox", hidden: true, role: "dialog", "aria-modal": "true" }, stage, this.panel);
    document.addEventListener("keydown", (e) => this.onKey(e), { signal: this.abort.signal });
  }

  /** Remove document listeners (the element itself is left to its owner). */
  destroy(): void {
    this.hide();
    this.abort.abort();
  }

  get isOpen(): boolean { return !this.el.hidden; }
  get canvas(): CanvasInfo | null { return this.current?.canvas ?? null; }

  show(args: ShowArgs): void {
    const same = this.current?.canvas.id === args.canvas.id;
    this.current = args;
    this.el.hidden = false;
    document.body.classList.add("viewing");
    this.prev.disabled = args.index <= 0;
    this.next.disabled = args.index >= args.count - 1;
    if (!same) { this.roi.set(args.rois ?? []); this.note = ""; }
    this.renderPanel();
    if (same) return;
    const token = ++this.token;
    this.imageSize = null;
    this.viewer.clear();
    this.message.textContent = "Loading…";
    this.ready = this.sourceFor(args.canvas).then(
      (src) => {
        if (token !== this.token) return;
        this.message.textContent = "";
        this.imageSize = src.size;
        this.viewer.show(src, args.canvas.label);
        this.renderPanel();
        this.opts.onImage?.(args.canvas, src.size);
      },
      (err: Error) => {
        if (token !== this.token) return;
        this.message.textContent = `Could not load image: ${err.message}`;
      });
  }

  hide(): void {
    this.token++;
    this.current = null;
    this.el.hidden = true;
    document.body.classList.remove("viewing");
    this.roi.setSelecting(false);
    this.roi.set([]);
    this.viewer.clear();
  }

  private sourceFor(c: CanvasInfo): Promise<TileSource> {
    if (c.service) {
      const id = c.service.id;
      if (!this.infos.has(id)) {
        const p = loadImageInfo(c.service, this.opts.fetch);
        p.catch(() => this.infos.delete(id)); // retry next time
        this.infos.set(id, p);
      }
      return this.infos.get(id)!.then(iiifSource);
    }
    if (!c.imageUrl) return Promise.reject(new Error("canvas has no image"));
    // A plain image file: its size is only known once it has loaded.
    const url = c.imageUrl;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(staticSource(url, { w: img.naturalWidth, h: img.naturalHeight }));
      img.onerror = () => reject(new Error(url));
      img.src = url;
    });
  }

  /** Show a note in the info panel of the open canvas (e.g. about the link that opened it). */
  setNote(text: string): void {
    this.note = text;
    this.renderPanel();
  }

  private renderPanel(): void {
    const a = this.current;
    if (!a) return;
    const c = a.canvas;
    const row = (k: string, ...v: (Node | string)[]) => [el("dt", {}, k), el("dd", {}, ...v)];
    const urn = a.urn ? el("code", { class: "urn" }, a.urn)
      : el("span", { class: "muted" }, a.catalog ? "No URN in the catalog" : a.haveUrnMap ? "Not in the URN map" : "No URN map loaded");
    const size = this.imageSize ? `${this.imageSize.w} × ${this.imageSize.h} px` : "…";
    this.panel.replaceChildren(
      ...(this.note ? [el("p", { class: "panel-note", role: "status" }, this.note)] : []),
      el("p", { class: "pos" }, `${a.index + 1} / ${a.count}`),
      el("h2", {}, c.label),
      ...(this.opts.linkFor ? [this.linkButton([], "Copy link to this image")] : []),
      el("dl", {},
        ...row("URN", urn),
        ...(a.details ?? []).flatMap(([k, v]) => row(k, v)),
        ...(a.catalog
          ? row("File", el("a", { href: c.imageUrl ?? "", target: "_blank", rel: "noopener" }, c.id))
          : row("Canvas", el("code", {}, c.id))),
        ...row("Image", size),
        ...(c.service ? row("Image service", el("a", { href: infoUrl(c.service), target: "_blank", rel: "noopener" }, "info.json")) : [])),
      this.selBox,
    );
    this.renderSelections();
  }

  /** The info panel's list of selections for the open canvas (after imageviewer's). */
  private renderSelections(): void {
    const a = this.current;
    if (!a) return;
    const rois = this.roi.list, cur = this.roi.currentIndex;
    const sel = { canvas: a.canvas, imageSize: this.imageSize };
    const btn = (label: string, title: string, fn: () => void, cls = "sel-btn") => {
      const b = el("button", { type: "button", class: cls, title }, label);
      b.addEventListener("click", fn);
      return b;
    };
    const copyBtn = (text: string, title: string) => {
      const b = btn("Copy", title, () => copyText(text).then((ok) => { b.textContent = ok ? "Copied" : "Copy failed"; }));
      return b;
    };
    const copyAll = (lines: string[], what: string) => {
      const b = btn("Copy all", `Copy every selection's ${what}, one per line`, () =>
        copyText(lines.join("\n")).then((ok) => { b.textContent = ok ? `Copied ${lines.length}` : "Copy failed"; }), "sel-btn copy-all");
      return b;
    };
    const items = rois.map((r, i) => {
      const urn = a.urn ? roiUrn(a.urn, r) : "";
      // A catalog image has no IIIF server to cut out the region: open the whole image with it outlined.
      const img = regionImageUrl(sel, r) ?? (a.catalog && this.opts.linkFor ? this.opts.linkFor(a.canvas, [r]).url : null);
      const li = el("li", { class: i === cur ? "current" : "" },
        btn(String(i + 1), "Make this the current selection", () => this.roi.select(i), "sel-num"),
        el("code", {}, formatRoi(r)), copyBtn(formatRoi(r), "Copy x,y,w,h"),
        btn("×", "Remove this selection", () => this.roi.remove(i), "sel-btn sel-remove"),
        ...(urn ? [el("code", { class: "sel-urn" }, urn), copyBtn(urn, "Copy CITE2 URN")] : []),
        ...(img ? [el("a", { class: "sel-img", href: img, target: "_blank", rel: "noopener",
          title: a.catalog ? "Open the whole image with this region outlined, in a new tab" : "Open just this region, in a new tab" }, "View this region")] : []),
        ...(this.opts.linkFor ? [this.linkButton([r], "Copy link")] : []));
      return li;
    });
    const urns = a.urn ? rois.map((r) => roiUrn(a.urn!, r)) : [];
    const hint = (t: string) => el("p", { class: "sel-hint" }, t);
    this.selBox.replaceChildren(
      el("h3", {}, `Selections (${rois.length})`),
      ...(rois.length ? [el("ol", {}, ...items)] : [hint("Shift-drag on the image, or press Select and drag, to mark a region.")]),
      ...(rois.length && !a.urn ? [hint(a.catalog ? "This image has no URN in the catalog, so there are no CITE2 URNs."
        : a.haveUrnMap ? "This canvas is not in the URN map, so there are no CITE2 URNs."
        : "Load a URN map to get CITE2 URNs.")] : []),
      ...(rois.length ? [el("div", { class: "sel-actions" },
        ...(urns.length ? [btn("Download", "Save the URNs as a text file", () =>
          download(urns.join("\n") + "\n", `${fileStem(a.canvas.label, "canvas")}-regions.txt`))] : []),
        copyAll(urns.length ? urns : rois.map(formatRoi), urns.length ? "URN" : "x,y,w,h"),
        ...(this.opts.linkFor && rois.length > 1 ? [this.linkButton(rois, "Copy link to all")] : []),
        btn("Clear all", "Remove every selection on this canvas", () => this.roi.clear()))] : []),
    );
  }

  /** "Copy link" for the open canvas (no regions), one region, or all of them. */
  private linkButton(rois: Roi[], label: string): HTMLButtonElement {
    const a = this.current!;
    const { url, byUrn } = this.opts.linkFor!(a.canvas, rois);
    const what = rois.length === 0 ? "this image" : rois.length === 1 ? "this region" : "all these regions";
    const title = byUrn ? `Copy a link that opens ${what} by URN`
      : `Copy a link to ${what} (by canvas id: ${a.urn ? "load the URN map from a URL" : "it has no URN"} for a link by URN)`;
    const cls = rois.length === 0 ? "copy-link" : rois.length === 1 ? "sel-btn sel-link" : "sel-btn sel-link-all";
    const b = el("button", { type: "button", class: cls, title, "data-url": url }, label);
    b.addEventListener("click", () => copyText(url).then((ok) => { b.textContent = ok ? "Copied" : "Copy failed"; }));
    return b;
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen || e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (this.roi.handleKey(e)) { e.preventDefault(); return; } // Delete; Esc leaves select mode first
    if (e.key === "Escape") this.opts.onClose();
    else if (e.key === "ArrowLeft" && !this.prev.disabled) this.opts.onStep(-1);
    else if (e.key === "ArrowRight" && !this.next.disabled) this.opts.onStep(1);
    else if (!this.viewer.handleKey(e)) return;
    e.preventDefault();
  }
}
