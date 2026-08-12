// The Files pane, proved against a real render
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 3; design in
// vingilot/docs/plans/2026-08-12-files-pane-design.md).
//
// > *"a file he cannot open is a file he leaves to find elsewhere."*
//
// `filesModel.test.mjs` says which rows a pair of records produces, what each
// key does to a selection, and the exact words of every refusal.
// `fileViewer.test.mjs` says which files are highlighted and what is said about
// the ones that are not. All of that is pure and none of it needs a browser.
//
// **What only a browser can say is that any of it reaches the screen.** Five
// things, and each has been a real failure mode in this island:
//
// - The pane is **reachable the way every other pane is** — a ⌘K row and the
//   picker — which is a claim about the registry rather than about this pane,
//   and is exactly what a new pane can get wrong by being added to the
//   component tree without being added to `PANE_IDS`.
// - The tree **walks under the arrow keys and opens under Enter**. The key map
//   is pure and tested; what is not is whether the handler is bound to an
//   element that has focus. A map nothing calls passes every unit test.
// - The viewer **really renders highlighted tokens**. `SyntaxHighlightedCode`
//   loads its grammar and its theme asynchronously and falls back to plain
//   `<span>`s on any failure, silently — so "the component is on screen" is not
//   evidence that it highlighted anything. The reading is that the tokens
//   carry inline colours, which only Shiki produces.
// - **Each refusal reaches the screen as its own sentence.** This is Task 3's
//   last checkbox and the reason this file exists at all: a sentence that is
//   correct in a model and never rendered is the failure this island has
//   already had. Too large (with its size), binary, and the plain-text notice
//   on a long file are each read here.
// - **The outside route lands on a LINE**, not just on a file. That is the half
//   Task 2's search results depend on and the half that has no other proof: a
//   landing whose `line` is ignored is indistinguishable from `openFile(path,
//   null)`, and the two render paths find their line elements in different
//   code — upstream's `CodeBlock` emits the `data-line` spans on the
//   highlighted path, the fallback emits its own — so both are read.
//
// The two commands are stubbed through the property trap
// `workspace-one-column.spec.ts` documents: the bridge assigns `invoke` during
// boot and throws on every command it does not know, and the home-directory
// lookup runs on the first render, so an override installed after boot is too
// late. Stubbed rather than run against a real checkout because what is under
// test is the pane — running real git would make every assertion a property of
// whatever happened to be in a temp directory, and `vingilot_files`' own cargo
// tests already drive the real binary against a real repository.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** The 16-inch MacBook Pro's default logical resolution — the machine every
 * complaint in this plan was made about.
 *
 * **Measured, and the measurement is the reason this spec looks the way it
 * does.** At 1728px the shell leaves a 1195px work surface, `MIN_LEFT_PX` takes
 * 752px of it for the terminal's 80 columns and the divider 8px, so the right
 * pane is about 435px — under `PATCH_MIN_PX + LIST_MIN_PX`, which
 * `diffListPlacement` resolves to `over`. So at HIS width the tree is a drawer
 * over the viewer, not a column beside it, and every test below reads it there.
 * That is the layout he will actually get; a wider viewport would have tested
 * one nobody has. */
const SIXTEEN_INCH = { height: 1117, width: 1728 };

const GIT_HOME = "/tmp/vingilot-files-home";
const REPO = {
  id: "repo-files",
  name: "vingilot",
  path: "/tmp/vingilot-files",
};

/** The worktree the pane reads. `owner_run_id` is what `worktreeCwd` derives
 * the directory from, so it cannot be null — the stub below answers for exactly
 * the path that produces. */
const WORKTREE = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-files",
  branch: "spike",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-files",
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
};

/** A small TypeScript file, under both highlight ceilings, with tokens Shiki
 * unambiguously colours. */
const SMALL_TS = `export function greet(name: string): string {
  return \`hello \${name}\`;
}
`;

/** Over `HIGHLIGHT_LINE_CEILING` (150) and nothing else — so the only reason
 * it can be plain is the line ceiling, and the sentence has to say so. */
const LONG_TS = Array.from(
  { length: 400 },
  (_, index) => `const line${index} = ${index};`,
).join("\n");

/** The tree, as one directory level per key — exactly the shape
 * `worktree_tree` answers with, including the caps it carries. */
