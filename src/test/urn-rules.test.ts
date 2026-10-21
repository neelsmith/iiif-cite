import { describe, it, expect } from "vitest";
import { parseManifest, type CanvasInfo } from "../lib/manifest";
import { parseUrnMap, urnForCanvas } from "../lib/urn-map";
import { cleanId, collectionProblem, defaultRule, draftUrns, lastPart, noEdits, urnMapText, type UrnRule } from "../lib/urn-rules";
import va from "./fixtures/hmt-venetusA-excerpt.json";
import goe from "./fixtures/goettingen-PPN623133725-excerpt.json";
import hmtCanvasMap from "./fixtures/hmt-venetusA-urns.cex?raw";

const hmt = parseManifest(va).canvases;
const weidler = parseManifest(goe).canvases;
const rule = (r: Partial<UrnRule>): UrnRule => ({ ...defaultRule(), ...r });
const urns = (cs: CanvasInfo[], r: Partial<UrnRule>, edits = noEdits()) => draftUrns(cs, rule(r), edits).map((d) => d.urn);

describe("pieces", () => {
  it("collection URNs", () => {
    expect(collectionProblem("urn:cite2:hmt:vaimg.2017a:")).toBeNull();
    expect(collectionProblem("urn:cite2:demo:weidler:")).toBeNull(); // version optional
    expect(collectionProblem("")).toMatch(/Enter/);
    expect(collectionProblem("urn:cts:x:y:")).toMatch(/starts with/);
    expect(collectionProblem("urn:cite2:hmt:vaimg.2017a")).toMatch(/colon/);
    expect(collectionProblem("urn:cite2:hmt:va.img.2017a:")).toMatch(/Expected/);
  });
  it("generic clean-up keeps letters, digits, . _ -", () => {
    expect(cleanId("folio 1, recto")).toBe("folio1recto");
    expect(cleanId("Ἰλιάς Α")).toBe("");
    expect(cleanId("Pétrus.1r_a-b ")).toBe("Petrus.1r_a-b");
    expect(cleanId(" - ")).toBe("");
    expect(lastPart("http://x/iipsrv?IIIF=/a/VA001RN_0002.tif")).toBe("VA001RN_0002.tif");
  });
});

describe("rules on real manifests", () => {
  it("HMT: image file name reproduces HMT's own URNs", () => {
    const got = urns(hmt, { collection: "urn:cite2:hmt:vaimg.2017a:", kind: "file" });
    const expected = parseUrnMap(hmtCanvasMap); // generated from the full manifest earlier
    expect(got).toEqual(hmt.map((c) => urnForCanvas(expected, c)));
    expect(got[2]).toBe("urn:cite2:hmt:vaimg.2017a:VA001RN_0002");
  });
  it("canvas id and label", () => {
    expect(urns(hmt, { collection: "urn:cite2:demo:va.v1:", kind: "canvas" })).toEqual(
      ["insidefrontcover", "ir", "1r", "insidebackcover"].map((s) => `urn:cite2:demo:va.v1:${s}`));
    expect(urns(hmt, { collection: "urn:cite2:demo:va.v1:", kind: "label" })[2]).toBe("urn:cite2:demo:va.v1:VenetusAMarciana454822folio1recto");
  });
  it("Göttingen: numbers in order, with a restart where the page numbers begin", () => {
    const edits = noEdits();
    const r = { collection: "urn:cite2:demo:weidler.v1:", kind: "number" as const, prefix: "f", pad: 3 };
    expect(urns(weidler, r)).toEqual(["f001", "f002", "f003", "f004"].map((s) => `urn:cite2:demo:weidler.v1:${s}`));
    edits.restarts.set(weidler[2].id, 1); // canvas 25 is page "1"
    expect(urns(weidler, { ...r, prefix: "p" }, edits).map((u) => u?.split(":").pop())).toEqual(["p001", "p002", "p001", "p002"]);
  });
  it("pattern: first group of a regular expression on the image id", () => {
    expect(urns(weidler, { collection: "urn:cite2:demo:weidler.v1:", kind: "pattern", pattern: ":(\\d{8})$" })[2])
      .toBe("urn:cite2:demo:weidler.v1:00000025");
    expect(urns(weidler, { collection: "urn:cite2:demo:weidler.v1:", kind: "pattern", pattern: "(" })).toEqual([null, null, null, null]);
  });
});

