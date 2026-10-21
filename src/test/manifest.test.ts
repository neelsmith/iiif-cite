import { describe, it, expect } from "vitest";
import { labelText, parseManifest, serviceBase } from "../lib/manifest";
import v2 from "./fixtures/manifest-v2.json";
import v3 from "./fixtures/manifest-v3.json";

describe("labels", () => {
  it("reads v2 and v3 label forms", () => {
    expect(labelText("folio 1r")).toBe("folio 1r");
    expect(labelText({ "@value": "x", "@language": "en" })).toBe("x");
    expect(labelText([{ "@value": "fr", "@language": "fr" }, { "@value": "en", "@language": "en" }])).toBe("en");
    expect(labelText({ en: ["Book 1"] })).toBe("Book 1");
    expect(labelText({ none: ["p. 1"] })).toBe("p. 1");
    expect(labelText({ de: ["Buch"] })).toBe("Buch");
    expect(labelText(undefined)).toBe("");
  });
  it("normalizes service base URIs", () => {
    expect(serviceBase("https://x.org/iiif/a/info.json")).toBe("https://x.org/iiif/a");
    expect(serviceBase("https://x.org/iiif/a/")).toBe("https://x.org/iiif/a");
  });
});

describe("Presentation API 2.x", () => {
  const m = parseManifest(v2);
  it("reads manifest and canvases", () => {
    expect(m.version).toBe(2);
    expect(m.label).toBe("Manuscript 1");
    expect(m.canvases.map((c) => c.label)).toEqual(["folio 1r", "folio 1v"]);
    expect(m.canvases[0]).toMatchObject({
      id: "https://example.org/iiif/ms1/canvas/1r", width: 4000, height: 6000,
      thumbnail: "https://example.org/thumbs/1r.jpg",
      service: { id: "https://example.org/iiif/image/1r", version: 2, profile: "level2" },
    });
  });
  it("reports a canvas whose image has no Image API service", () => {
    expect(m.canvases[1].service).toBeNull();
    expect(m.canvases[1].imageUrl).toBe("https://example.org/static/1v.jpg");
    expect(m.errors).toEqual(["canvas folio 1v: image has no IIIF Image API service (static image only)"]);
  });
});

describe("Presentation API 3.0", () => {
  const m = parseManifest(v3);
  it("reads manifest and canvases", () => {
    expect(m.version).toBe(3);
    expect(m.label).toBe("Book 1");
    expect(m.canvases[0]).toMatchObject({
      label: "p. 1", width: 3000, height: 4000,
      service: { id: "https://example.org/iiif/image/p1", version: 3, profile: "level1" },
      thumbnail: "https://example.org/iiif/image/p1/full/100,/0/default.jpg",
    });
    expect(m.errors).toEqual([]);
  });
  it("takes the first item of a Choice, and an Image API 2 service inside a v3 manifest", () => {
    expect(m.canvases[1].service).toEqual({ id: "https://example.org/iiif/image/p2-color", version: 2, profile: "level2" });
  });
});

describe("not a manifest", () => {
  it("throws a readable error", () => {
    expect(() => parseManifest([])).toThrow(/JSON object/);
    expect(() => parseManifest({ type: "Collection" })).toThrow(/collection/);
    expect(() => parseManifest({ foo: 1 })).toThrow(/type "missing"/);
  });
  it("collects problems without failing", () => {
    const m = parseManifest({ type: "Manifest", id: "m", items: [{ type: "Canvas", id: "c1", items: [] }] });
    expect(m.canvases).toHaveLength(1);
    expect(m.errors).toEqual(["canvas c1: missing width or height", "canvas c1: no painted image"]);
  });
});
