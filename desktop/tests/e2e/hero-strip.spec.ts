// The hero strip (2026-09-03): one tab strip, every open worktree on it as a
// chip, the focused worktree's tabs drawn after its chip. Pressing a worktree
// no longer swaps the strip; it focuses that chip, adding it at the end if it
// was not there. The chip's × leaves the worktree — its shells end and focus
// moves to the neighbour. The order survives a reload.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
const GIT_HOME = "/tmp/vingilot-hero-home";

const REPO = { id: "repo-hero", name: "vingilot", path: "/tmp/vingilot-hero" };
const worktree = (suffix: string, branch: string) => ({
  added: null,
  base_commit: "0".repeat(40),
  binding_id: `wt-hero-${suffix}`,
  branch,
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: `run-hero-${suffix}`,
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
});
const A = worktree("a", "spike-a");
const B = worktree("b", "spike-b");
/** The repo's own checkout. Opening a project lands there, and landing is a
 * visit, so it is the first chip on the strip before any worktree is pressed
 * — `strip-rename.spec.ts` notes the same entry in the stored layout. */
const MAIN = `main:${REPO.id}`;

interface PtyProbe {
  opens: string[];
  closes: string[];
}
declare global {
  interface Window {
    __HERO_PROBE__: PtyProbe;
  }
}

async function installTrap(page: Page) {
  await page.addInitScript(
    ([home]: [string]) => {
      let fallback:
        | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
        | null = null;
      const probe: PtyProbe = { closes: [], opens: [] };
      window.__HERO_PROBE__ = probe;
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
          probe.opens.push(payload.session);
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
        if (name === "pty_close") {
          probe.closes.push(payload.session);
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

async function visit(page: Page, bindingId: string) {
  await page.getByTestId(`worktree-row-${bindingId}`).click();
  await expect(page.getByTestId(`hero-chip-${bindingId}`)).toHaveAttribute(
    "data-focused",
    "true",
  );
}

const chipIds = (page: Page) =>
  page.evaluate(() =>
    Array.from(
      document.querySelectorAll("[data-testid^='hero-chip-select-']"),
    ).map((el) =>
      el.getAttribute("data-testid")?.replace("hero-chip-select-", ""),
    ),
  );

test("pressing a worktree adds its chip at the end and expands it; the strip does not swap", async ({
  page,
}) => {
  await openProject(page);
  await visit(page, A.binding_id);
  expect(await chipIds(page)).toEqual([MAIN, A.binding_id]);
  // A's own tab strip is drawn after A's chip, with the names it will carry.
  await expect(page.getByTestId("terminal-tab-strip")).toBeVisible();
  await page.getByTestId("terminal-tab-shell-1").dblclick();
  await page.getByTestId("terminal-tab-rename-1").fill("alpha");
  await page.keyboard.press("Enter");

  await visit(page, B.binding_id);
  // A is still on the strip — collapsed, with its one tab counted — and B
  // joined at the end, expanded.
  expect(await chipIds(page)).toEqual([MAIN, A.binding_id, B.binding_id]);
  await expect(page.getByTestId(`hero-chip-${A.binding_id}`)).toHaveAttribute(
    "data-focused",
    "false",
  );
  await expect(
    page.getByTestId(`hero-chip-select-${A.binding_id}`),
  ).toContainText("spike-a");
  await expect(
    page.getByTestId(`hero-chip-select-${A.binding_id}`),
  ).toContainText("1");
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("1");

  // Pressing A's chip focuses A where it stands: same order, A's tabs back
  // with their name.
  await page.getByTestId(`hero-chip-select-${A.binding_id}`).click();
  await expect(page.getByTestId(`hero-chip-${A.binding_id}`)).toHaveAttribute(
    "data-focused",
    "true",
  );
  expect(await chipIds(page)).toEqual([MAIN, A.binding_id, B.binding_id]);
  await expect(page.getByTestId("terminal-tab-1")).toHaveText("alpha");

  // The order survives a reload.
  await page.reload();
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await expect.poll(() => chipIds(page)).toEqual([MAIN, A.binding_id, B.binding_id]);
});

test("the chip's × leaves the worktree: its shells end and focus moves to the neighbour", async ({
  page,
}) => {
  await openProject(page);
  await visit(page, A.binding_id);
  await visit(page, B.binding_id);
  const before = await page.evaluate(() => window.__HERO_PROBE__.closes.length);

  await page.getByTestId(`hero-chip-${B.binding_id}`).hover();
  await page.getByTestId(`hero-chip-leave-${B.binding_id}`).click();

  await expect.poll(() => chipIds(page)).toEqual([MAIN, A.binding_id]);
  await expect(page.getByTestId(`hero-chip-${A.binding_id}`)).toHaveAttribute(
    "data-focused",
    "true",
  );
  // B's one shell was closed — the leave is real, not a hide.
  const closes = await page.evaluate(() => window.__HERO_PROBE__.closes);
  expect(closes.length).toBe(before + 1);
  expect(closes[closes.length - 1]).toContain(B.binding_id);
});
