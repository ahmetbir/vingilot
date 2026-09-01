// ⌘F in the thing he is looking at, proved against a real render
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 1).
//
// > *"cmd F"* — one of the four gestures VS Code trained into him that this app
// > answered with nothing.
//
// `findInFile.test.mjs` owns the match model: smart case (in his alphabet as well
// as in ASCII), the count, the wrap-around, and the arithmetic that puts the
// amber on the right characters of a line whichever way that line was drawn.
// `findKeys.test.mjs` owns what each key means. None of that needs a browser.
//
// **Four readings only a browser can give, and each has been a real failure mode
// in this island:**
//
// 1. **The chord ARRIVES.** ⌘F is upstream's — `useChannelFind` binds it on the
//    window — so this island takes it in the capture phase, inside one pane,
//    and gives it back everywhere else. A claimant check is a reading of source,
//    and ⌘W was lost to an unchecked claimant once, silently. So it is pressed.
// 2. **The amber is on the TEXT, on both render paths.** Task 0 made the viewer
//    render Shiki's tokens, whose boundaries are the grammar's; a find that
//    walked those spans would answer a different count before and after the
//    background tokenise landed, and would miss any match straddling two tokens.
//    Read on `greet.ts` (highlighted, `data-highlighted="true"` asserted first,
//    so this is genuinely the tokenised body) and on `trace.log` (plain), which
//    are the viewer's two different code paths.
// 3. **The walk moves the viewer.** `toHaveText` does not require an element to
//    be in view — the same hole that left every Files spec green while the marked
//    line sat hundreds of lines below the fold — so the far match is asserted
//    `toBeInViewport()`.
// 4. **⌘F still reaches upstream's find-in-this-channel.** Not on
//    `/channels/general` (that is `workspace-search.spec.ts`'s reading, and it is
//    about the shifted chord) but **inside the workspace**, over the Team pane,
//    which hosts `ChannelRouteScreen` itself. That is the screen where both
//    handlers are live at once, and it is the one place where a capture-phase
//    listener that claimed too much would take a working feature away without
//    anything failing.
//
// The commands are stubbed through the property trap `workspace-one-column.spec.ts`
// documents: the bridge assigns `invoke` during boot and the home-directory lookup
// runs on the first render, so an override installed after boot is too late.
// Everything this spec does not answer for falls through to the mock bridge,
// which is what lets one harness serve both the Files pane and a real hosted
// channel.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** The 16-inch MacBook Pro's own logical resolution — the machine every
 * complaint in this plan was made about, and the width at which the pane is
 * ~435px and the tree is a drawer over the viewer (`workspace-files.spec.ts`
 * records the arithmetic). The find bar floats over the top-right of that 435px
 * body, so this is the width the choice has to survive. */
const SIXTEEN_INCH = { height: 1117, width: 1728 };

const GIT_HOME = "/tmp/vingilot-find-home";
const REPO = {
  id: "repo-find",
  name: "vingilot",
  path: "/tmp/vingilot-find",
};

const WORKTREE = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-find",
  branch: "spike",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-find",
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
};

/** The file the find bar is read over. Written for one purpose: `greet` appears
 * **five** times in four different shapes — as a call, twice inside the longer
 * word `greeting`, and once capitalised — so one fixture answers three
 * questions.
 *
 * - The count is 5 and not 4: a find that stopped at word boundaries would say 3.
 * - `Greet` appears exactly once, so smart case is readable as a number changing
 *   on screen (`1/5` → `1/1`) rather than as a colour that may or may not be
 *   there.
 * - The occurrences are on five different lines, so walking is a walk. */
const FIND_TS = `export function greet(name: string): string {
  const greeting = \`hello \${name}\`;
  return greeting;
}

export function Greet(name: string): string {
  return greet(name).toUpperCase();
}
`;

/** How many times `greet` occurs in it, case-insensitively. Written out rather
 * than counted in the spec: a test that computed the expectation the same way the
 * product does would pass through any change to either. */
