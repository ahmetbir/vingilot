// One sidebar where there were two, measured at the width the complaint was
// made about (vingilot/docs/plans/2026-08-11-one-column-and-loose-ends.md
// began this; vingilot/docs/plans/2026-08-14-single-sidebar.md finished it).
//
// > *"bizim çok yer kaplayan 2 hatta 3 sidebar'ımız var."*
//
// **The viewport is the test.** 1728×1117 is the 16-inch MacBook Pro's default
// logical resolution — the machine the chrome was too wide on. The history of
// this row, each step measured here or in `workspace-diff-fits.spec.ts`:
//
//   three columns: sidebar 300 + projects nav 192 + worktree column 224
//                → work surface 1003
//   one column:    sidebar 300 + workspace nav 224 → work surface 1195
//
// After the single-sidebar rework, and this is the claim now:
//
//   window 1728 → sidebar 300 (the nav lives INSIDE it)
//               → work surface 1419
//
// The workspace nav is no longer a member of this row at all — it is the app
// sidebar's contextual content, so the row right of the sidebar holds the
// work surface and nothing else. That is a sentence a test can hold: **one
// box in the row**, **the nav inside the sidebar's own element**, and the
// sums self-checking — the sidebar plus the row plus the shell's own 9px is
// the window. A second nav column reappearing beside the surface takes width
// from the surface without changing the sidebar, so only the sum sees it.
//
// The tests after the geometry are not about width. They are the behaviours
// the merges replaced rather than moved, each of which is invisible to a unit
// test (there is no DOM in the unit suite) and invisible to a reader:
//
// - **A branch filter does not follow the owner into another project**, and
//   neither does the quiet-rows fold. The old column reset both with a
//   `setState` during the render that brought the new project in; the nav
//   does the same thing one component higher up. Two tests, not one, because
//   the reset is two lines and only the first was guarded.
// - **…and ⌘B does not destroy them either.** The sidebar the nav lives in
//   collapses off-canvas rather than unmounting, and the filter/fold state is
//   held in `WorkspaceNav` above the disclosure; both survive the round trip.
//   (⇧⌘B, which used to be this guarantee's subject, is retired — the rail it
//   collapsed to is gone with the second sidebar, and with it the rail's
//   refusal mark and per-project dots: whatever the tree has to say is on
//   screen whenever the sidebar is, and hidden only when the owner hides the
//   whole sidebar.)
// - **Clicking the project row you are standing in does nothing.** `ProjectRow`
//   and the design both say so in words; `selectRepo` clearing
//   `selectedWorktreeId` unconditionally once moved the owner off the worktree
//   he had open onto the project's primary checkout.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Matches RunsScreen.tsx's hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** The 16-inch MacBook Pro's default logical resolution — the same constant
 * `workspace-diff-fits.spec.ts` runs at, for the same reason. */
const SIXTEEN_INCH = { height: 1117, width: 1728 };

/** What the work surface must have at his width. A floor rather than the
 * exact number it measures, because the app shell keeps a few pixels for
 * itself (below); what is under test is the ~224px gain over the 1195 the
 * one-column build had — the whole nav column is the surface's now. */
const SURFACE_FLOOR = 1410;

/** What the app shell keeps for itself, measured rather than assumed: a 1px
 * divider between upstream's sidebar and the workspace, and an 8px inset on the
 * right. It is asserted as a number because that is what makes the sum below
 * closed — a fourth thing appearing in the window has to come out of one of the
 * four, and this is the one nobody would think to check. */
const SHELL_CHROME_PX = 9;

const REPOS = [
  { id: "repo-wide", name: "vingilot", path: "/tmp/vingilot-wide" },
  { id: "repo-other", name: "buzzard", path: "/tmp/vingilot-other" },
];

/** A `blocked` run in the *second* project, which `runAttention` reads as
 * `waiting` and `attentionMark` turns into `needs-you`
 * (`lib/attentionSignal.ts`). It belongs to the project the owner is *not*
 * standing in, on purpose: that is the whole argument for a tree over a
 * drill-in, and the only signal a rail can carry that nothing else on screen
 * does. */
