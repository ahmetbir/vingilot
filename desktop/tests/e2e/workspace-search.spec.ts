// ⇧⌘F, proved against a real render
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 2).
//
// > *"bugün işte ne için vscode açtım biliyor musun. projede cmd shift f yapıp
// > bir şey bulmak için."*
//
// `searchModel.test.mjs` says how hits group, which characters are the match,
// what each refusal reads as, and — the rule Task 2 puts hardest — that "no
// matches" is only reachable from an answer. `searchKeys.test.mjs` says what
// the chord means. All of that is pure and none of it needs a browser.
//
// **What only a browser can say is that any of it reaches him.** Five things,
// and each has been a real failure mode in this island or in this app:
//
// - **The chord ARRIVES.** A claimant check is a reading of source; ⌘W was lost
//   for want of a press. It is pressed here over an open project with a real
//   terminal mounted, which is where he presses it — and upstream's ⌘F
//   find-in-this-channel is asserted still to work on the screen it belongs to,
//   because "we took the shifted one" is a claim about two handlers and only a
//   document can say which got the key.
// - **Results are grouped, and Enter lands in the VIEWER at the line.** The
//   door is the Files pane's (files-pane design §6) and this spec drives it
//   through the real route rather than a fabricated event: a spec that
//   dispatched its own channel would prove the pane can be told and nothing
//   about whether anything tells it.
// - **The cap sentence is on screen when the answer is capped.** A search that
//   silently truncates is a search that lies about what is in the repository —
//   a sentence that is correct in a model and never rendered is exactly that
//   failure with an extra step.
// - **git's refusal is verbatim.** The whole point of passing it through is
//   that he reads git's words; a build that paraphrased them would look
//   identical to one that did not, from any unit test.
// - **"no matches" is not said before git answers.** The model refuses to
//   produce it; this asserts the pane really shows the waiting sentence during
//   a search that has not come back, which is the only place the distinction is
//   visible.
//
// `worktree_search` is stubbed through the same `addInitScript` property trap
// `workspace-one-column.spec.ts` and `workspace-files.spec.ts` document: the
// bridge assigns `invoke` during boot and the home-directory lookup runs on the
// first render, so an override installed after boot is too late. Stubbed rather
// than run against a real checkout because what is under test is the pane —
// real git would make every assertion a property of whatever happened to be in
// a temp directory, and `vingilot_search`' own cargo tests already drive the
// real binary against a real repository.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** The 16-inch MacBook Pro's default logical resolution — the machine every
 * complaint in this plan was made about. Kept the same as the Files spec's so
 * the two panes are read at one width. */
const SIXTEEN_INCH = { height: 1117, width: 1728 };

const GIT_HOME = "/tmp/vingilot-search-home";
const REPO = {
  id: "repo-search",
  name: "vingilot",
  path: "/tmp/vingilot-search",
};

const WORKTREE = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-search",
  branch: "spike",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-search",
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
};

/** A second checkout, and it exists for exactly one assertion: every path in an
 * answer is relative to *this* worktree, so results may not survive a switch to
 * another one. */
const OTHER_WORKTREE = {
  ...WORKTREE,
  binding_id: "wt-search-other",
  branch: "other",
  owner_run_id: "run-search-other",
};

/** The file the search lands in, and the file the viewer then opens. Small
 * enough to be highlighted, so the marked line is found in upstream's own
 * `data-line` spans. */
const GREET_TS = `export function greet(name: string): string {
  const needle = name;
  return \`hello \${needle}\`;
}
`;

const OTHER_TS = `export const needle = 0;
`;

/** Deliberately not line 1, and deliberately in the SECOND group: a landing
 * that ignored the line, or one that opened whatever came first, would pass a
 * test that used either. */
const HIT_LINE = 2;

const FILES: Record<string, string> = {
  "src/greet.ts": GREET_TS,
  "src/other.ts": OTHER_TS,
};

/** What `worktree_search` answers for "needle": two files, three lines, so the
 * grouping has something to group. Columns are 0-based character offsets, as
 * the backend converts them. */
