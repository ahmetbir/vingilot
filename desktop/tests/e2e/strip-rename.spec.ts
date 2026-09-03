// Naming a task and naming a terminal (2026-08-29 redesign, P4.5), proved over
// the real strips, the real key path and a recorded pty bridge.
//
// A name is the one piece of a strip the owner writes himself, so what this
// spec pins is not "the field opens" but every promise the field makes:
//
// - **Four doors, one editor** — a double-click on the chip, a double-click on
//   the tab, the tab menu's Rename…, and ⌘K's two rows all land in the same
//   field (`ui/StripNameEditor.tsx`).
// - **Enter commits, Escape reverts to the PREVIOUS name, blur commits.** The
//   revert is the one worth a test of its own: an Escape that put the *default*
//   back would be a rename nobody could safely change their mind about.
// - **An empty commit restores the default**, rather than leaving a chip with
//   nothing written on it (`lib/stripName.ts`, `lib/taskStrip.ts`).
// - **The name survives a reload** — it rides in the same `.v1` record the tabs
//   do (`lib/terminalTabStore.ts`, `lib/taskStripStore.ts`).
// - **A long name shortens its own tab and never the strip**: the `+` stays
//   inside the strip and stays clickable.
// - **The scratch tab refuses.** It keeps nothing by design, so a name it would
//   lose on close is a promise this app cannot keep — it offers no double-click
//   and no menu at all.
// - **A blocked palette row is drawn and refuses**, in the reading's own words
//   (`lib/tabMenu.ts`'s `renameRefusal`), rather than disappearing.
// - **While the caret is in the field, the strip's chords are not.** ⌘W, ⇧⌘W,
//   ⌘T, ⌘\ and ⇧⌘\ are pressed with the field focused and nothing closes, opens
//   or splits; Escape, and the same chord works again.
// - **The name rides the ORDINAL, and the ordinal names the pty.** A rename
//   survives a reorder and a move to the other half of a split stage, and no
//   pty is opened or closed to make it happen.
//
// The harness is `tab-split.spec.ts`'s, for the same reason that one has it:
// this island's behaviour is only true against a mocked shell that actually
// replays a screen, and against a probe that can say whether a pty moved.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
/** The 16-inch MacBook Pro's default logical resolution — his own machine. */
const SIXTEEN_INCH = { height: 1117, width: 1728 };
const SHOTS = process.env.P45_SHOTS ?? null;

const GIT_HOME = "/tmp/vingilot-strip-rename-home";
const REPO = {
  id: "repo-striprename",
  name: "vingilot",
  path: "/tmp/vingilot-striprename",
};
const WORKTREE = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-striprename",
  branch: "spike",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-striprename",
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
};

const PATCH = `@@ -1,4 +1,4 @@
 use std::io;

-fn greet(name: &str) -> String {
+fn greet(name: &str, loud: bool) -> String {
`;

/** What the mocked shell replays on attach, so a strip screenshot sits over a
 * terminal rather than over a black rectangle. */
const SCREEN = [
  "\u001b[32m➜\u001b[0m  \u001b[36mvingilot\u001b[0m \u001b[33mgit:(spike)\u001b[0m cargo test -p vingilot-pty\r\n",
  "    \u001b[32mFinished\u001b[0m test profile in 4.10s\r\n",
  "\r\ntest result: \u001b[32mok\u001b[0m. 2 passed; 0 failed\r\n\r\n",
  "\u001b[32m➜\u001b[0m  \u001b[36mvingilot\u001b[0m \u001b[33mgit:(spike)\u001b[0m ",
].join("");

type PtyProbe = { closes: string[]; opens: string[] };

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
  __RENAME_PROBE__: PtyProbe;
};

declare global {
  interface Window {
    __RENAME_PROBE__: PtyProbe;
  }
}

/** Every Tauri command this island needs, plus a recording of the two pty calls
 * that "the pty is the same one" is about. The property trap is
 * `view-tabs.spec.ts`'s idiom: the bridge assigns `invoke` at boot, after any
 * init script, so the trap captures it as `fallback` rather than being
 * overwritten by it. */
