// The scope sentence can be put away, and it is never made shorter
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 1).
//
// > *"üstteki prompt mudur nedir çok sinir bozucu, onu kapatma ya da küçültme
// > tuşu da gelmeli."*
//
// **Why it was in the way, measured.** At 1728×1117 — his 16-inch MacBook
// Pro's own resolution — the team pane is 243px wide, and the sentence is a
// little under 500 characters because it enumerates what is and is not sent.
// Wrapped in a 243px column that came to a header of **401px inside a 992px
// pane**: 40% of the conversation, above the conversation, on every visit for
// the life of the thread.
//
// **The thing this must not become.** The cheap fix is to write a shorter
// sentence, and the shorter sentence would be a different claim — "the path is
// sent" instead of an enumeration that says where the path goes, that nothing
// is prepended to his messages, and that the agents are not started in that
// directory and may not be able to open it. Each of those is something he could
// otherwise only learn by being wrong about it. So this spec asserts the
// sentence word for word while it is open, and asserts that the collapsed state
// puts *no* claim in its place — a paraphrase in the closed state would be the
// same mistake wearing a smaller font.
//
// Four readings, none of them reachable without a browser: that the sentence is
// there in full on a thread nobody has put away; that putting it away gives the
// height to the conversation; that the whole of it comes back with one gesture;
// and that the choice survives a reload and is recorded against the thread's
// own channel rather than against the app.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
const REPO = {
  id: "repo-scope",
  name: "vingilot",
  path: "/tmp/vingilot-scope",
};

/** The 16-inch MacBook Pro's default logical resolution. The whole complaint is
 * a wrapping problem, so the column width is the test. */
const SIXTEEN_INCH = { height: 1117, width: 1728 };

/** The clauses that make the sentence worth its length, written out here rather
 * than imported from `teamThread.ts` — a spec that built the expectation the
 * way the product does would pass through any shortening of either. */
const SCOPE_CLAUSES = [
  "This thread is about /tmp/vingilot-scope.",
  "The path is in this channel's description and the branch is in the name of the channel it lives in",
  "neither is put in front of your messages: what you type is what is sent, and nothing else goes with it, not the diff, not the plan, not the run's transcript",
  "The team's agents are not started in this directory and may not be able to open it at all",
];

const PERSONAS = [
  { displayName: "Planner", id: "persona-planner", systemPrompt: "Plan it." },
  { displayName: "Builder", id: "persona-builder", systemPrompt: "Build it." },
];

const TEAM = {
  description: "Plans and builds.",
  id: "team-launch",
  name: "Launch Team",
  personaIds: ["persona-planner", "persona-builder"],
};

async function mockCoordinator(page: Page) {
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state: { repos: [REPO] },
          state_hash: "mock-state-hash",
        },
      });
    }
    if (url.pathname.endsWith("/runs")) {
      return route.fulfill({ json: { runs: [] } });
    }
    if (url.pathname.endsWith("/worktrees")) {
      return route.fulfill({ json: { worktrees: [] } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });
}

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

async function choosePane(page: Page, key: string) {
  const picker = page.getByTestId("pane-picker");
  await picker.click();
  await expect(picker).toHaveAttribute("data-state", "open");
  await waitForAnimations(page);
  await page.getByTestId(`pane-choice-${key}`).click();
  await expect(picker).toHaveAttribute("data-state", "closed");
  await waitForAnimations(page);
}

/** The work surface with this worktree's team pane in the right slot, its
 * backend stubbed. Stops short of choosing a team, so it can be reused for the
 * trip back after a reload — where the team is already chosen. */
async function openWorkspace(page: Page) {
  await page.setViewportSize(SIXTEEN_INCH);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  // The home-dir lookup runs once, on RunsScreen's mount, so the stub has to be
  // in place before the screen that reads it mounts; leaving and coming back is
  // what re-runs it. Both gotos are hash-only, so the document survives.
  await stubBackend(page);
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await choosePane(page, "team");
}

function hostedComposer(page: Page) {
  return page.getByTestId("team-thread").getByTestId("message-composer");
}

/** Heights of the pane, the header carrying the scope, and the conversation
 * under it — which is what the header is taking from. */
async function heights(page: Page) {
  return page.evaluate(() => {
    const height = (selector: string) => {
      const element = document.querySelector(selector);
      return element === null
        ? null
        : Math.round(element.getBoundingClientRect().height);
    };
    return {
      header: height('[data-testid="team-thread-header"]'),
      pane: height('[data-testid="pane-team"]'),
      thread: height('[data-testid="team-thread"]'),
    };
  });
}

