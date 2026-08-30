// The Deck sidebar since P1.1 (owner veto 4): the mockup's `.side` anatomy
// first — the Projects tree rendered directly (no "Worktrees" accordion
// header), the channel/DM lists inline below it (no "Chats" header) — and
// Files/History as a deeper two-member accordion BELOW that anatomy, both
// collapsed on first paint.
//
// Each test here is a red-proof for one of the claims:
//
// 1. **First-screen anatomy.** Projects and the chat lists are on screen with
//    no fold to open; the only accordion headers left are Files and History,
//    both shut; opening one collapses the other. Red before P1.1: four
//    headers, Worktrees open, chats behind a fold.
// 2. **The Files pane owns no tree.** The tree lives in the sidebar; the pane
//    is the viewer at full width, with no drawer and no toggle left in its
//    DOM.
// 3. **Tree state survives a collapse and a pane switch.** The collapsed
//    member's DOM is hidden, not unmounted, and the sidebar is a sibling of
//    the Deck's panes — so expanded directories outlive both gestures.
// 4. **Worktree scope follows while Files is open**: the worktree changes by
//    another route (⌘K), and the Files tree re-reads for the new checkout
//    with Files staying open.
// 5. **Exactly one owner per keystroke**: one `j` moves exactly one cursor,
//    even with the History pane's patch on screen — the sidebar list is the
//    only listener left.
// 6. **The inline chat lists** are the same channel/DM lists the Inbox shows,
//    and a channel row navigates exactly as it does from there.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
const SIXTEEN_INCH = { height: 1117, width: 1728 };

const GIT_HOME = "/tmp/vingilot-accordion-home";
const REPO = {
  id: "repo-accordion",
  name: "vingilot",
  path: "/tmp/vingilot-accordion",
};

const WORKTREE_A = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-acc-a",
  branch: "spike-a",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-acc-a",
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
};

const WORKTREE_B = {
  ...WORKTREE_A,
  binding_id: "wt-acc-b",
  branch: "spike-b",
  owner_run_id: "run-acc-b",
};

/** Two checkouts, two different trees — which is what makes "the Files tree
 * follows the worktree" an observable fact rather than a hope. The mock keys
 * on the `worktree` argument `filesClient.readTree` sends. */
const TREE_A: Record<
  string,
  { name: string; kind: string; size: number | null }[]
> = {
  "": [
    { kind: "directory", name: "src", size: null },
    { kind: "file", name: "ONLY-IN-A.md", size: 16 },
  ],
  src: [{ kind: "file", name: "greet.ts", size: 64 }],
};

const TREE_B: Record<
  string,
  { name: string; kind: string; size: number | null }[]
> = {
  "": [{ kind: "file", name: "ONLY-IN-B.md", size: 16 }],
};

const COMMITS = [
  {
    author: "Yusuf Birinci",
    date: "2026-08-12T02:18:00+03:00",
    hash: "a".repeat(40),
    refs: [],
    short: "aaaaaaa",
    subject: "First fixture commit",
  },
  {
    author: "Yusuf Birinci",
    date: "2026-08-11T02:18:00+03:00",
    hash: "b".repeat(40),
    refs: [],
    short: "bbbbbbb",
    subject: "Second fixture commit",
  },
];

const STATUS = {
  conflicted: [],
  limit: 1000,
  omitted: 0,
  staged: [],
  unstaged: [
    { change: "modified", code: ".M", oldPath: null, path: "src/changed.rs" },
  ],
  untracked: [],
};

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
};

