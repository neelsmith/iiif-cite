// HMT's Venetus A manifest (excerpt; see fixtures/README.md) and a URN map for all its canvases.
import { describe, it, expect } from "vitest";
import { roiUrn } from "cite-roi";
import { parseManifest } from "../lib/manifest";
import { parseUrnMap, urnForCanvas } from "../lib/urn-map";
import { urnCoverage } from "../lib/canvases";
import { roiImageUrl } from "../lib/image-api";
import va from "./fixtures/hmt-venetusA-excerpt.json";
import urnText from "./fixtures/hmt-venetusA-urns.cex?raw";

const IIP = "http://www.homermultitext.org/iipsrv?IIIF=/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a";

describe("HMT Venetus A", () => {
  const m = parseManifest(va);

  it("finds the Image API service on the painting annotation", () => {
    expect(m.errors).toEqual([]);
    expect(m.label).toBe("Venetus A manuscript");
    expect(m.canvases.map((c) => c.id)).toEqual(["canvases/insidefrontcover", "canvases/ir", expect.any(String), "canvases/insidebackcover"]);
    expect(m.canvases[1].service).toEqual({ id: `${IIP}/VAMSFolio_i_rectoN_0001.tif`, version: 2, profile: "level1" });
  });

  it("builds region URLs on an iipsrv ?IIIF= service", () => {
    const c = m.canvases[1];
    expect(roiImageUrl(c.service!, { x: 0.5, y: 0.5, w: 0.25, h: 0.25 }, { w: c.width, h: c.height }, 1000))
      .toBe(`${IIP}/VAMSFolio_i_rectoN_0001.tif/2714,3615,1357,1808/1000,/0/default.jpg`);
  });

  it("maps every canvas in the full manifest to a URN", () => {
    const map = parseUrnMap(urnText);
    expect(map.errors).toEqual([]);
    expect(map.byCanvas.size).toBe(662);
    expect(urnCoverage(m, map).withUrn).toBe(4);
    const urn = urnForCanvas(map, m.canvases[2])!;
    expect(urn).toBe("urn:cite2:hmt:vaimg.2017a:VA001RN_0002");
    expect(roiUrn(urn, { x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toBe("urn:cite2:hmt:vaimg.2017a:VA001RN_0002@0.1000,0.2000,0.3000,0.4000");
  });
});
