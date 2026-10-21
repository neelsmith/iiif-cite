import { describe, it, expect } from "vitest";
import { roiUrn } from "cite-roi";
import { canvasImageId, imageKey, parseUrnMap, urnForCanvas } from "../lib/urn-map";
import type { CanvasInfo } from "../lib/manifest";

const canvas = (id: string, service: string | null, imageUrl: string | null = null): CanvasInfo =>
  ({ id, label: id, width: 1, height: 1, service: service ? { id: service, version: 2 } : null, imageUrl, thumbnail: null });

describe("image → URN map (CEX)", () => {
  const map = parseUrnMap(`// Venetus A
Image|URN|label
http://iip.org/iipsrv?IIIF=/va/VA001RN_0002.tif|urn:cite2:hmt:vaimg.2017a:VA001RN_0002|folio 1, recto
https://iip.org/iipsrv?IIIF=/va/VA001VN_0003.tif/info.json|urn:cite2:hmt:vaimg.2017a:VA001VN_0003@0.1,0.1,0.2,0.2|folio 1, verso
https://static.org/a.jpg|urn:cite2:hmt:vaimg.2017a:a.1|static
https://iip.org/x|not-a-urn|bad
`);
  it("matches by image service id, ignoring http/https and /info.json", () => {
    expect(map.errors).toEqual(["row 4: not a CITE2 object URN: not-a-urn"]);
    expect(urnForCanvas(map, canvas("c1", "https://iip.org/iipsrv?IIIF=/va/VA001RN_0002.tif"))).toBe("urn:cite2:hmt:vaimg.2017a:VA001RN_0002");
    expect(urnForCanvas(map, canvas("c2", "http://iip.org/iipsrv?IIIF=/va/VA001VN_0003.tif"))).toBe("urn:cite2:hmt:vaimg.2017a:VA001VN_0003");
    expect(urnForCanvas(map, canvas("c3", null, "http://static.org/a.jpg"))).toBe("urn:cite2:hmt:vaimg.2017a:a.1"); // "." allowed in object ids
    expect(urnForCanvas(map, canvas("c4", "https://iip.org/other"))).toBeNull();
    expect(urnForCanvas(null, canvas("c1", "https://iip.org/iipsrv?IIIF=/va/VA001RN_0002.tif"))).toBeNull();
  });
  it("keys and ids", () => {
    expect(imageKey("HTTPS://a.org/x/info.json")).toBe("a.org/x");
    expect(imageKey("http://a.org/x/")).toBe("a.org/x");
    expect(canvasImageId(canvas("c", "s"))).toBe("s");
    expect(canvasImageId(canvas("c", null, "u"))).toBe("u");
  });
});

describe("canvas → URN map (older format)", () => {
  const map = parseUrnMap(`canvas|urn|label
https://ex.org/c/1r|urn:cite2:hmt:vaimg.2017a:VA001RN_0002|1r
https://ex.org/c/2r|not-a-urn|2r
`);
  it("still reads; a canvas row wins over an image row", () => {
    expect(map.errors).toEqual(["row 2: not a CITE2 object URN: not-a-urn"]);
    expect(urnForCanvas(map, canvas("https://ex.org/c/1r", null))).toBe("urn:cite2:hmt:vaimg.2017a:VA001RN_0002");
    const both = parseUrnMap("image|canvas|urn\ni1||urn:cite2:a:b.c:img\n|c1|urn:cite2:a:b.c:canv");
    expect(urnForCanvas(both, canvas("c1", "i1"))).toBe("urn:cite2:a:b.c:canv");
    expect(urnForCanvas(both, canvas("c2", "i1"))).toBe("urn:cite2:a:b.c:img");
  });
  it("reports bad headers and conflicting rows", () => {
    expect(parseUrnMap("a|b\n1|2").errors).toEqual(['header must include "urn" and an "image" (or "canvas") column']);
    expect(parseUrnMap("image|urn\ni|urn:cite2:a:b:c\nhttps://i|urn:cite2:a:b:d").errors).toEqual(["row 2: image listed twice with different URNs: i"]);
    expect(parseUrnMap("image|urn\n|urn:cite2:a:b:c").errors).toEqual(["row 1: missing image"]);
  });
  it("gives region URNs together with cite-roi", () => {
    const urn = urnForCanvas(map, canvas("https://ex.org/c/1r", null))!;
    expect(roiUrn(urn, { x: 0.5, y: 0, w: 0.5, h: 0.25 })).toBe("urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.5000,0.0000,0.5000,0.2500");
  });
});
