// The collapsible chrome, proved against a real render
// (vingilot/docs/plans/2026-08-07-panes-and-polish.md, Task 6).
//
// `columnKeys.test.mjs` already says what each chord *means*. What only a
// browser can say is whether the chord ever arrives: a key equivalent claimed
// by the native menu never reaches the webview at all, and a handler bound to
// a provider the screen is not inside would silently do nothing. Both failures
// look exactly like "the shortcut does not work" and neither is visible to a
// unit test, which is why ⌘B is asserted here against upstream's own sidebar
// element rather than against a flag this island owns.
//
// It also holds the two promises that make hiding a column safe at all: every
// collapsed column has a visible way back, and what was hidden stays hidden
// across a reload — per project, so a second project is not made to inherit
// the first one's chrome.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Matches RunsScreen.tsx's hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPOS = [
  { id: "repo-left", name: "left", path: "/tmp/vingilot-left" },
  { id: "repo-right", name: "right", path: "/tmp/vingilot-right" },
];

/** Two projects and no runs — the smallest workspace that can still show a
 * per-project collapse being per project. */
async function mockCoordinator(page: Page) {
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (method === "GET" && url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state: { repos: REPOS },
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

/** Upstream's sidebar reports its own collapse through `data-state` on the
 * wrapper it owns (shared/ui/sidebar.tsx) — asserting on that is what makes
 * this a test of the real mechanism rather than of a flag this island
 * invented. `data-collapsible` is what pins the locator to that wrapper: it is
 * written nowhere else, while `data-state`/`data-side` alone would also match
 * any open Radix popover. Collapsed here means off-canvas, not removed, so
 * visibility assertions would not see the difference. */
function sidebar(page: Page) {
  return page.locator("[data-side][data-collapsible]").first();
}

/** A window wide enough for the work surface to hold a split at all.
 *
 * Playwright's default 1280×720 is not: with the sidebar and the two columns
 * in front of it, the work surface is 555px, and the terminal alone wants 752
 * for its 80 columns. `effectiveSolo` reads that as "too narrow to split" and
 * renders the terminal with the right pane on its rail — correct behaviour,
 * and the reason a test that wants a divider has to ask for a window that can
 * hold one. 1700 leaves a 975px surface, comfortably above the threshold. */
const SPLITTABLE = { height: 900, width: 1700 } as const;

async function openWorkspace(page: Page) {
  await page.setViewportSize(SPLITTABLE);
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
}

test.describe("columns collapse on the shortcuts VS Code uses", () => {
  test("primary+B toggles upstream's sidebar, both ways", async ({ page }) => {
    await openWorkspace(page);
    await expect(sidebar(page)).toHaveAttribute("data-state", "expanded");

    await page.keyboard.press("ControlOrMeta+b");
    await expect(sidebar(page)).toHaveAttribute("data-state", "collapsed");

    await page.keyboard.press("ControlOrMeta+b");
    await expect(sidebar(page)).toHaveAttribute("data-state", "expanded");
  });

  test("shift+primary+B hides the worktree column, and the rail brings it back", async ({
    page,
  }) => {
    await openWorkspace(page);
    await page.getByTestId("projects-nav-repo-repo-left").click();
    await expect(page.getByTestId("worktree-column")).toBeVisible();

    await page.keyboard.press("Shift+ControlOrMeta+b");
    await expect(page.getByTestId("worktree-column")).toBeHidden();

    // The way back is on screen, not only on the keyboard.
    const expand = page.getByTestId("worktree-column-expand");
    await expect(expand).toBeVisible();
    await expand.click();
    await expect(page.getByTestId("worktree-column")).toBeVisible();
  });

  test("alt+primary+B hides the right pane and leaves the sidebar alone", async ({
    page,
  }) => {
    // VS Code's secondary-sidebar chord, on the surface that is this app's
    // secondary sidebar. Only a browser can say whether it arrives: macOS
    // resolves the native menu's key equivalents before the webview sees a
    // keydown at all, so a collision would not be a shadowed handler but no
    // handler. ⌥⌘H is the one ⌥⌘ chord Tauri's default menu claims
    // (muda 0.19.3 predefined.rs, HideOthers); ⌥⌘B is nobody's.
    await openWorkspace(page);
    await page.getByTestId("projects-nav-repo-repo-left").click();
    await expect(page.getByTestId("pane-divider")).toBeVisible();

    await page.keyboard.press("Alt+ControlOrMeta+b");
    await expect(page.getByTestId("pane-right-rail")).toBeVisible();
    await expect(page.getByTestId("pane-divider")).toBeHidden();
    // Not the sidebar's chord with a modifier along for the ride: the two maps
    // are read from two different listeners, and a ⌘B that also fired on ⌥⌘B
    // would hide the sidebar every time the owner hid a pane.
    await expect(sidebar(page)).toHaveAttribute("data-state", "expanded");

    await page.keyboard.press("Alt+ControlOrMeta+b");
    await expect(page.getByTestId("pane-divider")).toBeVisible();
    await expect(sidebar(page)).toHaveAttribute("data-state", "expanded");

    // One layout state, persisted per worktree — the same one the header's ›
    // and the rail drive, not a second one bound to the chord.
    await page.keyboard.press("Alt+ControlOrMeta+b");
    await expect(page.getByTestId("pane-right-rail")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => window.localStorage.getItem("vingilot-panes.v1")),
      )
      .toContain('"solo":"left"');
    await page.reload();
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    await page.getByTestId("projects-nav-repo-repo-left").click();
    await expect(page.getByTestId("pane-right-rail")).toBeVisible();
  });

  test("shift+alt+primary+B gives the right pane the whole surface, and the terminal survives it", async ({
    page,
  }) => {
    // The mirror of the chord above, and the gesture the four ported panes
    // lost when the tab bar became a split: full width, which `MIN_LEFT_PX`
    // otherwise caps at 37% of the surface for good.
    await page.setViewportSize({ height: 900, width: 1600 });
    await openWorkspace(page);
    await page.getByTestId("projects-nav-repo-repo-left").click();

    const surface = await page.getByTestId("work-surface").boundingBox();
    const before = await page.getByTestId("pane-right").boundingBox();
    expect(before?.width ?? 0).toBeLessThan((surface?.width ?? 0) / 2);

    await page.keyboard.press("Shift+Alt+ControlOrMeta+b");
    await expect(page.getByTestId("pane-left-rail")).toBeVisible();
    await expect(page.getByTestId("pane-divider")).toBeHidden();
    // The terminal is not merely off screen — it is still in the document,
    // because its xterm instances are attached to live ptys and cannot be
    // rebuilt. `toBeHidden` passes for both; `count` tells them apart.
    expect(await page.getByTestId("pane-left").count()).toBe(1);
    await expect(page.getByTestId("pane-left")).toBeHidden();

    // Nearly all of it: the rail is the only other thing in the row.
    const after = await page.getByTestId("pane-right").boundingBox();
    expect(after?.width ?? 0).toBeGreaterThan((surface?.width ?? 0) - 60);
    // Not the worktree column's chord with ⌥ along for the ride.
    await expect(page.getByTestId("worktree-column")).toBeVisible();

    // The rail is the way back, and it restores the split the owner had.
    await page.getByTestId("pane-left-expand").click();
    await expect(page.getByTestId("pane-divider")).toBeVisible();
    const restored = await page.getByTestId("pane-right").boundingBox();
    expect(Math.round(restored?.width ?? 0)).toBe(
      Math.round(before?.width ?? 0),
    );
  });

  test("dragging the divider to the left edge still leaves the terminal 80 columns", async ({
    page,
  }) => {
    // `paneModel.test.mjs` says what the clamp computes. What only a browser
    // can say is how wide the pane it computed for actually came out — and the
    // two disagreed: the floor divided by the whole surface while the row also
    // holds the divider, so the terminal landed 747px/79 columns on a surface
    // the model believed it had given 752. A unit test asserting the model
    // against its own arithmetic could not see that, and passed.
    await page.setViewportSize({ height: 900, width: 1600 });
    await openWorkspace(page);
    await page.getByTestId("projects-nav-repo-repo-left").click();

    const divider = page.getByTestId("pane-divider");
    await expect(divider).toBeVisible();
    // The divider is a member of the row, and `DIVIDER_PX` is the width the
    // clamp subtracts for it. If this stops being 8, the clamp is subtracting
    // for a divider that is not there.
    const dividerBox = await divider.boundingBox();
    expect(dividerBox?.width).toBe(8);

    // All the way left, past every stop the clamp has.
    const from = {
      x: dividerBox?.x ?? 0,
      y: (dividerBox?.y ?? 0) + (dividerBox?.height ?? 0) / 2,
    };
    await page.mouse.move(from.x + 4, from.y);
    await page.mouse.down();
    await page.mouse.move(0, from.y, { steps: 12 });
    await page.mouse.up();

    // Measured, not derived: the pane's own box, converted to columns by the
    // two numbers the terminal is actually drawn with — 9px a cell, 32px of
    // `px-2` plus xterm's scrollbar gutter.
    const left = await page.getByTestId("pane-left").boundingBox();
    const columns = Math.floor(((left?.width ?? 0) - 32) / 9);
    expect(columns).toBeGreaterThanOrEqual(80);
  });

  test("a collapsed column comes back collapsed, and only for its own project", async ({
    page,
  }) => {
    await openWorkspace(page);
    await page.getByTestId("projects-nav-repo-repo-left").click();
    await page.keyboard.press("Shift+ControlOrMeta+b");
    await expect(page.getByTestId("worktree-column-rail")).toBeVisible();

    // The other project never asked for this.
    await page.getByTestId("projects-nav-repo-repo-right").click();
    await expect(page.getByTestId("worktree-column")).toBeVisible();

    // See the note in the sidebar test: the reload must not outrun the write.
    await expect
      .poll(() =>
        page.evaluate(() => window.localStorage.getItem("vingilot-columns.v1")),
      )
      .toContain("repo-left");
    await page.reload();
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    await page.getByTestId("projects-nav-repo-repo-left").click();
    await expect(page.getByTestId("worktree-column-rail")).toBeVisible();
    await page.getByTestId("projects-nav-repo-repo-right").click();
    await expect(page.getByTestId("worktree-column")).toBeVisible();
  });

  test("a sidebar hidden inside a project is hidden again on the way back in", async ({
    page,
  }) => {
    await openWorkspace(page);
    await page.getByTestId("projects-nav-repo-repo-left").click();
    await page.keyboard.press("ControlOrMeta+b");
    await expect(sidebar(page)).toHaveAttribute("data-state", "collapsed");

    // Upstream's provider always starts open — its cookie is written and
    // never read back — so a sidebar that is collapsed here after a reload
    // was restored by this island and by nothing else.
    // The collapse paints one commit before it is written, so a reload fired
    // the instant the sidebar moves can outrun the write. Waiting for the
    // write is the difference between testing persistence and testing how
    // fast this machine is.
    await expect
      .poll(() =>
        page.evaluate(() => window.localStorage.getItem("vingilot-columns.v1")),
      )
      .toContain("repo-left");
    await page.reload();
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    await expect(sidebar(page)).toHaveAttribute("data-state", "expanded");

    await page.getByTestId("projects-nav-repo-repo-left").click();
    await expect(sidebar(page)).toHaveAttribute("data-state", "collapsed");
  });
});
