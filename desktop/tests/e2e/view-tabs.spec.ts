// Reading beside the shells — redesign P4.1, items 3 and 4, over the real key
// path and a recorded pty bridge.
//
// > *"gerekirse hatta bence terminalin oldugu kisimda yeni tab gibi
// > acilmali"* — and *"file'lara basinca yine terminalin oldugu yerde tab gibi
// > acilmali."*
//
// `viewTabs.test.mjs` says what the model does with an open, a re-open, a
// close and a clear, and it needs no browser. What only a browser can say:
//
// 1. **A file picked in the dock's tree really becomes a tab on the stage** —
//    the tree stays where it is, the viewer is NOT inside the dock card, and
//    the strip beside the terminals grows a tab wearing the file's language
//    icon (the owner's one licensed deviation from the mockup).
// 2. **A commit and a diff do the same** — the History graph's row and the
//    Diff panel's "Open in tab", both landing on the stage rather than in a
//    300-540px card, which is P3.1's geometry ruling answered.
// 3. **NO pty is disturbed by any of it.** The claim the `WorkSurface` header
//    makes — a terminal that changed parents is a new xterm, a fresh attach
//    and a replay into a box that has not been laid out — is asserted here as
//    an exact invariant: the recorded `pty_open` / `pty_close` / `pty_write`
//    calls are IDENTICAL across opening three view tabs, switching between
//    them, and closing them. A view tab never touches a shell.
// 4. **The shells come back on any shell gesture** — clicking a terminal tab
//    clears the reading without closing it, and closing the last view tab
//    lands on the terminals rather than on nothing.
//
// The graph itself (real lanes from real parents, "all branches") is proved in
// `workspace-history.spec.ts`, which owns the `worktree_log` fixture; what is
// added there is asserted here only as far as a commit row opening a tab.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
/** The 16-inch MacBook Pro's default logical resolution — his own machine. */
const SIXTEEN_INCH = { height: 1117, width: 1728 };

const GIT_HOME = "/tmp/vingilot-view-tabs-home";
const REPO = {
  id: "repo-views",
  name: "vingilot",
  path: "/tmp/vingilot-views",
};

const WORKTREE = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-views",
  branch: "spike",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-views",
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
};

/** One directory level per key — `worktree_tree`'s own answer shape. Six
 * languages, so the icon vocabulary is read as a vocabulary rather than as one
 * glyph that happens to render. */
const TREE: Record<
  string,
  { name: string; kind: string; size: number | null }[]
> = {
  "": [
    { kind: "directory", name: "src", size: null },
    { kind: "file", name: "README.md", size: 32 },
    { kind: "file", name: "Cargo.toml", size: 64 },
    { kind: "file", name: "pnpm-lock.yaml", size: 128 },
    { kind: "file", name: "mystery.qqq", size: 8 },
  ],
  src: [
    { kind: "file", name: "greet.ts", size: 64 },
    { kind: "file", name: "main.rs", size: 64 },
  ],
};

const FILES: Record<string, string> = {
  "Cargo.toml": '[package]\nname = "vingilot"\n',
  "README.md": "# vingilot\n",
  "src/greet.ts": "export const greet = 1;\n",
  "src/main.rs": "fn main() {}\n",
};

const HEAD_HASH = "a".repeat(40);
const OLDER_HASH = "b".repeat(40);

const COMMITS = [
  {
    author: "Yusuf Birinci",
    date: "2026-08-31T09:00:00+03:00",
    hash: HEAD_HASH,
    parents: [OLDER_HASH],
    refs: ["HEAD -> spike"],
    short: "aaaaaaa",
    subject: "Read beside the shells",
  },
  {
    author: "Yusuf Birinci",
    date: "2026-08-30T09:00:00+03:00",
    hash: OLDER_HASH,
    parents: [],
    refs: ["main"],
    short: "bbbbbbb",
    subject: "The commit before all this",
  },
];

const PATCH = `@@ -1,2 +1,2 @@
 context line
-was here
+is here now
`;

type PtyProbe = {
  closes: string[];
  opens: string[];
  writes: string[];
};

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
  __VIEW_TAB_PROBE__: PtyProbe;
};

declare global {
  interface Window {
    __VIEW_TAB_PROBE__: PtyProbe;
  }
}

/** Every Tauri command this island needs, plus a recording of the three pty
 * calls the invariant is about. The property trap is `status-bar.spec.ts`'s
 * (and `dock.spec.ts`'s) own idiom: the bridge assigns `invoke` at boot, which
 * is after any init script, so the trap captures it as `fallback` rather than
 * being overwritten by it. */
