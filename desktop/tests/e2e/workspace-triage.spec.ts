// The triage board, proved against a real render
// (vingilot/docs/plans/2026-08-09-signals-and-dashboards.md, Task 3).
//
// `triage.test.mjs` already says what the model computes from a given set of
// worktrees. What only a browser can say is whether the board the owner lands
// on is drawn from that model at all: the Deck takes it as an optional `board`
// group, and a landing surface that forgot to pass one renders exactly as it
// did before Task 3 — no error, no empty state, just the old composer with
// nothing above the lanes. That failure is invisible to every unit test in the
// island, and it is the whole reason this file exists.
//
// It also holds the two claims the board is only worth having if they hold:
// the strongest signal is at the top of the list the owner reads, and a row is
// a door onto the worktree it names rather than onto its project.
//
// Nothing here stubs git. `worktree_stats` has no mock bridge command, so
// every stat is "no answer" — which is deliberate rather than merely
// convenient: it leaves the coordinator's own run statuses as the only
// witness, so the order below is a fact about the precedence and not about how
// fast a subprocess answered.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Matches RunsScreen.tsx's hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPOS = [
  { id: "repo-alpha", name: "alpha", path: "/tmp/vingilot-alpha" },
  { id: "repo-beta", name: "beta", path: "/tmp/vingilot-beta" },
];

/** One row of the coordinator's worktree read model, with the fields this
 * board does not read filled in once here rather than at every call site. */
function worktree(fields: {
  binding_id: string;
  repo_id: string;
  branch: string;
  owner_run_id: string;
  owner_run_status: string;
}) {
  return {
    added: null,
    base_commit: "0000000",
    commit_sha: null,
    lifecycle: "ready",
    owner_run_objective: "seeded",
    removed: null,
    role: "task",
    ...fields,
  };
}

// Two projects, and between them one worktree in each of the states the
// coordinator alone can put a row in — plus one it says nothing about. The
// four `main:` checkouts groupWorktrees seeds are silent for the same reason:
// no run owns them and git was never asked.
const WORKTREES = [
  worktree({
    binding_id: "wt-alpha-blocked",
    branch: "fix/login",
    owner_run_id: "run-alpha-blocked",
    owner_run_status: "blocked",
    repo_id: "repo-alpha",
  }),
  worktree({
    binding_id: "wt-alpha-done",
    branch: "chore/tidy",
    owner_run_id: "run-alpha-done",
    owner_run_status: "completed",
    repo_id: "repo-alpha",
  }),
  worktree({
    binding_id: "wt-beta-running",
    branch: "feat/search",
    owner_run_id: "run-beta-running",
    owner_run_status: "running",
    repo_id: "repo-beta",
  }),
];

async function mockCoordinator(
  page: Page,
  seed: { repos: typeof REPOS; worktrees: typeof WORKTREES },
) {
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (method === "GET" && url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state: { repos: seed.repos },
          state_hash: "mock-state-hash",
        },
      });
    }
    if (
      method === "GET" &&
      url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`
    ) {
      // No runs: the board's date column is the coordinator's `updated_at` for
      // the run that owns a row, so an empty list is what keeps every row
      // undated and this spec off the clock.
      return route.fulfill({ json: { runs: [] } });
    }
    if (
      method === "GET" &&
      url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`
    ) {
      return route.fulfill({ json: { worktrees: seed.worktrees } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });
}

/** The landing surface, which is where the board lives: no project selected,
 * so RunsScreen renders the Deck and hands it the board. */
async function openDeck(
  page: Page,
  seed: { repos: typeof REPOS; worktrees: typeof WORKTREES } = {
    repos: REPOS,
    worktrees: WORKTREES,
  },
) {
  await page.setViewportSize({ height: 900, width: 1400 });
  await installMockBridge(page);
  await mockCoordinator(page, seed);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await expect(page.getByTestId("deck-pane")).toBeVisible();
}

/** Every row as one line of text, in the order they are drawn — which is the
 * order the owner reads them in, and the only thing about this board that a
 * refactor is not free to change. Read off the rendered rows rather than off
 * their testids: the ids are binding ids the model carries, and a board that
 * printed them in the right order under the wrong labels would still be
 * wrong. */
