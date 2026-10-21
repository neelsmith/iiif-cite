import { describe, it, expect } from "vitest";
import { roiFromCorners } from "cite-roi";
import { imageUrl, infoSize, infoUrl, roiImageUrl, roiRegion, sizeParam, thumbnailUrl } from "../lib/image-api";

const v2 = { id: "https://x.org/iiif/a", version: 2 as const };
const v3 = { id: "https://x.org/iiif/b", version: 3 as const };

describe("Image API URLs", () => {
  it("uses full (v2) / max (v3) for full size", () => {
    expect(imageUrl(v2)).toBe("https://x.org/iiif/a/full/full/0/default.jpg");
    expect(imageUrl(v3)).toBe("https://x.org/iiif/b/full/max/0/default.jpg");
    expect(infoUrl(v3)).toBe("https://x.org/iiif/b/info.json");
  });
  it("builds sizes and thumbnails", () => {
    expect(sizeParam(v2, 150)).toBe("150,");
    expect(sizeParam(v3, undefined, 200.4)).toBe(",200");
    expect(thumbnailUrl(v3)).toBe("https://x.org/iiif/b/full/150,/0/default.jpg");
  });
});

describe("regions of interest → Image API regions", () => {
  const img = { w: 4000, h: 6000 };
  it("converts fractions to whole pixels", () => {
    expect(roiRegion({ x: 0, y: 0, w: 0.5, h: 0.5 }, img)).toBe("0,0,2000,3000");
    expect(roiRegion({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, img)).toBe("400,1200,1200,2400");
  });
  it("rounds the edges (not the width) so adjacent regions meet exactly", () => {
    // 4-decimal fractions as stored: 0.1234 * 4000 = 493.6 → 494; right edge 0.3456 * 4000 = 1382.4 → 1382
    expect(roiRegion({ x: 0.1234, y: 0, w: 0.2222, h: 1 }, img)).toBe("494,0,888,6000");
  });
  it("stays inside the image and is never empty", () => {
    expect(roiRegion({ x: 0.9999, y: 0.9999, w: 0.0001, h: 0.0001 }, { w: 100, h: 100 })).toBe("99,99,1,1");
  });
  it("works with a region drawn with cite-roi", () => {
    const r = roiFromCorners({ fx: 0.75, fy: 0.5 }, { fx: 0.25, fy: 0.25 })!;
    expect(roiImageUrl(v3, r, img)).toBe("https://x.org/iiif/b/1000,1500,2000,1500/max/0/default.jpg");
    expect(roiImageUrl(v2, r, img, 800)).toBe("https://x.org/iiif/a/1000,1500,2000,1500/800,/0/default.jpg");
  });
  it("reads the image size from info.json", () => {
    expect(infoSize({ "@id": "a", width: 6000, height: 8000 })).toEqual({ w: 6000, h: 8000 });
    expect(infoSize({ id: "a" })).toBeNull();
  });
});
