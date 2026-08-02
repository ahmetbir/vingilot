import path from "node:path";
import { DESKTOP_SRC, walk } from "./import-graph.mjs";

// The adapter promise made mechanical: the workbench reaches no path under
// desktop/src, full stop. This replaces the spike's narrower app-shell-only
// forbidden set (ADR-001 exit criterion 2) now that the spike is retired.
const FORBIDDEN = [DESKTOP_SRC];

export async function forbiddenEdges(entryFile) {
  const reached = await walk(entryFile);
  return [...reached]
    .filter((f) => FORBIDDEN.some((root) => f === root || f.startsWith(root + path.sep)))
    .sort();
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (invokedDirectly) {
  const entry = process.argv[2] ?? path.resolve(DESKTOP_SRC, "../../vingilot/workbench/src/App.tsx");
  const violations = await forbiddenEdges(entry);
  if (violations.length > 0) {
    console.error(`check-import-edges: ${violations.length} forbidden edge(s) from ${entry}:\n`);
    for (const v of violations) console.error("  " + path.relative(process.cwd(), v));
    console.error("\nThe workbench must reach no path under desktop/src.");
    process.exit(1);
  }
  console.log("check-import-edges: clean");
}
