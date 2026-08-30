// The diff pane keeps up with the work happening in the terminal beside it.
//
// The owner's complaint, in full: "diff kısmı belirli intervallerle refresh
// etmeli. şu an sadece açıldığı andaki halini gösteriyor." A pane that shows
// the worktree as it was when it opened is not merely unhelpful — it looks
// current, so it lies about what is on disk while an agent edits it.
//
// Five readings, and none of them can be got at from a unit test:
//
//   1. A change made *after* the pane opened arrives on its own. No click, no
//      keypress, no re-choosing the pane.
//   2. A refresh does not move the reader. The file he has open stays open
//      even when a new file sorts above it and every index shifts.
//   3. A read slower than the cadence is never started twice. The proof is
//      the call log's own timestamps: no read begins before the last one has
//      landed.
//   4. A pane nobody can see does not spend git subprocesses — and the wait
//      it spends hidden is past due, so what is proved is the gate and not
//      the gap.
//   5. Coming back to the window reads at once. Each wait there is inside a
//      deliberately long gap, so a read that happens is one the cadence
//      cannot account for.
//
// The scheduling arithmetic — the gap, the clamps, the label — is proved in
// `src/features/runs/lib/diffRefresh.test.mjs`. What is proved here is that
// the pane is wired to it.
//
// `worktree_diff` is stubbed rather than run: what is under test is when the
// pane asks and what it does with the answer, and a real git would make the
// timings a property of the machine. The stub records every call with the
// times it started and finished, which is what makes reading 3 possible at
// all.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Matches RunsScreen.tsx's hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPO = {
  id: "repo-diff",
  name: "watched",
  path: "/tmp/vingilot-watched",
};

/** `MIN_GAP_MS` in `lib/diffRefresh.ts`. A read that costs nothing waits this
 * long, so every "it re-read on its own" below has to outlast it. */
const MIN_GAP_MS = 3_000;

interface DiffCall {
  at: number;
  done: number | null;
}

interface DiffStub {
  calls: DiffCall[];
  delayMs: number;
  paths: string[];
}

type StubWindow = Window & {
  __vgDiff: DiffStub;
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
};

/** One project, no runs, no extra worktrees — the smallest workspace that
 * still reaches the work surface with a worktree under it. */
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

/** The Tauri surfaces this screen needs, plus a `worktree_diff` whose answer
 * the test owns. The pty commands succeed and emit nothing — the terminal has
 * to mount because the pane beside it is what is under test, but nothing about
 * a shell is. */
async function stubBackend(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as StubWindow;
    w.__vgDiff = { calls: [], delayMs: 0, paths: ["src/one.ts"] };
    const internals = w.__TAURI_INTERNALS__;
    const passThrough = internals.invoke.bind(internals);

    function answer(base: string) {
      const paths = w.__vgDiff.paths;
      return {
        additions: paths.length,
        base,
        deletions: 0,
        files: paths.map((path) => ({
          additions: 1,
          binary: false,
          change: "modified",
          deletions: 0,
          oldPath: null,
          patch: `@@ -1 +1 @@\n-was\n+is ${path}\n`,
          path,
          truncated: false,
        })),
        limits: {
          maxFiles: 400,
          maxPatchBytes: 262_144,
          maxPatchLines: 2_000,
          maxUntracked: 100,
        },
        omittedFiles: 0,
        omittedUntracked: 0,
      };
    }

    internals.invoke = (cmd, args, opts) => {
      const name = String(cmd);
      if (name.startsWith("plugin:path|")) return Promise.resolve("/tmp/home/");
      if (name === "pty_backing") return Promise.resolve("tmux");
      if (name.startsWith("pty_")) return Promise.resolve(null);
      if (name === "worktree_diff") {
        const base = String((args as { base?: unknown })?.base ?? "HEAD");
        const call: { at: number; done: number | null } = {
          at: Date.now(),
          done: null,
        };
        w.__vgDiff.calls.push(call);
        const value = answer(base);
        return new Promise((resolve) => {
          setTimeout(() => {
            call.done = Date.now();
            resolve(value);
          }, w.__vgDiff.delayMs);
        });
      }
      return passThrough(cmd, args, opts);
    };
  });
}

/** The work surface with the Diff pane in the right slot, its first answer
 * already on screen. */
