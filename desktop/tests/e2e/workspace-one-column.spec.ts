// One column where there were two, measured at the width the complaint was
// made about (vingilot/docs/plans/2026-08-11-one-column-and-loose-ends.md,
// Task 1, last checkbox; the design is
// vingilot/docs/plans/2026-08-11-one-column-design.md, §5).
//
// > *"bizim çok yer kaplayan 2 hatta 3 sidebar'ımız var."*
//
// **The viewport is the test.** 1728×1117 is the 16-inch MacBook Pro's default
// logical resolution — the machine the chrome was too wide on — and the whole
// reason "it looks roomier" is not an acceptable answer is that a quarter of
// that window going to navigation is invisible unless something reads the
// boxes. Before this change, measured here and recorded in
// `workspace-diff-fits.spec.ts`:
//
//   window 1728 → sidebar 300 + projects nav 192 + worktree column 224
//               → work surface 1003
//
// After, and this is the claim:
//
//   window 1728 → sidebar 300 + workspace nav 224
//               → work surface 1195
//
// The merged column is `w-56`, exactly the width the worktree column had, so
// the whole 192px of the old `ProjectsNav` is the work surface's. That is a
// sentence a test can hold: **the surface gains 192px** and there are **two**
// boxes in that row rather than three.
//
// Three readings, and the third is the one that keeps working when the numbers
// move. The nav's own width pins the class. The surface's floor pins the gain.
// And the sums are self-checking: the row the nav lives in is the nav plus the
// work surface and nothing else, and the sidebar plus that row plus the shell's
// own 9px is the window. A third column reappearing takes width from the
// surface without changing the nav or the sidebar, so only a sum sees it — and
// there are two of them because it could come back inside the row or beside it.
// Measured here, not assumed: sidebar 300 | 1px divider | nav 224 | surface
// 1195 | 8px inset = 1728.
//
// The tests after the geometry are not about width. They are the behaviours the
// merge replaced rather than moved, each of which is invisible to a unit test
// (there is no DOM in the unit suite) and invisible to a reader:
//
// - **A branch filter does not follow the owner into another project**, and
//   neither does the quiet-rows fold. The old column reset both with a
//   `setState` during the render that brought the new project in; the merged
//   nav does the same thing one component higher up. Two tests, not one,
//   because the reset is two lines and only the first was guarded.
// - **…and ⇧⌘B does not destroy it either.** This is the other half of the same
//   guarantee and the half that was lost: the first merge left `query` and
//   `expanded` inside `WorktreeDisclosure`, which is rendered only in the
//   expanded branch, so collapsing the column unmounted them. `WorktreeColumn`
//   was itself the component that chose between rail and column, so the
//   two-column build kept both across a collapse. The two halves are asserted
//   next to each other on purpose — a fix for either one that breaks the other
//   is the shape this defect had.
// - **Clicking the project row you are standing in does nothing.** `ProjectRow`
//   and the design both say so in words; the merge put that row directly above
//   the worktree list, and `selectRepo` was clearing `selectedWorktreeId`
//   unconditionally, so the click silently moved the owner off the worktree he
//   had open onto the project's primary checkout.
// - **A rail is not allowed to imply that nothing is wrong.** Every panel that
//   reports project state lives in the expanded branch, and `ProjectsNav` had no
//   collapse before this merge, so ⇧⌘B invented a state in which "the project
//   list could not be read" is on screen nowhere at all — a rail showing a bare
//   `0` and no dots. That is "nothing there" standing in for "no answer". Two
//   tests here as well, because the refusal family has three members and the
//   third one — a worktree action's, whose panel is a level deeper still and
//   whose prune door the palette leaves open while the nav is a rail — was the
//   one the mark first skipped.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Matches RunsScreen.tsx's hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** The 16-inch MacBook Pro's default logical resolution — the same constant
 * `workspace-diff-fits.spec.ts` runs at, for the same reason. */
const SIXTEEN_INCH = { height: 1117, width: 1728 };

/** `w-56` on the merged column, written out rather than imported so that this
 * spec fails if the width moves instead of silently re-deriving it. */
const NAV_PX = 224;

/** `w-9` on the collapsed rail. */
const RAIL_PX = 36;

/** What the work surface must have at his width. A floor rather than the exact
 * 1195 it measures, because 1728 − 300 − 224 = 1204 and the app shell keeps the
 * difference (below); what is under test is the ~192px gain over the 1003 this
 * used to be, not a pixel. */