async function installTrap(page: Page) {
  await page.addInitScript(
    ([home, tree, files, commits, patch]: [
      string,
      Record<string, { name: string; kind: string; size: number | null }[]>,
      Record<string, string>,
      unknown[],
      string,
    ]) => {
      const w = window as unknown as TrapWindow;
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;
      const probe: PtyProbe = { closes: [], opens: [], writes: [] };
      w.__VIEW_TAB_PROBE__ = probe;

      const diff = (base: string) => ({
        additions: 1,
        base,
        deletions: 1,
        files: [
          {
            additions: 1,
            change: "modified",
            deletions: 1,
            oldPath: null,
            patch,
            path: "src/greet.ts",
            truncated: false,
          },
        ],
        limits: { files: 500, patchBytes: 262_144 },
        omitted: 0,
      });

      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        const payload = (args ?? {}) as Record<string, string>;
        if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);
        if (name === "hook_liveness")
          return Promise.resolve({ byBinding: {}, unattributed: null });
        if (name === "worktree_stats") return Promise.resolve([]);
        if (name === "worktree_list") return Promise.resolve([]);
        if (name === "pty_backing") return Promise.resolve("tmux");
        if (name === "pty_copy_mode") return Promise.resolve(false);
        if (name === "pty_open") {
          probe.opens.push(payload.session);
          return Promise.resolve(null);
        }
        if (name === "pty_close") {
          probe.closes.push(payload.session);
          return Promise.resolve(null);
        }
        if (name === "pty_write") {
          probe.writes.push(payload.session);
          return Promise.resolve(null);
        }
        if (name.startsWith("pty_")) return Promise.resolve(null);
        if (name === "worktree_tree") {
          const dir = payload.dir ?? "";
          const entries = tree[dir];
          if (entries === undefined) {
            return Promise.reject({ kind: "not-found", path: dir });
          }
          return Promise.resolve({
            dir,
            entries,
            limit: 2000,
            truncated: false,
          });
        }
        if (name === "file_read") {
          const path = payload.path ?? "";
          const text = files[path];
          if (text === undefined) {
            return Promise.reject({ kind: "not-found", path });
          }
          return Promise.resolve({
            bytes: text.length,
            lines: text.split("\n").length,
            path,
            text,
          });
        }
        if (name === "worktree_log") {
          return Promise.resolve({
            commits,
            cursor: null,
            limit: 200,
            more: false,
          });
        }
        if (name === "worktree_diff") {
          return Promise.resolve(diff(payload.base ?? "HEAD"));
        }
        if (name === "commit_diff") {
          const hash = payload.commit ?? "";
          const found = (commits as { hash: string }[]).find(
            (entry) => entry.hash === hash,
          );
          if (found === undefined) {
            return Promise.reject({ base: hash, kind: "unknown-base" });
          }
          return Promise.resolve({
            commit: found,
            diff: diff(`${hash}~1`),
            merge: false,
            parent: `${hash}~1`,
          });
        }
        if (fallback === null) {
          return Promise.reject(new Error(`no host for ${name}`));
        }
        return fallback(cmd, args, opts);
      };

      const internals = (w.__TAURI_INTERNALS__ ??
        {}) as TrapWindow["__TAURI_INTERNALS__"];
      w.__TAURI_INTERNALS__ = internals;
      Object.defineProperty(internals, "invoke", {
        configurable: true,
        get: () => invoke,
        set: (fn: (cmd: string, args?: unknown, opts?: unknown) => unknown) => {
          fallback = fn;
        },
      });
    },
    [GIT_HOME, TREE, FILES, COMMITS, PATCH] as const,
  );
}

