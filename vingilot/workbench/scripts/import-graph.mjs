import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DESKTOP_SRC = path.resolve(HERE, "../../../desktop/src");

const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g;
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;

async function resolveSpecifier(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = path.join(DESKTOP_SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // bare package specifier — outside our graph

  for (const candidate of [
    base,
    ...EXTENSIONS.map((e) => base + e),
    ...EXTENSIONS.map((e) => path.join(base, "index" + e)),
  ]) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // keep trying
    }
  }
  return null;
}

/** Transitively resolved local files reachable from `entryFile`. */
export async function walk(entryFile) {
  const seen = new Set();
  const queue = [path.resolve(entryFile)];

  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    let source;
    try {
      source = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }

    for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
      re.lastIndex = 0;
      let m = re.exec(source);
      while (m !== null) {
        const resolved = await resolveSpecifier(m[1], file);
        if (resolved !== null && !seen.has(resolved)) queue.push(resolved);
        m = re.exec(source);
      }
    }
  }
  return seen;
}
