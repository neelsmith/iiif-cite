import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startApp, type App } from "../ui/app";
import va from "./fixtures/hmt-venetusA-excerpt.json";
import goe from "./fixtures/goettingen-PPN623133725-excerpt.json";

const HMT = "https://example.org/venetusA.json";
const GOE = "https://example.org/weidler.json";
const routes: Record<string, string> = { [HMT]: JSON.stringify(va), [GOE]: JSON.stringify(goe) };
const server = () => vi.fn(async (url: string) => (url in routes ? new Response(routes[url]) : new Response("", { status: 404 })));
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T;
const $$ = (s: string) => [...document.querySelectorAll(s)] as HTMLElement[];
const lines = () => $$(".tile-urn").map((e) => e.textContent);
const tick = () => new Promise((r) => setTimeout(r, 0));
function type(sel: string, value: string, root: ParentNode = document) {
  const i = root.querySelector(sel) as HTMLInputElement | HTMLSelectElement;
  i.value = value;
  i.dispatchEvent(new Event(i.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}
const keydown = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

let app: App;
const blobs: Blob[] = [], names: string[] = [];
beforeEach(() => {
  blobs.length = 0; names.length = 0;
  URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return "blob:x"; });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
  document.body.innerHTML = `<div id="app"></div>`;
});
afterEach(() => { app?.stop(); vi.restoreAllMocks(); });

async function open(manifest: string) {
  history.replaceState(null, "", `/#manifest=${encodeURIComponent(manifest)}`);
  app = startApp({ root: $("#app"), fetch: server(), https: false });
  await tick(); await app.ready;
  $("button.map-urns").click();
}

