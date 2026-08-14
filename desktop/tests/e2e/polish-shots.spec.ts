// The pictures the right-side polish pass is judged by
// (vingilot/docs/plans/2026-08-12-polish-the-right-side.md, Verification).
//
// One spec, one shot per pane state, taken twice: once at the commit before
// the pass and once after it, so the owner vetoes by eye, per pane. It follows
// `workspace-readme-shots.spec.ts`'s discipline: every capture is gated on
// assertions that the seeded state actually reached the screen, because an
// empty pane renders a perfectly valid PNG.
//
// **Deliberately blind to the polish itself.** Every assertion here is on
// testids and sentences the pass must not break; nothing asserts a colour or a
// padding. A spec that pinned the new dress would fail on the "before" run,
// and the whole point is that the same spec produces both sets.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import {
  EXTERNAL_DISPLAY,
  openHistoryPane,
  openHistoryWorkspace,
} from "./workspace-history.fixtures";

/** Where the PNGs land — under `test-results/` like every other shot run, and
 * copied elsewhere by hand as a deliberate act. */
const SHOTS = "test-results/polish-shots";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** The 16-inch MacBook Pro — the machine the complaint was made about. */
const SIXTEEN_INCH = { height: 1117, width: 1728 };

const GIT_HOME = "/tmp/vingilot-polish-home";
const REPO = {
  id: "repo-polish",
  name: "vingilot",
  path: "/tmp/vingilot-polish",
};

const WORKTREE = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-polish",
  branch: "spike",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-polish",
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
};

const SMALL_TS = `export function greet(name: string): string {
  return \`hello \${name}\`;
}
`;

/** Over the old 150-line ceiling: before the pass this renders plain with the
 * ceiling sentence, after it the same file is highlighted in the background.
 * The shot is what shows that; the assertions only require the text. */
const LONG_TS = Array.from(
  { length: 400 },
  (_, index) => `const line${index} = ${index};`,
).join("\n");

const TREE: Record<
  string,
  { name: string; kind: string; size: number | null }[]
> = {
  "": [
    { kind: "directory", name: "src", size: null },
    { kind: "file", name: "README.md", size: 128 },
    { kind: "file", name: "Cargo.toml", size: 512 },
    { kind: "file", name: "logo.png", size: 4096 },
  ],
  src: [
    { kind: "file", name: "greet.ts", size: SMALL_TS.length },
    { kind: "file", name: "long.ts", size: LONG_TS.length },
  ],
};

const FILES: Record<string, string> = {
  "README.md": "# vingilot\n",
  "Cargo.toml": '[package]\nname = "vingilot"\n',
  "src/greet.ts": SMALL_TS,
  "src/long.ts": LONG_TS,
};

/** Search hits across two files, enough rows to show the group headers, the
 * line numbers and the match emphasis. */
const SEARCH_HITS = [
  {
    clipped: false,
    column: 6,
    line: 14,
    path: "src/auth/refresh.go",
    text: "const tokenTTL = 15 * time.Minute",
  },
  {
    clipped: false,
    column: 24,
    line: 41,
    path: "src/auth/refresh.go",
    text: "func (s *Store) refreshToken(subject string) error {",
  },
  {
    clipped: false,
    column: 10,
    line: 88,
    path: "src/auth/refresh.go",
    text: "\t\ts.mu.Lock() // token map is shared",
  },
  {
    clipped: false,
    column: 12,
    line: 7,
    path: "src/auth/refresh_test.go",
    text: "func TestTokenRefreshConcurrent(t *testing.T) {",
  },
  {
    clipped: false,
    column: 30,
    line: 19,
    path: "src/auth/refresh_test.go",
    text: "\tif got := store.token(subject); got == stale {",
  },
];

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
};

