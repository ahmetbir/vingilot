// The palette, proved against a real render
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 1).
//
// `paletteKeys.test.mjs` already says what ⌘K *means*, and `paletteModel`'s
// tests say what the ranking computes. What only a browser can say is the one
// thing this task turned on: **whether the chord arrives here rather than in
// upstream's search dialog.**
//
// ⌘K is bound in three places in this app — Tauri's native menu (not this
// chord: muda 0.19.3 claims no `KeyK`), upstream's window handler
// (app/AppShell.tsx, which opens `features/search/ui/TopbarSearch.tsx`), and
// the composer's link editor. The island takes it on /workspace with a
// capture-phase listener, and the whole claim rests on two facts a unit test
// cannot see: that a window-capture listener runs before a window-bubble one,
// and that stopping there keeps the event out of the rest of the app. So every
// test below that presses ⌘K also asserts that upstream's dialog stayed shut —
// and the last one asserts it still opens everywhere else, because a claim
// that took the key from the whole app would not be the claim that was made.
//
// The second thing only a browser can say is **where focus is**. The palette's
// keys were bound to its field, and a review found three reachable states with
// focus off it — one ⇥, one ⇧⇥, and a click on a blocked row, which this
// design keeps clickable on purpose. In all three, Esc did nothing and ⇧⌘B
// rearranged the columns underneath. Two tests below press those keys from
// those states, and each ends by proving the chord still works once the
// palette is gone, so what they assert is deference and not a dead key.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

// Matches RunsScreen.tsx's hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPOS = [
  { id: "repo-left", name: "vingilot", path: "/tmp/vingilot-left" },
  { id: "repo-right", name: "buzzard", path: "/tmp/vingilot-right" },
];

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

/** Upstream's "Search everything" dialog. Every ⌘K below asserts on this. */
function upstreamSearch(page: Page) {
  return page.getByTestId("search-results");
}

async function openPalette(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await expect(upstreamSearch(page)).toBeHidden();
}

