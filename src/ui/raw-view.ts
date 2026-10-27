/**
 * The raw=true page: just the cited image — the whole file, or each cited region cut out at
 * full resolution — with a Download button for each, and a link back to it in iiif-cite.
 */
import { formatRoi, formatRois, roiUrn, type Roi } from "cite-roi";
import type { CanvasInfo } from "../lib/manifest.ts";
import type { Fetch } from "../lib/load.ts";
import { imageData, type ImageTools } from "./raw-image.ts";
import { el } from "./dom.ts";

export interface RawArgs {
  canvas: CanvasInfo;
  /** Regions to cut out; none = the whole image. */
  rois: Roi[];
  urn: string | null;
  /** The same link without raw=true (opens the image in iiif-cite). */
  backUrl: string;
}

export class RawView {
  readonly el = el("section", { class: "raw" });
  private key = "";
  private token = 0;
  private urls: string[] = [];
  /** Resolves when every image on show has loaded (or failed). */
  ready: Promise<void> = Promise.resolve();

  constructor(private readonly tools: ImageTools, private readonly fetchFn: Fetch) {}

  show(a: RawArgs): void {
    const key = `${a.canvas.id} ${formatRois(a.rois)} ${a.urn ?? ""}`;
    if (key === this.key) return;
    this.key = key;
    const token = ++this.token;
    this.release();
    const items = a.rois.length ? a.rois : [null];
    const figures = items.map((r) => {
      const status = el("p", { class: "raw-status" }, "Loading…");
      const fig = el("figure", { class: "raw-item" }, status);
      const cite = r ? (a.urn ? roiUrn(a.urn, r) : `${a.canvas.id}@${formatRoi(r)}`) : (a.urn ?? a.canvas.id);
      const job = imageData(a.canvas, r, a.urn, this.tools, this.fetchFn).then(({ blob, name }) => {
        if (token !== this.token) return;
        const url = URL.createObjectURL(blob);
        this.urls.push(url);
        const img = el("img", { src: url, alt: cite });
        const size = el("span", { class: "raw-size" });
        img.addEventListener("load", () => { size.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`; });
        fig.replaceChildren(img, el("figcaption", {}, el("code", {}, cite), " ", size, " ",
          el("a", { class: "raw-download", href: url, download: name }, `Download ${name}`)));
      }, (err: Error) => {
        if (token !== this.token) return;
        status.textContent = err.message;
        status.classList.add("error");
      });
      return { fig, job };
    });
    this.ready = Promise.all(figures.map((f) => f.job)).then(() => undefined);
    this.el.replaceChildren(
      el("header", { class: "raw-head" }, el("h1", {}, a.canvas.label),
        el("a", { class: "raw-back", href: a.backUrl }, "Open in iiif-cite")),
      ...figures.map((f) => f.fig));
  }

  /** Leaving the raw page: free the images. */
  clear(): void {
    this.key = "";
    this.token++;
    this.release();
    this.el.replaceChildren();
  }

  private release(): void {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
  }
}
