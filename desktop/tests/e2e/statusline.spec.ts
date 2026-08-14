// The statusline, made useful (task: bottom bar → useful statusline).
//
// Two bars, one contract. The Deck/workspace bar (`ProjectStatusBar`) already
// existed and stays honest — this plan trims its persistence plates to glance
// words (the sentence rides the tooltip) and gives its two left/right facts
// the VS Code click model: a fact you can click opens the surface that
// explains it. The chat bar (`ChatStatusBar`) is new and deliberately a
// sibling, not the same component: its facts are the community and the relay,
// which do not exist on the workspace's prop surface, and vice versa.
//
// The pure halves are proved without a browser: `terminalPersistence.test.mjs`
// owns the short/label/detail honesty rules, `relayStatus.test.mjs` owns the
// word-per-state contract and which states may offer a reconnect click. What
// only a browser can prove:
//
// 1. **The plate really shows the word, not the sentence.** The trim is a
//    render-site change; a unit test on the copy cannot see which field the
//    bar picked.
// 2. **The branch fact is a door into History.** `showPane("history")` is
//    RunsScreen's act; the bar clicking into it is a wiring only the mounted
//    screen has.
// 3. **The control-plane word is a door into the Home-harbor card** — the
//    Settings section where `harborStart/Stop` live, i.e. the one surface
//    that explains the word.
// 4. **The chat views have a bar at all**, naming the community and the
//    relay's answer — and the relay word is a button exactly when clicking
//    it would do something (`relayStatus.canReconnect`), a plain word when
//    the connection is healthy.
//
// The workspace world is `workspace-hook-liveness.spec.ts`'s, minus the
// liveness stub: a coordinator that answers (so the control-plane word is
// "synced" — the click needs a word to click), git that says nothing, tmux
// as the backing. The chat world is the stock mock bridge, whose seeded
// community is named "E2E Test" and whose mock socket connects.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const HOME = "/tmp/vingilot-statusline-home";
const REPO = {
  id: "repo-statusline",
  name: "vingilot",
  path: "/tmp/vingilot-statusline",
};

const WORKTREE = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-statusline",
  branch: "feat/statusline",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-statusline",
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
};

type BridgeWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
  __BUZZ_E2E_SET_RELAY_CONNECTION_STATE__: (state: string) => void;
};

async function openWorkspace(page: Page) {
  await page.setViewportSize({ height: 1117, width: 1728 });
  await installMockBridge(page);
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

  await page.addInitScript((home: string) => {
    const w = window as unknown as BridgeWindow;
    let fallback:
      | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
      | null = null;
    const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
      const name = String(cmd);
      if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);
      if (name === "hook_liveness")
        return Promise.resolve({ byBinding: {}, unattributed: null });
      if (name === "worktree_stats") return Promise.resolve([]);
      if (name === "worktree_list") return Promise.resolve([]);
      if (name === "pty_backing") return Promise.resolve("tmux");
      if (name.startsWith("pty_")) return Promise.resolve(null);
      if (fallback === null)
        return Promise.reject(new Error(`no host for ${name}`));
      return fallback(cmd, args, opts);
    };
    const internals = (w.__TAURI_INTERNALS__ ??
      {}) as BridgeWindow["__TAURI_INTERNALS__"];
    w.__TAURI_INTERNALS__ = internals;
    Object.defineProperty(internals, "invoke", {
      configurable: true,
      get: () => invoke,
      set: (fn: (cmd: string, args?: unknown, opts?: unknown) => unknown) => {
        fallback = fn;
      },
    });
  }, HOME);

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
}

async function enterProject(page: Page) {
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("worktree-column")).toBeVisible();
  await page.getByTestId("worktree-row-wt-statusline").click();
}

test.describe("workspace statusline", () => {
  test("the persistence plate is a glance word and the sentence rides the tooltip", async ({
    page,
  }) => {
    await openWorkspace(page);

    const persistence = page.getByTestId("terminal-persistence");
    await expect(persistence).toBeVisible();
    // The trim: the visible plate is the backing's name alone. The claim and
    // its boundary ("survive quitting the app, not a reboot") moved wholly
    // into the tooltip, which still carries both halves.
    await expect(persistence).toHaveText("tmux");
    await expect(persistence).toHaveAttribute("data-backing", "tmux");
    await expect(persistence).toHaveAttribute("title", /not a reboot/);
    await expect(persistence).toHaveAttribute(
      "title",
      /does not survive a reboot/,
    );
  });

  test("the branch fact is a click into History, and absent when no project is open", async ({
    page,
  }) => {
    await openWorkspace(page);

    // On the landing view there is no worktree, so there is no branch fact —
    // an empty door would be a click that goes nowhere.
    await expect(page.getByTestId("statusbar-history")).toHaveCount(0);

    await enterProject(page);
    const branch = page.getByTestId("statusbar-history");
    await expect(branch).toBeVisible();
    await expect(branch).toContainText("feat/statusline");

    await branch.click();
    await expect(page.getByTestId("pane-history")).toBeVisible();
  });

  test("the control-plane word opens the Home-harbor card that explains it", async ({
    page,
  }) => {
    await openWorkspace(page);

    const word = page.getByTestId("statusbar-control-plane");
    // The coordinator above answers, so the word is the synced one — the
    // click must work from the healthy state too, because "synced" is also
    // a fact the owner may want explained.
    await expect(word).toHaveText("synced");
    await word.click();
    await expect(page.getByTestId("settings-home-harbor")).toBeVisible();
  });
});

test.describe("chat statusline", () => {
  test("the chat bar names the community and the relay's answer", async ({
    page,
  }) => {
    await installMockBridge(page);
    await page.goto("/");
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");

    const bar = page.getByTestId("chat-status-bar");
    await expect(bar).toBeVisible();
    // The seeded mock community's name — a reading of
    // `useCommunities().activeCommunity`, not a caption.
    await expect(bar).toContainText("E2E Test");

    const relay = page.getByTestId("relay-status");
    await expect(relay).toHaveText("connected");
    // Healthy is a fact, not a control: no button to click when clicking
    // would do nothing.
    expect(await relay.evaluate((el) => el.tagName)).toBe("SPAN");
  });

  test("a relay that stops answering becomes a reconnect click, and recovers to a word", async ({
    page,
  }) => {
    await installMockBridge(page);
    await page.goto("/");
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-status-bar")).toBeVisible();

    await page.evaluate(() => {
      (
        window as unknown as BridgeWindow
      ).__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__("stalled");
    });

    const relay = page.getByTestId("relay-status");
    // `useRelayConnection` debounces degraded states by 2s so a blink never
    // paints a warning — the assertion waits it out.
    await expect(relay).toHaveText("not answering", { timeout: 10_000 });
    expect(await relay.evaluate((el) => el.tagName)).toBe("BUTTON");

    await page.evaluate(() => {
      (
        window as unknown as BridgeWindow
      ).__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__("connected");
    });
    // Recovery is reported immediately (no debounce on healthy), and the
    // word stops being a click.
    await expect(relay).toHaveText("connected");
    expect(await relay.evaluate((el) => el.tagName)).toBe("SPAN");
  });
});