const HITS = [
  {
    clipped: false,
    column: 8,
    line: HIT_LINE,
    path: "src/greet.ts",
    text: "  const needle = name;",
  },
  {
    clipped: false,
    column: 16,
    line: 3,
    path: "src/greet.ts",
    text: "  return `hello ${needle}`;",
  },
  {
    clipped: false,
    column: 13,
    line: 1,
    path: "src/other.ts",
    text: "export const needle = 0;",
  },
];

/** git's own words for a regex it will not compile, kept exactly as the binary
 * writes them (measured: `git grep -E -e '['`). */
const GIT_BRACKET_REFUSAL =
  "fatal: -e option, '[': brackets ([ ]) not balanced\n";

/** The answer that exhausts `searchModel.ts`'s emphasis budget in one render
 * pass, and the pattern it is searched with.
 *
 * `(a+)+b` is one of the catastrophic patterns `REGEX_WINDOW` was measured
 * against. On `BUDGET.fast` it matches `aaab` immediately, so the first row is
 * emphasised; on `BUDGET.slow` — longer than the 16-character window, and with
 * no `b` in it — it backtracks the whole window away and returns nothing.
 * Measured with this repository's own node (the same V8 the webview runs), one
 * such failure costs **0.21 ms**, so the 20 ms per-pass budget is gone after
 * about 96 of them; `BUDGET_ROWS` is five times that, which is the margin that
 * keeps this a statement about the design rather than about the machine's mood. */
const BUDGET = { fast: "aaab tail", slow: "a".repeat(24) };
const BUDGET_PATTERN = "(a+)+b";
const BUDGET_ROWS = 500;

/** `SearchPane.tsx`'s own `DEBOUNCE_MS`, repeated here because the spec below
 * has to type a whole word inside it for the assertion to mean anything. */
const DEBOUNCE_MS = 200;

function lineOf(text: string, line: number): string {
  return text.split("\n")[line - 1].trim();
}

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
};

