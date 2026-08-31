// The status bar (redesign P4, mockup `.status` — Vingilot.html:327-334),
// proved over the real key path and a recorded pty bridge:
//
// - **bar anatomy**: the mockup's card (36px, rounded/bordered/shadowed),
//   its segments in order, and the two invented mockup facts (tokens+cost,
//   CI) proved ABSENT — this app has no source for either;
// - **segment honesty**: the working-crew segment renders only once a real
//   ACP turn is seeded, cross-referenced against a real managed-agent
//   record for its name;
// - **a quick-action button reaches the pty**: pressing "Commit"/"Create PR"
//   types the button's own prompt (with `{{branch}}` filled from the real
//   worktree) into the ACTIVE session — proved on the recorded `pty_write`,
//   never on chrome;
// - **the Settings round-trip**: editing a button's label/prompt persists
//   and the bar reflects it after a remount;
// - **Review dispatches, and never types into tmux**: the reviewer roster is
//   the workspace's real minted crew, a thread-berth reviewer with no team
//   thread refuses with a sentence, Mate's DM is never blocked and Start
//   review really sends — proved by a fresh `pty_write` NEVER appearing in
//   the same recorded probe every other test in this file asserts against.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPO = {
  id: "repo-status-bar",
  name: "vingilot",
  path: "/tmp/vingilot-status-bar",
};

const BINDING = "wt-status-bar";
const WORKTREE = {
  added: 214,
  base_commit: "0".repeat(40),
  binding_id: BINDING,
  branch: "feat/status-bar",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-status-bar",
  owner_run_objective: null,
  owner_run_status: null,
  removed: 38,
  repo_id: REPO.id,
  role: "task",
};

const LOOKOUT_PUBKEY = "a".repeat(64);
const BOSUN_PUBKEY = "c".repeat(64);
const MATE_PUBKEY = "b".repeat(64);

declare global {
  interface Window {
    __STATUS_BAR_PROBE__: {
      opens: string[];
      writes: { session: string; data: string }[];
    };
    __BUZZ_E2E_SEED_ACTIVE_TURNS__?: (input: {
      agentPubkey: string;
      channelId: string;
      turnId: string;
      kind?: "turn_started" | "turn_completed";
    }) => void;
  }
}

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
};

/** Points this worktree's team-thread pointer (`teamThreadStore.ts`) at
 * `channelId` — the same localStorage shape the Team pane writes when a
 * thread is opened for real. A test-only shortcut around opening one by
 * hand; the pointer's shape is asserted against by the module's own unit
 * tests, not re-derived here. */
async function seedTeamThread(page: Page, channelId: string | null) {
  await page.addInitScript(
    ({ binding, channel }) => {
      const bindings =
        channel === null
          ? {}
          : { [binding]: { channelId: channel, teamId: "builtin-team:crew" } };
      window.localStorage.setItem(
        "vingilot-team-thread.v1",
        JSON.stringify(bindings),
      );
    },
    { binding: BINDING, channel: channelId },
  );
}

/** The pty-recording trap every test in this file needs — the fork-owned
 * `runs` island's own Tauri commands (hook liveness, pty_*, worktree
 * stats/list) are NOT part of upstream's default mock bridge, so every spec
 * that mounts `RunsScreen` supplies them itself (dock.spec.ts's and
 * statusline.spec.ts's own precedent). Order against `installMockBridge`
 * does not matter — both are pre-navigation init scripts; the bridge's own
 * `invoke` assignment happens later, at real app-boot time, and is captured
 * as `fallback` for everything this trap does not name, regardless of which
 * init script registered first. Must run before `page.goto`. */
async function installPtyTrap(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as TrapWindow;
    let fallback:
      | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
      | null = null;
    const probe = {
      opens: [] as string[],
      writes: [] as { session: string; data: string }[],
    };
    window.__STATUS_BAR_PROBE__ = probe;

    const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
      const name = String(cmd);
      const payload = (args ?? {}) as Record<string, string>;
      if (name.startsWith("plugin:path|"))
        return Promise.resolve("/tmp/status-bar-home/");
      if (name === "hook_liveness")
        return Promise.resolve({ byBinding: {}, unattributed: null });
      if (name === "worktree_stats") return Promise.resolve([]);
      if (name === "worktree_list") return Promise.resolve([]);
      if (name === "pty_backing") return Promise.resolve("tmux");
      if (name === "pty_copy_mode") return Promise.resolve(false);
      if (name === "pty_open") {
        probe.opens.push(payload.session);
        return Promise.resolve(null);
      }
      if (name === "pty_write") {
        probe.writes.push({ data: payload.data, session: payload.session });
        return Promise.resolve(null);
      }
      if (name.startsWith("pty_")) return Promise.resolve(null);
      if (fallback === null)
        return Promise.reject(new Error(`no host for ${name}`));
      return fallback(cmd, args, opts);
    };

    const internals = (w.__TAURI_INTERNALS__ ??
      {}) as TrapWindow["__TAURI_INTERNALS__"];
    w.__TAURI_INTERNALS__ = internals;
    Object.defineProperty(internals, "invoke", {
      configurable: true,
      get: () => invoke,
      set: (fn: (cmd: string, args?: unknown, opts?: unknown) => unknown) => {
        fallback = fn;
      },
    });
  });
}

