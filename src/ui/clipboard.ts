// copyText and download copied from imageviewer/src/ui/app.ts.
import { el } from "./dom.ts";

/** Save text as a file (works from disk too). */
export function download(text: string, name: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Copy to the clipboard, with a fallback for browsers that refuse the Clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  const ta = el("textarea", { readonly: "", style: "position:fixed;opacity:0" });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { /* no clipboard */ }
  ta.remove();
  return ok;
}
