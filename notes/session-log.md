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

## Session 2 — 2026-10-21

- Build output renamed `dist/index.html` → `dist/iiif-cite.html` (Neel; the Quarto site links
  `./iiif-cite.html`): `git mv src/index.html src/iiif-cite.html`, `rollupOptions.input` in
  vite.config.ts. Dev server page is now `/iiif-cite.html` (nothing at "/").
- On GitHub Pages (https) thumbnails showed but every canvas failed: fetching HMT's http
  `info.json` from an https page is blocked (images are silently upgraded, fetches are not).
  HMT's iipsrv answers on https (info.json's own @id is https). New `lib/https.ts`: on an https
  page, manifest/URN-map/info.json fetches and all manifest image URLs (services, images,
  thumbnails → tiles, base, region links) use https; if an upgraded server doesn't answer,
  `HttpsUpgradeError` explains (open from a file or http instead). http/file pages unchanged.
  `AppOptions.https` overrides the protocol check (tests). 73 tests pass; build 41 kB.
  CORS on HMT's https endpoint not verifiable from here — Neel to confirm on Pages.
- Neel confirmed the https fix works on GitHub Pages.
- Phase 6 designed (plan.md "Phase 6 — mapping images to URNs"): key = image service id;
  in-app "Map URNs" mode, rule + hand edits, downloads image|urn|label .cex. Not built yet.
- Neel: `.` OK in object ids; map file holds only the mapping; label rule = generic clean-up.
- Phase 6 built: URN maps keyed by image service id (`image|urn|label`; `canvas|urn` still read;
  `urnForCanvas` now takes the canvas), `lib/urn-rules.ts` (rules, drafts, problems, map text),
  `ui/urn-mapper.ts` + Map URNs mode in the grid (grid items are now `.cell` = tile + URN line).
  HMT check: the image-file-name rule reproduces the 662-canvas map generated earlier (excerpt).
  Browser check (synthetic server) found that an image repeated on two canvases got two URNs
  and the second was silently dropped from the file → now one URN per image, conflicts flagged.
  90 tests pass; build 53 kB. Not committed.
- Phase 7 built: links by URN (`lib/urn-link.ts`; `urn=` resolved in `ui/app.ts`; ?query → #hash;
  "Copy link" buttons in `ui/canvas-view.ts`). Version-less URNs match any version (Neel).
  100 tests pass (a copied region link reopens the same canvas and region); build 56 kB.
  Not checked in a real browser this time (jsdom only). Not committed.
- Found: a link carried only one urn= (repeats: last won; urn= + roi=: roi dropped). Neel chose
  repeated urn= only (no roi= with URNs). Built: repeated urn=, "Copy link to all", side-panel
  note for links citing several images. 104 tests pass; build 57 kB. Not committed.
- Phase 8 built: packaged project pages (`lib/project-config.mjs`, `scripts/package.mjs`,
  `npm run package`, collection menu in `ui/app.ts`, `main.ts` reads the config block,
  `projects/example.json`; tsconfig `allowJs`/`checkJs` for the .mjs files). 116 tests pass;
  build 60 kB. Browser check (synthetic server): packaged page shows title + menu, no inputs,
  switching collections works, missing manifest gives a notice. Not committed.
