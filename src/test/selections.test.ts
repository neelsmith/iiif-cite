import { describe, it, expect } from "vitest";
import { parseManifest } from "../lib/manifest";
import { fileStem, regionImageUrl, selectionsText } from "../lib/selections";
import va from "./fixtures/hmt-venetusA-excerpt.json";

const m = parseManifest(va);
const [, ir, f1r] = m.canvases;
const IIP = "http://www.homermultitext.org/iipsrv?IIIF=/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a";
const size = { w: 5428, h: 7230 };
const r = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };

describe("selection outputs", () => {
  it("IIIF region image URL: scaled for viewing, or full resolution", () => {
    expect(regionImageUrl({ canvas: f1r, imageSize: size }, r)).toBe(`${IIP}/VA001RN_0002.tif/543,1446,1628,2892/1200,/0/default.jpg`);
    expect(regionImageUrl({ canvas: f1r, imageSize: size }, r, Infinity)).toBe(`${IIP}/VA001RN_0002.tif/543,1446,1628,2892/full/0/default.jpg`);
    expect(regionImageUrl({ canvas: f1r, imageSize: null }, r)).toBeNull();
  });

  it("exports one URN per line; canvases without a URN as comments", () => {
    const urnFor = (c: { id: string }) => (c.id === "canvases/1r" ? "urn:cite2:hmt:vaimg.2017a:VA001RN_0002" : null);
    const text = selectionsText([
      { canvas: ir, rois: [r] },
      { canvas: f1r, rois: [r, { x: 0, y: 0, w: 0.5, h: 0.5 }] },
    ], urnFor);
    expect(text).toBe([
      "urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.1000,0.2000,0.3000,0.4000",
      "urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.0000,0.0000,0.5000,0.5000",
      "// Canvases without a URN (add them to the URN map):",
      "// canvases/ir@0.1000,0.2000,0.3000,0.4000",
      "",
    ].join("\n"));
    expect(selectionsText([{ canvas: f1r, rois: [r] }], urnFor)).toBe("urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.1000,0.2000,0.3000,0.4000\n");
  });

  it("file names from labels", () => {
    expect(fileStem("Venetus A manuscript")).toBe("venetus-a-manuscript");
    expect(fileStem("Io. Friderici Weidleri Historia Astronomiae Sive De Ortu Et Progressu Astronomiae Liber")).toBe("io-friderici-weidleri-historia-astronomiae-sive-de-ortu-et-p");
    expect(fileStem("Ἰλιάς")).toBe("selections");
  });
});
