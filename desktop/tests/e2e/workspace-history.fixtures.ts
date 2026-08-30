// The world `workspace-history.spec.ts` runs in: the invented repository, the
// three commits, the four status columns, and the stubs that make git say them.
// The spec beside this file is the readings taken of that world; this is the
// world.
//
// Split out of the spec for the two reasons `workspace-readme-shots.
// fixtures.ts` gives, and they are boundaries rather than tidiness. The first is
// the file ratchet — the spec had reached 1,000 lines, and the rule in this
// repository is a split and never a raise. The second is that the two halves
// change for different reasons: what is here moves when git's answers or the
// harness move, and the spec moves when what is worth asserting changes. The
// line between them is "what would have to be true for the pane to be on
// screen" versus "what is then true of it".
//
// **Nothing here is real.** The repository, its paths, the commits and their
// author are invented. The hashes are runs of one letter so a failure message
// says which commit it was about at a glance.
//
// Not registered in `playwright.config.ts`: every `testMatch` entry there is a
// literal spec basename, so a module sitting beside them is imported by the
// spec and never collected as a test. It declares no `test()` of its own.

import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/** Matches RunsScreen.tsx's hardcoded dev workspace id. */
export const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
export const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** The 16-inch MacBook Pro's default logical resolution — the machine every
 * complaint in this plan was made about. Kept the same as the Files and Search
 * specs' so the three panes are read at one width.
 *
 * **The viewport is load-bearing.** At 1728 the work surface is ~1195px and the
 * History pane ~435px, which is under `LIST_LEAVES_BELOW_PX`, so
 * `historyLayout` resolves to one-half-at-a-time: the list until he picks
 * something, then that thing's patch with the way back on the header. That is
 * the layout he will actually get, and a wider viewport would test one nobody
 * has. */
export const SIXTEEN_INCH = { height: 1117, width: 1728 };

/** Wide enough that the History pane clears `LIST_LEAVES_BELOW_PX` (466 + 176 =
 * 642px) and `historyLayout` resolves to `both` — the list beside the patch.
 *
 * **Two tests need this and the reason is not convenience.** At 16 inches the
 * pane shows one half at a time, so *clicking* a row replaces the list with that
 * row's patch. The things those tests are about — the cursor and the DOM focus
 * drifting apart after a click, and a refusal not being cached — need the list
 * to still be on screen afterwards to be observable at all; in the narrow
 * layout there is no second row to walk to and no highlight to read. So they are
 * read at the width where the failure would actually reach him: the external
 * display, both halves up. The layout is asserted rather than assumed, so a
 * viewport that stopped being wide enough fails loudly instead of quietly
 * testing the other layout again. */
export const EXTERNAL_DISPLAY = { height: 1440, width: 2560 };

/** How late one commit's `commit_diff` is allowed to be, in ms.
 *
 * **Every other stub in this file answers in the same tick, and that is what
 * made an out-of-order answer invisible to a browser.** In the product the two
 * reads are nothing alike: `commit_diff` runs one `git diff` per changed file
 * off-thread, so a four-hundred-file commit takes far longer than a two-file
 * one. Click the big one, click a small one, and without a generation guard the
 * big one's answer lands last and replaces the patch of the commit the
 * highlight is on — the header naming commit A while `aria-selected` sits on
 * commit B.
 *
 * 400ms: long enough that the second click certainly happens first (the click
 * and the assertion after it are a round trip through the page, measured in
 * single-digit ms), short enough that the test costs under a second. The spec
 * waits twice this before its last assertion, so the late answer has certainly
 * arrived and been dropped rather than merely not arrived yet — an assertion
 * made too early would pass against no guard at all. */
export const SLOW_COMMIT_MS = 400;

export const GIT_HOME = "/tmp/vingilot-history-home";
export const REPO = {
  id: "repo-history",
  name: "vingilot",
  path: "/tmp/vingilot-history",
};

export const WORKTREE = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-history",
  branch: "spike",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-history",
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
};

export const HEAD_HASH = "a".repeat(40);
export const OLDER_HASH = "b".repeat(40);
export const MERGE_HASH = "c".repeat(40);

/** Three commits, and each is a different case the pane has to draw: one with
 * refs on it, one plain, and a merge — whose patch carries the sentence saying
 * it is the first parent's and not the whole of what it joined. */
