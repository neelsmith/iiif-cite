# Development notes

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
