# iiif-cite plan

Single self-contained HTML page: load a IIIF Presentation manifest, browse thumbnails,
open a canvas in a pan/zoom viewer, and select, save and cite regions of interest (RoIs)
the way imageviewer does for non-IIIF images.

## Decisions (Neel, 2026-10-20)

1. **Image URNs come from a separate CEX file** mapping canvases to CITE2 image URNs.
   Draft format (implemented in `src/lib/urn-map.ts`, to confirm):

   ```
   canvas|urn
   https://example.org/iiif/ms/canvas/1r|urn:cite2:hmt:vaimg.2017a:VA001RN_0002
   ```

   Headers case-insensitive; extra columns ignored; any `@region` on a URN is dropped.
2. **Custom viewer, not OpenSeadragon** (OSD is hard to keep from grabbing pointer events).
3. **`roi.ts` is shared** through a new small repo, `cite-roi` (sibling of this repo),
   that both iiif-cite and imageviewer depend on.

## Architecture

- `src/lib/` — pure logic, unit-tested; `src/ui/` — DOM; `src/main.ts` — entry.
- Build: Vite + TypeScript + Vitest; `build/inline-all.ts` (copied from imageviewer) inlines
  everything so `npm run build` gives one file, `dist/iiif-cite.html` (source page
  `src/iiif-cite.html`; dev server at `/iiif-cite.html`).
- `cite-roi` dependency: `github:neelsmith/cite-roi#v1.0.0` (lock file resolves over https).
  To pick up a new release: tag it in cite-roi, then `npm install github:neelsmith/cite-roi#vX.Y.Z`
  and check `package-lock.json` still says `git+https://` (npm may write `git+ssh://`).
- `lib/cex.ts` is a 38-line copy of imageviewer's reader (not worth a shared package yet).

### Coordinates

- A region is `{x,y,w,h}` as fractions (0–1) of the **image** (size from the Image API
  `info.json`), not of the canvas: canvas and image sizes can differ.
- Outputs per region: plain `x,y,w,h`; CITE2 URN `urn@x,y,w,h` (when the canvas has a URN);
  a IIIF Image API URL for just the region (pixel `x,y,w,h`, edges rounded to whole pixels —
  `lib/image-api.ts roiRegion`). IIIF `pct:` (0–100) is not used.

### Custom tiled viewer

Same view model as imageviewer's `ZoomViewer`: `view = {scale, x, y}` applied to the
full-resolution image, so `cite-roi`'s `screenToFrac`/`roiToScreen` and imageviewer's
`RoiLayer` work unchanged.

- `lib/tiles.ts` (pure): from `info.json` (`tiles[].width/height/scaleFactors`, `sizes`),
  choose the level for the current scale (largest scale factor ≤ 1/scale) and list the
  visible tiles with their Image API URLs and on-screen positions. Level-0 services without
  `tiles` fall back to the largest suitable entry in `sizes`.
- `ui/tile-viewer.ts`: a low-resolution full image underneath (e.g. 1024 px wide) so the
  view is never blank, plus absolutely positioned tile `<img>`s for the current level,
  re-laid out on every view change; tiles cached by URL.
- Pointer handling ported from imageviewer (wheel, pinch, drag, double-click), keeping its
  `claimPointer(e)` contract so the RoI layer can take the pointer (Shift-drag / Select mode).
- `lib/zoom.ts` ported unchanged (copied; could move to cite-roi). MAX_ZOOM is 4× full resolution.
- Tiles are requested with the manifest's service id, not info.json's `@id` (which can name
  an internal host); sizes as `w,` (Image API 2) or `w,h` (3); a single whole-image tile as `full`.
