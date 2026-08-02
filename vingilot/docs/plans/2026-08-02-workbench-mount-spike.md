# Workbench Mount Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Determine, with mechanical evidence rather than opinion, whether the Vingilot Workbench can mount upstream Buzz chat components in place — satisfying ADR-001's three spike exit criteria — or whether the documented fallback (a narrow chat adapter) must be taken instead.

**Architecture:** A minimal Vite + React application at `vingilot/workbench/`, added to the existing pnpm workspace, aliasing `@` to `desktop/src` so upstream slices resolve exactly as they do inside the desktop app. No Tauri shell, no relay, no coordinator — those answer different questions and would hide this one. Two static-analysis guards turn the ADR's prose exit criteria into failing-then-passing tests.

**Tech Stack:** Vite 6, React 19, TypeScript, pnpm workspaces, Node's built-in test runner (`node --test`, matching `desktop/package.json`'s existing `test` script), Biome for lint/format.

## Global Constraints

- **All fork-owned code lives under `vingilot/`.** ADR-001 decision 5.
- **Any change to a path outside `vingilot/` must be declared in `vingilot/seams.yaml`.** Enforced by `vingilot/scripts/check-seams.sh`, which must exit 0 at the end of every task. ADR-001 decision 6.
- **Never move, restyle, or edit upstream files to make the spike work.** ADR-001 decision 7 forbids extraction; an upstream edit that makes the spike pass invalidates the spike. If a mount only succeeds by editing `desktop/src/**`, that is a spike *failure*, not a workaround.
- **Commit trailers:** `Signed-off-by:` first, then `Co-authored-by:`. ADR-004 decision 2.
- **Branch:** `vingilot/<slug>`. ADR-004 decision 3. This plan runs on `vingilot/workbench-mount-spike`.
- **Text sizes must be rem-based** in any UI written here — the app scales root font-size for zoom and px text freezes. Repo `CLAUDE.md` § Text sizing.
- **No dependency that `desktop/` does not already resolve, and every shared one pinned to the exact version desktop has installed** (from its `node_modules`, not its semver range). This repo's pnpm uses default isolated linking — devDependencies are NOT hoisted across sibling packages, so the workbench must declare its own toolchain. Pinning to desktop's exact resolved versions makes pnpm link the same content-addressed store entries, and Vite resolves symlinks to real paths, so there is exactly one React instance. A *different* React version here would make the spike meaningless. Verify with the realpath check in Task 1 Step 4.

## Baseline facts (verified 2026-08-02 at `8f101f9de`)

Do not re-derive these; they are the premises the tasks build on.

| Fact | Value |
|---|---|
| `pnpm-workspace.yaml` packages | `desktop`, `web`, `admin-web` — upstream-owned, last touched upstream at `9b0f74480` |
| Desktop path alias | `@/*` → `./src/*`, declared in both `desktop/tsconfig.json` and `desktop/vite.config.ts` |
| Target component | `desktop/src/features/messages/ui/MessageTimeline.tsx` |
| Its direct imports | 22 statements; **zero** reach `@/app/` |
| Composer component | `desktop/src/features/messages/ui/MessageComposer.tsx` |
| Community-scoped singletons requiring reset | 20 entries in `desktop/src/features/communities/useCommunityInit.ts` |
| Desktop test runner | `node --import ./test-loader.mjs --experimental-strip-types --test "src/**/*.test.mjs"` |

## ADR-001 exit criteria, mapped to tasks

| Criterion | Task |
|---|---|
| Message list and composer render and accept input in the new shell | 3, 5 |
| No import edge to `desktop/src/app/**` or the sidebar shell | 2 |
| Every reachable community-scoped singleton is unreachable or registered | 4 |

## File Structure

