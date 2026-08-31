// The tab strip's editor manners — redesign P4.7, over the real key path, the
// real strip, and a recorded pty bridge.
//
// > *"cmd w ye filan basinca tab kapanmali. iki tab yan yana acabilmeliyim
// > filan. vscodedaki seyler lazim shortcut ve drag."*
//
// The pure models say what a stage key is, what a close scope names, what a
// reorder does and what ⌘W resolves to (`tabSplit.test.mjs`, `tabMenu.test.mjs`,
// `closeKeys.test.mjs`, and the two tab models' own). What only a browser can
// say is here:
//
// 1. **⌘W really closes the focused tab**, over the whole close stack, and
//    really does NOT when the caret is in a text field.
// 2. **⇧⌘\ really puts two tabs side by side** — a shell and a reading, both
//    drawn, with a divider between them — and **no pty is disturbed by any of
//    it**. That is the round's hardest constraint and it is asserted the way
//    `view-tabs.spec.ts` asserts its own: the recorded `pty_open` /
//    `pty_close` / `pty_write` calls are IDENTICAL across splitting the stage,
//    moving a tab between halves, dragging the divider, and putting the stage
//    back.
// 3. **A drag really reorders**, and a drag out over the stage's edge really
//    starts a split — @dnd-kit pointer events, which is the app's own drag
//    vocabulary and the only one that works in this window (`TabDnd.tsx`
//    carries why HTML5 drag does not).
// 4. **Middle-click closes, and the context menu's five rows do what they
//    say.**
//
// The three names are kept apart deliberately here too: a diff in its own
// **Split rendering mode**, inside a tab that is itself in a **tab split**,
// beside a shell — three dividers on screen, and the spec asserts each of the
// two this round can reach by its own testid.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
/** The 16-inch MacBook Pro's default logical resolution — his own machine, and
 * wide enough that the diff's Split mode is not refused. */
const SIXTEEN_INCH = { height: 1117, width: 1728 };
const SHOTS = process.env.P47_SHOTS ?? null;

const GIT_HOME = "/tmp/vingilot-tab-split-home";
const REPO = {
  id: "repo-tabsplit",
  name: "vingilot",
  path: "/tmp/vingilot-tabsplit",
};
const WORKTREE = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-tabsplit",
  branch: "spike",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-tabsplit",
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
};

const PATCH = `@@ -1,6 +1,6 @@
 use std::io;

-fn greet(name: &str) -> String {
-    format!("hello {}", name)
+fn greet(name: &str, loud: bool) -> String {
+    format!("hello {}{}", name, if loud { "!" } else { "" })
 }
`;

/** What the mocked shell replays on attach, so the left half of a tab split
 * screenshots as a terminal rather than as a black rectangle. */
const SCREEN = [
  "\u001b[32m\u279c\u001b[0m  \u001b[36mvingilot\u001b[0m \u001b[33mgit:(spike)\u001b[0m cargo test -p vingilot-pty\r\n",
  "   \u001b[32mCompiling\u001b[0m vingilot-pty v0.3.0\r\n",
  "    \u001b[32mFinished\u001b[0m test profile in 4.10s\r\n",
  "     \u001b[32mRunning\u001b[0m unittests src/lib.rs\r\n",
  "\r\ntest tmux::session_name_escapes_every_byte ... \u001b[32mok\u001b[0m\r\n",
  "test tmux::a_session_survives_a_restart ... \u001b[32mok\u001b[0m\r\n",
  "\r\ntest result: \u001b[32mok\u001b[0m. 2 passed; 0 failed\r\n\r\n",
  "\u001b[32m\u279c\u001b[0m  \u001b[36mvingilot\u001b[0m \u001b[33mgit:(spike)\u001b[0m ",
].join("");

type PtyProbe = { closes: string[]; opens: string[]; writes: string[] };

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
  __TAB_SPLIT_PROBE__: PtyProbe;
};

declare global {
  interface Window {
    __TAB_SPLIT_PROBE__: PtyProbe;
  }
}

/** Every Tauri command this island needs, plus a recording of the three pty
 * calls the invariant is about. The property trap is `view-tabs.spec.ts`'s own
 * idiom: the bridge assigns `invoke` at boot, after any init script, so the
 * trap captures it as `fallback` rather than being overwritten by it. */
