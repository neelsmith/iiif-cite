import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startApp, type App } from "../ui/app";
import goe from "./fixtures/goettingen-PPN623133725-excerpt.json";
import goeInfo from "./fixtures/goettingen-00000001-info.json";

const M = "https://manifests.sub.uni-goettingen.de/iiif/presentation/PPN623133725/manifest";
const CANVAS = "https://manifests.sub.uni-goettingen.de/iiif/presentation/PPN623133725/canvas/gdz:PPN623133725:";
const IMG = "https://images.sub.uni-goettingen.de/iiif/image/gdz:PPN623133725:";
const info = (n: string) => JSON.stringify({ ...goeInfo, "@id": `${IMG}${n}` });
const routes: Record<string, string> = {
  [M]: JSON.stringify(goe),
  [`${IMG}00000001/info.json`]: info("00000001"),
  [`${IMG}00000002/info.json`]: info("00000002"),
  [`${IMG}00000025/info.json`]: info("00000025"),
};
const server = () => vi.fn(async (url: string) => (url in routes ? new Response(routes[url]) : new Response("", { status: 404 })));

const $ = (s: string) => document.querySelector(s);
const $$ = (s: string) => [...document.querySelectorAll(s)];
const tick = () => new Promise((r) => setTimeout(r, 0));
const canvasParam = () => new URLSearchParams(location.hash.slice(1)).get("canvas");
const key = (k: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
async function settle(app: App) { await tick(); await app.ready; await app.view.ready; }

// jsdom has no layout: give the viewer a 1000 × 800 stage.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("zoom") ? 1000 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("zoom") ? 800 : 0;
  });
  history.replaceState(null, "", "/");
  document.body.innerHTML = `<div id="app"></div>`;
});
let app: App;
afterEach(() => { app?.stop(); vi.restoreAllMocks(); });

async function openApp(hash: string, onOpen = vi.fn(), fetch = server()) {
  history.replaceState(null, "", `/#manifest=${encodeURIComponent(M)}${hash}`);
  app = startApp({ root: $("#app") as HTMLElement, fetch, onOpen });
  await settle(app);
  return { onOpen, fetch };
}

describe("canvas view", () => {
  it("opens from the grid: link records the canvas, info.json is read, tiles are drawn", async () => {
    const { onOpen, fetch } = await openApp("");
    expect(app.view.isOpen).toBe(false);
    ($$(".tile")[0] as HTMLElement).click();
    await settle(app);
    expect(canvasParam()).toBe(`${CANVAS}00000001`);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${IMG}00000001/info.json`);
    expect(app.view.isOpen).toBe(true);
    expect(app.view.imageSize).toEqual({ w: 1408, h: 1672 }); // not the canvas's nominal 300 × 400
    expect(($(".zoom-base") as HTMLImageElement).src).toBe(`${IMG}00000001/full/704,/0/default.jpg`);
    // fitted: scale 800/1672 → level 2; with the 256-px margin all four level-2 tiles
    expect(app.view.viewer.tileUrls.map((u) => u.slice(IMG.length + 8))).toEqual([
      "/0,0,1024,1024/512,/0/default.jpg", "/1024,0,384,1024/192,/0/default.jpg",
      "/0,1024,1024,648/512,/0/default.jpg", "/1024,1024,384,648/192,/0/default.jpg",
    ]);
    expect($(".info h2")?.textContent).toBe("-");
    expect($(".info .pos")?.textContent).toBe("1 / 4");
    expect($(".info")?.textContent).toContain("1408 × 1672 px");
  });

  it("zooming in switches to full-resolution tiles", async () => {
    await openApp(`&canvas=${encodeURIComponent(`${CANVAS}00000001`)}`);
    app.view.viewer.zoomBy(4, 500, 400); // → ~191%: past full resolution
    const urls = app.view.viewer.tileUrls;
    expect(urls.some((u) => u.includes("/512,/0/default.jpg") && /\/\d+,\d+,512,512\//.test(u))).toBe(true);
    expect($$(".zoom-tile").length).toBe(urls.length);
  });

  it("steps with the arrow keys (replacing the link), closes with Esc", async () => {
    await openApp(`&canvas=${encodeURIComponent(`${CANVAS}00000001`)}`);
    const len = history.length;
    key("ArrowLeft"); await settle(app); // already first
    expect(canvasParam()).toBe(`${CANVAS}00000001`);
    key("ArrowRight"); await settle(app);
    expect(canvasParam()).toBe(`${CANVAS}00000002`);
    expect($(".info .pos")?.textContent).toBe("2 / 4");
    expect(history.length).toBe(len);
    key("Escape"); await settle(app);
    expect(canvasParam()).toBeNull();
    expect(app.view.isOpen).toBe(false);
  });

  it("reopens a canvas from a shared link, and closes when the link loses it (Back)", async () => {
    const { onOpen } = await openApp(`&canvas=${encodeURIComponent(`${CANVAS}00000025`)}`);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ label: "1" }), 2, app);
    expect(app.view.isOpen).toBe(true);
    location.hash = `#manifest=${encodeURIComponent(M)}`;
    await settle(app);
    expect(app.view.isOpen).toBe(false);
  });

  it("explains an unknown canvas and an image service that fails", async () => {
    await openApp(`&canvas=nope`);
    expect(app.view.isOpen).toBe(false);
    expect($(".notices")?.textContent).toContain("No canvas nope in this manifest");
    location.hash = `#manifest=${encodeURIComponent(M)}&canvas=${encodeURIComponent(`${CANVAS}00000085`)}`;
    await settle(app);
    expect(app.view.isOpen).toBe(true);
    expect($(".stage-message")?.textContent).toBe(`Could not load image: ${IMG}00000085/info.json: HTTP 404`);
  });

  it("shows the canvas's URN when a URN map is loaded", async () => {
    const urns = "https://example.org/w.cex";
    routes[urns] = `canvas|urn\n${CANVAS}00000025|urn:cite2:demo:weidler.v1:p1`;
    await openApp(`&urns=${encodeURIComponent(urns)}&canvas=${encodeURIComponent(`${CANVAS}00000025`)}`);
    expect($(".info .urn")?.textContent).toBe("urn:cite2:demo:weidler.v1:p1");
    key("ArrowRight"); await settle(app);
    expect($(".info")?.textContent).toContain("Not in the URN map");
  });
});
