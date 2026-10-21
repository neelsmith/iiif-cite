// Copied from imageviewer/src/ui/roi-layer.ts; only the imports differ (TileViewer for ZoomViewer).
import { moveRoi, resizeRoi, roiFromCorners, roiToScreen, screenToFrac, type Handle, type Roi } from "cite-roi";
import { wheelFactor } from "../lib/zoom.ts";
import type { TileViewer } from "./tile-viewer.ts";

const HANDLES: Handle[] = ["nw", "ne", "sw", "se"];

/**
 * Rectangular selections drawn over the photo view. Each is kept as fractions of the
 * full image (cite-roi) and redrawn on every zoom/pan, so it always boxes the same
 * part of the photo. In select mode (the "Select" button, or Shift-drag at any time) a
 * drag draws a new box; in select mode a box can be clicked to make it current, dragged
 * to move it, or resized by its corner handles; Delete removes the current one.
 * While Shift is held (and through a Shift-drag) the photo shows a crosshair cursor.
 */
export class RoiLayer {
  readonly el: HTMLDivElement;
  readonly toggle: HTMLButtonElement;
  private rois: Roi[] = [];
  private current = -1;
  private selecting = false;
  private shiftHeld = false;
  private shiftDrawing = false;

  constructor(private readonly viewer: TileViewer, private readonly onChange: (rois: Roi[], current: number) => void,
    signal?: AbortSignal) {
    this.el = document.createElement("div");
    this.el.className = "roi-layer";
    this.toggle = document.createElement("button");
    this.toggle.type = "button";
    this.toggle.className = "roi-toggle";
    this.toggle.textContent = "Select";
    this.toggle.title = "Select regions (or Shift-drag at any time)";
    this.toggle.setAttribute("aria-pressed", "false");
    this.toggle.addEventListener("click", () => this.setSelecting(!this.selecting));

    this.el.addEventListener("pointerdown", (e) => this.pointerDown(e));
    // Shift-drag on the photo draws even when not in select mode (the viewer leaves it to us).
    viewer.el.addEventListener("pointerdown", (e) => { if (e.shiftKey && this.viewer.state) this.pointerDown(e, true); });
    // Zoom still works with the wheel/trackpad while selecting.
    this.el.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [px, py] = this.viewer.localPoint(e);
      this.viewer.zoomBy(wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), px, py);
    }, { passive: false });
    // Crosshair while Shift is held, so Shift-drag shows it will draw rather than pan.
    window.addEventListener("keydown", (e) => { if (e.key === "Shift") this.setShift(true); }, { signal });
    window.addEventListener("keyup", (e) => { if (e.key === "Shift") this.setShift(false); }, { signal });
    window.addEventListener("blur", () => this.setShift(false), { signal });
    viewer.el.addEventListener("pointermove", (e) => this.setShift(e.shiftKey)); // Shift pressed while unfocused
  }

  get list(): Roi[] { return this.rois.map((r) => ({ ...r })); }
  get currentIndex(): number { return this.current; }
  get isSelecting(): boolean { return this.selecting; }

  /** Replace all selections (e.g. on opening another photo). */
  set(rois: Roi[]): void {
    this.rois = rois.map((r) => ({ ...r }));
    this.current = this.rois.length ? this.rois.length - 1 : -1;
    this.render();
  }

  setSelecting(on: boolean): void {
    this.selecting = on;
    this.el.classList.toggle("selecting", on);
    this.toggle.setAttribute("aria-pressed", String(on));
    this.toggle.classList.toggle("on", on);
    this.render();
  }

  select(i: number): void {
    this.current = i;
    this.render();
    this.changed();
  }

  remove(i: number): void {
    this.rois.splice(i, 1);
    this.current = Math.min(this.current, this.rois.length - 1);
    this.render();
    this.changed();
  }

  clear(): void { this.rois = []; this.current = -1; this.render(); this.changed(); }

  /** Delete/Backspace removes the current selection; Esc leaves select mode. True if used. */
  handleKey(e: KeyboardEvent): boolean {
    if ((e.key === "Delete" || e.key === "Backspace") && this.current >= 0) { this.remove(this.current); return true; }
    if (e.key === "Escape" && this.selecting) { this.setSelecting(false); return true; }
    return false;
  }

  private changed() { this.onChange(this.list, this.current); }

  private setShift(on: boolean) {
    if (on === this.shiftHeld) return;
    this.shiftHeld = on;
    this.updateCursor();
  }

  private updateCursor() {
    this.viewer.el.classList.toggle("shift-draw", (this.shiftHeld && !!this.viewer.state) || this.shiftDrawing);
  }

  /** Position the boxes for the current zoom/pan. */
  render(): void {
    const st = this.viewer.state;
    this.el.replaceChildren();
    if (!st) return;
    this.rois.forEach((r, i) => {
      const s = roiToScreen(st.view, st.image, r);
      const box = document.createElement("div");
      box.className = "roi" + (i === this.current ? " current" : "");
      box.dataset.i = String(i);
      Object.assign(box.style, { left: `${s.left}px`, top: `${s.top}px`, width: `${s.width}px`, height: `${s.height}px` });
      const label = document.createElement("span");
      label.className = "roi-label";
      label.textContent = String(i + 1);
      box.append(label);
      if (this.selecting && i === this.current) for (const h of HANDLES) {
        const d = document.createElement("div");
        d.className = `roi-handle ${h}`;
        d.dataset.handle = h;
        d.dataset.i = String(i);
        box.append(d);
      }
      this.el.append(box);
    });
  }

  private frac(e: { clientX: number; clientY: number }) {
    const st = this.viewer.state!;
    const [sx, sy] = this.viewer.localPoint(e);
    return screenToFrac(st.view, st.image, sx, sy);
  }

  private pointerDown(e: PointerEvent, shift = false) {
    if (!this.viewer.state || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    if (shift) { this.shiftDrawing = true; this.updateCursor(); } // keep the crosshair if Shift is let go mid-drag
    const t = e.target as HTMLElement;
    const start = this.frac(e);
    const i = Number(t.dataset?.i ?? -1);
    let op: (f: { fx: number; fy: number }) => void;
    if (!shift && t.dataset?.handle) {
      const base = this.rois[i], h = t.dataset.handle as Handle;
      op = (f) => { this.rois[i] = resizeRoi(base, h, f.fx, f.fy); };
    } else if (!shift && t.classList.contains("roi") || (!shift && t.classList.contains("roi-label"))) {
      const idx = t.classList.contains("roi") ? i : Number(t.parentElement!.dataset.i);
      const base = this.rois[idx];
      this.current = idx;
      op = (f) => { this.rois[idx] = moveRoi(base, f.fx - start.fx, f.fy - start.fy); };
    } else {
      let idx = -1;
      op = (f) => {
        const r = roiFromCorners(start, f);
        if (!r) return;
        if (idx < 0) { this.rois.push(r); idx = this.rois.length - 1; this.current = idx; }
        else this.rois[idx] = r;
      };
    }
    const move = (ev: PointerEvent) => { op(this.frac(ev)); this.render(); };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (shift) { this.shiftDrawing = false; this.updateCursor(); }
      this.render();
      this.changed();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    this.render();
  }
}