const SURFACE_FLOOR = 1190;

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
 * two structural readings that say the row holds one nav and not two.
 *
 * `siblings` is the direct child count of the row the nav is in — the nav and
 * the box the work surface lives in, and nothing else. Upstream's sidebar is
 * not in that row (it is a sibling of `runs-screen`), which is why it is
 * measured by its own wrapper: `data-collapsible` is written nowhere else in
 * the app, while `data-side`/`data-state` alone would also match an open Radix
 * popover. */
async function layout(page: Page) {
  return page.evaluate(() => {
    const width = (element: Element | null) =>
      element === null
        ? null
        : Math.round(element.getBoundingClientRect().width);
    const nav =
      document.querySelector('[data-testid="projects-nav"]') ??
      document.querySelector('[data-testid="worktree-column-rail"]');
    const disclosed = document.querySelector('[data-testid="worktree-column"]');
    return {
      // Is the disclosed subtree inside the one column, or beside it? This is
      // the merge, in the one reading that cannot be satisfied by two columns
      // that happen to add up.
      disclosedInsideNav:
        nav !== null && disclosed !== null && nav.contains(disclosed),
      nav: width(nav),
      navCount: document.querySelectorAll('[data-testid="projects-nav"]')
        .length,
      // The row the nav is in — everything right of upstream's sidebar. Its
      // width is the budget the nav and the surface divide between them.
      row: width(nav?.parentElement ?? null),
      sidebar: width(document.querySelector("[data-side][data-collapsible]")),
      siblings: nav?.parentElement?.children.length ?? null,
      surface: width(document.querySelector('[data-testid="work-surface"]')),
      window: window.innerWidth,
    };
  });
}

/** The two closing readings, shared by the two geometry tests below.
 *
 * The first is the self-check the design asked for: whatever the numbers are,
 * the row the nav lives in is the nav plus the work surface and nothing else. A
 * third column reappearing there takes width from the surface without changing
 * the row, so only this sees it — and nobody has to remember a magic number for
 * it to keep seeing it.
 *
 * The second closes the window: sidebar + row + the shell's own 9px is 1728, so
 * a column appearing *beside* the sidebar rather than inside the row cannot
 * hide either. */
function expectTheWindowIsAccountedFor(laid: {
  nav: number | null;
  row: number | null;
  sidebar: number | null;
  surface: number | null;
  window: number;
}) {
  expect(laid.row).toBe((laid.nav as number) + (laid.surface as number));
  expect(laid.window).toBe(SIXTEEN_INCH.width);
  expect(
    (laid.sidebar as number) + (laid.row as number) + SHELL_CHROME_PX,
  ).toBe(SIXTEEN_INCH.width);
}

