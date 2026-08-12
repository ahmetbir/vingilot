// Two worktrees, one file, before either of them merges — on screen.
//
// The pure derivation is proved without a browser and deliberately kept there:
// `desktop/src/features/runs/lib/worktreeOverlap.test.mjs` owns the pairwise
// intersection, the singular/plural, the ordering, the "at least" of a
// truncated list, and the rule that a worktree nothing has answered about is
// neither a mark-holder nor a peer; `worktreeOverlapScope.test.mjs` owns the
// per-repository boundary and the reading of each stat that feeds it (an
// unreadable one is silence, a truncated one is a floor); `worktreeStat.test.mjs`
// owns the boundary rule underneath both, that a record carrying no `paths`
// reads as `null` and not as an empty set.
//
// Six readings only a browser can give.
//
// 1. **The mark reaches the row at all.** A model that is correct and never
//    rendered is a failure this island has already had. Both overlapping rows
//    draw it; the count it carries is the model's.
// 2. **The sentence is on the row, in words.** The mark is `aria-hidden`, so
//    the row's `title` is the only accessible rendering of it — and each side
//    must name *the other* worktree, which is the assertion a symmetric bug
//    (both rows naming themselves) fails.
// 3. **A worktree that has not answered draws nothing, and is named by
//    nobody.** Two rows below have no usable stat, for the two different
//    reasons that happen in practice, and neither may appear in anyone's
//    sentence. This is the honesty rule, at the surface.
// 4. **The attention taxonomy is untouched.** The overlapping rows still
//    report `data-attention="dirty"` — the overlap did not become a fifth
//    state, did not outrank anything, and did not repaint the dot. That is the
//    design constraint in `lib/worktreeOverlap.ts`'s header, turned into an
//    assertion; a build that "simplified" the two signals into one goes red
//    here and nowhere else.
// 5. **A second project is in the workspace, and is compared against nobody.**
//    The fixture holds two repositories whose worktrees changed the same paths,
//    which is what a real workspace looks like — every project has a
//    `README.md`. The unit test proves the boundary on plain data; this proves
//    the *screen* is fed per project, because the numbers and the sentence a
//    row shows here are assembled from whatever the hook handed the model.
// 6. **It follows git's *next* answer, and follows it on git's own clock.**
//    Everything above is a reading of the first poll. The steady state — the
//    workspace has settled and a worktree's file list changes under it — is
//    where a memo that recomputes on the wrong input goes stale, and stale is
//    worse than absent here: an overlap that has been resolved and is still
//    drawn teaches the owner to stop believing the mark. The last two tests
//    below hand git a second and a third answer. The second of them first
//    stops the coordinator, and its own comment says why that is not
//    theatre — without it the assertion cannot fail.
//
// The fixture is stubbed at `worktree_stats` through the same `addInitScript`
// property trap `workspace-one-column.spec.ts` documents (the bridge assigns
// `invoke` during boot and the home-dir lookup runs on the first render, so an
// override installed after boot is too late). Real git is driven instead by
// `vingilot_worktree/stat.rs`'s own cargo tests, which is where "does git name
// the changed files" is proved; nothing here is a property of whatever happened
// to be in a temp directory.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Matches RunsScreen.tsx's hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const HOME = "/tmp/vingilot-overlap-home";
const REPO = {
  id: "repo-overlap",
  name: "vingilot",
  path: "/tmp/vingilot-overlap",
};
/** The second project, which exists so the comparison can be caught leaving
 * the first. Its worktree changes paths the rows under test also changed —
 * `src/app.ts` and `README.md`, the two most ordinary filenames there are. */
const OTHER_REPO = {
  id: "repo-other",
  name: "other",
  path: "/tmp/vingilot-other",
};

/** Five task worktrees across two projects. The first two collide; the next
 * two are the two ways a worktree can have nothing to say, and neither may be
 * drawn or named; the last belongs to the other project and is in nobody's
 * comparison at all.
 *
 * `owner_run_id` is what `worktreeCwd` derives the directory from
 * (`<root>/<owner_run_id>`), so it is also the key the stub below answers on. */
const WORKTREES = [
  { branch: "fix-login", repo: REPO.id, run: "run-login" },
  { branch: "spike-ui", repo: REPO.id, run: "run-ui" },
  { branch: "never-answered", repo: REPO.id, run: "run-silent" },
  { branch: "unreadable", repo: REPO.id, run: "run-unreadable" },
  { branch: "other-repo-work", repo: OTHER_REPO.id, run: "run-other" },
].map(({ branch, repo, run }) => ({
  added: null,
  base_commit: "0".repeat(40),
  binding_id: `wt-${run}`,
  branch,
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: run,
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: repo,
  role: "task",
}));