const GREET_COUNT = 5;

/** 400 lines with no grammar the viewer knows, so this file takes the viewer's
 * **plain** render path — the other of the two branches the amber has to work in.
 * `needle` is on line 2 and on line 380 and nowhere else: one match on screen at
 * once, and one far below the fold, which is what makes "the walk scrolls" an
 * assertion rather than a hope. */
const NEEDLE_LINES = [2, 380];
const LOG_TEXT = Array.from({ length: 400 }, (_unused, index) =>
  NEEDLE_LINES.includes(index + 1)
    ? `event ${index}: needle accepted`
    : `event ${index}: worker heartbeat accepted`,
).join("\n");

const TREE: Record<
  string,
  { name: string; kind: string; size: number | null }[]
> = {
  "": [
    { kind: "directory", name: "src", size: null },
    { kind: "file", name: "README.md", size: 128 },
  ],
  src: [
    { kind: "file", name: "greet.ts", size: FIND_TS.length },
    { kind: "file", name: "trace.log", size: LOG_TEXT.length },
  ],
};

const FILES: Record<string, string> = {
  "README.md": "# vingilot\n",
  "src/greet.ts": FIND_TS,
  "src/trace.log": LOG_TEXT,
};

const PERSONAS = [
  { displayName: "Planner", id: "persona-planner", systemPrompt: "Plan it." },
];

const TEAM = {
  description: "Plans it.",
  id: "team-find",
  name: "Find Team",
  personaIds: ["persona-planner"],
};

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
};

/** The workspace, with this spec's tree and files answered and **everything else
 * falling through to the mock bridge**. That fall-through is what lets the same
 * harness serve the Files pane and a real hosted channel in the Team pane: the
 * relay side of the app is the bridge's, and only the two `vingilot_files`
 * commands are this spec's. */