async function installTrap(page: Page) {
  await page.addInitScript(
    ([home, patch, screen]: [string, string, string]) => {
      const w = window as unknown as TrapWindow;
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;
      const probe: PtyProbe = { closes: [], opens: [] };
      w.__RENAME_PROBE__ = probe;

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
            path: "src/greet.rs",
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
        if (name === "worktree_diff")
          return Promise.resolve(diff(payload.base ?? "HEAD"));
        if (name === "pty_backing") return Promise.resolve("tmux");
        if (name === "pty_copy_mode") return Promise.resolve(false);
        if (name === "pty_open") {
          probe.opens.push(payload.session);
          queueMicrotask(() => {
            void fallback?.("plugin:event|emit", {
              event: "vingilot://pty",
              payload: {
                data: screen,
                replay: true,
                seq: 0,
                session: payload.session,
              },
            });
          });
          return Promise.resolve(null);
        }
        if (name === "pty_close") {
          probe.closes.push(payload.session);
          return Promise.resolve(null);
        }
        if (name.startsWith("pty_")) return Promise.resolve(null);
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
    [GIT_HOME, PATCH, SCREEN] as const,
  );
}

async function mockCoordinator(page: Page) {
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
}

/** This worktree's two strips, on screen. Its own function because the reload
 * test walks back in through it. */
async function landOnWorktree(page: Page) {
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await page.getByTestId(`worktree-row-${WORKTREE.binding_id}`).click();
  await expect(page.getByTestId("terminal-tab-strip")).toBeVisible();
  await expect(page.getByTestId("task-strip")).toBeVisible();
}

async function openWorkspace(page: Page) {
  await page.setViewportSize(SIXTEEN_INCH);
  await installTrap(page);
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await landOnWorktree(page);
}

/** Everything the app has asked of a pty so far, as one comparable value. */
async function ptyCalls(page: Page) {
  return page.evaluate(() => ({
    closes: [...window.__RENAME_PROBE__.closes],
    opens: [...window.__RENAME_PROBE__.opens],
  }));
}

/** A @dnd-kit drag: press, move past the 6px activation distance in steps so
 * the sensor and the collision detector both see it, then release. */
async function dragTo(page: Page, from: string, to: { x: number; y: number }) {
  const box = await page.getByTestId(from).boundingBox();
  if (box === null) throw new Error(`no box for ${from}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, {
    steps: 4,
  });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  return async () => {
    await page.mouse.up();
  };
}

/** Type into an already-open editor. `fill` rather than `type`, because the
 * field opens with its seed selected and a first keystroke replaces it. */
async function typeName(page: Page, testid: string, name: string) {
  const field = page.getByTestId(testid);
  await expect(field).toBeFocused();
  await field.fill(name);
}

/** Somewhere inert to click, which is what a blur is. */
async function clickAway(page: Page) {
  await page.getByTestId("task-strip-hint").click();
}

test("a double-click on either strip opens the same field, and Enter keeps what was typed", async ({
  page,
}) => {
  await openWorkspace(page);

  // ── The chip ────────────────────────────────────────────────────────────
  const chip = page.getByTestId("task-chip-1");
  await expect(chip).toContainText("task 1");
  await chip.dblclick();
  await typeName(page, "task-chip-rename-1", "release prep");

  if (SHOTS !== null) {
    await waitForAnimations(page);
    await page
      .getByTestId("task-strip")
      .screenshot({ path: `${SHOTS}/01-chip-mid-rename.png` });
  }

  await page.keyboard.press("Enter");
  await expect(page.getByTestId("task-chip-rename-1")).toHaveCount(0);
  await expect(chip).toContainText("release prep");
  // The chip's tooltip carries the whole of it: the name, and what it holds.
  await expect(page.getByTestId("task-chip-select-1")).toHaveAttribute(
    "title",
    "release prep — 1 terminal",
  );

  // ── The tab ─────────────────────────────────────────────────────────────
  // Unnamed, a tab wears its ordinal and nothing else.
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("1");
  await page.getByTestId("terminal-tab-shell-1").dblclick();
  await typeName(page, "terminal-tab-rename-1", "cargo watch");

  if (SHOTS !== null) {
    await waitForAnimations(page);
    await page
      .getByTestId("terminal-tab-strip")
      .screenshot({ path: `${SHOTS}/02-tab-mid-rename.png` });
  }

  await page.keyboard.press("Enter");
  await expect(page.getByTestId("terminal-tab-rename-1")).toHaveCount(0);
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("cargo watch");
  // The ordinal is not lost, only demoted: the tooltip still says which shell
  // this is, because the name is the owner's word and the ordinal is the app's.
  await expect(page.getByTestId("terminal-tab-1")).toHaveAttribute(
    "title",
    "cargo watch — terminal 1",
  );
});

test("Escape puts the PREVIOUS name back, blur commits, and an empty commit restores the default", async ({
  page,
}) => {
  await openWorkspace(page);

  const tab = page.getByTestId("terminal-tab-1");
  await page.getByTestId("terminal-tab-shell-1").dblclick();
  await typeName(page, "terminal-tab-rename-1", "first");
  await page.keyboard.press("Enter");
  await expect(tab).toHaveText("first");

  // Escape reverts to what was there a moment ago — not to the default. A
  // rename you cannot change your mind about is a rename you do not start.
  await page.getByTestId("terminal-tab-shell-1").dblclick();
  await typeName(page, "terminal-tab-rename-1", "second");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("terminal-tab-rename-1")).toHaveCount(0);
  await expect(tab).toHaveText("first");

  // Blur commits, the answer every renameable label in his day gives.
  await page.getByTestId("terminal-tab-shell-1").dblclick();
  await typeName(page, "terminal-tab-rename-1", "third");
  await clickAway(page);
  await expect(page.getByTestId("terminal-tab-rename-1")).toHaveCount(0);
  await expect(tab).toHaveText("third");

  // Committing nothing is not "call it the empty string" — it is "take the
  // name off", and an unnamed tab is the one the app named.
  await page.getByTestId("terminal-tab-shell-1").dblclick();
  await typeName(page, "terminal-tab-rename-1", "");
  await page.keyboard.press("Enter");
  await expect(tab).toHaveText("1");
  await expect(tab).toHaveAttribute("title", "Terminal 1");

  // The same on the chip, and whitespace is nothing (`normalizeStripName`).
  const chip = page.getByTestId("task-chip-1");
  await chip.dblclick();
  await typeName(page, "task-chip-rename-1", "shipping");
  await page.keyboard.press("Enter");
  await expect(chip).toContainText("shipping");
  await chip.dblclick();
  await typeName(page, "task-chip-rename-1", "   ");
  await page.keyboard.press("Enter");
  await expect(chip).toContainText("task 1");
});

test("both names survive a reload", async ({ page }) => {
  await openWorkspace(page);

  await page.getByTestId("task-chip-1").dblclick();
  await typeName(page, "task-chip-rename-1", "release prep");
  await page.keyboard.press("Enter");
  await page.getByTestId("terminal-tab-shell-1").dblclick();
  await typeName(page, "terminal-tab-rename-1", "cargo watch");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("cargo watch");

  await page.reload();
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await landOnWorktree(page);

  // The whole point of the additive `.v1` record: the tabs came back, and so
  // did what he called them.
  await expect(page.getByTestId("task-chip-1")).toContainText("release prep");
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("cargo watch");

  if (SHOTS !== null) {
    await waitForAnimations(page);
    await page
      .getByTestId("task-strip")
      .screenshot({ path: `${SHOTS}/03-chip-after-reload.png` });
    await page
      .getByTestId("terminal-tab-strip")
      .screenshot({ path: `${SHOTS}/04-tab-after-reload.png` });
  }
});

test("the tab menu's Rename… and the palette's two rows open the same field", async ({
  page,
}) => {
  await openWorkspace(page);

  // The menu's sixth row, which only a shell tab gets (`lib/tabMenu.ts`).
  await page.getByTestId("terminal-tab-shell-1").click({ button: "right" });
  const menu = page.locator('[data-testid^="tab-menu-term:"]');
  await expect(menu).toBeVisible();
  await menu.getByTestId("tab-menu-rename").click();
  await typeName(page, "terminal-tab-rename-1", "by menu");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("by menu");

  // ⌘K's terminal row — the door for the owner who types rather than points.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("Rename this terminal");
  const terminalRow = page.getByTestId(
    "palette-row-action:rename-terminal-tab",
  );
  await expect(terminalRow).toBeVisible();
  await terminalRow.click();
  await typeName(page, "terminal-tab-rename-1", "by palette");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("by palette");

  // And ⌘K's task row, which is the only door onto the chip's field that is
  // not a double-click.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("Rename this task");
  const taskRow = page.getByTestId("palette-row-action:rename-task");
  await expect(taskRow).toBeVisible();
  await taskRow.click();
  await typeName(page, "task-chip-rename-1", "by palette too");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("task-chip-1")).toContainText("by palette too");
});

test("the palette's terminal row refuses a reading in the reading's own words", async ({
  page,
}) => {
  await openWorkspace(page);

  // A reading of this worktree's diff, focused. Its label is what it shows, so
  // a renameable one would be a tab whose name had stopped being true.
  await page.getByTestId("dock-tab-diff").click();
  await expect(page.getByTestId("dock").getByTestId("pane-diff")).toBeVisible();
  await page.getByTestId("worktree-diff-open-tab").click();
  await expect(page.locator('[data-testid^="view-tab-diff:"]')).toBeVisible();

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("palette-input").fill("Rename this terminal");
  const row = page.getByTestId("palette-row-action:rename-terminal-tab");
  // Drawn, and refusing — never absent. A row that vanished would answer
  // "there is no such command", which is a different and false statement.
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-blocked", "true");
  await expect(row).toContainText(
    "this tab is a reading, and its name is what it shows — rename the file, not the tab.",
  );
  // Enter on a blocked row does nothing at all: no field opens, and the palette
  // is still the thing on screen. Pressed rather than clicked, because the row
  // reports itself disabled to the platform (`aria-disabled`) and a pointer
  // never reaches it — the keyboard is the only way to ask a blocked row to
  // run, which is exactly the way that has to be answered with a refusal.
  await expect(row).toHaveAttribute("aria-disabled", "true");
  await expect(row).toHaveAttribute("data-active", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("palette")).toBeVisible();
  await expect(
    page.locator('[data-testid^="terminal-tab-rename-"]'),
  ).toHaveCount(0);
});

test("the scratch tab refuses: no double-click, no menu, no name", async ({
  page,
}) => {
  await openWorkspace(page);
  await page
    .getByTestId(`terminal-split-host-${WORKTREE.binding_id}#1`)
    .locator(".xterm-screen")
    .click();
  await page.keyboard.press("ControlOrMeta+Alt+t");

  const scratch = page.getByTestId("terminal-tab-scratch");
  await expect(scratch).toBeVisible();
  await expect(scratch).toContainText("scratch");

  // A shell that keeps nothing cannot keep a name either, so the gesture that
  // opens an editor everywhere else opens nothing here.
  await scratch.dblclick();
  await expect(
    page.locator('[data-testid^="terminal-tab-rename-"]'),
  ).toHaveCount(0);
  await expect(page.locator('[data-testid^="task-chip-rename-"]')).toHaveCount(
    0,
  );
  await expect(scratch).toContainText("scratch");

  // And it offers no affordance to find: no menu of its own, therefore no
  // Rename… row to be refused by.
  await scratch.click({ button: "right" });
  await expect(page.locator('[data-testid^="tab-menu-"]')).toHaveCount(0);
  await expect(page.getByTestId("tab-menu-rename")).toHaveCount(0);
});

test("with the caret in a name, ⌘ chords do not close, open or split anything", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByTestId("terminal-tab-new").click();
  await expect(page.getByTestId("terminal-tab-2")).toBeVisible();

  const before = await ptyCalls(page);
  await page.getByTestId("terminal-tab-shell-2").dblclick();
  const field = page.getByTestId("terminal-tab-rename-2");
  await expect(field).toBeFocused();

  // The w, the t and the \, each with ⌘ held — the chords that would otherwise
  // close this tab, open a task and split the terminal and the stage.
  await page.keyboard.press("ControlOrMeta+w");
  await page.keyboard.press("ControlOrMeta+Shift+w");
  await page.keyboard.press("ControlOrMeta+t");
  await page.keyboard.press("ControlOrMeta+\\");
  await page.keyboard.press("ControlOrMeta+Shift+\\");

  // Nothing closed, nothing opened, nothing split — and the field still has
  // the keyboard.
  await expect(field).toBeFocused();
  await expect(page.getByTestId("terminal-tab-shell-2")).toBeVisible();
  await expect(page.getByTestId("terminal-tab-3")).toHaveCount(0);
  await expect(page.getByTestId("task-chip-2")).toHaveCount(0);
  await expect(page.getByTestId("tab-split-divider")).toHaveCount(0);
  expect(await ptyCalls(page)).toEqual(before);

  // Escape, and the keyboard is the workspace's again: the chord refused a
  // moment ago now does exactly what it says.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("terminal-tab-rename-2")).toHaveCount(0);
  await page
    .getByTestId(`terminal-split-host-${WORKTREE.binding_id}#2`)
    .locator(".xterm-screen")
    .click();
  await page.keyboard.press("ControlOrMeta+t");
  await expect(page.getByTestId("task-chip-2")).toHaveAttribute(
    "data-active",
    "true",
  );
});