async function openSearchWorkspace(page: Page) {
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
      return route.fulfill({ json: { worktrees: [WORKTREE, OTHER_WORKTREE] } });
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
    ([home, hits, files, refusal, budget]: [
      string,
      typeof HITS,
      Record<string, string>,
      string,
      typeof BUDGET,
    ]) => {
      const w = window as unknown as TrapWindow;
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;

      // Knobs the tests below turn, set on `window` so a test can change what
      // the next search does without reloading the app.
      const knobs = w as unknown as {
        /** Every pattern this stub was asked for, in order. **The record that
         * makes the debounce a bound rather than a comment**: how many times
         * git was asked is not visible on screen, and a field that searched
         * per keystroke would draw exactly the same results as one that
         * waited. */
        __SEARCH_ASKED__?: string[];
        __SEARCH_CAPPED__?: boolean;
        __SEARCH_HANGS__?: boolean;
        /** Hold the NEXT search open, and hand back the way to let it land.
         * The only way to stage two searches overlapping, which is the race
         * the pane's `asked` counter exists for. */
        __SEARCH_HOLD_NEXT__?: boolean;
        /** Answer with this many unmatchable lines after one that matches, so
         * one render pass really does exhaust the emphasis budget. */
        __SEARCH_MANY__?: number;
        __SEARCH_RELEASE__?: () => void;
      };
      knobs.__SEARCH_ASKED__ = [];

      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);
        if (name === "worktree_search") {
          const asked = (args ?? {}) as {
            pattern?: string;
            regex?: boolean;
            worktree?: string;
          };
          const pattern = asked.pattern ?? "";
          knobs.__SEARCH_ASKED__?.push(pattern);
          // A search that never answers, for the "still searching" reading.
          if (knobs.__SEARCH_HANGS__ === true) return new Promise(() => {});
          // The bracket is what a real `git grep -E` refuses, and the refusal
          // is git's own bytes.
          if (pattern.includes("[")) {
            return Promise.reject({
              command: "git grep --no-color -n --column -I -z -E -e [ --",
              kind: "git-failed",
              stderr: refusal,
            });
          }
          const many = knobs.__SEARCH_MANY__;
          const answer = {
            capped: knobs.__SEARCH_CAPPED__ === true,
            hits:
              typeof many === "number"
                ? // One line the owner's pattern matches at once, then `many`
                  // it can only fail on — which is where the emphasis budget
                  // actually goes.
                  [
                    {
                      clipped: false,
                      column: 0,
                      line: 1,
                      path: "src/fast.ts",
                      text: budget.fast,
                    },
                    ...Array.from({ length: many }, (_unused, at) => ({
                      clipped: false,
                      column: 0,
                      line: at + 1,
                      path: "src/slow.ts",
                      text: budget.slow,
                    })),
                  ]
                : hits.filter((hit) => hit.text.includes(pattern)),
            limit: 2000,
            pattern,
            regex: asked.regex === true,
          };
          if (knobs.__SEARCH_HOLD_NEXT__ === true) {
            // Only this one: a later, faster search has to be able to answer
            // while this one is still in the air, which is the whole point.
            knobs.__SEARCH_HOLD_NEXT__ = false;
            return new Promise((resolve) => {
              knobs.__SEARCH_RELEASE__ = () => resolve(answer);
            });
          }
          return Promise.resolve(answer);
        }
        if (name === "file_read") {
          const path = ((args ?? {}) as { path?: string }).path ?? "";
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
            lines: text.replace(/\n$/, "").split("\n").length,
            path,
            text,
          });
        }
        if (name === "worktree_tree") {
          return Promise.resolve({
            dir: ((args ?? {}) as { dir?: string }).dir ?? "",
            entries: [{ kind: "directory", name: "src", size: null }],
            limit: 2000,
            truncated: false,
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
    [GIT_HOME, HITS, FILES, GIT_BRACKET_REFUSAL, BUDGET] as const,
  );

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await page.getByTestId(`worktree-row-${WORKTREE.binding_id}`).click();
}

/** The pane, opened the way he opens it. **The chord, not the palette** — that
 * is the thing under test here and the thing a claimant check cannot establish. */
async function openSearchPane(page: Page) {
  await page.keyboard.press("Shift+ControlOrMeta+f");
  await expect(page.getByTestId("pane-search")).toBeVisible();
}

test("⇧⌘F arrives, and ⌘F is still upstream's find-in-this-channel", async ({
  page,
}) => {
  // KNOWN RED, not P3's: upstream PR #5306 deleted `ChannelFindBar` /
  // `useChannelFind` outright, and this test (and `workspace-find.spec.ts`'s
  // "the ⌘F boundary…") have been its red proofs since before this redesign
  // — do not spend a P3-scoped fix round chasing it.
  //
  // Worth keeping for whoever restores the bar: this test never touches the
  // dock or the Team pane at all — the ⌘F below is pressed on the STANDALONE
  // `/channels/general` route, reached by the sidebar click above. At the
  // moment `channel-find-bar` fails to appear, the accessibility snapshot
  // has collapsed to almost nothing (`status` and a notifications region,
  // none of the channel screen's own chrome) — that reads as a crash on this
  // route around the ⌘F keydown, not a missing component quietly doing
  // nothing. Start from that hypothesis rather than re-deriving it from a
  // bare "element not found".
  //
  // **The half a claimant check cannot give.** ⌘W was lost to an unchecked
  // claimant once, silently, because macOS resolved it before the webview saw
  // anything — so a chord is only taken when a press proves it landed.
  await openSearchWorkspace(page);
  await expect(page.getByTestId("pane-search")).toHaveCount(0);
  await openSearchPane(page);
  // And the field has the keyboard, which is the whole point of a chord that
  // opens a search: ⇧⌘F then typing has to work with no click in between.
  await expect(page.getByTestId("search-input")).toBeFocused();

  // The other half of the claim, and it is about a feature this task must not
  // have broken: the unshifted chord still belongs to upstream's find bar, on
  // the screen that owns it. Asserted on /channels rather than here, because
  // that is where the bar exists.
  // Reached by clicking the sidebar rather than by a `goto`, which is how the
  // rest of this repository's specs open a channel and what makes the screen
  // under it a real mount rather than a route that has not resolved. Since
  // P1.1 the channel rows render inline on the Deck's first screen (owner
  // veto 4 removed the "Chats" fold — `sidebar-deck-accordion.spec.ts` is the
  // living idiom), so no header opens first.
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("message-input").first()).toBeVisible();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.getByTestId("channel-find-bar")).toBeVisible();
});

