import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { extFor, isRawParam, pixelRegion, rawFileName } from "../lib/raw";
import { imageData, type ImageTools } from "../ui/raw-image";
import { startApp, type App } from "../ui/app";
import lips from "./fixtures/lips7-catalog.cex?raw";
import va from "./fixtures/hmt-venetusA-excerpt.json";
import hmtMap from "./fixtures/hmt-venetusA-urns.cex?raw";

const CAT = "https://shot.holycross.edu/images/mss/lipsius7/lips7.cex";
const DIR = "https://shot.holycross.edu/images/mss/lipsius7/";
const IMG1203 = `${DIR}leiden-pliny/IMG_1203.jpeg`;
const URN1203 = "urn:cite2:citeleiden:lipsius7.v1:IMG_1203";
const VA = "https://example.org/venetusA.json", VA_URNS = "https://example.org/venetusA-urns.cex";
const IIP = "http://www.homermultitext.org/iipsrv?IIIF=/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a";
const info = JSON.stringify({ "@context": "http://iiif.io/api/image/2/context.json", width: 5428, height: 7230, tiles: [{ width: 256, scaleFactors: [1, 2, 4] }] });

describe("names and pixels", () => {
  it("regions in whole pixels, raw=true/1, extensions", () => {
    expect(pixelRegion({ x: 0.4187, y: 0.3937, w: 0.1598, h: 0.0182 }, { w: 4032, h: 3024 })).toEqual({ x: 1688, y: 1191, w: 645, h: 55 });
    expect([isRawParam("true"), isRawParam("1"), isRawParam("yes"), isRawParam(undefined)]).toEqual([true, true, false, false]);
    expect([extFor("image/jpeg"), extFor("image/png; q=1"), extFor("")]).toEqual(["jpg", "png", "jpg"]);
  });
  it("file names: the catalog file as is; regions by URN object id; IIIF by URN or file name", () => {
    const base = { urn: URN1203, imageUrl: IMG1203, label: "signout card" };
    expect(rawFileName({ ...base, roi: null, ext: "jpg", keepFileName: true })).toBe("IMG_1203.jpeg");
    expect(rawFileName({ ...base, roi: { x: 0.4187, y: 0.3937, w: 0.1598, h: 0.0182 }, ext: "png" })).toBe("IMG_1203@0.4187,0.3937,0.1598,0.0182.png");
    expect(rawFileName({ urn: null, imageUrl: `${IIP}/VA001RN_0002.tif`, label: "x", roi: null, ext: "jpg" })).toBe("VA001RN_0002.jpg");
    expect(rawFileName({ urn: null, imageUrl: null, label: "folio 1, recto", roi: null, ext: "png" })).toBe("folio_1_recto.png");
  });
});

/** Stand-in browser tools (jsdom has no canvas): record what is fetched and cropped. */
function fakeTools(fail = false) {
  const fetched: string[] = [], cropped: string[] = [];
  const tools: ImageTools = {
    async fetchBlob(url) {
      fetched.push(url);
      if (fail) throw new Error(`Can't download ${url}: its server doesn't allow it from other sites (it must send Access-Control-Allow-Origin for images), or it can't be reached.`);
      return new Blob([`bytes of ${url}`], { type: "image/jpeg" });
    },
    async crop(blob, roi) { cropped.push(`${await blob.text()} @ ${roi.x},${roi.y},${roi.w},${roi.h}`); return new Blob(["png"], { type: "image/png" }); },
  };
  return { tools, fetched, cropped };
}

