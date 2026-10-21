import { describe, it, expect } from "vitest";
import { basePiece, chooseScaleFactor, iiifSource, parseImageInfo, staticSource, visibleTiles } from "../lib/tiles";
import { fitView } from "../lib/zoom";
import goeInfo from "./fixtures/goettingen-00000001-info.json";

const GOE = "https://images.sub.uni-goettingen.de/iiif/image/gdz:PPN623133725:00000001";
const goe = parseImageInfo(goeInfo, { id: GOE, version: 2, profile: "level1" });
const stage = { w: 1000, h: 800 };

describe("info.json", () => {
  it("reads size, tiles, rounded sizes and the real compliance level", () => {
    expect(goe.size).toEqual({ w: 1408, h: 1672 });
    expect(goe.tiles).toEqual({ width: 512, height: 512, scaleFactors: [1, 2, 4, 8, 16] });
    expect(goe.sizes[0]).toEqual({ w: 88, h: 105 }); // 104.5 in info.json
    expect(goe.level).toBe(2); // manifest said level1
    expect(goe.service).toEqual({ id: GOE, version: 2, profile: "level2" });
  });
  it("keeps the manifest's service id and handles v3 and missing pieces", () => {
    const i = parseImageInfo(
      { "@context": "http://iiif.io/api/image/3/context.json", id: "http://internal:8080/x", type: "ImageService3", profile: "level0", width: 100, height: 50 },
      { id: "https://pub.org/iiif/x/", version: 2 });
    expect(i.service).toEqual({ id: "https://pub.org/iiif/x", version: 3, profile: "level0" });
    expect([i.tiles, i.sizes, i.level]).toEqual([null, [], 0]);
    expect(() => parseImageInfo({ width: 0 }, { id: "a", version: 2 })).toThrow(/width/);
  });
});

describe("pyramid level", () => {
  it("picks the coarsest level that is still sharp", () => {
    const f = [1, 2, 4, 8, 16];
    expect(chooseScaleFactor(f, 1)).toBe(1);
    expect(chooseScaleFactor(f, 4)).toBe(1); // zoomed past full resolution
    expect(chooseScaleFactor(f, 0.5)).toBe(2);
    expect(chooseScaleFactor(f, 0.3)).toBe(2); // 1/0.3 = 3.3: level 4 would be soft
    expect(chooseScaleFactor(f, 0.24)).toBe(4);
    expect(chooseScaleFactor(f, 0.5, 2)).toBe(1); // HiDPI screen
    expect(chooseScaleFactor(f, 0.001)).toBe(16);
  });
});

describe("tiles to draw", () => {
  it("covers the image fitted in the stage with level-2 tiles", () => {
    const v = fitView(stage, goe.size); // scale ≈ 0.478 → sf 2 → tiles span 1024 px
    const t = visibleTiles(goe, v, stage);
    expect(t.map((p) => p.url.slice(GOE.length))).toEqual([
      "/0,0,1024,1024/512,/0/default.jpg", "/1024,0,384,1024/192,/0/default.jpg",
      "/0,1024,1024,648/512,/0/default.jpg", "/1024,1024,384,648/192,/0/default.jpg",
    ]);
    expect(t[3]).toMatchObject({ x: 1024, y: 1024, w: 384, h: 648, sf: 2 });
  });
  it("only requests tiles in view when zoomed in", () => {
    const v = { scale: 2, x: -1000, y: -1000 }; // shows image px 500–1000 × 500–900
    const t = visibleTiles(goe, v, stage);
    expect(t.every((p) => p.sf === 1)).toBe(true);
    expect(t.map((p) => `${p.x},${p.y}`)).toEqual(["0,0", "512,0", "0,512", "512,512"]);
    expect(visibleTiles(goe, v, stage, 1, 256)).toHaveLength(9); // with a 256-px margin
  });
  it("uses 'full' for a single tile covering the whole image, and w,h sizes in Image API 3", () => {
    const v3 = { ...goe, service: { ...goe.service, version: 3 as const } };
    const t = visibleTiles(v3, { scale: 0.01, x: 0, y: 0 }, stage);
    expect(t.map((p) => p.url.slice(GOE.length))).toEqual(["/full/88,105/0/default.jpg"]);
  });
  it("draws nothing off-image or without tiles", () => {
    expect(visibleTiles(goe, { scale: 1, x: 5000, y: 0 }, stage)).toEqual([]);
    expect(visibleTiles({ ...goe, tiles: null }, { scale: 1, x: 0, y: 0 }, stage)).toEqual([]);
  });
});

describe("base image", () => {
  it("uses the largest listed size up to 1024 px", () => {
    expect(basePiece(goe)).toMatchObject({ url: `${GOE}/full/704,/0/default.jpg`, w: 1408, h: 1672, sf: 2 });
  });
  it("asks for a scaled image without listed sizes, or the full image at level 0", () => {
    const plain = { ...goe, sizes: [] };
    expect(basePiece(plain).url).toBe(`${GOE}/full/1024,/0/default.jpg`);
    expect(basePiece({ ...plain, level: 0 as const }).url).toBe(`${GOE}/full/full/0/default.jpg`);
    expect(basePiece({ ...plain, level: 0 as const, service: { id: GOE, version: 3 } }).url).toBe(`${GOE}/full/max/0/default.jpg`);
  });
  it("sources: IIIF and static", () => {
    expect(iiifSource(goe).tiles(fitView(stage, goe.size), stage, 1)).toHaveLength(4);
    const s = staticSource("https://x/a.jpg", { w: 10, h: 20 });
    expect([s.base.url, s.tiles({ scale: 1, x: 0, y: 0 }, stage, 1)]).toEqual(["https://x/a.jpg", []]);
  });
});
