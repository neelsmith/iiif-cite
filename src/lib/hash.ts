// Copied from imageviewer/src/lib/hash.ts.
/** Read/write `#key=value&key2=value2` state without clobbering other keys. */
export function readHash(hash: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(hash.replace(/^#/, "")));
}

export function withHash(hash: string, changes: Record<string, string | null>): string {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  for (const [k, v] of Object.entries(changes)) (v === null ? q.delete(k) : q.set(k, v));
  const s = q.toString();
  return s ? `#${s}` : "";
}
