// The escape hatch, both directions, proved against a real render
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 1; ADR-005 rung 3).
//
// > *"Sending the owner to VS Code deliberately beats losing him to it."*
//
// `editors.test.mjs` says what a click should do given what is installed and
// what he chose; `openTarget.test.mjs` says where an incoming path lands;
// `vingilot_editor`'s and `vingilot_shim`'s cargo tests say what the two Rust
// commands refuse and what the shipped shell script emits. All of that is pure
// or headless and none of it needs a browser.
//
// **What only a browser can say is that any of it reaches him.** Four things,
// each a real failure mode in this island:
//
// - **The button is on the viewer's header and it carries file:line.** A model
//   that decides "open Cursor at line 412" and a component that calls
//   `editor_open` with no line look identical from every unit test, and the
//   line is the entire reason this rung exists rather than an `open -a`.
// - **Two editors ask once, and the answer is remembered.** "Never guess
//   between two" is a sentence about a menu appearing; whether the menu appears,
//   and whether the *second* file's button then opens directly, is a claim about
//   a store and four components sharing it.
// - **No editor is a disabled control carrying the backend's sentence**, not a
//   hidden one. A refusal that is correct in Rust and never rendered is the
//   failure this island has already had.
// - **The door in lands in the viewer at the line.** `vingilot src/greet.ts:2`
//   ends as a Tauri event; a resolver that is right and a listener nothing
//   registers are indistinguishable without a running app.
// - **The ⌘K row's label is a reading of the disk.** `shim_status` is a command
//   the backend serves and the webview must actually *call*; a status nobody
//   invokes and a row with a hardcoded label look identical from Rust, from the
//   client module's own types, and from `paletteSources.test.mjs` — which is
//   exactly how that wire came to be missing once.
//
// The commands are stubbed through the property trap
// `workspace-files.spec.ts` documents: the bridge assigns `invoke` during boot
// and the home-directory lookup runs on the first render, so an override
// installed after boot is too late. Stubbed rather than run against real
// editors — a spec that launched Cursor would open a window on whichever
// machine ran CI.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** The same 16-inch width every pane in this island is read at. */
const SIXTEEN_INCH = { height: 1117, width: 1728 };

const GIT_HOME = "/tmp/vingilot-hatch-home";
const REPO = {
  id: "repo-hatch",
  name: "vingilot",
  path: "/tmp/vingilot-hatch",
};

const WORKTREE = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-hatch",
  branch: "spike",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-hatch",
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
};

/** Where `worktreeCwd` puts this worktree — `<home>/.vingilot/worktrees/<run>`.
 * The escape hatch hands this exact string to `editor_open`, so it is written
 * out rather than inferred: a button that opened a path against the wrong
 * checkout is the failure `filesTarget.shouldLand` exists to prevent, arriving
 * by another route. */
const WORKTREE_CWD = `${GIT_HOME}/.vingilot/worktrees/${WORKTREE.owner_run_id}`;

const GREET_TS = `export function greet(name: string): string {
  const needle = name;
  return \`hello \${needle}\`;
}
`;

/** Deliberately not line 1: a call that dropped the line would be
 * indistinguishable from one that carried it. */
const HIT_LINE = 2;

const TREE: Record<
  string,
  { name: string; kind: string; size: number | null }[]
> = {
  "": [{ kind: "directory", name: "src", size: null }],
  src: [
    { kind: "file", name: "greet.ts", size: GREET_TS.length },
    { kind: "file", name: "other.ts", size: 24 },
  ],
};

const FILES: Record<string, string> = {
  "src/greet.ts": GREET_TS,
  "src/other.ts": "export const x = 0;\n",
};

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
};

/** What the page records about the two commands under test, so a spec can read
 * *what was asked* rather than only what appeared. */