test("a long name shortens its own tab and never pushes the strip's + off screen", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByTestId("terminal-tab-new").click();
  await page.getByTestId("terminal-tab-new").click();
  await expect(page.getByTestId("terminal-tab-3")).toBeVisible();

  const plus = page.getByTestId("terminal-tab-new");
  const strip = page.getByTestId("terminal-tab-strip");

  // The longest name the field will take (`STRIP_NAME_MAX` is 32), on all three.
  const long = "release-candidate-verification!!";
  for (const n of [1, 2, 3]) {
    await page.getByTestId(`terminal-tab-shell-${n}`).dblclick();
    await typeName(page, `terminal-tab-rename-${n}`, long);
    await page.keyboard.press("Enter");
  }
  await expect(page.getByTestId("terminal-tab-1")).toHaveText(long);

  // The whole name is in the tooltip; the strip shows what it has room for and
  // clips the rest at the tab's own 9rem cap.
  await expect(page.getByTestId("terminal-tab-1")).toHaveAttribute(
    "title",
    `${long} — terminal 1`,
  );
  const labelBox = await page
    .getByTestId("terminal-tab-1")
    .locator("span.truncate")
    .boundingBox();
  if (labelBox === null) throw new Error("no label box");
  const cap = await page.evaluate(
    () =>
      9 *
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
  expect(labelBox.width).toBeLessThanOrEqual(cap + 1);

  // And the + is still inside the strip, still on screen, still the button
  // that adds a tab.
  const stripBox = await strip.boundingBox();
  const plusBox = await plus.boundingBox();
  if (stripBox === null || plusBox === null) throw new Error("no boxes");
  expect(plusBox.x).toBeGreaterThanOrEqual(stripBox.x - 1);
  expect(plusBox.x + plusBox.width).toBeLessThanOrEqual(
    stripBox.x + stripBox.width + 1,
  );
  await expect(plus).toBeInViewport();
  await plus.click();
  await expect(page.getByTestId("terminal-tab-4")).toBeVisible();
});

