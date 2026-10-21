import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startApp, type App } from "../ui/app";
import va from "./fixtures/hmt-venetusA-excerpt.json";
import hmtMap from "./fixtures/hmt-venetusA-urns.cex?raw";

const M = "https://example.org/venetusA.json";
const U = "https://example.org/venetusA-urns.cex";
const IIP = "http://www.homermultitext.org/iipsrv?IIIF=/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a";
const info = JSON.stringify({ "@context": "http://iiif.io/api/image/2/context.json", "@id": `${IIP}/VA001RN_0002.tif`,
  width: 5428, height: 7230, tiles: [{ width: 256, scaleFactors: [1, 2, 4, 8, 16, 32] }] });
const routes: Record<string, string> = { [M]: JSON.stringify(va), [U]: hmtMap, [`${IIP}/VA001RN_0002.tif/info.json`]: info };
const server = () => vi.fn(async (url: string) => (url in routes ? new Response(routes[url]) : new Response("", { status: 404 })));
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const $$ = (s: string) => [...document.querySelectorAll(s)] as HTMLElement[];
const param = (k: string) => new URLSearchParams(location.hash.slice(1)).get(k);
const tick = () => new Promise((r) => setTimeout(r, 0));

let app: App;
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("zoom") ? 1000 : 0; });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("zoom") ? 800 : 0; });
  document.body.innerHTML = `<div id="app"></div>`;
});
afterEach(() => { app?.stop(); vi.restoreAllMocks(); });
async function visit(url: string) {
  history.replaceState(null, "", url);
  app = startApp({ root: $("#app"), fetch: server(), https: false });
  await tick(); await app.ready; await tick(); await app.view.ready;
}
const enc = encodeURIComponent;

describe("links by URN", () => {
  it("?manifest&urns&urn with a region opens the image with the region selected", async () => {
    await visit(`/iiif-cite.html?manifest=${M}&urns=${U}&urn=urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.1,0.2,0.3,0.4`);
    expect(location.search).toBe(""); // moved into the hash
    expect(param("canvas")).toBe("canvases/1r");
    expect(param("urn")).toBeNull();
    expect(param("roi")).toBe("0.1000,0.2000,0.3000,0.4000");
    expect(app.view.isOpen).toBe(true);
    expect(app.view.roi.list).toEqual([{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }]);
    expect($(".selections .sel-urn").textContent).toBe("urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.1000,0.2000,0.3000,0.4000");
  });

  it("a URN without version matches the map's version; the hash form works too", async () => {
    await visit(`/iiif-cite.html#manifest=${enc(M)}&urns=${enc(U)}&urn=${enc("urn:cite2:hmt:vaimg:VA001RN_0002")}`);
    expect(param("canvas")).toBe("canvases/1r");
    expect(param("roi")).toBeNull();
    expect(app.view.roi.list).toEqual([]);
  });

  it("explains a URN it can't find, and a link without a URN map", async () => {
    await visit(`/iiif-cite.html?manifest=${M}&urns=${U}&urn=urn:cite2:hmt:vaimg.2017a:NOPE`);
    expect(app.view.isOpen).toBe(false);
    expect($(".notices").textContent).toContain("No image with URN urn:cite2:hmt:vaimg.2017a:NOPE in the URN map for this manifest");
    app.stop(); document.body.innerHTML = `<div id="app"></div>`;
    await visit(`/iiif-cite.html?manifest=${M}&urn=urn:cite2:hmt:vaimg.2017a:VA001RN_0002`);
    expect($(".notices").textContent).toContain("needs a URN map (urns=…)");
  });

  it("Copy link gives links that come back to the same image and region", async () => {
    await visit(`/iiif-cite.html?manifest=${M}&urns=${U}&urn=urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.1,0.2,0.3,0.4`);
    const image = $(".info .copy-link").dataset.url!, region = $(".sel-link").dataset.url!;
    expect(image).toBe(`${location.origin}/iiif-cite.html?manifest=${M}&urns=${U}&urn=urn:cite2:hmt:vaimg.2017a:VA001RN_0002`);
    expect(region).toBe(`${location.origin}/iiif-cite.html?manifest=${M}&urns=${U}&urn=urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.1000,0.2000,0.3000,0.4000`);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    $(".sel-link").click(); await tick();
    expect(writeText).toHaveBeenCalledWith(region);
    expect($(".sel-link").textContent).toBe("Copied");
    // follow the copied link in a fresh page
    app.stop(); document.body.innerHTML = `<div id="app"></div>`;
    await visit(region.replace(location.origin, ""));
    expect(param("canvas")).toBe("canvases/1r");
    expect(app.view.roi.list).toEqual([{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }]);
  });

  it("without a URN (or with a map loaded from a file) links fall back to the canvas id", async () => {
    await visit(`/iiif-cite.html?manifest=${M}&canvas=canvases%2F1r&roi=0.1,0.1,0.2,0.2`);
    expect($(".info .copy-link").dataset.url).toBe(`${location.origin}/iiif-cite.html?manifest=${M}&canvas=canvases/1r`);
    expect($(".sel-link").dataset.url).toBe(`${location.origin}/iiif-cite.html?manifest=${M}&canvas=canvases/1r&roi=0.1000,0.1000,0.2000,0.2000`);
    expect($(".info .copy-link").title).toMatch(/it has no URN/);
  });
});

