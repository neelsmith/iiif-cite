import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startApp, type App } from "../ui/app";
import { validateConfig } from "../lib/project-config.mjs";
import lips from "./fixtures/lips7-catalog.cex?raw";
import goe from "./fixtures/goettingen-PPN623133725-excerpt.json";

const CAT = "https://shot.holycross.edu/images/mss/lipsius7/lips7.cex";
const DIR = "https://shot.holycross.edu/images/mss/lipsius7/";
const ODD = "https://example.org/list"; // a catalog whose URL doesn't say so
const GOE = "https://example.org/weidler.json";
const routes: Record<string, string> = { [CAT]: lips, [ODD]: lips, [GOE]: JSON.stringify(goe) };
const server = () => vi.fn(async (url: string) => (url in routes ? new Response(routes[url]) : new Response("", { status: 404 })));
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const $$ = (s: string) => [...document.querySelectorAll<HTMLElement>(s)];
const param = (k: string) => new URLSearchParams(location.hash.slice(1)).get(k);
const tick = () => new Promise((r) => setTimeout(r, 0));
const IMG = (n: number) => `leiden-pliny/IMG_${n}.jpeg`;

let app: App;
beforeEach(() => { document.body.innerHTML = `<div id="app"></div>`; });
afterEach(() => { app?.stop(); vi.restoreAllMocks(); });
async function visit(url: string, config: unknown = null) {
  history.replaceState(null, "", url);
  app = startApp({ root: $("#app"), fetch: server(), https: false, config: config ? validateConfig(config).config : null });
  await tick(); await app.ready; await tick();
}
const settle = async () => { await tick(); await app.ready; await tick(); };