interface HatchKnobs {
  /** Which editor ids `editor_probe` answers with. Turned by a test before the
   * probe runs, which is why it is a window value rather than a fixture. */
  __EDITORS__?: string[];
  /** Every `editor_open` call, in order. */
  __OPENED__?: {
    editor: string;
    line: number | null;
    path: string;
    worktree: string;
  }[];
  /** The mock bridge's own invoke, kept so events can be emitted through it. */
  __HOST_INVOKE__?: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  /** What `shim_status` answers for `linked`. A knob rather than a fixture
   * because the ⌘K row's label is the thing under test, and the two labels are
   * this one boolean apart. */
  __SHIM_LINKED__?: boolean;
  /** How many times the app asked. Read to prove the command is *called* —
   * a status the backend serves and nobody invokes is the failure this knob
   * exists for. */
  __SHIM_READS__?: number;
}

async function openHatchWorkspace(
  page: Page,
  editors: string[],
  shimLinked = false,
) {
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
    ([home, tree, files, installed, noEditor, linked]: [
      string,
      Record<string, { name: string; kind: string; size: number | null }[]>,
      Record<string, string>,
      string[],
      string,
      boolean,
    ]) => {
      const w = window as unknown as TrapWindow;
      const knobs = w as unknown as HatchKnobs;
      knobs.__EDITORS__ = installed;
      knobs.__OPENED__ = [];
      knobs.__SHIM_LINKED__ = linked;
      knobs.__SHIM_READS__ = 0;
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;

      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);
        if (name === "editor_probe") {
          const found = knobs.__EDITORS__ ?? [];
          return Promise.resolve({
            editors: found,
            // The backend's own sentence, verbatim from `no_editor()`'s shape:
            // it names the three commands, and it is what the disabled control
            // has to be carrying.
            refusal: found.length === 0 ? noEditor : null,
          });
        }
        if (name === "editor_open") {
          const asked = (args ?? {}) as {
            editor?: string;
            line?: number | null;
            path?: string;
            worktree?: string;
          };
          knobs.__OPENED__?.push({
            editor: asked.editor ?? "",
            line: asked.line ?? null,
            path: asked.path ?? "",
            worktree: asked.worktree ?? "",
          });
          return Promise.resolve(null);
        }
        if (name === "shim_status") {
          knobs.__SHIM_READS__ = (knobs.__SHIM_READS__ ?? 0) + 1;
          return Promise.resolve({
            linkPath: "/usr/local/bin/vingilot",
            linked: knobs.__SHIM_LINKED__ === true,
            shimPath: `${home}/.vingilot/bin/vingilot`,
          });
        }
        if (name === "shim_install_link") {
          return Promise.resolve({
            linked: false,
            sentence:
              "/usr/local/bin would not take the link. Run this in a terminal and it is done: sudo ln -sf …",
          });
        }
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
            lines: text.replace(/\n$/, "").split("\n").length,
            path,
            text,
          });
        }
        if (name === "worktree_list") return Promise.resolve([]);
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
          // Kept so a test can emit a Tauri event through the mock bridge's own
          // channel — the door in arrives as one, and driving it any other way
          // would prove the resolver rather than the listener.
          knobs.__HOST_INVOKE__ = fn;
        },
      });
    },
    [GIT_HOME, TREE, FILES, editors, NO_EDITOR_SENTENCE, shimLinked] as const,
  );

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await page.getByTestId(`worktree-row-${WORKTREE.binding_id}`).click();
}

/** The backend's words for a machine with no editor CLI on it. Kept in one
 * place here so the assertion below reads what the stub answered rather than a
 * paraphrase of it. */
const NO_EDITOR_SENTENCE =
  "no editor command was found. Vingilot looks for cursor, code and zed — on PATH and in the usual install locations.";

/** The Files pane, opened the way he opens it. The tree is the dock's own tab
 * (P3) and since P4.1 the only one; a file picked there opens as a tab beside
 * the shells, which is where the viewer header's Open in editor button is. */
async function openFilesPane(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.getByTestId("palette-input").fill("files");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("dock-files")).toBeVisible();
}

