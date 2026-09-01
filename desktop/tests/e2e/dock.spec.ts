// The dock (redesign P3, mockup `.dock` — Vingilot.html:202-325), proved
// over the real key path and a recorded pty bridge:
//
// - the six-tab strip replaces the pane picker as the face of the right
//   slot: the slot's pane lights its tab, ⌘K's tab-less panes name
//   themselves, and the old `PanePicker` chrome is gone from the workspace;
// - each panel is real or honestly empty — Files' tree with its git
//   letters, Checks' and Run's designed empty states, History's rows from
//   the mocked log with an honest Reflog refusal;
// - the three positions move ONE dock (right card / bottom drawer / float),
//   ⌘\ and Esc do the mockup's own float dance, ⌥⌘B is zen (dock hidden,
//   rail back), and the right card's resize clamps at 300..540;
// - Start Dev and "New terminal here" open a fresh shell and TYPE into it —
//   asserted on the recorded `pty_open`/`pty_write` ids, never on chrome.
//
// The capture set at the bottom is the P3 screenshot evidence
// (`test-results/p3-shots/`), every shot gated on the seeded state having
// reached the screen — `p2-shots.spec.ts`'s discipline.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPO = {
  id: "repo-dock",
  name: "vingilot",
  path: "/tmp/vingilot-dock",
};

/** The primary worktree's binding id — no provisioned worktrees in this
 * fixture, so the primary row is the one the workspace lands on and its cwd
 * is the repo's own path (`worktreeCwd`). */
const BINDING = `main:${REPO.id}`;

const SMALL_TS = `export function greet(name: string): string {
  return \`hello \${name}\`;
}
`;

/** One directory level per key — `worktree_tree`'s own shape. */
const TREE: Record<
  string,
  { name: string; kind: string; size: number | null }[]
> = {
  "": [
    { kind: "directory", name: "src", size: null },
    { kind: "file", name: "README.md", size: 128 },
  ],
  src: [{ kind: "file", name: "greet.ts", size: SMALL_TS.length }],
};

const FILES: Record<string, string> = {
  "README.md": "# vingilot\n",
  "src/greet.ts": SMALL_TS,
};

/** `worktree_diff`, one modified file — the source of the Files tree's git
 * letter and the Diff tab's rows. */
const DIFF = {
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
      patch: [
        "--- a/src/greet.ts",
        "+++ b/src/greet.ts",
        "@@ -2,2 +2,3 @@",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: this is the FIXTURE FILE's own source text, not a placeholder of this spec's — the diff under test is a patch to a TypeScript file that itself contains a template literal
        "   return `hello ${name}`;",
        "+  // a change",
        " }",
      ].join("\n"),
      path: "src/greet.ts",
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

/** `worktree_log`, two commits, HEAD on the newest — the History graph's
 * whole world in this fixture. */
const LOG = {
  commits: [
    {
      author: "ysf",
      date: new Date(Date.now() - 18 * 60_000).toISOString(),
      hash: "a".repeat(40),
      refs: ["HEAD -> spike"],
      short: "aaaaaaa",
      subject: "await payment stub before asserting",
    },
    {
      author: "bosun",
      date: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      hash: "b".repeat(40),
      refs: [],
      short: "bbbbbbb",
      subject: "remove masked-race sleep",
    },
  ],
  cursor: "b".repeat(40),
  limit: 50,
  more: false,
};

declare global {
  interface Window {
    __DOCK_PROBE__: {
      opens: string[];
      writes: { session: string; data: string }[];
    };
  }
}

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
};