export const COMMITS = [
  {
    author: "Yusuf Birinci",
    date: "2026-08-12T02:18:33+03:00",
    hash: HEAD_HASH,
    refs: ["HEAD -> spike", "origin/spike"],
    short: "aaaaaaa",
    subject: "Read what git already knows",
  },
  {
    author: "Yusuf Birinci",
    date: "2026-08-11T23:04:00+03:00",
    hash: MERGE_HASH,
    refs: [],
    short: "ccccccc",
    subject: "Merge branch 'main' into spike",
  },
  {
    author: "Someone Else",
    date: "2026-08-10T09:30:00+03:00",
    hash: OLDER_HASH,
    refs: [],
    short: "bbbbbbb",
    subject: "The commit before all this",
  },
];

/** A patch with one of each line kind, so "the shared renderer drew it" can be
 * asserted as classified lines rather than as text that happens to be present. */
export const COMMIT_PATCH = `@@ -1,3 +1,4 @@
 context line
-was here
+is here now
+and this too
`;

/** The working tree's own patch, deliberately different text from the commit's:
 * an assertion that passed on either would not say which read produced it. */
export const FILE_PATCH = `@@ -1,2 +1,2 @@
 unchanged
-old working line
+new working line
`;

/** What git DID read of a file whose patch ran past the cap. **A cut patch is a
 * prefix, not an empty string** — which is the whole reason the pane has to show
 * the warning *and* the lines: showing only the warning throws these away. */
export const CUT_PATCH = `@@ -1,3 +1,4 @@
 lockfileVersion: 9.0
-old-resolution
+new-resolution
`;

export const STATUS = {
  conflicted: [],
  limit: 1000,
  omitted: 0,
  staged: [{ change: "added", code: "A.", oldPath: null, path: "src/new.rs" }],
  unstaged: [
    { change: "modified", code: ".M", oldPath: null, path: "src/a.rs" },
  ],
  untracked: [
    { change: "untracked", code: "??", oldPath: null, path: "notes.txt" },
  ],
};

/** Every verb that would mean this pane writes to a repository. The spec's scan
 * matches accessible names against these; the plan's line is that none of them
 * may appear. `Reread` and `Older` are the two controls the pane does have, and
 * both are reads. */
export const MUTATING =
  /\b(commit|stage|unstage|discard|revert|amend|rebase|push|pull|fetch|checkout|reset|restore|stash|merge|cherry|apply|delete|remove)\b/i;

// ---------------------------------------------------------------------------
// how the world above is put in front of the pane
// ---------------------------------------------------------------------------

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
};

