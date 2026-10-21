import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { forPage, httpOrigins, manifestForPage, toHttps } from "../lib/https";
import { parseManifest } from "../lib/manifest";
import { startApp, type App } from "../ui/app";
import va from "./fixtures/hmt-venetusA-excerpt.json";

const IIP = "www.homermultitext.org/iipsrv?IIIF=/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a";

describe("http URLs on an https page", () => {
  it("upgrades only http", () => {
    expect(toHttps("http://a.org/x")).toBe("https://a.org/x");
    expect(toHttps("https://a.org/x")).toBe("https://a.org/x");
    expect(toHttps("file:///x")).toBe("file:///x");
    expect(forPage("http://a.org/x", false)).toBe("http://a.org/x");
  });
  it("puts every image URL of a manifest on https (only for https pages)", () => {
    const m = parseManifest(va);
    expect(manifestForPage(m, false)).toBe(m);
    const c = manifestForPage(m, true).canvases[2];
    expect(c.service?.id).toBe(`https://${IIP}/VA001RN_0002.tif`);
    expect(c.imageUrl).toMatch(/^https:\/\/www\.homermultitext\.org\//);
    expect(m.canvases[2].service?.id).toBe(`http://${IIP}/VA001RN_0002.tif`); // original untouched
    expect([...httpOrigins(m)]).toEqual(["http://www.homermultitext.org"]);
  });
});

describe("app served over https (e.g. GitHub Pages) with HMT's http manifest", () => {
  const M = "http://example.org/venetusA.json";
  const info = (id: string) => JSON.stringify({ "@context": "http://iiif.io/api/image/2/context.json", "@id": id,
    width: 5428, height: 7230, tiles: [{ width: 256, scaleFactors: [1, 2, 4, 8, 16, 32] }] });
  let app: App;
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("zoom") ? 1000 : 0; });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("zoom") ? 800 : 0; });
    document.body.innerHTML = `<div id="app"></div>`;
  });
  afterEach(() => { app?.stop(); vi.restoreAllMocks(); });
  const settle = async () => { await new Promise((r) => setTimeout(r, 0)); await app.ready; await app.view.ready; };

  it("requests manifest, info.json, tiles and thumbnails over https", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === "https://example.org/venetusA.json") return new Response(JSON.stringify(va));
      if (url === `https://${IIP}/VA001RN_0002.tif/info.json`) return new Response(info(`https://${IIP}/VA001RN_0002.tif`));
      if (url.startsWith("http://")) throw new TypeError("Failed to fetch"); // what the browser does
      return new Response("", { status: 404 });
    });
    history.replaceState(null, "", `/#manifest=${encodeURIComponent(M)}&canvas=canvases%2F1r`);
    app = startApp({ root: document.querySelector("#app") as HTMLElement, fetch, https: true });
    await settle();
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(["https://example.org/venetusA.json", `https://${IIP}/VA001RN_0002.tif/info.json`]);
    expect(app.view.imageSize).toEqual({ w: 5428, h: 7230 });
    expect(app.view.viewer.tileUrls.every((u) => u.startsWith(`https://${IIP}/`))).toBe(true);
    expect((document.querySelector(".zoom-base") as HTMLImageElement).src).toMatch(/^https:/);
    expect([...document.querySelectorAll(".tile img")].every((i) => (i as HTMLImageElement).src.startsWith("https://"))).toBe(true);
    // "View this region" links are https too
    expect(app.view.roi.list).toEqual([]);
  });

  it("explains when a server has no https", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === "https://example.org/venetusA.json") return new Response(JSON.stringify(va));
      throw new TypeError("Failed to fetch");
    });
    history.replaceState(null, "", `/#manifest=${encodeURIComponent(M)}&canvas=canvases%2F1r`);
    app = startApp({ root: document.querySelector("#app") as HTMLElement, fetch, https: true });
    await settle();
    expect(document.querySelector(".stage-message")?.textContent).toBe(
      `Could not load image: Could not reach https://${IIP}/VA001RN_0002.tif/info.json. The server lists only http ` +
      `(http://${IIP}/VA001RN_0002.tif/info.json), and this page is served over https, so the browser won't load it over http. ` +
      "Open iiif-cite from a local file or an http address instead.");
  });

  it("leaves http alone on an http or file page", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(va)));
    history.replaceState(null, "", `/#manifest=${encodeURIComponent(M)}`);
    app = startApp({ root: document.querySelector("#app") as HTMLElement, fetch, https: false });
    await settle();
    expect(fetch).toHaveBeenCalledWith(M);
    expect((document.querySelector(".tile img") as HTMLImageElement).src).toMatch(/^http:\/\/www\.homermultitext/);
  });
});