- `vingilot/workbench/package.json` — workspace member manifest. Scripts only; no new dependencies.
- `vingilot/workbench/vite.config.ts` — the `@` alias into `desktop/src`. This single file is what makes upstream slices resolvable, and it is the whole mechanism ADR-001 decision 7 describes.
- `vingilot/workbench/tsconfig.json` — mirrors the alias for typecheck.
- `vingilot/workbench/index.html` — Vite entry.
- `vingilot/workbench/src/main.tsx` — React root. Deliberately does *not* import any provider hierarchy.
- `vingilot/workbench/src/SpikeHarness.tsx` — the mount surface. One responsibility: render upstream components with fabricated props and nothing else.
- `vingilot/workbench/src/fixtures/timeline.ts` — fabricated `TimelineMessage[]` and the other props `MessageTimeline` requires. Separated because it will grow and because the harness must stay readable.
- `vingilot/workbench/scripts/import-graph.mjs` — shared transitive-import walker. Both guards need it; it exists once.
- `vingilot/workbench/scripts/check-import-edges.mjs` — guard for criterion 2.
- `vingilot/workbench/scripts/check-singleton-reach.mjs` — guard for criterion 3.
- `vingilot/workbench/src/*.test.mjs` — tests colocated with source, matching desktop convention.
- `vingilot/docs/spike-report.md` — the deliverable that actually matters. Written in Task 6.

---

### Task 1: Workspace member that builds

**Files:**
- Create: `vingilot/workbench/package.json`
- Create: `vingilot/workbench/vite.config.ts`
- Create: `vingilot/workbench/tsconfig.json`
- Create: `vingilot/workbench/index.html`
- Create: `vingilot/workbench/src/main.tsx`
- Modify: `pnpm-workspace.yaml` (**seam** — declare it in Step 5 before committing)
- Modify: `vingilot/seams.yaml`

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable workspace package named `@vingilot/workbench` whose Vite `resolve.alias` maps `@` to the absolute path of `desktop/src`. Later tasks rely on that alias resolving `@/features/...` and `@/shared/...` identically to the desktop app.

- [ ] **Step 1: Create the package manifest**

`vingilot/workbench/package.json`:

```json
{
  "name": "@vingilot/workbench",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "typecheck": "tsc --noEmit",
    "test": "node --test \"src/**/*.test.mjs\"",
    "check:import-edges": "node ./scripts/check-import-edges.mjs",
    "check:singleton-reach": "node ./scripts/check-singleton-reach.mjs"
  },
  "dependencies": {
    "react": "19.2.8",
    "react-dom": "19.2.8"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "6.0.3",
    "typescript": "6.0.3",
    "vite": "8.0.16"
  }
}
```

Every version above is **exact, no `^`/`~`**, and copied from what desktop actually has installed (read from `desktop/node_modules/<pkg>/package.json`, not from desktop's semver ranges). pnpm's isolated linking does not hoist devDependencies across sibling packages — a zero-dependency package gets no `node_modules` at all — so the workbench must declare its toolchain. Exact-matching versions resolve to the same pnpm store entries, which is what guarantees a single React instance (verified mechanically in Step 4). Declaring anything desktop does not resolve, or at a different version, is forbidden.

- [ ] **Step 2: Create the Vite config with the alias**

`vingilot/workbench/vite.config.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
// The whole mechanism of ADR-001 decision 7: upstream slices are imported in
// place, resolving exactly as they do inside the desktop app. Never copy or
// move the files this points at.
const desktopSrc = path.resolve(here, "../../desktop/src");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": desktopSrc,
    },
    // Belt-and-braces on top of exact version pinning: even if resolution ever
    // walks to two node_modules, collapse react to one copy. Two React
    // instances make every hook in a mounted upstream component throw.
    dedupe: ["react", "react-dom"],
  },
  server: { port: 5273 },
});
```

- [ ] **Step 3: Create tsconfig and entry files**

`vingilot/workbench/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["../../desktop/src/*"]
    }
  },
  "include": ["src", "vite.config.ts"]
}
```

`vingilot/workbench/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vingilot Workbench — mount spike</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`vingilot/workbench/src/main.tsx`:

```tsx
import * as React from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <React.StrictMode>
    <div>workbench spike</div>
  </React.StrictMode>,
);
```

- [ ] **Step 4: Add to the pnpm workspace and verify the build**

Add `"vingilot/workbench"` to the `packages` list in `pnpm-workspace.yaml`, keeping the existing three entries untouched.

Run:

```bash
cd ~/self-hosted/vingilot && . ./bin/activate-hermit
pnpm install
pnpm --filter @vingilot/workbench build
```

Expected: install succeeds, build emits `vingilot/workbench/dist/index.html`.

Then verify the single-React guarantee mechanically:

```bash
node -e "console.log('workbench react:', require('node:fs').realpathSync(require.resolve('react/package.json', {paths: ['vingilot/workbench']})))"
node -e "console.log('desktop   react:', require('node:fs').realpathSync(require.resolve('react/package.json', {paths: ['desktop']})))"
```

Expected: **both lines print the same real path** into the pnpm store. If they differ, the versions are not exactly matched — fix the pin, do not proceed; a spike run against two Reacts reports nothing.

Note: `pnpm install` rewrites `pnpm-lock.yaml` (a new importer entry). That is a second unavoidable upstream-file touch — declare it in `vingilot/seams.yaml` alongside `pnpm-workspace.yaml`, also `status: permanent`.

- [ ] **Step 5: Declare the seam**

`pnpm-workspace.yaml` is upstream-owned. Add an entry to `vingilot/seams.yaml` matching the existing schema:

```yaml
  - path: "pnpm-workspace.yaml"
    reason: "Registers vingilot/workbench as a workspace package. The Workbench is a sibling application (ADR-001 decision 3) and pnpm has no out-of-tree package mechanism, so the one-line addition to upstream's workspace list is unavoidable."
    owner: "vingilot/workbench"
    removable_when: "Never, while the Workbench ships from this monorepo."
    status: "permanent"
    added: "2026-08-02"