export async function openHistoryWorkspace(
  page: Page,
  viewport: { height: number; width: number } = SIXTEEN_INCH,
) {
  await page.setViewportSize(viewport);
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
    ([
      home,
      commits,
      statusAnswer,
      commitPatch,
      filePatch,
      headHash,
      mergeHash,
      cutPatch,
      slowMs,
    ]: [
      string,
      typeof COMMITS,
      typeof STATUS,
      string,
      string,
      string,
      string,
      string,
      number,
    ]) => {
      const w = window as unknown as TrapWindow;
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;

      const knobs = w as unknown as {
        /** Hold the history read open, for the "no commits waits for git"
         * reading. */
        __LOG_HANGS__?: boolean;
        /** Answer with no commits at all — a repository that has been init'ed
         * and never committed, which the backend reports as an answer rather
         * than as a failure. */
        __LOG_EMPTY__?: boolean;
        /** Answer the first page short and say there is more, so `Older`,
         * `olderNote`, `appendPage` and the `before` argument `historyClient`
         * sends are all on the path. Without it every branch above answers
         * `more: false` and one of the pane's two controls is never drawn. */
        __LOG_MORE__?: boolean;
        /** …and refuse the second page ONCE, so BOTH halves of what the pane
         * distinguishes can be read: what a failed page costs (the page, not
         * the history already on screen), and that the refusal is CLEARED when
         * the page it belongs to is asked for again and answered. A refusal
         * that never retried left the second half untestable, so a stale
         * banner under a control that had since succeeded shipped green. */
        __PAGE_REFUSES__?: boolean;
        /** Refuse the FIRST `worktree_diff` and answer every one after it — a
         * lock file, a checkout gone for a moment. What must not happen is the
         * refusal being kept: the pane caches that read, and a cached refusal is
         * replayed for every later row. */
        __DIFF_FAILS_ONCE__?: boolean;
        /** The hash of one commit whose `commit_diff` answers LATE — see
         * `SLOW_COMMIT_MS`. Every other stub here resolves in the same tick,
         * which is exactly why no spec could see an out-of-order answer. */
        __SLOW_COMMIT__?: string;
      };
      let diffRefusalsLeft = 0;
      let pageRefusalsLeft = 0;

      const limits = {
        maxFiles: 400,
        maxPatchBytes: 262144,
        maxPatchLines: 2000,
        maxUntracked: 50,
      };

      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);

        if (name === "worktree_log") {
          if (knobs.__LOG_HANGS__ === true) return new Promise(() => {});
          if (knobs.__LOG_EMPTY__ === true) {
            return Promise.resolve({
              commits: [],
              cursor: null,
              limit: 200,
              more: false,
            });
          }
          if (knobs.__LOG_MORE__ === true) {
            const before = ((args ?? {}) as { before?: string }).before;
            if (before === undefined) {
              return Promise.resolve({
                commits: commits.slice(0, 2),
                cursor: commits[1]?.hash ?? null,
                limit: 200,
                more: true,
              });
            }
            // **The stub reads the argument, which is the point.** Nothing else
            // asserts the key `historyClient.ts` sends: renaming `before` to
            // `cursor` would break the real app and, against a stub that ignored
            // its arguments, fail nothing.
            if (before !== commits[1]?.hash) {
              return Promise.reject({
                command: "git log",
                kind: "git-failed",
                stderr: `the second page asked for "${String(before)}", not the hash of the last commit shown`,
              });
            }
            if (knobs.__PAGE_REFUSES__ === true) {
              if (pageRefusalsLeft === 0) {
                pageRefusalsLeft = 1;
                return Promise.reject({
                  command: "git log",
                  kind: "git-failed",
                  stderr: "fatal: unable to read the object store",
                });
              }
              // The retry, answered — and answered `more: true` deliberately.
              // The refusal banner is drawn INSIDE the same block as the
              // `Older` control, so a page that ended the list would take the
              // banner off screen along with it, and "the banner is gone" would
              // then be true of a pane that never cleared anything. One more
              // page keeps the block up, so the assertion is about the state
              // and not about the layout.
              return Promise.resolve({
                commits: commits.slice(2),
                cursor: commits[commits.length - 1]?.hash ?? null,
                limit: 200,
                more: true,
              });
            }
            return Promise.resolve({
              commits: commits.slice(2),
              cursor: commits[commits.length - 1]?.hash ?? null,
              limit: 200,
              more: false,
            });
          }
          return Promise.resolve({
            commits,
            cursor: commits[commits.length - 1]?.hash ?? null,
            limit: 200,
            more: false,
          });
        }

        if (name === "worktree_status") return Promise.resolve(statusAnswer);

        if (name === "commit_diff") {
          const hash = ((args ?? {}) as { commit?: string }).commit ?? "";
          const found = commits.find((c) => c.hash === hash);
          if (found === undefined) {
            return Promise.reject({ base: hash, kind: "unknown-base" });
          }
          const answer = {
            commit: found,
            diff: {
              additions: 2,
              base: `${hash}~1`,
              deletions: 1,
              // Three files, and the last two are the ones the pane used to
              // draw dishonestly: a binary file rendered as an empty box, and a
              // cut patch rendered with no sign it had been cut.
              files: [
                {
                  additions: 2,
                  binary: false,
                  change: "modified",
                  deletions: 1,
                  oldPath: null,
                  patch: commitPatch,
                  path: "src/read.rs",
                  truncated: false,
                },
                {
                  // What `commit_patch.rs` answers for a binary file: the flag,
                  // an empty patch, and counts of zero because lines are not the
                  // unit.
                  additions: 0,
                  binary: true,
                  change: "added",
                  deletions: 0,
                  oldPath: null,
                  patch: "",
                  path: "logo.png",
                  truncated: false,
                },
                {
                  additions: 2000,
                  binary: false,
                  change: "modified",
                  deletions: 1,
                  oldPath: null,
                  patch: cutPatch,
                  path: "pnpm-lock.yaml",
                  truncated: true,
                },
              ],
              limits,
              omittedFiles: 0,
              omittedUntracked: 0,
            },
            merge: hash === mergeHash,
            parent: hash === headHash ? mergeHash : `${hash}~1`,
          };
          if (knobs.__SLOW_COMMIT__ === hash) {
            return new Promise((resolve) => {
              setTimeout(() => resolve(answer), slowMs);
            });
          }
          return Promise.resolve(answer);
        }

        // The Diff pane's own read, which is where a source-control file's
        // patch comes from — one patch source, not a second grown for History.
        if (name === "worktree_diff") {
          if (knobs.__DIFF_FAILS_ONCE__ === true && diffRefusalsLeft === 0) {
            diffRefusalsLeft = 1;
            return Promise.reject({
              command: "git diff",
              kind: "git-failed",
              stderr: "fatal: Unable to create index.lock: File exists",
            });
          }
          return Promise.resolve({
            additions: 1,
            base: ((args ?? {}) as { base?: string }).base ?? "HEAD",
            deletions: 1,
            // All three status files, because the real `worktree_diff` lists
            // untracked files too (from `ls-files --others`, patched against
            // /dev/null) — a stub with only the modified one would make the
            // untracked row refuse for a reason the product does not have.
            files: [
              {
                additions: 1,
                binary: false,
                change: "modified",
                deletions: 1,
                oldPath: null,
                patch: filePatch,
                path: "src/a.rs",
                truncated: false,
              },
              {
                // Cut, deliberately: this is the source-control half of the
                // same claim the commit view makes — the warning and the lines,
                // never the warning instead of them.
                additions: 1,
                binary: false,
                change: "added",
                deletions: 0,
                oldPath: null,
                patch: "@@ -0,0 +1 @@\n+brand new\n",
                path: "src/new.rs",
                truncated: true,
              },
              {
                additions: 1,
                binary: false,
                change: "untracked",
                deletions: 0,
                oldPath: null,
                patch: "@@ -0,0 +1 @@\n+a note to self\n",
                path: "notes.txt",
                truncated: false,
              },
            ],
            limits,
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
    [
      GIT_HOME,
      COMMITS,
      STATUS,
      COMMIT_PATCH,
      FILE_PATCH,
      HEAD_HASH,
      MERGE_HASH,
      CUT_PATCH,
      SLOW_COMMIT_MS,
    ] as const,
  );

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  // Since P1.1 the Projects tree renders directly — no "Worktrees" accordion
  // header to open first (owner veto 4; `sidebar-deck-accordion.spec.ts` is
  // the living idiom). The repo row is on screen from the first paint, a
  // second `goto` in the same test included.
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await page.getByTestId(`worktree-row-${WORKTREE.binding_id}`).click();
}

/** The pane, opened the way he opens it: the palette. It has no chord of its
 * own — Search is the only pane in the table that does, because Search is the
 * only one he left the app for. */
export async function openHistoryPane(page: Page) {
  // The lists live in the Deck sidebar's History accordion member now
  // (pane-nav-absorb plan, Task 5); the pane holds the shared patch box.
  // Opening both is the whole gesture the old single-component pane was.
  await page.getByTestId("sidebar-accordion-header-history").click();
  await expect(page.getByTestId("history-list")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.getByTestId("palette-input").fill("history");
  await page.getByTestId("palette-row-pane:history").click();
  // Since P3 the History surface is the dock's History tab (`pane-history`
  // and the old PanePicker chrome are retired — `dock.spec.ts`'s idiom).
  await expect(page.getByTestId("dock-history")).toBeVisible();
}

/** Every control the pane OFFERS, by its accessible name. Read out of the real
 * DOM rather than listed, because the claim is about what is THERE.
 *
 * **`[role="option"]` is excluded, and the exclusion is the careful part.** The
 * rows are buttons too, but a row's text is git's own data: a commit subject may
 * contain any word in the language, and this repository's own history has
 * "Merge branch…" and "Revert…" in it. Matching verbs against row text would
 * fail on the owner's real commits rather than on anything about this pane's
 * design — a test that goes red for the wrong reason. A row is a *selection*,
 * not an act; what the scan is about is the controls beside the rows. The
 * separate assertion that no row CONTAINS a control is what keeps the
 * VS Code-shaped failure — a stage button inside the row — from slipping
 * through this exclusion. */
export async function controlNames(page: Page): Promise<string[]> {
  // Both halves of what used to be one pane: the patch box that is the
  // dock's History tab (`dock-history`, since P3) AND the sidebar-hosted
  // status/commit lists — the plan is explicit that the mutating-verb rule
  // must not leak back in through the sidebar's copy of the list
  // (pane-nav-absorb §5).
  return page
    .locator('[data-testid="dock-history"], [data-testid="history-list"]')
    .locator("button:not([role='option']), input, [role='menuitem'], a[href]")
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        [
          node.getAttribute("aria-label") ?? "",
          node.getAttribute("title") ?? "",
          node.textContent ?? "",
        ].join(" "),
      ),
    );
}