/** Open a file through the sidebar's tree. No drawer to manage any more —
 * the tree is always on screen while the Files accordion member is open, and
 * the viewer has the pane whole (pane-nav-absorb plan). */
async function openFromTree(page: Page, path: string) {
  // `src` is a toggle, so expanding one that is already open would close it.
  if ((await page.getByTestId(`dock-files-row-${path}`).count()) === 0) {
    await page.getByTestId("dock-files-row-src").click();
  }
  await page.getByTestId(`dock-files-row-${path}`).click();
  await expect(page.getByTestId("files-viewer-path")).toBeVisible();
}

async function openGreet(page: Page) {
  await openFromTree(page, "src/greet.ts");
}

test("the viewer's header opens the open file in the one installed editor", async ({
  page,
}) => {
  await openHatchWorkspace(page, ["zed"]);
  await openFilesPane(page);
  await openGreet(page);

  const button = page.getByTestId("files-open-in-editor");
  // One installed is not a choice: the label names it, and there is no menu.
  await expect(button).toHaveText(/Open in Zed/);
  await expect(page.getByTestId("files-open-in-editor-more")).toHaveCount(0);
  await button.click();

  const opened = await page.evaluate(
    () => (window as unknown as HatchKnobs).__OPENED__ ?? [],
  );
  expect(opened).toEqual([
    {
      editor: "zed",
      // No line: a file opened from the tree has no interesting line, and
      // `filesTarget.ts`'s `null` is the word for that.
      line: null,
      path: "src/greet.ts",
      worktree: WORKTREE_CWD,
    },
  ]);
});

test("two editors ask once, and the answer is remembered for the next file", async ({
  page,
}) => {
  await openHatchWorkspace(page, ["cursor", "vscode"]);
  await openFilesPane(page);
  await openGreet(page);

  const button = page.getByTestId("files-open-in-editor");
  // **Never guess between two** — the plan's words, as a rendered ellipsis.
  await expect(button).toHaveText(/Open in editor…/);
  await button.click();
  await expect(page.getByTestId("files-open-in-editor-menu")).toBeVisible();
  await page.getByTestId("files-open-in-editor-choose-vscode").click();

  // Choosing acts as well as records: a row called "VS Code" that only stored
  // a preference would be a settings screen wearing a menu's clothes.
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as HatchKnobs).__OPENED__?.length ?? 0,
      ),
    )
    .toBe(1);

  // The second file is not asked about. The store is module-level and the
  // button is a fresh component per file, so this is the assertion that the two
  // share one answer.
  await openFromTree(page, "src/other.ts");
  await expect(page.getByTestId("files-open-in-editor")).toHaveText(
    /Open in VS Code/,
  );
  await page.getByTestId("files-open-in-editor").click();

  const opened = await page.evaluate(
    () => (window as unknown as HatchKnobs).__OPENED__ ?? [],
  );
  expect(opened.map((call) => [call.editor, call.path])).toEqual([
    ["vscode", "src/greet.ts"],
    ["vscode", "src/other.ts"],
  ]);
});

test("no editor is a disabled control carrying the backend's sentence", async ({
  page,
}) => {
  await openHatchWorkspace(page, []);
  await openFilesPane(page);
  await openGreet(page);

  // Present, not hidden: a control that vanishes looks like one that never
  // existed, which is the rule `paletteSources.ts` keeps for a blocked row.
  const none = page.getByTestId("files-open-in-editor-none");
  await expect(none).toBeVisible();
  await expect(none).toBeDisabled();
  // And the reason is the BACKEND's, which is what keeps one set of words in
  // the app: the three command names come from `vingilot_editor::no_editor`.
  await expect(none).toHaveAttribute("title", NO_EDITOR_SENTENCE);
});