```

Note `status: permanent` — unlike the design-tooling entries, this one has no path to removal, and saying so is the point of the field.

- [ ] **Step 6: Verify the guard passes and commit**

Run:

```bash
cd ~/self-hosted/vingilot
./vingilot/scripts/check-seams.sh; echo "exit=$?"
```

Expected: `exit=0`. If it reports `pnpm-workspace.yaml` as undeclared, the seam entry's `path` does not match — check for a leading `./`.

```bash
git add vingilot/workbench vingilot/seams.yaml pnpm-workspace.yaml
git commit -m "$(cat <<'EOF'
feat(workbench): scaffold the mount-spike application

A minimal Vite + React package whose only distinguishing feature is the `@`
alias into desktop/src. That alias is the entire mechanism ADR-001 decision 7
describes: upstream slices are imported in place, never extracted.

No dependencies are declared. Everything resolves through the alias into
desktop/, so the spike exercises the same React and the same module graph the
desktop app does. Declaring our own would let it pass against a different
React, which would answer a question nobody asked.

pnpm-workspace.yaml is declared as a permanent seam — pnpm has no out-of-tree
package mechanism, so there is no version of this that avoids the one line.

Signed-off-by: Ahmet Yusuf Birinci <ayb84870@gmail.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Import-edge guard — ADR-001 exit criterion 2

**Files:**
- Create: `vingilot/workbench/scripts/import-graph.mjs`
- Create: `vingilot/workbench/scripts/check-import-edges.mjs`
- Create: `vingilot/workbench/src/importEdges.test.mjs`

**Interfaces:**
- Consumes: the `@` alias from Task 1.
- Produces: `import-graph.mjs` exports `walk(entryFile, { aliasRoot })` returning `Promise<Set<string>>` of absolute resolved file paths transitively reachable from `entryFile`. Task 4 imports this same function.

Criterion 2 is currently prose. This task makes it a test that can fail.

- [ ] **Step 1: Write the failing test**

`vingilot/workbench/src/importEdges.test.mjs`:

```js
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { forbiddenEdges } from "../scripts/check-import-edges.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("the harness reaches no upstream app shell module", async () => {
  const violations = await forbiddenEdges(path.join(here, "SpikeHarness.tsx"));
  assert.deepEqual(violations, []);
});

test("a deliberate app-shell import is detected", async () => {
  const violations = await forbiddenEdges(
    path.join(here, "fixtures", "__edgeProbe.tsx"),
  );
  assert.ok(
    violations.length > 0,
    "guard failed to detect a known-bad import — it would pass anything",
  );
});
```