describe("several regions by URN", () => {
  const A = "urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.1857,0.1178,0.5239,0.0940";
  const B = "urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.2363,0.2212,0.4017,0.3234";
  it("repeated urn= opens the image with every region; roi= is ignored with urn=", async () => {
    await visit(`/iiif-cite.html?manifest=${M}&urns=${U}&urn=${A}&urn=${B}&roi=0.5,0.5,0.1,0.1`);
    expect(param("canvas")).toBe("canvases/1r");
    expect(param("roi")).toBe("0.1857,0.1178,0.5239,0.0940;0.2363,0.2212,0.4017,0.3234");
    expect(app.view.roi.list).toHaveLength(2);
    expect($$(".selections .sel-urn").map((e) => e.textContent)).toEqual([A, B]);
  });

  it("Copy link to all: one urn= per region, and it comes back the same", async () => {
    await visit(`/iiif-cite.html?manifest=${M}&urns=${U}&urn=${A}&urn=${B}`);
    const all = $(".sel-link-all");
    expect(all.textContent).toBe("Copy link to all");
    expect(all.dataset.url).toBe(`${location.origin}/iiif-cite.html?manifest=${M}&urns=${U}&urn=${A}&urn=${B}`);
    app.stop(); document.body.innerHTML = `<div id="app"></div>`;
    await visit(all.dataset.url!.replace(location.origin, ""));
    expect(app.view.roi.list.map((r) => [r.x, r.y])).toEqual([[0.1857, 0.1178], [0.2363, 0.2212]]);
  });

  it("only offered with more than one region; by canvas id when there is no URN", async () => {
    await visit(`/iiif-cite.html?manifest=${M}&urns=${U}&urn=${A}`);
    expect($(".sel-link-all")).toBeNull();
    app.stop(); document.body.innerHTML = `<div id="app"></div>`;
    await visit(`/iiif-cite.html?manifest=${M}&canvas=canvases%2Fir&roi=0.1,0.1,0.2,0.2;0.5,0.5,0.1,0.1`);
    expect($(".sel-link-all").dataset.url).toBe(`${location.origin}/iiif-cite.html?manifest=${M}&canvas=canvases/ir&roi=0.1000,0.1000,0.2000,0.2000;0.5000,0.5000,0.1000,0.1000`);
  });

  it("URNs on different images: opens the first, keeps the other regions with their image", async () => {
    const other = "urn:cite2:hmt:vaimg:VAMSFolio_i_rectoN_0001@0.1,0.1,0.2,0.2";
    await visit(`/iiif-cite.html?manifest=${M}&urns=${U}&urn=${A}&urn=${other}&urn=urn:cite2:hmt:vaimg.2017a:NOPE`);
    expect(param("canvas")).toBe("canvases/1r");
    expect(app.view.roi.list).toHaveLength(1);
    const notices = $(".notices").textContent!;
    expect(notices).toContain("No image with URN urn:cite2:hmt:vaimg.2017a:NOPE");
    expect(notices).toContain("The link cites 2 images; showing the first.");
    expect($(".info .panel-note").textContent).toContain("The link cites 2 images; showing the first.");
    expect(app.selections().map((s) => [s.canvas.id, s.rois.length])).toEqual(expect.arrayContaining([["canvases/ir", 1], ["canvases/1r", 1]]));
  });
});
