import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { roiToScreen } from "cite-roi";
import { startApp, type App } from "../ui/app";
import goe from "./fixtures/goettingen-PPN623133725-excerpt.json";
import goeInfo from "./fixtures/goettingen-00000001-info.json";

const M = "https://manifests.sub.uni-goettingen.de/iiif/presentation/PPN623133725/manifest";
const CANVAS = "https://manifests.sub.uni-goettingen.de/iiif/presentation/PPN623133725/canvas/gdz:PPN623133725:";
const IMG = "https://images.sub.uni-goettingen.de/iiif/image/gdz:PPN623133725:";
const URNS = "https://example.org/w.cex";
const routes: Record<string, string> = {
  [M]: JSON.stringify(goe),
  [URNS]: `canvas|urn\n${CANVAS}00000001|urn:cite2:demo:weidler.v1:f1`,
};
for (const n of ["00000001", "00000002", "00000025"]) routes[`${IMG}${n}/info.json`] = JSON.stringify({ ...goeInfo, "@id": `${IMG}${n}` });
const server = () => vi.fn(async (url: string) => (url in routes ? new Response(routes[url]) : new Response("", { status: 404 })));

const $ = (s: string) => document.querySelector(s);
const $$ = (s: string) => [...document.querySelectorAll(s)];
const tick = () => new Promise((r) => setTimeout(r, 0));
const param = (k: string) => new URLSearchParams(location.hash.slice(1)).get(k);
const key = (k: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
async function settle(app: App) { await tick(); await app.ready; await app.view.ready; await tick(); }

let app: App;
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
afterEach(() => { app?.stop(); vi.restoreAllMocks(); });

async function open(hash: string) {
  history.replaceState(null, "", `/#manifest=${encodeURIComponent(M)}${hash}`);
  app = startApp({ root: $("#app") as HTMLElement, fetch: server() });
  await settle(app);
}
const at = (canvas: string, extra = "") => `&canvas=${encodeURIComponent(`${CANVAS}${canvas}`)}${extra}`;

/** Drag from one image-fraction point to another (jsdom: no PointerEvent, so MouseEvents of those types). */
function drag(target: Element, from: [number, number], to: [number, number], shiftKey: boolean) {
  const st = app.view.viewer.state!;
  const pt = ([fx, fy]: [number, number]) => {
    const s = roiToScreen(st.view, st.image, { x: fx, y: fy, w: 0, h: 0 });
    return { clientX: s.left, clientY: s.top };
  };
  target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, shiftKey, ...pt(from) }));
  window.dispatchEvent(new MouseEvent("pointermove", { ...pt(to) }));
  window.dispatchEvent(new MouseEvent("pointerup", { ...pt(to) }));
}