async function openStatusBarWorkspace(page: Page) {
  await page.setViewportSize({ height: 960, width: 1700 });
  await installPtyTrap(page);
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Lookout",
        personaId: "builtin:lookout",
        pubkey: LOOKOUT_PUBKEY,
        status: "running",
      },
      {
        name: "Bosun",
        personaId: "builtin:bosun",
        pubkey: BOSUN_PUBKEY,
        status: "running",
      },
      {
        name: "Mate",
        personaId: "builtin:mate",
        pubkey: MATE_PUBKEY,
        status: "running",
      },
    ],
  });
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
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`) {
      return route.fulfill({ json: { worktrees: [WORKTREE] } });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`) {
      return route.fulfill({ json: { runs: [] } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("worktree-column")).toBeVisible();
  await page.getByTestId(`worktree-row-${BINDING}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  // The default tab's pty is opened as part of entering the worktree — the
  // active session a quick action types into (mirrors dock.spec.ts's own
  // `${BINDING}#1`).
  await expect
    .poll(() => page.evaluate(() => window.__STATUS_BAR_PROBE__.opens))
    .toContain(`${BINDING}#1`);
}

test.describe("status bar anatomy", () => {
  test("the mockup's card at 36px, and the two invented segments proved absent", async ({
    page,
  }) => {
    await openStatusBarWorkspace(page);

    const bar = page.getByTestId("project-status-bar");
    await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    if (box === null) throw new Error("unmeasured");
    expect(Math.round(box.height)).toBe(36);

    // The mockup invents "42.1k tok · $1.86" and a CI dot — this app has no
    // source for either (this file's header; DockChecksPanel's own header
    // for CI). Neither glyph appears anywhere in the bar.
    const text = (await bar.innerText()) ?? "";
    expect(text).not.toMatch(/\$\d/);
    expect(text).not.toMatch(/\btok/i);
    expect(text).not.toMatch(/\bCI\b/);

    // The real segments: project/branch/diff, the quick-action row (Stop,
    // Review, and the two configured defaults).
    await expect(bar.getByTestId("statusbar-history")).toContainText(
      "feat/status-bar",
    );
    await expect(page.getByTestId("stop-all-button")).toBeVisible();
    await expect(
      page.getByTestId("statusbar-quick-action-review"),
    ).toBeVisible();
    await expect(page.getByTestId("statusbar-quick-action-commit")).toHaveText(
      "Commit",
    );
    await expect(
      page.getByTestId("statusbar-quick-action-create-pr"),
    ).toHaveText("Create PR");
  });

  test("no worktree selected: Stop alone survives, Commit/Review are worktree-shaped and absent", async ({
    page,
  }) => {
    await installPtyTrap(page);
    await installMockBridge(page);
    await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
        return route.fulfill({
          json: { revision: 1, state: { repos: [] }, state_hash: "h" },
        });
      }
      return route.fulfill({ json: { worktrees: [], runs: [] } });
    });
    await page.goto("/#/workspace");
    await expect(page.getByTestId("runs-screen")).toBeVisible();

    await expect(page.getByTestId("project-status-bar")).toContainText(
      "no project selected",
    );
    await expect(page.getByTestId("stop-all-button")).toBeVisible();
    await expect(page.getByTestId("statusbar-quick-action-review")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("statusbar-quick-action-commit")).toHaveCount(
      0,
    );
  });
});