async function openDockWorkspace(page: Page) {
  await page.setViewportSize({ height: 900, width: 1700 });
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
      return route.fulfill({ json: { worktrees: [] } });
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
    ([tree, files, diff, log]: [
      Record<string, { name: string; kind: string; size: number | null }[]>,
      Record<string, string>,
      unknown,
      unknown,
    ]) => {
      const w = window as unknown as TrapWindow;
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;
      const probe = {
        opens: [] as string[],
        writes: [] as { session: string; data: string }[],
      };
      window.__DOCK_PROBE__ = probe;

      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        const payload = (args ?? {}) as Record<string, string>;
        if (name.startsWith("plugin:path|"))
          return Promise.resolve("/tmp/dock-home/");
        if (name === "worktree_tree") {
          const dir = payload.dir ?? "";
          const entries = tree[dir];
          if (entries === undefined)
            return Promise.reject({ kind: "not-found", path: dir });
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
        if (name === "worktree_diff") return Promise.resolve(diff);
        if (name === "worktree_log") return Promise.resolve(log);
        if (name === "worktree_status") {
          return Promise.resolve({
            conflicted: [],
            staged: [],
            unstaged: [],
            untracked: [],
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
        if (name === "pty_copy_mode") return Promise.resolve(false);
        if (name === "pty_open") {
          probe.opens.push(payload.session);
          return Promise.resolve(null);
        }
        if (name === "pty_write") {
          probe.writes.push({
            data: payload.data,
            session: payload.session,
          });
          return Promise.resolve(null);
        }
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
    [TREE, FILES, DIFF, LOG] as const,
  );

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await expect(page.getByTestId("dock")).toBeVisible();
}

test("the dock replaces the picker: six tabs, the slot's pane lights its own", async ({
  page,
}) => {
  await openDockWorkspace(page);

  // The mockup's six, present and in order; the default slot pane (Diff)
  // lights its tab.
  for (const tab of ["crew", "diff", "files", "checks", "history", "run"]) {
    await expect(page.getByTestId(`dock-tab-${tab}`)).toBeVisible();
  }
  await expect(page.getByTestId("dock-tab-diff")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("dock")).toHaveAttribute(
    "data-dock-selection",
    "diff",
  );

  // The old right-slot chrome is really retired, not hidden.
  await expect(page.getByTestId("pane-picker")).toHaveCount(0);
  await expect(page.getByTestId("pane-right-maximize")).toHaveCount(0);

  // Crew is the team thread, dockside.
  await page.getByTestId("dock-tab-crew").click();
  await expect(page.getByTestId("pane-team")).toBeVisible();
});

test("each panel is real or honestly empty", async ({ page }) => {
  await openDockWorkspace(page);

  // Files: the tree, the mocked diff's git letter on the changed file, and
  // the LANGUAGE icon (P4.1's one licensed deviation from the mockup — the
  // owner called its lettered chips wrong and asked for VS Code's per-language
  // marks) — then a click opens the file as a TAB beside the shells.
  await page.getByTestId("dock-tab-files").click();
  await expect(page.getByTestId("dock-files-tree")).toBeVisible();
  await page.getByTestId("dock-files-row-src").click();
  const changed = page.getByTestId("dock-files-row-src/greet.ts");
  await expect(changed).toBeVisible();
  await expect(page.getByTestId("dock-files-mark-src/greet.ts")).toHaveText(
    "M",
  );
  await expect(
    page
      .getByTestId("dock-files-icon-src/greet.ts")
      .locator("[data-file-icon]"),
  ).toHaveAttribute("data-file-icon", "ts");
  // A directory keeps the mockup's own folder glyph — the licence is for file
  // types only.
  await expect(
    page.getByTestId("dock-files-icon-src").locator("[data-file-icon]"),
  ).toHaveAttribute("data-file-icon", "folder");

  await changed.click();
  // The reading is on the stage, not inside the 376px card: the dock keeps its
  // tree, and there is no viewer and no "‹ tree" back button in it any more.
  await expect(page.getByTestId("dock-files-tree")).toBeVisible();
  await expect(page.getByTestId("dock-files-back")).toHaveCount(0);
  await expect(
    page.getByTestId("dock-files").getByTestId("files-viewer"),
  ).toHaveCount(0);
  await expect(page.getByTestId("files-viewer-path")).toHaveText(
    "src/greet.ts",
  );
  await expect(
    page.getByTestId("view-tab-select-file:src/greet.ts"),
  ).toBeVisible();

  // Checks: the designed empty state — no fake rows.
  await page.getByTestId("dock-tab-checks").click();
  await expect(page.getByTestId("dock-checks-empty")).toContainText(
    "No checks wired",
  );

  // History: rows from the mocked log, HEAD chip on the newest; the Reflog
  // segment draws and refuses honestly.
  await page.getByTestId("dock-tab-history").click();
  await expect(
    page.getByTestId(`dock-history-commit-${"a".repeat(40)}`),
  ).toContainText("await payment stub");
  await expect(
    page.getByTestId(`dock-history-commit-${"b".repeat(40)}`),
  ).toContainText("remove masked-race sleep");
  await page.getByTestId("dock-history-segment-reflog").click();
  await expect(page.getByTestId("dock-history-reflog-empty")).toContainText(
    "No reflog reader",
  );

  // Run: Start refuses until a command is written — this app guesses none.
  await page.getByTestId("dock-tab-run").click();
  await expect(page.getByTestId("dock-run-start")).toBeDisabled();
  await expect(page.getByTestId("dock-run-services-empty")).toContainText(
    "No services read",
  );
});

test("⌘K's tab-less panes still land, named where a tab would light", async ({
  page,
}) => {
  await openDockWorkspace(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.getByTestId("palette-input").fill("notes");
  const row = page.getByTestId("palette-row-pane:notes");
  await expect(row).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("dock-pane-label")).toHaveText("Notes");
  await expect(page.getByTestId("dock")).toHaveAttribute(
    "data-dock-selection",
    "pane:notes",
  );
});

test("one dock, three positions: drawer, float with ⌘\\ and Esc, back right", async ({
  page,
}) => {
  await openDockWorkspace(page);
  const dock = page.getByTestId("dock");

  // Drawer: full width under the terminal, height inside the mockup's clamp.
  await page.getByTestId("dock-position-drawer").click();
  await expect(dock).toHaveAttribute("data-dock-position", "drawer");
  const surface = await page.getByTestId("work-surface").boundingBox();
  const drawer = await dock.boundingBox();
  if (surface === null || drawer === null) throw new Error("unmeasured");
  // Full width less the card's own gutters.
  expect(drawer.width).toBeGreaterThan(surface.width - 12);
  expect(drawer.height).toBeGreaterThanOrEqual(170);
  expect(drawer.height).toBeLessThanOrEqual(480);

  // Float: the switcher's third button, the centered panel, Esc docks back
  // to the RIGHT card — the mockup's own reading (vingilot.js:51).
  await page.getByTestId("dock-position-float").click();
  await expect(page.getByTestId("dock-float")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("dock-float")).toHaveCount(0);
  await expect(dock).toHaveAttribute("data-dock-position", "right");

  // ⌘\ toggles float↔right from the keyboard.
  await page.keyboard.press("ControlOrMeta+\\");
  await expect(page.getByTestId("dock-float")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+\\");
  await expect(page.getByTestId("dock-float")).toHaveCount(0);
  await expect(dock).toHaveAttribute("data-dock-position", "right");
});

test("⌥⌘B is zen — the dock hides onto its rail and comes back", async ({
  page,
}) => {
  await openDockWorkspace(page);
  await page.keyboard.press("ControlOrMeta+Alt+b");
  await expect(page.getByTestId("dock")).toHaveCount(0);
  await expect(page.getByTestId("pane-right-rail")).toBeVisible();
  await page.getByTestId("pane-right-expand").click();
  await expect(page.getByTestId("dock")).toBeVisible();
});

test("the right card's resize clamps at the mockup's 300..540", async ({
  page,
}) => {
  await openDockWorkspace(page);
  const dock = page.getByTestId("dock");
  const resizer = page.getByTestId("dock-resizer");
  await resizer.focus();

  // Grow past the ceiling: ⇧← in 64px steps, far more than 540 needs.
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press("Shift+ArrowLeft");
  }
  let box = await dock.boundingBox();
  if (box === null) throw new Error("unmeasured");
  expect(Math.round(box.width)).toBeLessThanOrEqual(540);
  expect(Math.round(box.width)).toBeGreaterThanOrEqual(538);

  // Shrink past the floor: the card stops at 300, never a sliver.
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press("Shift+ArrowRight");
  }
  box = await dock.boundingBox();
  if (box === null) throw new Error("unmeasured");
  expect(Math.round(box.width)).toBeGreaterThanOrEqual(300);
  expect(Math.round(box.width)).toBeLessThanOrEqual(302);
});

test("Start Dev opens a fresh shell and types the command into it", async ({
  page,
}) => {
  await openDockWorkspace(page);
  await page.getByTestId("dock-tab-run").click();
  await page.getByTestId("dock-run-command").fill("pnpm dev");
  await page.getByTestId("dock-run-start").click();

  // A really fresh shell — tab 2's pty opened…
  await expect
    .poll(() => page.evaluate(() => window.__DOCK_PROBE__.opens))
    .toContain(`${BINDING}#2`);
  // …and the command TYPED into exactly that session, newline and all.
  await expect
    .poll(() => page.evaluate(() => window.__DOCK_PROBE__.writes))
    .toContainEqual({ data: "pnpm dev\n", session: `${BINDING}#2` });
});

test("New terminal here cds a fresh shell into the row's own directory", async ({
  page,
}) => {
  await openDockWorkspace(page);
  await page.getByTestId("dock-tab-files").click();
  await page.getByTestId("dock-files-row-src").click({ button: "right" });
  await waitForAnimations(page);
  await page.getByTestId("dock-files-ctx-terminal").click();

  await expect
    .poll(() => page.evaluate(() => window.__DOCK_PROBE__.writes))
    .toContainEqual({
      // The path rides through `shellEscapePath`, single-quoted — the same
      // escaping a dropped Finder path already gets.
      data: `cd '${REPO.path}/src'\n`,
      session: `${BINDING}#2`,
    });
});

test("p3 shots: the dock's six tabs, the drawer, the float", async ({
  page,
}) => {
  await openDockWorkspace(page);
  const shot = async (name: string) => {
    await waitForAnimations(page);
    await page.screenshot({ path: `test-results/p3-shots/${name}.png` });
  };

  await page.getByTestId("dock-tab-crew").click();
  await expect(page.getByTestId("pane-team")).toBeVisible();
  await shot("dock-right-crew");

  await page.getByTestId("dock-tab-diff").click();
  await expect(page.getByTestId("dock")).toHaveAttribute(
    "data-dock-selection",
    "diff",
  );
  await shot("dock-right-diff");

  await page.getByTestId("dock-tab-files").click();
  await expect(page.getByTestId("dock-files-tree")).toBeVisible();
  await page.getByTestId("dock-files-row-src").click();
  await expect(page.getByTestId("dock-files-mark-src/greet.ts")).toBeVisible();
  await shot("dock-right-files");

  await page.getByTestId("dock-tab-checks").click();
  await expect(page.getByTestId("dock-checks-empty")).toBeVisible();
  await shot("dock-right-checks");

  await page.getByTestId("dock-tab-history").click();
  await expect(
    page.getByTestId(`dock-history-commit-${"a".repeat(40)}`),
  ).toBeVisible();
  await shot("dock-right-history");

  await page.getByTestId("dock-tab-run").click();
  await expect(page.getByTestId("dock-run")).toBeVisible();
  await shot("dock-right-run");

  await page.getByTestId("dock-position-drawer").click();
  await expect(page.getByTestId("dock")).toHaveAttribute(
    "data-dock-position",
    "drawer",
  );
  await shot("dock-drawer");

  await page.getByTestId("dock-position-float").click();
  await expect(page.getByTestId("dock-float")).toBeVisible();
  await shot("dock-float");
});