const BLOCKED_WORKTREE = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-other-blocked",
  branch: "needs-me",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-blocked",
  owner_run_objective: null,
  owner_run_status: "blocked",
  removed: null,
  repo_id: REPOS[1].id,
  role: "task",
};

/** Enough worktrees in the first project that the branch filter is drawn at
 * all — `FILTER_THRESHOLD` is 8 and the project's own checkout counts, so eight
 * of these makes nine rows. The filter test needs the box to exist before it
 * can prove a query does not outlive the project it was typed in.
 *
 * The tenth row is `lifecycle: "prunable"`, which is the only thing
 * `prunableWorktrees` looks at and therefore the only thing that decides
 * whether the palette's `action:prune-worktrees` row is blocked. The last test
 * needs that row *runnable* while the nav is a rail — that is the door whose
 * refusal had nowhere to land. */
const WORKTREES = [
  ...Array.from({ length: 8 }, (_, index) => ({
    added: null,
    base_commit: "0".repeat(40),
    binding_id: `wt-wide-${index}`,
    branch: `spike-${index}`,
    commit_sha: null,
    lifecycle: "active",
    owner_run_id: null,
    owner_run_objective: null,
    owner_run_status: null,
    removed: null,
    repo_id: REPOS[0].id,
    role: "task",
  })),
  {
    added: null,
    base_commit: "0".repeat(40),
    binding_id: "wt-wide-gone",
    branch: "gone",
    commit_sha: null,
    lifecycle: "prunable",
    owner_run_id: null,
    owner_run_objective: null,
    owner_run_status: null,
    removed: null,
    repo_id: REPOS[0].id,
    role: "task",
  },
  BLOCKED_WORKTREE,
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
      return route.fulfill({ json: { worktrees: WORKTREES } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });
}

async function openWorkspace(page: Page) {
  await page.setViewportSize(SIXTEEN_INCH);
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
}

// ---------------------------------------------------------------------------
// A second, narrower workspace, for the one test that needs a *fold*.
//
// `worktreeColumnView` refuses to fold a row it has no git stat for — an empty
// read is "no answer", never "nothing there" — so a fold needs three things the
// fixture above deliberately does not have: a resolved worktree root (the shell
// must answer `plugin:path|…`), a derivable path per worktree (a task
// worktree's cwd is `<root>/<owner_run_id>`, so `owner_run_id` cannot be null),
// and `worktree_stats` answering `dirty: false` for those paths. Held apart
// from `openWorkspace` rather than folded into it because a resolved root also
// draws the per-row remove `×`, and the geometry tests above measure boxes.
// ---------------------------------------------------------------------------

const GIT_HOME = "/tmp/vingilot-one-column-home";
const GIT_REPO = {
  id: "repo-git",
  name: "vingilot",
  path: "/tmp/vingilot-one-column",
};
/** A second project with no worktrees of its own, so the fold test has
 * somewhere to switch *to*. It is under `FOLD_THRESHOLD` on its own, which is
 * the point: the reading that matters is what the first project's fold looks
 * like on the way back. */
const GIT_REPO_OTHER = {
  id: "repo-git-other",
  name: "buzzard",
  path: "/tmp/vingilot-one-column-other",
};
/** Eight task worktrees: nine rows with the project's own checkout, which is
 * one past `FILTER_THRESHOLD` (8) so the filter is drawn, and eight foldable
 * rows, which is well past `FOLD_THRESHOLD` (3) so the fold is too. */
const TASK_IDS = Array.from({ length: 8 }, (_, index) => `wt-git-${index}`);
const GIT_WORKTREES = TASK_IDS.map((bindingId, index) => ({
  added: null,
  base_commit: "0".repeat(40),
  binding_id: bindingId,
  branch: `spike-${index}`,
  commit_sha: null,
  lifecycle: "active",
  // The path `worktreeCwd` derives, and therefore the path git is asked about.
  owner_run_id: `run-${index}`,
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: GIT_REPO.id,
  role: "task",
}));

type StatStubWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
};

async function openWorkspaceWithGit(page: Page) {
  await page.setViewportSize(SIXTEEN_INCH);
  await installMockBridge(page);
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state: { repos: [GIT_REPO, GIT_REPO_OTHER] },
          state_hash: "mock-state-hash",
        },
      });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`) {
      return route.fulfill({ json: { worktrees: GIT_WORKTREES } });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`) {
      return route.fulfill({ json: { runs: [] } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });

  // Installed as a property trap at document start rather than by overwriting
  // `invoke` after boot, for the reason `workspace-no-coordinator.spec.ts`
  // spells out: the bridge assigns `invoke` during boot and throws on every
  // command it does not know, and the home-dir lookup runs on the first render.
  await page.addInitScript((home: string) => {
    const w = window as unknown as StatStubWindow;
    let fallback:
      | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
      | null = null;

    const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
      const name = String(cmd);
      if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);
      if (name === "worktree_stats") {
        const paths = ((args ?? {}) as { paths?: string[] }).paths ?? [];
        // Clean, and readable — the two things a row must be before
        // `worktreeColumnView` is allowed to fold it away.
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
      if (name.startsWith("pty_")) return Promise.resolve(null);
      if (fallback === null)
        return Promise.reject(new Error(`no host for ${name}`));
      return fallback(cmd, args, opts);
    };

    const internals = (w.__TAURI_INTERNALS__ ??
      {}) as StatStubWindow["__TAURI_INTERNALS__"];
    w.__TAURI_INTERNALS__ = internals;
    Object.defineProperty(internals, "invoke", {
      configurable: true,
      get: () => invoke,
      set: (fn: (cmd: string, args?: unknown, opts?: unknown) => unknown) => {
        fallback = fn;
      },
    });
  }, GIT_HOME);

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
}

/** Laid-out widths, read off the boxes rather than off the classes, plus the
 * structural readings that say the nav is the sidebar's contextual content
 * and not a column of the work surface's row.
 *
 * `rowSiblings` is the direct child count of the row right of upstream's
 * sidebar — the box the work surface lives in, and nothing else. The sidebar
 * is measured by its own wrapper: `data-collapsible` is written nowhere else
 * in the app, while `data-side`/`data-state` alone would also match an open
 * Radix popover. */
async function layout(page: Page) {
  return page.evaluate(() => {
    const width = (element: Element | null) =>
      element === null
        ? null
        : Math.round(element.getBoundingClientRect().width);
    const nav = document.querySelector('[data-testid="projects-nav"]');
    const disclosed = document.querySelector('[data-testid="worktree-column"]');
    const sidebarElement = document.querySelector(
      "[data-side][data-collapsible]",
    );
    const runsRow = document.querySelector(
      '[data-testid="runs-screen"]',
    )?.firstElementChild;
    return {
      // Is the disclosed subtree inside the one nav, and the nav inside the
      // one sidebar? This is the single-sidebar model, in the two readings
      // that cannot be satisfied by columns that happen to add up.
      disclosedInsideNav:
        nav !== null && disclosed !== null && nav.contains(disclosed),
      navCount: document.querySelectorAll('[data-testid="projects-nav"]')
        .length,
      navInsideSidebar:
        nav !== null && sidebarElement !== null && sidebarElement.contains(nav),
      row: width(runsRow ?? null),
      rowSiblings: runsRow?.children.length ?? null,
      sidebar: width(sidebarElement),
      surface: width(document.querySelector('[data-testid="work-surface"]')),
      window: window.innerWidth,
    };
  });
}

/** The closing readings: whatever the numbers are, the row right of the
 * sidebar is the work surface and nothing else, and the sidebar plus that row
 * plus the shell's own 9px is the window. A nav column reappearing beside the
 * surface takes width from it without changing the sidebar, so only the sum
 * sees it. */
