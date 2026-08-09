// ⌘W over the workspace, proved against a real render
// (vingilot/docs/plans/2026-08-09-keys-and-type.md, Task 1).
//
// The chord itself cannot be pressed here, and not because Playwright is
// limited: on macOS ⌘W is a key equivalent of the default application menu's
// "Close Window", so it is resolved by AppKit before any webview — this one or
// a real one — sees a keydown. What the app actually receives is the close
// request that menu item raises, forwarded over `vingilot://close-requested`
// by desktop/src-tauri/src/vingilot_window/mod.rs once the backend has already
// refused to close or hide the window. Emitting that event is therefore not a
// stand-in for the chord; it *is* the input the workspace has to answer, and
// the two halves this spec cannot reach are named in the owner checklist
// instead (that the menu raises it, and that ⌘Q/⌘C/⌘X/⌘V/⌘A still work).
//
// `closeRequest.test.mjs` says which surface a request takes. What only a
// browser can say is the rest of the bargain:
//
// 1. That the surface named really goes away, from the assembled screen.
// 2. That the backend is told *before* the request arrives whether there is
//    anything to take — the flag it decides between dismissing and minimizing
//    on, pushed by `useCloseRequest`. A workspace that stopped pushing it
//    would minimize over an open shell, and no pure test can see that.
// 3. That a request over the bare work surface is left alone, so the window
//    gesture stays the window's.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Matches RunsScreen.tsx's hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** The main checkout *is* the repo, so this path is the worktree's cwd — which
 * is what makes the scratch shell openable at all (`scratchBlocked`). */
const REPO = { id: "repo-left", name: "vingilot", path: "/tmp/vingilot-left" };

/** Written out rather than imported: a spec that read the event name off the
 * module under test would pass through a rename that left the Rust side
 * emitting the old one. This string is the contract, in both files. */
const CLOSE_REQUESTED_EVENT = "vingilot://close-requested";

/** The control focus is taken from, outside every surface this spec stacks. */
const ANCHOR = `projects-nav-repo-${REPO.id}`;

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
 * needs, and a recorder on the one command this spec is about.
 *
 * `window_set_dismissible` is recorded rather than answered: what matters is
 * the sequence of claims the workspace made, because that is what the backend
 * reads while a native close request is held open. */
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

/** The close request itself, over the channel the Rust side emits it on. */
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

async function openWorktree(page: Page) {
  await page.setViewportSize({ height: 900, width: 1700 });
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  // The stub has to be in place before the screen that reads it mounts, and
  // leaving and coming back is what remounts it. Both gotos are hash-only, so
  // the document — and the stub on it — survives (workspace-scratch.spec.ts
  // makes the same trip, for the same reason).
  await stubBackend(page);
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(ANCHOR).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await page.getByTestId(ANCHOR).focus();
}

test.describe("the close request the window gesture really sends", () => {
  test("it takes the scratch shell, and the backend was told beforehand", async ({
    page,
  }) => {
    await openWorktree(page);
    // Bare work surface: the claim is that there is nothing to take, which is
    // what lets the backend treat the gesture as being about the window.
    await expect.poll(async () => dismissibleNow(page)).toBe(false);

    await page.keyboard.press("ControlOrMeta+Alt+t");
    await expect(page.getByTestId("scratch-terminal")).toBeVisible();
    // Claimed as the shell opens, not as the request arrives — the backend
    // reads this synchronously while the close request is held open.
    await expect.poll(async () => dismissibleNow(page)).toBe(true);

    await requestClose(page);
    await expect(page.getByTestId("scratch-terminal")).toBeHidden();
    // The work surface it was over is untouched: this gesture took the shell,
    // not the workspace.
    await expect(page.getByTestId("work-surface")).toBeVisible();
    // And the claim is given back, so the next one reaches the window.
    await expect.poll(async () => dismissibleNow(page)).toBe(false);
  });

  test("the palette over the scratch shell is what it takes first", async ({
    page,
  }) => {
    await openWorktree(page);
    await page.keyboard.press("ControlOrMeta+Alt+t");
    await expect(page.getByTestId("scratch-terminal")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();

    await requestClose(page);
    await expect(page.getByTestId("palette")).toBeHidden();
    // One surface per request: the shell the palette opened over is still
    // there, still running whatever the owner left in it.
    await expect(page.getByTestId("scratch-terminal")).toBeVisible();
    await expect.poll(async () => dismissibleNow(page)).toBe(true);
  });

  test("over the bare work surface it takes nothing at all", async ({
    page,
  }) => {
    await openWorktree(page);
    await expect(page.getByTestId("scratch-terminal")).toBeHidden();

    await requestClose(page);

    // Still the workspace, and still nothing claimed — a screen that answered
    // a request it had said it had no surface for would be closing something
    // the owner was not looking at.
    await expect(page.getByTestId("work-surface")).toBeVisible();
    await expect(page.getByTestId("scratch-terminal")).toBeHidden();
    await expect.poll(async () => dismissibleNow(page)).toBe(false);
  });
});

declare global {
  interface Window {
    /** Every `window_set_dismissible` claim this app made, in order. The last
     * one is what a close request arriving now would be resolved against. */
    __DISMISSIBLE__?: boolean[];
  }
}