The second test is the important one. A guard nobody has seen fail is not evidence.

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd ~/self-hosted/vingilot && . ./bin/activate-hermit
pnpm --filter @vingilot/workbench test
```

Expected: FAIL — `Cannot find module '../scripts/check-import-edges.mjs'`.

- [ ] **Step 3: Write the import-graph walker**

`vingilot/workbench/scripts/import-graph.mjs`:

```js
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
```

This is a regex walker, not a parser. That is a deliberate limit and it must be stated in the spike report: it will miss dynamic `import()` with a computed specifier. It over-approximates nothing and under-approximates rarely, which is the safe direction for a guard whose failure mode should be *false confidence*, not false alarms — so Task 6 records it as a known limitation rather than pretending it is exhaustive.

- [ ] **Step 4: Write the guard**

`vingilot/workbench/scripts/check-import-edges.mjs`:

```js
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
```

- [ ] **Step 5: Create the probe fixture and a placeholder harness**

`vingilot/workbench/src/fixtures/__edgeProbe.tsx` — exists only so the guard has something known-bad to catch:

```tsx
// Deliberately violates ADR-001 exit criterion 2. Never imported by real code.
// Its only job is to make the import-edge guard fail, so we know it can.
import "@/app/App";

export const probe = true;
```

`vingilot/workbench/src/SpikeHarness.tsx` — replaced with real content in Task 3:

```tsx
export function SpikeHarness() {
  return <div>harness</div>;
}
```

- [ ] **Step 6: Run the tests and verify both pass**

```bash
cd ~/self-hosted/vingilot && . ./bin/activate-hermit
pnpm --filter @vingilot/workbench test
```

Expected: both tests PASS. If the second test fails, the guard's `FORBIDDEN` roots do not match reality — print `await walk(probeFile)` and confirm `desktop/src/app/App.tsx` appears.

- [ ] **Step 7: Commit**

```bash
cd ~/self-hosted/vingilot
./vingilot/scripts/check-seams.sh; echo "exit=$?"   # expect 0
git add vingilot/workbench
git commit -m "$(cat <<'EOF'
test(workbench): make ADR-001 exit criterion 2 mechanically falsifiable

Criterion 2 says the Workbench must have no import edge into the upstream
application shell. That was prose. It is now a transitive import walker plus a
guard, with a deliberately-bad fixture proving the guard can fail — a guard
nobody has watched fail is not evidence.

The walker is regex-based, not a parser: it misses dynamic import() with a
computed specifier. Recorded here rather than papered over, and it goes in the
spike report as a stated limit on the conclusion.

Signed-off-by: Ahmet Yusuf Birinci <ayb84870@gmail.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Mount MessageTimeline

**Files:**
- Create: `vingilot/workbench/src/fixtures/timeline.ts`
- Modify: `vingilot/workbench/src/SpikeHarness.tsx`
- Modify: `vingilot/workbench/src/main.tsx`
- Create: `vingilot/workbench/src/mount.test.mjs`

**Interfaces:**
- Consumes: `walk` (Task 2), the `@` alias (Task 1).
- Produces: `fixtures/timeline.ts` exports `timelineFixture` — the complete prop object `MessageTimeline` requires. Task 5 extends the same file for the composer.

- [ ] **Step 1: Read the component's actual prop type before writing fixtures**

```bash
cd ~/self-hosted/vingilot
sed -n '/^(export )?(type|interface) MessageTimelineProps/,/^}/p' \
  desktop/src/features/messages/ui/MessageTimeline.tsx
```

Write the fixture against what this prints. Do not guess field names — a fixture that typechecks against an imagined prop type proves nothing, and `pnpm typecheck` in Step 4 is what catches the difference.

- [ ] **Step 2: Write the failing test**

`vingilot/workbench/src/mount.test.mjs`:

```js
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { walk } from "../scripts/import-graph.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("the harness reaches the upstream message timeline", async () => {
  const reached = await walk(path.join(here, "SpikeHarness.tsx"));
  const hit = [...reached].some((f) =>
    f.endsWith(path.join("features", "messages", "ui", "MessageTimeline.tsx")),
  );
  assert.ok(hit, "harness does not import MessageTimeline — nothing is being spiked");
});
```

- [ ] **Step 3: Run it to confirm it fails**

```bash
pnpm --filter @vingilot/workbench test
```

Expected: FAIL — `harness does not import MessageTimeline`.

- [ ] **Step 4: Write the fixture and mount the component**

`vingilot/workbench/src/SpikeHarness.tsx`:

```tsx
import { MessageTimeline } from "@/features/messages/ui/MessageTimeline";
import { timelineFixture } from "./fixtures/timeline";

// One responsibility: render an upstream slice against fabricated props and
// nothing else. No providers are added here on purpose — if the component
// needs one, we want that to surface as a runtime error we can report, not as
// something we quietly supplied.
export function SpikeHarness() {
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <MessageTimeline {...timelineFixture} />
    </div>
  );
}
```

