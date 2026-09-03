// Where the workspace opens (2026-09-04, "deck landing page ... olmasa daha
// iyi"): on the worktree he was last in, when the memory has one the
// workspace still knows; on the board otherwise. The board stays one act
// away behind the Deck row.

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

async function open(page: Page, recent: string[] | null) {
  await page.setViewportSize({ height: 1000, width: 1700 });
  if (recent !== null) {
    // Seeded BEFORE the bridge, the way the repo's guide says: React reads
    // storage on mount, and the bridge is what triggers the mount.
    await page.addInitScript((ids) => {
      localStorage.setItem("vingilot-recent-worktrees.v1", JSON.stringify(ids));
      // The strip the memory points at, so the worktree is one with tabs.
      localStorage.setItem(
        "vingilot-terminal-tabs.v1",
        JSON.stringify(
          Object.fromEntries(
            ids.map((id) => [id, { active: 1, nextN: 2, tabs: [1] }]),
          ),
        ),
      );
    }, recent);
  }
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

test("with a remembered worktree the workspace opens on it, not on the board", async ({
  page,
}) => {
  await open(page, [A.binding_id]);
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await expect(page.getByTestId("worktree-switcher")).toContainText("spike-a");
  await expect(page.getByTestId("deck-pane")).toHaveCount(0);
});

test("with no memory the board is the landing it always was, and the Deck row still reaches it", async ({
  page,
}) => {
  await open(page, null);
  await expect(page.getByTestId("deck-pane")).toBeVisible();
  await expect(page.getByTestId("work-surface")).toHaveCount(0);
});

test("a memory of a worktree the workspace no longer knows is skipped", async ({
  page,
}) => {
  await open(page, ["wt-landing-gone"]);
  await expect(page.getByTestId("deck-pane")).toBeVisible();
});
