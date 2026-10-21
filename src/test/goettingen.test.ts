// A real IIIF 2.x manifest from SUB Göttingen (excerpt; see fixtures/README.md).
import { describe, it, expect } from "vitest";
import { parseManifest } from "../lib/manifest";
import { infoSize, roiImageUrl, roiRegion, thumbnailUrl } from "../lib/image-api";
import manifest from "./fixtures/goettingen-PPN623133725-excerpt.json";
import info from "./fixtures/goettingen-00000001-info.json";

describe("SUB Göttingen PPN623133725", () => {
  const m = parseManifest(manifest);

  it("reads the manifest without problems", () => {
    expect(m.version).toBe(2);
    expect(m.label).toMatch(/^Io\. Friderici Weidleri Historia Astronomiae/);
    expect(m.errors).toEqual([]);
    expect(m.canvases.map((c) => c.label)).toEqual(["-", "-", "1", "61"]);
  });

  it("finds each canvas's Image API 2 service", () => {
    expect(m.canvases[0].service).toEqual({
      id: "https://images.sub.uni-goettingen.de/iiif/image/gdz:PPN623133725:00000001", version: 2, profile: "level1",
    });
    expect(thumbnailUrl(m.canvases[0].service!)).toBe(
      "https://images.sub.uni-goettingen.de/iiif/image/gdz:PPN623133725:00000001/full/150,/0/default.jpg");
  });

  it("measures regions against the image (info.json), not the nominal canvas", () => {
    const c = m.canvases[0];
    expect([c.width, c.height]).toEqual([300, 400]);
    const img = infoSize(info)!;
    expect(img).toEqual({ w: 1408, h: 1672 });
    const r = { x: 0.25, y: 0.5, w: 0.5, h: 0.25 };
    expect(roiRegion(r, img)).toBe("352,836,704,418");
    expect(roiRegion(r, { w: c.width, h: c.height })).toBe("75,200,150,100"); // what using the canvas would wrongly give
    expect(roiImageUrl(c.service!, r, img)).toBe(
      "https://images.sub.uni-goettingen.de/iiif/image/gdz:PPN623133725:00000001/352,836,704,418/full/0/default.jpg");
  });
});
