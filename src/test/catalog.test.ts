import { describe, it, expect } from "vitest";
import { catalogImageUrl, catalogThumbUrl, detectDelimiter, looksLikeCatalog, parseCatalog } from "../lib/catalog";
import { browse, facetValues, matches } from "../lib/browse";
import { loadSource } from "../lib/load";
import { urnForCanvas } from "../lib/urn-map";
import { findByUrn } from "../lib/urn-link";
import lips from "./fixtures/lips7-catalog.cex?raw";
import v3 from "./fixtures/manifest-v3.json";

const EG = "https://eg.com/images/catalog.cex";
const LIPS = "https://shot.holycross.edu/images/mss/lipsius7/lips7.cex";
const opts = { group: "none" as const, query: "", year: "", place: "" };

describe("catalog image and thumbnail URLs", () => {
  it("resolves paths against the catalog's URL", () => {
    expect(catalogImageUrl(EG, "Project1/imageA.png")).toBe("https://eg.com/images/Project1/imageA.png");
    expect(catalogImageUrl(EG, "top.jpg")).toBe("https://eg.com/images/top.jpg");
    expect(catalogImageUrl(EG, "My Photos/a #1.jpg")).toBe("https://eg.com/images/My%20Photos/a%20%231.jpg");
  });
  it("thumbnails: <folder>/_thumbs/<file>.jpg", () => {
    expect(catalogThumbUrl(EG, "Project1/imageA.png")).toBe("https://eg.com/images/Project1/_thumbs/imageA.png.jpg");
    expect(catalogThumbUrl(EG, "a/b/c.tif")).toBe("https://eg.com/images/a/b/_thumbs/c.tif.jpg");
    expect(catalogThumbUrl(EG, "top.jpg")).toBe("https://eg.com/images/_thumbs/top.jpg.jpg");
  });
});

describe("parseCatalog", () => {
  it("reads the two required columns (the user's example)", () => {
    const c = parseCatalog("path|urn\nProject1/imageA.png|urn:cite2:iiifcite:proj1.v1:imgA\n", EG, true);
    const [img] = c.manifest.canvases;
    expect(img).toMatchObject({ id: "Project1/imageA.png", label: "imageA.png", service: null,
      imageUrl: "https://eg.com/images/Project1/imageA.png", thumbnail: "https://eg.com/images/Project1/_thumbs/imageA.png.jpg" });
    expect(urnForCanvas(c.urnMap, img)).toBe("urn:cite2:iiifcite:proj1.v1:imgA");
    expect(c.manifest.errors).toEqual([]);
    expect(c.manifest.label).toBe("catalog.cex");
  });
  it("keeps captions, credits, license and tags; no thumbnails unless asked", () => {
    const c = parseCatalog(lips, LIPS, false);
    expect(c.manifest.canvases).toHaveLength(6);
    expect(c.manifest.canvases[0].label).toBe("Leiden, MS Lipsius 7  in shelving box, overview of front cover and spine.");
    expect(c.manifest.canvases[0].imageUrl).toBe("https://shot.holycross.edu/images/mss/lipsius7/leiden-pliny/IMG_1200.jpeg");
    expect(c.manifest.canvases[0].thumbnail).toBeNull();
    expect(c.entries.get("leiden-pliny/IMG_1201.jpeg")).toMatchObject({
      credits: "Photograph Neel Smith, 2019", license: "Public domain (CC0)", tags: ["Pliny", "Leiden", "binding"] });
    expect(c.manifest.errors).toEqual([]);
    expect(findByUrn(c.manifest.canvases, c.urnMap, "urn:cite2:citeleiden:lipsius7:IMG_1203@0.1,0.1,0.5,0.5"))
      .toMatchObject({ ok: true, index: 3 });
  });
  it("reports problems without failing; no path column is not a catalog", () => {
    const c = parseCatalog("path|caption\na.jpg|A\n", EG, false);
    expect(c.manifest.errors).toEqual(['catalog has no "urn" column, so its images have no CITE2 URNs']);
    const bad = parseCatalog("path|urn\na.jpg|urn:cite2:x:y.v1:a\na.jpg|urn:cite2:x:y.v1:b\nb.jpg|nope\nc.jpg|\nd.jpg|urn:cite2:x:y.v1:a\n|urn:cite2:x:y.v1:e", EG, false);
    expect(bad.manifest.canvases.map((x) => x.id)).toEqual(["a.jpg", "b.jpg", "c.jpg", "d.jpg"]);
    expect(bad.manifest.errors).toEqual(["row 2: a.jpg is listed twice; the first row is used", "row 3: not a CITE2 object URN: nope",
      "row 4: c.jpg has no URN", "row 5: URN urn:cite2:x:y.v1:a is also given to a.jpg", "row 6: empty path; skipped"]);
    expect(() => parseCatalog("image|urn\na|b", EG, false)).toThrow(/no "path" column/);
  });
  it("delimiter: | unless the header has none, then tab, then comma", () => {
    expect(detectDelimiter("// note\npath|urn\n")).toBe("|");
    expect(detectDelimiter("path\turn\n")).toBe("\t");
    expect(detectDelimiter("path,urn\n")).toBe(",");
    const t = parseCatalog("path\tcaption\turn\nx/a.jpg\tA, with comma\turn:cite2:x:y.v1:a\n", EG, false);
    expect(t.manifest.canvases[0].label).toBe("A, with comma");
    expect(looksLikeCatalog(lips)).toBe(true);
    expect(looksLikeCatalog("<html><body>Not found</body></html>")).toBe(false);
  });
});

