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
 *
 * Links by URN: urn=<CITE2 URN>[@x,y,w,h] (with manifest= and urns=) opens the canvas whose image
 * has that URN in the URN map, with the region selected; a URN without a version matches any
 * version. urn= may be repeated, one citation each (several regions on one image). With urn=,
 * any roi= in the link is ignored: regions come from the URNs. Links may use ?… (query) or #…;
 * a query is moved into the hash on arrival, and urn= becomes canvas=/roi= once resolved.
 * "Copy link" / "Copy link to all" in the canvas view make such links.
 */
import { readHash, withHash } from "../lib/hash.ts";
import { loadManifest, loadUrnMapUrl, type Fetch } from "../lib/load.ts";
import type { CanvasInfo, ManifestInfo } from "../lib/manifest.ts";
import type { Size } from "../lib/zoom.ts";
import { parseUrnMap, urnForCanvas, type UrnMap } from "../lib/urn-map.ts";
import { thumbCandidates, urnCoverage } from "../lib/canvases.ts";
import { formatRoi, formatRois, parseRois, roiUrn, type Roi } from "cite-roi";
import { fileStem, selectionKey, selectionsText, type CanvasSelections } from "../lib/selections.ts";
import { el } from "./dom.ts";
import { CanvasView } from "./canvas-view.ts";
import { download } from "./clipboard.ts";
import { forPage, httpOrigins, HttpsUpgradeError, manifestForPage } from "../lib/https.ts";
import { UrnMapper } from "./urn-mapper.ts";
import { findByUrn, linkTo } from "../lib/urn-link.ts";

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

/** Link parameters the app reads from the hash (and accepts in a ?query). */
const LINK_KEYS = ["manifest", "urns", "urn", "canvas", "roi"];

/** Move link parameters from the query string into the hash (query wins), without reloading. */
function queryToHash() {
  const q = new URLSearchParams(location.search);
  const keys = LINK_KEYS.filter((k) => q.has(k));
  if (!keys.length) return;
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  for (const k of keys) {
    h.delete(k);
    for (const v of q.getAll(k)) h.append(k, v); // urn= may repeat
    q.delete(k);
  }
  const rest = q.toString(), hash = h.toString();
  history.replaceState(history.state, "", location.pathname + (rest ? `?${rest}` : "") + (hash ? `#${hash}` : ""));
}