describe("image catalogs", () => {
  it("#catalog= shows the images, full size in the grid when there are no thumbnails", async () => {
    await visit(`/iiif-cite.html#catalog=${CAT}`);
    expect($(".manifest-head h2").textContent).toBe("lips7.cex");
    expect($(".manifest-head .count").textContent).toBe("6 images · 6 with URNs · no thumbnails");
    expect($$(".tile")).toHaveLength(6);
    expect(($(".tile img") as HTMLImageElement).src).toBe(`${DIR}${IMG(1200)}`);
    expect($$(".tile-caption")[1].textContent).toBe("Leiden, MS Lipsius 7, locks on binding.");
    expect($("form.urns").hidden).toBe(true); // the catalog has its own URNs
    expect($(".map-urns")).toBeNull();
    expect(app.urnFor(app.manifest!.canvases[0])).toBe("urn:cite2:citeleiden:lipsius7.v1:IMG_1200");
  });

  it("thumbs=1: thumbnails in the grid, falling back to the full image", async () => {
    await visit(`/iiif-cite.html#catalog=${CAT}&thumbs=1`);
    const img = $(".tile img") as HTMLImageElement;
    expect(img.src).toBe(`${DIR}leiden-pliny/_thumbs/IMG_1200.jpeg.jpg`);
    expect(($("input[name=thumbs]") as HTMLInputElement).checked).toBe(true);
    img.dispatchEvent(new Event("error"));
    expect(img.src).toBe(`${DIR}${IMG(1200)}`);
  });

  it("the URL box takes a catalog; the content decides, and the link is corrected", async () => {
    await visit("/iiif-cite.html");
    const input = $("input[name=manifest]") as HTMLInputElement;
    input.value = CAT;
    ($("input[name=thumbs]") as HTMLInputElement).checked = true;
    ($("form.load") as HTMLFormElement).requestSubmit();
    await settle();
    expect(param("catalog")).toBe(CAT);
    expect(param("thumbs")).toBe("1");
    expect(param("manifest")).toBeNull();
    input.value = ODD;
    ($("input[name=thumbs]") as HTMLInputElement).checked = false;
    ($("form.load") as HTMLFormElement).requestSubmit();
    await settle();
    expect(param("catalog")).toBe(ODD);
    expect(param("manifest")).toBeNull();
    expect($$(".tile")).toHaveLength(6);
    // …and a manifest named as a catalog is still a manifest.
    location.hash = `#catalog=${GOE}&thumbs=1`;
    await settle();
    expect(param("manifest")).toBe(GOE);
    expect(param("catalog")).toBeNull();
    expect(param("thumbs")).toBeNull();
    expect($(".manifest-head .count").textContent).toBe("4 canvases");
    expect($("form.urns").hidden).toBe(false);
  });

  it("opening an image shows its catalog fields; links cite it by URN with catalog=", async () => {
    await visit(`/iiif-cite.html#catalog=${CAT}`);
    $$(".tile")[1].click();
    await settle();
    expect(param("canvas")).toBe(IMG(1201));
    const panel = $(".info").textContent!;
    for (const t of ["2 / 6", "urn:cite2:citeleiden:lipsius7.v1:IMG_1201", "Pliny, Leiden, binding",
      "Photograph Neel Smith, 2019", "Public domain (CC0)", "File"]) expect(panel).toContain(t);
    expect(($(".info dd a") as HTMLAnchorElement).href).toBe(`${DIR}${IMG(1201)}`);
    expect($(".info .copy-link").dataset.url).toBe(
      `${location.origin}/iiif-cite.html?catalog=${CAT}&urn=urn:cite2:citeleiden:lipsius7.v1:IMG_1201`);
  });

  it("a URN link opens the image with the region; View this region opens the whole image with it outlined", async () => {
    await visit(`/iiif-cite.html?catalog=${CAT}&thumbs=1&urn=urn:cite2:citeleiden:lipsius7:IMG_1203@0.1,0.2,0.3,0.4`);
    expect(param("canvas")).toBe(IMG(1203));
    expect(param("roi")).toBe("0.1000,0.2000,0.3000,0.4000");
    const link = `${location.origin}/iiif-cite.html?catalog=${CAT}&thumbs=1&urn=urn:cite2:citeleiden:lipsius7.v1:IMG_1203@0.1000,0.2000,0.3000,0.4000`;
    expect($(".sel-link").dataset.url).toBe(link);
    expect(($(".sel-img") as HTMLAnchorElement).href).toBe(link);
    expect(app.selections()[0].canvas.id).toBe(IMG(1203));
  });

  it("group by tag and filter; previous/next follow what is shown", async () => {
    await visit(`/iiif-cite.html#catalog=${CAT}`);
    $(".seg [data-mode=tag]").click();
    expect(param("group")).toBe("tag");
    expect($$(".group h3").map((h) => h.textContent)).toEqual(["binding2", "Leiden4", "Pliny4", "Untagged1"]);
    expect($$(".tile")).toHaveLength(11); // an image in each of its tags
    const search = $("input[name=filter]") as HTMLInputElement;
    search.focus();
    search.value = "LOCKS";
    search.dispatchEvent(new Event("input"));
    expect(document.activeElement).toBe(search); // typing isn't interrupted
    expect($(".browse .count").textContent).toBe("2 of 6 shown");
    expect($$(".group h3").map((h) => h.textContent)).toEqual(["binding2", "Leiden1", "Pliny2"]);
    $$(".tile")[0].click(); // IMG_1201 (binding)
    await settle();
    expect($(".info .pos").textContent).toBe("1 / 2");
    ($(".lightbox .nav.next") as HTMLButtonElement).click();
    await settle();
    expect(param("canvas")).toBe(IMG(1202));
    expect(($(".lightbox .nav.next") as HTMLButtonElement).disabled).toBe(true);
    expect(param("filter")).toBeNull(); // the text filter isn't kept in the link
  });

  it("the grouping is kept in the hash, but not in copied links", async () => {
    await visit(`/iiif-cite.html#catalog=${CAT}&group=tag`);
    expect($(".seg [data-mode=tag]").getAttribute("aria-checked")).toBe("true");
    $$(".tile")[0].click();
    await settle();
    expect($(".info .copy-link").dataset.url).not.toContain("group=");
  });

  it("a catalog with problems shows them as notices", async () => {
    routes["https://eg.com/images/bad.cex"] = "path|caption\nProject1/imageA.png|A\n";
    await visit("/iiif-cite.html#catalog=https://eg.com/images/bad.cex");
    expect($(".notices").textContent).toContain('catalog has no "urn" column');
    expect($(".tile").classList.contains("no-urn")).toBe(true);
    routes["https://eg.com/images/none.cex"] = "<html>Not found</html>";
    await visit("/iiif-cite.html#catalog=https://eg.com/images/none.cex");
    expect($(".notices").textContent).toMatch(/neither a IIIF manifest .* nor an image catalog/);
  });

  it("a packaged page can list catalogs next to manifests", async () => {
    const project = { title: "Leiden", collections: [{ label: "Weidler", manifest: GOE },
      { label: "Lipsius 7", catalog: CAT, thumbnails: true }], default: "Lipsius 7" };
    expect(validateConfig(project).errors).toEqual([]);
    expect(validateConfig({ title: "t", collections: [{ label: "x", catalog: CAT, manifest: GOE, urns: GOE, thumbnails: "yes" }] }).errors)
      .toEqual(['collection 1: give either "manifest" or "catalog", not both', 'collection 1: "urns" is for manifests (a catalog has its own URNs)',
        'collection 1: "thumbnails" must be true or false']);
    await visit("/leiden.html", project);
    expect(param("catalog")).toBe(CAT);
    expect(param("thumbs")).toBe("1");
    expect($$(".tile")).toHaveLength(6);
    const menu = $("select.collections") as HTMLSelectElement;
    expect(menu.value).toBe("1");
    menu.value = "0"; menu.dispatchEvent(new Event("change"));
    await settle();
    expect(param("manifest")).toBe(GOE);
    expect(param("catalog")).toBeNull();
    expect(param("thumbs")).toBeNull();
    expect($$(".tile")).toHaveLength(4);
  });
});
