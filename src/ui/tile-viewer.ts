// Pointer, wheel and gesture handling (onResize, bindEvents) copied unchanged from
// imageviewer/src/ui/zoom-viewer.ts; the drawing (one <img> there) is IIIF tiles here.
import {
  fitView, isZoomed, panBy, scaleLimits, toggleZoom, wheelFactor, zoomAt,
  type Size, type View,
} from "../lib/zoom.ts";
import type { Piece, TileSource } from "../lib/tiles.ts";

export interface TileViewerOptions {
  /** Horizontal touch swipe while not zoomed: -1 = previous, 1 = next. */
  onSwipe?: (dir: -1 | 1) => void;
  /** Called after every zoom/pan/size change (e.g. to redraw selections). */
  onViewChange?: () => void;
  /** Return true to leave this pointerdown to someone else (no panning), e.g. Shift-drag to select. */
  claimPointer?: (e: PointerEvent) => boolean;
}

const STEP = 1.5; // zoom factor for buttons and +/- keys

/**
 * Zoomable, pannable IIIF image. A layer the size of the full-resolution image is moved
 * with `translate(x,y) scale(s)` (the same View as imageviewer's ZoomViewer, so selections
 * work the same way). In it: a low-resolution base image stretched to full size, and on
 * top the tiles of the pyramid level that suits the current zoom, added and dropped as the
 * view changes. Coarser tiles already loaded stay underneath until finer ones arrive.
 *
 * Mouse wheel / trackpad pinch / touch pinch zoom toward the pointer; drag pans;
 * double-click or double-tap toggles fit ↔ 100%; +, −, 0 keys and on-screen buttons.
 */
export class TileViewer {
  readonly el: HTMLDivElement;
  readonly controls: HTMLDivElement;
  readonly layer: HTMLDivElement;
  readonly base: HTMLImageElement;
  private source: TileSource | null = null;
  private readonly tiles = new Map<string, { img: HTMLImageElement; piece: Piece }>();
  private view: View = { scale: 1, x: 0, y: 0 };
  private natural: Size | null = null;
  private readonly label: HTMLSpanElement;
  private readonly outBtn: HTMLButtonElement;
  private readonly inBtn: HTMLButtonElement;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private gesture: { startX: number; startY: number; time: number; type: string } | null = null;
  private lastTap = { time: 0, x: 0, y: 0 };
  private lastTouchToggle = 0;
  private safariScale = 1;