Update `main.tsx` to render `<SpikeHarness />` instead of the placeholder div.

Populate `fixtures/timeline.ts` from the prop type read in Step 1, with at least three messages so list rendering is actually exercised.

- [ ] **Step 5: Typecheck, then run the app and look at it**

```bash
cd ~/self-hosted/vingilot && . ./bin/activate-hermit
pnpm --filter @vingilot/workbench typecheck
pnpm --filter @vingilot/workbench test
pnpm --filter @vingilot/workbench dev
```

Open `http://localhost:5273`. Expected: three message rows render.

**This step is where the spike gets its answer, so record what actually happens rather than only whether it worked.** Likely outcomes, all of them informative:
- Renders cleanly → criterion 1 met for the timeline.
- Throws for a missing React context → note *which* provider. A small number of leaf providers (e.g. `TooltipProvider`, already imported by the component itself) is a mountable result; needing the app's full provider hierarchy is a spike failure.
- Throws inside a module-level singleton → this is Task 4's subject; note the module and continue.

Do not add providers to make it render. Record what it needs, then decide in Task 6.

- [ ] **Step 6: Commit**

```bash
git add vingilot/workbench
git commit -m "$(cat <<'EOF'
feat(workbench): mount MessageTimeline against fabricated props

First half of ADR-001 exit criterion 1. The harness deliberately supplies no
providers: if the component needs one, that must surface as an error we can
report, not as something we quietly supplied to make the spike look successful.

Signed-off-by: Ahmet Yusuf Birinci <ayb84870@gmail.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Singleton-reach guard — ADR-001 exit criterion 3

**Files:**
- Create: `vingilot/workbench/scripts/check-singleton-reach.mjs`
- Create: `vingilot/workbench/src/singletonReach.test.mjs`

**Interfaces:**
- Consumes: `walk` and `DESKTOP_SRC` from `import-graph.mjs` (Task 2).
- Produces: `reachableSingletons(entryFile)` returning `Promise<string[]>` — reset-function names from `useCommunityInit.ts` whose defining module is reachable from the harness.

Criterion 3 is the one most likely to be quietly skipped, because nothing visibly breaks when it is violated — data from one community leaks into another, later, in production. `desktop/src/features/communities/useCommunityInit.ts` lists 20 such resets.

- [ ] **Step 1: Write the failing test**

`vingilot/workbench/src/singletonReach.test.mjs`:

```js
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { reachableSingletons } from "../scripts/check-singleton-reach.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("every reachable community singleton is enumerated", async () => {
  const reached = await reachableSingletons(path.join(here, "SpikeHarness.tsx"));
  assert.ok(Array.isArray(reached));
  // Not an assertion of emptiness: this records the surface for the report.
  // Task 6 decides whether the count is acceptable.
  console.log(`reachable community singletons: ${reached.length}`);
  for (const name of reached) console.log("  " + name);
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm --filter @vingilot/workbench test
```

Expected: FAIL — `Cannot find module '../scripts/check-singleton-reach.mjs'`.

- [ ] **Step 3: Write the guard**

`vingilot/workbench/scripts/check-singleton-reach.mjs`:

```js
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
```

- [ ] **Step 4: Run and record the real number**

```bash
pnpm --filter @vingilot/workbench test 2>&1 | grep -A40 "reachable community singletons"
```

Expected: PASS, with a printed list. **Copy that list verbatim — Task 6 needs it.**

Interpretation, decided now so it is not rationalised later:
- **0 reachable** — criterion 3 met outright.
- **1–3 reachable** — met, provided the Workbench registers each in its own reset path. Record which.
- **More than 3, or any that pull in the relay client** — treat as a signal the mount drags in far more than presentation, and weigh it against the adapter fallback in Task 6.

- [ ] **Step 5: Commit**

```bash
git add vingilot/workbench
git commit -m "$(cat <<'EOF'
test(workbench): enumerate community singletons reachable from the mount

ADR-001 exit criterion 3, made mechanical. This is the criterion most likely to
be skipped, because violating it breaks nothing visibly — one community's data
leaks into another, later, in production.

The guard cross-references the harness's transitive import graph against the 20
reset functions upstream's useCommunityInit registers, and reports the overlap.
It deliberately does not assert emptiness: the number is the finding, and the
spike report decides whether it is acceptable.