function expectTheWindowIsAccountedFor(laid: {
  row: number | null;
  sidebar: number | null;
  surface: number | null;
  window: number;
}) {
  expect(laid.row).toBe(laid.surface as number);
  expect(laid.window).toBe(SIXTEEN_INCH.width);
  expect(
    (laid.sidebar as number) + (laid.row as number) + SHELL_CHROME_PX,
  ).toBe(SIXTEEN_INCH.width);
}

test("at his width the nav is inside the one sidebar, and the work surface has the whole row", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByTestId(`projects-nav-repo-${REPOS[0].id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await expect(page.getByTestId("worktree-column")).toBeVisible();

  const laid = await layout(page);

  // One nav element, inside the sidebar, with the worktrees inside it.
  expect(laid.navCount).toBe(1);
  expect(laid.navInsideSidebar).toBe(true);
  expect(laid.disclosedInsideNav).toBe(true);
  // One box in the row: the work surface's. Two was the second sidebar.
  expect(laid.rowSiblings).toBe(1);

  // The gain, as a floor. It was 1003 with three columns, 1195 with two.
  expect(laid.surface).not.toBeNull();
  expect(laid.surface as number).toBeGreaterThanOrEqual(SURFACE_FLOOR);

  expectTheWindowIsAccountedFor(laid);
});

test("a branch filter does not follow the owner into another project", async ({
  page,
}) => {
  // The mechanism, as it actually is: `WorkspaceNav` holds `query`, above the
  // disclosure that draws it, so re-renders of the tree cannot destroy it (the
  // test below is the collapse half). Being held that high, unmounting cannot
  // be what clears it on a project switch — the reset is the render-phase
  // `scope` check keyed on `selectedRepoId`, `WorktreeColumn`'s three lines
  // moved rather than reinvented.
  //
  // Proved red: delete `setQuery("")` from that block in `WorkspaceNav.tsx` and
  // the `worktree-row-main:repo-other` read below comes back count 0, because
  // the carried-over "spike-3" filters the second project's only row out.
  await openWorkspace(page);
  await page.getByTestId(`projects-nav-repo-${REPOS[0].id}`).click();

  const filter = page.getByTestId("worktree-filter");
  await expect(filter).toBeVisible();
  await filter.fill("spike-3");
  await expect(filter).toHaveValue("spike-3");
  // The filter is doing something, so the reading below is about a filter that
  // was really on and not about an input nothing consults.
  await expect(page.getByTestId("worktree-row-wt-wide-3")).toBeVisible();
  await expect(page.getByTestId("worktree-row-wt-wide-4")).toHaveCount(0);

  await page.getByTestId(`projects-nav-repo-${REPOS[1].id}`).click();
  await expect(page.getByTestId("worktree-column")).toBeVisible();
  // The second project is under the filter threshold, so there is no box at
  // all — and its one row is on screen, which a carried-over "spike-3" would
  // have hidden.
  await expect(page.getByTestId("worktree-filter")).toHaveCount(0);
  await expect(
    page.getByTestId(`worktree-row-main:${REPOS[1].id}`),
  ).toBeVisible();

  // And coming back, the box is empty and the whole list is here again.
  await page.getByTestId(`projects-nav-repo-${REPOS[0].id}`).click();
  await expect(page.getByTestId("worktree-filter")).toHaveValue("");
  await expect(page.getByTestId("worktree-row-wt-wide-4")).toBeVisible();
});

test("⌘B hides the branch filter and the quiet-rows fold; it does not destroy them", async ({
  page,
}) => {
  // The collapse half of the guarantee, on the collapse that exists now: ⌘B
  // hides the whole sidebar (off-canvas), and a filter the owner typed must
  // still be there — text and effect — when the sidebar is back. ⇧⌘B, the old
  // subject of this test, is retired with the rail
  // (vingilot/docs/plans/2026-08-14-single-sidebar.md, Task 2).
  await openWorkspaceWithGit(page);
  await page.getByTestId(`projects-nav-repo-${GIT_REPO.id}`).click();

  // The fold only exists once git has actually said "clean" about enough
  // worktrees — `worktreeColumnView` refuses to fold a row it has no stat for,
  // which is why this test needs the stubbed `worktree_stats` above and the
  // geometry tests do not.
  const fold = page.getByTestId("worktree-fold");
  await expect(fold).toBeVisible();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId(`worktree-row-${TASK_IDS[4]}`)).toHaveCount(0);

  // Open the fold, and prove it is open by the row it brought back.
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId(`worktree-row-${TASK_IDS[4]}`)).toBeVisible();

  // And type a filter that is demonstrably doing something.
  const filter = page.getByTestId("worktree-filter");
  await expect(filter).toBeVisible();
  await filter.fill("spike-3");
  await expect(page.getByTestId(`worktree-row-${TASK_IDS[3]}`)).toBeVisible();
  await expect(page.getByTestId(`worktree-row-${TASK_IDS[4]}`)).toHaveCount(0);

  // The round trip. Twice, because a single toggle can be passed by a
  // component that happens to be re-created with the same values.
  const sidebarElement = page.locator("[data-side][data-collapsible]").first();
  await page.keyboard.press("ControlOrMeta+b");
  await expect(sidebarElement).toHaveAttribute("data-state", "collapsed");
  await page.keyboard.press("ControlOrMeta+b");
  await expect(sidebarElement).toHaveAttribute("data-state", "expanded");
  await page.keyboard.press("ControlOrMeta+b");
  await expect(sidebarElement).toHaveAttribute("data-state", "collapsed");
  await page.keyboard.press("ControlOrMeta+b");
  await expect(sidebarElement).toHaveAttribute("data-state", "expanded");

  // The filter survived, text and effect.
  await expect(page.getByTestId("worktree-filter")).toHaveValue("spike-3");
  await expect(page.getByTestId(`worktree-row-${TASK_IDS[4]}`)).toHaveCount(0);

  // And so did the fold. It is hidden while a filter is on (a non-empty query
  // disables folding entirely — `worktreeAttention.ts`), so the query comes off
  // first, and what is under test is that the fold is still *open* rather than
  // back at its default shut.
  await page.getByTestId("worktree-filter").fill("");
  await expect(page.getByTestId("worktree-fold")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByTestId(`worktree-row-${TASK_IDS[4]}`)).toBeVisible();
});

test("a quiet-rows fold does not follow the owner into another project", async ({
  page,
}) => {
  // The sibling of the filter test above, and the half that had nothing
  // watching it: the render-phase reset in `WorkspaceNav` clears `query` *and*
  // `expanded`, and until this test existed only the first line was guarded —
  // deleting `setExpanded(false)` left both specs green. A fold is a reading of
  // one project's list, exactly as a filter is, and carrying it into another
  // project means arriving at a list that is already open for reasons the owner
  // did not ask for here.
  //
  // Proved red: delete `setExpanded(false)` from that block and the last two
  // reads come back `aria-expanded="true"` with the quiet rows still on screen.
  await openWorkspaceWithGit(page);
  await page.getByTestId(`projects-nav-repo-${GIT_REPO.id}`).click();

  const fold = page.getByTestId("worktree-fold");
  await expect(fold).toBeVisible();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId(`worktree-row-${TASK_IDS[4]}`)).toBeVisible();

  // Into the second project, which has one row and therefore no fold at all,
  // and back.
  await page.getByTestId(`projects-nav-repo-${GIT_REPO_OTHER.id}`).click();
  await expect(
    page.getByTestId(`worktree-row-main:${GIT_REPO_OTHER.id}`),
  ).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${GIT_REPO.id}`).click();
  await expect(
    page.getByTestId(`worktree-row-main:${GIT_REPO.id}`),
  ).toBeVisible();

  // Shut again — the mirror of the ⇧⌘B assertion above, which is what makes the
  // two distinguishable: a collapse must keep the fold, a project switch must
  // not.
  await expect(page.getByTestId("worktree-fold")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page.getByTestId(`worktree-row-${TASK_IDS[4]}`)).toHaveCount(0);
});

