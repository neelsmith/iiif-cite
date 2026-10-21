import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readConfigText, validateConfig, CONFIG_ELEMENT_ID } from "../lib/project-config.mjs";
import { packageHtml } from "../scripts/package.mjs";
import { startApp, type App } from "../ui/app";
import example from "../projects/example.json";
import va from "./fixtures/hmt-venetusA-excerpt.json";
import goe from "./fixtures/goettingen-PPN623133725-excerpt.json";
import hmtMap from "./fixtures/hmt-venetusA-urns.cex?raw";

const VA = "https://example.org/venetusA.json", VA_URNS = "https://example.org/venetusA-urns.cex", GOE = "https://example.org/weidler.json";
const project = {
  title: "Homer & friends",
  collections: [
    { label: "Weidler", manifest: GOE },
    { label: "Venetus A", manifest: VA, urns: VA_URNS },
  ],
  default: "Venetus A",
};

describe("project configuration", () => {
  it("accepts a title and collections; urns optional; default by label or index", () => {
    expect(validateConfig(project)).toEqual({ errors: [], config: {
      title: "Homer & friends", defaultIndex: 1,
      collections: [{ label: "Weidler", manifest: GOE, urns: null }, { label: "Venetus A", manifest: VA, urns: VA_URNS }] } });
    expect(validateConfig({ ...project, default: 0 }).config?.defaultIndex).toBe(0);
    expect(validateConfig({ title: "t", collections: [{ label: "a", manifest: GOE }] }).config?.defaultIndex).toBe(0);
    expect(validateConfig(example).errors).toEqual([]);
  });
  it("explains what's wrong", () => {
    expect(validateConfig([]).errors).toEqual(["configuration must be a JSON object"]);
    expect(validateConfig({ title: " ", collections: [], extra: 1 }).errors).toEqual([
      '"title" must be a non-empty string', '"collections" must be a non-empty list', 'unknown setting "extra"']);
    expect(validateConfig({ title: "t", default: "Nope", collections: [
      { label: "a", manifest: "ftp://x" }, { label: "a", manifest: GOE, urns: "nope" }, 7] }).errors).toEqual([
      'collection 1: "manifest" must be an http(s) URL', 'collection 2: label "a" is used twice',
      'collection 2: "urns" must be an http(s) URL', "collection 3: must be an object", '"default" names no collection: "Nope"']);
  });
  it("an empty block is the generic app; bad JSON is reported", () => {
    expect(readConfigText("")).toEqual({ config: null, errors: [] });
    expect(readConfigText("  \n ")).toEqual({ config: null, errors: [] });
    expect(readConfigText("{nope").errors[0]).toMatch(/not valid JSON/);
  });
});

describe("npm run package", () => {
  const built = `<!doctype html><html><head><title>iiif-cite</title></head><body><div id="app"></div>
<script type="application/json" id="${CONFIG_ELEMENT_ID}"></script><script type="module">/* app */</script></body></html>`;
  it("fills in the config block and the page title", () => {
    const html = packageHtml(built, { ...project, title: "Homer <&> friends" });
    expect(html).toContain("<title>Homer &lt;&amp;&gt; friends</title>");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const { config } = readConfigText(doc.getElementById(CONFIG_ELEMENT_ID)?.textContent);
    expect(config?.collections.map((c) => c.label)).toEqual(["Weidler", "Venetus A"]);
    expect(html).toContain("<script type=\"module\">/* app */</script>"); // the app itself untouched
  });
  it("can be packaged again, and a label containing </script> can't break the page", () => {
    const once = packageHtml(built, project);
    const twice = packageHtml(once, { title: "t", collections: [{ label: "x</script><b>", manifest: GOE }] });
    const doc = new DOMParser().parseFromString(twice, "text/html");
    expect(doc.querySelector("b")).toBeNull();
    expect(readConfigText(doc.getElementById(CONFIG_ELEMENT_ID)?.textContent).config?.collections[0].label).toBe("x</script><b>");
  });
  it("refuses a bad config or a page without the block", () => {
    expect(() => packageHtml(built, { title: "" })).toThrow(/Invalid project configuration:\n {2}- "title"/);
    expect(() => packageHtml("<html></html>", project)).toThrow(/No <script id="iiif-cite-config">/);
  });
});