export function startApp(opts: AppOptions): App {
  queryToHash();
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
    linkFor: (c, r) => linkFor(c, r),
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
  // ---- Map URNs mode (grid): draft a URN map with a rule + hand edits, download it.
  let mapping = false;
  const mapper = new UrnMapper({
    onChange: () => refreshUrnCells(),
    onDownload: (text, name) => {
      download(text, name);
      // The downloaded map becomes the active URN map (like loading it from a file).
      urns = { map: parseUrnMap(text), label: name, fromFile: true };
      urnError = "";
      if (readHash(location.hash).urns) history.replaceState(history.state, "", withHash(location.hash, { urns: null }));
      mapper.setExisting(urns.map);
      render();
    },
    onDone: () => setMapping(false),
  });
  function setMapping(on: boolean) {
    if (on && manifest) mapper.open(manifest.canvases, urns?.map ?? null, manifest.label || manifest.id, manifestUrl);
    if (!on && mapper.dirty && !confirm("Leave without downloading the URN map? Your changes will be lost.")) return;
    if (!on) mapper.dirty = false;
    mapping = on && !!manifest;
    render();
  }
  window.addEventListener("beforeunload", (e) => { if (mapping && mapper.dirty) e.preventDefault(); });

  /** Selections this session, keyed by manifest URL + canvas id. */
  const store = new Map<string, CanvasSelections>();
  /** Grid tiles of the current manifest, by canvas id (for the selection-count badges). */
  let tiles = new Map<string, HTMLElement>();
  root.replaceChildren(bar, main, view.el);
  /** The open canvas was opened from the grid in this page, so Back returns to the grid. */
  let pushedCanvas = false;

  manifestForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (mapping && mapper.dirty && !confirm("Load another manifest without downloading the URN map? Your changes will be lost.")) return;
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
    resolveUrn();
  }

  /** Problems with the urn= in the link, shown as notices. */
  let urnLinkErrors: string[] = [];

  /**
   * urn=… in the link: once the manifest (and URN map) are loaded, open the canvas it names,
   * adding its region to the canvas's selections. Replaces urn= with canvas=/roi=.
   */
  function resolveUrn() {
    const wanted = new URLSearchParams(location.hash.replace(/^#/, "")).getAll("urn").filter((u) => u.trim());
    if (!wanted.length) { if (urnLinkErrors.length) { urnLinkErrors = []; render(); } return; }
    if (!manifest || loading) return; // manifest failed or still loading: its own notice says so
    // Each urn= is one citation: an image, or a region on it. Group the regions by canvas.
    const errors: string[] = [];
    const byCanvas = new Map<number, Roi[]>(); // in link order
    for (const urn of wanted) {
      const found = findByUrn(manifest.canvases, urns?.map ?? null, urn);
      if (!found.ok) { if (!errors.includes(found.error)) errors.push(found.error); continue; }
      if (!byCanvas.has(found.index)) byCanvas.set(found.index, []);
      if (found.roi) byCanvas.get(found.index)!.push(found.roi);
    }
    const add = (c: CanvasInfo, extra: Roi[]) => {
      const rois = [...storedRois(c)];
      for (const r of extra) if (!rois.some((x) => formatRoi(x) === formatRoi(r))) rois.push(r);
      return rois;
    };
    const [first, ...others] = [...byCanvas.keys()];
    // Regions on further images are kept with those images (badged in the grid).
    for (const i of others) {
      const c = manifest.canvases[i];
      setRois(c, add(c, byCanvas.get(i)!), null);
    }
    if (others.length) errors.push(`The link cites ${byCanvas.size} images; showing the first. ` +
      "Regions on the others are kept with them (numbered in the grid).");
    urnLinkErrors = errors;
    if (first === undefined) {
      history.replaceState(history.state, "", withHash(location.hash, { urn: null, roi: null }) || location.pathname);
      render();
      return;
    }
    const c = manifest.canvases[first];
    const rois = add(c, byCanvas.get(first)!);
    pushedCanvas = false;
    history.replaceState(history.state, "",
      withHash(location.hash, { urn: null, canvas: c.id, roi: rois.length ? formatRois(rois) : null }));
    render();
    // The grid's notices are hidden behind the canvas view: repeat them there.
    if (errors.length) view.setNote(errors.join(" "));
  }

  /** The URN map's URL, if it came from one (a local file can't go in a link). */
  const urnsUrl = () => (urns && !urns.fromFile ? urns.label : null);

  /**
   * A link to a canvas (and region): by URN when the canvas has one and the URN map has a URL,
   * otherwise by canvas id (and roi=).
   */
  function linkFor(c: CanvasInfo, rois: Roi[]): { url: string; byUrn: boolean } {
    const base = location.href.replace(/[?#].*$/, "");
    const urn = urnFor(c);
    const map = urnsUrl();
    const head: [string, string | null][] = [["manifest", manifestUrl], ["urns", map]];
    if (urn && map) {
      const cites: [string, string][] = rois.length ? rois.map((r) => ["urn", roiUrn(urn, r)]) : [["urn", urn]];
      return { url: linkTo(base, [...head, ...cites]), byUrn: true };
    }
    return { url: linkTo(base, [...head, ["canvas", c.id], ["roi", rois.length ? formatRois(rois) : null]]), byUrn: false };
  }

  async function loadM(url: string) {
    manifest = null; manifestError = ""; manifestUrl = url;
    mapping = false; mapper.dirty = false;
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
    notices.push(...urnLinkErrors);
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
    const mapBtn = el("button", { type: "button", class: "map-urns", "aria-pressed": String(mapping),
      title: "Give the images in this manifest CITE2 URNs and download the URN map" }, "Map URNs");
    mapBtn.addEventListener("click", () => setMapping(!mapping));
    out.push(el("div", { class: "manifest-head" },
      el("h2", {}, manifest.label || manifest.id),
      el("span", { class: "count" },
        `${manifest.canvases.length} canvases`,
        cov ? ` · ${cov.withUrn} with URNs (${urns!.label}${urns!.fromFile ? ", local file — not in the link" : ""})` : ""),
      mapBtn));
    if (mapping) out.push(mapper.el);
    const g = grid();
    g.classList.toggle("mapping", mapping);
    out.push(g);
    if (mapping) refreshUrnCells();
    return out;
  }

  /** The thumbnail grid, rebuilt only when the manifest or URN map changes. */
  let gridFor: { manifest: ManifestInfo; urns: UrnSource | null; el: HTMLElement } | null = null;
  function grid(): HTMLElement {
    if (gridFor && gridFor.manifest === manifest && gridFor.urns === urns) return gridFor.el;
    tiles = new Map();
    cells = new Map();
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
    // The draft URN under the thumbnail (shown in Map URNs mode); click to edit.
    const urnLine = el("button", { type: "button", class: "tile-urn", title: "Change this URN" });
    urnLine.addEventListener("click", () => editUrn(c, cell));
    const cell = el("div", { class: "cell" }, b, urnLine);
    cells.set(c.id, cell);
    return cell;
  }

  /** Grid cells (thumbnail + URN line) by canvas id. */
  let cells = new Map<string, HTMLElement>();

  /** Show the mapper's draft URN under each thumbnail. */
  function refreshUrnCells() {
    if (!manifest || !mapping) return;
    manifest.canvases.forEach((c, i) => {
      const cell = cells.get(c.id);
      const line = cell?.querySelector<HTMLElement>(".tile-urn");
      const d = mapper.drafts[i];
      if (!line || !d || cell!.querySelector(".urn-edit")) return;
      const id = d.urn ? d.urn.slice(d.urn.lastIndexOf(":") + 1) : "";
      line.textContent = d.urn ? id : "no URN";
      line.title = d.urn ? `${d.urn}${d.from === "hand" ? " (set by hand)" : d.from === "map" ? " (from the loaded map)" : ""} — click to change` : "Click to give this image a URN";
      line.className = `tile-urn${d.problem ? ` ${d.problem}` : ""}${d.from !== "rule" ? ` ${d.from}` : ""}`;
    });
  }

  /** Inline editor under a thumbnail: the URN, and (numbering rule) where counting restarts. */
  function editUrn(c: CanvasInfo, cell: HTMLElement) {
    if (!manifest) return;
    const i = manifest.canvases.indexOf(c);
    const d = mapper.drafts[i];
    const input = el("input", { type: "text", name: "urn", value: d?.urn ?? mapper.rule.collection, spellcheck: "false", "aria-label": `URN for ${c.label}` });
    const count = mapper.rule.kind === "number"
      ? el("input", { type: "number", name: "count", value: d?.n ?? mapper.rule.start, title: "Number this image (later ones follow on)", "aria-label": "Number from here" })
      : null;
    const btn = (label: string, title: string, fn: () => void) => {
      const b = el("button", { type: "button", title }, label);
      b.addEventListener("click", fn);
      return b;
    };
    const close = () => { box.remove(); refreshUrnCells(); };
    const save = () => {
      const counted = count ? Number(count.value) : null;
      if (count && counted !== d?.n) mapper.restartAt(c.id, counted);
      if (input.value.trim() !== (d?.urn ?? "")) mapper.setHand(c.id, input.value.trim());
      close();
    };
    const box = el("div", { class: "urn-edit" }, input,
      ...(count ? [el("label", {}, "number from here ", count)] : []),
      btn("✓", "Save (Enter)", save),
      btn("Rule", "Use the rule for this image again", () => { mapper.setHand(c.id, null); mapper.restartAt(c.id, null); close(); }),
      btn("✕", "Cancel (Esc)", close));
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); save(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    });
    cell.append(box);
    input.focus();
    input.select();
  }

  function urnFor(c: CanvasInfo) { return urnForCanvas(urns?.map ?? null, c); }

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
