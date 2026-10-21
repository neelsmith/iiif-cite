import "./ui/styles.css";
import { startApp } from "./ui/app.ts";
import { CONFIG_ELEMENT_ID, readConfigText } from "./lib/project-config.mjs";

// A packaged project page carries its configuration in a JSON block (scripts/package.mjs).
const { config, errors } = readConfigText(document.getElementById(CONFIG_ELEMENT_ID)?.textContent);

startApp({
  root: document.querySelector<HTMLElement>("#app")!,
  version: __APP_VERSION__,
  config,
  configErrors: errors,
});