describe("a packaged page", () => {
  const routes: Record<string, string> = { [VA]: JSON.stringify(va), [VA_URNS]: hmtMap, [GOE]: JSON.stringify(goe) };
  const server = () => vi.fn(async (url: string) => (url in routes ? new Response(routes[url]) : new Response("", { status: 404 })));
  const $ = (s: string) => document.querySelector(s) as HTMLElement;
  const param = (k: string) => new URLSearchParams(location.hash.slice(1)).get(k);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  let app: App, fetch: ReturnType<typeof server>;
  beforeEach(() => { document.body.innerHTML = `<div id="app"></div>`; });
  afterEach(() => { app?.stop(); vi.restoreAllMocks(); });
  async function visit(url: string, cfg: unknown = project, configErrors: string[] = []) {
    history.replaceState(null, "", url);
    fetch = server();
    app = startApp({ root: $("#app"), fetch, https: false, version: "0.2.0", config: validateConfig(cfg).config, configErrors });
    await tick(); await app.ready; await tick();
  }
  const menu = () => $("select.collections") as HTMLSelectElement;

  it("opens the default collection with its URN map; title and menu instead of the inputs", async () => {
    await visit("/homer.html");
    expect(param("manifest")).toBe(VA);
    expect(param("urns")).toBe(VA_URNS);
    expect($(".bar h1").textContent).toBe("Homer & friends");
    expect(document.title).toBe("Venetus A manuscript · Homer & friends");
    expect($(".version").textContent).toBe("iiif-cite v0.2.0");
    expect($("input[name=manifest]")).toBeNull();
    expect($("input[name=urns]")).toBeNull();
    expect($("input[type=file]")).toBeNull();
    expect([...menu().options].map((o) => o.textContent)).toEqual(["Weidler", "Venetus A"]);
    expect(menu().value).toBe("1");
    expect(app.urnFor(app.manifest!.canvases[2])).toBe("urn:cite2:hmt:vaimg.2017a:VA001RN_0002");
  });

  it("the menu switches collections (a collection without a URN map drops urns=)", async () => {
    await visit("/homer.html");
    menu().value = "0"; menu().dispatchEvent(new Event("change"));
    await tick(); await app.ready; await tick();
    expect(param("manifest")).toBe(GOE);
    expect(param("urns")).toBeNull();
    expect(app.manifest?.canvases).toHaveLength(4);
    expect(menu().value).toBe("0");
  });

  it("full citation links work here, and Copy link makes full links on this page", async () => {
    await visit(`/homer.html?manifest=${VA}&urns=${VA_URNS}&urn=urn:cite2:hmt:vaimg:VA001RN_0002@0.1,0.2,0.3,0.4`);
    expect(param("canvas")).toBe("canvases/1r");
    expect($(".sel-link").dataset.url).toBe(
      `${location.origin}/homer.html?manifest=${VA}&urns=${VA_URNS}&urn=urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.1000,0.2000,0.3000,0.4000`);
  });

  it("a link naming a project manifest without urns= gets the collection's map", async () => {
    await visit(`/homer.html?manifest=${VA}&urn=urn:cite2:hmt:vaimg.2017a:VA001RN_0002`);
    expect(param("urns")).toBe(VA_URNS);
    expect(param("canvas")).toBe("canvases/1r");
  });

  it("a manifest from outside the project still opens, shown as Other", async () => {
    routes["https://elsewhere.org/m.json"] = JSON.stringify(goe);
    await visit("/homer.html?manifest=https://elsewhere.org/m.json");
    expect(menu().value).toBe("other");
    expect(menu().selectedOptions[0].textContent).toMatch(/^Other: Io\. Friderici Weidleri/);
  });

  it("a broken config falls back to the generic app with a notice", async () => {
    await visit("/homer.html", null, ['"title" must be a non-empty string']);
    expect($("input[name=manifest]")).not.toBeNull();
    expect($(".notices").textContent).toContain(`This page's project configuration can't be used: "title" must be a non-empty string`);
  });
});
