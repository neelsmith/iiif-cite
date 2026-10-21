import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startApp as start, type App, type AppOptions } from "../ui/app";
import goe from "./fixtures/goettingen-PPN623133725-excerpt.json";

const M = "https://manifests.sub.uni-goettingen.de/iiif/presentation/PPN623133725/manifest";
const CANVAS = "https://manifests.sub.uni-goettingen.de/iiif/presentation/PPN623133725/canvas/gdz:PPN623133725:";
const URNS = "https://example.org/weidler.cex";
const urnText = `canvas|urn\n${CANVAS}00000025|urn:cite2:demo:weidler.v1:p1\n${CANVAS}00000099|urn:cite2:demo:weidler.v1:x`;

function server(routes: Record<string, string>) {
  return vi.fn(async (url: string) => (url in routes ? new Response(routes[url]) : new Response("", { status: 404 })));
}
const hashChanged = () => new Promise((r) => setTimeout(r, 0));
const $ = (s: string) => document.querySelector(s);
const $$ = (s: string) => [...document.querySelectorAll(s)];

let apps: App[] = [];
const startApp = (o: AppOptions) => { const a = start(o); apps.push(a); return a; };

beforeEach(() => {
  history.replaceState(null, "", "/");
  document.body.innerHTML = `<div id="app"></div>`;
});
afterEach(() => { apps.forEach((a) => a.stop()); apps = []; });

describe("manifest browsing", () => {
  it("starts empty with a prompt", async () => {
    const app = startApp({ root: $("#app") as HTMLElement, fetch: server({}) });
    await app.ready;
    expect($(".empty")?.textContent).toMatch(/Enter the URL/);
  });

  it("loads #manifest= on start and shows a thumbnail grid", async () => {
    location.hash = `#manifest=${encodeURIComponent(M)}`;
    const fetch = server({ [M]: JSON.stringify(goe) });
    const app = startApp({ root: $("#app") as HTMLElement, fetch });
    await app.ready;
    expect(fetch).toHaveBeenCalledWith(M);
    expect($(".manifest-head h2")?.textContent).toMatch(/^Io\. Friderici Weidleri/);
    expect($(".count")?.textContent).toBe("4 canvases");
    expect($$(".tile-caption").map((e) => e.textContent)).toEqual(["-", "-", "1", "61"]);
    expect(($(".tile img") as HTMLImageElement).src).toBe(
      "https://images.sub.uni-goettingen.de/iiif/image/gdz:PPN623133725:00000001/full/300,/0/default.jpg");
    expect(document.title).toMatch(/· iiif-cite$/);
    expect(($("input[name=manifest]") as HTMLInputElement).value).toBe(M);
  });

  it("loads from the form, putting the manifest in the link", async () => {
    const app = startApp({ root: $("#app") as HTMLElement, fetch: server({ [M]: JSON.stringify(goe) }) });
    await app.ready;
    ($("input[name=manifest]") as HTMLInputElement).value = M;
    ($("form.load") as HTMLFormElement).requestSubmit();
    await hashChanged(); await app.ready;
    expect(new URLSearchParams(location.hash.slice(1)).get("manifest")).toBe(M);
    expect($$(".tile")).toHaveLength(4);
  });

  it("falls back through thumbnail candidates, then marks the tile broken", async () => {
    location.hash = `#manifest=${encodeURIComponent(M)}`;
    const app = startApp({ root: $("#app") as HTMLElement, fetch: server({ [M]: JSON.stringify(goe) }) });
    await app.ready;
    const tile = $(".tile") as HTMLElement, img = tile.querySelector("img")!;
    img.dispatchEvent(new Event("error"));
    expect(img.src).toBe("https://manifests.sub.uni-goettingen.de/iiif/image/gdz:PPN623133725:00000001");
    img.dispatchEvent(new Event("error"));
    expect(tile.classList.contains("broken")).toBe(true);
  });

  it("reports a failed load", async () => {
    location.hash = `#manifest=${encodeURIComponent("https://x/missing")}`;
    const app = startApp({ root: $("#app") as HTMLElement, fetch: server({}) });
    await app.ready;
    expect($(".notices")?.textContent).toBe("https://x/missing: HTTP 404");
    expect($$(".tile")).toHaveLength(0);
  });

});

describe("URN map", () => {
  it("loads #urns=, marks canvases without URNs and warns about unknown canvases", async () => {
    location.hash = `#manifest=${encodeURIComponent(M)}&urns=${encodeURIComponent(URNS)}`;
    const app = startApp({ root: $("#app") as HTMLElement, fetch: server({ [M]: JSON.stringify(goe), [URNS]: urnText }) });
    await app.ready;
    expect(app.urnFor(app.manifest!.canvases[2])).toBe("urn:cite2:demo:weidler.v1:p1");
    expect($(".count")?.textContent).toBe(`4 canvases · 1 with URNs (${URNS})`);
    expect($$(".tile.no-urn")).toHaveLength(3);
    expect(($$(".tile")[2] as HTMLElement).title).toBe("urn:cite2:demo:weidler.v1:p1");
    expect($(".notices")?.textContent).toContain("1 canvas id(s) not in this manifest");
  });

  it("loads a local file, which is not part of the link", async () => {
    location.hash = `#manifest=${encodeURIComponent(M)}`;
    const app = startApp({ root: $("#app") as HTMLElement, fetch: server({ [M]: JSON.stringify(goe) }) });
    await app.ready;
    const input = $("input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File([urnText], "weidler.cex")], configurable: true });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect($(".count")?.textContent).toContain("1 with URNs (weidler.cex, local file — not in the link)"));
    expect(location.hash).not.toContain("urns=");
  });
});
