// ⌘D / ⇧⌘D over the terminal — the split, proved end to end.
//
// This file used to prove a deliberate absence: the chords passed the
// claimant audit but there was no model for a second, sibling terminal, so
// the spec asserted ⌘D changed nothing. The split model exists now
// (`lib/terminalSplit.ts` — one extra pty beside the active tab's own, a
// draggable divider between them), and the old refusal survives as an
// assertion inside the new proof: **⌘D must still open no tab**. Aliasing
// the split chord to `new-terminal-tab` was the lie the old header named,
// and it is now a failure this spec would catch rather than a paragraph.
//
// What is proved, against the real key path and a real xterm per half:
// - ⌘D opens a second live pty (`<primary>~half` reaches `pty_open`) beside
//   the first, no tab appears, and the strip's one tab stays active.
// - ⇧⌘D turns the same split downward — same two sessions, nothing closed.
// - The divider drags, and the layout follows the ratio it reports.
// - Closing the half ends exactly the half's session (`pty_close` names it,
//   and only it) and restores the single terminal.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

declare global {
  interface Window {
    __SPLIT_PROBE__: { opens: string[]; closes: string[] };
  }
}

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPO = {
  id: "repo-cmd-d",
  name: "vingilot",
  path: "/tmp/vingilot-cmd-d",
};

/** The main checkout's binding id (`projects.ts`'s synthetic row), tab 1 —
 * the session ⌘D acts on — and the half id the model derives from it. */
const PRIMARY = `main:${REPO.id}#1`;
const HALF = `${PRIMARY}~half`;

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

/** The same minimal pty stub `terminal-wheel.spec.ts`'s recorder uses —
 * enough for sessions to really open (a home dir, `tmux` backing, one empty
 * replay per `pty_open`) — plus a probe recording which sessions were opened
 * and closed, because "the half's shell really ended" is exactly a claim
 * about which ids crossed `pty_close`. */
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
    window.__SPLIT_PROBE__ = probe;
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
  // The home-dir lookup runs on RunsScreen's mount, so the recorder has to
  // be in place before the screen that reads it mounts (same trip
  // `terminal-wheel.spec.ts` makes).
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
}

function splitHost(page: Page) {
  return page.getByTestId(`terminal-split-host-${PRIMARY}`);
}

test("⌘D splits the terminal into two live shells, and still opens no tab", async ({
  page,
}) => {
  await openWorkspace(page);

  await expect(page.getByTestId("terminal-tab-1")).toBeVisible();
  await expect(splitHost(page)).toHaveAttribute("data-split", "none");

  await page.locator(".xterm-screen").first().click();
  await page.keyboard.press("ControlOrMeta+d");

  // The split is real: the layout says which way, the half's own session id
  // reached the backend, and a second xterm is attached to it.
  await expect(splitHost(page)).toHaveAttribute("data-split", "right");
  await expect
    .poll(() => page.evaluate(() => window.__SPLIT_PROBE__.opens))
    .toContain(HALF);
  await expect(page.getByTestId(`terminal-${HALF}`)).toBeVisible();
  await expect(page.getByTestId("terminal-split-divider")).toBeVisible();

  // The old spec's claim, kept: the chord opened NO tab — a split keeps
  // sibling context visible, a tab replaces the view, and the two must never
  // collapse into each other.
  await expect(page.getByTestId("terminal-tab-2")).toHaveCount(0);
  await expect(page.getByTestId("terminal-tab-1")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // ⇧⌘D turns the divider: same two sessions, nothing closed, new axis.
  await page.locator(".xterm-screen").first().click();
  await page.keyboard.press("ControlOrMeta+Shift+d");
  await expect(splitHost(page)).toHaveAttribute("data-split", "down");
  expect(await page.evaluate(() => window.__SPLIT_PROBE__.closes)).toEqual([]);
  // And repeating the chord in force is a no-op, not a third shell.
  await page.keyboard.press("ControlOrMeta+Shift+d");
  expect(
    (await page.evaluate(() => window.__SPLIT_PROBE__.opens)).filter(
      (session) => session === HALF,
    ),
  ).toHaveLength(1);
});

test("the divider drags, clamps at 20%, and closing the half ends only its shell", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.locator(".xterm-screen").first().click();
  await page.keyboard.press("ControlOrMeta+d");
  await expect(splitHost(page)).toHaveAttribute("data-split", "right");

  const grow = () =>
    page.evaluate((primary) => {
      const host = document.querySelector(
        `[data-testid="terminal-split-host-${primary}"]`,
      );
      const box = host?.firstElementChild;
      return box === null || box === undefined
        ? null
        : Number(window.getComputedStyle(box as Element).flexGrow);
    }, PRIMARY);
  expect(await grow()).toBeCloseTo(0.5, 5);

  // A real pointer drag on the divider, most of the way to the left edge:
  // the layout must follow the pointer and stop at the 20% floor — a pane at
  // zero pixels is a pty resized to nothing.
  const divider = page.getByTestId("terminal-split-divider");
  const handle = await divider.boundingBox();
  const host = await splitHost(page).boundingBox();
  expect(handle).not.toBeNull();
  expect(host).not.toBeNull();
  if (handle === null || host === null) return;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(host.x + host.width * 0.05, handle.y, { steps: 5 });
  await page.mouse.up();
  expect(await grow()).toBeCloseTo(0.2, 5);

  // Closing the half: exactly one session ends, and it is the half's.
  await page.getByTestId(`terminal-split-close-${PRIMARY}`).click();
  await expect(splitHost(page)).toHaveAttribute("data-split", "none");
  await expect(page.getByTestId(`terminal-${HALF}`)).toHaveCount(0);
  expect(await page.evaluate(() => window.__SPLIT_PROBE__.closes)).toEqual([
    HALF,
  ]);
  // The tab and its shell are untouched.
  await expect(page.getByTestId(`terminal-${PRIMARY}`)).toBeVisible();
  await expect(page.getByTestId("terminal-tab-1")).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
