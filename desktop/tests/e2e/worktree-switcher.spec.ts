// The terminal's context header (2026-09-03, his second report through the
// drop: "Worktree'ler birikmez; worktree'ler arasında geçilir"). No worktree
// chips on the strip; the header reads `repo/worktree ▾`, opens a switcher
// with Recent first and this project's worktrees after, and choosing one is
// the same act as the nav row. ⌘K lists the most recent worktree first.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
const GIT_HOME = "/tmp/vingilot-switcher-home";

const REPO = {
  id: "repo-switcher",
  name: "vingilot",
  path: "/tmp/vingilot-switcher",
};
const worktree = (suffix: string, branch: string) => ({
  added: null,
  base_commit: "0".repeat(40),
  binding_id: `wt-switcher-${suffix}`,
  branch,
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: `run-switcher-${suffix}`,
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
});
const A = worktree("a", "spike-a");
const B = worktree("b", "spike-b");

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

async function openProject(page: Page) {
  await page.setViewportSize({ height: 1000, width: 1700 });
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
      return route.fulfill({ json: { worktrees: [A, B] } });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`) {
      return route.fulfill({ json: { runs: [] } });
    }
    return route.fulfill({ json: { error: "not_found" }, status: 404 });
  });
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
}

async function visit(page: Page, bindingId: string, label: string) {
  await page.getByTestId(`worktree-row-${bindingId}`).click();
  await expect(page.getByTestId("worktree-switcher")).toContainText(label);
}

test("the header names the worktree, and the switcher goes to a recent one with its names intact", async ({
  page,
}) => {
  await openProject(page);
  await visit(page, A.binding_id, "spike-a");
  // No worktree chips anywhere on the strip — a worktree is not a tab.
  await expect(page.locator("[data-testid^='hero-chip-']")).toHaveCount(0);
  await page.getByTestId("terminal-tab-shell-1").dblclick();
  await page.getByTestId("terminal-tab-rename-1").fill("alpha");
  await page.keyboard.press("Enter");

  await visit(page, B.binding_id, "spike-b");
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("1");

  await page.getByTestId("worktree-switcher").click();
  const list = page.getByTestId("worktree-switcher-list");
  await expect(list).toBeVisible();
  // Recent: where he was just before, and not where he is.
  await expect(
    page.getByTestId(`worktree-switcher-recent-${A.binding_id}`),
  ).toBeVisible();
  await expect(
    page.getByTestId(`worktree-switcher-recent-${B.binding_id}`),
  ).toHaveCount(0);
  // This project: both, the open one marked and not a button to press.
  await expect(
    page.getByTestId(`worktree-switcher-row-${B.binding_id}`),
  ).toContainText("open");
  await expect(
    page.getByTestId(`worktree-switcher-row-${A.binding_id}`),
  ).toContainText("⌘2");

  await page.getByTestId(`worktree-switcher-recent-${A.binding_id}`).click();
  await expect(list).toBeHidden();
  await expect(page.getByTestId("worktree-switcher")).toContainText("spike-a");
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("alpha");
});

test("the filter narrows both lists, and Enter takes the first match", async ({
  page,
}) => {
  await openProject(page);
  await visit(page, A.binding_id, "spike-a");
  await visit(page, B.binding_id, "spike-b");
  await page.getByTestId("worktree-switcher").click();
  const filter = page.getByTestId("worktree-switcher-filter");
  await expect(filter).toBeFocused();
  await filter.fill("spike-a");
  await expect(
    page.getByTestId(`worktree-switcher-row-${B.binding_id}`),
  ).toHaveCount(0);
  await filter.press("Enter");
  await expect(page.getByTestId("worktree-switcher")).toContainText("spike-a");
});

test("⌘K lists the most recent worktree first", async ({ page }) => {
  await openProject(page);
  await visit(page, A.binding_id, "spike-a");
  await visit(page, B.binding_id, "spike-b");
  await visit(page, A.binding_id, "spike-a");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette-input")).toBeVisible();
  const first = page.locator("[data-testid^='palette-row-worktree:']").first();
  // The nav order is main, A, B; where he was just before is B, and A — where
  // he IS — stays where the nav puts it rather than jumping the queue.
  await expect(first).toHaveAttribute(
    "data-testid",
    `palette-row-worktree:${B.binding_id}`,
  );
});