async function openAccordionWorkspace(page: Page) {
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
      return route.fulfill({ json: { worktrees: [WORKTREE_A, WORKTREE_B] } });
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
    ([home, treeA, treeB, commits, status]: [
      string,
      Record<string, { name: string; kind: string; size: number | null }[]>,
      Record<string, { name: string; kind: string; size: number | null }[]>,
      unknown[],
      unknown,
    ]) => {
      const w = window as unknown as TrapWindow;
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;
      const refuse = (error: unknown) => Promise.reject(error);

      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);
        if (name === "worktree_tree") {
          const a = (args ?? {}) as { dir?: string; worktree?: string };
          const dir = a.dir ?? "";
          const tree = (a.worktree ?? "").includes("run-acc-b") ? treeB : treeA;
          const entries = tree[dir];
          if (entries === undefined) {
            return refuse({ kind: "not-found", path: dir });
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
          return Promise.resolve({
            bytes: 12,
            lines: 1,
            path,
            text: "fixture text",
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
        if (name === "worktree_status") return Promise.resolve(status);
        if (name === "commit_diff") {
          const hash = ((args ?? {}) as { commit?: string }).commit ?? "";
          const found = (commits as { hash: string }[]).find(
            (c) => c.hash === hash,
          );
          if (found === undefined) {
            return refuse({ base: hash, kind: "unknown-base" });
          }
          return Promise.resolve({
            commit: found,
            diff: {
              additions: 1,
              base: `${hash}~1`,
              deletions: 1,
              files: [
                {
                  additions: 1,
                  binary: false,
                  change: "modified",
                  deletions: 1,
                  oldPath: null,
                  patch: "@@ -1,1 +1,1 @@\n-was here\n+is here now",
                  path: "src/read.rs",
                  truncated: false,
                },
              ],
              limits: {
                maxFiles: 400,
                maxPatchBytes: 262_144,
                maxPatchLines: 2000,
                maxUntracked: 100,
              },
              omittedFiles: 0,
              omittedUntracked: 0,
            },
          });
        }
        if (name === "worktree_diff") {
          return Promise.resolve({
            additions: 1,
            base: "HEAD",
            deletions: 0,
            files: [
              {
                additions: 1,
                binary: false,
                change: "modified",
                deletions: 0,
                oldPath: null,
                patch: "@@ -1,1 +1,1 @@\n-old\n+new working line",
                path: "src/changed.rs",
                truncated: false,
              },
            ],
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
        if (name === "pty_backing") return Promise.resolve("tmux");
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
    [GIT_HOME, TREE_A, TREE_B, COMMITS, STATUS] as const,
  );

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await page.getByTestId(`worktree-row-${WORKTREE_A.binding_id}`).click();
}

function header(page: Page, id: string) {
  return page.getByTestId(`sidebar-accordion-header-${id}`);
}

test("the workspace sidebar opens on the mockup anatomy, with Files/History folded below", async ({
  page,
}) => {
  await openAccordionWorkspace(page);

  // First screen: the Projects tree and the chat lists, with NO fold over
  // either — the vetoed Worktrees/Chats accordion headers do not exist.
  await expect(page.getByTestId("projects-nav")).toBeVisible();
  await expect(page.getByTestId("stream-list")).toBeVisible();
  await expect(page.getByTestId("dm-list")).toBeVisible();
  await expect(header(page, "worktrees")).toHaveCount(0);
  await expect(header(page, "chats")).toHaveCount(0);

  // The Projects header carries the mockup's `+` affordance.
  await expect(page.getByTestId("projects-nav-add")).toBeVisible();

  // Files and History are the deeper accordion, both shut on first paint.
  for (const id of ["files", "history"]) {
    await expect(header(page, id)).toBeVisible();
    await expect(header(page, id)).toHaveAttribute("aria-expanded", "false");
  }

  // Opening History collapses Files — at most one member expanded, ever.
  await header(page, "files").click();
  await expect(header(page, "files")).toHaveAttribute("aria-expanded", "true");
  await header(page, "history").click();
  await expect(header(page, "history")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(header(page, "files")).toHaveAttribute("aria-expanded", "false");
  const expanded = page.locator(
    '[data-testid^="sidebar-accordion-header-"][aria-expanded="true"]',
  );
  await expect(expanded).toHaveCount(1);

  // Clicking the open member's header is a no-op: exactly one stays open.
  await header(page, "history").click();
  await expect(header(page, "history")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(expanded).toHaveCount(1);
});

test("the Files pane owns no tree: the viewer has the pane, the tree has the sidebar", async ({
  page,
}) => {
  await openAccordionWorkspace(page);

  // The tree is the sidebar's.
  await header(page, "files").click();
  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar.getByTestId("files-tree")).toBeVisible();

  // Open the pane through its own door.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("files");
  await page.getByTestId("palette-row-pane:files").click();
  await expect(page.getByTestId("pane-files")).toBeVisible();

  // And the pane carries no tree, no drawer, no toggle — the viewer is the
  // whole pane. Red before the rework: the drawer rendered inside it.
  const pane = page.getByTestId("pane-files");
  await expect(pane.getByTestId("files-tree")).toHaveCount(0);
  await expect(pane.getByTestId("files-tree-drawer")).toHaveCount(0);
  await expect(pane.getByTestId("files-tree-toggle")).toHaveCount(0);

  // Clicking a file in the sidebar's tree lands it in the viewer — the same
  // show-file door Search and the Diff pane already use.
  await sidebar.getByTestId("files-row-src").click();
  await sidebar.getByTestId("files-row-src/greet.ts").click();
  await expect(page.getByTestId("files-viewer-path")).toHaveText(
    "src/greet.ts",
  );
});

test("tree state survives a collapse and a pane switch", async ({ page }) => {
  await openAccordionWorkspace(page);

  await header(page, "files").click();
  const sidebar = page.getByTestId("app-sidebar");
  await sidebar.getByTestId("files-row-src").click();
  await expect(sidebar.getByTestId("files-row-src/greet.ts")).toBeVisible();

  // Collapse Files by opening History; the tree's DOM is hidden, not
  // unmounted, so reopening finds `src` still expanded — no remount, no
  // re-listing, no lost state.
  await header(page, "history").click();
  await expect(header(page, "files")).toHaveAttribute("aria-expanded", "false");
  await header(page, "files").click();
  await expect(sidebar.getByTestId("files-row-src/greet.ts")).toBeVisible();

  // And a pane switch in the Deck does not touch the sidebar at all: the
  // sidebar is a sibling of the pane content, so the expansion survives.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("history");
  await page.getByTestId("palette-row-pane:history").click();
  await expect(page.getByTestId("pane-history")).toBeVisible();
  await expect(sidebar.getByTestId("files-row-src/greet.ts")).toBeVisible();
});

test("the Files tree follows a worktree switch made by another route", async ({
  page,
}) => {
  // The riskiest sequence: Files open, the worktree changes through ⌘K's
  // worktree row, and the tree re-scopes with Files staying open.
  await openAccordionWorkspace(page);
  await header(page, "files").click();
  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar.getByTestId("files-row-ONLY-IN-A.md")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("spike-b");
  await page
    .getByTestId(`palette-row-worktree:${WORKTREE_B.binding_id}`)
    .click();

  // Files stayed open; the tree is the new checkout's.
  await expect(header(page, "files")).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.getByTestId("files-row-ONLY-IN-B.md")).toBeVisible();
  await expect(sidebar.getByTestId("files-row-ONLY-IN-A.md")).toHaveCount(0);
});

test("one j, one owner: a keystroke moves exactly one cursor", async ({
  page,
}) => {
  // The plan's risk b: History's j/k used to be a window-level listener in the
  // pane. With the list in the sidebar and the patch in the pane, the sidebar
  // list is the ONLY owner — one press, one selection moved, nowhere else.
  await openAccordionWorkspace(page);
  await header(page, "history").click();
  const list = page.getByTestId("history-list");
  await expect(list).toBeVisible();
  await expect(
    page.getByTestId(`history-commit-${COMMITS[0].hash}`),
  ).toBeVisible();

  // Open a patch first, so the pane is mounted and would be racing for the
  // keystroke if a second listener survived there.
  await page.getByTestId(`history-commit-${COMMITS[0].hash}`).click();
  await expect(page.getByTestId("pane-history")).toBeVisible();
  await expect(page.getByTestId("history-patch-title")).toContainText(
    "First fixture commit",
  );

  // One j: the cursor steps to exactly one row — one selected row in the
  // whole History list, and it is the NEXT one. (Scoped to the list: the
  // collapsed Worktrees member legitimately keeps its own selected worktree
  // row in the hidden DOM — that is the state-survives-collapse guarantee,
  // not a second cursor.)
  await page.keyboard.press("j");
  const selected = list.locator('[aria-selected="true"]');
  await expect(selected).toHaveCount(1);
  await expect(
    page.getByTestId(`history-commit-${COMMITS[1].hash}`),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByTestId(`history-commit-${COMMITS[0].hash}`),
  ).toHaveAttribute("aria-selected", "false");
});

test("the inline chat lists hold the channels and DMs, and a channel row navigates", async ({
  page,
}) => {
  // The owner's amendment survives P1.1 with the fold removed: the chats are
  // right there on the Deck, below Projects, with nothing to open first.
  await openAccordionWorkspace(page);

  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar.getByTestId("stream-list")).toBeVisible();
  await expect(sidebar.getByTestId("dm-list")).toBeVisible();

  // A channel row navigates exactly as it does from the Inbox: same
  // onSelectChannel, same destination.
  await sidebar.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
});
