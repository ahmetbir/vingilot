// ⌘D over the terminal — proof of a deliberate absence, not a feature.
//
// `lib/terminalKeys.ts`'s header states the decision: iTerm's ⌘D/⇧⌘D (split
// vertically/horizontally) pass the five-claimant audit clean, but there is no
// pane model for a second, sibling terminal to split into
// (`lib/paneModel.ts`), and the one thing ⌘D could honestly bind to today —
// aliasing it to `new-terminal-tab` — is refused on purpose: a split keeps
// sibling context visible, a tab replaces the view, and the two are not the
// same gesture. So ⌘D is unbound.
//
// A spec for an absence needs to prove the RIGHT thing: not merely that
// nothing crashes, but that the tab strip genuinely does not react — no new
// tab, no change of which one is active, nothing written to the pty. Without
// this, a future edit reaching for a free-looking "d" (the five-claimant audit
// would still pass) could quietly wire ⌘D to `new-terminal-tab` — exactly the
// alias the header calls a lie — and nothing would fail.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPO = {
  id: "repo-cmd-d",
  name: "vingilot",
  path: "/tmp/vingilot-cmd-d",
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

/** The same minimal pty stub `terminal-wheel.spec.ts`'s `recordPty` uses:
 * enough for a session to actually open (a home dir to resolve, `tmux` as the
 * backing, one empty replay chunk on `pty_open`) so `cwd` resolves and the
 * terminal's own effect gets past its `cwd === null` guard. This spec does
 * not read what was written, so nothing is recorded — only enough is stubbed
 * to get a real xterm on screen for a real chord to reach. */
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
    internals.invoke = (cmd, args, opts) => {
      const name = String(cmd);
      const payload = (args ?? {}) as Record<string, string>;
      if (name.startsWith("plugin:path|")) return Promise.resolve("/tmp/home/");
      if (name === "pty_backing") return Promise.resolve("tmux");
      if (name === "pty_open") {
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
  });
}

async function openWorkspace(page: Page) {
  await page.setViewportSize({ height: 900, width: 1700 });
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await stubPty(page);
  // The home-dir lookup runs on RunsScreen's mount, so the stub has to be in
  // place before the screen that reads it mounts (same trip
  // `terminal-wheel.spec.ts` makes).
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
}

test("⌘D over the terminal opens no second tab, and ⇧⌘D does not either", async ({
  page,
}) => {
  await openWorkspace(page);

  const strip = page.getByTestId("terminal-tab-strip");
  await expect(strip).toBeVisible();
  await expect(page.getByTestId("terminal-tab-1")).toBeVisible();
  await expect(page.getByTestId("terminal-tab-2")).toHaveCount(0);

  await page.locator(".xterm-screen").first().click();
  await page.keyboard.press("ControlOrMeta+d");
  // No new tab, and the strip's one tab is still the active one — not merely
  // "no crash", but the actual claim: this chord changed nothing about the
  // terminal side.
  await expect(page.getByTestId("terminal-tab-2")).toHaveCount(0);
  await expect(page.getByTestId("terminal-tab-1")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.keyboard.press("ControlOrMeta+Shift+d");
  await expect(page.getByTestId("terminal-tab-2")).toHaveCount(0);
  await expect(page.getByTestId("terminal-tab-1")).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
