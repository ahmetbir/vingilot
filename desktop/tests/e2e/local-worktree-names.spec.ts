// His still-open report, aimed at the one place every earlier spec differed
// from his machine (2026-09-04): "task degistirmede kalici ama worktree
// degistirme repo degistirmede kalici degil." Every spec so far answered
// `worktree_list` with nothing, so no LOCAL worktree — one git listed, with a
// `local:<hex path>` binding id — ever stood on the strip. Here one does, and
// its tab is named, and the worktree and the project are switched away from
// and back.

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
const REPO_B = {
  id: "repo-switcher-2",
  name: "other",
  path: "/tmp/vingilot-other",
};
/** The git-listed worktree's binding id, as `localBindingId` spells it. */
const LOCAL_PATH = `${GIT_HOME}/.vingilot/worktrees/vingilot/loc`;
const LOCAL_ID = `local:${Array.from(new TextEncoder().encode(LOCAL_PATH))
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("")}`;
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
        if (name === "worktree_stats") {
          // git says B is dirty; the dot the nav row wears must reach the
          // switcher's row too.
          const paths = Array.isArray(payload.paths)
            ? (payload.paths as string[])
            : [];
          return Promise.resolve(
            paths
              .filter((p) => p.includes("switcher-b"))
              .map((path) => ({
                additions: 2,
                changedFiles: 1,
                deletions: 0,
                dirty: true,
                path,
                paths: ["src/x.rs"],
                pathsTruncated: false,
                unreadable: false,
                untracked: 0,
              })),
          );
        }
        if (name === "worktree_list") {
          const repoPath = String(payload.repo ?? payload.path ?? "");
          if (!repoPath.includes("vingilot-switcher"))
            return Promise.resolve([]);
          return Promise.resolve([
            {
              branch: "main",
              detached: false,
              head: "0".repeat(40),
              isMain: true,
              locked: false,
              path: repoPath,
              prunable: false,
            },
            {
              branch: "loc",
              detached: false,
              head: "1".repeat(40),
              isMain: false,
              locked: false,
              path: `${home}/.vingilot/worktrees/vingilot/loc`,
              prunable: false,
            },
          ]);
        }
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
        json: {
          revision: 1,
          state: { repos: [REPO, REPO_B] },
          state_hash: "h",
        },
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

test("a name on a git-listed worktree's tab survives a worktree switch and a project switch", async ({
  page,
}) => {
  await openProject(page);
  const localRow = page.getByTestId(`worktree-row-${LOCAL_ID}`);
  await expect(localRow).toBeVisible();
  await localRow.click();
  await expect(page.getByTestId("worktree-switcher")).toContainText(
    "vingilot/loc",
  );

  await page.getByTestId("terminal-tab-shell-1").dblclick();
  await page.getByTestId("terminal-tab-rename-1").fill("loc-shell");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("loc-shell");

  // Away to a coordinator worktree and back.
  await visit(page, A.binding_id, "spike-a");
  await localRow.click();
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("loc-shell");

  // Away to another project and back.
  await page.getByTestId(`projects-nav-repo-${REPO_B.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await localRow.click();
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("loc-shell");

  // And what is on disk says the same.
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vingilot-terminal-tabs.v1") ?? "{}"),
  );
  expect(stored[LOCAL_ID]?.names).toEqual({ "1": "loc-shell" });
});
