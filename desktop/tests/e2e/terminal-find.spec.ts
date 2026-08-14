// ⌘F over the terminal's own scrollback, proved against a real xterm and a
// real `@xterm/addon-search` instance
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 1's named
// follow-up; `lib/useTerminalFind.ts`'s header is where the chord boundary is
// argued).
//
// Same discipline `terminal-wheel.spec.ts` states: only the IPC transport is
// replaced (a recorder standing in for the pty), so what xterm renders and
// what its own SearchAddon finds inside that render is the real product, not
// a stand-in for it. The match model this walks is `@xterm/addon-search`'s
// own — there is no parallel string search to disagree with it, unlike the
// Files pane's `findInFile.ts`.
//
// **Three readings:**
// 1. The chord arrives at the terminal's own find bar (not the Files pane's,
//    not upstream's find-in-channel) and counts real matches in real
//    scrollback.
// 2. Escape closes the bar and hands the keyboard straight back to the shell
//    — proved by typing afterward and watching it reach `pty_write`, not by
//    a focus assertion alone.
// 3. The bar is this pane's, not the window's: clicking away from the
//    terminal before pressing ⌘F opens nothing, which is `useTerminalFind`'s
//    stricter-than-Files ownership rule (no "nothing focused" fallback).

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPO = {
  id: "repo-terminal-find",
  name: "vingilot",
  path: "/tmp/vingilot-terminal-find",
};

/** Five short lines, "needle" on three of them in three different shapes —
 * lower-case, doubled (non-overlapping, so it counts twice), and capitalised —
 * so a smart-case, insensitive-until-a-capital query of "needle" reads as a
 * real count rather than a guess. Kept short: xterm wraps a line at the
 * terminal's own column count, and a wrapped line is still one line to
 * `SearchAddon`, but there is no reason to depend on that here. */
const SCROLLBACK_LINES = [
  "first needle line",
  "no match on this one",
  "needleneedle on this one",
  "third plain line",
  "NEEDLE capitalised",
];
/** 1 (line 1) + 2 (line 3's back-to-back, non-overlapping "needleneedle") + 1
 * (line 5's capitalised match, which only counts if the search folded case) —
 * written out rather than computed, so this is a stated expectation rather
 * than the product's own arithmetic echoed back at it. */
const NEEDLE_MATCH_COUNT = 4;

interface FindProbe {
  /** Every `pty_write` payload, in order. */
  writes: string[];
  /** The session id the terminal opened. */
  session: string | null;
}

declare global {
  interface Window {
    __FIND_PROBE__: FindProbe;
    __FIND_PROBE_FEED__: (data: string) => void;
  }
}

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

/** Replace the pty half of the bridge with a recorder, and give the page a way
 * to push real pty bytes at the terminal — `terminal-wheel.spec.ts`'s pattern,
 * copied rather than shared because each spec's probe shape differs. */
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

    const probe: FindProbe = { session: null, writes: [] };
    window.__FIND_PROBE__ = probe;

    let seq = 1;
    const emitChunk = (payload: {
      data: string;
      replay: boolean;
      seq: number;
      session: string;
    }) => {
      void passThrough("plugin:event|emit", {
        event: "vingilot://pty",
        payload,
      });
    };

    window.__FIND_PROBE_FEED__ = (data: string) => {
      if (probe.session === null) throw new Error("no session opened yet");
      emitChunk({ data, replay: false, seq: seq++, session: probe.session });
    };

    internals.invoke = (cmd, args, opts) => {
      const name = String(cmd);
      const payload = (args ?? {}) as Record<string, string>;
      if (name.startsWith("plugin:path|")) return Promise.resolve("/tmp/home/");
      if (name === "pty_backing") return Promise.resolve("tmux");
      if (name === "pty_open") {
        probe.session = payload.session;
        queueMicrotask(() =>
          emitChunk({
            data: "",
            replay: true,
            seq: 0,
            session: payload.session,
          }),
        );
        return Promise.resolve(null);
      }
      if (name === "pty_write") {
        probe.writes.push(payload.data);
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
  // The home-dir lookup runs on RunsScreen's mount, so the recorder has to be
  // in place before the screen that reads it mounts.
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
}

/** A terminal on screen with the fixture lines in its real scrollback, and
 * focus on the shell — the state ⌘F is pressed from. */
async function terminalWithScrollback(page: Page) {
  const screen = page.locator(".xterm-screen").first();
  await expect(screen).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__FIND_PROBE__.session))
    .not.toBeNull();

  await page.evaluate((lines) => {
    window.__FIND_PROBE_FEED__(lines.map((line) => `${line}\r\n`).join(""));
  }, SCROLLBACK_LINES);

  // A click puts real DOM focus on xterm's own hidden textarea — the same
  // thing clicking a live terminal does, and what `useTerminalFind`'s
  // ownership check reads.
  await screen.click();
  return screen;
}

test("⌘F opens the terminal's own find bar and counts real matches in its scrollback", async ({
  page,
}) => {
  await openWorkspace(page);
  await terminalWithScrollback(page);

  await expect(page.getByTestId("terminal-find")).toHaveCount(0);
  // Neither of the OTHER find bars this app has is what opens here.
  await expect(page.getByTestId("files-find")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+f");
  const bar = page.getByTestId("terminal-find");
  await expect(bar).toBeVisible();
  const field = page.getByTestId("terminal-find-input");
  await expect(field).toBeFocused();
  // Nothing claimed before a query exists.
  await expect(page.getByTestId("terminal-find-count")).toHaveText("");

  await page.keyboard.type("needle");
  // The denominator is the real number `@xterm/addon-search` found scanning
  // its own buffer — not a string search this spec or the product duplicates.
  await expect(page.getByTestId("terminal-find-count")).toHaveText(
    new RegExp(`^\\d/${NEEDLE_MATCH_COUNT}$`),
  );

  // Smart case: the capitalised fixture line is still a hit for a lower-case
  // query — four matches, not three, which is only true if the search folded
  // case rather than matching it exactly (`caseSensitive: smartCaseSensitive(...)`
  // in `lib/useTerminalFind.ts`).
  await expect(page.getByTestId("terminal-find-count")).not.toHaveText(
    /^\d\/3$/,
  );
});

test("Escape closes the bar and hands the keyboard straight back to the shell", async ({
  page,
}) => {
  await openWorkspace(page);
  await terminalWithScrollback(page);

  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.getByTestId("terminal-find")).toBeVisible();
  await page.keyboard.type("needle");
  await expect(page.getByTestId("terminal-find-count")).toHaveText(
    new RegExp(`\\d/${NEEDLE_MATCH_COUNT}$`),
  );

  const before = await page.evaluate(() => window.__FIND_PROBE__.writes.length);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("terminal-find")).toHaveCount(0);

  // Proof the keyboard came back to the SHELL, not merely that focus went
  // somewhere: a keystroke now has to arrive at the pty as a write.
  await page.keyboard.type("x");
  await expect
    .poll(() =>
      page.evaluate(
        (from) => window.__FIND_PROBE__.writes.slice(from).join(""),
        before,
      ),
    )
    .toContain("x");
});

test("a ⌘F pressed away from the terminal does not open this bar", async ({
  page,
}) => {
  await openWorkspace(page);
  await terminalWithScrollback(page);
  // Closes the bar's own ownership on THIS terminal by moving focus off it —
  // onto the document body, which `useTerminalFind`'s stricter rule (no
  // "nothing focused" fallback, unlike the Files pane's) refuses to own.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());

  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.getByTestId("terminal-find")).toHaveCount(0);
});
