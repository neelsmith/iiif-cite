import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { inlineAll } from "./build/inline-all.ts";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// One self-contained page: `vite build` → dist/index.html (works from file:// or any static server).
export default defineConfig(({ command }) => ({
  plugins: [inlineAll()],
  define: {
    __APP_VERSION__: JSON.stringify(command === "serve" ? `${version}-dev` : version),
  },
  build: { outDir: "dist", emptyOutDir: true },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
}));