describe("image data", () => {
  it("catalog: the file, or a region cropped from it", async () => {
    const c = { id: "leiden-pliny/IMG_1203.jpeg", label: "card", width: 0, height: 0, service: null, imageUrl: IMG1203, thumbnail: null };
    const t = fakeTools();
    const whole = await imageData(c, null, URN1203, t.tools, vi.fn());
    expect([whole.name, await whole.blob.text()]).toEqual(["IMG_1203.jpeg", `bytes of ${IMG1203}`]);
    const part = await imageData(c, { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, URN1203, t.tools, vi.fn());
    expect(part.name).toBe("IMG_1203@0.1000,0.2000,0.3000,0.4000.png");
    expect(t.cropped).toEqual([`bytes of ${IMG1203} @ 0.1,0.2,0.3,0.4`]);
  });
  it("IIIF: the server cuts the region (from info.json's size)", async () => {
    const c = { id: "c", label: "1r", width: 1, height: 1, service: { id: `${IIP}/VA001RN_0002.tif`, version: 2 as const }, imageUrl: null, thumbnail: null };
    const t = fakeTools();
    const fetchFn = vi.fn(async () => new Response(info));
    const d = await imageData(c, { x: 0.5, y: 0.5, w: 0.25, h: 0.25 }, "urn:cite2:hmt:vaimg.2017a:VA001RN_0002", t.tools, fetchFn);
    expect(t.fetched).toEqual([`${IIP}/VA001RN_0002.tif/2714,3615,1357,1808/full/0/default.jpg`]);
    expect(t.cropped).toEqual([]);
    expect(d.name).toBe("VA001RN_0002@0.5000,0.5000,0.2500,0.2500.jpg");
  });
});

describe("raw=true links", () => {
  const routes: Record<string, string> = { [CAT]: lips, [VA]: JSON.stringify(va), [VA_URNS]: hmtMap, [`${IIP}/VA001RN_0002.tif/info.json`]: info };
  const server = () => vi.fn(async (url: string) => (url in routes ? new Response(routes[url]) : new Response("", { status: 404 })));
  const $ = (s: string) => document.querySelector(s) as HTMLElement;
  const $$ = (s: string) => [...document.querySelectorAll<HTMLElement>(s)];
  const tick = () => new Promise((r) => setTimeout(r, 0));
  let app: App, t: ReturnType<typeof fakeTools>;
  beforeEach(() => {
    document.body.innerHTML = `<div id="app"></div>`;
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:test/${++n}`);
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => { app?.stop(); vi.restoreAllMocks(); });
  async function visit(url: string, fail = false) {
    history.replaceState(null, "", url);
    t = fakeTools(fail);
    app = startApp({ root: $("#app"), fetch: server(), https: false, imageTools: t.tools });
    await tick(); await app.ready; await tick(); await app.raw.ready; await tick();
  }

  it("Neel's link with raw=true: just the region, cut from the catalog image, to download", async () => {
    await visit(`/iiif-cite.html?catalog=${CAT}&urn=${URN1203}@0.4187,0.3937,0.1598,0.0182&raw=true`);
    expect($(".bar").hidden).toBe(true);
    expect(app.view.isOpen).toBe(false);
    expect(t.fetched).toEqual([IMG1203]);
    expect(t.cropped).toEqual([`bytes of ${IMG1203} @ 0.4187,0.3937,0.1598,0.0182`]);
    expect($$(".raw-item img")).toHaveLength(1);
    expect($(".raw-item figcaption code").textContent).toBe(`${URN1203}@0.4187,0.3937,0.1598,0.0182`);
    const dl = $(".raw-download") as HTMLAnchorElement;
    expect([dl.getAttribute("href"), dl.download]).toEqual(["blob:test/1", "IMG_1203@0.4187,0.3937,0.1598,0.0182.png"]);
    const back = $(".raw-back") as HTMLAnchorElement;
    expect(back.getAttribute("href")).not.toContain("raw");
    expect(document.title).toBe("Leiden, MS Lipsius, signout card. · iiif-cite");
  });

  it("without a region: the whole file; several urn=: one crop each", async () => {
    await visit(`/iiif-cite.html?catalog=${CAT}&urn=${URN1203}&raw=1`);
    expect(t.cropped).toEqual([]);
    expect(($(".raw-download") as HTMLAnchorElement).download).toBe("IMG_1203.jpeg");
    app.stop(); document.body.innerHTML = `<div id="app"></div>`;
    await visit(`/iiif-cite.html?catalog=${CAT}&urn=${URN1203}@0.1,0.1,0.2,0.2&urn=${URN1203}@0.5,0.5,0.1,0.1&raw=true`);
    expect($$(".raw-item img")).toHaveLength(2);
    expect(t.cropped.map((s) => s.split(" @ ")[1])).toEqual(["0.1,0.1,0.2,0.2", "0.5,0.5,0.1,0.1"]);
  });

  it("IIIF manifests too (the IIIF server crops)", async () => {
    await visit(`/iiif-cite.html?manifest=${VA}&urns=${VA_URNS}&urn=urn:cite2:hmt:vaimg:VA001RN_0002@0.5,0.5,0.25,0.25&raw=true`);
    expect(t.fetched).toEqual([`${IIP}/VA001RN_0002.tif/2714,3615,1357,1808/full/0/default.jpg`]);
    expect($(".raw-item figcaption code").textContent).toBe("urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.5000,0.5000,0.2500,0.2500");
  });

  it("says why when the image server doesn't allow it", async () => {
    await visit(`/iiif-cite.html?catalog=${CAT}&urn=${URN1203}@0.1,0.1,0.2,0.2&raw=true`, true);
    expect($(".raw-status.error").textContent).toMatch(/must send Access-Control-Allow-Origin for images/);
  });

  it("raw=true without an image: a notice, and the normal page", async () => {
    await visit(`/iiif-cite.html?catalog=${CAT}&raw=true`);
    expect($(".bar").hidden).toBe(false);
    expect($(".notices").textContent).toContain("raw=true shows the data of one image");
  });

  it("the panel: Download image / Download region, and raw links", async () => {
    await visit(`/iiif-cite.html?catalog=${CAT}&urn=${URN1203}@0.1,0.1,0.2,0.2`);
    expect(app.view.isOpen).toBe(true);
    expect($(".copy-raw-link").dataset.url).toBe(`${location.origin}/iiif-cite.html?catalog=${CAT}&urn=${URN1203}&raw=true`);
    expect($(".sel-raw-link").dataset.url).toBe(`${location.origin}/iiif-cite.html?catalog=${CAT}&urn=${URN1203}@0.1000,0.1000,0.2000,0.2000&raw=true`);
    const saved: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { saved.push(this.download); });
    $(".download-image").click(); await tick(); await tick();
    $(".sel-download").click(); await tick(); await tick();
    expect(saved).toEqual(["IMG_1203.jpeg", "IMG_1203@0.1000,0.1000,0.2000,0.2000.png"]);
  });
});