test("the Search pane is on the registry — the palette offers it, named where a tab would light, with its chord", async ({
  page,
}) => {
  // A claim about the registry rather than about this pane: a component added
  // to the tree without being added to `PANE_IDS` is a pane that renders and
  // that he cannot reach. The chord beside the row is what makes the palette a
  // place he learns the shortcut rather than a second way of doing it forever.
  //
  // The dock's six tabs are a closed set and Search is not one of them
  // (`dockModel.ts`), so the retired PanePicker's "also offered from the
  // dropdown" half of this claim has no dock equivalent to keep — the
  // palette is now the only door. What the dock DOES still owe Search is its
  // name where a tab would be lit (`dock-pane-label`), which is what stands
  // in for "the picker agrees" here.
  await openSearchWorkspace(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.getByTestId("palette-input").fill("search");
  const row = page.getByTestId("palette-row-pane:search");
  await expect(row).toBeVisible();
  await expect(row).not.toHaveAttribute("data-blocked", "true");
  await expect(row).toContainText("⇧");
  await expect(row).toContainText("F");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("palette")).toBeHidden();
  await expect(page.getByTestId("pane-search")).toBeVisible();
  await expect(page.getByTestId("dock-pane-label")).toHaveText("Search");
});

test("results arrive grouped by file, with the match emphasised", async ({
  page,
}) => {
  await openSearchWorkspace(page);
  await openSearchPane(page);

  // Before anything is typed the pane says what it is, and does NOT say there
  // are no matches — nothing has been asked.
  await expect(page.getByTestId("search-idle")).toBeVisible();
  await expect(page.getByTestId("search-empty")).toHaveCount(0);

  await page.getByTestId("search-input").fill("needle");

  // Grouped: one heading per file, the hits under it, in git's own order.
  await expect(page.getByTestId("search-file-src/greet.ts")).toBeVisible();
  await expect(page.getByTestId("search-file-src/other.ts")).toBeVisible();
  await expect(
    page.getByTestId("search-results").getByRole("option"),
  ).toHaveCount(HITS.length);

  // The line number and the line's own text are both on the row — a result
  // with no text is a result he has to open to find out about.
  const first = page.getByTestId(`search-hit-${HIT_LINE}:src/greet.ts`);
  await expect(first).toContainText("const needle = name;");
  await expect(first).toContainText(String(HIT_LINE));

  // And the match is emphasised where git said it is, rather than the whole
  // line being bold or nothing being.
  await expect(first.getByTestId("search-hit-match")).toHaveText("needle");
});

test("Enter lands in the Files viewer, at the line", async ({ page }) => {
  // **The door, through the route the files-pane design built for it** (§6).
  // Driven through the real Enter rather than a fabricated event: a spec that
  // dispatched its own channel would prove the Files pane can be told and
  // nothing about whether the search tells it.
  await openSearchWorkspace(page);
  await openSearchPane(page);
  await page.getByTestId("search-input").fill("needle");
  await expect(page.getByTestId("search-file-src/greet.ts")).toBeVisible();

  // The first hit is selected as the answer lands, so Enter straight after
  // typing opens something — but this test walks to the SECOND file's hit,
  // because a landing that opened whatever came first would pass either way.
  const target = page.getByTestId("search-hit-1:src/other.ts");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(target).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  // The Files pane is brought forward — it was not on screen a moment ago.
  await expect(page.getByTestId("dock-files")).toBeVisible();
  await expect(page.getByTestId("files-viewer-path")).toHaveText(
    "src/other.ts",
  );

  // Now the same gesture on a hit that is NOT line 1, which is the half that
  // makes this a landing rather than a label.
  await openSearchPane(page);
  await page.getByTestId("search-input").fill("needle");
  await expect(page.getByTestId("search-file-src/greet.ts")).toBeVisible();
  await page.getByTestId(`search-hit-${HIT_LINE}:src/greet.ts`).click();

  await expect(page.getByTestId("dock-files")).toBeVisible();
  await expect(page.getByTestId("files-viewer-path")).toHaveText(
    "src/greet.ts",
  );
  // Read as the line's own TEXT rather than as a number, because an off-by-one
  // in either direction is still a number.
  await expect(page.getByTestId("files-viewer-marked-line")).toHaveText(
    lineOf(GREET_TS, HIT_LINE),
  );
  await expect(page.getByTestId("files-viewer-marked-line")).toBeInViewport();
});

