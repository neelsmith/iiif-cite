# Session log

## Session 1 — 2026-10-20

- Reviewed CLAUDE.md (its heading still says `imageviewer` web app — left for Neel) and how
  imageviewer implements RoIs (`lib/roi.ts`, `ui/roi-layer.ts`, `ui/zoom-viewer.ts`, `ui/app.ts`).
- Decisions: URNs from a separate CEX file; custom viewer (no OpenSeadragon); share `roi.ts`
  through a new `cite-roi` repo. See `plan.md`.
- Created `../cite-roi` (roi.ts + its tests copied from imageviewer 2.0.1; 6 tests pass).
  Neel pushed it to https://github.com/neelsmith/cite-roi and tagged v1.0.0; iiif-cite now
  depends on `github:neelsmith/cite-roi#v1.0.0` (lock entry changed from git+ssh to git+https).
- Scaffolded `src/`: Vite/TS/Vitest, `build/inline-all.ts`, `lib/manifest.ts`,
  `lib/image-api.ts`, `lib/urn-map.ts`, `lib/cex.ts` (copy), placeholder `main.ts` that lists
  a manifest's canvases. 18 tests pass; typecheck clean; `npm run build` → `dist/index.html`.
- Fixtures are hand-written v2/v3 manifests (no network from the build machine this session);
  test against real manifests in phase 5.
- Added Neel's test manifest (SUB Göttingen PPN623133725) as an excerpt fixture plus its first
  info.json, with tests: canvas 300×400 vs image 1408×1672, so regions must use info.json size.
  Labels are now trimmed (" - " → "-"). 21 tests pass. The build machine can't reach the server;
  fixture read via web fetch.
- Phase 1 done: `lib/load.ts`, `lib/canvases.ts`, `lib/hash.ts` (copy), `ui/app.ts`, `ui/dom.ts`,
  `ui/styles.css` (palette from imageviewer); jsdom tests of the main flows.
- Neel's HMT Venetus A manifest (raw.githubusercontent.com is reachable from the build machine):
  its image service sits on the painting annotation, so the parser now falls back to that.
  Full manifest parses: 662 canvases, all with services, no errors. Added excerpt fixture and a
  generated canvas→URN map for all 662 canvases. 38 tests pass; build 12 kB.
- Neel's Mac build failed: node_modules had been installed from Claude's Linux shell (missing
  @rolldown/binding-darwin-arm64). Reinstalled with `npm ci --os=darwin --cpu=arm64` in
  iiif-cite/src and cite-roi; lock files unchanged; Mac build now succeeds. Claude tests in a
  scratch copy from now on — see `development.md`.
- Phase 2 done (see plan.md). Added `App.stop()` so tests (or a second app) don't leave
  hashchange/keydown listeners behind. 60 tests pass; build 28 kB. Visual check in headless
  Chromium (cloud) with a synthetic IIIF server, since neither HMT nor Göttingen is reachable;
  found and fixed hairline seams between tiles.
- Phase 3 done (see plan.md). 68 tests pass; build 40 kB.
- Export changed from a CEX table to imageviewer's plain URN list (Neel's choice); the panel's
  per-canvas Download is a URN list too, offered only when the canvas has a URN.
- Panel: kept the "View this region" link, dropped the copyable IIIF URL.
- Phase 4 done: imageviewer now imports cite-roi (see imageviewer/notes/session-log.md, session 29).
- Neel tested with the HMT Venetus A and SUB Göttingen manifests on his Mac: both work.
  Committed and pushed as "Initial working version" (d5e21e4).
- Open: https hosting (HMT images are http); plan.md "Open questions".
