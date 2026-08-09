// The cheatsheet, proved against a real render
// (vingilot/docs/plans/2026-08-09-keys-and-type.md, Task 4).
//
// `cheatsheet.test.mjs` already holds the thing that matters most about this
// feature — that every chord the island's maps resolve is on the sheet, asked
// of the maps rather than written down. It holds it purely, and it will hold
// it forever. What it cannot say is anything about the surface:
//
// 1. **That ⌘/ arrives.** This is the failure that produced the whole plan:
//    ⌘W was bound on paper and resolved by the native menu before the webview
//    ever saw it. `cheatsheetKeys.ts` carries the claimant check for ⌘/ — the
//    default menu (muda 0.19.3's predefined table has no `Slash`), the app's
//    one global shortcut (⌃Space), upstream's window handler, and this
//    island's own maps — but a check is a reading of source, and the only
//    thing that proves a chord arrives is pressing it. Here that is pressed
//    over an open project with a terminal mounted, which is where the owner
//    presses it.
// 2. **That the palette is a second door to the same sheet.** Two doors that
//    opened two surfaces is the defect the scratch shell already had once.
// 3. **That the generated rows really render** — including the chords that
//    are not the island's, whose whole point is ⌘W's real behaviour, and the
//    kbd boxes that make a chord read as keys rather than as a word.
// 4. **That a close request over the sheet takes the sheet**, and that the
//    backend was told there was something to take. That is the ⌘W path from
//    Task 1, and this task added a surface to the stack it resolves.
// 5. **That the sheet holds the plain keys and lets the chords through.** A
//    sheet you cannot press a chord in front of is a sheet you have to close
//    to use, and a sheet that let a stray `j` reach the terminal underneath
//    would type into the owner's shell.
//
// The one thing no spec here can reach is the chord that is *not* this app's:
// ⌘W itself is resolved by AppKit against the default application menu before
// any webview sees a keydown, so what is driven below is the close request
// that menu item raises — the same input `workspace-close-request.spec.ts`
// drives, and for the same reason. The owner checklist carries what is left.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Matches RunsScreen.tsx's hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** The main checkout *is* the repo, so this path is the worktree's cwd — which
 * is what makes the scratch shell openable at all (`scratchBlocked`). */
const REPO = { id: "repo-left", name: "vingilot", path: "/tmp/vingilot-left" };

/** Written out rather than imported, exactly as `workspace-close-request`
 * writes it out: a spec that read the event name off the module under test
 * would pass through a rename that left the Rust side emitting the old one. */
const CLOSE_REQUESTED_EVENT = "vingilot://close-requested";

async function mockCoordinator(page: Page) {
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === "GET" && url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state: { repos: [REPO] },
          state_hash: "mock-state-hash",
        },
      });
    }
    if (
      method === "GET" &&
      url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`
    ) {
      return route.fulfill({ json: { runs: [] } });
    }
    if (
      method === "GET" &&
      url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`
    ) {
      return route.fulfill({ json: { worktrees: [] } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });
}

/** The home directory a worktree cwd derives from, the pty commands an xterm
 * needs, and a recorder on the flag a close request is resolved against. */
async function stubBackend(page: Page) {
  await page.evaluate(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
        };
      }
    ).__TAURI_INTERNALS__;
    const passThrough = internals.invoke.bind(internals);
    window.__DISMISSIBLE__ = [];
    internals.invoke = (cmd, args, opts) => {
      const name = String(cmd);
      if (name.startsWith("plugin:path|")) return Promise.resolve("/tmp/home/");
      if (name === "pty_backing") return Promise.resolve("tmux");
      if (name.startsWith("pty_")) return Promise.resolve(null);
      if (name === "window_set_dismissible") {
        window.__DISMISSIBLE__?.push(
          (args as { dismissible: boolean }).dismissible,
        );
        return Promise.resolve(null);
      }
      return passThrough(cmd, args, opts);
    };
  });
}

/** The claim the backend would read for a close request arriving now. */
async function dismissibleNow(page: Page) {
  return page.evaluate(() => {
    const claims = window.__DISMISSIBLE__ ?? [];
    return claims.length === 0 ? null : claims[claims.length - 1];
  });
}

async function requestClose(page: Page) {
  await page.evaluate(async (event) => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown) => unknown;
        };
      }
    ).__TAURI_INTERNALS__;
    await internals.invoke("plugin:event|emit", { event, payload: null });
  }, CLOSE_REQUESTED_EVENT);
}

/** Wide enough that the work surface can hold a split — see the note in
 * workspace-columns.spec.ts for why 1280 cannot. */
const SPLITTABLE = { height: 900, width: 1700 } as const;

async function openWorkspace(page: Page) {
  await page.setViewportSize(SPLITTABLE);
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
}

/** The workspace with a project open and its terminal mounted — the state the
 * owner is actually in when he reaches for the sheet. The trip out and back is
 * what remounts the screen over the stub (workspace-scratch.spec.ts makes the
 * same trip, for the same reason: both gotos are hash-only, so the document
 * and the stub on it survive). */
async function openWorktree(page: Page) {
  await openWorkspace(page);
  await stubBackend(page);
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
}

const sheet = (page: Page) => page.getByTestId("cheatsheet");