const TREE: Record<
  string,
  { name: string; kind: string; size: number | null }[]
> = {
  "": [
    { kind: "directory", name: "src", size: null },
    { kind: "file", name: "README.md", size: 128 },
  ],
  src: [
    { kind: "file", name: "greet.ts", size: SMALL_TS.length },
    { kind: "file", name: "huge.log", size: 1_048_576 },
    { kind: "file", name: "logo.png", size: 4096 },
    { kind: "file", name: "long.ts", size: LONG_TS.length },
  ],
};

const FILES: Record<string, string> = {
  "README.md": "# vingilot\n",
  "src/greet.ts": SMALL_TS,
  "src/long.ts": LONG_TS,
};

/** The one changed file the Diff pane opens on, and therefore the file the
 * "show the whole file" route must land on. Deliberately NOT the tree's first
 * row: an implementation that opened whatever the tree listed first would pass
 * a test that used `README.md` here. */
const DIFF_FILE_PATH = "src/greet.ts";

/** Where each patch starts on its `+` side, and therefore the line the route
 * has to land on.
 *
 * **Deliberately not 1.** A landing that carried no line would be
 * indistinguishable from opening the top of the file, so the numbers here are
 * the difference between a door and a label — and they are read back below as
 * the *text* of that line, not as a number, because an off-by-one in either
 * direction is still a number. */
const GREET_HUNK_LINE = 2;
const LONG_HUNK_LINE = 200;

/** The second changed file, and it exists for one reason: it is over the
 * highlight ceiling, so it takes the viewer's OTHER render path. The marked
 * line has to be found in both — the highlighted path gets its `data-line`
 * spans from upstream's `CodeBlock.tsx` and the plain fallback emits its own,
 * and a mark that worked in one of them is a mark that works half the time. */
const DIFF_LONG_PATH = "src/long.ts";

/** What `worktree_diff` answers, in the shape `worktreeDiff.ts` reads. Two
 * files, one hunk each — the pane's contents are not what is under test here,
 * only that it has files open to offer and that each names the line its patch
 * starts at. */