- Trust `info.json` over the manifest: its size (canvas sizes can be nominal) and its
  `profile` (the manifest's can understate it). Round `sizes` values — they can be fractional.

### Test manifests

- **HMT Venetus A** (primary), IIIF 3.0, 662 canvases, iipsrv Image API 2 (level 1):
  https://raw.githubusercontent.com/homermultitext/hmt-archive/refs/heads/master/iiif/venetusA.json
  Service is on the painting annotation (non-standard; parser handles it); canvas ids are
  relative; images are plain `http://` (blocked as mixed content if iiif-cite is served over
  https). `src/test/fixtures/hmt-venetusA-urns.cex` maps all 662 canvases to vaimg.2017a URNs.

- SUB Göttingen, IIIF 2.x, 86 canvases, Image API 2 (level 2 per info.json, 512-px tiles):
  https://manifests.sub.uni-goettingen.de/iiif/presentation/PPN623133725/manifest
  Canvases are a nominal 300×400; images are ~1408×1672. Excerpt in `src/test/fixtures/`.

## Phases

0. **Scaffold** — done 2026-10-20: `cite-roi` repo; `src/` with build, manifest reading
   (Presentation 2.x and 3.0), Image API URLs, RoI → region URLs, canvas→URN map; 18 tests.
1. **Manifest browsing** — done 2026-10-20: manifest URL input and `#manifest=`; thumbnail
   grid (Image API 300 px → manifest thumbnail → full image fallback); URN map from `#urns=<url>`
   or a local file (not in the link); dot on canvases without a URN; notices for manifest and
   URN-map problems; clicking a tile sets `#canvas=` and calls `onOpen` (viewer: phase 2).
2. **Tiled viewer** — done 2026-10-20: `lib/tiles.ts` (info.json, level choice, visible tiles,
   base image), `lib/zoom.ts` (copied), `ui/tile-viewer.ts` (imageviewer's pointer handling,
   tiles instead of one <img>; 1-screen-px tile overlap hides seams), `ui/canvas-view.ts`
   (full-window view, info panel with URN/canvas/size/info.json, ‹ › and ←/→ replace the link,
   Esc/× close — Back if opened from the grid). Static images (no service) shown whole.
   Checked in headless Chromium against a synthetic IIIF 2 server: alignment at fit and 400%,
   panning, no seams, no console errors.
3. **RoI selection** — done 2026-10-20: `ui/roi-layer.ts` (imageviewer's, only imports changed),
   Shift-drag or Select mode; move/resize/Delete; Esc leaves select mode before closing.
   Selections panel per region: x,y,w,h and CITE2 URN, each with Copy, and a "View this
   region" link (IIIF image of the region, ≤1200 px; its URL is not offered for copying —
   Neel: keep IIIF detail out of the way); Download (this canvas), Copy all, Clear all.
   Kept per manifest+canvas while the page is open (no browser storage); open canvas's
   regions in the link as `roi=`; yellow count badge on thumbnails; "Export selections" in
   the bar downloads all as a plain list, one CITE2 URN per line, canvases without a URN as
   `// <canvas id>@x,y,w,h` comments — same as imageviewer (`lib/selections.ts`).
   Neel, 2026-10-20: keep exports plain; part of the app's value is hiding IIIF complexity.
   Checked in headless Chromium: a drag from (1000,1000) to (2000,1500) on a 4000×3000 image
   gives `0.2500,0.3333,0.2500,0.1667` and region `1000,1000,1000,500`; box stays put when
   zoomed; the region URL returns exactly that area.
4. **imageviewer uses cite-roi** — done 2026-10-20: imageviewer's `lib/roi.ts` and its tests
   removed; it imports `cite-roi` v1.0.0. 123 tests pass; its five built pages are
   byte-identical to before. (Logged in imageviewer's notes, session 29.)
5. **Check against real servers** — HMT Venetus A and SUB Göttingen: work (Neel, 2026-10-20,
   on the Mac). GitHub Pages (https): `info.json` was blocked as mixed content — fixed
   2026-10-21 by upgrading http→https on https pages; to re-check on Pages.
   Originally: — e.g. HMT and a large library, in headless Chromium:
   v2 and v3 manifests, level 0/1/2 services, CORS when opened from `file://`.

## Phase 6 — mapping images to URNs (done 2026-10-21)

Neel's decisions: map from the **image service id** (not the canvas id); create maps in the app
with a **rule plus hand edits**; `.` allowed in object ids; the file holds only the mapping (no
collection metadata); the label rule is a generic clean-up.

### Map file (`lib/urn-map.ts`)

```
// URN map for <manifest label>
// manifest: <manifest URL>
image|urn|label
http://www.homermultitext.org/iipsrv?IIIF=/…/VA001RN_0002.tif|urn:cite2:hmt:vaimg.2017a:VA001RN_0002|Venetus A (Marciana 454 = 822), folio 1, recto
```

- `image` = Image API service id (for a canvas without a service, its image URL). Matched
  ignoring http/https, a trailing slash and `/info.json` (`imageKey`), so one map works on
  http and https pages and for any manifest using the same images. One row per image.
- `label` is for people; ignored when reading. Older `canvas|urn` maps still read; a canvas
  row wins over an image row. Only canvas rows are checked against the manifest.

### "Map URNs" mode (`lib/urn-rules.ts`, `ui/urn-mapper.ts`, grid in `ui/app.ts`)

- Button "Map URNs" by the manifest title opens a panel over the grid: collection URN
  (`urn:cite2:ns:coll[.version]:`, checked), object ids from: image file name (extension
  dropped) · end of canvas id · canvas label · numbers in order (prefix, start, digits) ·
  pattern (regex on the image id; first group). Generic clean-up keeps A–Z a–z 0–9 . _ -.
- Each thumbnail shows its draft object id; click to edit: the URN, "number from here"
  (numbering rule), ✓ / Rule (back to the rule) / ✕; Enter/Esc.
- Status: canvases · with URNs · without · duplicates (same URN, different images) · invalid ·
  conflicting (an image repeated on a later canvas but given a different URN; the first wins).
  An image repeated on several canvases gets its first canvas's URN from the rule.
- With a URN map loaded: the collection is guessed from it, and "Keep URNs already in the
  loaded map" (on by default) keeps them; hand edits always win.
- Download `<manifest>-urns.cex` → also becomes the active URN map (like a local file).
  Not saved in the browser; Done / loading another manifest / leaving the page ask first if
  the map changed since the last download.

## Phase 7 — links by URN (done 2026-10-21)

- `?manifest=<url>&urns=<URN map url>&urn=<CITE2 URN>[@x,y,w,h]` (or the same in `#…`) opens the
  canvas whose image has that URN in the map, with the region added to its selections. A URN
  without a collection version matches any version (Neel). `lib/urn-link.ts`.
- On arrival a query is moved into the hash; once resolved, `urn=` becomes `canvas=`/`roi=`.
  Problems (not CITE2, bad region, no URN map, URN not in the map) are notices.
- "Copy link" in the canvas view (the image, and each region) copies a link by URN when the
  canvas has one and the URN map was loaded from a URL; otherwise by canvas id (+ roi=).
  Readable: `:` `/` `@` `,` `;` left unencoded.



- URN map: is `canvas|urn` right, or key on the Image API service id instead / as well?
- Should one URN map cover several manifests (add a `manifest` column)?
- Export also as W3C/IIIF annotations (an AnnotationPage per canvas)?
- (Resolved 2026-10-21) HMT over https: yes. On an https page iiif-cite now requests every http
  URL over https (`lib/https.ts`); a server with no https gets an explanatory error.