/** The changed-file lists git is pretending to report, by the run id that ends
 * the worktree's path.
 *
 * `fix-login` and `spike-ui` share `src/app.ts` and `src/auth.ts` and nothing
 * else — `README.md` and `src/ui.tsx` are each one worktree's own, so a build
 * that intersected badly (or unioned) reports 3 or 4 rather than 2. */
const CHANGED: Record<string, string[]> = {
  "run-login": ["src/app.ts", "src/auth.ts", "README.md"],
  "run-ui": ["src/app.ts", "src/auth.ts", "src/ui.tsx"],
  // `run-silent` is deliberately absent: git has not answered about it, which
  // is what `useWorktreeStats` leaves as no entry at all.
  //
  // `run-unreadable` DOES come back, carrying a path list that would overlap
  // both rows above — and marked `unreadable`. That combination is a shape the
  // backend never produces (`stat.rs`'s `unreadable()` sends an empty list),
  // and it is chosen precisely because it is discriminating: it is what the
  // assertion below would catch a build reading the raw stat instead of
  // `usableStat`. With the honest read it contributes nothing; with a careless
  // one it lights up three rows.
  "run-unreadable": ["src/app.ts", "src/auth.ts"],
  // The other project's worktree. It shares `src/app.ts` with BOTH rows above
  // and `README.md` with `run-login` alone — chosen so a comparison that
  // crossed the project boundary would be visible twice over: `run-login`'s
  // file count would read 3 rather than 2 (README.md joins the shared set),
  // and its sentence would name a branch from a repository it has nothing to
  // do with.
  "run-other": ["src/app.ts", "README.md"],
};

/** git's next answer: `spike-ui` picks up `README.md`, which `fix-login` was
 * already carrying alone. The shared set grows from 2 to 3 without either row
 * appearing or disappearing, so an assertion on it is an assertion that the
 * derivation *re-ran*, not that it ever ran. */
const CHANGED_GROWN: Record<string, string[]> = {
  ...CHANGED,
  "run-ui": ["src/app.ts", "src/auth.ts", "src/ui.tsx", "README.md"],
};

/** And the answer after that: `spike-ui`'s work landed, and the two rows now
 * share nothing. The mark has to *leave* — a conflict that has been resolved
 * and is still drawn is the failure mode that costs the mark its credibility. */
const CHANGED_RESOLVED: Record<string, string[]> = {
  ...CHANGED,
  "run-ui": ["src/ui.tsx"],
};

const UNREADABLE = new Set(["run-unreadable"]);

type StatStubWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
  /** The stub's changed-file table, read on every `worktree_stats` call rather
   * than closed over once, so a test can hand git a different answer mid-run
   * (`setChanged` below). */
  __OVERLAP_CHANGED__: Record<string, string[]>;
};

/** Replace git's answer. The next 5s stat poll (`useWorktreeStats.ts`) carries
 * it; nothing here forces a render. */
async function setChanged(page: Page, next: Record<string, string[]>) {
  await page.evaluate((changed) => {
    (window as unknown as StatStubWindow).__OVERLAP_CHANGED__ = changed;
  }, next);
}

/** Long enough for a 5s stat poll and the render after it, against a default
 * expect timeout of 5s that would expire mid-interval. */
const POLL_WAIT = { timeout: 15_000 };

async function openWorkspace(page: Page) {
  await page.setViewportSize({ height: 1117, width: 1728 });
  await installMockBridge(page);
  // Flipped by the returned `freezeCoordinator`, and read on every request
  // rather than at route time — see the test that uses it for why.
  let frozen = false;
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    if (frozen) {
      return route.fulfill({
        json: { detail: "stopped by the spec", error: "unavailable" },
        status: 503,
      });
    }
    const url = new URL(route.request().url());
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state: { repos: [REPO, OTHER_REPO] },
          state_hash: "mock-state-hash",
        },
      });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`) {
      return route.fulfill({ json: { worktrees: WORKTREES } });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`) {
      return route.fulfill({ json: { runs: [] } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });

  await page.addInitScript(
    ({
      changed,
      home,
      unreadable,
    }: {
      changed: Record<string, string[]>;
      home: string;
      unreadable: string[];
    }) => {
      const w = window as unknown as StatStubWindow;
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;
      const unread = new Set(unreadable);
      w.__OVERLAP_CHANGED__ = changed;

      const statFor = (path: string) => {
        const run = path.slice(path.lastIndexOf("/") + 1);
        // Read now, not closed over: `setChanged` swaps this table between
        // polls, which is how a *second* answer reaches the screen.
        const paths = w.__OVERLAP_CHANGED__[run];
        // No entry means git never answered about this worktree, which is what
        // leaving it out of the batch models.
        if (paths === undefined) return null;
        return {
          additions: paths.length,
          changedFiles: paths.length,
          deletions: 0,
          dirty: true,
          path,
          paths,
          pathsTruncated: false,
          unreadable: unread.has(run),
          untracked: 0,
        };
      };

      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);
        if (name === "worktree_stats") {
          const paths = ((args ?? {}) as { paths?: string[] }).paths ?? [];
          return Promise.resolve(
            paths.flatMap((path) => {
              const stat = statFor(path);
              return stat === null ? [] : [stat];
            }),
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
    },
    { changed: CHANGED, home: HOME, unreadable: [...UNREADABLE] },
  );

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();

  // The workspace lands on the triage board with no project open, and
  // `WorktreeDisclosure` — the only surface that draws these rows — is mounted
  // inside the SELECTED project's row. So the project is opened explicitly;
  // without this the board's rows are on screen instead, which carry the same
  // branch names and none of the marks under test.
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("worktree-column")).toBeVisible();

  return {
    /** Stop the coordinator answering. Its polls keep firing every 2s and
     * every one of them 503s, which `usePolling.ts` keeps the last-good data
     * through — so the rows, the projects and the grouping built from them
     * stop changing identity while git goes on answering. */
    freezeCoordinator: () => {
      frozen = true;
    },
  };
}