test("the name rides the ordinal: through a reorder, and across a split stage", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByTestId("terminal-tab-new").click();
  await page.getByTestId("terminal-tab-new").click();
  await expect(page.getByTestId("terminal-tab-3")).toBeVisible();

  await page.getByTestId("terminal-tab-shell-3").dblclick();
  await typeName(page, "terminal-tab-rename-3", "runner");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("terminal-tab-3")).toHaveText("runner");

  const before = await ptyCalls(page);
  const scroller = page.getByTestId("terminal-tab-scroller");
  const order = async () =>
    scroller
      .locator('[data-testid^="terminal-tab-shell-"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-testid")),
      );
  expect(await order()).toEqual([
    "terminal-tab-shell-1",
    "terminal-tab-shell-2",
    "terminal-tab-shell-3",
  ]);

  // Tab 3 onto tab 1's seat. A reorder rewrites a list of numbers; the name is
  // stored against the ordinal, so it travels with the shell for free.
  const firstBox = await page.getByTestId("terminal-tab-shell-1").boundingBox();
  if (firstBox === null) throw new Error("no first tab box");
  const drop = await dragTo(page, "terminal-tab-shell-3", {
    x: firstBox.x + firstBox.width / 2,
    y: firstBox.y + firstBox.height / 2,
  });
  await drop();
  expect(await order()).toEqual([
    "terminal-tab-shell-3",
    "terminal-tab-shell-1",
    "terminal-tab-shell-2",
  ]);
  await expect(page.getByTestId("terminal-tab-3")).toHaveText("runner");

  // Split the stage, then move the named tab into the other half.
  await page.getByTestId("terminal-tab-1").click();
  await page.keyboard.press("ControlOrMeta+Shift+\\");
  await expect(page.getByTestId("tab-split-divider")).toBeVisible();

  const stage = await page.getByTestId("pane-left").boundingBox();
  if (stage === null) throw new Error("no stage box");
  const dropEdge = await dragTo(page, "terminal-tab-shell-3", {
    x: stage.x + stage.width - 60,
    y: stage.y + stage.height / 2,
  });
  await dropEdge();
  await expect(page.getByTestId("terminal-tab-shell-3")).toHaveAttribute(
    "data-half",
    "right",
  );

  // The name followed the shell across the stage, and the shell is the same
  // shell: nothing was opened and nothing was closed to move it.
  await expect(page.getByTestId("terminal-tab-3")).toHaveText("runner");
  expect(await ptyCalls(page)).toEqual(before);
});

