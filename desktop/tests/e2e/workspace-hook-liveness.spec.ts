// The agent in the terminal, on screen — the dot, the sentence and the bottom
// bar (vingilot/docs/plans/2026-08-12-hooks-and-the-dots.md, Task 3).
//
// The pure halves are proved without a browser and deliberately kept there:
// `desktop/src/features/runs/lib/attentionSignal.test.mjs` owns the taxonomy
// and the precedence (that a run and a dirty tree still outrank what the
// terminal says, that `waiting` draws nothing, that no session changes no other
// state); `liveAgents.test.mjs` owns the reading of the backend's answer and
// the two-step join; `attentionNotice.test.mjs` owns the edge the OS
// notification fires on. The backend's own decay, event map and token refusal
// are `vingilot_hooks`' cargo tests, over a real loopback round trip.
//
// Four readings only a browser can give.
//
// 1. **The signal reaches a row at all.** A model that is correct and never
//    rendered is a failure this island has already had. `hook_liveness` is
//    stubbed and the worktree row's dot has to change with it.
// 2. **The sentence is on the row, in words, and it names its source.** The dot
//    is `aria-hidden`, so the row's `title` is the only accessible rendering —
//    and it must say "an agent in this worktree's terminal", not "the
//    coordinator", because a needs-you the owner cannot account for is how the
//    dot loses its credibility.
// 3. **The bottom bar carries the selected worktree's agent, and only while
//    there is one.** Absence says nothing: the segment must not exist when no
//    session has spoken, which is also what keeps the bar's geometry unchanged
//    on every screen that has no agent in it.
// 4. **It follows the endpoint's *next* answer.** Everything above is the first
//    poll. A permission prompt that has been answered and is still drawn is the
//    failure that costs this signal the same credibility a wrong dot costs the
//    row — so the stub is changed under a settled workspace and the dot, the
//    sentence and the bar all have to move. The coordinator is stopped first,
//    for `workspace-overlap.spec.ts`'s reason: without it the rows are rebuilt
//    every 2s anyway and the assertion cannot fail.
//
// `hook_liveness` is stubbed through the same `addInitScript` property trap
// `workspace-one-column.spec.ts` documents — the bridge assigns `invoke` during
// boot and the home-dir lookup runs on the first render, so an override
// installed after boot is too late. Nothing here starts a `claude`, opens a
// socket or posts anything: the endpoint's own tests do that against a
// loopback listener they bind themselves.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Matches RunsScreen.tsx's hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const HOME = "/tmp/vingilot-liveness-home";
const REPO = {
  id: "repo-liveness",
  name: "vingilot",
  path: "/tmp/vingilot-liveness",
};

/** Two task worktrees. `run-agent` is the one an agent is working in; `run-idle`
 * is the control — it is in every stub's silence, so an assertion that it stays
 * quiet is what catches a build drawing the map's single entry on every row. */
const WORKTREES = ["run-agent", "run-idle"].map((run) => ({
  added: null,
  base_commit: "0".repeat(40),
  binding_id: `wt-${run}`,
  branch: run,
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: run,
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
}));

/** The directory the coordinator's naming convention puts `run-agent` in —
 * `<worktreeRoot>/<owner_run_id>`, and `worktreeRoot` is `<home>/.vingilot/
 * worktrees` (`projects.ts`'s `DEFAULT_WORKTREE_ROOT_SUFFIX`).
 *
 * The stub files its agent under a `local:` binding id and this **path**, which
 * is the honest fixture: the backend derives its key from the agent's own cwd
 * and has never heard of a coordinator binding id, so the row can only find it
 * through the path fallback. A build that only ever looked the id up in the map
 * passes nothing below. */
const AGENT_PATH = `${HOME}/.vingilot/worktrees/run-agent`;

/** `local:` + hex of the path — `localBindingId`'s output, written out here the
 * way the backend would produce it rather than imported, so this fixture is a
 * statement about the wire format and not a re-run of the encoder. */