async function openWorkspace(page: Page) {
  await page.setViewportSize(SIXTEEN_INCH);
  await installMockBridge(page, { personas: PERSONAS, teams: [TEAM] });
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
    ([home, tree, files]: [
      string,
      Record<string, { name: string; kind: string; size: number | null }[]>,
      Record<string, string>,
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
    [GIT_HOME, TREE, FILES] as const,
  );

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
}

/** Put a pane on the dock: the four with a fixed tab (files/diff/history, and
 * team under its "crew" tab) light their tab directly (`dock.spec.ts`'s
 * idiom); anything else has no tab and is chosen from the palette — the
 * dock's only door onto it (`dockModel.ts`). */
async function choosePane(page: Page, key: string) {
  const tab = key === "team" ? "crew" : key;
  if (
    tab === "crew" ||
    tab === "diff" ||
    tab === "files" ||
    tab === "history"
  ) {
    await page.getByTestId(`dock-tab-${tab}`).click();
    return;
  }
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.getByTestId("palette-input").fill(key);
  await page.getByTestId(`palette-row-pane:${key}`).click();
  await expect(page.getByTestId("palette")).toHaveCount(0);
}

/** A worktree, the Files pane, one file open — the tree is the dock's own tab
 * (P3, and since P4.1 the only one), and the file it opens is a tab on the
 * stage, which is the state ⌘F is pressed from. */
async function openFile(page: Page, path: string) {
  await page.getByTestId(`worktree-row-${WORKTREE.binding_id}`).click();
  await choosePane(page, "files");
  await expect(page.getByTestId("dock-files")).toBeVisible();
  await page.getByTestId("dock-files-row-src").click();
  await page.getByTestId(`dock-files-row-${path}`).click();
  await expect(page.getByTestId("files-viewer-path")).toHaveText(path);
  // **And the keyboard is put where the reading is**, which since P4.1 is a
  // different place from where the file was picked: the tree is the dock's and
  // the reading is a tab on the stage, so a click in the tree leaves focus on
  // a tree row. ⌘F's boundary is deliberately narrow (`findKeys.ts`) — it is
  // this surface's chord only while the target is inside it — and that is the
  // same rule VS Code keeps: ⌘F in the explorer is not find-in-file. Clicking
  // into the text is therefore part of the gesture being tested, not a
  // workaround for one.
  await page.getByTestId("files-viewer-body").click();
}

test("⌘F opens a find bar over the open file, counts, walks and closes", async ({
  page,
}) => {
  await openWorkspace(page);
  await openFile(page, "src/greet.ts");

  // **The chord arrives, and it arrives at the field.** No click in between:
  // ⌘F then typing has to work, which is the whole reason it is a chord.
  await expect(page.getByTestId("files-find")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+f");
  const bar = page.getByTestId("files-find");
  await expect(bar).toBeVisible();
  const field = page.getByTestId("files-find-input");
  await expect(field).toBeFocused();
  // Nothing is claimed before a query exists: a bar that said "no results"
  // having searched for nothing would be reporting on a search nobody ran.
  await expect(page.getByTestId("files-find-count")).toHaveText("");

  await page.keyboard.type("greet");
  const count = page.getByTestId("files-find-count");
  await expect(count).toHaveText(`1/${GREET_COUNT}`);

  // Enter walks forward; ⇧Enter walks back.
  await page.keyboard.press("Enter");
  await expect(count).toHaveText(`2/${GREET_COUNT}`);
  await page.keyboard.press("Enter");
  await expect(count).toHaveText(`3/${GREET_COUNT}`);
  await page.keyboard.press("Shift+Enter");
  await expect(count).toHaveText(`2/${GREET_COUNT}`);

  // **And it wraps, at both ends** — the gesture is "again", not "forward", so a
  // walk that stopped dead on the last match would be a bar that stopped
  // answering. Back off the front lands on the last, then forward off the end
  // lands on the first.
  await page.keyboard.press("Shift+Enter");
  await expect(count).toHaveText(`1/${GREET_COUNT}`);
  await page.keyboard.press("Shift+Enter");
  await expect(count).toHaveText(`${GREET_COUNT}/${GREET_COUNT}`);
  await page.keyboard.press("Enter");
  await expect(count).toHaveText(`1/${GREET_COUNT}`);

  // A query that matches nothing says so in words rather than as `0/0`.
  await field.fill("nothinglikethis");
  await expect(count).toHaveText("no results");
  await expect(page.getByTestId("files-find-match")).toHaveCount(0);
  await expect(page.getByTestId("files-find-current")).toHaveCount(0);

  // **Esc closes it and hands focus back to the viewer** — not to nothing, which
  // would leave the pane keyboard-dead, and not to the button it just unmounted.
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
  await expect(page.getByTestId("files-viewer-body")).toBeFocused();
  // And the file is untouched by having been searched: no marks left behind.
  await expect(page.getByTestId("files-find-match")).toHaveCount(0);
});

test("every match is amber and the current one is emphasised — over the tokens, not the spans", async ({
  page,
}) => {
  // **The reading Task 0 made necessary.** The viewer's body is Shiki's tokens,
  // whose boundaries are the grammar's, and the match set is computed over
  // `file.text` instead. So the count here has to be the same 5 the model says —
  // asserted on the tokenised body, which is established first rather than
  // assumed.
  await openWorkspace(page);
  await openFile(page, "src/greet.ts");
  const code = page.getByTestId("files-viewer-code");
  await expect(code).toHaveAttribute("data-highlighted", "true", {
    timeout: 15_000,
  });

  await page.keyboard.press("ControlOrMeta+f");
  await page.keyboard.type("greet");

  // All of them highlighted, exactly one of them the current one — and the two
  // sets do not overlap, so `4 + 1` is the whole count and not four of five.
  await expect(page.getByTestId("files-find-current")).toHaveCount(1);
  await expect(page.getByTestId("files-find-match")).toHaveCount(
    GREET_COUNT - 1,
  );
  // Inside the tokenised body, not beside it.
  await expect(
    code.locator(
      '[data-testid="files-find-current"], [data-testid="files-find-match"]',
    ),
  ).toHaveCount(GREET_COUNT);

  // The current one moves with the walk, and it is the SECOND occurrence — read
  // as the text around it, because "a mark moved" is true of any implementation
  // that redraws.
  const current = page.getByTestId("files-find-current");
  await expect(current).toHaveText("greet");
  const firstLine = await current.evaluate(
    (mark) => mark.closest("[data-line]")?.textContent ?? "",
  );
  expect(firstLine).toContain("export function greet(name");
  await page.keyboard.press("Enter");
  const secondLine = await current.evaluate(
    (mark) => mark.closest("[data-line]")?.textContent ?? "",
  );
  expect(secondLine).toContain("const greeting");

  // **Smart case, on screen as a number.** One capital and the five become the
  // one occurrence he actually typed.
  await page.getByTestId("files-find-input").fill("Greet");
  await expect(page.getByTestId("files-find-count")).toHaveText("1/1");
  await expect(page.getByTestId("files-find-current")).toHaveText("Greet");
  await expect(page.getByTestId("files-find-match")).toHaveCount(0);
});

test("the walk scrolls the viewer, on the plain render path too", async ({
  page,
}) => {
  // The viewer's OTHER branch: no grammar it knows, so `ViewerLines` draws its
  // own line spans rather than Shiki's tokens. A find proved only on the
  // highlighted path is a find that works for TypeScript and silently not for a
  // log — and the two paths build their elements in different code.
  await openWorkspace(page);
  await openFile(page, "src/trace.log");
  await expect(page.getByTestId("files-viewer-plain")).toBeVisible();
  await expect(page.getByTestId("files-viewer-code")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+f");
  await page.keyboard.type("needle");
  await expect(page.getByTestId("files-find-count")).toHaveText("1/2");
  await expect(page.getByTestId("files-find-current")).toHaveCount(1);
  await expect(page.getByTestId("files-find-match")).toHaveCount(1);

  // **The walk has to move the file.** `toHaveText` does not require an element
  // to be in view — the hole that once left every Files spec green while the
  // marked line sat hundreds of lines below the fold — so the second match, 378
  // lines further down, is asserted in the viewport. Before the walk it cannot
  // be: it is off the bottom of a ~30-line pane.
  const far = page.getByTestId("files-find-match");
  await expect(far).not.toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("files-find-count")).toHaveText("2/2");
  await expect(page.getByTestId("files-find-current")).toBeInViewport();
  const landed = await page
    .getByTestId("files-find-current")
    .evaluate((mark) => mark.closest("[data-line]")?.textContent ?? "");
  expect(landed).toContain(`event ${NEEDLE_LINES[1] - 1}:`);
});

test("the ⌘F boundary: a field outside the pane keeps it, and the team thread is not this pane's", async ({
  page,
}) => {
  // **P7 retired a claim here, with its subject.** This test used to end by
  // asserting that ⌘F in the Team pane opened upstream's own find bar
  // (`channel-find-bar`). Upstream PR #5306 deleted `ChannelFindBar` and
  // `useChannelFind` outright; `git grep useChannelFind` finds no file on this
  // branch and none on `upstream/main` either — only prose in eight of this
  // island's own headers. A claim whose subject no longer exists cannot be
  // fixed and must not be left red pretending otherwise, so it is gone rather
  // than skipped. Nothing was deleted to make a failure quiet: the assertion
  // below took its place and still fails the mutation the original was written
  // for, which is the only reason the original earned its cost.
  //
  // What survives, and why it still has teeth. ⌘F was `useChannelFind`'s: a
  // bubble-phase listener on the window, live wherever a channel screen was
  // mounted — which inside the workspace means the Team pane, because
  // `TeamThreadPane` hosts `ChannelRouteScreen` itself rather than copying it.
  // This island's listener is capture-phase and calls `stopPropagation`, so a
  // boundary drawn one element too wide would have taken find-in-this-channel
  // away from the pane the owner talks to his agents in. That boundary is still
  // the thing worth guarding — what changed is only that the far side of it is
  // currently empty. So the reading is now the half of the claim that never
  // depended on upstream's component: in the Team pane, ⌘F is NOT this pane's,
  // and `files-find` does not open. The mutation that makes `ownsChord` answer
  // `true` for the whole window still turns this test red, which is what makes
  // it a guard rather than a description. When upstream restores a find bar,
  // add the positive half back here.
  //
  // Still red elsewhere, and NOT this test's to fix: `workspace-search.spec.ts`
  // asserts `channel-find-bar` at line 414 on the standalone `/channels` route.
  // One observation worth keeping for whoever restores the bar: at the moment of
  // that failure the accessibility snapshot collapses to almost nothing —
  // `status` and a notifications region, none of the channel screen's own
  // chrome. That reads as a crash on that route around the ⌘F keydown, not
  // merely a missing component quietly doing nothing; start from that hypothesis
  // rather than re-deriving it from a bare "element not found".
  //
  // Two readings, in one test because they are one claim:
  //
  // 1. **With the Files pane up and a file open, ⌘F in a text field elsewhere in
  //    the app is not this pane's.** That is the case that says the boundary is
  //    drawn on `dock-files` and not on the window.
  // 2. **In the Team pane — a hosted channel screen, the one surface inside the
  //    workspace that is a text field belonging to somebody else — ⌘F is still
  //    not this pane's.** Read here rather than on `/channels/general` on
  //    purpose: this is the screen inside the workspace where the two would have
  //    been live at the same time.
  await openWorkspace(page);
  await openFile(page, "src/greet.ts");

  // Focus onto the terminal column beside the pane — its tab strip, which is on
  // screen at the same time as the open file and is not inside `dock-files`. The
  // precondition is read as `activeElement` rather than as `toBeFocused` on the
  // tab, because selecting a tab may hand the keyboard on to the shell, and
  // either way what this test needs is "focus is somewhere that is not this
  // pane".
  //
  // (xterm's own helper textarea would have been the obvious choice and cannot be
  // used: with the pty commands stubbed the terminal mounts but never paints, so
  // the textarea is not visible and will not take focus. The claim is the same
  // claim either way — the same `ownsChord`, the same `contains` — and this is
  // where it can actually be read.)
  await page.getByTestId("terminal-tab-1").click();
  expect(
    await page.evaluate(
      () =>
        document.activeElement?.closest('[data-testid="dock-files"]') === null,
    ),
    "focus was still inside the Files pane, so this proves nothing about the boundary",
  ).toBe(true);
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.getByTestId("files-find")).toHaveCount(0);
  // And the chord is not merely being swallowed: back inside the pane it works.
  await page.getByTestId("files-viewer-body").focus();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.getByTestId("files-find")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("files-find")).toHaveCount(0);

  await choosePane(page, "team");
  await expect(page.getByTestId("team-choice")).toBeVisible();
  await page.getByTestId(`team-choice-${TEAM.id}`).click();
  await page.getByTestId("team-open").click();
  const composer = page
    .getByTestId("team-thread")
    .getByTestId("message-composer");
  await expect(composer).toBeVisible({ timeout: 15_000 });

  // The caret in the hosted composer — which is a text input in a pane that is
  // not the Files pane, exactly the case the plan says must fall through.
  await page
    .getByTestId("team-thread")
    .getByTestId("message-input")
    .first()
    .click();
  await page.keyboard.press("ControlOrMeta+f");

  // This island's bar is not on screen. With upstream's find bar deleted there
  // is no second bar to compare against any more, so this is read as an absence
  // — but it is the same reading the pair was there for: the chord pressed in
  // somebody else's text field does not reach `dock-files`.
  await expect(page.getByTestId("files-find")).toHaveCount(0);
  // (That the pane has not simply gone deaf is already read above, before the
  // pane was switched: same chord, inside `dock-files`, bar visible. Without
  // that half, `ownsChord` returning `false` for everything would satisfy this
  // assertion and leave the boundary unguarded.)
});