// ───────────────────────── VERIFY PROBE (temporary) ─────────────────────────

const WORKTREE_B = {
  ...WORKTREE,
  binding_id: "wt-striprename-b",
  branch: "spike-b",
  owner_run_id: "run-striprename-b",
};

async function openTwo(page: Page, live: { current: unknown[] }) {
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
      return route.fulfill({ json: { worktrees: live.current } });
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
}

async function landOn(page: Page, bindingId: string) {
  await page.getByTestId(`worktree-row-${bindingId}`).click();
  await expect(page.getByTestId("terminal-tab-strip")).toBeVisible();
  await expect(page.getByTestId("task-strip")).toBeVisible();
}

test("⌥⌘T reaches the scratch shell from inside a name, and leaving commits", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByTestId("terminal-tab-shell-1").dblclick();
  const field = page.getByTestId("terminal-tab-rename-1");
  await expect(field).toBeFocused();
  await field.fill("alt-cmd-t");
  await page.keyboard.press("ControlOrMeta+Alt+t");
  await expect(page.getByTestId("terminal-tab-scratch")).toBeVisible({
    timeout: 4000,
  });
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("alt-cmd-t");
});

test("⌘` reaches the terminal from inside a name, and leaving commits", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByTestId("terminal-tab-shell-1").dblclick();
  const field = page.getByTestId("terminal-tab-rename-1");
  await expect(field).toBeFocused();
  await field.fill("backtick");
  await page.keyboard.press("ControlOrMeta+`");
  // Leaving that way blurs the field, which commits.
  await expect(page.getByTestId("terminal-tab-rename-1")).toHaveCount(0, {
    timeout: 4000,
  });
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("backtick");
});

