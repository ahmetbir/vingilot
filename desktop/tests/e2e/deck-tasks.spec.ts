// The Deck's tasks strip (redesign P2, mockup `.tasks`), proved over the
// real key path, the real strip, and a recorded pty bridge.
//
// A task is a named group of the worktree's terminal tabs
// (`lib/taskStrip.ts` — its header is the decision record for why it is not
// a run). What this spec pins is the strip's whole contract:
// - ⌘T opens a new task: its own chip, its own fresh shell, and the tab bar
//   shows ONLY the new task's tabs (each task owns its terminal set).
// - The tab bar's + adds a tab INSIDE the current task — no new chip.
// - Selecting a chip lands on that task's own remembered tab.
// - A chip's ✕ really ends every shell the task held.
// - The scratch shell appears as the amber mockup tab while it is open, and
//   closing it from the tab leaves a toast saying what it kept: nothing.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

declare global {
  interface Window {
    __TASKS_PROBE__: { opens: string[]; closes: string[] };
  }
}

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPO = {
  id: "repo-tasks",
  name: "vingilot",
  path: "/tmp/vingilot-tasks",
};

const BINDING = `main:${REPO.id}`;

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

async function recordPty(page: Page) {
  await page.evaluate(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
        };
      }
    ).__TAURI_INTERNALS__;
    const passThrough = internals.invoke.bind(internals);
    const probe = { closes: [] as string[], opens: [] as string[] };
    window.__TASKS_PROBE__ = probe;
    internals.invoke = (cmd, args, opts) => {
      const name = String(cmd);
      const payload = (args ?? {}) as Record<string, string>;
      if (name.startsWith("plugin:path|")) return Promise.resolve("/tmp/home/");
      if (name === "pty_backing") return Promise.resolve("tmux");
      if (name === "pty_copy_mode") return Promise.resolve(false);
      if (name === "pty_open") {
        probe.opens.push(payload.session);
        queueMicrotask(
          () =>
            void passThrough("plugin:event|emit", {
              event: "vingilot://pty",
              payload: {
                data: "",
                replay: true,
                seq: 0,
                session: payload.session,
              },
            }),
        );
        return Promise.resolve(null);
      }
      if (name === "pty_close") {
        probe.closes.push(payload.session);
        return Promise.resolve(null);
      }
      if (name.startsWith("pty_")) return Promise.resolve(null);
      return passThrough(cmd, args, opts);
    };
  });
}

async function openWorkspace(page: Page) {
  await page.setViewportSize({ height: 900, width: 1700 });
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await recordPty(page);
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
}

test("⌘T opens a new task with its own shell, and each task owns its terminal set", async ({
  page,
}) => {
  await openWorkspace(page);

  // One task holds the worktree's first terminal, and the strip says so —
  // chip lit, hint on the right, exactly one chip.
  const strip = page.getByTestId("task-strip");
  await expect(strip).toBeVisible();
  await expect(page.getByTestId("task-chip-1")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByTestId("task-strip-hint")).toHaveText("⌘T new task");

  await page.locator(".xterm-screen").first().click();
  await page.keyboard.press("ControlOrMeta+t");

  // A second chip, active, with a genuinely fresh shell behind it…
  await expect(page.getByTestId("task-chip-2")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect
    .poll(() => page.evaluate(() => window.__TASKS_PROBE__.opens))
    .toContain(`${BINDING}#2`);
  // …and the tab bar shows the NEW task's set only: tab 2, not tab 1.
  await expect(page.getByTestId("terminal-tab-2")).toBeVisible();
  await expect(page.getByTestId("terminal-tab-1")).toHaveCount(0);

  // The + belongs to the current task: another tab joins task 2, no chip.
  await page.getByTestId("terminal-tab-new").click();
  await expect(page.getByTestId("terminal-tab-3")).toBeVisible();
  await expect(page.getByTestId("task-chip-3")).toHaveCount(0);

  // Selecting the first chip brings back its own set.
  await page.getByTestId("task-chip-select-1").click();
  await expect(page.getByTestId("task-chip-1")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByTestId("terminal-tab-1")).toBeVisible();
  await expect(page.getByTestId("terminal-tab-2")).toHaveCount(0);
});

test("closing a chip really ends every shell the task held", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.locator(".xterm-screen").first().click();
  await page.keyboard.press("ControlOrMeta+t"); // task 2 → tab 2
  await page.getByTestId("terminal-tab-new").click(); // tab 3 into task 2
  await expect(page.getByTestId("terminal-tab-3")).toBeVisible();

  // The ✕ fades in on hover, the mockup's own affordance.
  await page.getByTestId("task-chip-2").hover();
  await page.getByTestId("task-chip-close-2").click();

  await expect(page.getByTestId("task-chip-2")).toHaveCount(0);
  expect(await page.evaluate(() => window.__TASKS_PROBE__.closes)).toEqual([
    `${BINDING}#2`,
    `${BINDING}#3`,
  ]);
  // Selection lands back on the surviving task's own tab.
  await expect(page.getByTestId("task-chip-1")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByTestId("terminal-tab-1")).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("the scratch shell is an amber tab while open, and its close leaves an honest receipt", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.locator(".xterm-screen").first().click();
  await page.keyboard.press("ControlOrMeta+Alt+t");

  // The overlay is the surface; the strip mirrors it as the mockup's scratch
  // tab — visible ✕, present only while the shell is.
  await expect(page.getByTestId("scratch-terminal")).toBeVisible();
  await expect(page.getByTestId("terminal-tab-scratch")).toBeVisible();

  // The overlay anchors to the terminal pane's BODY, below the tab bar —
  // which is what keeps this ✕ genuinely clickable while the shell is open.
  await page.getByTestId("terminal-tab-scratch-close").click();
  await expect(page.getByTestId("scratch-terminal")).toHaveCount(0);
  await expect(page.getByTestId("terminal-tab-scratch")).toHaveCount(0);
  // The toast is the close's receipt: the shell's promise, said at the
  // moment it is kept.
  await expect(page.getByText("Scratch shell closed")).toBeVisible();
  const closes = await page.evaluate(() => window.__TASKS_PROBE__.closes);
  expect(
    closes.some((session) => session.startsWith("vingilot-scratch.")),
  ).toBe(true);
});