const row = (page: Page, run: string) =>
  page.getByTestId(`worktree-row-wt-${run}`);

/** The overlap mark inside one row, which is where it must be — a mark drawn
 * anywhere else on the screen would satisfy a page-level locator. */
const markIn = (page: Page, run: string) =>
  row(page, run).getByTestId("worktree-overlap");

test("two worktrees that changed the same files each mark the other", async ({
  page,
}) => {
  await openWorkspace(page);

  // Reading 1 — it reaches the row, with the model's own count.
  await expect(markIn(page, "run-login")).toBeVisible();
  await expect(markIn(page, "run-ui")).toBeVisible();
  await expect(markIn(page, "run-login")).toHaveAttribute(
    "data-overlap-files",
    "2",
  );

  // Reading 2 — the sentence is on the row, and each side names the OTHER.
  await expect(row(page, "run-login")).toHaveAttribute(
    "title",
    /2 files also changed in spike-ui/,
  );
  await expect(row(page, "run-ui")).toHaveAttribute(
    "title",
    /2 files also changed in fix-login/,
  );
  // Nobody names themselves.
  await expect(row(page, "run-login")).not.toHaveAttribute(
    "title",
    /also changed in fix-login/,
  );

  // The mark's own title answers "which files?" — the question the sentence
  // provokes, and the reason the overlap is worth drawing at all.
  const detail = await markIn(page, "run-login").getAttribute("title");
  expect(detail).toContain("src/app.ts");
  expect(detail).toContain("src/auth.ts");
  // Files that are one worktree's alone are not shared, and are not listed.
  expect(detail).not.toContain("README.md");
  expect(detail).not.toContain("src/ui.tsx");
});

test("a worktree nothing has answered about draws no mark and is named by nobody", async ({
  page,
}) => {
  await openWorkspace(page);
  // The two rows above have settled, so the poll this row would have been in
  // has already answered.
  await expect(markIn(page, "run-login")).toBeVisible();

  // Reading 3, both halves. git never answered about one and could not read
  // the other; neither is a claim about any file.
  await expect(row(page, "run-silent")).toBeVisible();
  await expect(markIn(page, "run-silent")).toHaveCount(0);
  await expect(row(page, "run-unreadable")).toBeVisible();
  await expect(markIn(page, "run-unreadable")).toHaveCount(0);

  // And neither is named by the rows that DID answer — the unreadable one
  // carries a colliding path list on purpose, so this is the assertion that
  // fails if the raw stat is read in place of `usableStat`.
  for (const run of ["run-login", "run-ui"]) {
    await expect(row(page, run)).not.toHaveAttribute(
      "title",
      /never-answered|unreadable/,
    );
  }
  await expect(markIn(page, "run-login")).toHaveAttribute(
    "data-overlap-files",
    "2",
  );
});

test("another project's worktree is in nobody's overlap", async ({ page }) => {
  await openWorkspace(page);
  await expect(markIn(page, "run-login")).toBeVisible();

  // Reading 5. `run-other` changed `src/app.ts` (shared with both rows here)
  // and `README.md` (shared with `run-login`), and it is in another
  // repository — so neither row may count those files or say its name. Two
  // projects with a `README.md` each are not in conflict.
  for (const run of ["run-login", "run-ui"]) {
    await expect(row(page, run)).not.toHaveAttribute(
      "title",
      /other-repo-work/,
    );
  }
  const detail = await markIn(page, "run-login").getAttribute("title");
  expect(detail).not.toContain("README.md");
  expect(detail).not.toContain("other-repo-work");

  // The count is the within-project one: `README.md` did not join the shared
  // set, which it would have the moment the comparison went flat.
  await expect(markIn(page, "run-login")).toHaveAttribute(
    "data-overlap-files",
    "2",
  );
  await expect(markIn(page, "run-ui")).toHaveAttribute(
    "data-overlap-files",
    "2",
  );
});

