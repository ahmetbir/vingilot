// ⌘[ / ⌘] walk worktrees (2026-09-04, his brief: "önceki/sonraki worktree
// geçmişi"). Not a second history under upstream's chord: the selected
// worktree is mirrored into `/workspace?wt=…`, so the app's own back/forward
// — the chords and the top chrome's arrows — lands on the worktree that was
// there (`useWorktreeUrlSync.ts`).

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

test("⌘[ goes back to the previous worktree, ⌘] forward, and the top chrome's arrows do the same", async ({
  page,
}) => {
  await openProject(page);
  await visit(page, A.binding_id, "spike-a");
  await visit(page, B.binding_id, "spike-b");
  await expect(page).toHaveURL(/wt=wt-switcher-b/);

  await page.keyboard.press("ControlOrMeta+[");
  await expect(page.getByTestId("worktree-switcher")).toContainText("spike-a");
  await expect(page).toHaveURL(/wt=wt-switcher-a/);

  await page.keyboard.press("ControlOrMeta+]");
  await expect(page.getByTestId("worktree-switcher")).toContainText("spike-b");

  await page.getByTestId("global-back").click();
  await expect(page.getByTestId("worktree-switcher")).toContainText("spike-a");
  await page.getByTestId("global-forward").click();
  await expect(page.getByTestId("worktree-switcher")).toContainText("spike-b");
});

test("the first landing replaces rather than pushes: back from it leaves the workspace, not a blank one", async ({
  page,
}) => {
  await openProject(page);
  await visit(page, A.binding_id, "spike-a");
  await page.keyboard.press("ControlOrMeta+[");
  // The entry before the first worktree is where he came from — /workspace
  // as landed — and the selection is left alone rather than blanked.
  await expect(page.getByTestId("worktree-switcher")).toContainText("spike-a");
});
