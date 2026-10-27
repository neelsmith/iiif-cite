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
 *
 * Image catalogs (lib/catalog.ts): #catalog=<url>[&thumbs=1] loads a delimited-text list of
 * images on a web server (paths relative to the catalog, each with its CITE2 URN) instead of
 * a manifest. The same URL box takes either; the content decides which it is, and the link
 * is corrected to say. Its images are shown like static-image canvases (id = path); the
 * catalog is its own URN map. The grid can be grouped by tag and filtered (lib/browse.ts;
 * group=, year=, place= are kept in the hash but not put in copied links).
 */
import { readHash, withHash } from "../lib/hash.ts";
import { loadSource, loadUrnMapUrl, type Fetch } from "../lib/load.ts";
import type { CatalogInfo } from "../lib/catalog.ts";
import { browse, facetValues, GROUP_MODES, type BrowseOptions, type Facet, type GroupMode } from "../lib/browse.ts";
import type { CanvasInfo, ManifestInfo } from "../lib/manifest.ts";
import type { Size } from "../lib/zoom.ts";
import { parseUrnMap, urnForCanvas, type UrnMap } from "../lib/urn-map.ts";
import { thumbCandidates, urnCoverage } from "../lib/canvases.ts";
import { formatRoi, formatRois, parseRois, roiUrn, type Roi } from "cite-roi";
import { fileStem, selectionKey, selectionsText, type CanvasSelections } from "../lib/selections.ts";
import { el } from "./dom.ts";
import { CanvasView } from "./canvas-view.ts";
import { RawView } from "./raw-view.ts";
import { browserImageTools, type ImageTools } from "./raw-image.ts";
import { isRawParam } from "../lib/raw.ts";
import { download } from "./clipboard.ts";
import { forPage, httpOrigins, HttpsUpgradeError, manifestForPage } from "../lib/https.ts";
import { UrnMapper } from "./urn-mapper.ts";
import { findByUrn, linkTo } from "../lib/urn-link.ts";
import type { ProjectConfig } from "../lib/project-config.mjs";

export interface AppOptions {
  root: HTMLElement;
  fetch?: Fetch;
  version?: string;
  /** Page served over https: request http URLs over https (default: from location.protocol). */
  https?: boolean;
  /**
   * A packaged project page (scripts/package.mjs): its title, and a menu of collections
   * (manifest + URN map) in place of the manifest and URN map inputs.
   */
  config?: ProjectConfig | null;
  /** Problems with the page's configuration block (shown; the generic app is used instead). */
  configErrors?: string[];
  /** Fetching and cropping image data (Download buttons, raw=true); default: the browser's. */
  imageTools?: ImageTools;
  /** Called whenever a canvas is shown in the viewer. */
  onOpen?: (c: CanvasInfo, index: number, app: App) => void;
}

export interface App {
  readonly manifest: ManifestInfo | null;
  readonly urnMap: UrnMap | null;
  /** The loaded image catalog, when the source is one (then `manifest` is its images). */
  readonly catalog: CatalogInfo | null;
  urnFor(c: CanvasInfo): string | null;
  readonly view: CanvasView;
  /** The raw=true page. */
  readonly raw: RawView;
  /** Every canvas with selections this session (all manifests). */
  selections(): CanvasSelections[];
  /** Remove window/document listeners (for tests, or before starting another app). */
  stop(): void;
  /** Resolves when the loads started by the current hash have finished. */
  ready: Promise<void>;
}

interface UrnSource { map: UrnMap; label: string; fromFile: boolean }

/**
 * Packaged page: open the default collection when the link names no manifest, and fill in a
 * collection's URN map when the link names its manifest without one.
 */
function applyDefaultCollection(config: ProjectConfig) {
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  const manifest = h.get("manifest"), catalog = h.get("catalog");
  const c = manifest || catalog
    ? config.collections.find((x) => (!!manifest && x.manifest === manifest) || (!!catalog && x.catalog === catalog))
    : config.collections[config.defaultIndex];
  if (!c) return; // a source from outside the project: shown as "Other"
  if (!manifest && !catalog) h.set(c.catalog ? "catalog" : "manifest", (c.catalog ?? c.manifest)!);
  if (c.catalog && c.thumbnails && !h.has("thumbs")) h.set("thumbs", "1");
  if (c.urns && !h.get("urns")) h.set("urns", c.urns);
  const hash = h.toString();
  if (`#${hash}` !== location.hash) history.replaceState(history.state, "", location.pathname + location.search + `#${hash}`);
}