async function openDiffPane(page: Page) {
  // Wide enough that the surface can hold a split at all — 1280 is narrow
  // enough that `effectiveSolo` renders the terminal alone with the right
  // pane on its rail.
  await page.setViewportSize({ height: 900, width: 1700 });
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();

  // The home-dir lookup runs once, on RunsScreen's mount, and the diff pane
  // has no cwd without it — so the stub has to be in place before the screen
  // that reads it mounts. Leaving and returning is what re-runs it.
  await stubBackend(page);
  await page.goto("/#/");
  await page.goto("/#/workspace");

  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();

  await page.getByTestId("dock-tab-diff").click();
  await expect(page.getByTestId("pane-diff")).toBeVisible();

  // At 1700 the Diff pane is 215px, which `lib/diffLayout.ts` puts the file
  // list *over* the patch rather than beside it: the list yields, because a
  // 288px column in a 215px pane is what left the patch 32px on the owner's
  // laptop (workspace-diff-fits.spec.ts measures it). Everything below is about
  // the list keeping up with the worktree, so this opens the drawer and leaves
  // it open — picking a file does not close it.
  const drawer = page.getByTestId("worktree-diff-list-toggle");
  if ((await drawer.count()) > 0) await drawer.click();
  await expect(page.getByTestId("worktree-diff-files")).toBeVisible();
}

function calls(page: Page): Promise<DiffCall[]> {
  return page.evaluate(() => (window as unknown as StubWindow).__vgDiff.calls);
}

async function setStub(
  page: Page,
  next: Partial<Pick<DiffStub, "delayMs" | "paths">>,
) {
  await page.evaluate((patch) => {
    const stub = (window as unknown as StubWindow).__vgDiff;
    if (patch.delayMs !== undefined) stub.delayMs = patch.delayMs;
    if (patch.paths !== undefined) stub.paths = patch.paths;
  }, next);
}

/** Waits until a read that started *after now* has landed, and answers the
 * call count at that moment. Every timing assertion below is relative to a
 * read taken under the delay the test just set — a count taken while an older,
 * faster read was still in flight would be measured against the wrong gap. */
