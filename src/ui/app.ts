/**
 * Load a manifest (form or #manifest=), show its canvases as a thumbnail grid, and load a
 * canvas→URN map (#urns=<url>, or a local file). #canvas=<id> opens that canvas in the
 * tiled viewer: tiles set it (adding a history entry, so Back closes the view), next/previous
 * replace it, and a shared link reopens it.
 *
 * Regions selected on a canvas are kept while the page is open (per manifest and canvas; no
 * browser storage, as in imageviewer). The open canvas's regions are in the link as
 * roi=x,y,w,h;x,y,w,h, so a shared link shows them. "Export selections" downloads all of them
 * as one CITE2 URN per line.
 */
import { readHash, withHash } from "../lib/hash.ts";
import { loadManifest, loadUrnMapUrl, type Fetch } from "../lib/load.ts";
import type { CanvasInfo, ManifestInfo } from "../lib/manifest.ts";
import type { Size } from "../lib/zoom.ts";
import { parseUrnMap, urnForCanvas, type UrnMap } from "../lib/urn-map.ts";
import { thumbCandidates, urnCoverage } from "../lib/canvases.ts";
import { formatRois, parseRois, type Roi } from "cite-roi";
import { fileStem, selectionKey, selectionsText, type CanvasSelections } from "../lib/selections.ts";
import { el } from "./dom.ts";
import { CanvasView } from "./canvas-view.ts";
import { download } from "./clipboard.ts";
import { forPage, httpOrigins, HttpsUpgradeError, manifestForPage } from "../lib/https.ts";

export interface AppOptions {
  root: HTMLElement;
  fetch?: Fetch;
  version?: string;
  /** Page served over https: request http URLs over https (default: from location.protocol). */
  https?: boolean;
  /** Called whenever a canvas is shown in the viewer. */
  onOpen?: (c: CanvasInfo, index: number, app: App) => void;
}

export interface App {
  readonly manifest: ManifestInfo | null;
  readonly urnMap: UrnMap | null;
  urnFor(c: CanvasInfo): string | null;
  readonly view: CanvasView;
  /** Every canvas with selections this session (all manifests). */
  selections(): CanvasSelections[];
  /** Remove window/document listeners (for tests, or before starting another app). */
  stop(): void;
  /** Resolves when the loads started by the current hash have finished. */
  ready: Promise<void>;
}

interface UrnSource { map: UrnMap; label: string; fromFile: boolean }