async function installTrap(page: Page) {
  await page.addInitScript(
    ([home, patch, screen]: [string, string, string]) => {
      const w = window as unknown as TrapWindow;
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;
      const probe: PtyProbe = { closes: [], opens: [], writes: [] };
      w.__TAB_SPLIT_PROBE__ = probe;

      const diff = (base: string) => ({
        additions: 2,
        base,
        deletions: 2,
        files: [
          {
            additions: 2,
            change: "modified",
            deletions: 2,
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
        if (name === "pty_backing") return Promise.resolve("tmux");
        if (name === "pty_copy_mode") return Promise.resolve(false);
        if (name === "pty_open") {
          probe.opens.push(payload.session);
          // A shell with a screen in it. The pty is mocked, so without this the
          // stage's left half would screenshot as a black rectangle — which
          // says nothing about whether the terminal is laid out or hidden.
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
        if (name === "pty_write") {
          probe.writes.push(payload.session);
          return Promise.resolve(null);
        }
        if (name.startsWith("pty_")) return Promise.resolve(null);
        if (name === "worktree_diff") {
          return Promise.resolve(diff(payload.base ?? "HEAD"));
        }
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

async function openWorkspace(page: Page) {
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

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await page.getByTestId(`worktree-row-${WORKTREE.binding_id}`).click();
  await expect(page.getByTestId("terminal-tab-strip")).toBeVisible();
}

/** Everything the app has asked of a pty so far, as one comparable value. */
async function ptyCalls(page: Page) {
  return page.evaluate(() => ({
    closes: [...window.__TAB_SPLIT_PROBE__.closes],
    opens: [...window.__TAB_SPLIT_PROBE__.opens],
    writes: [...window.__TAB_SPLIT_PROBE__.writes],
  }));
}

/** The diff of the worktree, as a tab on the stage. */
async function openDiffTab(page: Page) {
  await page.getByTestId("dock-tab-diff").click();
  await expect(page.getByTestId("dock").getByTestId("pane-diff")).toBeVisible();
  await page.getByTestId("worktree-diff-open-tab").click();
  const tab = page.locator('[data-testid^="view-tab-diff:"]');
  await expect(tab).toBeVisible();
  return tab;
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

test("⌘W closes the focused tab, and a text field keeps its own", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByTestId("terminal-tab-new").click();
  await page.getByTestId("terminal-tab-new").click();
  await expect(page.getByTestId("terminal-tab-3")).toBeVisible();

  // The chord the owner asked for. It reaches the webview because
  // `app_menu.rs` builds this app's menu without `close_window`; before that it
  // was a menu key equivalent and no handler here could ever run.
  // From inside the shell's own screen, which is the iTerm hand this is: the
  // host is named rather than `.first()` because every background tab's xterm
  // is still mounted and merely un-laid-out.
  await page
    .getByTestId(`terminal-split-host-${WORKTREE.binding_id}#3`)
    .locator(".xterm-screen")
    .click();
  await page.keyboard.press("ControlOrMeta+w");
  await expect(page.getByTestId("terminal-tab-3")).toHaveCount(0);
  await expect(page.getByTestId("terminal-tab-2")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // A reading is closed by the same key, and closing it is free — no session
  // is behind it.
  const diffTab = await openDiffTab(page);
  await expect(diffTab).toHaveAttribute("data-active", "true");
  await page.keyboard.press("ControlOrMeta+w");
  await expect(page.locator('[data-testid^="view-tab-diff:"]')).toHaveCount(0);

  // **And the guard.** With the caret in a text field ⌘W is the field's, not
  // the strip's: the palette's own input stands in for the composer here
  // because it is the text field this screen can put a caret in from a
  // keystroke. The palette IS a stacked surface, so ⌘W takes the palette —
  // which is the documented order — and the tab behind it survives.
  const before = await page.getByTestId("terminal-tab-2").count();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.getByTestId("palette-input").click();
  await page.keyboard.press("ControlOrMeta+w");
  await expect(page.getByTestId("palette")).toHaveCount(0);
  await expect(page.getByTestId("terminal-tab-2")).toHaveCount(before);
});

test("⇧⌘\\ puts two tabs on the stage, and no pty learns of it", async ({
  page,
}) => {
  await openWorkspace(page);
  const diffTab = await openDiffTab(page);
  // The diff in its own SPLIT RENDERING MODE — a different thing from the tab
  // split about to happen, and legal underneath it.
  await page.getByTestId("diff-tab-mode-split").click();
  await expect(page.getByTestId("diff-tab-mode-split")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const before = await ptyCalls(page);

  await page.keyboard.press("ControlOrMeta+Shift+\\");

  // Two tabs on the stage: the shell in the left half, the reading in the
  // right, and a divider that is neither of the other two.
  const shellTab = page.getByTestId("terminal-tab-1").locator("xpath=..");
  await expect(shellTab).toHaveAttribute("data-half", "left");
  await expect(diffTab).toHaveAttribute("data-half", "right");
  await expect(page.getByTestId("tab-split-divider")).toBeVisible();
  await expect(
    page.getByTestId("terminal-split-host-wt-tabsplit#1"),
  ).toBeVisible();
  await expect(
    page.getByTestId("work-surface").locator('[data-view-kind="diff"]'),
  ).toBeVisible();
  // The keyboard went with the tab that was split out — VS Code's own answer.
  await expect(diffTab).toHaveAttribute("data-active", "true");

  // Drag the divider, which resizes a live terminal's box on purpose — that is
  // what a divider is for, and it is the ONLY thing about the split a pty can
  // see. Nothing here reattaches or ends one.
  const divider = page.getByTestId("tab-split-divider");
  const dbox = await divider.boundingBox();
  if (dbox === null) throw new Error("no divider box");
  await page.mouse.move(dbox.x + 2, dbox.y + dbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dbox.x + 220, dbox.y + dbox.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(divider).not.toHaveAttribute("aria-valuenow", "50");

  if (SHOTS !== null) {
    // **The shot the round asks for, with two of the three "splits" on screen
    // at once.** ⌥⌘B gives the stage the window (the dock goes to its rail),
    // and the divider is dragged left so the READING has the 695px its own
    // Split MODE needs — at which point the patch draws as two columns with a
    // rule between them, inside a tab that is itself in a TAB SPLIT, beside a
    // shell. Two dividers, two meanings, neither of them called "unified".
    await page.keyboard.press("Alt+ControlOrMeta+b");
    await expect(page.getByTestId("pane-right-rail")).toBeVisible();
    const stage = await page.getByTestId("pane-left").boundingBox();
    const grab = await divider.boundingBox();
    if (stage === null || grab === null) throw new Error("no box to grab");
    await page.mouse.move(grab.x + 2, grab.y + grab.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      stage.x + stage.width * 0.3,
      grab.y + grab.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();
    await expect(
      page
        .getByTestId("work-surface")
        .locator('[data-testid^="history-patch-"]')
        .first(),
    ).toHaveAttribute("data-mode", "split");
    await waitForAnimations(page);
    await page.screenshot({
      path: `${SHOTS}/01-tab-split-diff-beside-shell.png`,
    });
    // Put the dock back, so the assertions below run against the layout the
    // rest of this test set up.
    await page.keyboard.press("Alt+ControlOrMeta+b");
    await expect(page.getByTestId("dock")).toBeVisible();
  }

  // **The invariant.** Splitting the stage, moving the keyboard between halves
  // and dragging the divider have asked nothing of any pty: same opens, same
  // closes, same writes.
  await page.getByTestId("terminal-tab-1").click();
  await expect(shellTab).toHaveAttribute("data-active", "true");
  expect(await ptyCalls(page)).toEqual(before);

  // And putting the stage back is the same chord.
  await page.keyboard.press("ControlOrMeta+Shift+\\");
  await expect(page.getByTestId("tab-split-divider")).toHaveCount(0);
  expect(await ptyCalls(page)).toEqual(before);
});

test("a tab drags to reorder, and out over the stage's edge to split", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByTestId("terminal-tab-new").click();
  await page.getByTestId("terminal-tab-new").click();
  await expect(page.getByTestId("terminal-tab-3")).toBeVisible();

  const before = await ptyCalls(page);
  const strip = page.getByTestId("terminal-tab-scroller");
  const order = async () =>
    strip
      .locator('[data-testid^="terminal-tab-shell-"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-testid")),
      );
  expect(await order()).toEqual([
    "terminal-tab-shell-1",
    "terminal-tab-shell-2",
    "terminal-tab-shell-3",
  ]);

  // Tab 3 onto tab 1's seat.
  const firstBox = await page.getByTestId("terminal-tab-shell-1").boundingBox();
  if (firstBox === null) throw new Error("no first tab box");
  const drop = await dragTo(page, "terminal-tab-shell-3", {
    x: firstBox.x + firstBox.width / 2,
    y: firstBox.y + firstBox.height / 2,
  });
  // The ghost the drag carries — the app's own `DragOverlay`, and the shot the
  // round asks for.
  await expect(page.getByTestId("tab-drag-overlay")).toBeVisible();
  if (SHOTS !== null) {
    await page.screenshot({ path: `${SHOTS}/02-tab-mid-drag.png` });
  }
  await drop();
  expect(await order()).toEqual([
    "terminal-tab-shell-3",
    "terminal-tab-shell-1",
    "terminal-tab-shell-2",
  ]);
  // A reorder rewrites a list of numbers. The ordinals name the ptys, so the
  // labels travel with their shells and nothing was asked of one.
  expect(await ptyCalls(page)).toEqual(before);

  // Out over the stage's trailing edge: a tab split, from a gesture.
  const stage = await page.getByTestId("pane-left").boundingBox();
  if (stage === null) throw new Error("no stage box");
  const dropEdge = await dragTo(page, "terminal-tab-shell-1", {
    x: stage.x + stage.width - 60,
    y: stage.y + stage.height / 2,
  });
  await expect(page.getByTestId("drop-stage-edge")).toHaveAttribute(
    "data-over",
    "true",
  );
  await dropEdge();
  await expect(page.getByTestId("tab-split-divider")).toBeVisible();
  await expect(page.getByTestId("terminal-tab-shell-1")).toHaveAttribute(
    "data-half",
    "right",
  );
  expect(await ptyCalls(page)).toEqual(before);
});

test("middle-click closes, and the tab menu's five rows do what they say", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByTestId("terminal-tab-new").click();
  await page.getByTestId("terminal-tab-new").click();
  await page.getByTestId("terminal-tab-new").click();
  await expect(page.getByTestId("terminal-tab-4")).toBeVisible();

  // Middle-click, the way it works on every tab bar he uses.
  await page.getByTestId("terminal-tab-shell-4").click({ button: "middle" });
  await expect(page.getByTestId("terminal-tab-4")).toHaveCount(0);

  // The menu, on the tab it was opened over.
  await page.getByTestId("terminal-tab-shell-2").click({ button: "right" });
  const menu = page.locator('[data-testid^="tab-menu-term:"]');
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("tab-menu-close")).toBeVisible();
  await expect(menu.getByTestId("tab-menu-close-others")).toBeVisible();
  await expect(menu.getByTestId("tab-menu-close-right")).toBeVisible();
  await expect(menu.getByTestId("tab-menu-split")).toBeVisible();
  await expect(menu.getByTestId("tab-menu-copy-path")).toBeVisible();
  if (SHOTS !== null) {
    await waitForAnimations(page);
    await page.screenshot({ path: `${SHOTS}/03-tab-context-menu.png` });
  }

  // Close to the right: this one stays, everything after it goes.
  await menu.getByTestId("tab-menu-close-right").click();
  await expect(page.getByTestId("terminal-tab-3")).toHaveCount(0);
  await expect(page.getByTestId("terminal-tab-2")).toBeVisible();
  await expect(page.getByTestId("terminal-tab-1")).toBeVisible();

  // Close others: only this one is left.
  await page.getByTestId("terminal-tab-shell-2").click({ button: "right" });
  await page
    .locator('[data-testid^="tab-menu-term:"]')
    .getByTestId("tab-menu-close-others")
    .click();
  await expect(page.getByTestId("terminal-tab-1")).toHaveCount(0);
  await expect(page.getByTestId("terminal-tab-2")).toBeVisible();
});