async function settled(page: Page): Promise<number> {
  const mark = (await calls(page)).length;
  await expect
    .poll(
      async () => {
        const log = await calls(page);
        return log.length > mark && log[log.length - 1].done !== null;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  return (await calls(page)).length;
}

/** Waits until nothing is in flight and answers the call count. Unlike
 * `settled` this does not require a *new* read — after a read that earned a
 * twelve-second gap there will not be one for twelve seconds, which is the
 * whole point of the wait that follows. */
async function quiet(page: Page): Promise<number> {
  await expect
    .poll(
      async () => {
        const log = await calls(page);
        return log.length > 0 && log[log.length - 1].done !== null;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  return (await calls(page)).length;
}

/** What the window reports about being on screen. Overriding the getter is the
 * only way to say "minimised" to a page Playwright is driving. */
async function setVisibility(page: Page, state: "hidden" | "visible") {
  await page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => value,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

test.describe("the diff keeps up with the work", () => {
  test("a change made after the pane opened arrives without being asked for", async ({
    page,
  }) => {
    await openDiffPane(page);
    await expect(page.getByTestId("worktree-diff-file-0")).toContainText(
      "src/one.ts",
    );
    // The whole complaint was a view that was stale without looking it, so
    // the pane says how old it is from the first answer onwards.
    await expect(page.getByTestId("worktree-diff-freshness")).toContainText(
      "read",
    );

    // The agent, working in the terminal beside this pane, touches a second
    // file. Nothing below clicks, types or re-chooses the pane.
    await setStub(page, { paths: ["src/one.ts", "src/two.ts"] });

    await expect(page.getByTestId("worktree-diff-file-1")).toContainText(
      "src/two.ts",
      { timeout: MIN_GAP_MS * 3 },
    );
    await expect(page.getByTestId("worktree-diff-files")).toContainText(
      "src/one.ts",
    );
    // And it reported the new total, not the one it opened with.
    await expect(page.getByTestId("pane-diff")).toContainText(
      "2 files changed",
    );

    // Reverting is picked up the same way. A pane that only ever grew would
    // pass everything above while showing files that no longer differ.
    await setStub(page, { paths: ["src/two.ts"] });
    await expect(page.getByTestId("worktree-diff-files")).not.toContainText(
      "src/one.ts",
      { timeout: MIN_GAP_MS * 3 },
    );
  });

  test("a refresh leaves the reader exactly where he was", async ({ page }) => {
    await openDiffPane(page);
    await setStub(page, { paths: ["src/b.ts", "src/c.ts"] });
    await expect(page.getByTestId("worktree-diff-file-1")).toContainText(
      "src/c.ts",
      { timeout: MIN_GAP_MS * 3 },
    );

    // He opens the second file and starts reading it.
    await page.getByTestId("worktree-diff-file-1").click();
    await expect(page.getByTestId("worktree-diff-open")).toHaveText("src/c.ts");

    // The agent creates a file that sorts above both. Every index shifts by
    // one; the file he is reading must not.
    await setStub(page, { paths: ["src/a.ts", "src/b.ts", "src/c.ts"] });
    await expect(page.getByTestId("worktree-diff-file-0")).toContainText(
      "src/a.ts",
      { timeout: MIN_GAP_MS * 3 },
    );
    await expect(page.getByTestId("worktree-diff-open")).toHaveText("src/c.ts");
    await expect(page.getByTestId("pane-diff")).toContainText("is src/c.ts");

    // And the list did not blank on the way through: a refresh that emptied
    // the pane for the length of a read is a flicker on every cadence.
    await expect(page.getByTestId("worktree-diff-files")).toBeVisible();
  });

  test("a read slower than the cadence is never started on top of itself", async ({
    page,
  }) => {
    await openDiffPane(page);
    await expect(page.getByTestId("worktree-diff-file-0")).toBeVisible();

    // A read that takes two and a half seconds — a hundred-file worktree on a
    // busy machine. The pump wonders once a second, so a pane that did not
    // check whether one was already in flight would start two more before the
    // first landed. Nothing is clicked: an explicit press deliberately
    // supersedes a read in flight, and what is under test here is the
    // unprompted path.
    await setStub(page, { delayMs: 2_500 });
    await page.waitForTimeout(6_000);

    const log = await calls(page);
    expect(log.length).toBeGreaterThan(1);
    for (let i = 1; i < log.length; i += 1) {
      const previous = log[i - 1];
      expect(
        previous.done,
        `read ${i} started while read ${i - 1} was still running`,
      ).not.toBeNull();
      expect(log[i].at).toBeGreaterThanOrEqual(previous.done ?? 0);
    }
  });

  test("a pane nobody can see does not read at all", async ({ page }) => {
    await openDiffPane(page);
    await expect(page.getByTestId("worktree-diff-file-0")).toBeVisible();

    // A read that costs nothing earns the floor — three seconds — so the five
    // seconds spent hidden below is past due twice over. That is what makes
    // the assertion about the gate rather than about the gap.
    await setStub(page, { delayMs: 0 });
    const before = await settled(page);

    // The window goes away: minimised, on another Space, or behind a
    // full-screen app.
    await setVisibility(page, "hidden");
    await page.waitForTimeout(5_000);
    expect(
      (await calls(page)).length,
      "a pane nobody can see spent git subprocesses",
    ).toBe(before);

    // And it starts again when it comes back — a gate that never opened would
    // be a worse bug than the one this is all about.
    await setVisibility(page, "visible");
    await expect
      .poll(async () => (await calls(page)).length, { timeout: 5_000 })
      .toBeGreaterThan(before);
  });

  test("coming back to the window obeys the cadence rather than jumping it", async ({
    page,
  }) => {
    await openDiffPane(page);
    await expect(page.getByTestId("worktree-diff-file-0")).toBeVisible();

    // Six hundred milliseconds of git buys twelve seconds of quiet. Every wait
    // below is well inside that, so a read that happens is one the cadence
    // cannot account for — and the point of this test is that none does.
    //
    // This asserted the opposite until the wake-up floor was removed. Letting a
    // wake-up through on MIN_GAP_MS made alternating with an editor every few
    // seconds — the workflow the pane exists for — cost 15% of a core at these
    // read times and 45% at 2.5s ones, against a module built around 5%. The
    // exemption bought nothing either: an absence long enough for the worktree
    // to have moved outlasts the gap on its own, so it reads immediately
    // anyway. What it actually bought was re-reading after a three-second
    // tab-out.
    await setStub(page, { delayMs: 600 });

    const beforeShown = await settled(page);
    await setVisibility(page, "hidden");
    await page.waitForTimeout(3_500);
    expect(
      (await calls(page)).length,
      "the cadence read during a wait it was not due for",
    ).toBe(beforeShown);
    await setVisibility(page, "visible");
    await page.waitForTimeout(2_500);
    expect(
      (await calls(page)).length,
      "coming back inside the gap read anyway",
    ).toBe(beforeShown);

    // Focus is the other absence, and the one macOS reports for a window that
    // was merely behind another: still `visible`, so nothing above would have
    // fired. It gates nothing and now prompts nothing either — a diff on a
    // second monitor is being watched, and ⌘-tabbing back to one is not news.
    const beforeFocus = (await calls(page)).length;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(2_500);
    expect((await calls(page)).length).toBe(beforeFocus);

    // The gap itself still ends: waited out, the pump reads without being asked.
    await expect
      .poll(async () => (await calls(page)).length, { timeout: 15_000 })
      .toBeGreaterThan(beforeShown);
  });
});