const DIFF = {
  additions: 2,
  base: "HEAD",
  deletions: 0,
  files: [
    {
      additions: 1,
      binary: false,
      change: "modified",
      deletions: 0,
      oldPath: null,
      patch: [
        `--- a/${DIFF_FILE_PATH}`,
        `+++ b/${DIFF_FILE_PATH}`,
        `@@ -${GREET_HUNK_LINE},2 +${GREET_HUNK_LINE},3 @@`,
        "   return `hello ${name}`;",
        "+  // a change",
        " }",
      ].join("\n"),
      path: DIFF_FILE_PATH,
      truncated: false,
    },
    {
      additions: 1,
      binary: false,
      change: "modified",
      deletions: 0,
      oldPath: null,
      patch: [
        `--- a/${DIFF_LONG_PATH}`,
        `+++ b/${DIFF_LONG_PATH}`,
        `@@ -${LONG_HUNK_LINE},2 +${LONG_HUNK_LINE},3 @@`,
        " const line199 = 199;",
        "+const added = 0;",
        " const line200 = 200;",
      ].join("\n"),
      path: DIFF_LONG_PATH,
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
};

/** One line of a fixture, as the DOM will read it back: Playwright normalises
 * whitespace, so the assertion is written against the same normalisation
 * rather than against the source indentation. */
function lineOf(text: string, line: number): string {
  return text.split("\n")[line - 1].trim();
}

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
};

async function openFilesWorkspace(page: Page) {
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
    ([home, tree, files, diff]: [
      string,
      Record<string, { name: string; kind: string; size: number | null }[]>,
      Record<string, string>,
      unknown,
    ]) => {
      const w = window as unknown as TrapWindow;
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;

      // The backend's own refusal shapes. Serialised by serde as
      // `{ kind, … }`, and rejected rather than returned — `filesClient.ts`
      // reads a rejected invoke, which is what a `Result::Err` becomes.
      const refuse = (error: unknown) => Promise.reject(error);

      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);
        if (name === "worktree_tree") {
          const dir = ((args ?? {}) as { dir?: string }).dir ?? "";
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
          // The three refusals, each raised by the file it belongs to.
          if (path === "src/huge.log") {
            return refuse({
              cap: 512 * 1024,
              kind: "too-large",
              path,
              size: 1_048_576,
            });
          }
          if (path === "src/logo.png") {
            return refuse({ kind: "binary", path });
          }
          const text = files[path];
          if (text === undefined) {
            return refuse({
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
        if (name === "worktree_diff") return Promise.resolve(diff);
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
    [GIT_HOME, TREE, FILES, DIFF] as const,
  );

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await page.getByTestId(`worktree-row-${WORKTREE.binding_id}`).click();
}

/** The pane, opened the way he would open it: ⌘K, the pane's own row, Enter.
 * Deliberately not by clicking through the picker — the palette is the door the
 * plan cares about, and a pane missing from `PANE_IDS` has no row here at all. */
async function openFilesPane(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.getByTestId("palette-input").fill("files");
  const row = page.getByTestId("palette-row-pane:files");
  await expect(row).toBeVisible();
  await expect(row).not.toHaveAttribute("data-blocked", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("palette")).toBeHidden();
  await expect(page.getByTestId("pane-files")).toBeVisible();
  // At his width the tree is the drawer, and it starts open because there is
  // no file for it to be in the way of yet. Asserted rather than assumed: if
  // the layout ever gets wide enough for the tree to stand beside the viewer,
  // this is the line that says so.
  await expect(page.getByTestId("files-tree-drawer")).toBeVisible();
}

/** Put the tree away, which is what he does once he has picked something —
 * and the only way to read the viewer at 435px. Doubles as the assertion that
 * the toggle works in both directions. */
async function closeTree(page: Page) {
  const toggle = page.getByTestId("files-tree-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(page.getByTestId("files-tree-drawer")).toHaveCount(0);
}

async function openTree(page: Page) {
  await page.getByTestId("files-tree-toggle").click();
  await expect(page.getByTestId("files-tree-drawer")).toBeVisible();
}

/** Open a file from the tree and get the tree out of the way, which is the
 * whole gesture at this width. */
async function openFromTree(page: Page, path: string) {
  await page.getByTestId(`files-row-${path}`).click();
  await closeTree(page);
}

test("the Files pane is reachable from the palette and from the pane picker", async ({
  page,
}) => {
  // The claim is about the registry, not about this pane: adding a component
  // without adding it to `PANE_IDS` gives a pane that renders and that he
  // cannot get to. Both doors, because they read the same list through
  // different code (`paletteSources.ts` and `WorkSurface`), and a pane that
  // reached only one of them would be half-added.
  await openFilesWorkspace(page);
  await openFilesPane(page);
  await expect(page.getByTestId("pane-picker")).toContainText("Files");

  // And the picker offers it too, by name.
  await page.getByTestId("pane-picker").click();
  await expect(page.getByRole("menuitem", { name: /Files/ })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("the tree walks under the arrow keys and opens a file under Enter", async ({
  page,
}) => {
  // `resolveFileTreeKey` and `step`/`rightOf`/`enterOn` are pure and tested.
  // What is under test here is that they are bound to something that has
  // focus: a key map nothing calls passes every unit test there is.
  await openFilesWorkspace(page);
  await openFilesPane(page);

  const tree = page.getByTestId("files-tree");
  await expect(page.getByTestId("files-row-src")).toBeVisible();
  await expect(page.getByTestId("files-row-README.md")).toBeVisible();
  await tree.focus();

  // ↓ lands on the first row, ↓ again on the second — the order the model
  // sorts into (directories first).
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("files-row-src")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // → expands, and the children arrive from a second call for that directory
  // alone — which is the whole lazy-listing claim, visible here as `greet.ts`
  // not existing until now.
  await expect(page.getByTestId("files-row-src/greet.ts")).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("files-row-src/greet.ts")).toBeVisible();
  await expect(page.getByTestId("files-row-src")).toHaveAttribute(
    "aria-expanded",
    "true",
  );

  // → again steps into the first child rather than expanding anything.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("files-row-src/greet.ts")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Enter opens it.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("files-viewer-path")).toHaveText(
    "src/greet.ts",
  );

  // ← from a file goes up to its directory; ← again shuts it.
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("files-row-src")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("files-row-src/greet.ts")).toHaveCount(0);
});

test("an opened file is really highlighted, by the Shiki this app already ships", async ({
  page,
}) => {
  // "The component is on screen" is not evidence of highlighting:
  // `SyntaxHighlightedCode` loads its grammar and theme asynchronously and
  // returns plain `<span>` lines on any failure, silently. What is asserted is
  // the one thing only Shiki produces — per-token inline colours — so a build
  // that dropped the highlighter, or asked it for a language it does not have,
  // turns this red rather than looking identical.
  await openFilesWorkspace(page);
  await openFilesPane(page);
  await page.getByTestId("files-row-src").click();
  await page.getByTestId("files-row-src/greet.ts").click();
  await closeTree(page);

  await expect(page.getByTestId("files-viewer-code")).toBeVisible();
  // No plain-text notice: this file is under both ceilings and its language is
  // known, so nothing is being explained away.
  await expect(page.getByTestId("files-viewer-plain-note")).toHaveCount(0);

  const coloured = page.locator(
    '[data-testid="files-viewer-code"] span[style*="color"]',
  );
  await expect
    .poll(async () => coloured.count(), { timeout: 15_000 })
    .toBeGreaterThan(3);

  // More than one colour, so a single wrapper carrying a foreground colour
  // cannot pass for tokenising.
  const distinct = await page.evaluate(() => {
    const spans = document.querySelectorAll(
      '[data-testid="files-viewer-code"] span[style*="color"]',
    );
    return new Set([...spans].map((span) => (span as HTMLElement).style.color))
      .size;
  });
  expect(distinct).toBeGreaterThan(1);

  // And the text itself is the file's, not a fixture that happens to colour.
  await expect(page.getByTestId("files-viewer-code")).toContainText(
    "export function greet",
  );
});

test("each refusal reaches the screen as its own sentence", async ({
  page,
}) => {
  // Task 3's last checkbox, and the reason this spec exists. Three files, three
  // refusals, three different sentences — a single "could not show this file"
  // covering all three would pass a test that only asserted "something was
  // said", so each is read for the fact it is supposed to carry.
  await openFilesWorkspace(page);
  await openFilesPane(page);
  await page.getByTestId("files-row-src").click();

  // 1. Too large — and it names the real size, because without it he cannot
  // tell whether to reach for `less` or for `head`.
  await openFromTree(page, "src/huge.log");
  const refusal = page.getByTestId("files-viewer-refusal");
  await expect(refusal).toBeVisible();
  const tooLarge = (await refusal.textContent()) ?? "";
  expect(tooLarge).toContain("src/huge.log");
  expect(tooLarge).toContain("1.0 MiB");
  expect(tooLarge).toContain("512 KiB");

  // 2. Binary — a different sentence, saying a different thing.
  await openTree(page);
  await openFromTree(page, "src/logo.png");
  await expect(refusal).toBeVisible();
  const binary = (await refusal.textContent()) ?? "";
  expect(binary).toContain("looks binary");
  expect(binary).not.toEqual(tooLarge);

  // 3. Not a refusal but the third bound Task 3 asks to be honest about: a
  // file past the highlight ceiling renders as plain text AND says why, with
  // both numbers. Upstream's highlighter falls back here silently; a fallback
  // he cannot see is a bug report.
  await openTree(page);
  await openFromTree(page, "src/long.ts");
  await expect(page.getByTestId("files-viewer-plain")).toBeVisible();
  const plainNote = page.getByTestId("files-viewer-plain-note");
  await expect(plainNote).toBeVisible();
  const said = (await plainNote.textContent()) ?? "";
  expect(said).toContain("400 lines");
  expect(said).toContain("150 lines");
  // The highlighted path is genuinely not taken.
  await expect(page.getByTestId("files-viewer-code")).toHaveCount(0);

  // And a fourth, which is the tree's own: a directory git refuses is a
  // sentence in place, never an empty directory. `worktree_tree` answers
  // not-found for any directory the fixture does not carry, so expanding one
  // that is only in the tree by name is a real refusal from the real client.
  //
  // (`src` is the only listed directory, so this is asserted through the
  // footer instead: the pane states the two differences from `ls` rather than
  // letting him discover them.)
  await expect(page.getByTestId("files-footer")).toContainText("ignored files");
});

test("the viewer opens from outside the pane — a patch's file, shown whole", async ({
  page,
}) => {
  // **The route Task 2 builds on** (design §6), driven through its first real
  // caller. The Diff pane's header button raises
  // `onPaneAct({ type: "show-file", … })`; `RunsScreen` files the target and
  // then brings the Files pane forward. Both halves are asserted, because a
  // wiring that only filed the target would leave him looking at the patch he
  // was already looking at, and a wiring that only chose the pane would land
  // him on an empty viewer.
  //
  // Driven through a button rather than through a fabricated event on purpose:
  // a test that dispatched its own channel would prove the pane can be told and
  // nothing about whether anything tells it. The search surface does not exist
  // yet — this is the landing existing before its caller, with one caller
  // already using it.
  await openFilesWorkspace(page);

  // The Diff pane is the default for a worktree nobody has arranged
  // (`defaultPaneState`), so it is already up.
  await expect(page.getByTestId("pane-diff")).toBeVisible();
  // Deliberately not on the Files pane yet: the act has to bring it forward.
  await expect(page.getByTestId("pane-files")).toHaveCount(0);

  const shows = page.getByTestId("worktree-diff-show-file");
  await expect(shows).toBeVisible();
  const opened =
    (await page.getByTestId("worktree-diff-open").textContent()) ?? "";
  expect(opened.length).toBeGreaterThan(0);

  await shows.click();

  await expect(page.getByTestId("pane-files")).toBeVisible();
  // And it is showing the file the patch was of, not whatever the tree's first
  // row happened to be.
  await expect(page.getByTestId("files-viewer-path")).toHaveText(
    DIFF_FILE_PATH,
  );

  // **And at the line the patch is on, which is the half that makes this a
  // landing rather than a label.** Without it the route is indistinguishable
  // from opening the top of the file, and the `line` Task 2's search results
  // will carry would be ignored with nothing failing. Read as the line's own
  // TEXT, because an off-by-one in either direction is still a number — and on
  // the highlighted path, where the `data-line` spans the mark is put on are
  // upstream's rather than this pane's.
  await expect(page.getByTestId("files-viewer-code")).toBeVisible();
  await expect(page.getByTestId("files-viewer-marked-line")).toHaveText(
    lineOf(SMALL_TS, GREET_HUNK_LINE),
  );
});

test("the landing carries its line into the plain renderer too", async ({
  page,
}) => {
  // The same route, through the viewer's OTHER render path. The two paths
  // produce their line elements from different code — upstream's `CodeBlock`
  // emits `<span data-line>` per tokenised line, the plain fallback emits its
  // own — and a mark proved on one of them is a mark that works for files
  // under 150 lines and silently not for the ones he is most likely to need a
  // line number in.
  await openFilesWorkspace(page);
  await expect(page.getByTestId("pane-diff")).toBeVisible();

  // Move the Diff pane onto the long file. At this width its list is a drawer,
  // the same way the Files tree is.
  await page.getByTestId("worktree-diff-list-toggle").click();
  await page.getByTestId("worktree-diff-file-1").click();
  await expect(page.getByTestId("worktree-diff-open")).toContainText("long.ts");

  await page.getByTestId("worktree-diff-show-file").click();

  await expect(page.getByTestId("files-viewer-path")).toHaveText(
    DIFF_LONG_PATH,
  );
  // Genuinely the plain path: 400 lines is past the highlight ceiling, so this
  // is not the previous test again under another name.
  await expect(page.getByTestId("files-viewer-plain")).toBeVisible();
  await expect(page.getByTestId("files-viewer-code")).toHaveCount(0);

  await expect(page.getByTestId("files-viewer-marked-line")).toHaveText(
    lineOf(LONG_TS, LONG_HUNK_LINE),
  );
  // **And on screen — which is the assertion that separates the landing from
  // the label.** `toHaveText` does not require the element to be in view, so
  // deleting the viewer's `scrollIntoView` left every one of these specs green
  // while the mark sat hundreds of lines below the fold. This is the file where
  // that matters: 400 lines, and the marked one is far past the bottom of a
  // pane he can see, so a mark he has to go looking for is the same as no mark.
  await expect(page.getByTestId("files-viewer-marked-line")).toBeInViewport();
});