test("a capped answer says so, over the results it did return", async ({
  page,
}) => {
  // "A search that silently truncates is a search that lies about what is in
  // the repo" — Task 2's own sentence. The model produces the words; this is
  // the assertion that they are drawn, which is the failure mode this island
  // has already had with a refusal.
  await openSearchWorkspace(page);
  await page.evaluate(() => {
    (window as unknown as { __SEARCH_CAPPED__: boolean }).__SEARCH_CAPPED__ =
      true;
  });
  await openSearchPane(page);
  await page.getByTestId("search-input").fill("needle");

  const capped = page.getByTestId("search-capped");
  await expect(capped).toBeVisible();
  // It counts what he got rather than repeating the limit, so the sentence and
  // the list on screen cannot contradict each other.
  await expect(capped).toContainText(`stopped at ${HITS.length} matches`);
  await expect(capped).toContainText("there are more");
  // And the results are still there — a cap is not an error.
  await expect(
    page.getByTestId("search-results").getByRole("option"),
  ).toHaveCount(HITS.length);
});

test("git's refusal is on screen in git's own words", async ({ page }) => {
  // The whole point of passing it through. A build that paraphrased "brackets
  // ([ ]) not balanced" into "invalid pattern" would look identical from every
  // unit test that only asked whether *something* was said.
  await openSearchWorkspace(page);
  await openSearchPane(page);
  await page.getByTestId("search-regex-toggle").click();
  await page.getByTestId("search-input").fill("[");

  const refused = page.getByTestId("search-refused");
  await expect(refused).toBeVisible();
  await expect(refused).toContainText(GIT_BRACKET_REFUSAL.trim());
  // Not a results list, and not "no matches" — git refused, it did not answer.
  await expect(page.getByTestId("search-empty")).toHaveCount(0);
  await expect(page.getByTestId("search-results")).toHaveCount(0);
});

test("a slow search's answer never lands under the query he has moved on to", async ({
  page,
}) => {
  // **The race the `asked` counter exists for, staged.** On the owner's
  // monorepo a first `git grep` can easily land after a faster second one; a
  // pane that rendered whichever answer arrived last would show one query's
  // rows under another's name, with the emphasis measured against the wrong
  // pattern. Both the backend echoing `pattern` back and the counter in the
  // pane are there for this, and nothing pressed on it until now.
  await openSearchWorkspace(page);
  await openSearchPane(page);
  await page.evaluate(() => {
    (
      window as unknown as { __SEARCH_HOLD_NEXT__: boolean }
    ).__SEARCH_HOLD_NEXT__ = true;
  });

  // The first search goes out and is held open — confirmed on screen, so the
  // second one really is typed while this one is still in the air.
  await page.getByTestId("search-input").fill("needle");
  await expect(page.getByTestId("search-searching")).toContainText("needle");

  // He types on. This one answers immediately, with nothing to show.
  await page.getByTestId("search-input").fill("nothinglikethis");
  await expect(page.getByTestId("search-empty")).toBeVisible();

  // Now the first search finally answers, with three real hits.
  await page.evaluate(() => {
    (
      window as unknown as { __SEARCH_RELEASE__: () => void }
    ).__SEARCH_RELEASE__();
  });

  // And it is dropped, because it is an answer to a question he has left. The
  // screen still belongs to the query in the field.
  await expect(page.getByTestId("search-empty")).toBeVisible();
  await expect(page.getByTestId("search-results")).toHaveCount(0);
  await expect(page.getByTestId("search-input")).toHaveValue("nothinglikethis");
});