/** What this app has written down about scopes, and what it points at. */
async function stored(page: Page) {
  return page.evaluate(() => {
    const read = (key: string) => {
      try {
        return JSON.parse(window.localStorage.getItem(key) ?? "null");
      } catch {
        return null;
      }
    };
    return {
      bindings: read("vingilot-team-thread.v1"),
      scopes: read("vingilot-team-scope.v1"),
    };
  });
}

test("the scope earns its length once, and is put away for good after that", async ({
  page,
}) => {
  await installMockBridge(page, { personas: PERSONAS, teams: [TEAM] });
  await openWorkspace(page);

  await expect(page.getByTestId("team-choice")).toBeVisible();
  await page.getByTestId(`team-choice-${TEAM.id}`).click();
  await page.getByTestId("team-open").click();
  await expect(hostedComposer(page)).toBeVisible({ timeout: 20_000 });

  // 1. A thread nobody has put away shows the whole sentence.
  const scope = page
    .getByTestId("team-thread-header")
    .getByTestId("team-scope");
  await expect(scope).toBeVisible();
  for (const clause of SCOPE_CLAUSES) await expect(scope).toContainText(clause);

  const open = await heights(page);
  expect(open.header).not.toBeNull();
  expect(open.pane).not.toBeNull();
  // The complaint, as a number: it is a large fraction of the pane.
  expect(open.header as number).toBeGreaterThan(
    ((open.pane as number) * 3) / 10,
  );

  // 2. Put away, the header stops being most of the pane and the conversation
  // gets what it was holding.
  await page.getByTestId("team-scope-toggle").click();
  await expect(scope).toHaveCount(0);
  const shut = await heights(page);
  expect(shut.header as number).toBeLessThan(120);
  expect((shut.thread as number) - (open.thread as number)).toBeGreaterThan(
    250,
  );

  // The collapsed state says nothing *about* the scope — no summary stands in
  // for the enumeration. What is left is a door, not a claim.
  const header = page.getByTestId("team-thread-header");
  for (const clause of SCOPE_CLAUSES) {
    await expect(header).not.toContainText(clause);
  }
  await expect(page.getByTestId("team-scope-toggle")).toHaveText(
    "the scope of this thread…",
  );

  // 3. The whole of it comes back with the same gesture. Word for word — a
  // control that reopened a trimmed version would be the shortening arriving
  // by another door.
  await page.getByTestId("team-scope-toggle").click();
  for (const clause of SCOPE_CLAUSES) await expect(scope).toContainText(clause);
  const reopened = await heights(page);
  expect(reopened.header).toBe(open.header);

  // 4. Put away again, and the choice is recorded against this thread's own
  // channel rather than against the app, and is still there when he comes back
  // to the pane.
  await page.getByTestId("team-scope-toggle").click();
  await expect(scope).toHaveCount(0);
  const written = await stored(page);
  const bindings = written.bindings as Record<string, { channelId: string }>;
  const channelIds = Object.values(bindings).map(
    (binding) => binding.channelId,
  );
  expect(channelIds.length).toBe(1);
  // Per thread, not per app and not per worktree: the key the choice is filed
  // under is the channel this conversation IS.
  expect(Object.keys(written.scopes as Record<string, true>)).toEqual(
    channelIds,
  );

  // Coming back, through a real unmount of the pane. Deliberately not a
  // `page.reload()`: the mock relay's channels live in the page, so the thread
  // this spec opened does not exist after a document reload and the pane would
  // be reporting a lost channel rather than a remembered preference. What is
  // under test is that the pane re-reads the record on mount, and swapping the
  // right slot to another pane and back is exactly that.
  await choosePane(page, "diff");
  await expect(page.getByTestId("pane-diff")).toBeVisible();
  await choosePane(page, "team");
  await expect(hostedComposer(page)).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByTestId("team-thread-header").getByTestId("team-scope"),
  ).toHaveCount(0);
  await expect(page.getByTestId("team-scope-toggle")).toBeVisible();

  // And the way back is still one gesture, on the thread he came back to.
  await page.getByTestId("team-scope-toggle").click();
  for (const clause of SCOPE_CLAUSES) {
    await expect(
      page.getByTestId("team-thread-header").getByTestId("team-scope"),
    ).toContainText(clause);
  }
});
