import type { Plugin } from "vite";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Stop inlined code from closing its own <script>/<style> tag early.
const safeScript = (code: string) => code.replace(/<\/(script)/gi, "<\\/$1");
const safeStyle = (css: string) => css.replace(/<\/(style)/gi, "<\\/$1");

/**
 * Inline every JS chunk and CSS asset into the HTML so the build is a single,
 * self-contained HTML page that works from file:// or any static server.
 * (Replaces vite-plugin-singlefile, whose dependency chain carries an unpatched
 * advisory in `braces`.)
 */
export function inlineAll(): Plugin {
  return {
    name: "iiif-cite:inline-all",
    enforce: "post",
    config: () => ({
      base: "./",
      build: {
        assetsInlineLimit: Number.MAX_SAFE_INTEGER, // images/fonts become data: URLs
        cssCodeSplit: false,
        modulePreload: { polyfill: false },
      },
    }),
    generateBundle(_options, bundle) {
      const htmlFiles = Object.values(bundle).filter(
        (f) => f.type === "asset" && f.fileName.endsWith(".html"),
      );
      for (const html of htmlFiles) {
        if (html.type !== "asset") continue;
        let page = String(html.source);
        for (const [name, file] of Object.entries(bundle)) {
          if (file.type === "chunk" && name.endsWith(".js")) {
            const tag = new RegExp(`<script\\b[^>]*\\bsrc="[^"]*${escapeRe(name)}"[^>]*></script>`);
            if (!tag.test(page)) continue;
            page = page.replace(tag, () => `<script type="module">${safeScript(file.code)}</script>`);
            delete bundle[name];
          } else if (file.type === "asset" && name.endsWith(".css")) {
            const tag = new RegExp(`<link\\b[^>]*\\bhref="[^"]*${escapeRe(name)}"[^>]*>`);
            if (!tag.test(page)) continue;
            page = page.replace(tag, () => `<style>${safeStyle(String(file.source))}</style>`);
            delete bundle[name];
          }
        }
        html.source = page;
      }
    },
  };
}