test("⇧⌘F pressed while the pane is already up puts him back in the field", async ({
  page,
}) => {
  // **The reason this chord has two listeners rather than one.** The host's
  // chooses the pane, which is a no-op when it is already chosen; the pane's
  // own re-focuses the field. Without a press taken with the pane up and the
  // focus elsewhere, either listener could be deleted as a duplicate and every
  // test would stay green.
  await openSearchWorkspace(page);
  await openSearchPane(page);
  await page.getByTestId("search-input").fill("needle");
  await expect(page.getByTestId("search-file-src/greet.ts")).toBeVisible();

  // Focus somewhere else in the pane — the pane stays mounted, so the
  // mount-time focus effect cannot be what does the work here.
  await page.getByTestId("search-regex-toggle").click();
  await expect(page.getByTestId("search-input")).not.toBeFocused();

  await page.keyboard.press("Shift+ControlOrMeta+f");
  await expect(page.getByTestId("pane-search")).toBeVisible();
  await expect(page.getByTestId("search-input")).toBeFocused();
  // And the query is selected, so the next thing he types replaces it — which
  // is the gesture he actually means by pressing it a second time.
  const selected = await page
    .getByTestId("search-input")
    .evaluate((node: HTMLInputElement) =>
      node.value.slice(node.selectionStart ?? 0, node.selectionEnd ?? 0),
    );
  expect(selected).toBe("needle");
});

test("switching worktrees takes the results with it, rather than offering them under the new name", async ({
  page,
}) => {
  // Every path in an answer is relative to the checkout it was found in, so
  // carrying a list across a switch would offer him the other worktree's
  // `src/greet.ts` under this one's name — and a row clicked afterwards is a
  // `file_read` against the wrong checkout.
  //
  // **Both worktrees are given the Search pane first, and that is what makes
  // this a test.** A pane layout is kept per worktree, so switching to one that
  // has some *other* pane chosen unmounts this one and clears it for free. The
  // case the remount guards is the one where the pane stays on screen across
  // the switch and only its `cwd` changes.
  await openSearchWorkspace(page);
  await openSearchPane(page);

  await page.getByTestId(`worktree-row-${OTHER_WORKTREE.binding_id}`).click();
  await openSearchPane(page);
  await page.getByTestId("search-input").fill("needle");
  await expect(
    page.getByTestId("search-results").getByRole("option"),
  ).toHaveCount(HITS.length);

  // Back to the first checkout, which also has the Search pane chosen — so the
  // pane is never taken off screen and nothing but the remount can clear it.
  await page.getByTestId(`worktree-row-${WORKTREE.binding_id}`).click();
  await expect(page.getByTestId("pane-search")).toBeVisible();
  await expect(page.getByTestId("search-input")).toHaveValue("");
  await expect(page.getByTestId("search-idle")).toBeVisible();
  await expect(page.getByTestId("search-results")).toHaveCount(0);
});

test('"no matches" waits for git, and an unanswered search says it is still looking', async ({
  page,
}) => {
  // **The rule Task 2 puts hardest, read where it is visible.** The model
  // refuses to produce "no matches" from anything but an answer; what a browser
  // adds is that the pane really shows the waiting sentence in the meantime,
  // instead of an empty list that reads as "there is nothing there".
  await openSearchWorkspace(page);
  await page.evaluate(() => {
    (window as unknown as { __SEARCH_HANGS__: boolean }).__SEARCH_HANGS__ =
      true;
  });
  await openSearchPane(page);
  await page.getByTestId("search-input").fill("needle");

  const searching = page.getByTestId("search-searching");
  await expect(searching).toBeVisible();
  await expect(searching).toContainText("needle");
  await expect(page.getByTestId("search-empty")).toHaveCount(0);
  await expect(page.getByTestId("search-results")).toHaveCount(0);

  // Let the next search answer, with a pattern nothing matches. NOW the pane
  // is entitled to say it.
  await page.evaluate(() => {
    (window as unknown as { __SEARCH_HANGS__: boolean }).__SEARCH_HANGS__ =
      false;
  });
  await page.getByTestId("search-input").fill("nothinglikethis");
  await expect(page.getByTestId("search-empty")).toBeVisible();
  await expect(page.getByTestId("search-empty")).toHaveText("no matches.");
});