async function boardRows(page: Page): Promise<string[]> {
  const texts = await page
    .getByTestId("triage-board")
    .getByRole("button")
    .allInnerTexts();
  return texts.map((text) => text.replace(/\s+/g, " ").trim());
}

test.describe("the landing view is the triage board", () => {
  test("draws a row for every worktree in the workspace, and says what it is looking at", async ({
    page,
  }) => {
    await openDeck(page);

    // The sentence over the rows is `rollupMark`'s, and it is the loud one:
    // one row's run is blocked, and that claim survives the four rows nothing
    // has answered about. Asserted word for word, including the "1 worktree
    // need you" that `rollupSentence` pluralizes only the noun of — the
    // sentence the owner reads is the one this pins, and changing it is a
    // decision Task 1 gets to make on purpose rather than by accident.
    await expect(page.getByTestId("triage-headline")).toHaveText(
      "1 worktree need you — the coordinator says their runs are paused or blocked",
    );

    // Three seeded worktrees plus the checkout groupWorktrees gives each
    // project — the board spans projects, so beta's rows are here without
    // beta having been opened.
    expect(await boardRows(page)).toEqual([
      "fix/login alpha blocked",
      "feat/search beta running",
      "main alpha",
      "chore/tidy alpha completed",
      "main beta",
    ]);
  });

  test("attention comes first, and a row nothing has answered about sinks", async ({
    page,
  }) => {
    await openDeck(page);
    const rows = await boardRows(page);

    // needs-you above working: the precedence `attentionSignal.ts` writes
    // down, read off the screen rather than off the model.
    expect(rows.indexOf("fix/login alpha blocked")).toBeLessThan(
      rows.indexOf("feat/search beta running"),
    );
    // And both above every silent row. A row with no dot is one git has not
    // reported on, not a claim of urgency — ranking it above the answered
    // rows would also make it leap to the top and drop back when a stat
    // finally lands.
    expect(rows.indexOf("feat/search beta running")).toBeLessThan(
      rows.indexOf("main alpha"),
    );
    expect(rows.indexOf("feat/search beta running")).toBeLessThan(
      rows.indexOf("chore/tidy alpha completed"),
    );
    expect(rows.indexOf("feat/search beta running")).toBeLessThan(
      rows.indexOf("main beta"),
    );

    // Stable within a rank: the three silent rows keep the order they came in
    // (alpha's checkout, alpha's completed worktree, beta's checkout), so a
    // row only ever moves because its own state moved.
    expect(rows.slice(2)).toEqual([
      "main alpha",
      "chore/tidy alpha completed",
      "main beta",
    ]);
  });

  test("a row is a door onto that worktree, in a project that was not open", async ({
    page,
  }) => {
    await openDeck(page);
    await page.getByTestId("triage-row-wt-beta-running").click();

    // The board is gone because a project is open now — but that alone is
    // what a click carrying only the repo id would also produce, and then
    // RunsScreen's own effect would land him on beta's `main` checkout. The
    // status bar names the worktree, so it is the thing that tells the two
    // apart: `feat/search`, not `main`.
    await expect(page.getByTestId("triage-board")).toHaveCount(0);
    const status = page.getByTestId("project-status-bar");
    await expect(status).toContainText("beta");
    await expect(status).toContainText("feat/search");
    await expect(status).toContainText("running");
    // And it really is that project's column he is standing in, with the
    // worktree's own row in it.
    await expect(page.getByTestId("worktree-column")).toBeVisible();
    await expect(
      page.getByTestId("worktree-row-wt-beta-running"),
    ).toBeVisible();
  });

  test("a workspace with no projects still says something", async ({
    page,
  }) => {
    // The one empty state that is reachable from the screen: every project
    // gets a checkout row, so "projects but no worktrees" cannot be produced
    // here. A board that drew nothing with nothing said over it is the single
    // failure this whole surface exists to prevent.
    await openDeck(page, { repos: [], worktrees: [] });
    await expect(page.getByTestId("triage-headline")).toHaveText(
      "No projects yet — add one and its worktrees appear here.",
    );
    expect(await boardRows(page)).toEqual([]);
  });
});
