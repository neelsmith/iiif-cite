import { describe, it, expect } from "vitest";
import { parseManifest } from "../lib/manifest";
import { parseUrnMap } from "../lib/urn-map";
import { encodeParam, findByUrn, linkTo, parseCite2, sameObject } from "../lib/urn-link";
import va from "./fixtures/hmt-venetusA-excerpt.json";
import hmtMap from "./fixtures/hmt-venetusA-urns.cex?raw";

const canvases = parseManifest(va).canvases;
const map = parseUrnMap(hmtMap);

describe("CITE2 URNs", () => {
  it("parses with and without version and extension", () => {
    expect(parseCite2("urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.1,0.2,0.3,0.4")).toEqual(
      { namespace: "hmt", collection: "vaimg", version: "2017a", object: "VA001RN_0002", extension: "0.1,0.2,0.3,0.4" });
    expect(parseCite2("urn:cite2:hmt:vaimg:VA001RN_0002")).toEqual(
      { namespace: "hmt", collection: "vaimg", version: null, object: "VA001RN_0002", extension: null });
    expect(parseCite2("urn:cite2:demo:w.v1:1r.a")?.object).toBe("1r.a");
    for (const bad of ["urn:cts:greekLit:tlg0012.tlg001:1.1", "urn:cite2:hmt:vaimg.2017a:", "urn:cite2:hmt:vaimg.2017a"]) expect(parseCite2(bad), bad).toBeNull();
  });
  it("a URN without version matches any version; with one, only that version", () => {
    const mapped = parseCite2("urn:cite2:hmt:vaimg.2017a:VA001RN_0002")!;
    expect(sameObject(parseCite2("urn:cite2:hmt:vaimg:VA001RN_0002")!, mapped)).toBe(true);
    expect(sameObject(parseCite2("urn:cite2:hmt:vaimg.2017a:VA001RN_0002")!, mapped)).toBe(true);
    expect(sameObject(parseCite2("urn:cite2:hmt:vaimg.2018:VA001RN_0002")!, mapped)).toBe(false);
    expect(sameObject(parseCite2("urn:cite2:hmt:vaimg:VA001RN_0003")!, mapped)).toBe(false);
  });
});

describe("finding a canvas by URN", () => {
  it("finds the image, and its region", () => {
    expect(findByUrn(canvases, map, "urn:cite2:hmt:vaimg.2017a:VA001RN_0002")).toEqual({ ok: true, index: 2, roi: null });
    expect(findByUrn(canvases, map, "urn:cite2:hmt:vaimg:VA001RN_0002@0.1,0.2,0.3,0.4")).toEqual(
      { ok: true, index: 2, roi: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } });
  });
  it("explains what's wrong", () => {
    expect(findByUrn(canvases, map, "VA001RN_0002")).toEqual({ ok: false, error: "Not a CITE2 URN: VA001RN_0002" });
    expect(findByUrn(canvases, map, "urn:cite2:hmt:vaimg:VA001RN_0002@0.5,0.5,0.6,0.1")).toMatchObject({ ok: false, error: expect.stringMatching(/Not a region/) });
    expect(findByUrn(canvases, null, "urn:cite2:hmt:vaimg:VA001RN_0002")).toMatchObject({ ok: false, error: expect.stringMatching(/needs a URN map/) });
    expect(findByUrn(canvases, map, "urn:cite2:hmt:vaimg.2017a:VA999RN_0000@0.1,0.1,0.1,0.1")).toEqual(
      { ok: false, error: "No image with URN urn:cite2:hmt:vaimg.2017a:VA999RN_0000 in the URN map for this manifest" });
  });
});

describe("links", () => {
  it("keeps URNs and URLs readable but encodes & # + % and spaces", () => {
    expect(encodeParam("urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.1000,0.2000,0.3000,0.4000")).toBe("urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.1000,0.2000,0.3000,0.4000");
    expect(encodeParam("https://x.org/a?b=1&c=2#d e+f")).toBe("https://x.org/a%3Fb%3D1%26c%3D2%23d%20e%2Bf");
    const link = linkTo("https://neelsmith.github.io/iiif-cite/iiif-cite.html", [["manifest", "https://x/m.json"], ["urns", null], ["urn", "urn:cite2:a:b.c:d"]]);
    expect(link).toBe("https://neelsmith.github.io/iiif-cite/iiif-cite.html?manifest=https://x/m.json&urn=urn:cite2:a:b.c:d");
    const back = new URL("https://x.org/p?manifest=" + encodeParam("https://x.org/a?b=1&c=2") + "&urn=" + encodeParam("urn:cite2:a:b.c:d@0.1,0.1,0.2,0.2"));
    expect(back.searchParams.get("manifest")).toBe("https://x.org/a?b=1&c=2");
    expect(back.searchParams.get("urn")).toBe("urn:cite2:a:b.c:d@0.1,0.1,0.2,0.2");
  });
});