async function openPolishWorkspace(page: Page) {
  await page.setViewportSize(SIXTEEN_INCH);
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

  await page.addInitScript(
    ([home, tree, files, hits]: [
      string,
      Record<string, { name: string; kind: string; size: number | null }[]>,
      Record<string, string>,
      typeof SEARCH_HITS,
    ]) => {
      const w = window as unknown as TrapWindow;
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;

      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);
        if (name === "worktree_tree") {
          const dir = ((args ?? {}) as { dir?: string }).dir ?? "";
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
          const path = ((args ?? {}) as { path?: string }).path ?? "";
          if (path === "logo.png") {
            return Promise.reject({ kind: "binary", path });
          }
          const text = files[path];
          if (text === undefined) {
            return Promise.reject({
              detail: "No such file or directory (os error 2)",
              kind: "unreadable",
              path,
            });
          }
          return Promise.resolve({
            bytes: text.length,
            lines: text === "" ? 0 : text.replace(/\n$/, "").split("\n").length,
            path,
            text,
          });
        }
        if (name === "worktree_search") {
          const pattern = ((args ?? {}) as { pattern?: string }).pattern ?? "";
          return Promise.resolve({
            capped: false,
            hits: pattern === "" ? [] : hits,
            limit: 2000,
            pattern,
            regex: false,
          });
        }
        if (name === "worktree_diff") {
          return Promise.resolve({
            additions: 0,
            base: "HEAD",
            deletions: 0,
            files: [],
            limits: {
              maxFiles: 400,
              maxPatchBytes: 262_144,
              maxPatchLines: 2000,
              maxUntracked: 100,
            },
            omittedFiles: 0,
            omittedUntracked: 0,
          });
        }
        if (name === "worktree_stats") {
          const paths = ((args ?? {}) as { paths?: string[] }).paths ?? [];
          return Promise.resolve(
            paths.map((path) => ({
              additions: 0,
              changedFiles: 0,
              deletions: 0,
              dirty: false,
              path,
              unreadable: false,
              untracked: 0,
            })),
          );
        }
        if (name === "worktree_list") return Promise.resolve([]);
        // `app-process` rather than tmux, deliberately: it is the backing
        // whose status-bar sentence is a warning, which is the state worth
        // photographing on the status bar.
        if (name === "pty_backing") return Promise.resolve("app-process");
        if (name.startsWith("pty_")) return Promise.resolve(null);
        if (fallback === null)
          return Promise.reject(new Error(`no host for ${name}`));
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
    [GIT_HOME, TREE, FILES, SEARCH_HITS] as const,
  );

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await page.getByTestId(`worktree-row-${WORKTREE.binding_id}`).click();
}

async function openPane(page: Page, id: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.getByTestId("palette-input").fill(id);
  await page.getByTestId(`palette-row-pane:${id}`).click();
  await expect(page.getByTestId(`pane-${id}`)).toBeVisible();
}

async function shoot(page: Page, testId: string, name: string) {
  await waitForAnimations(page);
  await page.getByTestId(testId).screenshot({ path: `${SHOTS}/${name}.png` });
}