test.describe("the sheet, and the one key that opens it", () => {
  test("primary+slash opens it over the work surface, and closes it again", async ({
    page,
  }) => {
    await openWorktree(page);
    await expect(sheet(page)).toBeHidden();

    await page.keyboard.press("ControlOrMeta+/");
    await expect(sheet(page)).toBeVisible();
    // The surface it was opened over is still there under it — this is a
    // sheet drawn over the work surface, not a screen the owner navigated to
    // and has to come back from.
    await expect(page.getByTestId("work-surface")).toBeVisible();
    // Upstream's search is the one dialog on this screen that a mis-claimed
    // chord would land in; nothing here goes near it.
    await expect(page.getByTestId("search-results")).toBeHidden();

    // A key that opens a surface and then does nothing is a key the owner
    // presses twice looking for the way out.
    await page.keyboard.press("ControlOrMeta+/");
    await expect(sheet(page)).toBeHidden();
  });

  test("Esc closes it, and the sheet says so before it is pressed", async ({
    page,
  }) => {
    await openWorktree(page);
    await page.keyboard.press("ControlOrMeta+/");
    await expect(sheet(page)).toBeVisible();
    // The way out, named on the surface itself. A sheet reachable by a chord
    // has to say at least one way back for the reader who did not know the
    // chord in the first place.
    await expect(sheet(page)).toContainText("closes this");

    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
    await expect(page.getByTestId("work-surface")).toBeVisible();
  });

  test("the palette is a second door to the same sheet", async ({ page }) => {
    await openWorktree(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();
    await page.getByTestId("palette-input").fill("keyboard shortcuts");

    const row = page.getByTestId("palette-row-action:cheatsheet");
    await expect(row).toBeVisible();
    // Never blocked: this is the row for someone who does not know the chord.
    await expect(row).not.toHaveAttribute("data-blocked", "true");
    // And it carries the chord it is a door to, as keys.
    await expect(row.locator("kbd")).toHaveText(["⌘", "/"]);

    await page.keyboard.press("Enter");
    await expect(page.getByTestId("palette")).toBeHidden();
    await expect(sheet(page)).toBeVisible();
  });

  test("every section the model generates is drawn, chords as keys", async ({
    page,
  }) => {
    await openWorktree(page);
    await page.keyboard.press("ControlOrMeta+/");
    await expect(sheet(page)).toBeVisible();

    // The sections `cheatsheet.ts` produces for this build, in its order. A
    // section that stopped rendering would leave a whole surface's chords
    // findable only by pressing keys, which is the state this sheet ends.
    for (const id of [
      "workspace",
      "columns",
      "panes",
      "divider",
      "terminal",
      "palette",
      "diff",
      "elsewhere",
    ]) {
      await expect(page.getByTestId(`cheatsheet-${id}`)).toBeVisible();
    }

    // A chord is keys in boxes — settings' own idiom, and the palette's.
    // `⇧⌥⌘B` is four of them; `Esc` is one, which is the case a per-character
    // split gets wrong and the reason `chordKeys` exists.
    const panes = page.getByTestId("cheatsheet-panes");
    await expect(
      panes.getByRole("listitem").filter({ hasText: "the right pane" }),
    ).toContainText("give the right pane the whole surface");
    await expect(panes.locator("kbd").first()).toHaveText("⌥");
    const terminal = page.getByTestId("cheatsheet-terminal");
    await expect(
      terminal.locator("kbd").filter({ hasText: /^Esc$/ }),
    ).toHaveCount(1);
  });

  test("the chords that are not the workspace's are on it, ⌘W included", async ({
    page,
  }) => {
    await openWorktree(page);
    await page.keyboard.press("ControlOrMeta+/");
    const elsewhere = page.getByTestId("cheatsheet-elsewhere");
    await expect(elsewhere).toBeVisible();

    // The question the sheet answers is "what does this key do *here*", and
    // for ⌘W the answer is not what its name says. This is the owner's own
    // report, turned into a line he can read before he presses it.
    await expect(elsewhere).toContainText("takes what is on top");
    await expect(elsewhere).toContainText("minimizes into the Dock");
    await expect(elsewhere).toContainText("never hides");
    // The default menu this app deliberately leaves alone, so the sheet is
    // not just the island's own map with a border around it.
    for (const text of ["copy, cut, paste", "select all", "undo, and redo"]) {
      await expect(elsewhere).toContainText(text);
    }
  });

  test("a close request takes the sheet, and the backend knew there was one", async ({
    page,
  }) => {
    await openWorktree(page);
    // Bare work surface: nothing to take, so the gesture is the window's.
    await expect.poll(async () => dismissibleNow(page)).toBe(false);

    await page.keyboard.press("ControlOrMeta+/");
    await expect(sheet(page)).toBeVisible();
    // Claimed as the sheet opens, not as the request arrives — the backend
    // reads this synchronously while a native close request is held open.
    await expect.poll(async () => dismissibleNow(page)).toBe(true);

    await requestClose(page);
    await expect(sheet(page)).toBeHidden();
    await expect(page.getByTestId("work-surface")).toBeVisible();
    await expect.poll(async () => dismissibleNow(page)).toBe(false);
  });

  test("the palette opens over it, and one close request takes only the palette", async ({
    page,
  }) => {
    await openWorktree(page);
    await page.keyboard.press("ControlOrMeta+/");
    await expect(sheet(page)).toBeVisible();

    // The chords the sheet describes still work while it is being read —
    // which is what makes it a sheet rather than a page you leave to use.
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();

    await requestClose(page);
    await expect(page.getByTestId("palette")).toBeHidden();
    // One surface per request. The sheet the palette opened over is still up,
    // which is the order `closeRequest.ts` resolves and the order the sheet's
    // own ⌘W row prints back to the owner.
    await expect(sheet(page)).toBeVisible();
  });
});

declare global {
  interface Window {
    /** Every `window_set_dismissible` claim this app made, in order. */
    __DISMISSIBLE__?: boolean[];
  }
}
