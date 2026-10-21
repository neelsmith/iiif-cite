import "./ui/styles.css";
import { startApp } from "./ui/app.ts";

startApp({
  root: document.querySelector<HTMLElement>("#app")!,
  version: __APP_VERSION__,
  // Phase 2 opens the canvas in the tiled viewer here.
});
