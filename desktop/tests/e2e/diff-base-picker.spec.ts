// The Diff pane's base picker (2026-09-04, "main ile worktree difi vs.
// configurable bisi istiyom"): the rows git's refs make, choosing one reads
// at once with the merge-base spelling, and the choice is remembered for the
// worktree across a reload. The free box stays for anything not listed.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
const GIT_HOME = "/tmp/vingilot-basepick-home";
const REPO = {
  id: "repo-basepick",
  name: "vingilot",
  path: "/tmp/vingilot-basepick",
};
const WT = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-basepick",
  branch: "feat",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: "run-basepick",
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
};

interface DiffProbe {
  bases: string[];
}
declare global {
  interface Window {
    __DIFF_PROBE__: DiffProbe;
  }
}

async function installTrap(page: Page) {
  await page.addInitScript(
    ([home]: [string]) => {
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;
      const probe: DiffProbe = { bases: [] };
      window.__DIFF_PROBE__ = probe;
      const diff = (base: string) => ({
        additions: 0,
        base,
        deletions: 0,
        files: [],
        limits: { files: 500, patchBytes: 262_144 },
        omitted: 0,
      });
      const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
        const name = String(cmd);
        const payload = (args ?? {}) as Record<string, string>;
        if (name.startsWith("plugin:path|")) return Promise.resolve(`${home}/`);
        if (name === "hook_liveness")
          return Promise.resolve({ byBinding: {}, unattributed: null });
        if (name === "worktree_stats") return Promise.resolve([]);
        if (name === "worktree_list") return Promise.resolve([]);
        if (name === "worktree_refs")
          return Promise.resolve({
            defaultBranch: "main",
            head: "feat",
            local: ["main", "feat", "spike"],
            remote: ["origin/main", "origin/feat"],
          });
        if (name === "worktree_diff") {
          probe.bases.push(String(payload.base));
          return Promise.resolve(diff(String(payload.base)));
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

async function openDiff(page: Page) {
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
      return route.fulfill({ json: { worktrees: [WT] } });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`) {
      return route.fulfill({ json: { runs: [] } });
    }
    return route.fulfill({ json: { error: "not_found" }, status: 404 });
  });
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await page.getByTestId(`worktree-row-${WT.binding_id}`).click();
  await expect(page.getByTestId("pane-diff")).toBeVisible();
}

test("the picker lists git's refs as rows, a row reads at once in the merge-base spelling, and it is remembered", async ({
  page,
}) => {
  await openDiff(page);
  await page.getByTestId("worktree-diff-pick").click();
  await expect(page.getByTestId("worktree-diff-pick-list")).toBeVisible();
  await expect(page.getByTestId("diff-base-quick-HEAD")).toBeVisible();
  await expect(page.getByTestId("diff-base-quick-main...HEAD")).toContainText(
    "Since it left main",
  );
  await expect(page.getByTestId("diff-base-quick-main")).toContainText(
    "Against main",
  );
  await expect(
    page.getByTestId("diff-base-quick-origin/main...HEAD"),
  ).toBeVisible();
  // The branch he is on is not offered against itself; the others are.
  await expect(page.getByTestId("diff-base-local-feat...HEAD")).toHaveCount(0);
  await expect(page.getByTestId("diff-base-local-spike...HEAD")).toBeVisible();

  await page.getByTestId("diff-base-quick-main...HEAD").click();
  await expect(page.getByTestId("worktree-diff-pick-list")).toBeHidden();
  await expect(page.getByTestId("worktree-diff-base")).toHaveValue(
    "main...HEAD",
  );
  await expect
    .poll(() => page.evaluate(() => window.__DIFF_PROBE__.bases.at(-1)))
    .toBe("main...HEAD");

  // Remembered for this worktree: the next open reads against it from the start.
  await page.reload();
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await expect(page.getByTestId("pane-diff")).toBeVisible();
  await expect(page.getByTestId("worktree-diff-base")).toHaveValue(
    "main...HEAD",
  );
});

test("the filter narrows the rows, and the free box still takes anything", async ({
  page,
}) => {
  await openDiff(page);
  await page.getByTestId("worktree-diff-pick").click();
  await page.getByTestId("worktree-diff-pick-filter").fill("spike");
  await expect(page.getByTestId("diff-base-local-spike...HEAD")).toBeVisible();
  await expect(page.getByTestId("diff-base-quick-HEAD")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByTestId("worktree-diff-base").fill("abc1234");
  await page.getByTestId("worktree-diff-read").click();
  await expect
    .poll(() => page.evaluate(() => window.__DIFF_PROBE__.bases.at(-1)))
    .toBe("abc1234");
});
