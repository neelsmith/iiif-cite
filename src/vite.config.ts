import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { inlineAll } from "./build/inline-all.ts";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// One self-contained page: `vite build` → dist/iiif-cite.html (works from file:// or any static server).
// Dev server: http://localhost:5173/iiif-cite.html (there is no page at "/").
export default defineConfig(({ command }) => ({
  plugins: [inlineAll()],
  define: {
    __APP_VERSION__: JSON.stringify(command === "serve" ? `${version}-dev` : version),
  },
  build: { outDir: "dist", emptyOutDir: true, rollupOptions: { input: "iiif-cite.html" } },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
}));
