import { describe, it, expect } from "vitest";
import { inlineAll } from "../build/inline-all";

/** Run the plugin's generateBundle on a fake Rollup bundle. */
function run(html: string, files: Record<string, { type: "asset" | "chunk"; source?: string | Uint8Array; code?: string }>) {
  const bundle: Record<string, any> = { "iiif-cite.html": { type: "asset", fileName: "iiif-cite.html", source: html } };
  for (const [name, f] of Object.entries(files)) bundle[name] = { fileName: name, ...f };
  const plugin = inlineAll() as any;
  plugin.generateBundle.call({}, {}, bundle);
  return { page: String(bundle["iiif-cite.html"].source), left: Object.keys(bundle) };
}

describe("single-file build (inline-all)", () => {
  it("inlines the app icons as data: URLs and drops the separate files", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { page, left } = run(
      `<head><link rel="icon" type="image/svg+xml" href="./assets/favicon-ab12.svg">` +
      `<link rel="apple-touch-icon" href="./assets/apple-touch-icon-cd34.png"></head>` +
      `<body><script type="module" crossorigin src="./assets/main-ef56.js"></script></body>`,
      {
        "assets/favicon-ab12.svg": { type: "asset", source: "<svg/>" },
        "assets/apple-touch-icon-cd34.png": { type: "asset", source: png },
        "assets/main-ef56.js": { type: "chunk", code: "console.log(1)" },
        "assets/unused.png": { type: "asset", source: png },
      });
    expect(page).toContain(`href="data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}"`);
    expect(page).toContain(`href="data:image/png;base64,${Buffer.from(png).toString("base64")}"`);
    expect(page).toContain(`<script type="module">console.log(1)</script>`);
    expect(left.sort()).toEqual(["assets/unused.png", "iiif-cite.html"]); // only what the page doesn't use stays
  });
});
