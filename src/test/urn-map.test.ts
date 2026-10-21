import { describe, it, expect } from "vitest";
import { roiUrn } from "cite-roi";
import { parseUrnMap, urnForCanvas } from "../lib/urn-map";

const text = `// canvases of the Venetus A
Canvas|URN|label
https://ex.org/c/1r|urn:cite2:hmt:vaimg.2017a:VA001RN_0002|1r
https://ex.org/c/1v|urn:cite2:hmt:vaimg.2017a:VA001VN_0003@0.1,0.1,0.2,0.2|1v
https://ex.org/c/2r|not-a-urn|2r
`;

describe("canvas → URN map (CEX)", () => {
  const map = parseUrnMap(text);
  it("maps canvases to image URNs, dropping any region extension", () => {
    expect(urnForCanvas(map, "https://ex.org/c/1r")).toBe("urn:cite2:hmt:vaimg.2017a:VA001RN_0002");
    expect(urnForCanvas(map, "https://ex.org/c/1v")).toBe("urn:cite2:hmt:vaimg.2017a:VA001VN_0003");
    expect(urnForCanvas(map, "https://ex.org/c/9")).toBeNull();
    expect(urnForCanvas(null, "https://ex.org/c/1r")).toBeNull();
  });
  it("reports bad rows and headers", () => {
    expect(map.errors).toEqual(["row 3: not a CITE2 object URN: not-a-urn"]);
    expect(parseUrnMap("a|b\n1|2").errors).toEqual(['header must include "canvas" and "urn" columns']);
  });
  it("gives region URNs together with cite-roi", () => {
    const urn = urnForCanvas(map, "https://ex.org/c/1r")!;
    expect(roiUrn(urn, { x: 0.5, y: 0, w: 0.5, h: 0.25 })).toBe("urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.5000,0.0000,0.5000,0.2500");
  });
});