test("a word typed at speed is ONE search, not one per character", async ({
  page,
}) => {
  // **The debounce, made a bound rather than a comment.** Every other spec in
  // this file drives the field with `fill`, which sets the value in one shot —
  // under which a pane that asked git per keystroke draws exactly the same
  // results as one that waits, so deleting the timer was invisible to all of
  // them. What it costs him is not visible on screen either: each keystroke
  // that reached the backend is a `git grep` over the whole monorepo, started
  // and thrown away. So this one types, and counts what the backend was asked.
  await openSearchWorkspace(page);
  await openSearchPane(page);

  const started = Date.now();
  await page
    .getByTestId("search-input")
    .pressSequentially("needle", { delay: 10 });
  const typedIn = Date.now() - started;
  // The premise, asserted rather than assumed: if the six keystrokes did not
  // fit inside one debounce window then two searches are correct behaviour and
  // the count below would be a statement about this machine, not about the
  // pane.
  expect(typedIn).toBeLessThan(DEBOUNCE_MS);

  // The answer is on screen, so git has been asked at least once and the
  // record below is complete.
  await expect(page.getByTestId("search-file-src/greet.ts")).toBeVisible();
  await expect(
    page.getByTestId("search-results").getByRole("option"),
  ).toHaveCount(HITS.length);

  // And it was asked exactly once, for the whole word. Without the timer this
  // reads ["n", "ne", "nee", "need", "needl", "needle"].
  const asked = await page.evaluate(
    () =>
      (window as unknown as { __SEARCH_ASKED__: string[] }).__SEARCH_ASKED__,
  );
  expect(asked).toEqual(["needle"]);
});

test("emphasis survives arrow keys down a long answer, because the budget is per render pass", async ({
  page,
}) => {
  // **The one thing that keeps a 2,000-row answer readable while he walks it.**
  // `searchModel.ts` bounds the second regex engine with a wall-clock budget,
  // and `SearchPane.tsx` builds a fresh measurer on every render pass so that
  // budget is per pass. Memoise it — which looks like an obvious win, and is
  // the mutation this test exists to catch — and the budget is spent once, on
  // the first draw; every later render of the same answer, which is every
  // arrow key, silently draws the whole list plain.
  //
  // Nothing but a real render can say this: the model's own tests drive the
  // measurer directly with an injected clock and never render, and every other
  // spec here serves three hits, which cannot exhaust a 20 ms budget at any
  // window size.
  await openSearchWorkspace(page);
  await page.evaluate((rows) => {
    (window as unknown as { __SEARCH_MANY__: number }).__SEARCH_MANY__ = rows;
  }, BUDGET_ROWS);
  await openSearchPane(page);
  await page.getByTestId("search-regex-toggle").click();
  await page.getByTestId("search-input").fill(BUDGET_PATTERN);

  // The first row matches at once and is emphasised; the rest of the answer is
  // what spends the budget, and is drawn plain because this pattern cannot
  // match it at all.
  const first = page.getByTestId("search-hit-1:src/fast.ts");
  await expect(first.getByTestId("search-hit-match")).toHaveText("aaab");
  await expect(page.getByTestId("search-hit-match")).toHaveCount(1);

  // Four arrow keys — four more render passes of the same answer, each of
  // which has to measure the first row again from a budget of its own.
  for (let press = 0; press < 4; press += 1) {
    await page.keyboard.press("ArrowDown");
  }
  await expect(page.getByTestId("search-hit-4:src/slow.ts")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(first.getByTestId("search-hit-match")).toHaveText("aaab");
});