describe("drafts", () => {
  it("flags missing, invalid and duplicate URNs; no collection → none", () => {
    expect(draftUrns(hmt, rule({ kind: "file" }), noEdits()).map((d) => d.problem)).toEqual(["none", "none", "none", "none"]);
    const d = draftUrns(weidler, rule({ collection: "urn:cite2:demo:w.v1:", kind: "label" }), noEdits());
    // labels " - " clean to nothing → no URN
    expect(d.map((x) => [x.urn, x.problem])).toEqual([
      [null, "none"], [null, "none"], ["urn:cite2:demo:w.v1:1", null], ["urn:cite2:demo:w.v1:61", null]]);
    const dup = noEdits(); dup.hand.set(weidler[3].id, "urn:cite2:demo:w.v1:1");
    expect(draftUrns(weidler, rule({ collection: "urn:cite2:demo:w.v1:", kind: "label" }), dup).map((x) => x.problem))
      .toEqual(["none", "none", "duplicate", "duplicate"]);
    const bad = noEdits(); bad.hand.set(weidler[0].id, "urn:cite2:demo:w.v1:a b");
    expect(draftUrns(weidler, rule({ collection: "urn:cite2:demo:w.v1:", kind: "label" }), bad)[0]).toMatchObject({ from: "hand", problem: "invalid" });
  });
  it("an image on several canvases gets one URN; a different hand edit is a conflict", () => {
    const twice = [hmt[2], { ...hmt[2], id: "canvases/1r-again", label: "again" }, hmt[3]];
    const r = rule({ collection: "urn:cite2:demo:va.v1:", kind: "number", prefix: "n" });
    expect(draftUrns(twice, r, noEdits()).map((d) => [d.urn?.split(":").pop(), d.problem])).toEqual([
      ["n001", null], ["n001", null], ["n003", null]]);
    const edits = noEdits(); edits.hand.set("canvases/1r-again", "urn:cite2:demo:va.v1:other");
    const d = draftUrns(twice, r, edits);
    expect(d.map((x) => x.problem)).toEqual([null, "conflict", null]);
    expect(parseUrnMap(urnMapText("m", "u", twice, d)).byImage.size).toBe(2); // one row per image, first canvas wins
  });

  it("hand edits win; existing map kept only when asked", () => {
    const existing = parseUrnMap(`image|urn\n${hmt[2].service!.id}|urn:cite2:hmt:vaimg.2017a:KEEP`);
    const edits = noEdits(); edits.hand.set(hmt[0].id, "urn:cite2:hmt:vaimg.2017a:front"); edits.hand.set(hmt[1].id, "");
    const r = rule({ collection: "urn:cite2:hmt:vaimg.2017a:", kind: "canvas" });
    expect(draftUrns(hmt, r, edits, existing, true).map((d) => [d.urn?.split(":").pop() ?? null, d.from])).toEqual([
      ["front", "hand"], [null, "hand"], ["KEEP", "map"], ["insidebackcover", "rule"]]);
    expect(draftUrns(hmt, r, edits, existing, false)[2]).toMatchObject({ urn: "urn:cite2:hmt:vaimg.2017a:1r", from: "rule" });
  });
  it("writes image|urn|label, one row per image, readable back as a map", () => {
    const r = rule({ collection: "urn:cite2:hmt:vaimg.2017a:", kind: "file" });
    const edits = noEdits(); edits.hand.set(hmt[3].id, "");
    const d = draftUrns(hmt, r, edits);
    const text = urnMapText("Venetus A manuscript", "https://x/venetusA.json", hmt, d);
    expect(text.split("\n").slice(0, 4)).toEqual([
      "// URN map for Venetus A manuscript", "// manifest: https://x/venetusA.json", "image|urn|label",
      "http://www.homermultitext.org/iipsrv?IIIF=/project/homer/pyramidal/deepzoom/hmt/vaimg/2017a/VAMSInside_front_cover_versoN_0500.tif|urn:cite2:hmt:vaimg.2017a:VAMSInside_front_cover_versoN_0500|Venetus A (Marciana 454 = 822), inside front cover",
    ]);
    expect(text.trim().split("\n")).toHaveLength(6); // 2 comments + header + 3 (last canvas has none)
    const back = parseUrnMap(text);
    expect(back.errors).toEqual([]);
    expect(hmt.map((c) => urnForCanvas(back, c))).toEqual(d.map((x) => x.urn));
  });
});
