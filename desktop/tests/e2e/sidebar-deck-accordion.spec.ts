// The Deck sidebar since P4.1: the mockup's `.side` anatomy, and nothing
// else — the Projects tree rendered directly (no "Worktrees" accordion
// header, P1.1's owner veto 4), the channel/DM lists inline below it (no
// "Chats" header), and since P4.1 no deeper fold either: Files and History
// left for the dock, which owns both.
//
// Each test here is a red-proof for one of the claims:
//
// 1. **The anatomy, and only it.** Projects and the chat lists are on screen
//    with no fold to open, and there is no accordion in the sidebar at all —
//    no Files header, no History header, no shell around them. Red before
//    P1.1: four headers, Worktrees open, chats behind a fold. Red before
//    P4.1: the two deep members were still there.
// 2. **The tree has the dock, and the reading has the stage.** No tree
//    survives in the sidebar; the dock's Files tab carries the only one; and
//    clicking a file in it opens a TAB beside the shells rather than a viewer
//    inside the 376px card ("file'lara basinca yine terminalin oldugu yerde
//    tab gibi acilmali").
// 3. **The reading survives a pane switch; the browsing is re-read.** The open
//    file is a tab beside the shells, so it belongs to the worktree and not to
//    whatever panel the dock happens to be showing. The dock's tree is
//    remounted per visit, and the test says so rather than wishing otherwise.
// 4. **Worktree scope follows a switch made by another route** (⌘K): the tree
//    re-reads for the new checkout, and the old one's rows do not come across
//    under a new name.
// 5. **The inline chat lists** are the same channel/DM lists the Inbox shows,
//    and a channel row navigates exactly as it does from there.
//
// **One claim was retired with its subject, not dropped quietly.** The
// "one j, one owner" test proved that a single keystroke moved exactly one
// cursor while the sidebar's History list and the pane's patch were both on
// screen. P4.1 removed that list, so there is no second j/k listener left for
// a keystroke to be shared between: the risk the test guarded cannot arise
// because the surface that created it is gone.

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

test("the workspace sidebar is the mockup anatomy and nothing else", async ({
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

  // And since P4.1 there is no deeper fold either: Files and History left for
  // the dock, which owns both ("sol side bardaki history ve files kalkmali.
  // cok daha iyisi sag tarafa yapilacak"). With the last two members gone the
  // accordion shell went with them — a fold containing nothing is furniture.
  await expect(header(page, "files")).toHaveCount(0);
  await expect(header(page, "history")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-deck-accordion")).toHaveCount(0);
  await expect(
    page.locator('[data-testid^="sidebar-accordion-header-"]'),
  ).toHaveCount(0);

  // The anatomy that stays is still exactly one payload in the slot.
  await expect(page.getByTestId("sidebar-deck-sections")).toHaveCount(1);
});

test("the tree has the dock, and the reading has the stage", async ({
  page,
}) => {
  await openAccordionWorkspace(page);

  // There is no sidebar tree left to compete with it (P4.1 item 1).
  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar.getByTestId("files-tree")).toHaveCount(0);
  await expect(sidebar.getByTestId("dock-files-tree")).toHaveCount(0);

  // Open the pane through its own door.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("files");
  await page.getByTestId("palette-row-pane:files").click();
  const pane = page.getByTestId("dock-files");
  await expect(pane).toBeVisible();
  await expect(pane.getByTestId("dock-files-tree")).toBeVisible();
  // And none of the retired chrome came back with it.
  await expect(pane.getByTestId("files-tree-drawer")).toHaveCount(0);
  await expect(pane.getByTestId("files-tree-toggle")).toHaveCount(0);

  // Clicking a file opens it as a TAB beside the shells — the dock keeps the
  // tree, the stage gets the text ("file'lara basinca yine terminalin oldugu
  // yerde tab gibi acilmali"). The viewer is NOT inside the dock card.
  await pane.getByTestId("dock-files-row-src").click();
  await pane.getByTestId("dock-files-row-src/greet.ts").click();
  await expect(page.getByTestId("files-viewer-path")).toHaveText(
    "src/greet.ts",
  );
  await expect(pane.getByTestId("files-viewer")).toHaveCount(0);
  await expect(
    page.getByTestId("view-tab-select-file:src/greet.ts"),
  ).toBeVisible();
});

test("the reading survives a pane switch; the browsing is re-read", async ({
  page,
}) => {
  // **The durability that moved.** Before P4.1 the open file lived in whatever
  // pane was in the slot, so leaving that pane took the reading with it. Now
  // the reading is a TAB beside the shells — it belongs to the worktree, not
  // to the dock — and the dock is free to be a browser that re-lists.
  await openAccordionWorkspace(page);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("files");
  await page.getByTestId("palette-row-pane:files").click();
  const pane = page.getByTestId("dock-files");
  await pane.getByTestId("dock-files-row-src").click();
  await pane.getByTestId("dock-files-row-src/greet.ts").click();
  await expect(page.getByTestId("files-viewer-path")).toHaveText(
    "src/greet.ts",
  );

  // Change the dock to another panel entirely: the tab, and the file in it,
  // are still there — the dock is not where the reading lives.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("history");
  await page.getByTestId("palette-row-pane:history").click();
  await expect(page.getByTestId("dock-history")).toBeVisible();
  await expect(
    page.getByTestId("view-tab-select-file:src/greet.ts"),
  ).toBeVisible();
  await expect(page.getByTestId("files-viewer-path")).toHaveText(
    "src/greet.ts",
  );

  // And coming back to Files gives a freshly listed tree. **Stated rather than
  // wished for**: the dock's panel really is remounted per visit, so the folds
  // the owner opened are NOT carried across, and the honest claim is that the
  // root listing is right rather than that the expansion survived.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("files");
  await page.getByTestId("palette-row-pane:files").click();
  await expect(pane.getByTestId("dock-files-row-src")).toBeVisible();
});

test("the Files tree follows a worktree switch made by another route", async ({
  page,
}) => {
  // The riskiest sequence: Files open, the worktree changes through ⌘K's
  // worktree row, and the tree re-scopes.
  await openAccordionWorkspace(page);
  const files = async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("palette-input").fill("files");
    await page.getByTestId("palette-row-pane:files").click();
  };
  await files();
  const pane = page.getByTestId("dock-files");
  await expect(pane.getByTestId("dock-files-row-ONLY-IN-A.md")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("spike-b");
  await page
    .getByTestId(`palette-row-worktree:${WORKTREE_B.binding_id}`)
    .click();
  // Which panel the dock shows is per worktree (`paneModel.ts`'s layout is
  // keyed by binding id), and this checkout has never been arranged — so
  // asking for Files here is part of the gesture, not a workaround.
  await files();

  // The tree is the new checkout's, and the old one's rows are gone rather
  // than carried across under a new name — the failure this test exists for.
  await expect(pane.getByTestId("dock-files-row-ONLY-IN-B.md")).toBeVisible();
  await expect(pane.getByTestId("dock-files-row-ONLY-IN-A.md")).toHaveCount(0);
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
