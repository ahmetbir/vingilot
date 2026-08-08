// The scratch shell's keyboard, proved against a real render
// (vingilot/docs/plans/2026-08-08-scratch-and-team-thread.md, Task 1).
//
// `scratchTerminal.test.mjs` says what opening, closing and the shielded keys
// *mean*. What only a browser can say is where focus is — and focus is the one
// thing about this overlay that no pure model can hold, because the element it
// has to give the keyboard back to is an element in a live document.
//
// The claim under test: **closing the scratch shell does not leave a keyboard
// owner on `<body>`**, from either door it can be opened through. Both doors
// matter separately, because the element focus must come back to is a different
// one in each and they are captured at different moments:
//
// - the chord (⌥⌘T) opens it with focus wherever the owner left it, so what has
//   to come back is that element;
// - ⌘K opens it from a palette that is itself taking focus back to where *it*
//   found it as it closes, which happens in the same commit the overlay mounts
//   in. A capture taken before that restore records the palette's own field —
//   an element that is already gone by the time it would be focused.
//
// Both tests end on a control outside the overlay, asserted by test id rather
// than by "not body", so a fix that parked focus somewhere arbitrary would not
// pass them either.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Matches RunsScreen.tsx's hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** The main checkout *is* the repo, so this path is the worktree's cwd — which
 * is what makes the scratch openable at all (`scratchBlocked`). */
const REPO = { id: "repo-left", name: "vingilot", path: "/tmp/vingilot-left" };

/** The control focus is taken from and has to come back to. It is in the
 * projects nav, outside the overlay and outside the work surface, so nothing
 * the scratch does to the panes can move it. */
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

/** The home directory a worktree cwd derives from, and the pty commands an
 * xterm needs. No pty is real here: what is under test is the overlay, and the
 * shell behind it is `scratchTerminal.test.mjs`'s and the live tmux tests'. */
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
    internals.invoke = (cmd, args, opts) => {
      const name = String(cmd);
      if (name.startsWith("plugin:path|")) return Promise.resolve("/tmp/home/");
      if (name === "pty_backing") return Promise.resolve("tmux");
      if (name.startsWith("pty_")) return Promise.resolve(null);
      return passThrough(cmd, args, opts);
    };
  });
}

async function openWorktree(page: Page) {
  await page.setViewportSize({ height: 900, width: 1700 });
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  // The home-dir lookup runs once on RunsScreen's mount, so the stub has to be
  // in place before the screen that reads it mounts; leaving and coming back is
  // what re-runs it (workspace-team.spec.ts makes the same trip). Both gotos
  // are hash-only, so the document — and the stub on it — survives.
  await stubBackend(page);
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(ANCHOR).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  // Put the keyboard on it deliberately rather than relying on the click:
  // opening a project mounts the work surface, and a terminal that mounts
  // takes focus of its own accord. What both tests need is a known control
  // holding the keyboard at the moment the scratch is opened.
  await page.getByTestId(ANCHOR).focus();
  await expect(page.getByTestId(ANCHOR)).toBeFocused();
}

/** Where the keyboard actually is, as a test id rather than as a tag name —
 * `<body>` is the failure this spec exists for, and naming the element it
 * should be on instead is what makes the assertion able to fail for the right
 * reason. */
async function focusedTestId(page: Page) {
  return page.evaluate(
    () => document.activeElement?.getAttribute("data-testid") ?? null,
  );
}

test.describe("a terminal you can throw away, and get the keyboard back from", () => {
  test("the chord opens it and closing gives the keyboard back", async ({
    page,
  }) => {
    await openWorktree(page);

    await page.keyboard.press("ControlOrMeta+Alt+t");
    await expect(page.getByTestId("scratch-terminal")).toBeVisible();
    // The shell has the keyboard while it is open — that is the whole point of
    // the overlay, and it is also what takes focus off the anchor.
    expect(await focusedTestId(page)).not.toBe(ANCHOR);

    await page.getByTestId("scratch-close").click();
    await expect(page.getByTestId("scratch-terminal")).toBeHidden();
    expect(await focusedTestId(page)).toBe(ANCHOR);
  });

  test("the palette opens it and the chord closing gives the keyboard back", async ({
    page,
  }) => {
    await openWorktree(page);

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();
    await page.getByTestId("palette-input").fill("scratch");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("palette")).toBeHidden();
    await expect(page.getByTestId("scratch-terminal")).toBeVisible();

    // The same chord both ways (`resolveScratchKey`), so this also proves the
    // overlay's own listener is what answered it.
    await page.keyboard.press("ControlOrMeta+Alt+t");
    await expect(page.getByTestId("scratch-terminal")).toBeHidden();
    expect(await focusedTestId(page)).toBe(ANCHOR);
  });
});
