# Development notes

**Never commit or push.** Neel commits himself (2026-10-23): leave changes in the working tree.

## node_modules belongs to the Mac

`src/node_modules` must be installed on Neel's Mac: Vite 8's bundler (rolldown) and
lightningcss ship native per-platform binaries. Claude's shell is Linux, so Claude never runs
`npm install`/`npm ci` in the repo. Claude tests in a scratch copy instead:

```sh
rsync -a --delete --exclude node_modules --exclude dist \
  ~/mnt/projects-cowork-repos/iiif-cite/src/ ~/work/iiif-cite/
cd ~/work/iiif-cite && npm ci && npm test && npm run typecheck && npm run build
```

When a dependency changes, run npm in the scratch copy, copy `package.json` and
`package-lock.json` back to the repo, and tell Neel to run `npm ci` on the Mac.
If the Mac install is ever broken by a Linux install: `rm -rf node_modules && npm ci`
(or, from Linux, `npm ci --os=darwin --cpu=arm64`). The same applies to `../cite-roi`.

## Packaging a project page

```sh
cd src
npm run build                                       # dist/iiif-cite.html (generic)
npm run package -- ../projects/pliny.json           # dist/pliny.html
npm run package -- ~/myproject.json -o ~/site/myproject.html
```

A project file (the repository's own are in `projects/`; `npm test` checks that each is valid):

```json
{
  "title": "Mixing citable image sources",
  "collections": [
    { "label": "Leiden, Lipsius 7",
      "catalog": "https://shot.holycross.edu/images/mss/lipsius7/lips7.cex", "thumbnails": true },
    { "label": "Complutensian Bible, vol. 1 (BNE)",
      "manifest": "https://…/complutensian-bne-v1-manifest.json",
      "urns": "https://…/complutensian-bne-vol1-urns.cex" }
  ],
  "default": "Leiden, Lipsius 7"
}
```

Each collection is either an image catalog (`catalog`, optional `thumbnails`, default false) or a
IIIF manifest (`manifest`, optional `urns`); giving both, or a setting of the other kind, is an
error. `default` (a label or 0-based index) is optional: the first collection. The packaged page is
the generic app with this JSON in its `iiif-cite-config` block, so it can also be edited by hand in
the HTML. `scripts/package.mjs` is plain Node (no TypeScript), so it runs on any Node ≥ 18.

## Serving image catalogs (CORS)

An iiif-cite page on another site (e.g. GitHub Pages) can only read a catalog `.cex` if the
catalog's server sends `Access-Control-Allow-Origin` (images need no header: they are `<img>`s).
Checked: `curl -sI -H "Origin: https://neelsmith.github.io" <catalog URL> | grep -i access-control`.

shot.holycross.edu (nginx behind an AWS load balancer; only `/etc/nginx/conf.d-managed/` is
editable, included at `http` level) — working since 2026-10-24, in `conf.d-managed/cors.conf`:

```nginx
map $uri $catalog_cors {
    ~\.(cex|txt|csv|tsv)$  "*";
    default                "";
}
add_header Access-Control-Allow-Origin $catalog_cors always;
```

No `server { }` around it (a server block in an http-level include is a separate, empty site).
An http-level `add_header` is inherited only by server/location blocks with no `add_header` of
their own; nginx omits a header whose value is empty, so only catalog files get it.