test("leaving the worktree while a name is half typed keeps the name", async ({
  page,
}) => {
  // **The exit that fires no blur.** The three deliberate ways out of the
  // editor — Enter, Escape, clicking away — are covered above. This is the
  // fourth: the field is taken off screen by something happening elsewhere,
  // and React fires no blur on unmount, so without an unmount handler the name
  // goes down with the field. Silent loss, and indistinguishable from a rename
  // that did not work.
  //
  // Driven through the worktree row rather than through ⌘2. An earlier version
  // of this test pressed the chord, and the chord does not switch worktrees
  // under this fixture AT ALL — measured with the editor closed, so it is not
  // a fact about renaming and this spec is not the place to assert it. The row
  // is the door the fixture has, and it unmounts the field exactly the same
  // way, which is the part this test is about.
  const live = { current: [WORKTREE, WORKTREE_B] as unknown[] };
  await openTwo(page, live);
  await landOn(page, WORKTREE.binding_id);
  await page.getByTestId("terminal-tab-shell-1").dblclick();
  const field = page.getByTestId("terminal-tab-rename-1");
  await expect(field).toBeFocused();
  await field.fill("switcher");
  await landOn(page, WORKTREE_B.binding_id);
  // It closed rather than following him: the editor was about the strip he
  // left, and a strip it was never about must not open wearing it.
  await expect(page.getByTestId("terminal-tab-rename-1")).toHaveCount(0);
  await landOn(page, WORKTREE.binding_id);
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("switcher");
});

