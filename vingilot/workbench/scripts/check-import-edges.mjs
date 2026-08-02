import path from "node:path";
import { DESKTOP_SRC, walk } from "./import-graph.mjs";

// ADR-001 spike exit criterion 2: no edge into the upstream application shell.
const FORBIDDEN = [
  path.join(DESKTOP_SRC, "app"),
  path.join(DESKTOP_SRC, "features", "navigation"),
  path.join(DESKTOP_SRC, "main.tsx"),
];

export async function forbiddenEdges(entryFile) {
  const reached = await walk(entryFile);
  return [...reached]
    .filter((f) => FORBIDDEN.some((root) => f === root || f.startsWith(root + path.sep)))
    .sort();
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (invokedDirectly) {
  const entry = process.argv[2] ?? path.resolve(DESKTOP_SRC, "../../vingilot/workbench/src/SpikeHarness.tsx");
  const violations = await forbiddenEdges(entry);
  if (violations.length > 0) {
    console.error(`check-import-edges: ${violations.length} forbidden edge(s) from ${entry}:\n`);
    for (const v of violations) console.error("  " + path.relative(process.cwd(), v));
    console.error("\nADR-001 spike exit criterion 2 requires no edge into the upstream app shell.");
    process.exit(1);
  }
  console.log("check-import-edges: clean");
}
