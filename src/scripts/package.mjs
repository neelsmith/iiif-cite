#!/usr/bin/env node
// Package iiif-cite as a project page: copy the built dist/iiif-cite.html, put a project
// configuration (title + collections) into its config block, and set the page title.
//
//   npm run build
//   npm run package -- projects/complutensian.json            → dist/complutensian.html
//   npm run package -- projects/complutensian.json -o out.html
//
// The result is still one self-contained HTML file. The config is readable JSON inside it
// (<script type="application/json" id="iiif-cite-config">) and can also be edited by hand.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONFIG_ELEMENT_ID, validateConfig } from "../lib/project-config.mjs";

const BLOCK = new RegExp(`(<script type="application/json" id="${CONFIG_ELEMENT_ID}">)([\\s\\S]*?)(</script>)`);

/** Escape for a page <title>. @param {string} s */
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Put `config` (as given, after checking) into a built iiif-cite page.
 * @param {string} html  the built iiif-cite.html
 * @param {unknown} config  decoded project JSON
 * @returns {string}
 */
export function packageHtml(html, config) {
  const { errors } = validateConfig(config);
  if (errors.length) throw new Error(`Invalid project configuration:\n  - ${errors.join("\n  - ")}`);
  if (!BLOCK.test(html)) throw new Error(`No <script id="${CONFIG_ELEMENT_ID}"> block in the page: is it a built iiif-cite.html?`);
  // "</" would end the script element early.
  const json = JSON.stringify(config, null, 2).replace(/<\//g, "<\\/");
  const title = escapeHtml(/** @type {{ title: string }} */ (config).title.trim());
  return html
    .replace(BLOCK, (_, open, _old, close) => `${open}\n${json}\n${close}`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);
}

/** @param {string[]} argv */
function main(argv) {
  const args = [...argv];
  let out = null;
  const o = args.findIndex((a) => a === "-o" || a === "--out");
  if (o >= 0) { out = args[o + 1]; args.splice(o, 2); }
  const [configPath] = args;
  if (!configPath || args.length > 1) {
    console.error("usage: npm run package -- <project.json> [-o <output.html>]");
    process.exit(2);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const built = join(here, "..", "dist", "iiif-cite.html");
  let html;
  try { html = readFileSync(built, "utf8"); } catch {
    console.error(`Can't read ${built}: run "npm run build" first.`);
    process.exit(1);
  }
  let config;
  try { config = JSON.parse(readFileSync(configPath, "utf8")); } catch (e) {
    console.error(`Can't read ${configPath}: ${/** @type {Error} */ (e).message}`);
    process.exit(1);
  }
  try {
    const page = packageHtml(html, config);
    const target = resolve(out ?? join(here, "..", "dist", `${basename(configPath).replace(/\.json$/i, "")}.html`));
    writeFileSync(target, page);
    console.log(`${target} (${Math.round(page.length / 1024)} kB): "${config.title}", ${config.collections.length} collection(s)`);
  } catch (e) {
    console.error(/** @type {Error} */ (e).message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2));