test("names survive a worktree switch and back, and a pruned worktree leaves none behind", async ({
  page,
}) => {
  const live = { current: [WORKTREE, WORKTREE_B] as unknown[] };
  await openTwo(page, live);

  await landOn(page, WORKTREE.binding_id);
  await page.getByTestId("terminal-tab-shell-1").dblclick();
  await typeName(page, "terminal-tab-rename-1", "alpha");
  await page.keyboard.press("Enter");
  await page.getByTestId("task-chip-1").dblclick();
  await typeName(page, "task-chip-rename-1", "chip-alpha");
  await page.keyboard.press("Enter");

  await landOn(page, WORKTREE_B.binding_id);
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("1");
  await page.getByTestId("terminal-tab-shell-1").dblclick();
  await typeName(page, "terminal-tab-rename-1", "beta");
  await page.keyboard.press("Enter");

  await landOn(page, WORKTREE.binding_id);
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("alpha");
  await expect(page.getByTestId("task-chip-1")).toContainText("chip-alpha");

  // The stored record is additive: the three fields an older reader knows are
  // untouched, and `names` sits beside them.
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vingilot-terminal-tabs.v1") ?? "{}"),
  );
  // Both worktrees he visited are in the record. Not an exact key set: the
  // repo's own main worktree gets an entry too, from having been the landing
  // place, and asserting the whole set makes this test fail for a reason that
  // has nothing to do with names.
  expect(Object.keys(stored)).toEqual(
    expect.arrayContaining([WORKTREE.binding_id, WORKTREE_B.binding_id]),
  );
  expect(stored[WORKTREE.binding_id].tabs).toEqual([1]);
  expect(stored[WORKTREE.binding_id].names).toEqual({ "1": "alpha" });
  expect(stored[WORKTREE_B.binding_id].names).toEqual({ "1": "beta" });
  // An older reader copying only the fields it knows loses labels, not tabs.
  const older = Object.fromEntries(
    Object.entries(stored as Record<string, Record<string, unknown>>).map(
      ([k, v]) => [k, { active: v.active, nextN: v.nextN, tabs: v.tabs }],
    ),
  );
  expect(older[WORKTREE.binding_id]).toEqual({
    active: 1,
    nextN: 2,
    tabs: [1],
  });
  // Every entry survives that trip, whichever worktrees the workspace has —
  // the point is that dropping `names` costs labels and nothing else.
  expect(Object.keys(older).sort()).toEqual(Object.keys(stored).sort());

  // Prune B: it leaves the workspace, and its name leaves with it.
  live.current = [WORKTREE];
  await page.reload();
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await landOn(page, WORKTREE.binding_id);
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("alpha");
  await expect(
    page.getByTestId(`worktree-row-${WORKTREE_B.binding_id}`),
  ).toHaveCount(0);
  await expect
    .poll(
      async () =>
        await page.evaluate(() =>
          Object.keys(
            JSON.parse(
              localStorage.getItem("vingilot-terminal-tabs.v1") ?? "{}",
            ),
          ),
        ),
      { timeout: 8000 },
    )
    // The pruned worktree's entry is gone and the surviving one is not. Stated
    // as those two facts rather than as the whole key set, because the repo's
    // main worktree has an entry of its own and it is not what "a pruned
    // worktree leaves nothing" is about.
    .toEqual(expect.not.arrayContaining([WORKTREE_B.binding_id]));
  const left = await page.evaluate(() =>
    Object.keys(
      JSON.parse(localStorage.getItem("vingilot-terminal-tabs.v1") ?? "{}"),
    ),
  );
  expect(left).toContain(WORKTREE.binding_id);
});