describe("Map URNs", () => {
  it("HMT: image file names under a collection; download becomes the active map", async () => {
    await open(HMT);
    expect($(".mapper")).not.toBeNull();
    expect(lines()).toEqual(["no URN", "no URN", "no URN", "no URN"]);
    expect($(".map-msg").textContent).toMatch(/Enter a collection URN/);
    expect(($<HTMLButtonElement>(".map-download")).disabled).toBe(true);
    type("input[name=collection]", "urn:cite2:hmt:vaimg.2017a:");
    expect(lines()).toEqual(["VAMSInside_front_cover_versoN_0500", "VAMSFolio_i_rectoN_0001", "VA001RN_0002", "VAMSInside_back_cover_rectoN_0499"]);
    expect($(".map-status").textContent).toBe("4 canvases · 4 with URNs");
    expect($$(".tile-urn")[2].title).toBe("urn:cite2:hmt:vaimg.2017a:VA001RN_0002 — click to change");
    $(".map-download").click();
    expect(names).toEqual(["venetus-a-manuscript-urns.cex"]);
    const text = await blobs[0].text();
    expect(text.split("\n").slice(0, 3)).toEqual(["// URN map for Venetus A manuscript", `// manifest: ${HMT}`, "image|urn|label"]);
    expect(text).toContain("/VA001RN_0002.tif|urn:cite2:hmt:vaimg.2017a:VA001RN_0002|Venetus A (Marciana 454 = 822), folio 1, recto\n");
    // now the active map: counted in the header, URNs on canvases, "keep" offered
    expect($(".count").textContent).toBe("4 canvases · 4 with URNs (venetus-a-manuscript-urns.cex, local file — not in the link)");
    expect(app.urnFor(app.manifest!.canvases[2])).toBe("urn:cite2:hmt:vaimg.2017a:VA001RN_0002");
    expect($<HTMLLabelElement>(".map-keep").hidden).toBe(false);
  });

  it("Göttingen: numbers, restart from a page, hand edits, problems", async () => {
    await open(GOE);
    type("input[name=collection]", "urn:cite2:demo:weidler.v1:");
    type("select[name=kind]", "number");
    type("input[name=prefix]", "p");
    expect(lines()).toEqual(["p001", "p002", "p003", "p004"]);
    // canvas 3 is printed page 1: number from here
    $$(".tile-urn")[2].click();
    const box = $(".urn-edit");
    type("input[name=count]", "1", box);
    keydown(box, "Enter");
    expect(lines()).toEqual(["p001", "p002", "p001", "p002"]);
    expect($(".map-status").textContent).toBe("4 canvases · 0 with URNs · 4 duplicates");
    expect($$(".tile-urn.duplicate")).toHaveLength(4);
    // hand edits for the front matter
    for (const [i, id] of [[0, "front1"], [1, "front2"]] as const) {
      $$(".tile-urn")[i].click();
      type("input[name=urn]", `urn:cite2:demo:weidler.v1:${id}`, $(".urn-edit"));
      keydown($(".urn-edit"), "Enter");
    }
    expect(lines()).toEqual(["front1", "front2", "p001", "p002"]);
    expect($$(".tile-urn.hand")).toHaveLength(2);
    expect($(".map-status").textContent).toBe("4 canvases · 4 with URNs");
    // an invalid hand edit is flagged; "Rule" puts it back
    $$(".tile-urn")[3].click();
    type("input[name=urn]", "urn:cite2:demo:weidler.v1:p 2", $(".urn-edit"));
    keydown($(".urn-edit"), "Enter");
    expect($$(".tile-urn")[3].className).toBe("tile-urn invalid hand");
    $$(".tile-urn")[3].click();
    ($$(".urn-edit button").find((b) => b.textContent === "Rule")!).click();
    expect(lines()[3]).toBe("p002"); // back to the rule (numbering still restarts at canvas 3)
    // Esc cancels an edit
    $$(".tile-urn")[0].click();
    type("input[name=urn]", "urn:cite2:demo:weidler.v1:zzz", $(".urn-edit"));
    keydown($(".urn-edit"), "Escape");
    expect(lines()[0]).toBe("front1");
    expect($(".urn-edit")).toBeNull();
  });

  it("starts from a loaded map: guesses the collection, keeps its URNs unless told otherwise", async () => {
    await open(HMT);
    type("input[name=collection]", "urn:cite2:hmt:vaimg.2017a:");
    $$(".tile-urn")[2].click();
    type("input[name=urn]", "urn:cite2:hmt:vaimg.2017a:folio1r", $(".urn-edit"));
    keydown($(".urn-edit"), "Enter");
    $(".map-download").click();
    $(".map-done").click();
    expect($(".mapper")).toBeNull();
    // reopen: the collection is guessed from the active map, its URNs kept ("·" marks them)
    $("button.map-urns").click();
    expect(($<HTMLInputElement>("input[name=collection]")).value).toBe("urn:cite2:hmt:vaimg.2017a:");
    type("select[name=kind]", "canvas");
    expect(lines()[2]).toBe("folio1r");
    expect($$(".tile-urn")[2].classList.contains("hand")).toBe(true);
    const keep = $<HTMLInputElement>(".map-keep input");
    expect(lines()[0]).toBe("VAMSInside_front_cover_versoN_0500"); // from the loaded map
    expect($$(".tile-urn")[0].classList.contains("map")).toBe(true);
    keep.checked = false; keep.dispatchEvent(new Event("change"));
    expect(lines()[0]).toBe("insidefrontcover");
  });

  it("asks before leaving with an undownloaded map", async () => {
    await open(HMT);
    type("input[name=collection]", "urn:cite2:hmt:vaimg.2017a:");
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    $(".map-done").click();
    expect($(".mapper")).not.toBeNull();
    $(".map-done").click();
    expect($(".mapper")).toBeNull();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("thumbnails still open the viewer while mapping", async () => {
    await open(HMT);
    $$(".tile")[2].click();
    await tick(); await app.ready;
    expect(new URLSearchParams(location.hash.slice(1)).get("canvas")).toBe("canvases/1r");
  });
});
