// The race his report may be (2026-09-04): the coordinator's worktree list
// arrives on its own poll, git's listing on another. Between git settling and
// the coordinator answering, the index holds only the project's checkout and
// the git-listed worktrees — so `dropWorktreesTo` reads every coordinator
// worktree with a strip as "left the workspace", closes its shells and drops
// its tabs and names. The mocks never showed it because a route answers in
// microseconds; his relay is on another continent. Here the list is late.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
const GIT_HOME = "/tmp/vingilot-landing-home";
const REPO = {
  id: "repo-landing",
  name: "vingilot",
  path: "/tmp/vingilot-landing",
};
const A = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-landing-a",
  branch: "spike-a",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-landing-a",
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
};

async function installTrap(page: Page) {
  await page.addInitScript(
    ([home]: [string]) => {
      (window as unknown as { __LAG_CLOSES__: string[] }).__LAG_CLOSES__ = [];
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;
      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        const payload = (args ?? {}) as Record<string, string>;
        if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);
        if (name === "hook_liveness")
          return Promise.resolve({ byBinding: {}, unattributed: null });
        if (name === "worktree_stats") return Promise.resolve([]);
        if (name === "worktree_list") return Promise.resolve([]);
        if (name === "pty_backing") return Promise.resolve("tmux");
        if (name === "pty_copy_mode") return Promise.resolve(false);
        if (name === "pty_close") {
          (
            window as unknown as { __LAG_CLOSES__: string[] }
          ).__LAG_CLOSES__.push(String(payload.session));
          return Promise.resolve(null);
        }
        if (name === "pty_open") {
          queueMicrotask(() => {
            void fallback?.("plugin:event|emit", {
              event: "vingilot://pty",
              payload: {
                data: "",
                replay: true,
                seq: 0,
                session: payload.session,
              },
            });
          });
          return Promise.resolve(null);
        }
        if (name.startsWith("pty_")) return Promise.resolve(null);
        if (fallback === null)
          return Promise.reject(new Error(`no host for ${name}`));
        return fallback(cmd, args, opts);
      };
      const w = window as unknown as {
        __TAURI_INTERNALS__?: Record<string, unknown>;
      };
      const internals = (w.__TAURI_INTERNALS__ ?? {}) as Record<
        string,
        unknown
      >;
      w.__TAURI_INTERNALS__ = internals;
      Object.defineProperty(internals, "invoke", {
        configurable: true,
        get: () => invoke,
        set: (fn: (cmd: string, args?: unknown, opts?: unknown) => unknown) => {
          fallback = fn;
        },
      });
    },
    [GIT_HOME] as const,
  );
}

async function openWithLateWorktrees(page: Page, delayMs: number) {
  await page.setViewportSize({ height: 1000, width: 1700 });
  // A strip with a named tab on the coordinator's worktree, as a restart
  // would restore it.
  await page.addInitScript((id) => {
    localStorage.setItem(
      "vingilot-terminal-tabs.v1",
      JSON.stringify({
        [id]: { active: 1, names: { "1": "alpha" }, nextN: 2, tabs: [1] },
      }),
    );
  }, A.binding_id);
  await installTrap(page);
  await installMockBridge(page);
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: { revision: 1, state: { repos: [REPO] }, state_hash: "h" },
      });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`) {
      // The late answer: git has long since said what it knows.
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return route.fulfill({ json: { worktrees: [A] } });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`) {
      return route.fulfill({ json: { runs: [] } });
    }
    return route.fulfill({ json: { error: "not_found" }, status: 404 });
  });
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
}

test("a coordinator worktree's strip survives the coordinator answering late", async ({
  page,
}) => {
  await openWithLateWorktrees(page, 1500);
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  const row = page.getByTestId(`worktree-row-${A.binding_id}`);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();
  // The name he gave the tab is still on it, and the shell was never closed.
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("alpha");
  const closes = await page.evaluate(
    () => (window as unknown as { __LAG_CLOSES__: string[] }).__LAG_CLOSES__,
  );
  expect(closes.filter((s) => s.includes(A.binding_id))).toEqual([]);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vingilot-terminal-tabs.v1") ?? "{}"),
  );
  expect(stored[A.binding_id]?.names).toEqual({ "1": "alpha" });
});