test("a view tab has no rename affordance, and Escape-then-blur keeps the previous name", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByTestId("terminal-tab-shell-1").dblclick();
  await typeName(page, "terminal-tab-rename-1", "first");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("first");

  // Escape reverts; the blur that follows must NOT commit the discarded text.
  await page.getByTestId("terminal-tab-shell-1").dblclick();
  await typeName(page, "terminal-tab-rename-1", "discarded");
  await page.keyboard.press("Escape");
  await clickAway(page);
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("first");

  // The scrollback the shell had before the rename is still the shell's.
  await expect(
    page.getByTestId(`terminal-split-host-${WORKTREE.binding_id}#1`),
  ).toContainText("test result:");

  // A reading refuses the gesture, not only the palette row.
  await page.getByTestId("dock-tab-diff").click();
  await expect(page.getByTestId("dock").getByTestId("pane-diff")).toBeVisible();
  await page.getByTestId("worktree-diff-open-tab").click();
  const view = page.locator('[data-testid^="view-tab-diff:"]');
  await expect(view).toBeVisible();
  await view.dblclick();
  await expect(
    page.locator('[data-testid^="terminal-tab-rename-"]'),
  ).toHaveCount(0);
  await view.click({ button: "right" });
  await expect(page.getByTestId("tab-menu-rename")).toHaveCount(0);
});

// ─────────────────── REPO SWITCH (his report, 2026-08-30) ───────────────────
//
// The worktree-switch test above passes and the owner still loses names, so
// what it does not do is the subject: it holds ONE project. This one holds two
// and crosses between them, because "repo degistirmede kalici degil" is a
// different journey through `dropWorktreesTo` — the live worktree set is
// rebuilt from a different project's listing.

const REPO_B = {
  id: "repo-striprename-2",
  name: "second-project",
  path: "/tmp/vingilot-striprename-2",
};

const WORKTREE_C = {
  ...WORKTREE,
  binding_id: "wt-striprename-c",
  branch: "spike-c",
  owner_run_id: "run-striprename-c",
  repo_id: REPO_B.id,
};

async function openTwoRepos(page: Page) {
  await page.setViewportSize(SIXTEEN_INCH);
  await installTrap(page);
  await installMockBridge(page);
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state: { repos: [REPO, REPO_B] },
          state_hash: "mock-state-hash",
        },
      });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`) {
      return route.fulfill({ json: { worktrees: [WORKTREE, WORKTREE_C] } });
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
}

test("a name survives crossing to another project and back", async ({
  page,
}) => {
  await openTwoRepos(page);

  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await landOn(page, WORKTREE.binding_id);
  await page.getByTestId("terminal-tab-shell-1").dblclick();
  await typeName(page, "terminal-tab-rename-1", "alpha");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("alpha");

  // Across to the other project, and stand in one of its worktrees so the
  // crossing is a real visit rather than a click on a nav row.
  await page.getByTestId(`projects-nav-repo-${REPO_B.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await landOn(page, WORKTREE_C.binding_id);
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("1");

  // Back. The name is what this is about.
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await landOn(page, WORKTREE.binding_id);
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("alpha");

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vingilot-terminal-tabs.v1") ?? "{}"),
  );
  expect(stored[WORKTREE.binding_id]?.names).toEqual({ "1": "alpha" });
});
