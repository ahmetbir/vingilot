// Pinned worktrees (2026-09-04, his brief: "⌘1–5: pinned worktree'lere
// doğrudan geç"). A pin moves the worktree to right after the project's
// checkout, in pin order, whatever its state — so its ⌘ digit stays put. The
// nav, the digits, the switcher's Pinned group and ⌘K all read the one order.
// Pins survive a reload; unpinning puts the row back where attention ranks it.

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

test("pinning a worktree moves it after the checkout, gives it a stable digit, and the switcher groups it", async ({
  page,
}) => {
  await openProject(page);
  // Nav order to begin with: main ⌘1, A ⌘2, B ⌘3.
  await expect(page.getByTestId(`worktree-row-${B.binding_id}`)).toContainText(
    "⌘3",
  );

  await page.getByTestId(`worktree-row-${B.binding_id}`).hover();
  await page.getByTestId(`worktree-pin-${B.binding_id}`).click();
  await expect(page.getByTestId(`worktree-row-${B.binding_id}`)).toContainText(
    "⌘2",
  );
  await expect(page.getByTestId(`worktree-row-${A.binding_id}`)).toContainText(
    "⌘3",
  );
  await expect(
    page.getByTestId(`worktree-pin-${B.binding_id}`),
  ).toHaveAttribute("aria-pressed", "true");

  // ⌘2 is B now, from the terminal surface.
  await visit(page, A.binding_id, "spike-a");
  await page.keyboard.press("ControlOrMeta+2");
  await expect(page.getByTestId("worktree-switcher")).toContainText("spike-b");

  // The switcher's own heading for it, with the same digit.
  await page.getByTestId("worktree-switcher").click();
  await expect(page.getByTestId("worktree-switcher-pinned")).toContainText(
    "spike-b",
  );
  await page.keyboard.press("Escape");

  // Survives a reload.
  await page.reload();
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId(`worktree-row-${B.binding_id}`)).toContainText(
    "⌘2",
  );

  // Unpinning puts it back.
  await page.getByTestId(`worktree-row-${B.binding_id}`).hover();
  await page.getByTestId(`worktree-pin-${B.binding_id}`).click();
  await expect(page.getByTestId(`worktree-row-${B.binding_id}`)).toContainText(
    "⌘3",
  );
});