Signed-off-by: Ahmet Yusuf Birinci <ayb84870@gmail.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Mount the composer and accept input

**Files:**
- Modify: `vingilot/workbench/src/SpikeHarness.tsx`
- Modify: `vingilot/workbench/src/fixtures/timeline.ts`
- Modify: `vingilot/workbench/src/mount.test.mjs`

**Interfaces:**
- Consumes: `timelineFixture` (Task 3), `walk` (Task 2).
- Produces: nothing later tasks depend on. This closes exit criterion 1.

- [ ] **Step 1: Read the composer's prop type**

```bash
cd ~/self-hosted/vingilot
sed -n '/^(export )?(type|interface) MessageComposerProps/,/^}/p' \
  desktop/src/features/messages/ui/MessageComposer.tsx
```

- [ ] **Step 2: Add the failing assertion**

Append to `vingilot/workbench/src/mount.test.mjs`:

```js
test("the harness reaches the upstream composer", async () => {
  const reached = await walk(path.join(here, "SpikeHarness.tsx"));
  const hit = [...reached].some((f) =>
    f.endsWith(path.join("features", "messages", "ui", "MessageComposer.tsx")),
  );
  assert.ok(hit, "harness does not import MessageComposer");
});
```

- [ ] **Step 3: Run it to confirm it fails**

```bash
pnpm --filter @vingilot/workbench test
```

Expected: the new test FAILS, the existing ones still pass.

- [ ] **Step 4: Mount the composer below the timeline**

Add to `SpikeHarness.tsx`, using the prop type read in Step 1 and an `onSend` that appends to local React state so typing has a visible effect:

```tsx
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
```

Render it beneath `<MessageTimeline />` inside the existing flex column.

- [ ] **Step 5: Typecheck, test, and exercise it by hand**

```bash
cd ~/self-hosted/vingilot && . ./bin/activate-hermit
pnpm --filter @vingilot/workbench typecheck
pnpm --filter @vingilot/workbench test
pnpm --filter @vingilot/workbench check:import-edges
pnpm --filter @vingilot/workbench dev
```

At `http://localhost:5273`: type into the composer and submit. Expected: the text appears in the timeline.

Record honestly whether the composer needed anything the timeline did not — it is the more entangled of the two (drafts, attachments, emoji, upload), and a large difference between the two components is itself a finding.

- [ ] **Step 6: Commit**

