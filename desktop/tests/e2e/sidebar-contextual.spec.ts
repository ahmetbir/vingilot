// One sidebar, contextual by view
// (vingilot/docs/plans/2026-08-14-single-sidebar.md, Tasks 1–3).
//
// > *"sidebar'in teke dusurulmesi. buzz'in kendi sidebar'ini bulundugumuz yere
// > gore degismesii saglasak guzel olur. ust taraf sabit olur atiyorum project
// > secilince alt tarafi degisir vs. bu sag pane'in sidebarini da buraya
// > almamiz demek olacak. vscode gibisinden."*
//
// Three claims, each of which was false before the rework and none of which a
// unit test can hold (they are about what two independently-mounted trees put
// on screen at once):
//
// 1. **A view that is not about channels does not keep drawing the channel
//    list.** `AppSidebar`'s channel/DM content rendered unconditionally under
//    every `selectedView`; on /agents that list answered nothing about where
//    the owner was. And its replacement must be a *named* empty state — an
//    empty `<div>` and "no sidebar detail yet" are indistinguishable to a test
//    that only checks the channels are gone, which is why the placeholder's
//    presence is asserted, not only the list's absence.
//
// 2. **The workspace's project tree is the sidebar's contextual content, not a
//    second sidebar beside it.** `WorkspaceNav` used to mount as its own
//    column inside `RunsScreen`, so /workspace showed two sidebars at once —
//    the app's (a channel list) and its own. The tree now renders inside
//    `app-sidebar`, and the row right of the sidebar holds the work surface
//    and nothing else.
//
// 3. **⇧⌘B is retired, not moved.** With the nav inside the sidebar there is
//    nothing left for it to collapse independently — ⌘B already toggles the
//    sidebar the tree now lives in. The chord must do nothing, and the rail it
//    used to leave behind must not exist.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Matches RunsScreen.tsx's hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPOS = [
  { id: "repo-ctx", name: "vingilot", path: "/tmp/vingilot-ctx" },
  { id: "repo-ctx-other", name: "buzzard", path: "/tmp/vingilot-ctx-other" },
];

/** Two projects and no runs — enough for the tree to have rows to show. */
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

test("the home view keeps the channel list — the contextual slot's channel branch", async ({
  page,
}) => {
  // The guard for the gating itself: home (the Inbox) is where every channel
  // is reached from, and the condition that removes the list from /agents
  // must not remove it here. Green before and after, on purpose — this is the
  // line the gate must not cross.
  await installMockBridge(page);
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("stream-list")).toBeVisible();
  await expect(page.getByTestId("dm-list")).toBeVisible();
  await expect(page.getByTestId("sidebar-contextual-empty")).toHaveCount(0);
});

test("the agents view stops drawing the channel list and names its empty state", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/#/agents");
  await expect(page.getByTestId("agents-page-content")).toBeVisible();

  // The fixed top region does not vary by view.
  await expect(page.getByTestId("sidebar-primary-menu")).toBeVisible();

  // The channel list is gone — before the gate it rendered here regardless.
  await expect(page.getByTestId("stream-list")).toHaveCount(0);
  await expect(page.getByTestId("dm-list")).toHaveCount(0);

  // And something honest stands in its place. Presence, not just absence: an
  // empty div would satisfy the two reads above.
  const empty = page.getByTestId("sidebar-contextual-empty");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText(/no sidebar detail/i);
});

test("the workspace view swaps the channel list for the project tree, inside the one sidebar", async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1700 });
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();

  // The tree is the sidebar's contextual content now.
  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar.getByTestId("projects-nav")).toBeVisible();
  await expect(
    sidebar.getByTestId(`projects-nav-repo-${REPOS[0].id}`),
  ).toBeVisible();

  // Not a second copy of it beside the work surface — one nav in the whole
  // document, and it is the sidebar's.
  await expect(page.getByTestId("projects-nav")).toHaveCount(1);
  await expect(
    page.getByTestId("runs-screen").getByTestId("projects-nav"),
  ).toHaveCount(0);

  // Since P1.1 (owner veto 4) the channel/DM lists render INLINE below the
  // Projects tree — the mockup's own order — rather than behind a Chats fold.
  // One copy, visible, inside the sidebar.
  await expect(page.getByTestId("stream-list")).toBeVisible();
  await expect(page.getByTestId("dm-list")).toBeVisible();

  // Selection made in the sidebar's tree still drives the work surface —
  // the state the two trees share cannot have desynced silently.
  await sidebar.getByTestId(`projects-nav-repo-${REPOS[0].id}`).click();
  await expect(sidebar.getByTestId("worktree-column")).toBeVisible();
  await expect(page.getByTestId("work-surface")).toBeVisible();
});

test("⇧⌘B is retired: it collapses nothing and leaves no rail", async ({
  page,
}) => {
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await expect(page.getByTestId("projects-nav")).toBeVisible();

  await page.keyboard.press("Shift+ControlOrMeta+b");

  // The tree stays; the rail it used to collapse to does not exist.
  await expect(page.getByTestId("projects-nav")).toBeVisible();
  await expect(page.getByTestId("worktree-column-rail")).toHaveCount(0);

  // And ⌘B still toggles the one sidebar the tree now lives in — the chord
  // that survives is the one that moves the whole thing.
  await page.keyboard.press("ControlOrMeta+b");
  await expect(
    page.locator("[data-side][data-collapsible]").first(),
  ).toHaveAttribute("data-state", "collapsed");
  await page.keyboard.press("ControlOrMeta+b");
  await expect(
    page.locator("[data-side][data-collapsible]").first(),
  ).toHaveAttribute("data-state", "expanded");
});
