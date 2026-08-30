// The pictures the P2 deck pass is judged by (2026-08-29 redesign, P2:
// tasks strip, terminal tab bar, split, scratch). Follows
// `polish-shots.spec.ts`'s discipline: every capture is gated on assertions
// that the seeded state actually reached the screen, and nothing here pins a
// colour or a padding — the same spec must be runnable against the commit
// before the pass to produce the "before" set.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const SHOTS = "test-results/p2-shots";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
const SIXTEEN_INCH = { height: 1117, width: 1728 };

const REPO = {
  id: "repo-p2",
  name: "vingilot",
  path: "/tmp/vingilot-p2",
};

async function mockCoordinator(page: Page) {
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
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`) {
      return route.fulfill({ json: { runs: [] } });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`) {
      return route.fulfill({ json: { worktrees: [] } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });
}

/** A pty stub that opens sessions and lets the test feed shell-looking lines
 * at whichever session opened most recently — a screenshot of an empty
 * terminal proves only that black paints. */
async function stubPty(page: Page) {
  await page.evaluate(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
        };
      }
    ).__TAURI_INTERNALS__;
    const passThrough = internals.invoke.bind(internals);
    let seq = 1;
    const feed = (session: string, data: string) => {
      void passThrough("plugin:event|emit", {
        event: "vingilot://pty",
        payload: { data, replay: false, seq: seq++, session },
      });
    };
    (
      window as unknown as { __P2_FEED__: (s: string, d: string) => void }
    ).__P2_FEED__ = feed;
    internals.invoke = (cmd, args, opts) => {
      const name = String(cmd);
      const payload = (args ?? {}) as Record<string, string>;
      if (name.startsWith("plugin:path|")) return Promise.resolve("/tmp/home/");
      if (name === "pty_backing") return Promise.resolve("tmux");
      if (name === "pty_copy_mode") return Promise.resolve(false);
      if (name === "pty_open") {
        queueMicrotask(() =>
          feed(
            payload.session,
            `[32m➜[0m  [36mvingilot[0m [33mgit:(vingilot/finding-things)[0m \r\n`,
          ),
        );
        return Promise.resolve(null);
      }
      if (name.startsWith("pty_")) return Promise.resolve(null);
      return passThrough(cmd, args, opts);
    };
  });
}

async function openWorkspace(page: Page) {
  await page.setViewportSize(SIXTEEN_INCH);
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await stubPty(page);
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await expect(page.locator(".xterm-screen").first()).toBeVisible();
}

test("deck: tasks strip over the terminal tab bar", async ({ page }) => {
  await openWorkspace(page);
  await page.locator(".xterm-screen").first().click();
  // Two tasks and a second tab in the second task, so the strip and the bar
  // both have something to say.
  await page.keyboard.press("ControlOrMeta+t");
  await expect(page.getByTestId("task-chip-2")).toBeVisible();
  await page.getByTestId("terminal-tab-new").click();
  await expect(page.getByTestId("terminal-tab-3")).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/deck-tasks-tabs.png` });
});

test("deck: split terminal with the divider dragged", async ({ page }) => {
  await openWorkspace(page);
  await page.locator(".xterm-screen").first().click();
  await page.keyboard.press("ControlOrMeta+d");
  await expect(page.getByTestId("terminal-split-divider")).toBeVisible();
  await expect(page.locator(".xterm-screen")).toHaveCount(2);
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/deck-split-right.png` });

  await page.keyboard.press("ControlOrMeta+Shift+d");
  await expect(
    page.getByTestId(`terminal-split-host-main:${REPO.id}#1`),
  ).toHaveAttribute("data-split", "down");
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/deck-split-down.png` });
});

test("deck: scratch shell open, amber tab in the bar", async ({ page }) => {
  await openWorkspace(page);
  await page.locator(".xterm-screen").first().click();
  await page.keyboard.press("ControlOrMeta+Alt+t");
  await expect(page.getByTestId("scratch-terminal")).toBeVisible();
  await expect(page.getByTestId("terminal-tab-scratch")).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/deck-scratch.png` });
});
