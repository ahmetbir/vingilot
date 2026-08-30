// The scroll fix, proved from the owner's side of the glass (redesign P2,
// decision 4: "scroll duzgun calismiyor").
//
// Two backings, two halves of the story:
//
// **xterm owns the history** (`pty_backing` = app-process — the scratch
// shell, every machine without tmux). Lines are fed on the app's own event
// channel, a real wheel gesture scrolls a real xterm's viewport, and the
// spec asserts the three things "scroll works properly" means here: the
// view really leaves the bottom (the jump control appears, counting), new
// output does NOT yank the view back down while the owner is reading (the
// count grows instead), and the one-click way back works.
//
// **tmux owns the history** (`pty_backing` = tmux). The wheel path itself is
// terminal-wheel.spec.ts's, and the real-tmux half (a wheel report enters
// copy-mode, `cancel` leaves it) is proved against a live server in
// vingilot_pty/live/wheel.rs. What THIS spec owns is the UI contract of the
// new `pty_copy_mode` poll: a pane in copy-mode grows the "back to live"
// control within a poll tick, clicking it calls `pty_copy_mode_exit` for
// exactly this session, and the control leaves when the pane does.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

declare global {
  interface Window {
    __SCROLL_PROBE__: {
      session: string | null;
      copyMode: boolean;
      exits: string[];
    };
    __SCROLL_FEED__: (lines: number) => void;
  }
}

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPO = {
  id: "repo-scroll",
  name: "vingilot",
  path: "/tmp/vingilot-scroll",
};

const PRIMARY = `main:${REPO.id}#1`;

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

/** The pty half of the bridge, replaced: a session that opens for real, a
 * feeder that pushes numbered lines at it on the app's own channel, and a
 * copy-mode switch the test flips to play tmux's side of the poll. */
async function recordPty(page: Page, backing: "app-process" | "tmux") {
  await page.evaluate((ptyBacking) => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
        };
      }
    ).__TAURI_INTERNALS__;
    const passThrough = internals.invoke.bind(internals);
    const probe = {
      copyMode: false,
      exits: [] as string[],
      session: null as string | null,
    };
    window.__SCROLL_PROBE__ = probe;

    let seq = 1;
    let line = 0;
    window.__SCROLL_FEED__ = (lines: number) => {
      if (probe.session === null) throw new Error("no session opened yet");
      let data = "";
      for (let i = 0; i < lines; i++) {
        line += 1;
        data += `line-${line}\r\n`;
      }
      void passThrough("plugin:event|emit", {
        event: "vingilot://pty",
        payload: { data, replay: false, seq: seq++, session: probe.session },
      });
    };

    internals.invoke = (cmd, args, opts) => {
      const name = String(cmd);
      const payload = (args ?? {}) as Record<string, string>;
      if (name.startsWith("plugin:path|")) return Promise.resolve("/tmp/home/");
      if (name === "pty_backing") return Promise.resolve(ptyBacking);
      if (name === "pty_copy_mode") return Promise.resolve(probe.copyMode);
      if (name === "pty_copy_mode_exit") {
        probe.exits.push(payload.session);
        // tmux's side of the act: cancel leaves copy-mode.
        probe.copyMode = false;
        return Promise.resolve(null);
      }
      if (name === "pty_open") {
        if (probe.session === null) probe.session = payload.session;
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
      if (name.startsWith("pty_")) return Promise.resolve(null);
      return passThrough(cmd, args, opts);
    };
  }, backing);
}

async function openWorkspace(page: Page, backing: "app-process" | "tmux") {
  await page.setViewportSize({ height: 900, width: 1700 });
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await recordPty(page, backing);
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  await expect(page.locator(".xterm-screen").first()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__SCROLL_PROBE__.session))
    .toBe(PRIMARY);
}

function jumpControl(page: Page) {
  return page.getByTestId(`terminal-jump-to-bottom-${PRIMARY}`);
}

test("wheel scrollback works, and new output never yanks a reading owner back down", async ({
  page,
}) => {
  await openWorkspace(page, "app-process");

  // Something to scroll back to, then a real wheel gesture over the screen.
  await page.evaluate(() => window.__SCROLL_FEED__(200));
  await expect(jumpControl(page)).toHaveCount(0);
  const screen = page.locator(".xterm-screen").first();
  await screen.hover();
  await page.mouse.wheel(0, -600);

  // The view really left the bottom: the control appears and counts.
  await expect(jumpControl(page)).toBeVisible();
  const before = Number(
    await jumpControl(page).getAttribute("data-lines-behind"),
  );
  expect(before).toBeGreaterThan(0);

  // The stick-to-bottom half: 40 more lines arrive while the owner reads.
  // The view must stay put — which shows up as the count growing by exactly
  // those 40 lines. A viewport yanked to the bottom would read 0 and the
  // control would vanish.
  await page.evaluate(() => window.__SCROLL_FEED__(40));
  await expect
    .poll(async () =>
      Number(await jumpControl(page).getAttribute("data-lines-behind")),
    )
    .toBe(before + 40);

  // And the way back is one click, after which the bottom is the bottom:
  // fresh output keeps the view (no control reappears — that is
  // stick-to-bottom resuming, and it resumes only because the owner is AT
  // the bottom again).
  await jumpControl(page).click();
  await expect(jumpControl(page)).toHaveCount(0);
  await page.evaluate(() => window.__SCROLL_FEED__(20));
  await expect(jumpControl(page)).toHaveCount(0);
});

test("a tmux pane in copy-mode grows the back-to-live control, and the click cancels for this session", async ({
  page,
}) => {
  await openWorkspace(page, "tmux");
  await page.evaluate(() => window.__SCROLL_FEED__(50));

  // Live screen: no control, however long we look (one poll tick is 1s).
  await page.waitForTimeout(1_500);
  await expect(jumpControl(page)).toHaveCount(0);

  // tmux's answer flips — the pane entered copy-mode (the wheel report that
  // causes this is terminal-wheel.spec.ts's subject; the real tmux side is
  // vingilot_pty/live/wheel.rs's). The poll only ASKS while a wheel has
  // armed it (an idle Deck spawns no tmux processes — the P2 verify's
  // minor 2), and a wheel is exactly how a real pane gets here — so the
  // test takes the same door: flip the mock, then wheel over the terminal.
  await page.evaluate(() => {
    window.__SCROLL_PROBE__.copyMode = true;
  });
  // Dispatched on the xterm host (the wheel OWNER), not the pane's outer
  // box: the webview scroll-boundary lock consumes any wheel whose composed
  // path carries no `data-vingilot-wheel-owner` at window capture — which is
  // also where a real pointer's wheel lands.
  await page
    .getByTestId(`terminal-${PRIMARY}`)
    .locator("[data-vingilot-wheel-owner]")
    .dispatchEvent("wheel", { deltaY: -120 });
  await expect(jumpControl(page)).toBeVisible();
  await expect(jumpControl(page)).toHaveText(/back to live/i);
  await expect(jumpControl(page)).toHaveAttribute("data-lines-behind", "0");

  // The click is copy-mode's own cancel, addressed to exactly this session,
  // and the control leaves with the mode.
  await jumpControl(page).click();
  await expect
    .poll(() => page.evaluate(() => window.__SCROLL_PROBE__.exits))
    .toEqual([PRIMARY]);
  await expect(jumpControl(page)).toHaveCount(0);
});