test("clicking the project row you are already standing in leaves your worktree alone", async ({
  page,
}) => {
  // `ProjectRow.tsx` and design §2.1 both promise this click is a no-op. It was
  // not: `selectRepo` cleared `selectedWorktreeId` unconditionally and the
  // auto-select effect then picked the project's `primary` checkout, so the
  // owner's open worktree was replaced by `main` with no gesture that meant it.
  // Drop the `id === selectedRepoId` guard and the last read below comes back
  // `worktree-row-main:repo-wide`.
  await openWorkspace(page);
  await page.getByTestId(`projects-nav-repo-${REPOS[0].id}`).click();

  const openedRow = page.getByTestId("worktree-row-wt-wide-3");
  await openedRow.click();
  await expect(openedRow).toHaveClass(/bg-muted/);

  // Read from the page rather than trusting one locator: what is asserted is
  // that exactly one worktree row is selected and it is that one, so a click
  // that moved the selection cannot pass by leaving two rows lit.
  //
  // `classList.contains` and not a substring test: every unselected row carries
  // `hover:bg-muted/60`, which a substring test reads as selected — it did, and
  // reported all nine rows lit.
  const selected = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="worktree-row-"]')]
        .filter((element) => element.classList.contains("bg-muted"))
        .map((element) => element.getAttribute("data-testid")),
    );
  expect(await selected()).toEqual(["worktree-row-wt-wide-3"]);

  await page.getByTestId(`projects-nav-repo-${REPOS[0].id}`).click();
  expect(await selected()).toEqual(["worktree-row-wt-wide-3"]);
});