test("at his width the nav is one column, and the work surface has what the second one took", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByTestId(`projects-nav-repo-${REPOS[0].id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await expect(page.getByTestId("worktree-column")).toBeVisible();

  const laid = await layout(page);

  // One nav element, and the worktrees are inside it rather than beside it.
  expect(laid.navCount).toBe(1);
  expect(laid.disclosedInsideNav).toBe(true);
  // Two boxes in the row: the nav, and the box the work surface is in. Three
  // was the defect.
  expect(laid.siblings).toBe(2);

  // The width the class says, at the size the owner runs.
  expect(laid.nav).toBe(NAV_PX);

  // The gain, as a floor. It was 1003.
  expect(laid.surface).not.toBeNull();
  expect(laid.surface as number).toBeGreaterThanOrEqual(SURFACE_FLOOR);

  expectTheWindowIsAccountedFor(laid);
});

test("collapsed, the nav is a rail and the surface takes the difference", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByTestId(`projects-nav-repo-${REPOS[0].id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  const open = await layout(page);

  await page.keyboard.press("Shift+ControlOrMeta+b");
  await expect(page.getByTestId("worktree-column-rail")).toBeVisible();
  const railed = await layout(page);

  expect(railed.nav).toBe(RAIL_PX);
  // Exactly what the column gave up, and the sum still holds — the rail is a
  // narrower member of the same row, not a layer over the surface.
  expect((railed.surface as number) - (open.surface as number)).toBe(
    NAV_PX - RAIL_PX,
  );
  expectTheWindowIsAccountedFor(railed);

  // The way back is on screen, and it restores the column to its width.
  const expand = page.getByTestId("worktree-column-expand");
  await expect(expand).toBeVisible();
  await expand.click();
  await expect(page.getByTestId("projects-nav")).toBeVisible();
  expect((await layout(page)).nav).toBe(NAV_PX);
});

test("a branch filter does not follow the owner into another project", async ({
  page,
}) => {
  // The mechanism, as it actually is: `WorkspaceNav` holds `query`, because it
  // is the one component that renders in both the rail state and the column
  // state and a filter must not be destroyed by ⇧⌘B (the test below is that
  // half). Being held that high, unmounting cannot be what clears it on a
  // project switch — the reset is the render-phase `scope` check keyed on
  // `selectedRepoId`, `WorktreeColumn`'s three lines moved rather than
  // reinvented.
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

test("⇧⌘B hides the branch filter and the quiet-rows fold; it does not destroy them", async ({
  page,
}) => {
  // The regression the merge introduced against the column it replaced, in the
  // exact gesture the owner makes: ⇧⌘B is how he gets the width back for a
  // minute, and a filter he typed must still be there when the column is.
  //
  // `HEAD:desktop/src/features/runs/ui/WorktreeColumn.tsx` held `query` and
  // `expanded` on the component that rendered *both* the rail and the column,
  // so a collapse swapped the subtree and kept the state. Put either back inside
  // `WorktreeDisclosure` and this goes red on the line that names it.
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

  // The round trip. Twice, because a single toggle can be passed by a component
  // that happens to be re-created with the same values.
  await page.keyboard.press("Shift+ControlOrMeta+b");
  await expect(page.getByTestId("worktree-column-rail")).toBeVisible();
  await page.getByTestId("worktree-column-expand").click();
  await expect(page.getByTestId("projects-nav")).toBeVisible();
  await page.keyboard.press("Shift+ControlOrMeta+b");
  await expect(page.getByTestId("worktree-column-rail")).toBeVisible();
  await page.getByTestId("worktree-column-expand").click();

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

test("the rail keeps answering which project needs me", async ({ page }) => {
  // The claim this guards is the file header's own, and it is the reason ⇧⌘B is
  // allowed to exist at all: "collapsing the nav must not destroy the answer to
  // 'which project needs me'". Nothing held it. Every rail dot could be blanked
  // — `<AttentionDot mark={NO_MARK} />`, or the whole `AttentionDot` deleted
  // from the rail's button — and the entire suite stayed green, because every
  // other rail test asserts the *buttons* (they are the way to switch project)
  // and none of them asserts what the buttons carry.
  //
  // The signal is deliberately in the project the owner is NOT in. A drill-in
  // view hides that; a tree does not, and a 36px rail must not either.
  await openWorkspace(page);
  await page.getByTestId(`projects-nav-repo-${REPOS[0].id}`).click();
  await expect(page.getByTestId("worktree-column")).toBeVisible();

  // Expanded first, so what the rail has to preserve is measured rather than
  // assumed: the row of the project with the blocked run says needs-you, in a
  // dot and in words.
  const expandedRow = page.getByTestId(`projects-nav-repo-${REPOS[1].id}`);
  await expect(expandedRow.locator("[data-attention]")).toHaveAttribute(
    "data-attention",
    "needs-you",
  );
  const words = (await expandedRow.getAttribute("title")) ?? "";
  expect(words).toContain("needs you");

  await page.keyboard.press("Shift+ControlOrMeta+b");
  await expect(page.getByTestId("worktree-column-rail")).toBeVisible();

  // Same state, same words, 36px wide.
  const railDot = page.getByTestId(`nav-rail-repo-${REPOS[1].id}`);
  await expect(railDot.locator("[data-attention]")).toHaveAttribute(
    "data-attention",
    "needs-you",
  );
  // The sentence is the accessible name, because a dot in a rail has no room
  // for a label and `aria-hidden` is on the dot itself.
  await expect(railDot).toHaveAttribute(
    "aria-label",
    new RegExp(`${REPOS[1].name}.*needs you`),
  );

  // And the project the owner IS in keeps its own dot rather than losing it to
  // the selection highlight — the rail speaks for every project or it is a
  // worse answer than the column it replaced.
  await expect(
    page
      .getByTestId(`nav-rail-repo-${REPOS[0].id}`)
      .locator("[data-attention]"),
  ).toHaveCount(1);
});

test("collapsed, the rail still says the project list could not be read", async ({
  page,
}) => {
  // There is no Tauri host in this bundle, so `projects_load` rejects and the
  // store notice is the true sentence about this machine: the list on screen is
  // the coordinator's, not its own. That makes it the cheapest real refusal to
  // collapse the nav on top of.
  await openWorkspace(page);
  const notice = page.getByTestId("projects-nav-store-notice");
  await expect(notice).toBeVisible();
  const sentence = ((await notice.textContent()) ?? "").trim();
  expect(sentence.length).toBeGreaterThan(0);

  await page.keyboard.press("Shift+ControlOrMeta+b");
  await expect(page.getByTestId("worktree-column-rail")).toBeVisible();
  // The panel itself is gone with the column — that part is fine, it is text in
  // a 36px rail. What is not fine is the rail implying there is nothing to say
  // while it draws a bare project count.
  await expect(page.getByTestId("projects-nav-store-notice")).toHaveCount(0);

  const mark = page.getByTestId("nav-rail-refusal");
  await expect(mark).toBeVisible();
  // The sentence *is* the accessible name. A mark that only says a mark exists
  // is one more thing to go and look up.
  await expect(mark).toHaveAttribute("aria-label", sentence);

  // And it is the way back to the words.
  await mark.click();
  await expect(page.getByTestId("projects-nav-store-notice")).toHaveText(
    sentence,
  );

  // The refusal an *action* raises rides the same mark, and it is the one that
  // matters most: `action:add-project` is reachable from the palette while the
  // nav is a rail, so before the mark existed its refusal was raised into a
  // component that was not on screen at all.
  await page.getByTestId("projects-nav-add").click();
  await expect(page.getByTestId("projects-nav-error")).toContainText(
    "cannot add a project",
  );
  await page.keyboard.press("Shift+ControlOrMeta+b");
  await expect(page.getByTestId("worktree-column-rail")).toBeVisible();
  await expect(page.getByTestId("nav-rail-refusal")).toHaveAttribute(
    "aria-label",
    /cannot add a project/,
  );
});

test("collapsed, the rail says a worktree action was refused too", async ({
  page,
}) => {
  // The third member of the refusal family, and the one the mark skipped when
  // it was first added. `actions.refusal` is not a project notice: its only
  // panel is `worktree-column-refusal`, which lives inside `WorktreeDisclosure`
  // — a level *further* inside the subtree ⇧⌘B unmounts than the notices are.
  // And `paletteSources.ts` blocks `action:prune-worktrees` on
  // `project === null || prunable === 0` and on nothing about the collapse, so
  // the gesture below is one the owner can make, today, with the nav a rail.
  //
  // Proved red: drop `actions.refusal?.message` from `railRefusal` in
  // `WorkspaceNav.tsx` and the mark keeps saying only the store notice while
  // git's refusal is on screen nowhere at all.
  await openWorkspace(page);
  await page.getByTestId(`projects-nav-repo-${REPOS[0].id}`).click();
  await expect(page.getByTestId("worktree-column")).toBeVisible();

  const mark = page.getByTestId("nav-rail-refusal");
  await page.keyboard.press("Shift+ControlOrMeta+b");
  await expect(page.getByTestId("worktree-column-rail")).toBeVisible();
  // What the mark says before the prune: the store notice, and nothing else.
  const storeOnly = (await mark.getAttribute("aria-label")) ?? "";
  expect(storeOnly.length).toBeGreaterThan(0);

  // The door, exactly as it is reachable: ⌘K, with the column already a rail.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.getByTestId("palette-input").fill("prune");
  const row = page.getByTestId("palette-row-action:prune-worktrees");
  await expect(row).toBeVisible();
  await expect(row).not.toHaveAttribute("data-blocked", "true");
  await page.keyboard.press("Enter");
  // It ran rather than being refused by the palette: a blocked row leaves the
  // palette open, which is `workspace-palette.spec.ts`'s own reading of it.
  await expect(page.getByTestId("palette")).toBeHidden();

  // There is no host for `worktree_prune_preview` in this bundle, so git
  // refused and `openPrune` opened no dialog — `RunsScreen` says in a comment
  // that the refusal "is already on screen", and the mark is what makes that
  // sentence true while the nav is a rail.
  await expect(mark).not.toHaveAttribute("aria-label", storeOnly);

  // And the mark is still the way to the words, for this refusal as for the
  // other two: it opens the column onto the panel the sentence is written in.
  await mark.click();
  const panel = page.getByTestId("worktree-column-refusal");
  await expect(panel).toBeVisible();
  const sentence = (
    (await panel.locator("p").first().textContent()) ?? ""
  ).trim();
  expect(sentence.length).toBeGreaterThan(0);

  await page.keyboard.press("Shift+ControlOrMeta+b");
  await expect(page.getByTestId("worktree-column-rail")).toBeVisible();
  expect((await mark.getAttribute("aria-label")) ?? "").toContain(sentence);
});