test("a vingilot command lands at the line, and the button carries it out", async ({
  page,
}) => {
  await openHatchWorkspace(page, ["cursor"]);
  await openFilesPane(page);
  await openGreet(page);

  // Landed AT a line, through the door in — which is also the only route in
  // this spec that exercises the whole chain the shim uses.
  await emitVingilotOpen(page, {
    directory: false,
    line: HIT_LINE,
    path: `${WORKTREE_CWD}/src/greet.ts`,
  });

  // The door in: the file is in the viewer, at the line.
  await expect(page.getByTestId("files-viewer-marked-line")).toContainText(
    "const needle = name;",
  );

  // And the header's button now carries that line — the half `open -a` cannot
  // do, and the reason this rung is a CLI probe rather than a URL scheme.
  await page.getByTestId("files-open-in-editor").click();
  const opened = await page.evaluate(
    () => (window as unknown as HatchKnobs).__OPENED__ ?? [],
  );
  expect(opened).toEqual([
    {
      editor: "cursor",
      line: HIT_LINE,
      path: "src/greet.ts",
      worktree: WORKTREE_CWD,
    },
  ]);
});

test("a vingilot command for a directory in no project says so", async ({
  page,
}) => {
  await openHatchWorkspace(page, ["zed"]);
  await openFilesPane(page);

  await emitVingilotOpen(page, {
    directory: true,
    line: null,
    path: "/somewhere/else",
  });

  // Not silence, and not a dialog on its own: the sentence names the directory
  // and the add-project flow is what it points at.
  await expect(page.getByTestId("escape-hatch-notice")).toContainText(
    "/somewhere/else is not inside a project this workspace knows",
  );
  await page.getByTestId("escape-hatch-notice-dismiss").click();
  await expect(page.getByTestId("escape-hatch-notice")).toHaveCount(0);
});

/** The ⌘K row for the shell command, with the palette narrowed to it. */
async function shimRow(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.getByTestId("palette-input").fill("vingilot command");
  return page.getByTestId("palette-row-action:install-shim");
}

test("the ⌘K row asks the backend before it offers to install", async ({
  page,
}) => {
  await openHatchWorkspace(page, ["zed"], false);

  const row = await shimRow(page);
  await expect(row).toBeVisible();
  await expect(row).toContainText("Install vingilot command…");
  // Absent, not "false": the attribute is only written when there is a reason.
  await expect(row).not.toHaveAttribute("data-blocked", "true");

  // The label above is only worth anything if it came from an answer: a row
  // that never asked would read exactly the same on this machine.
  expect(
    await page.evaluate(
      () => (window as unknown as HatchKnobs).__SHIM_READS__ ?? 0,
    ),
  ).toBeGreaterThan(0);
});

test("a command already linked is a statement, not an offer", async ({
  page,
}) => {
  await openHatchWorkspace(page, ["zed"], true);

  const row = await shimRow(page);
  await expect(row).toBeVisible();
  await expect(row).toContainText("vingilot command installed");
  await expect(row).not.toContainText("Install vingilot command…");
  // Blocked rather than gone, which is this palette's rule for work that
  // cannot be done — and the reason names both ends of the link, so
  // "installed" is a claim he can check without leaving the row.
  await expect(row).toHaveAttribute("data-blocked", "true");
  await expect(row).toContainText("/usr/local/bin/vingilot");
  await expect(row).toContainText(`${GIT_HOME}/.vingilot/bin/vingilot`);
});

/** Deliver a `vingilot-open` event the way the deep-link arm does — through the
 * mock bridge's own event channel, so the app's `listen` is what receives it. */
async function emitVingilotOpen(
  page: Page,
  payload: { directory: boolean; line: number | null; path: string },
) {
  await page.evaluate((sent) => {
    const host = (window as unknown as HatchKnobs).__HOST_INVOKE__;
    if (host === undefined) throw new Error("the mock bridge never installed");
    return host("plugin:event|emit", {
      event: "vingilot-open",
      payload: sent,
    });
  }, payload);
}
