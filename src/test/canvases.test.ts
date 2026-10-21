import { describe, it, expect } from "vitest";
import { parseManifest } from "../lib/manifest";
import { parseUrnMap } from "../lib/urn-map";
import { thumbCandidates, urnCoverage } from "../lib/canvases";
import v2 from "./fixtures/manifest-v2.json";
import goe from "./fixtures/goettingen-PPN623133725-excerpt.json";

describe("thumbnails", () => {
  const m = parseManifest(v2);
  it("tries the Image API, then the manifest thumbnail, then the image", () => {
    expect(thumbCandidates(m.canvases[0])).toEqual([
      "https://example.org/iiif/image/1r/full/300,/0/default.jpg",
      "https://example.org/thumbs/1r.jpg",
      "https://example.org/iiif/image/1r/full/full/0/default.jpg",
    ]);
  });
  it("falls back to a static image", () => {
    expect(thumbCandidates(m.canvases[1])).toEqual(["https://example.org/static/1v.jpg"]);
  });
});

describe("URN coverage", () => {
  const m = parseManifest(goe);
  const base = "https://manifests.sub.uni-goettingen.de/iiif/presentation/PPN623133725/canvas/gdz:PPN623133725:";
  it("counts canvases with URNs and lists map rows for other canvases", () => {
    const map = parseUrnMap(`canvas|urn
${base}00000025|urn:cite2:demo:weidler.v1:p1
${base}00000085|urn:cite2:demo:weidler.v1:p61
${base}00000099|urn:cite2:demo:weidler.v1:p75`);
    expect(urnCoverage(m, map)).toEqual({ withUrn: 2, unknownCanvases: [`${base}00000099`] });
  });
});
