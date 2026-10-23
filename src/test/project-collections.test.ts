// Project files with both kinds of collection: IIIF manifest + URN map, and image catalog.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateConfig } from "../lib/project-config.mjs";
import { startApp, type App } from "../ui/app";
import lips from "./fixtures/lips7-catalog.cex?raw";
import goe from "./fixtures/goettingen-PPN623133725-excerpt.json";
import hmtMap from "./fixtures/hmt-venetusA-urns.cex?raw";

// The repository's own project files (../projects), if present.
const PROJECTS = join(process.cwd(), "..", "projects");
const projectFiles = existsSync(PROJECTS) ? readdirSync(PROJECTS).filter((f) => f.endsWith(".json")) : [];

describe("project files in projects/", () => {
  it.each(projectFiles.length ? projectFiles : ["(none)"])("%s is a valid project", (f) => {
    if (f === "(none)") return;
    const { errors } = validateConfig(JSON.parse(readFileSync(join(PROJECTS, f), "utf8")));
    expect(errors).toEqual([]);
  });
});

// Neel's projects/mixed-example.json (URLs as there; content from test fixtures).
const CAT = "https://shot.holycross.edu/images/mss/lipsius7/lips7.cex";
const DIR = "https://shot.holycross.edu/images/mss/lipsius7/";
const COMP = "https://raw.githubusercontent.com/neelsmith/complutensian-texts/refs/heads/main/iiif/complutensian-bne-v1-manifest.json";
const COMP_URNS = "https://raw.githubusercontent.com/neelsmith/complutensian-texts/refs/heads/main/iiif/complutensian-bne-vol1-urns.cex";
const mixed = {
  title: "Mixing citable image sources",
  collections: [
    { label: "Leiden, Lipsisus 7", catalog: CAT, thumbnails: true },
    { label: "Complutensian Bible, vol. 1 (BNE)", manifest: COMP, urns: COMP_URNS },
  ],
};
const routes: Record<string, string> = { [CAT]: lips, [COMP]: JSON.stringify(goe), [COMP_URNS]: hmtMap };
const server = () => vi.fn(async (url: string) => (url in routes ? new Response(routes[url]) : new Response("", { status: 404 })));
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const $$ = (s: string) => [...document.querySelectorAll<HTMLElement>(s)];
const param = (k: string) => new URLSearchParams(location.hash.slice(1)).get(k);
const tick = () => new Promise((r) => setTimeout(r, 0));

let app: App;
beforeEach(() => { document.body.innerHTML = `<div id="app"></div>`; });
afterEach(() => { app?.stop(); vi.restoreAllMocks(); });
async function visit(url: string, cfg: unknown) {
  history.replaceState(null, "", url);
  app = startApp({ root: $("#app"), fetch: server(), https: false, config: validateConfig(cfg).config });
  await tick(); await app.ready; await tick();
}
const settle = async () => { await tick(); await app.ready; await tick(); };
const menu = () => $("select.collections") as HTMLSelectElement;
const choose = async (i: number) => { menu().value = String(i); menu().dispatchEvent(new Event("change")); await settle(); };

describe("a packaged page mixing a catalog and a manifest", () => {
  it("validates as given", () => {
    expect(validateConfig(mixed).config?.collections.map((c) => [c.label, c.catalog ? "catalog" : "manifest", c.thumbnails])).toEqual([
      ["Leiden, Lipsisus 7", "catalog", true], ["Complutensian Bible, vol. 1 (BNE)", "manifest", false]]);
  });

  it("switches catalog → manifest → catalog, each with its own settings", async () => {
    await visit("/mixed.html", mixed);
    expect($(".bar h1").textContent).toBe("Mixing citable image sources");
    expect([param("catalog"), param("thumbs"), param("manifest"), param("urns")]).toEqual([CAT, "1", null, null]);
    expect(($(".tile img") as HTMLImageElement).src).toBe(`${DIR}leiden-pliny/_thumbs/IMG_1200.jpeg.jpg`);
    expect($(".map-urns")).toBeNull();

    await choose(1);
    expect([param("catalog"), param("thumbs"), param("manifest"), param("urns")]).toEqual([null, null, COMP, COMP_URNS]);
    expect($$(".tile")).toHaveLength(4);
    expect($(".map-urns")).not.toBeNull(); // Map URNs is for manifests
    expect(menu().value).toBe("1");

    await choose(0);
    expect([param("catalog"), param("thumbs"), param("manifest"), param("urns")]).toEqual([CAT, "1", null, null]);
    expect($$(".tile")).toHaveLength(6);
    expect(app.urnFor(app.manifest!.canvases[0])).toBe("urn:cite2:citeleiden:lipsius7.v1:IMG_1200"); // the catalog's own URNs
    expect(menu().value).toBe("0");
  });

  it("a catalog without thumbnails shows the full images in the grid", async () => {
    await visit("/mixed.html", { ...mixed, collections: [{ ...mixed.collections[0], thumbnails: false }, mixed.collections[1]] });
    expect(param("thumbs")).toBeNull();
    expect(($(".tile img") as HTMLImageElement).src).toBe(`${DIR}leiden-pliny/IMG_1200.jpeg`);
  });

  it("a URN link into the catalog works when the manifest is the default", async () => {
    await visit(`/mixed.html?catalog=${CAT}&urn=urn:cite2:citeleiden:lipsius7.v1:IMG_1201@0.1,0.2,0.3,0.4`, { ...mixed, default: 1 });
    expect(menu().value).toBe("0");
    expect(param("thumbs")).toBe("1"); // the collection's thumbnails setting is filled in
    expect(param("canvas")).toBe("leiden-pliny/IMG_1201.jpeg");
    expect(app.view.roi.list).toEqual([{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }]);
  });
});