test.describe("the working-crew segment", () => {
  test("absent when nobody is working, present with real names once a turn is seeded", async ({
    page,
  }) => {
    await seedTeamThread(page, "thread-channel-1");
    await openStatusBarWorkspace(page);

    await expect(page.getByTestId("statusbar-working-agents")).toHaveCount(0);

    await page.evaluate(
      ([pubkey, channelId]) => {
        window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
          agentPubkey: pubkey,
          channelId,
          turnId: "turn-1",
        });
      },
      [LOOKOUT_PUBKEY, "thread-channel-1"] as const,
    );

    const segment = page.getByTestId("statusbar-working-agents");
    await expect(segment).toBeVisible();
    await expect(segment).toContainText("1 agent");
    await expect(segment).toContainText("Lookout");

    // A second agent's turn in the SAME thread grows the count and the name
    // list together — never a count with fewer names than it claims.
    await page.evaluate(
      ([pubkey, channelId]) => {
        window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
          agentPubkey: pubkey,
          channelId,
          turnId: "turn-2",
        });
      },
      [BOSUN_PUBKEY, "thread-channel-1"] as const,
    );
    await expect(segment).toContainText("2 agents");
    await expect(segment).toContainText("Lookout · Bosun");
  });

  test("a turn in a DIFFERENT channel does not light this worktree's segment", async ({
    page,
  }) => {
    await seedTeamThread(page, "thread-channel-1");
    await openStatusBarWorkspace(page);

    await page.evaluate(
      ([pubkey]) => {
        window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
          agentPubkey: pubkey,
          channelId: "some-other-channel",
          turnId: "turn-3",
        });
      },
      [LOOKOUT_PUBKEY] as const,
    );
    await expect(page.getByTestId("statusbar-working-agents")).toHaveCount(0);
  });
});

test.describe("a quick action reaches the pty", () => {
  test("Commit types its default prompt into the ACTIVE session", async ({
    page,
  }) => {
    await openStatusBarWorkspace(page);

    await page.getByTestId("statusbar-quick-action-commit").click();
    await expect
      .poll(() => page.evaluate(() => window.__STATUS_BAR_PROBE__.writes))
      .toContainEqual({
        data: "Commit the changes on this worktree with a clear commit message.\n",
        session: `${BINDING}#1`,
      });
  });

  test("Create PR fills {{branch}} from the real worktree", async ({
    page,
  }) => {
    await openStatusBarWorkspace(page);

    await page.getByTestId("statusbar-quick-action-create-pr").click();
    await expect
      .poll(() => page.evaluate(() => window.__STATUS_BAR_PROBE__.writes))
      .toContainEqual({
        data: "Push this branch and open a pull request for feat/status-bar.\n",
        session: `${BINDING}#1`,
      });
  });
});