function localBindingId(path: string): string {
  return `local:${[...new TextEncoder().encode(path)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

const WORKING = {
  byBinding: {
    [localBindingId(AGENT_PATH)]: {
      path: AGENT_PATH,
      sentence: "working — Bash",
      sessions: 1,
      state: "working",
      tool: "Bash",
    },
  },
  unattributed: null,
};

const ASKING = {
  byBinding: {
    [localBindingId(AGENT_PATH)]: {
      path: AGENT_PATH,
      sentence: "waiting for approval: Bash",
      sessions: 1,
      state: "asking",
      tool: "Bash",
    },
  },
  unattributed: null,
};

/** The endpoint has forgotten the session — a `Stop`, or the decay. This is the
 * answer that has to make the dot and the bar *leave*. */
const SILENT = { byBinding: {}, unattributed: null };

type LivenessWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
  /** Read on every `hook_liveness` call rather than closed over once, so a test
   * can hand the screen a different answer mid-run. */
  __LIVENESS__: unknown;
};

async function setLiveness(page: Page, next: unknown) {
  await page.evaluate((answer) => {
    (window as unknown as LivenessWindow).__LIVENESS__ = answer;
  }, next);
}

/** Long enough for a 2s liveness poll and the render after it, against a
 * default expect timeout that would expire mid-interval. */
const POLL_WAIT = { timeout: 15_000 };

const row = (page: Page, run: string) =>
  page.getByTestId(`worktree-row-wt-${run}`);

const dotIn = (page: Page, run: string) =>
  row(page, run).locator("[data-attention]");

async function openWorkspace(page: Page) {
  await page.setViewportSize({ height: 1117, width: 1728 });
  await installMockBridge(page);
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
          state: { repos: [REPO] },
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
    ({ first, home }: { first: unknown; home: string }) => {
      const w = window as unknown as LivenessWindow;
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;
      w.__LIVENESS__ = first;

      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);
        if (name === "hook_liveness") return Promise.resolve(w.__LIVENESS__);
        // git answers about nothing, on purpose: with no stat anywhere every
        // row's dot is either what the terminal says or nothing at all, so the
        // assertions below are about this signal and not about how a stub
        // happened to spell "clean".
        if (name === "worktree_stats") return Promise.resolve([]);
        if (name === "worktree_list") return Promise.resolve([]);
        if (name === "pty_backing") return Promise.resolve("tmux");
        if (name.startsWith("pty_")) return Promise.resolve(null);
        if (fallback === null)
          return Promise.reject(new Error(`no host for ${name}`));
        return fallback(cmd, args, opts);
      };

      const internals = (w.__TAURI_INTERNALS__ ??
        {}) as LivenessWindow["__TAURI_INTERNALS__"];
      w.__TAURI_INTERNALS__ = internals;
      Object.defineProperty(internals, "invoke", {
        configurable: true,
        get: () => invoke,
        set: (fn: (cmd: string, args?: unknown, opts?: unknown) => unknown) => {
          fallback = fn;
        },
      });
    },
    { first: WORKING, home: HOME },
  );

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  // The landing view is the triage board; the worktree column that draws these
  // rows lives inside the selected project.
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("worktree-column")).toBeVisible();

  return {
    freezeCoordinator: () => {
      frozen = true;
    },
  };
}

test("an agent working in a worktree turns its dot, and only its own", async ({
  page,
}) => {
  await openWorkspace(page);

  // Reading 1 — the signal reaches the row, through the path fallback.
  await expect(dotIn(page, "run-agent")).toHaveAttribute(
    "data-attention",
    "working",
    POLL_WAIT,
  );
  // Reading 2 — the sentence, on the row, naming this signal and not the
  // coordinator.
  await expect(row(page, "run-agent")).toHaveAttribute(
    "title",
    /an agent in this worktree's terminal is working: Bash/,
  );

  // The control: git said nothing about either row and the endpoint said
  // nothing about this one, so it has no dot at all — never a quiet one.
  await expect(dotIn(page, "run-idle")).toHaveAttribute(
    "data-attention",
    "none",
  );
});

test("the bottom bar names the selected worktree's agent, and drops it when the session ends", async ({
  page,
}) => {
  const { freezeCoordinator } = await openWorkspace(page);
  await page.getByTestId("worktree-row-wt-run-agent").click();

  // Reading 3 — the bar carries the harness and the harness's own words.
  await expect(page.getByTestId("live-agent")).toHaveText(
    "claude · working — Bash",
    POLL_WAIT,
  );

  freezeCoordinator();
  await setLiveness(page, SILENT);

  // Reading 4, on the bar — absence says nothing, so the segment leaves
  // entirely rather than reporting an idle terminal.
  await expect(page.getByTestId("live-agent")).toHaveCount(0, POLL_WAIT);
  // And the bar itself is still there, with its other readings intact: the
  // segment is an addition to the run, not a replacement of it.
  await expect(page.getByTestId("terminal-persistence")).toBeVisible();
});

test("a permission prompt becomes needs-you and clears when it is answered", async ({
  page,
}) => {
  const { freezeCoordinator } = await openWorkspace(page);
  await expect(dotIn(page, "run-agent")).toHaveAttribute(
    "data-attention",
    "working",
    POLL_WAIT,
  );

  // Stopping the coordinator is not theatre: without it the worktree array is
  // reparsed every 2s and every row is rebuilt regardless, so a memo that never
  // re-read this signal would still look right.
  freezeCoordinator();
  await setLiveness(page, ASKING);

  await expect(dotIn(page, "run-agent")).toHaveAttribute(
    "data-attention",
    "needs-you",
    POLL_WAIT,
  );
  await expect(row(page, "run-agent")).toHaveAttribute(
    "title",
    /an agent in this worktree's terminal is waiting for approval: Bash/,
  );

  // Reading 4 — he answered it. A prompt that has been dealt with and is still
  // drawn is what teaches him to stop believing the dot.
  await setLiveness(page, WORKING);
  await expect(dotIn(page, "run-agent")).toHaveAttribute(
    "data-attention",
    "working",
    POLL_WAIT,
  );
});