  constructor(private readonly opts: TileViewerOptions = {}) {
    this.base = this.makeImg("zoom-base");
    this.layer = document.createElement("div");
    this.layer.className = "zoom-layer";
    this.layer.append(this.base);
    this.el = document.createElement("div");
    this.el.className = "zoom";
    this.el.append(this.layer);

    const btn = (cls: string, text: string, label: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = text;
      b.setAttribute("aria-label", label);
      b.title = label;
      b.addEventListener("click", fn);
      return b;
    };
    this.outBtn = btn("zoom-out", "−", "Zoom out (−)", () => this.zoomBy(1 / STEP));
    this.inBtn = btn("zoom-in", "+", "Zoom in (+)", () => this.zoomBy(STEP));
    this.label = document.createElement("span");
    this.label.className = "zoom-level";
    this.controls = document.createElement("div");
    this.controls.className = "zoom-controls";
    this.controls.append(this.outBtn, this.label, this.inBtn, btn("zoom-fit", "Fit", "Fit to screen (0)", () => this.reset()));

    this.bindEvents();
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => this.onResize()).observe(this.el);
  }

  private makeImg(cls: string): HTMLImageElement {
    const img = document.createElement("img");
    img.className = cls;
    img.draggable = false;
    img.alt = "";
    img.decoding = "async";
    return img;
  }

  /** Show a new image, fitted. */
  show(source: TileSource, alt: string): void {
    this.clearTiles();
    this.source = source;
    this.natural = source.size;
    this.layer.style.width = `${source.size.w}px`;
    this.layer.style.height = `${source.size.h}px`;
    this.place(this.base, source.base);
    this.base.alt = alt;
    this.base.src = source.base.url;
    this.layer.hidden = false;
    this.reset();
  }

  clear(): void {
    this.clearTiles();
    this.source = null;
    this.natural = null;
    this.base.removeAttribute("src");
    this.layer.hidden = true;
    this.opts.onViewChange?.();
  }

  /** URLs of the tiles currently in the layer (for tests and debugging). */
  get tileUrls(): string[] { return [...this.tiles.keys()]; }

  get scale(): number { return this.view.scale; }
  get zoomed(): boolean { return !!this.natural && isZoomed(this.view, this.stage(), this.natural); }

  reset(): void {
    if (!this.natural) return;
    this.view = fitView(this.stage(), this.natural);
    this.apply();
  }

  /** Zoom by a factor around a stage point (default: center). */
  zoomBy(factor: number, px?: number, py?: number): void {
    if (!this.natural) return;
    const s = this.stage();
    this.view = zoomAt(this.view, factor, px ?? s.w / 2, py ?? s.h / 2, s, this.natural);
    this.apply();
  }

  /** Handle +, −, 0. Returns true if the key was used. */
  handleKey(e: KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    if (e.key === "+" || e.key === "=") this.zoomBy(STEP);
    else if (e.key === "-" || e.key === "_") this.zoomBy(1 / STEP);
    else if (e.key === "0") this.reset();
    else return false;
    return true;
  }

  /** Current zoom/pan (stage pixels) and the image's full size, or null before it's known. */
  get state(): { view: { scale: number; x: number; y: number }; image: Size } | null {
    return this.natural ? { view: { ...this.view }, image: { ...this.natural } } : null;
  }

  /** A pointer/mouse position relative to the viewer. */
  localPoint(e: { clientX: number; clientY: number }): [number, number] {
    return this.point(e);
  }

  private stage(): Size {
    return { w: this.el.clientWidth, h: this.el.clientHeight };
  }

  private point(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /**
   * Position a piece in the layer (full-resolution px). `overlap` (also full-resolution px)
   * widens interior edges so neighbouring tiles overlap by ~1 screen pixel, hiding the
   * hairline seams that rounding leaves between scaled tiles.
   */
  private place(img: HTMLImageElement, p: Piece, overlap = 0): void {
    const right = this.natural && p.x + p.w < this.natural.w ? overlap : 0;
    const bottom = this.natural && p.y + p.h < this.natural.h ? overlap : 0;
    img.style.left = `${p.x}px`;
    img.style.top = `${p.y}px`;
    img.style.width = `${p.w + right}px`;
    img.style.height = `${p.h + bottom}px`;
  }

  private clearTiles(): void {
    for (const { img } of this.tiles.values()) img.remove();
    this.tiles.clear();
  }

  /** Add the tiles the view needs; drop finer-level and off-screen ones. */
  private updateTiles(): void {
    if (!this.source) return;
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const wanted = this.source.tiles(this.view, this.stage(), dpr);
    const keep = new Set(wanted.map((p) => p.url));
    const sf = wanted[0]?.sf ?? Infinity;
    const vis = { x0: -this.view.x / this.view.scale, y0: -this.view.y / this.view.scale };
    const s = this.stage();
    const vis1 = { x1: vis.x0 + s.w / this.view.scale, y1: vis.y0 + s.h / this.view.scale };
    for (const [url, t] of this.tiles) {
      if (keep.has(url)) continue;
      const p = t.piece;
      const onScreen = p.x < vis1.x1 && p.x + p.w > vis.x0 && p.y < vis1.y1 && p.y + p.h > vis.y0;
      // A coarser tile still on screen stays as a backdrop until the finer ones load.
      if (p.sf > sf && onScreen && t.img.complete) continue;
      t.img.remove();
      this.tiles.delete(url);
    }
    const overlap = 1 / this.view.scale; // one screen pixel
    for (const [, t] of this.tiles) this.place(t.img, t.piece, overlap);
    for (const p of wanted) {
      if (this.tiles.has(p.url)) continue;
      const img = this.makeImg("zoom-tile");
      this.place(img, p, overlap);
      img.style.zIndex = String(Math.round(1000 / p.sf)); // finer levels on top
      img.addEventListener("error", () => img.classList.add("failed"));
      img.src = p.url;
      this.layer.append(img);
      this.tiles.set(p.url, { img, piece: p });
    }
  }

  private apply(): void {
    const { scale, x, y } = this.view;
    this.layer.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    this.updateTiles();
    queueMicrotask(() => this.opts.onViewChange?.());
    this.label.textContent = `${Math.round(scale * 100)}%`;
    const zoomed = this.zoomed;
    this.el.classList.toggle("zoomed", zoomed);
    if (this.natural) {
      const { min, max } = scaleLimits(this.stage(), this.natural);
      this.outBtn.disabled = scale <= min * 1.001;
      this.inBtn.disabled = scale >= max * 0.999;
    }
  }

  private onResize(): void {
    if (!this.natural) return;
    if (this.zoomed) this.zoomBy(1); // re-clamp to the new stage
    else this.reset();
  }

  private bindEvents(): void {
    const el = this.el;

    el.addEventListener("wheel", (e) => {
      if (!this.natural) return;
      e.preventDefault();
      const [px, py] = this.point(e);
      this.zoomBy(wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), px, py);
    }, { passive: false });

    // Safari trackpad pinch (non-standard gesture events).
    el.addEventListener("gesturestart", (e) => { e.preventDefault(); this.safariScale = 1; });
    el.addEventListener("gesturechange", (e) => {
      e.preventDefault();
      const g = e as unknown as { scale: number; clientX: number; clientY: number };
      const [px, py] = this.point(g);
      this.zoomBy(g.scale / this.safariScale, px, py);
      this.safariScale = g.scale;
    });

    el.addEventListener("dblclick", (e) => {
      if (!this.natural || Date.now() - this.lastTouchToggle < 600) return;
      const [px, py] = this.point(e);
      this.view = toggleZoom(this.view, px, py, this.stage(), this.natural);
      this.apply();
    });

    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (this.opts.claimPointer?.(e)) return;
      el.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1)
        this.gesture = { startX: e.clientX, startY: e.clientY, time: Date.now(), type: e.pointerType };
      else this.gesture = null; // pinch: no swipe / tap
      el.classList.add("dragging");
    });

    el.addEventListener("pointermove", (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev || !this.natural) return;
      const s = this.stage();
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.entries()];
        const other = a[0] === e.pointerId ? b[1] : a[1];
        const before = Math.hypot(prev.x - other.x, prev.y - other.y);
        const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        const [mx, my] = this.point({ clientX: (e.clientX + other.x) / 2, clientY: (e.clientY + other.y) / 2 });
        if (before > 0) this.view = zoomAt(this.view, after / before, mx, my, s, this.natural);
        this.view = panBy(this.view, (e.clientX - prev.x) / 2, (e.clientY - prev.y) / 2, s, this.natural);
        this.apply();
      } else if (this.pointers.size === 1 && this.zoomed) {
        this.view = panBy(this.view, e.clientX - prev.x, e.clientY - prev.y, s, this.natural);
        this.apply();
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });

    const end = (e: PointerEvent) => {
      if (!this.pointers.delete(e.pointerId)) return;
      if (this.pointers.size === 0) el.classList.remove("dragging");
      const g = this.gesture;
      if (!g || this.pointers.size > 0 || e.type === "pointercancel") return;
      this.gesture = null;
      const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
      if (g.type !== "touch") return;
      // Swipe to change photo (only when not zoomed in).
      if (!this.zoomed && Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
        this.opts.onSwipe?.(dx < 0 ? 1 : -1);
        return;
      }
      // Double-tap toggles zoom.
      if (Math.hypot(dx, dy) < 10 && Date.now() - g.time < 300) {
        const now = Date.now();
        const near = Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 30;
        if (now - this.lastTap.time < 300 && near && this.natural) {
          const [px, py] = this.point(e);
          this.view = toggleZoom(this.view, px, py, this.stage(), this.natural);
          this.apply();
          this.lastTouchToggle = now;
          this.lastTap.time = 0;
        } else {
          this.lastTap = { time: now, x: e.clientX, y: e.clientY };
        }
      }
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }
}
