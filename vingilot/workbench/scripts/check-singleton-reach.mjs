import fs from "node:fs/promises";
import path from "node:path";
import { DESKTOP_SRC, walk } from "./import-graph.mjs";

const INIT = path.join(DESKTOP_SRC, "features", "communities", "useCommunityInit.ts");

/** Reset-function names imported by useCommunityInit, mapped to their module. */
async function resetRegistry() {
  const source = await fs.readFile(INIT, "utf8");
  const registry = new Map();
  const re = /import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
  let m = re.exec(source);
  while (m !== null) {
    const names = m[1]
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
      .filter((n) => /^(reset|clear)/.test(n));
    if (names.length > 0 && m[2].startsWith("@/")) {
      registry.set(path.join(DESKTOP_SRC, m[2].slice(2)), names);
    }
    m = re.exec(source);
  }
  return registry;
}

export async function reachableSingletons(entryFile) {
  const [reached, registry] = await Promise.all([walk(entryFile), resetRegistry()]);
  const hits = [];
  for (const [moduleBase, names] of registry) {
    for (const file of reached) {
      const stem = file.replace(/\.[^./]+$/, "");
      if (stem === moduleBase || stem === path.join(moduleBase, "index")) {
        hits.push(...names.map((n) => `${n}  (${path.relative(DESKTOP_SRC, file)})`));
        break;
      }
    }
  }
  return hits.sort();
}
