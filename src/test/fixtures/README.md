# Test fixtures

- `manifest-v2.json`, `manifest-v3.json`: hand-written to the Presentation 2.1 / 3.0 specs.
- `goettingen-PPN623133725-excerpt.json`: excerpt of a real manifest,
  https://manifests.sub.uni-goettingen.de/iiif/presentation/PPN623133725/manifest
  (read 2026-10-20). The real one has 86 canvases; kept are 1, 2, 25 and 85, with the
  structure and values the server returns (canvas 1 verbatim; the others follow the same pattern).
  Notable: every canvas is a nominal 300×400 while the images are e.g. 1408×1672;
  canvases 1–24 are labeled " - "; services say level1, info.json says level2.
- `goettingen-00000001-info.json`: verbatim info.json for canvas 1's image
  (note fractional `sizes`, e.g. 104.5).
- `hmt-venetusA-excerpt.json`: the first two canvases, the first with a non-standard size, and the
  last of HMT's Venetus A manifest (Presentation 3.0, 662 canvases), verbatim,
  https://raw.githubusercontent.com/homermultitext/hmt-archive/refs/heads/master/iiif/venetusA.json
  (read 2026-10-20). Notable: the Image API service is on the painting *annotation*, not the image
  body; canvas ids are relative (`canvases/1r`); services are iipsrv `?IIIF=` URLs over plain http.
- `hmt-venetusA-urns.cex`: canvas → URN map for all 662 canvases of that manifest, generated from
  the image service paths.