```bash
git add vingilot/workbench
git commit -m "$(cat <<'EOF'
feat(workbench): mount the composer and close exit criterion 1

Both halves of ADR-001 exit criterion 1 now render in the Workbench shell with
no upstream file modified. The composer is the more entangled of the two —
drafts, attachments, uploads — so any difference between what it needs and what
the timeline needs is itself a result, recorded in the spike report.

Signed-off-by: Ahmet Yusuf Birinci <ayb84870@gmail.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The spike report — the actual deliverable

**Files:**
- Create: `vingilot/docs/spike-report.md`
- Modify: `vingilot/docs/adr/ADR-001-product-composition-and-upstream-boundary.md`

**Interfaces:**
- Consumes: recorded output from Tasks 3, 4, 5.
- Produces: a verdict that either confirms ADR-001's mechanism or triggers its documented fallback.

Everything before this task was instrumentation. This is the point.

- [ ] **Step 1: Re-run every guard and capture verbatim output**

```bash
cd ~/self-hosted/vingilot && . ./bin/activate-hermit
pnpm --filter @vingilot/workbench typecheck
pnpm --filter @vingilot/workbench test
pnpm --filter @vingilot/workbench check:import-edges
pnpm --filter @vingilot/workbench check:singleton-reach
./vingilot/scripts/check-seams.sh; echo "seams exit=$?"
./vingilot/scripts/upstream-merge-dryrun.sh
```

Paste real output into the report. Not summaries of output.

- [ ] **Step 2: Write the report**

`vingilot/docs/spike-report.md` must contain, in this order:

1. **Verdict** — one of: *alias-import holds*, *alias-import holds with named conditions*, *fallback to the chat adapter*. First line of the document.
2. **Evidence** — the three criteria, each with the command run and its verbatim output.
3. **What the mount dragged in** — total files in the transitive graph, and the count reachable from `desktop/src/features/**` versus `desktop/src/shared/**`.
4. **Providers required** — every provider the components needed, and whether that set is small and leaf-like or the app's hierarchy.
5. **Singletons reachable** — the list from Task 4, and for each, whether the Workbench must register a reset.
6. **Churn exposure** — run this and include it, because it is the number that decides whether a passing spike stays passing:

```bash
cd ~/self-hosted/vingilot
git fetch upstream --quiet
git diff --name-only $(git merge-base HEAD upstream/main) upstream/main \
  | grep -E "desktop/src/(features/(messages|channels|profile)|shared)/" | wc -l
```

On 2026-08-02 this surface saw 5 changed files in a single day. State the current number and what it implies for maintenance.

7. **Limitations** — at minimum: the import walker is regex-based and misses computed dynamic imports; the spike ran without a relay, so runtime data-fetching paths were never exercised.

- [ ] **Step 3: Record the outcome in ADR-001**

Add a `### Spike result` subsection under the Phase 0 spike exit criteria, stating the verdict, the date, the commit, and a link to `../spike-report.md`. If the verdict is *fallback*, also update decision 7 and the alternatives section — the ADR must not keep asserting a mechanism the spike disproved.

- [ ] **Step 4: Commit**

```bash
git add vingilot/docs/spike-report.md vingilot/docs/adr/ADR-001-product-composition-and-upstream-boundary.md
git commit -m "$(cat <<'EOF'
docs(vingilot): record the Workbench mount spike result

ADR-001 bet that upstream chat slices can be imported in place rather than
extracted, and named a fallback if that failed. This is the measurement, with
verbatim command output for all three exit criteria.

Includes the churn number for the imported surface, because a spike that passes
once tells you less than the rate at which the thing it depends on changes.

Signed-off-by: Ahmet Yusuf Birinci <ayb84870@gmail.com>
Co-authored-by: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:** ADR-001's three exit criteria map to Tasks 3+5, 2, and 4 respectively; the fallback decision is Task 6. ADR-001 decision 6 (seam inventory) is honoured in Task 1 Step 5 and re-verified before every commit. ADR-004 trailer order appears in all six commit messages. Not covered, deliberately: Tauri packaging, the coordinator, the executor, and relay changes — those are separate plans (see below) and none of them can be scoped until this verdict exists.

**Placeholders:** none. Two steps (Task 3 Step 1, Task 5 Step 1) instruct reading a real prop type from a real file before writing the fixture rather than printing an invented one — that is a deliberate instruction, not a gap, because a fixture written against a guessed prop shape would typecheck against nothing and prove nothing.

**Type consistency:** `walk(entryFile)` is defined in Task 2 and consumed with that exact signature in Tasks 3, 4, 5. `DESKTOP_SRC` is exported once and imported by both guards. `timelineFixture` is created in Task 3 and extended in Task 5. `forbiddenEdges` and `reachableSingletons` are each defined and used once.

## Why this plan, and not a Phase 1 + Phase 2 plan

The request was a plan for Phase 1 and Phase 2. That spans four independent subsystems — the Workbench application, the coordinator service, the executor and capability broker, and the relay seam — each of which wants its own plan producing working software on its own.

More decisively: **every one of those plans depends on this spike's verdict.** ADR-001 chose a sibling application that alias-imports upstream slices, with a chat adapter as the documented fallback. If the fallback is taken, the Workbench plan is materially different work. Writing four plans on top of an unverified premise would mean writing them twice.

The spike is also unusually cheap right now — `MessageTimeline.tsx` has zero direct `@/app/` imports, so the most likely blocker is already known to be absent — and unusually urgent: upstream changed five files on this exact surface in a single day.

Sequence after the verdict:

1. **This spike** — gates everything below.
2. **Workbench shell** — Tauri packaging (`productName: Vingilot`, its own identifier — upstream's is `xyz.block.buzz.app`), activity bar, tab area, status bar, command palette.
3. **Coordinator** — ADR-002. Postgres schema, CAS mutation protocol, Run state machine, lease and fencing epochs. Buildable and testable with no UI at all, so it can run in parallel with 2.
4. **Executor and capability broker** — ADR-003. PTY supervision, ACP harness launch, per-harness capability detection, evidence capture.
5. **Relay seam** — new kinds for notification and audit only, since ADR-002 removed the relay from the authority path. Smallest of the five.