/** Link parameters the app reads from the hash (and accepts in a ?query). */
const LINK_KEYS = ["manifest", "urns", "catalog", "thumbs", "urn", "canvas", "roi", "raw"];

/** A URL that names a delimited-text file, so probably an image catalog (the content decides). */
const catalogLike = (url: string) => { try { return /\.(cex|txt|csv|tsv)$/i.test(new URL(url).pathname); } catch { return false; } };

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
  const config = opts.config ?? null;
  const appTitle = config?.title ?? "iiif-cite";
  if (config) applyDefaultCollection(config);
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
  /** The source is an image catalog: its rows, URNs and the grid's grouping/filters. */
  let catalog: CatalogInfo | null = null;
  const browseOpts: BrowseOptions = { group: "none", query: "", year: "", place: "" };
  /** Catalog images shown in the grid, each once, in order (previous/next follow it). */
  let visibleOrder: CanvasInfo[] = [];
  let urns: UrnSource | null = null;
  let urnError = "";
  let loading = false;

  // ---- static chrome
  const manifestInput = el("input", { type: "url", name: "manifest", placeholder: "IIIF manifest or image catalog URL", required: true,
    "aria-label": "IIIF manifest or image catalog URL" });
  const thumbsBox = el("input", { type: "checkbox", name: "thumbs" });
  const manifestForm = el("form", { class: "load" }, manifestInput,
    el("label", { class: "thumbs", title: "For an image catalog: each folder of images has a _thumbs folder of thumbnails (<image name>.jpg)" },
      thumbsBox, " Thumbnails"),
    el("button", { type: "submit" }, "Load"));
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
  // Packaged page: a menu of the project's collections instead of the two inputs.
  const collectionMenu = el("select", { class: "collections", name: "collection", "aria-label": "Collection" });
  collectionMenu.addEventListener("change", () => {
    const c = config?.collections[Number(collectionMenu.value)];
    if (!c) return;
    if (mapping && mapper.dirty && !confirm("Open another collection without downloading the URN map? Your changes will be lost.")) {
      renderCollectionMenu();
      return;
    }
    pushedCanvas = false;
    setHash({ manifest: c.manifest, urns: c.urns, catalog: c.catalog, thumbs: c.catalog && c.thumbnails ? "1" : null,
      canvas: null, roi: null, urn: null, year: null, place: null });
  });
  const bar = el("header", { class: "bar" },
    el("h1", {}, appTitle),
    ...(config ? [collectionMenu] : [manifestForm, urnForm]),
    exportBtn,
    el("span", { class: "version" }, opts.version ? `${config ? "iiif-cite " : ""}v${opts.version}` : ""));
  const main = el("main", { class: "content" });
  const view = new CanvasView({
    fetch: fetchFn,
    onStep: (dir) => step(dir),
    onClose: () => close(),
    linkFor: (c, r) => linkFor(c, r),
    imageTools: opts.imageTools,
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
  let tiles = new Map<string, HTMLElement[]>();
  root.replaceChildren(bar, main, view.el);
  /** The open canvas was opened from the grid in this page, so Back returns to the grid. */
  let pushedCanvas = false;

  manifestForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (mapping && mapper.dirty && !confirm("Load another manifest without downloading the URN map? Your changes will be lost.")) return;
    pushedCanvas = false;
    // A guess from the file name; once loaded, the content decides (and the link is corrected).
    const url = manifestInput.value.trim(), cat = catalogLike(url);
    setHash({ manifest: cat ? null : url, catalog: cat ? url : null, thumbs: thumbsBox.checked ? "1" : null,
      ...(cat ? { urns: null } : {}), canvas: null, roi: null, year: null, place: null });
  });
  thumbsBox.addEventListener("change", () => {
    if (catalog && readHash(location.hash).catalog) setHash({ thumbs: thumbsBox.checked ? "1" : null });
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

  /** The images previous/next step through: a catalog's shown images (if c is among them), else all. */
  function navList(c: CanvasInfo): CanvasInfo[] {
    return catalog && visibleOrder.some((x) => x.id === c.id) ? visibleOrder : manifest?.canvases ?? [];
  }

  function step(dir: -1 | 1) {
    const c = view.canvas;
    if (!manifest || !c) return;
    const list = navList(c);
    const i = list.findIndex((x) => x.id === c.id) + dir;
    if (i >= 0 && i < list.length) setHash(canvasHash(list[i]), true);
  }

  function close() {
    if (pushedCanvas) { pushedCanvas = false; history.back(); }
    else setHash({ canvas: null, roi: null }, true);
  }

  function updateBadge(id: string) {
    const n = store.get(selectionKey(manifestUrl, id))?.rois.length ?? 0;
    for (const t of tiles.get(id) ?? []) {
      if (n) t.dataset.selections = String(n); else delete t.dataset.selections;
    }
  }

  function updateExport() {
    const n = [...store.values()].reduce((a, e) => a + e.rois.length, 0);
    exportBtn.textContent = n ? `Export selections (${n})` : "Export selections";
    exportBtn.disabled = n === 0;
  }

  // ---- hash → state
  let lastSource = "", lastUrns = "";
  /** What the hash asks for: a catalog (catalog=, thumbs=) or a manifest. */
  const sourceIn = (h: Record<string, string>) => {
    const asCatalog = !!h.catalog;
    const url = (asCatalog ? h.catalog : h.manifest) ?? "";
    const thumbs = h.thumbs === "1";
    return { url, thumbs, asCatalog, key: `${asCatalog ? "catalog" : "manifest"} ${thumbs} ${url}` };
  };
  async function sync(): Promise<void> {
    const h = readHash(location.hash);
    const jobs: Promise<void>[] = [];
    const src = sourceIn(h);
    if (src.key !== lastSource) {
      lastSource = src.key;
      manifestInput.value = src.url;
      thumbsBox.checked = src.thumbs;
      jobs.push(loadM(src.url, src.thumbs, src.asCatalog));
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
      const found = findByUrn(manifest.canvases, catalog?.urnMap ?? urns?.map ?? null, urn);
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
    const map = catalog ? manifestUrl : urnsUrl();
    const head: [string, string | null][] = catalog
      ? [["catalog", manifestUrl], ["thumbs", catalog.thumbs ? "1" : null]]
      : [["manifest", manifestUrl], ["urns", map]];
    if (urn && map) {
      const cites: [string, string][] = rois.length ? rois.map((r) => ["urn", roiUrn(urn, r)]) : [["urn", urn]];
      return { url: linkTo(base, [...head, ...cites]), byUrn: true };
    }
    return { url: linkTo(base, [...head, ["canvas", c.id], ["roi", rois.length ? formatRois(rois) : null]]), byUrn: false };
  }

  async function loadM(url: string, thumbs: boolean, asCatalog: boolean) {
    manifest = null; catalog = null; manifestError = ""; manifestUrl = url;
    mapping = false; mapper.dirty = false;
    loadingWhat = asCatalog ? "catalog" : "manifest";
    if (!url) return;
    loading = true; render();
    try {
      const src = await loadSource(url, fetchFn, thumbs);
      if (manifestUrl === url) {
        const m = src.kind === "catalog" ? src.catalog.manifest : src.manifest;
        if (pageIsHttps) for (const o of httpOrigins(m)) upgradedOrigins.add(o);
        manifest = manifestForPage(m, pageIsHttps);
        if (src.kind === "catalog") {
          catalog = { ...src.catalog, manifest };
          startBrowsing();
        }
        // The link says which kind of source this is (the URL box takes either).
        const isCatalog = src.kind === "catalog";
        if (isCatalog !== asCatalog || (!isCatalog && thumbs)) {
          history.replaceState(history.state, "", withHash(location.hash, {
            manifest: isCatalog ? null : url, catalog: isCatalog ? url : null, thumbs: isCatalog && thumbs ? "1" : null }));
          lastSource = sourceIn(readHash(location.hash)).key;
          if (!isCatalog) thumbsBox.checked = false;
        }
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
    const list = navList(c);
    const e = catalog?.entries.get(c.id);
    const details: [string, string][] | undefined = e ? ([["Caption", e.caption], ["Tags", e.tags.join(", ")], ["Year", e.year],
      ["Place", e.place], ["Credits", e.credits], ["License", e.license]] as [string, string][]).filter(([, v]) => v.trim()) : undefined;
    view.show({ canvas: c, index: list.findIndex((x) => x.id === c.id), count: list.length, urn: urnFor(c),
      haveUrnMap: !!urns || !!catalog, rois, catalog: !!catalog, details });
    if (opening) opts.onOpen?.(c, i, app);
  }

  // ---- raw=true: just the image data (whole image, or each cited region)
  const rawView = new RawView(opts.imageTools ?? browserImageTools(fetchFn), fetchFn);
  /** The canvas a raw=true link names (after urn= has been resolved), if any. */
  function rawCanvas(): CanvasInfo | null {
    const h = readHash(location.hash);
    if (!isRawParam(h.raw) || !manifest || !h.canvas) return null;
    return manifest.canvases.find((c) => c.id === h.canvas) ?? null;
  }
  function renderRaw(c: CanvasInfo): void {
    const h = readHash(location.hash);
    if (view.isOpen) view.hide();
    bar.hidden = true;
    document.body.classList.add("raw-page");
    const back = withHash(location.hash, { raw: null });
    rawView.show({ canvas: c, rois: parseRois(h.roi ?? ""), urn: urnFor(c), backUrl: `${location.pathname}${location.search}${back}` });
    main.replaceChildren(rawView.el);
    document.title = `${c.label} · ${appTitle}`;
  }

  // ---- render
  function render() {
    const raw = rawCanvas();
    if (raw) { renderRaw(raw); return; }
    if (bar.hidden) { bar.hidden = false; document.body.classList.remove("raw-page"); rawView.clear(); }
    main.replaceChildren(...content());
    updateExport();
    syncCanvas();
    document.title = manifest?.label ? `${manifest.label} · ${appTitle}` : appTitle;
    urnForm.hidden = !!catalog; // a catalog carries its own URNs
    renderCollectionMenu();
  }

  function content(): Node[] {
    const out: Node[] = [];
    const notices: (Node | string)[] = [];
    if (manifestError) notices.push(manifestError);
    if (urnError && !catalog) notices.push(`URN map: ${urnError}`);
    notices.push(...urnLinkErrors);
    { const h = readHash(location.hash);
      if (isRawParam(h.raw) && manifest && !loading && !h.canvas && !h.urn && !urnLinkErrors.length)
        notices.push("raw=true shows the data of one image: add urn= (or canvas=) to the link"); }
    if (manifest) {
      notices.push(...manifest.errors);
      const id = readHash(location.hash).canvas;
      if (id && !manifest.canvases.some((c) => c.id === id)) notices.push(catalog ? `No image ${id} in this catalog` : `No canvas ${id} in this manifest`);
    }
    if (urns && !catalog) {
      notices.push(...urns.map.errors.map((e) => `URN map ${urns!.label}: ${e}`));
      if (manifest) {
        const unknown = urnCoverage(manifest, urns.map).unknownCanvases;
        if (unknown.length) notices.push(`URN map ${urns.label}: ${unknown.length} canvas id(s) not in this manifest, e.g. ${unknown[0]}`);
      }
    }
    if (opts.configErrors?.length) notices.unshift(`This page's project configuration can't be used: ${opts.configErrors.join("; ")}`);
    if (notices.length) out.push(el("div", { class: "notices", role: "status" }, el("ul", {}, ...notices.map((n) => el("li", {}, n)))));

    if (!manifestUrl) {
      out.push(el("p", { class: "empty" }, "Enter the URL of a IIIF manifest (Presentation API 2.x or 3.0) or of an image catalog (.cex)."));
      return out;
    }
    if (loading) { out.push(el("p", { class: "empty" }, `Loading ${loadingWhat}…`)); return out; }
    if (!manifest) return out;
    if (catalog) {
      const withUrn = manifest.canvases.filter((c) => urnFor(c)).length;
      out.push(el("div", { class: "manifest-head" },
        el("h2", {}, manifest.label),
        el("span", { class: "count" }, `${manifest.canvases.length} images · ${withUrn} with URNs${catalog.thumbs ? "" : " · no thumbnails"}`)));
      if (gridFor?.manifest !== manifest) refreshCatalogGrid();
      out.push(browseBar, gridHost);
      return out;
    }

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

  // ---- catalog grid: grouped and filtered (the bar's controls persist, so typing keeps focus)
  const groupSeg = el("div", { class: "seg", role: "radiogroup", "aria-label": "Group by" });
  for (const m of GROUP_MODES) {
    const b = el("button", { type: "button", role: "radio", "data-mode": m.mode }, m.label);
    b.addEventListener("click", () => { browseOpts.group = m.mode; keepBrowseHash(); refreshCatalogGrid(); });
    groupSeg.append(b);
  }
  const facetSelect = (facet: Facet, label: string, any: string) => {
    const s = el("select", { class: "facet-select", name: facet, "aria-label": label });
    s.dataset.any = any;
    s.addEventListener("change", () => { browseOpts[facet] = s.value; keepBrowseHash(); refreshCatalogGrid(); });
    return s;
  };
  const facetSels: Record<Facet, HTMLSelectElement> = {
    year: facetSelect("year", "Year", "All years"),
    place: facetSelect("place", "Place", "All places"),
  };
  const search = el("input", { type: "search", name: "filter", placeholder: "Filter…", "aria-label": "Filter images" });
  search.addEventListener("input", () => { browseOpts.query = search.value; refreshCatalogGrid(); });
  const shownCount = el("span", { class: "count" });
  const browseBar = el("div", { class: "browse" }, groupSeg, facetSels.year, facetSels.place, search, shownCount);
  const gridHost = el("div", { class: "groups" });

  /** A catalog was loaded: grouping and drop-downs from the hash (values it doesn't have are dropped). */
  function startBrowsing() {
    const h = readHash(location.hash);
    browseOpts.group = GROUP_MODES.some((m) => m.mode === h.group) ? (h.group as GroupMode) : "none";
    browseOpts.query = search.value = "";
    for (const f of ["year", "place"] as Facet[]) {
      const values = facetValues(catalog!, f);
      browseOpts[f] = values.includes(h[f] ?? "") ? h[f] : "";
      const s = facetSels[f];
      s.replaceChildren(new Option(s.dataset.any!, ""), ...values.map((v) => new Option(v, v)));
      s.value = browseOpts[f];
      s.hidden = values.length === 0;
    }
    keepBrowseHash();
  }

  function keepBrowseHash() {
    const next = withHash(location.hash, { group: browseOpts.group === "none" ? null : browseOpts.group,
      year: browseOpts.year || null, place: browseOpts.place || null });
    if (next !== location.hash) history.replaceState(history.state, "", next || location.pathname + location.search);
  }

  function refreshCatalogGrid() {
    if (!catalog || !manifest) return;
    const b = browse(catalog, browseOpts);
    visibleOrder = b.order;
    tiles = new Map();
    cells = new Map();
    groupSeg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x.dataset.mode === browseOpts.group)));
    gridHost.replaceChildren(...(b.groups.length ? b.groups.map((g) => el("section", { class: "group" },
      ...(g.label ? [el("h3", {}, g.label, el("span", { class: "n" }, String(g.canvases.length)))] : []),
      el("div", { class: "grid" }, ...g.canvases.map(tile)))) : [el("p", { class: "empty" }, "No images match the filter.")]));
    for (const c of b.order) updateBadge(c.id);
    const total = manifest.canvases.length;
    shownCount.textContent = b.order.length === total ? "" : `${b.order.length} of ${total} shown`;
    gridFor = { manifest, urns, el: gridHost };
    // Previous/next and "n / m" in an open view follow what is shown.
    if (view.isOpen) syncCanvas();
  }

  function tile(c: CanvasInfo): HTMLElement {
    const urn = urnFor(c);
    const img = el("img", { alt: "", loading: "lazy", decoding: "async" });
    const candidates = thumbCandidates(c);
    let k = 0;
    const b = el("button", {
      type: "button", class: `tile${(urns || catalog) && !urn ? " no-urn" : ""}`,
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
    tiles.set(c.id, [...(tiles.get(c.id) ?? []), b]);
    // The draft URN under the thumbnail (shown in Map URNs mode); click to edit.
    const urnLine = el("button", { type: "button", class: "tile-urn", title: "Change this URN" });
    urnLine.addEventListener("click", () => editUrn(c, cell));
    const cell = el("div", { class: "cell" }, b, urnLine);
    cells.set(c.id, cell);
    return cell;
  }

  /** What is loading, for the "Loading …" message. */
  let loadingWhat = "manifest";
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

  /** The collection menu, showing the open manifest (or "Other: …" for one not in the project). */
  function renderCollectionMenu() {
    if (!config) return;
    const h = readHash(location.hash);
    const current = (h.catalog ?? h.manifest) ?? "";
    const i = config.collections.findIndex((c) => (h.catalog ? c.catalog : c.manifest) === current);
    const options = config.collections.map((c, k) => el("option", { value: String(k), selected: k === i }, c.label));
    if (i < 0 && current) options.push(el("option", { value: "other", selected: true, disabled: true }, `Other: ${manifest?.label || current}`));
    collectionMenu.replaceChildren(...options);
  }

  function urnFor(c: CanvasInfo) { return urnForCanvas(catalog ? catalog.urnMap : urns?.map ?? null, c); }

  const app: App = {
    get manifest() { return manifest; },
    get urnMap() { return catalog?.urnMap ?? urns?.map ?? null; },
    get catalog() { return catalog; },
    urnFor,
    view,
    selections: () => [...store.values()],
    raw: rawView,
    ready: Promise.resolve(),
    stop() { abort.abort(); view.destroy(); },
  };
  const abort = new AbortController();
  window.addEventListener("hashchange", () => { app.ready = sync(); }, { signal: abort.signal });
  app.ready = sync();
  return app;
}