async function openWorkspace(page: Page) {
  await page.setViewportSize(SIXTEEN_INCH);
  await installTrap(page);
  await installMockBridge(page);
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state: { repos: [REPO] },
          state_hash: "mock-state-hash",
        },
      });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`) {
      return route.fulfill({ json: { worktrees: [WORKTREE] } });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`) {
      return route.fulfill({ json: { runs: [] } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await page.getByTestId(`worktree-row-${WORKTREE.binding_id}`).click();
  await expect(page.getByTestId("terminal-tab-strip")).toBeVisible();
}

/** The dock's own tab strip. Each panel has its own testid — the Diff panel is
 * `pane-diff` (it predates the dock and kept its name), the other two are
 * `dock-*` — so the body to wait for is named beside the tab. */
const DOCK_PANEL = {
  diff: "pane-diff",
  files: "dock-files",
  history: "dock-history",
} as const;

async function openDockTab(page: Page, tab: keyof typeof DOCK_PANEL) {
  await page.getByTestId(`dock-tab-${tab}`).click();
  await expect(
    page.getByTestId("dock").getByTestId(DOCK_PANEL[tab]),
  ).toBeVisible();
}

/** Everything the app has asked of a pty so far, as one comparable value. */
async function ptyCalls(page: Page) {
  return page.evaluate(() => ({
    closes: [...window.__VIEW_TAB_PROBE__.closes],
    opens: [...window.__VIEW_TAB_PROBE__.opens],
    writes: [...window.__VIEW_TAB_PROBE__.writes],
  }));
}

test("a file picked in the dock opens as a tab on the stage, wearing its language", async ({
  page,
}) => {
  await openWorkspace(page);
  await openDockTab(page, "files");

  // The vocabulary, read as a vocabulary: six extensions, six glyphs, and the
  // honest fallback for the one nothing knows. This is the ONE place the
  // mockup was overruled, by the owner, in as many words.
  const icon = (path: string) =>
    page.getByTestId(`dock-files-icon-${path}`).locator("[data-file-icon]");
  await expect(icon("src")).toHaveAttribute("data-file-icon", "folder");
  await expect(icon("README.md")).toHaveAttribute("data-file-icon", "markdown");
  await expect(icon("Cargo.toml")).toHaveAttribute("data-file-icon", "toml");
  // A lockfile outranks the language it happens to be written in.
  await expect(icon("pnpm-lock.yaml")).toHaveAttribute(
    "data-file-icon",
    "lock",
  );
  await expect(icon("mystery.qqq")).toHaveAttribute("data-file-icon", "file");
  await page.getByTestId("dock-files-row-src").click();
  await expect(icon("src/greet.ts")).toHaveAttribute("data-file-icon", "ts");
  await expect(icon("src/main.rs")).toHaveAttribute("data-file-icon", "rust");

  // The click. The tree stays; the reading goes to the stage.
  await page.getByTestId("dock-files-row-src/main.rs").click();
  await expect(page.getByTestId("dock-files-tree")).toBeVisible();
  await expect(
    page.getByTestId("dock-files").getByTestId("files-viewer"),
  ).toHaveCount(0);
  const tab = page.getByTestId("view-tab-file:src/main.rs");
  await expect(tab).toBeVisible();
  await expect(tab).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("files-viewer-path")).toHaveText("src/main.rs");
  // The tab wears the file's own icon too, so the strip is scannable the way
  // the tree is.
  await expect(tab.locator("[data-file-icon]")).toHaveAttribute(
    "data-file-icon",
    "rust",
  );

  // Opening the same file again is the tab that is already there, not a second
  // one — the rule every editor keeps.
  await page.getByTestId("dock-files-row-src/main.rs").click();
  await expect(page.getByTestId("view-tab-file:src/main.rs")).toHaveCount(1);

  // A second file is a second tab, and it takes the stage.
  await page.getByTestId("dock-files-row-src/greet.ts").click();
  await expect(page.getByTestId("files-viewer-path")).toHaveText(
    "src/greet.ts",
  );
  await expect(page.getByTestId("view-tab-file:src/main.rs")).toHaveAttribute(
    "data-active",
    "false",
  );
});

test("a commit and a diff open as tabs too, and the diff gets the whole stage", async ({
  page,
}) => {
  await openWorkspace(page);

  // The History graph's row.
  await openDockTab(page, "history");
  await expect(page.getByTestId("dock-history-scope")).toContainText(
    "all branches",
  );
  await page.getByTestId(`dock-history-commit-${HEAD_HASH}`).click();
  await expect(page.getByTestId(`view-tab-commit:${HEAD_HASH}`)).toBeVisible();
  await expect(page.getByTestId("history-patch-title")).toContainText(
    "aaaaaaa",
  );
  // The dock is still the graph: browsing did not become reading.
  await expect(page.getByTestId("dock-history-graph")).toBeVisible();

  // And the Diff panel's own door. **This is P3.1's geometry ruling**: the
  // dock card is clamped at 540px, short of the 695px two columns need, so a
  // diff that needs room takes the stage instead. At his own 16-inch width the
  // stage is past that floor, which is what makes the split toggle live.
  await openDockTab(page, "diff");
  await page.getByTestId("worktree-diff-open-tab").click();
  // Located by prefix rather than by base: the base the panel is READING
  // against is the worktree's own default (`defaultDiffBase`), and pinning a
  // literal here would make this a test of that helper.
  const diffTab = page.locator('[data-testid^="view-tab-diff:"]');
  await expect(diffTab).toBeVisible();
  await expect(diffTab).toHaveAttribute("data-active", "true");
  // Two `pane-diff`s exist now — the dock's and the tab's — and the one on the
  // stage is the wide one.
  const staged = page
    .getByTestId("work-surface")
    .locator('[data-view-kind="diff"] [data-testid="pane-diff"]');
  await expect(staged).toBeVisible();
  const dockWidth = await page
    .getByTestId("dock")
    .evaluate((node) => node.getBoundingClientRect().width);
  const stageWidth = await staged.evaluate(
    (node) => node.getBoundingClientRect().width,
  );
  expect(stageWidth).toBeGreaterThan(dockWidth);
  // The copy that IS the tab does not offer to open a tab — that would be a
  // loop, and it is absent rather than disabled.
  await expect(staged.getByTestId("worktree-diff-open-tab")).toHaveCount(0);
});

test("no view tab ever disturbs a pty", async ({ page }) => {
  // **The invariant `WorkSurface`'s header is about.** A terminal that changed
  // parents is a new xterm, a fresh attach and a replay into a box that has
  // not been laid out — so the reading is drawn BESIDE the shells and the
  // shells are merely un-laid-out, which is where every background tab already
  // lives. Asserted as an exact equality on the recorded calls, not as "no
  // error was thrown".
  await openWorkspace(page);
  await openDockTab(page, "files");
  await page.getByTestId("dock-files-row-src").click();

  const before = await ptyCalls(page);
  expect(before.opens.length).toBeGreaterThan(0);

  // Open three readings of three kinds, switch between them, and close them.
  await page.getByTestId("dock-files-row-src/main.rs").click();
  await page.getByTestId("dock-files-row-src/greet.ts").click();
  await openDockTab(page, "history");
  await page.getByTestId(`dock-history-commit-${HEAD_HASH}`).click();
  await openDockTab(page, "diff");
  await page.getByTestId("worktree-diff-open-tab").click();
  await expect(page.locator('[data-testid^="view-tab-diff:"]')).toBeVisible();

  await page.getByTestId("view-tab-select-file:src/main.rs").click();
  await expect(page.getByTestId("files-viewer-path")).toHaveText("src/main.rs");
  await page.getByTestId(`view-tab-select-commit:${HEAD_HASH}`).click();
  await expect(page.getByTestId("history-patch-title")).toContainText(
    "aaaaaaa",
  );

  await page.locator('[data-testid^="view-tab-close-diff:"]').click();
  await page.getByTestId(`view-tab-close-commit:${HEAD_HASH}`).click();
  await expect(page.getByTestId(`view-tab-commit:${HEAD_HASH}`)).toHaveCount(0);

  expect(await ptyCalls(page)).toEqual(before);
});

test("any shell gesture brings the terminals back, and nothing is closed to do it", async ({
  page,
}) => {
  await openWorkspace(page);
  await openDockTab(page, "files");
  await page.getByTestId("dock-files-row-src").click();
  await page.getByTestId("dock-files-row-src/greet.ts").click();
  await expect(page.getByTestId("files-viewer-path")).toHaveText(
    "src/greet.ts",
  );

  // Clicking the terminal's own tab is a shell gesture: the reading stops
  // being laid out, the tab stays in the strip, and the shell is lit again.
  await page.getByTestId("terminal-tab-1").click();
  await expect(page.getByTestId("files-viewer")).toHaveCount(0);
  const shellTab = page.getByTestId("terminal-tab-1").locator("xpath=..");
  await expect(shellTab).toHaveAttribute("data-active", "true");
  const view = page.getByTestId("view-tab-file:src/greet.ts");
  await expect(view).toBeVisible();
  await expect(view).toHaveAttribute("data-active", "false");

  // And the reading is one click back.
  await page.getByTestId("view-tab-select-file:src/greet.ts").click();
  await expect(page.getByTestId("files-viewer-path")).toHaveText(
    "src/greet.ts",
  );
  await expect(shellTab).toHaveAttribute("data-active", "false");

  // Closing the last view lands on the terminals rather than on nothing: a
  // view owns no session, so there is no "never leave the strip empty" rule
  // to keep here.
  await page.getByTestId("view-tab-close-file:src/greet.ts").click();
  await expect(page.getByTestId("view-tab-file:src/greet.ts")).toHaveCount(0);
  await expect(shellTab).toHaveAttribute("data-active", "true");
});