test.describe("Settings round-trip", () => {
  test("editing a quick action's label and prompt persists and the bar reflects it", async ({
    page,
  }) => {
    await openStatusBarWorkspace(page);

    // The workspace sidebar's own me-footer carries no Settings door (P1.1);
    // the proven route in from here is a status-bar fact that opens Settings
    // (statusline.spec.ts's own control-plane door), then switching sections.
    await page.getByTestId("statusbar-control-plane").click();
    await expect(page.getByTestId("settings-home-harbor")).toBeVisible();
    await page.getByTestId("settings-nav-appearance").click();
    await expect(page.getByTestId("vingilot-quick-actions-card")).toBeVisible();

    const labelField = page.getByTestId("quick-action-label-commit");
    await labelField.fill("Ship it");
    const promptField = page.getByTestId("quick-action-prompt-commit");
    await promptField.fill("git commit -am wip");

    await page.getByTestId("settings-back-to-app").click();
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    // Leaving for Settings unmounts RunsScreen; the selected project AND
    // worktree are its own component state, not URL-carried, so coming back
    // lands on the landing view again and both are reselected by hand.
    await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
    await page.getByTestId(`worktree-row-${BINDING}`).click();
    await expect(page.getByTestId("work-surface")).toBeVisible();

    const button = page.getByTestId("statusbar-quick-action-commit");
    await expect(button).toHaveText("Ship it");
    await button.click();
    await expect
      .poll(() => page.evaluate(() => window.__STATUS_BAR_PROBE__.writes))
      .toContainEqual({
        data: "git commit -am wip\n",
        session: `${BINDING}#1`,
      });
  });

  test("removing every quick action is a real, saved empty state — not a reset to defaults", async ({
    page,
  }) => {
    await openStatusBarWorkspace(page);

    // The workspace sidebar's own me-footer carries no Settings door (P1.1);
    // the proven route in from here is a status-bar fact that opens Settings
    // (statusline.spec.ts's own control-plane door), then switching sections.
    await page.getByTestId("statusbar-control-plane").click();
    await expect(page.getByTestId("settings-home-harbor")).toBeVisible();
    await page.getByTestId("settings-nav-appearance").click();
    await page.getByTestId("quick-action-remove-commit").click();
    await page.getByTestId("quick-action-remove-create-pr").click();
    await expect(page.getByTestId("vingilot-quick-actions-card")).toContainText(
      "No quick actions configured.",
    );

    await page.getByTestId("settings-back-to-app").click();
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    // Leaving for Settings unmounts RunsScreen; see the sibling test's own
    // note on why the project and worktree are reselected by hand here.
    await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
    await page.getByTestId(`worktree-row-${BINDING}`).click();
    await expect(page.getByTestId("work-surface")).toBeVisible();
    await expect(page.getByTestId("statusbar-quick-action-commit")).toHaveCount(
      0,
    );
    // Stop and Review are not prompts and survive an emptied list.
    await expect(page.getByTestId("stop-all-button")).toBeVisible();
    await expect(
      page.getByTestId("statusbar-quick-action-review"),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
    await page.getByTestId(`worktree-row-${BINDING}`).click();
    await expect(page.getByTestId("work-surface")).toBeVisible();
    await expect(page.getByTestId("statusbar-quick-action-commit")).toHaveCount(
      0,
    );
  });
});

test.describe("Review dispatches, and never types into tmux", () => {
  test("the roster is the workspace's real minted crew; Lookout is the default pick", async ({
    page,
  }) => {
    await openStatusBarWorkspace(page);

    await page.getByTestId("statusbar-quick-action-review").click();
    await expect(page.getByTestId("review-popover")).toBeVisible();
    for (const personaId of [
      "builtin:lookout",
      "builtin:bosun",
      "builtin:mate",
    ]) {
      await expect(
        page.getByTestId(`review-reviewer-${personaId}`),
      ).toBeVisible();
    }
    await expect(
      page.getByTestId("review-reviewer-builtin:lookout"),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("a thread-berth reviewer with no team thread refuses with a sentence, and Start is disabled", async ({
    page,
  }) => {
    await seedTeamThread(page, null);
    await openStatusBarWorkspace(page);

    await page.getByTestId("statusbar-quick-action-review").click();
    await expect(page.getByTestId("review-blocked")).toContainText(
      "no team thread yet",
    );
    await expect(page.getByTestId("review-start")).toBeDisabled();
  });

  test("the reviewer choice persists across reopening the popover", async ({
    page,
  }) => {
    await openStatusBarWorkspace(page);

    await page.getByTestId("statusbar-quick-action-review").click();
    await page.getByTestId("review-reviewer-builtin:bosun").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("review-popover")).toHaveCount(0);

    await page.getByTestId("statusbar-quick-action-review").click();
    await expect(
      page.getByTestId("review-reviewer-builtin:bosun"),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("Mate's DM is never blocked, Start review really sends, and NO pty_write ever fires", async ({
    page,
  }) => {
    await seedTeamThread(page, null);
    await openStatusBarWorkspace(page);

    // A quick action's own write, so the probe is proven non-empty before
    // the negative assertion below means something.
    await page.getByTestId("statusbar-quick-action-commit").click();
    await expect
      .poll(() =>
        page.evaluate(() => window.__STATUS_BAR_PROBE__.writes.length),
      )
      .toBeGreaterThan(0);
    const writesBeforeReview = await page.evaluate(
      () => window.__STATUS_BAR_PROBE__.writes.length,
    );

    await page.getByTestId("statusbar-quick-action-review").click();
    await page.getByTestId("review-reviewer-builtin:mate").click();
    await expect(page.getByTestId("review-blocked")).toHaveCount(0);
    await expect(page.getByTestId("review-start")).toBeEnabled();

    await page.getByTestId("review-instruction").fill("check the diff");
    await page.getByTestId("review-start").click();
    await expect(page.getByTestId("review-popover")).toHaveCount(0, {
      timeout: 10_000,
    });

    // The popover closing proves nothing — the click closes it
    // unconditionally. What proves the dispatch is the SIGNED EVENT the
    // send put on the wire: a kind-9 message carrying the instruction and
    // addressed to the chosen reviewer. Without this, a regression that
    // broke dispatch entirely would leave this suite green (P4 verify,
    // MAJOR-3).
    const sent = await page.evaluate(
      () =>
        (
          window as unknown as {
            __BUZZ_E2E_SIGNED_EVENTS__?: {
              kind: number;
              content: string;
              tags: string[][];
            }[];
          }
        ).__BUZZ_E2E_SIGNED_EVENTS__ ?? [],
    );
    const review = sent.filter(
      (event) => event.kind === 9 && event.content.includes("check the diff"),
    );
    expect(review).toHaveLength(1);
    expect(review[0].tags.some((tag) => tag[0] === "p")).toBe(true);

    // The declared exception, proved rather than assumed: the write count
    // is exactly what it was before Start review fired.
    const writesAfterReview = await page.evaluate(
      () => window.__STATUS_BAR_PROBE__.writes.length,
    );
    expect(writesAfterReview).toBe(writesBeforeReview);
  });
});