test.describe("one key to go anywhere and do anything", () => {
  test("primary+K opens the palette here, and not upstream's search", async ({
    page,
  }) => {
    await openWorkspace(page);
    await expect(page.getByTestId("palette")).toBeHidden();

    await openPalette(page);
    // The field has the keyboard the moment it appears — a palette the owner
    // has to click into is a palette he could have clicked a button for.
    await expect(page.getByTestId("palette-input")).toBeFocused();

    // The same key puts it away, and still does not reach upstream.
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeHidden();
    await expect(upstreamSearch(page)).toBeHidden();
  });

  test("Esc closes it from wherever focus went", async ({ page }) => {
    await openWorkspace(page);

    // In the field, where the palette puts focus itself.
    await openPalette(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("palette")).toBeHidden();

    // After ⇥, which the palette answers for by coming straight back — the
    // list is walked with the arrows, and a Tab that left put focus on
    // controls the scrim is drawn over.
    await openPalette(page);
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("palette-input")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("palette-input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("palette")).toBeHidden();

    // And from the state this surface produces itself: a blocked row is kept
    // clickable on purpose, and clicking one leaves the focus there.
    await openPalette(page);
    await page.getByTestId("palette-input").fill("prune");
    const blocked = page.getByTestId("palette-row-action:prune-worktrees");
    await expect(blocked).toHaveAttribute("data-blocked", "true");
    // `force` because the row carries `aria-disabled`, which Playwright reads
    // as "not enabled" — but `aria-disabled` is advisory, the element is a
    // live button, and a real mouse press on it lands and takes focus. That is
    // the state under test, so the check has to be skipped rather than obeyed.
    await blocked.click({ force: true });
    await expect(page.getByTestId("palette")).toBeVisible();
    await expect(blocked).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("palette")).toBeHidden();
  });

  test("while it is open, the chords underneath it do not reach the workspace", async ({
    page,
  }) => {
    await openWorkspace(page);
    await page.getByTestId("projects-nav-repo-repo-left").click();
    await expect(page.getByTestId("worktree-column")).toBeVisible();
    const sidebar = page.locator("[data-side][data-collapsible]").first();
    await expect(sidebar).toHaveAttribute("data-state", "expanded");

    // ⌘B hides the app sidebar — and with it the workspace nav, which lives
    // inside it now — when nothing is in front of it. That is
    // workspace-columns.spec.ts's subject, and it is what makes this test able
    // to fail rather than able to pass. (⇧⌘B, the probe this test used while
    // the nav was its own column, is retired — single-sidebar plan, Task 2.)
    await openPalette(page);
    await page.keyboard.press("ControlOrMeta+b");
    await expect(page.getByTestId("palette")).toBeVisible();
    await expect(sidebar).toHaveAttribute("data-state", "expanded");

    // Including with focus off the field — the case a handler bound to the
    // field could not see, and the one that rearranged the columns behind an
    // open palette.
    await page.getByTestId("palette-input").fill("prune");
    // `force`: see the Esc test above — `aria-disabled` is not `disabled`.
    await page
      .getByTestId("palette-row-action:prune-worktrees")
      .click({ force: true });
    await expect(
      page.getByTestId("palette-row-action:prune-worktrees"),
    ).toBeFocused();
    await page.keyboard.press("ControlOrMeta+b");
    await expect(page.getByTestId("palette")).toBeVisible();
    await expect(sidebar).toHaveAttribute("data-state", "expanded");

    // The sidebar still answers to the chord once the palette is out of the
    // way, so what was proved above is deference and not deadness.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("palette")).toBeHidden();
    await page.keyboard.press("ControlOrMeta+b");
    await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  });

  test("an empty query is the workspace, not an empty box", async ({
    page,
  }) => {
    await openWorkspace(page);
    await openPalette(page);
    const rows = page.getByTestId("palette-list").getByRole("button");
    // Every source is represented before a character is typed: both projects,
    // the Deck, the panes, and the actions.
    await expect(rows.first()).toBeVisible();
    await expect(
      page.getByTestId("palette-row-project:repo-left"),
    ).toBeVisible();
    await expect(page.getByTestId("palette-row-project:landing")).toBeVisible();
    await expect(page.getByTestId("palette-row-pane:diff")).toBeVisible();
    await expect(
      page.getByTestId("palette-row-action:add-project"),
    ).toBeVisible();
  });

  test("typing finds a project and Enter goes there", async ({ page }) => {
    await openWorkspace(page);
    await openPalette(page);
    await page.getByTestId("palette-input").fill("buzzard");

    // The best answer is the first row, whatever produced it — asserted
    // against what is rendered, in order, not against the scorer's arithmetic.
    const rows = page.getByTestId("palette-list").getByRole("button");
    await expect(rows.first()).toHaveAttribute(
      "data-testid",
      "palette-row-project:repo-right",
    );

    await page.keyboard.press("Enter");
    await expect(page.getByTestId("palette")).toBeHidden();
    // The project really opened: its worktrees are disclosed under its row, and
    // the disclosed section is named for it (an `sr-only` heading — the visible
    // name is the project row itself).
    await expect(page.getByTestId("worktree-column")).toBeVisible();
    await expect(
      page.getByTestId("worktree-column").getByRole("heading"),
    ).toHaveText("buzzard");
  });

  test("the arrows move the cursor and Enter runs the row under it", async ({
    page,
  }) => {
    await openWorkspace(page);
    await openPalette(page);
    const rows = page.getByTestId("palette-list").getByRole("button");
    // The empty query lists the sources in their own order, so the two
    // projects are rows 0 and 1 and the second one is a different workspace
    // from the first — which is what makes the Enter below able to fail.
    await expect(rows.nth(0)).toHaveAttribute(
      "data-testid",
      "palette-row-project:repo-left",
    );
    await expect(rows.nth(1)).toHaveAttribute(
      "data-testid",
      "palette-row-project:repo-right",
    );
    await expect(rows.nth(0)).toHaveAttribute("data-active", "true");
    await expect(rows.nth(1)).not.toHaveAttribute("data-active", "true");

    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toHaveAttribute("data-active", "true");
    await expect(rows.nth(0)).not.toHaveAttribute("data-active", "true");

    // Enter runs the row the cursor is on, not the one the palette opened on:
    // "buzzard" is repo-right, "vingilot" is repo-left.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("palette")).toBeHidden();
    await expect(
      page.getByTestId("worktree-column").getByRole("heading"),
    ).toHaveText("buzzard");
  });

  test("the cursor wraps rather than falling off the end", async ({ page }) => {
    await openWorkspace(page);
    await openPalette(page);
    const rows = page.getByTestId("palette-list").getByRole("button");
    const last = (await rows.count()) - 1;
    expect(last).toBeGreaterThan(0);

    await page.keyboard.press("ArrowUp");
    await expect(rows.nth(last)).toHaveAttribute("data-active", "true");
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(0)).toHaveAttribute("data-active", "true");
  });

  test("a pane is chosen from the palette, and the pane host agrees", async ({
    page,
  }) => {
    await openWorkspace(page);
    await page.getByTestId("projects-nav-repo-repo-left").click();
    // Diff is the default arrangement (`paneModel.ts`'s `defaultPaneState`).
    await expect(page.getByTestId("pane-picker")).toHaveAttribute(
      "aria-label",
      "change the right pane — showing Diff",
    );

    await openPalette(page);
    await page.getByTestId("palette-input").fill("runs pane");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("palette")).toBeHidden();
    await expect(page.getByTestId("pane-picker")).toHaveAttribute(
      "aria-label",
      "change the right pane — showing Runs",
    );
  });

  test("an action the palette can reach really runs — the sidebar hides", async ({
    page,
  }) => {
    await openWorkspace(page);
    await page.getByTestId("projects-nav-repo-repo-left").click();
    await expect(page.getByTestId("worktree-column")).toBeVisible();
    const sidebar = page.locator("[data-side][data-collapsible]").first();
    await expect(sidebar).toHaveAttribute("data-state", "expanded");

    await openPalette(page);
    await page.getByTestId("palette-input").fill("hide the sidebar");
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("palette")).toBeHidden();
    await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  });

  test("an action opens the dialog the button opens — one dialog, two doors", async ({
    page,
  }) => {
    await openWorkspace(page);
    await page.getByTestId("projects-nav-repo-repo-left").click();
    await openPalette(page);
    await page.getByTestId("palette-input").fill("new worktree");
    await page.keyboard.press("Enter");
    // The same dialog the column's "+ New worktree" row opens, not a second
    // copy of it.
    await expect(page.getByTestId("new-worktree-dialog")).toBeVisible();
  });

  test("a row's kind is a mark, and rows of one kind carry one mark", async ({
    page,
  }) => {
    // The point of the icon column is that it is a *column*: the same shape
    // repeated, so "these are projects" arrives before any label is read. Per
    // row glyphs — which is what this surface had — cannot do that, and this
    // test is the difference between the two, asserted on what is drawn rather
    // than on which component was imported.
    await openWorkspace(page);
    await openPalette(page);

    async function mark(testId: string) {
      return page.getByTestId(testId).locator("svg").first().innerHTML();
    }
    const project = await mark("palette-row-project:repo-left");
    expect(project.length).toBeGreaterThan(0);
    expect(await mark("palette-row-project:repo-right")).toEqual(project);
    expect(await mark("palette-row-pane:diff")).not.toEqual(project);
    expect(await mark("palette-row-action:add-project")).not.toEqual(project);
    expect(await mark("palette-row-action:add-project")).not.toEqual(
      await mark("palette-row-pane:diff"),
    );
  });

  test("the chord is keys beside the row, not glyphs inside its sentence", async ({
    page,
  }) => {
    await openWorkspace(page);
    await page.getByTestId("projects-nav-repo-repo-left").click();
    await openPalette(page);
    await page.getByTestId("palette-input").fill("hide the sidebar");

    const row = page.getByTestId("palette-row-action:toggle-sidebar");
    await expect(row).toBeVisible();
    // One key per box. A `kbd` per key is what settings' own shortcut list
    // draws, and it is what makes ⌘B read as a chord rather than as a word at
    // the end of a line.
    await expect(row.locator("kbd")).toHaveText(["⌘", "B"]);
    // And the line under the label is a sentence about what moves, which is
    // what the chord used to be sitting in place of.
    await expect(row).toContainText(
      "the app's own sidebar, left of the workspace",
    );
  });

  test("a blocked row keeps its name, states why, and drops the chord", async ({
    page,
  }) => {
    // This used to be the worktree column's own toggle, blocked on the landing
    // view because the column it hid held one project's worktrees and there
    // was none. The merged nav holds the project list, so it is on screen on
    // every view including the Deck and its row is never blocked
    // (vingilot/docs/plans/2026-08-11-one-column-design.md, §4.1) — which
    // leaves the *shape* under test here without a subject unless another
    // chord-carrying row is blocked. ⌥⌘B is: with no worktree open there is no
    // split to give away. Same three readings, same reason for each.
    await openWorkspace(page);
    await openPalette(page);
    await page.getByTestId("palette-input").fill("give the terminal");
    const row = page.getByTestId("palette-row-action:solo-left");
    await expect(row).toHaveAttribute("data-blocked", "true");
    await expect(row).toContainText("no worktree is open");
    await expect(row.locator("kbd")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await page.getByTestId("projects-nav-repo-repo-left").click();
    await openPalette(page);
    await page.getByTestId("palette-input").fill("give the terminal");
    await expect(row).not.toHaveAttribute("data-blocked", "true");
    await expect(row.locator("kbd")).toHaveCount(3);
  });

  test("the retired nav toggle is not a row — gone, not blocked", async ({
    page,
  }) => {
    // `action:toggle-nav` (⇧⌘B) left with the second sidebar it used to hide
    // (single-sidebar plan, Task 2). A blocked row would be a sentence about a
    // thing that still exists; the row must simply not be offered.
    await openWorkspace(page);
    await expect(page.getByTestId("projects-nav")).toBeVisible();
    await openPalette(page);
    await page.getByTestId("palette-input").fill("hide the projects");
    await expect(page.getByTestId("palette")).toBeVisible();
    await expect(page.getByTestId("palette-row-action:toggle-nav")).toHaveCount(
      0,
    );
  });

  test("the cursor, the mouse and neither are three different paints", async ({
    page,
  }) => {
    // The cursor and the hover were `bg-muted` and `bg-muted/60` — one colour
    // at two strengths, which is not a difference anybody sees while typing.
    // Both states exist at once only after the arrows move the cursor off the
    // row the pointer is resting on (moving the mouse takes the cursor with
    // it), so that is the arrangement built here — and a row nobody has been
    // near is read alongside them as the third.
    await openWorkspace(page);
    await openPalette(page);
    const rows = page.getByTestId("palette-list").getByRole("button");
    // The list scrolls its cursor row into view as it mounts; hovering before
    // that has settled aims at a row that then moves out from under the
    // pointer.
    await expect(rows.nth(0)).toHaveAttribute("data-active", "true");

    const hovered = rows.nth(2);
    await hovered.hover();
    await expect(hovered).toHaveAttribute("data-active", "true");

    await page.keyboard.press("ArrowDown");
    const cursor = rows.nth(3);
    const idle = rows.nth(5);
    await expect(cursor).toHaveAttribute("data-active", "true");
    await expect(hovered).not.toHaveAttribute("data-active", "true");

    // `transition-colors` is 150ms, and both rows changed state one keystroke
    // ago: read mid-transition, a row reports an interpolated colour that is
    // neither state's.
    await waitForAnimations(page);

    const paint = (row: typeof cursor) =>
      row.evaluate((el) => {
        const style = getComputedStyle(el);
        return `${style.backgroundColor} / ${style.borderTopColor}`;
      });
    const painted = [
      await paint(cursor),
      await paint(hovered),
      await paint(idle),
    ];
    expect(new Set(painted).size, painted.join(" · ")).toEqual(3);
    // And only the cursor carries the second channel, so the two lit rows are
    // told apart by shape as well as by shade.
    expect(painted[1]).toContain("/ rgba(0, 0, 0, 0)");
    expect(painted[0]).not.toContain("/ rgba(0, 0, 0, 0)");
  });

  test("an action that cannot run says so and refuses, rather than vanishing", async ({
    page,
  }) => {
    // Nothing prunable in this mock workspace, and no project open, so both
    // reasons apply — the row is still findable by name either way.
    await openWorkspace(page);
    await openPalette(page);
    await page.getByTestId("palette-input").fill("prune");

    const row = page.getByTestId("palette-row-action:prune-worktrees");
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("data-blocked", "true");
    await expect(row).toContainText("no project is open");

    // Enter on it does nothing at all — including not closing the palette,
    // which would look exactly like it had worked.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("palette")).toBeVisible();
    await expect(row).toBeVisible();
  });

  test("what was run is what the empty palette leads with, across a reload", async ({
    page,
  }) => {
    await openWorkspace(page);
    await openPalette(page);
    await page.getByTestId("palette-input").fill("buzzard");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("palette")).toBeHidden();

    // Recorded where it can survive the app, and recorded as what the row *is*
    // rather than where it sat.
    await expect
      .poll(() =>
        page.evaluate(() => window.localStorage.getItem("vingilot-palette.v1")),
      )
      .toContain("project:repo-right");

    await page.reload();
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    await openPalette(page);
    const rows = page.getByTestId("palette-list").getByRole("button");
    await expect(rows.first()).toHaveAttribute(
      "data-testid",
      "palette-row-project:repo-right",
    );
    await expect(page.getByTestId("palette-list")).toContainText("Recent");
  });

  test("primary+K is this palette everywhere else too, and upstream's search stays shut", async ({
    page,
  }) => {
    // **This assertion is the inverse of the one it replaces, deliberately**
    // (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2). It used to
    // read "⌘K is still upstream's search everywhere else", which described the
    // split the owner filed: *"cmd k buzz kısmında farklı deck kısmında farklı
    // çalışıyor."* One chord now means one thing app-wide.
    //
    // Nothing was taken away, and the two assertions under this one are what
    // say so: upstream's channel list is INSIDE this palette (a channel row is
    // drawn from the same store their dialog reads), and their dialog is one
    // palette row away — the "Search messages" door that replaced the vetoed
    // sidebar box (P1.1).
    await page.setViewportSize(SPLITTABLE);
    await installMockBridge(page);
    await mockCoordinator(page);
    await page.goto("/#/");
    await expect(page.getByTestId("top-search-pill")).toBeVisible();

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible();
    await expect(upstreamSearch(page)).toBeHidden();
    // Their list, hosted: a channel row, from the same query their own dialog
    // and the sidebar read.
    await expect(
      page.getByTestId("palette-list").locator('[data-kind="channel"]').first(),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("palette")).toBeHidden();
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("palette-input").fill("search messages");
    await page.getByTestId("palette-row-app:search").click();
    await expect(upstreamSearch(page)).toBeVisible();
  });

  test("and the same palette row opens it on the workspace screen too", async ({
    page,
  }) => {
    // Nothing was removed — the box became a palette row (P1.1 veto 1).
    await openWorkspace(page);
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("palette-input").fill("search messages");
    await page.getByTestId("palette-row-app:search").click();
    await expect(upstreamSearch(page)).toBeVisible();
  });
});
