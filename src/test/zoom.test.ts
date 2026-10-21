import { describe, it, expect } from "vitest";
import { fitScale, fitView, clampView, zoomAt, panBy, isZoomed, toggleZoom, wheelFactor, MAX_ZOOM } from "../lib/zoom";

const stage = { w: 1000, h: 800 };
const photo = { w: 4032, h: 3024 }; // typical phone photo
const small = { w: 400, h: 300 };

describe("zoom math", () => {
  it("fits large images, never enlarges small ones", () => {
    expect(fitScale(stage, photo)).toBeCloseTo(1000 / 4032);
    expect(fitScale(stage, small)).toBe(1);
    expect(fitScale({ w: 0, h: 0 }, photo)).toBe(1);
  });

  it("fit view centers the image", () => {
    const v = fitView(stage, photo);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo((800 - 3024 * v.scale) / 2);
  });

  it("zooming keeps the point under the cursor fixed", () => {
    const v0 = fitView(stage, photo);
    const [px, py] = [300, 400];
    const imgX = (px - v0.x) / v0.scale, imgY = (py - v0.y) / v0.scale;
    const v1 = zoomAt(v0, 2, px, py, stage, photo);
    expect(v1.scale).toBeCloseTo(v0.scale * 2);
    expect(v1.x + imgX * v1.scale).toBeCloseTo(px);
    expect(v1.y + imgY * v1.scale).toBeCloseTo(py);
  });

  it("clamps zoom between fit and MAX_ZOOM", () => {
    const v0 = fitView(stage, photo);
    expect(zoomAt(v0, 0.1, 500, 400, stage, photo).scale).toBeCloseTo(v0.scale);
    expect(zoomAt(v0, 1000, 500, 400, stage, photo).scale).toBe(MAX_ZOOM);
  });

  it("panning stops at the image edges", () => {
    const v = { scale: 1, x: 0, y: 0 };
    expect(panBy(v, 500, 500, stage, photo)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(panBy(v, -99999, -99999, stage, photo)).toEqual({ scale: 1, x: 1000 - 4032, y: 800 - 3024 });
    expect(clampView({ scale: 1, x: 123, y: -5 }, stage, small)).toEqual({ scale: 1, x: 300, y: 250 });
  });

  it("double-click toggles fit ↔ 100% (or 2× for small images)", () => {
    const fit = fitView(stage, photo);
    const in1 = toggleZoom(fit, 500, 400, stage, photo);
    expect(in1.scale).toBe(1);
    expect(isZoomed(in1, stage, photo)).toBe(true);
    expect(toggleZoom(in1, 0, 0, stage, photo)).toEqual(fit);
    expect(toggleZoom(fitView(stage, small), 500, 400, stage, small).scale).toBe(2);
  });

  it("wheel: scroll down zooms out, up zooms in; pinch is stronger; lines/pages normalized", () => {
    expect(wheelFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelFactor(-10, 0, true)).toBeCloseTo(wheelFactor(-50, 0, false));
    expect(wheelFactor(-3, 1, false)).toBeCloseTo(wheelFactor(-48, 0, false));
  });
});
