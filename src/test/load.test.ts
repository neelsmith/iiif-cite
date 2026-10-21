import { describe, it, expect } from "vitest";
import { loadManifest, loadUrnMapUrl } from "../lib/load";
import v3 from "./fixtures/manifest-v3.json";

const respond = (body: string, status = 200) => async () => new Response(body, { status });

describe("loading", () => {
  it("loads and parses a manifest", async () => {
    const m = await loadManifest("https://x/m", respond(JSON.stringify(v3)));
    expect(m.canvases).toHaveLength(2);
  });
  it("explains failures", async () => {
    await expect(loadManifest("https://x/m", respond("nope", 404))).rejects.toThrow("https://x/m: HTTP 404");
    await expect(loadManifest("https://x/m", respond("<html>"))).rejects.toThrow("https://x/m: not JSON");
    await expect(loadManifest("https://x/m", async () => { throw new TypeError("Failed to fetch"); }))
      .rejects.toThrow(/cross-origin/);
    await expect(loadManifest("https://x/m", respond("{}"))).rejects.toThrow(/Not a IIIF manifest/);
  });
  it("loads a URN map", async () => {
    const map = await loadUrnMapUrl("https://x/u.cex", respond("canvas|urn\nc1|urn:cite2:a:b.c:d"));
    expect(map.byCanvas.get("c1")).toBe("urn:cite2:a:b.c:d");
  });
});
