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

async function openWorkspace(page: Page) {
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