describe("grouping and filtering", () => {
  const c = parseCatalog(lips, LIPS, false);
  const ids = (b: { order: { id: string }[] }) => b.order.map((x) => x.id.slice(-9, -5));
  it("catalog order: one group without a heading", () => {
    const b = browse(c, opts);
    expect(b.groups).toHaveLength(1);
    expect(b.groups[0].label).toBe("");
    expect(ids(b)).toEqual(["1200", "1201", "1202", "1203", "1204", "1205"]);
  });
  it("by tag: an image in each of its tags, untagged last; previous/next see each image once", () => {
    const b = browse(c, { ...opts, group: "tag" });
    expect(b.groups.map((g) => `${g.label} ${g.canvases.length}`)).toEqual(["binding 2", "Leiden 4", "Pliny 4", "Untagged 1"]);
    expect(ids(b)).toEqual(["1201", "1202", "1200", "1203", "1205", "1204"]);
  });
  it("filter: every word, any field, ignoring case", () => {
    expect(ids(browse(c, { ...opts, query: "LOCKS open" }))).toEqual(["1202"]);
    expect(ids(browse(c, { ...opts, query: "binding" }))).toEqual(["1201", "1202"]); // caption or tag
    expect(ids(browse(c, { ...opts, query: "IMG_1204" }))).toEqual(["1204"]); // path
    expect(browse(c, { ...opts, query: "nothing" }).groups).toEqual([]);
    expect(matches(c.entries.get("leiden-pliny/IMG_1205.jpeg")!, "lipsius7.v1:IMG_1205")).toBe(true); // URN
  });
  it("year and place columns, when there are any, are drop-downs", () => {
    const y = parseCatalog("path|year|place|urn\na.jpg|2019|Leiden|\nb.jpg|1986|Priene|\nc.jpg|2019||\n", EG, false);
    expect(facetValues(y, "year")).toEqual(["1986", "2019"]);
    expect(facetValues(y, "place")).toEqual(["Leiden", "Priene"]);
    expect(facetValues(c, "year")).toEqual([]);
    expect(browse(y, { ...opts, year: "2019" }).order.map((x) => x.id)).toEqual(["a.jpg", "c.jpg"]);
    expect(browse(y, { ...opts, year: "2019", place: "Leiden" }).order.map((x) => x.id)).toEqual(["a.jpg"]);
  });
});

describe("loadSource", () => {
  const respond = (body: string) => async () => new Response(body);
  it("tells a manifest from a catalog by content", async () => {
    expect((await loadSource("https://x/m", respond(JSON.stringify(v3)), false)).kind).toBe("manifest");
    const s = await loadSource(LIPS, respond(lips), true);
    expect(s.kind).toBe("catalog");
    if (s.kind === "catalog") expect(s.catalog.manifest.canvases[0].thumbnail).toBe(
      "https://shot.holycross.edu/images/mss/lipsius7/leiden-pliny/_thumbs/IMG_1200.jpeg.jpg");
    await expect(loadSource("https://x/p", respond("<html>"), false)).rejects.toThrow(/neither a IIIF manifest .* nor an image catalog/);
  });
});