export function startApp(opts: AppOptions): App {
  const pageIsHttps = opts.https ?? location.protocol === "https:";
  const baseFetch: Fetch = opts.fetch ?? ((u) => fetch(u));
  /** http origins whose URLs (from a manifest) were switched to https for this page. */
  const upgradedOrigins = new Set<string>();
  /** Fetch, upgrading http URLs on an https page (with a clear error if https doesn't answer). */
  const fetchFn: Fetch = async (url) => {
    const up = forPage(url, pageIsHttps);
    try {
      return await baseFetch(up);
    } catch (err) {
      const httpUrl = up !== url ? url : url.replace(/^https:/, "http:");
      const origin = (() => { try { return new URL(httpUrl).origin; } catch { return ""; } })();
      if (up !== url || upgradedOrigins.has(origin)) throw new HttpsUpgradeError(httpUrl);
      throw err;
    }
  };
  const { root } = opts;
  let manifest: ManifestInfo | null = null;
  let manifestUrl = "";
  let manifestError = "";
  let urns: UrnSource | null = null;
  let urnError = "";
  let loading = false;

  // ---- static chrome
  const manifestInput = el("input", { type: "url", name: "manifest", placeholder: "IIIF manifest URL", required: true, "aria-label": "IIIF manifest URL" });
  const manifestForm = el("form", { class: "load" }, manifestInput, el("button", { type: "submit" }, "Load"));
  const urnInput = el("input", { type: "url", name: "urns", placeholder: "URN map URL (.cex)", "aria-label": "URN map URL" });
  const urnFile = el("input", { type: "file", accept: ".cex,.txt,.csv,text/plain", hidden: true, "aria-label": "URN map file" });
  const urnForm = el("form", { class: "load urns" }, urnInput, el("button", { type: "submit" }, "Load URNs"),
    el("button", { type: "button", class: "file" }, "File…"), urnFile);
  const exportBtn = el("button", { type: "button", class: "export-selections",
    title: "Download the regions selected this session (one CITE2 URN per line)" }, "Export selections");
  exportBtn.addEventListener("click", () => {
    const all = [...store.values()];
    download(selectionsText(all, urnFor), `${fileStem(manifest?.label ?? "")}-regions.txt`);
  });
  const bar = el("header", { class: "bar" },
    el("h1", {}, "iiif-cite"), manifestForm, urnForm, exportBtn,
    el("span", { class: "version" }, opts.version ? `v${opts.version}` : ""));
  const main = el("main", { class: "content" });
  const view = new CanvasView({
    fetch: fetchFn,
    onStep: (dir) => step(dir),
    onClose: () => close(),
    onRois: (c, rois, size) => {
      setRois(c, rois, size);
      // Keep the open canvas's regions in the link without adding history entries.
      history.replaceState(history.state, "", withHash(location.hash, { roi: rois.length ? formatRois(rois) : null }) || location.pathname);
    },
    onImage: (c, size) => {
      const e = store.get(selectionKey(manifestUrl, c.id));
      if (e) e.imageSize = size;
    },
  });
  /** Selections this session, keyed by manifest URL + canvas id. */
  const store = new Map<string, CanvasSelections>();
  /** Grid tiles of the current manifest, by canvas id (for the selection-count badges). */
  let tiles = new Map<string, HTMLElement>();
  root.replaceChildren(bar, main, view.el);
  /** The open canvas was opened from the grid in this page, so Back returns to the grid. */
  let pushedCanvas = false;

  manifestForm.addEventListener("submit", (e) => {
    e.preventDefault();
    pushedCanvas = false;
    setHash({ manifest: manifestInput.value.trim(), canvas: null });
  });
  urnForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const u = urnInput.value.trim();
    if (u) setHash({ urns: u });
  });
  urnForm.querySelector<HTMLButtonElement>("button.file")!.addEventListener("click", () => urnFile.click());
  urnFile.addEventListener("change", async () => {
    const f = urnFile.files?.[0];
    if (!f) return;
    urns = { map: parseUrnMap(await f.text()), label: f.name, fromFile: true };
    urnError = "";
    urnInput.value = "";
    urnFile.value = "";
    if (readHash(location.hash).urns) history.replaceState(null, "", withHash(location.hash, { urns: null }));
    render();
  });

  function setHash(changes: Record<string, string | null>, replace = false) {
    const next = withHash(location.hash, changes);
    if (next === location.hash) return;
    // Both fire hashchange → sync().
    if (replace) location.replace(next || "#");
    else location.hash = next;
  }

  function setRois(c: CanvasInfo, rois: Roi[], size: Size | null) {
    const key = selectionKey(manifestUrl, c.id);
    if (rois.length) store.set(key, { manifestUrl, canvas: c, rois, imageSize: size ?? store.get(key)?.imageSize ?? null });
    else store.delete(key);
    updateBadge(c.id);
    updateExport();
  }

  const storedRois = (c: CanvasInfo) => store.get(selectionKey(manifestUrl, c.id))?.rois ?? [];
  /** Hash changes for opening canvas c, carrying its stored selections. */
  const canvasHash = (c: CanvasInfo) => {
    const rois = storedRois(c);
    return { canvas: c.id, roi: rois.length ? formatRois(rois) : null };
  };

  function step(dir: -1 | 1) {
    const c = view.canvas;
    if (!manifest || !c) return;
    const i = manifest.canvases.findIndex((x) => x.id === c.id) + dir;
    if (i >= 0 && i < manifest.canvases.length) setHash(canvasHash(manifest.canvases[i]), true);
  }

  function close() {
    if (pushedCanvas) { pushedCanvas = false; history.back(); }
    else setHash({ canvas: null, roi: null }, true);
  }

  function updateBadge(id: string) {
    const t = tiles.get(id);
    if (!t) return;
    const n = store.get(selectionKey(manifestUrl, id))?.rois.length ?? 0;
    if (n) t.dataset.selections = String(n); else delete t.dataset.selections;
  }

  function updateExport() {
    const n = [...store.values()].reduce((a, e) => a + e.rois.length, 0);
    exportBtn.textContent = n ? `Export selections (${n})` : "Export selections";
    exportBtn.disabled = n === 0;
  }

  // ---- hash → state
  let lastManifest = "", lastUrns = "";
  async function sync(): Promise<void> {
    const h = readHash(location.hash);
    const jobs: Promise<void>[] = [];
    const m = h.manifest ?? "";
    if (m !== lastManifest) {
      lastManifest = m;
      manifestInput.value = m;
      jobs.push(loadM(m));
    }
    const u = h.urns ?? "";
    if (u !== lastUrns) {
      lastUrns = u;
      if (u) { urnInput.value = u; jobs.push(loadU(u)); }
    }
    render();
    await Promise.all(jobs);
  }

  async function loadM(url: string) {
    manifest = null; manifestError = ""; manifestUrl = url;
    if (!url) return;
    loading = true; render();
    try {
      const m = await loadManifest(url, fetchFn);
      if (manifestUrl === url) {
        if (pageIsHttps) for (const o of httpOrigins(m)) upgradedOrigins.add(o);
        manifest = manifestForPage(m, pageIsHttps);
      }
    } catch (err) {
      if (manifestUrl === url) manifestError = (err as Error).message;
    } finally {
      if (manifestUrl === url) { loading = false; render(); }
    }
  }

  async function loadU(url: string) {
    urnError = "";
    try {
      urns = { map: await loadUrnMapUrl(url, fetchFn), label: url, fromFile: false };
    } catch (err) {
      urns = null;
      urnError = (err as Error).message;
    }
    render();
  }

  /** Show (or hide) the canvas named in the hash. */
  function syncCanvas() {
    const id = readHash(location.hash).canvas;
    const i = manifest && id ? manifest.canvases.findIndex((c) => c.id === id) : -1;
    if (!manifest || i < 0) {
      if (view.isOpen) view.hide();
      if (!id) pushedCanvas = false;
      return;
    }
    const c = manifest.canvases[i];
    const opening = view.canvas?.id !== c.id;
    // On opening, the link's roi= is authoritative (opening from the grid or stepping puts
    // the stored selections there; a shared link brings its own).
    let rois: Roi[] | undefined;
    if (opening) {
      rois = parseRois(readHash(location.hash).roi ?? "");
      setRois(c, rois, null);
    }
    view.show({ canvas: c, index: i, count: manifest.canvases.length, urn: urnFor(c), haveUrnMap: !!urns, rois });
    if (opening) opts.onOpen?.(c, i, app);
  }

  // ---- render
  function render() {
    main.replaceChildren(...content());
    updateExport();
    syncCanvas();
    document.title = manifest?.label ? `${manifest.label} · iiif-cite` : "iiif-cite";
  }

  function content(): Node[] {
    const out: Node[] = [];
    const notices: (Node | string)[] = [];
    if (manifestError) notices.push(manifestError);
    if (urnError) notices.push(`URN map: ${urnError}`);
    if (manifest) {
      notices.push(...manifest.errors);
      const id = readHash(location.hash).canvas;
      if (id && !manifest.canvases.some((c) => c.id === id)) notices.push(`No canvas ${id} in this manifest`);
    }
    if (urns) {
      notices.push(...urns.map.errors.map((e) => `URN map ${urns!.label}: ${e}`));
      if (manifest) {
        const unknown = urnCoverage(manifest, urns.map).unknownCanvases;
        if (unknown.length) notices.push(`URN map ${urns.label}: ${unknown.length} canvas id(s) not in this manifest, e.g. ${unknown[0]}`);
      }
    }
    if (notices.length) out.push(el("div", { class: "notices", role: "status" }, el("ul", {}, ...notices.map((n) => el("li", {}, n)))));

    if (!manifestUrl) {
      out.push(el("p", { class: "empty" }, "Enter the URL of a IIIF manifest (Presentation API 2.x or 3.0)."));
      return out;
    }
    if (loading) { out.push(el("p", { class: "empty" }, "Loading manifest…")); return out; }
    if (!manifest) return out;

    const cov = urns ? urnCoverage(manifest, urns.map) : null;
    out.push(el("div", { class: "manifest-head" },
      el("h2", {}, manifest.label || manifest.id),
      el("span", { class: "count" },
        `${manifest.canvases.length} canvases`,
        cov ? ` · ${cov.withUrn} with URNs (${urns!.label}${urns!.fromFile ? ", local file — not in the link" : ""})` : "")));
    out.push(grid());
    return out;
  }

  /** The thumbnail grid, rebuilt only when the manifest or URN map changes. */
  let gridFor: { manifest: ManifestInfo; urns: UrnSource | null; el: HTMLElement } | null = null;
  function grid(): HTMLElement {
    if (gridFor && gridFor.manifest === manifest && gridFor.urns === urns) return gridFor.el;
    tiles = new Map();
    const g = el("div", { class: "grid" }, ...manifest!.canvases.map(tile));
    for (const c of manifest!.canvases) updateBadge(c.id);
    gridFor = { manifest: manifest!, urns, el: g };
    return g;
  }

  function tile(c: CanvasInfo): HTMLElement {
    const urn = urnFor(c);
    const img = el("img", { alt: "", loading: "lazy", decoding: "async" });
    const candidates = thumbCandidates(c);
    let k = 0;
    const b = el("button", {
      type: "button", class: `tile${urns && !urn ? " no-urn" : ""}`,
      title: urn ?? c.label, "data-canvas": c.id,
    }, img, el("span", { class: "tile-caption" }, c.label));
    img.addEventListener("error", () => {
      if (++k < candidates.length) img.src = candidates[k];
      else b.classList.add("broken");
    });
    if (candidates.length) img.src = candidates[0]; else b.classList.add("broken");
    b.addEventListener("click", () => {
      pushedCanvas = true;
      setHash(canvasHash(c));
    });
    tiles.set(c.id, b);
    return b;
  }

  function urnFor(c: CanvasInfo) { return urnForCanvas(urns?.map ?? null, c.id); }

  const app: App = {
    get manifest() { return manifest; },
    get urnMap() { return urns?.map ?? null; },
    urnFor,
    view,
    selections: () => [...store.values()],
    ready: Promise.resolve(),
    stop() { abort.abort(); view.destroy(); },
  };
  const abort = new AbortController();
  window.addEventListener("hashchange", () => { app.ready = sync(); }, { signal: abort.signal });
  app.ready = sync();
  return app;
}