test("files: the tree, the viewer, the long file, and the empty state", async ({
  page,
}) => {
  await openPolishWorkspace(page);
  await openPane(page, "files");

  // The tree lives in the Deck sidebar's Files accordion member now
  // (pane-nav-absorb plan) — open it and shoot it there.
  await page.getByTestId("sidebar-accordion-header-files").click();
  await expect(page.getByTestId("files-tree")).toBeVisible();
  await expect(page.getByTestId("files-row-src")).toBeVisible();
  await expect(page.getByTestId("files-row-README.md")).toBeVisible();
  await page.getByTestId("files-row-src").click();
  await expect(page.getByTestId("files-row-src/greet.ts")).toBeVisible();
  await shoot(page, "app-sidebar", "files-tree");

  // A small file, highlighted. The colour poll is also what gates the "after"
  // shot on the async swap having landed.
  await page.getByTestId("files-row-src/greet.ts").click();
  await expect(page.getByTestId("files-viewer-path")).toHaveText(
    "src/greet.ts",
  );
  const coloured = page.locator(
    '[data-testid="files-viewer-code"] span[style*="color"]',
  );
  await expect
    .poll(async () => coloured.count(), { timeout: 15_000 })
    .toBeGreaterThan(3);
  await shoot(page, "pane-right", "files-viewer");

  // The 400-line file — the shot that shows what the ceiling used to cost.
  await page.getByTestId("files-row-src/long.ts").click();
  await expect(page.getByTestId("files-viewer-path")).toHaveText("src/long.ts");
  await expect(page.getByTestId("files-viewer")).toContainText("const line399");
  // Give a background tokenise time to land when there is one; asserted only
  // as "the text is still there" so the before build passes too.
  await page.waitForTimeout(1_500);
  await shoot(page, "pane-right", "files-viewer-long");

  // The empty state: leave and come back (a remount — `identity` is the
  // worktree, but the slot renders one pane at a time). No drawer to put
  // away: the viewer has the pane whole.
  await openPane(page, "search");
  await openPane(page, "files");
  await expect(page.getByTestId("files-viewer-empty")).toBeVisible();
  await shoot(page, "pane-right", "files-empty");
});

test("search: the idle state and a page of results", async ({ page }) => {
  await openPolishWorkspace(page);
  await openPane(page, "search");

  await expect(page.getByTestId("search-idle")).toBeVisible();
  await shoot(page, "pane-right", "search-idle");

  await page.getByTestId("search-input").fill("token");
  await expect(page.getByTestId("search-results")).toBeVisible();
  await expect(
    page.getByTestId("search-file-src/auth/refresh.go"),
  ).toBeVisible();
  await expect(
    page.getByTestId("search-file-src/auth/refresh_test.go"),
  ).toBeVisible();
  await expect(page.getByTestId("search-hit-match").first()).toBeVisible();
  await shoot(page, "pane-right", "search-results");
});

test("history: source control and commits, then a commit's patch", async ({
  page,
}) => {
  // The external display, where the list stands beside the patch and the empty
  // patch state is on screen at all.
  await openHistoryWorkspace(page, EXTERNAL_DISPLAY);
  await openHistoryPane(page);

  await expect(page.getByTestId("history-status-headline")).toBeVisible();
  await expect(
    page.getByTestId("history-file-status:staged:src/new.rs"),
  ).toBeVisible();
  await expect(
    page.getByTestId("history-file-status:unstaged:src/a.rs"),
  ).toBeVisible();
  await expect(
    page.getByTestId("history-file-status:untracked:notes.txt"),
  ).toBeVisible();
  await expect(page.getByTestId("history-commits")).toBeVisible();
  await expect(page.getByTestId("history-patch-none")).toBeVisible();
  await shoot(page, "app-sidebar", "history-list");

  await page.getByTestId(`history-commit-${"a".repeat(40)}`).click();
  await expect(page.getByTestId("history-patch-title")).toContainText(
    "aaaaaaa",
  );
  await expect(page.getByTestId("history-patch")).toContainText("+is here now");
  await shoot(page, "pane-history", "history-commit");
});

test("terminal chrome: the tab strip in its header, and the status bar", async ({
  page,
}) => {
  await openPolishWorkspace(page);
  await expect(page.getByTestId("terminal-tab-strip")).toBeVisible();
  await expect(page.getByTestId("terminal-tab-1")).toBeVisible();
  // Two more tabs so the strip is a strip.
  await page.getByTestId("terminal-tab-new").click();
  await page.getByTestId("terminal-tab-new").click();
  await expect(page.getByTestId("terminal-tab-3")).toBeVisible();
  await shoot(page, "pane-left", "terminal-chrome");

  await expect(page.getByTestId("terminal-persistence")).toBeVisible();
  await shoot(page, "project-status-bar", "status-bar");
});