test("the tree keeps answering which project needs me, from inside the sidebar", async ({
  page,
}) => {
  // The signal is deliberately in the project the owner is NOT in. A drill-in
  // view hides that; a tree does not — and the tree living inside the app
  // sidebar must not either. (The 36px rail this test used to extend this
  // claim to is retired with ⇧⌘B; when the owner hides the sidebar he hides
  // all of it, dots included, and that is his gesture rather than a state the
  // chrome invented.)
  await openWorkspace(page);
  await page.getByTestId(`projects-nav-repo-${REPOS[0].id}`).click();
  await expect(page.getByTestId("worktree-column")).toBeVisible();

  // The row of the project with the blocked run says needs-you, in a dot and
  // in words — and it is the sidebar's own subtree saying it.
  const expandedRow = page.getByTestId(`projects-nav-repo-${REPOS[1].id}`);
  await expect(expandedRow.locator("[data-attention]")).toHaveAttribute(
    "data-attention",
    "needs-you",
  );
  const words = (await expandedRow.getAttribute("title")) ?? "";
  expect(words).toContain("needs you");
  expect(
    await page
      .locator("[data-side][data-collapsible]")
      .first()
      .getByTestId(`projects-nav-repo-${REPOS[1].id}`)
      .count(),
  ).toBe(1);
});

// The two rail-refusal tests that used to close this file are retired with
// the rail itself (vingilot/docs/plans/2026-08-14-single-sidebar.md, Task 2):
// there is no collapsed state of the nav that keeps a project list on screen
// any more, so every refusal panel — the store notice, the add/remove error,
// the worktree-action refusal — renders in the one expanded branch, which is
// on screen whenever the sidebar is. The narrowing this buys, stated rather
// than hidden: a refusal raised while the owner has hidden the WHOLE sidebar
// (⌘B) is off-canvas with it until he brings the sidebar back. That is the
// sidebar-wide trade the owner's single-sidebar ask made, not a hole this
// spec forgot.