describe("region selection", () => {
  it("Shift-drag draws a region: panel, link, URN and a link to view the region", async () => {
    await open(`&urns=${encodeURIComponent(URNS)}${at("00000001")}`);
    drag(app.view.viewer.el, [0.25, 0.5], [0.75, 0.75], true);
    expect(app.view.roi.list).toHaveLength(1);
    expect($$(".roi")).toHaveLength(1);
    expect(param("roi")).toBe("0.2500,0.5000,0.5000,0.2500");
    expect($(".selections h3")?.textContent).toBe("Selections (1)");
    expect($(".selections .sel-urn")?.textContent).toBe("urn:cite2:demo:weidler.v1:f1@0.2500,0.5000,0.5000,0.2500");
    // measured on the real image (1408 × 1672), not the 300 × 400 canvas
    expect(($(".selections .sel-img") as HTMLAnchorElement).href).toBe(`${IMG}00000001/352,836,704,418/full/0/default.jpg`);
    expect($(".selections .sel-img")?.textContent).toBe("View this region");
    // Copy buttons only for x,y,w,h and the URN — no IIIF URL to copy
    expect($$(".selections li .sel-btn").map((b) => b.getAttribute("title"))).toEqual(["Copy x,y,w,h", "Remove this selection", "Copy CITE2 URN"]);
    expect($(".export-selections")?.textContent).toBe("Export selections (1)");
    expect(($(".export-selections") as HTMLButtonElement).disabled).toBe(false);
  });

  it("select mode: drag draws; Delete removes; Esc leaves select mode before closing", async () => {
    await open(at("00000001"));
    (($(".roi-toggle")) as HTMLButtonElement).click();
    expect(app.view.roi.isSelecting).toBe(true);
    drag(app.view.roi.el, [0.1, 0.1], [0.2, 0.3], false);
    drag(app.view.roi.el, [0.5, 0.5], [0.6, 0.6], false);
    expect(param("roi")).toBe("0.1000,0.1000,0.1000,0.2000;0.5000,0.5000,0.1000,0.1000");
    expect($(".selections")?.textContent).toContain("Load a URN map to get CITE2 URNs.");
    key("Delete");
    expect(app.view.roi.list).toHaveLength(1);
    key("Escape");
    expect(app.view.roi.isSelecting).toBe(false);
    expect(app.view.isOpen).toBe(true);
    key("Escape"); await settle(app);
    expect(app.view.isOpen).toBe(false);
    expect(param("roi")).toBeNull();
  });

  it("a shared link shows its regions", async () => {
    await open(at("00000025", "&roi=0.1,0.1,0.2,0.2;0.5,0.5,0.25,0.25"));
    expect(app.view.roi.list).toHaveLength(2);
    expect($$(".roi")).toHaveLength(2);
    expect($$(".selections li")).toHaveLength(2);
  });

  it("keeps regions per canvas while moving around, and badges the thumbnails", async () => {
    await open(at("00000001"));
    drag(app.view.viewer.el, [0.1, 0.1], [0.4, 0.4], true);
    key("ArrowRight"); await settle(app);
    expect(param("canvas")).toBe(`${CANVAS}00000002`);
    expect(param("roi")).toBeNull();
    expect(app.view.roi.list).toEqual([]);
    drag(app.view.viewer.el, [0.5, 0.5], [0.6, 0.7], true);
    drag(app.view.viewer.el, [0.1, 0.5], [0.2, 0.7], true);
    key("ArrowLeft"); await settle(app);
    expect(param("roi")).toBe("0.1000,0.1000,0.3000,0.3000");
    expect(app.view.roi.list).toHaveLength(1);
    key("Escape"); await settle(app);
    expect($$(".tile").map((t) => (t as HTMLElement).dataset.selections ?? "")).toEqual(["1", "2", "", ""]);
    expect($(".export-selections")?.textContent).toBe("Export selections (3)");
    // reopening from the grid brings the canvas's regions back
    ($$(".tile")[1] as HTMLElement).click(); await settle(app);
    expect(param("roi")).toBe("0.5000,0.5000,0.1000,0.2000;0.1000,0.5000,0.1000,0.2000");
    expect($$(".roi")).toHaveLength(2);
  });

  it("Export selections downloads one URN per line", async () => {
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return "blob:x"; });
    URL.revokeObjectURL = vi.fn();
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this.download); });
    await open(`&urns=${encodeURIComponent(URNS)}${at("00000001")}`);
    drag(app.view.viewer.el, [0.25, 0.5], [0.75, 0.75], true);
    key("ArrowRight"); await settle(app);
    drag(app.view.viewer.el, [0, 0], [0.5, 0.5], true);
    ($(".export-selections") as HTMLButtonElement).click();
    expect(clicks).toEqual(["io-friderici-weidleri-historia-astronomiae-sive-de-ortu-et-p-regions.txt"]);
    expect((await blobs[0].text()).split("\n")).toEqual([
      "urn:cite2:demo:weidler.v1:f1@0.2500,0.5000,0.5000,0.2500",
      "// Canvases without a URN (add them to the URN map):",
      `// ${CANVAS}00000002@0.0000,0.0000,0.5000,0.5000`,
      "",
    ]);
    // the panel's Download is offered only when the canvas has a URN (here it has none)
    expect($$(".sel-actions button").map((b) => b.textContent)).toEqual(["Copy all", "Clear all"]);
    key("ArrowLeft"); await settle(app);
    expect($$(".sel-actions button").map((b) => b.textContent)).toEqual(["Download", "Copy all", "Clear all"]);
    ($$(".sel-actions button")[0] as HTMLButtonElement).click();
    expect(clicks[1]).toBe("canvas-regions.txt"); // label "-" has no letters
    expect(await blobs[1].text()).toBe("urn:cite2:demo:weidler.v1:f1@0.2500,0.5000,0.5000,0.2500\n");
  });
});