test("the overlap is not a fifth attention state", async ({ page }) => {
  await openWorkspace(page);
  await expect(markIn(page, "run-login")).toBeVisible();

  // Reading 4. Both overlapping worktrees are dirty and stay dirty: the
  // overlap did not become a state, outrank one, or repaint the dot. A build
  // that folded the two signals together goes red here.
  for (const run of ["run-login", "run-ui"]) {
    const dot = row(page, run).locator("[data-attention]");
    await expect(dot).toHaveAttribute("data-attention", "dirty");
  }
  // The attention sentence survives alongside the overlap one rather than
  // being replaced by it — two statements, joined.
  await expect(row(page, "run-login")).toHaveAttribute(
    "title",
    /uncommitted changes.*2 files also changed in spike-ui/,
  );
});

test("the mark follows git's next answer, and leaves when the overlap does", async ({
  page,
}) => {
  // Reading 6, in the ordinary case: the workspace is up, and a worktree's
  // changed-file list moves under it — twice. Each assertion below is about a
  // *transition*, so none of them can be satisfied by the first poll's answer
  // still being on screen.
  //
  // Three stat polls at 5s apiece, plus the load.
  test.setTimeout(60_000);
  await openWorkspace(page);
  await expect(markIn(page, "run-login")).toHaveAttribute(
    "data-overlap-files",
    "2",
  );

  // `spike-ui` starts touching `README.md`, which `fix-login` already had. The
  // count grows; the rows do not move.
  await setChanged(page, CHANGED_GROWN);
  await expect(markIn(page, "run-login")).toHaveAttribute(
    "data-overlap-files",
    "3",
    POLL_WAIT,
  );
  await expect(row(page, "run-login")).toHaveAttribute(
    "title",
    /3 files also changed in spike-ui/,
    POLL_WAIT,
  );
  // The new file is named, not just counted.
  expect(await markIn(page, "run-login").getAttribute("title")).toContain(
    "README.md",
  );

  // Then `spike-ui` lands its work and the two share nothing. The mark has to
  // go — and the row keeps its attention dot, which was never the overlap's to
  // remove.
  await setChanged(page, CHANGED_RESOLVED);
  await expect(markIn(page, "run-login")).toHaveCount(0, POLL_WAIT);
  await expect(markIn(page, "run-ui")).toHaveCount(0, POLL_WAIT);
  await expect(row(page, "run-login")).not.toHaveAttribute(
    "title",
    /also changed in/,
  );
  await expect(
    row(page, "run-login").locator("[data-attention]"),
  ).toHaveAttribute("data-attention", "dirty");
});

test("the mark follows git even while the coordinator's rows stand still", async ({
  page,
}) => {
  // Reading 6, isolated — and the isolation is the test.
  //
  // The overlap is a `React.useMemo` in `useWorktreeSignals.ts` keyed on
  // `[grouped, repos, stats]`. In the running app `grouped` is rebuilt every
  // 2s regardless, because `usePolling` hands `RunsScreen` a freshly parsed
  // worktree array on every tick and the grouping memo is keyed on its
  // identity. So a memo that had *dropped* `stats` would still recompute
  // within 2s off that churn and would still show the right number — which is
  // exactly what the test above cannot see past, and why it is not enough on
  // its own.
  //
  // Stopping the coordinator removes the churn: its polls keep firing and keep
  // 503ing, `usePolling` holds the last-good data by reference, and `grouped`
  // and `repos` go still. git alone is still answering. Now the only thing
  // that can bring a new number to the row is the memo reading `stats`, and
  // the assertion below fails if it does not.
  //
  // It is also a real state rather than a rig: the coordinator going down
  // while the checkouts on disk carry on is the case `usePolling`'s
  // keep-last-good branch exists for.
  test.setTimeout(60_000);
  const { freezeCoordinator } = await openWorkspace(page);
  await expect(markIn(page, "run-login")).toHaveAttribute(
    "data-overlap-files",
    "2",
  );

  freezeCoordinator();
  // Two coordinator intervals, so any answer already in flight has landed and
  // every later one is a 503. After this the workspace's rows are frozen.
  await page.waitForTimeout(4_500);

  await setChanged(page, CHANGED_GROWN);
  await expect(markIn(page, "run-login")).toHaveAttribute(
    "data-overlap-files",
    "3",
    POLL_WAIT,
  );
  await expect(row(page, "run-login")).toHaveAttribute(
    "title",
    /3 files also changed in spike-ui/,
    POLL_WAIT,
  );
});
