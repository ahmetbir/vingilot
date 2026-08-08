// What a wheel over the terminal actually sends to the pty.
//
// **Why this is not a test of a mock.** The bytes written into the terminal
// here are not invented: `tmux-attach-mouse-on.json` is a verbatim capture of
// what tmux 3.6a wrote to a real pty when it was spawned with `plan_spawn`'s
// exact argv (`vingilot_pty/tmux.rs`) — attach, `status off`, `mouse on`. That
// the capture is still what tmux sends is not taken on trust either:
// `vingilot_pty/live.rs`'s
// `a_wheel_report_is_what_makes_tmux_scroll_and_an_arrow_key_is_not` opens a
// session through the app's own command against a real tmux and fails if any
// of the mouse mode sets replayed here has stopped arriving.
//
// Everything downstream of those bytes is the product: the real `Terminal`
// component, the real xterm, the real work surface DOM and app shell around
// it, and a real trusted wheel event delivered by the browser. Only the IPC
// transport is replaced, and it is replaced by a *recorder* — what is observed
// is exactly what would have crossed it.
//
// The far end is that same Rust test: it writes the SGR report this spec sees
// leaving xterm into a real tmux and asserts the pane scrolls, and writes the
// arrow keys xterm sends when no protocol is active and asserts it does not.
// Between the two there is no mocked step: tmux → xterm → wheel → bytes →
// tmux.
//
// **This spec was the reproduction and is now the proof.** It failed for the
// whole life of the bug, on the last assertion in the first test, with an
// empty string: `useWebviewScrollBoundaryLock` consumed every wheel at window
// capture, one layer above xterm. The second test is the A/B that keeps the
// fix honest — take the terminal's claim on the gesture away at runtime and
// the wheel goes silent again, put it back and the report returns.

import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

/** Read rather than imported: a JSON import needs an import attribute under
 * Playwright's ESM loader, and this file is data, not a module. */
const tmuxAttachMouseOn: string = JSON.parse(
  readFileSync(
    path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "tmux-attach-mouse-on.json",
    ),
    "utf8",
  ),
);

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

/** Kept in step with `shared/lib/wheelOwner.ts`, by the assertion in
 * `the claim on the gesture is what carries the wheel to the pty` below: the
 * terminal container must really carry this attribute, and the app is asked
 * for it rather than told. */
const WHEEL_OWNER_ATTRIBUTE = "data-vingilot-wheel-owner";

/** One SGR mouse report — `CSI < button ; col ; row M` — read out of what the
 * pty was told, or `null` if that is not what it was told.
 *
 * 64 is wheel-up and 65 is wheel-down (button 4, plus the 64 that marks a
 * wheel). Nothing else xterm emits has this shape, so parsing it is enough to
 * say a *wheel* is what reached the pty — and the button says which way, the
 * column and row where. Parsed rather than matched with a regular expression
 * because the pattern would have to carry a literal ESC, which Biome refuses
 * inside one. */
function sgrMouseReport(bytes: string) {
  const head = "\u001b[<";
  if (!bytes.startsWith(head) || !bytes.endsWith("M")) return null;
  const fields = bytes.slice(head.length, -1).split(";");
  if (fields.length !== 3 || fields.some((field) => !/^\d+$/.test(field))) {
    return null;
  }
  const [button, col, row] = fields.map(Number);
  return { button, col, row };
}

const REPO = {
  id: "repo-wheel",
  name: "vingilot",
  path: "/tmp/vingilot-wheel",
};

/** What the page records for us. */
interface WheelProbe {
  /** Every `pty_write` payload, in order. */
  writes: string[];
  /** The session id the terminal opened. */
  session: string | null;
}

declare global {
  interface Window {
    __WHEEL_PROBE__: WheelProbe;
    __WHEEL_PROBE_FEED__: (data: string) => void;
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
 * to push real pty bytes at the terminal on the app's own event channel. */
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

    const probe: WheelProbe = { session: null, writes: [] };
    window.__WHEEL_PROBE__ = probe;

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

    window.__WHEEL_PROBE_FEED__ = (data: string) => {
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
        // What the backend does from inside `pty_open` on the spawn branch:
        // one replay, empty, mark 0 (vingilot_pty/mod.rs).
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
  // in place before the screen that reads it mounts (workspace-notes.spec.ts
  // makes the same trip).
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
}

/** A terminal showing what a real tmux attach put on the wire, with enough
 * lines behind it that a wheel has somewhere to go. Answers with the pointer
 * parked over the middle of the screen. */
async function terminalUnderThePointer(page: Page) {
  const screen = page.locator(".xterm-screen").first();
  await expect(screen).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__WHEEL_PROBE__.session))
    .not.toBeNull();

  // The bytes tmux really sent on attach with `mouse on`, replayed verbatim.
  await page.evaluate(
    (bytes) => window.__WHEEL_PROBE_FEED__(bytes),
    tmuxAttachMouseOn,
  );
  await page.evaluate(() => {
    window.__WHEEL_PROBE_FEED__(
      Array.from({ length: 200 }, (_, i) => `probe-line-${i + 1}\r\n`).join(""),
    );
  });

  // xterm stamps this class on its element the moment a mouse protocol goes
  // active (browser/Terminal.ts, onProtocolChange). Until it is there, the
  // replayed mode sets have not been parsed yet and a wheel proves nothing.
  await expect(page.locator(".xterm.enable-mouse-events")).toBeVisible();

  const box = await screen.boundingBox();
  if (box === null) throw new Error("the terminal has no box to point at");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  return screen;
}

/** Everything the pty was told during `gesture`, in order. */
async function writesDuring(page: Page, gesture: () => Promise<void>) {
  const before = await page.evaluate(
    () => window.__WHEEL_PROBE__.writes.length,
  );
  await gesture();
  // A write crosses two promises (xterm's data event, then the invoke), so a
  // poll rather than a read: an assertion that the pty heard *nothing* must
  // not be able to pass by arriving early.
  await page.waitForTimeout(300);
  return page.evaluate(
    (from) => window.__WHEEL_PROBE__.writes.slice(from),
    before,
  );
}

test("a wheel over the terminal is reported to the pty", async ({ page }) => {
  await openWorkspace(page);
  await terminalUnderThePointer(page);

  const up = await writesDuring(page, () => page.mouse.wheel(0, -240));
  const down = await writesDuring(page, () => page.mouse.wheel(0, 240));
  console.log(
    `wheel up -> ${JSON.stringify(up)}\nwheel down -> ${JSON.stringify(down)}`,
  );

  const reportedUp = sgrMouseReport(up.join(""));
  expect(
    reportedUp,
    "a wheel-up reached the pty as something other than a mouse report",
  ).not.toBeNull();
  expect(reportedUp?.button, "the report is not a wheel-up").toBe(64);
  // The report carries where the pointer is, in cells. tmux reads those to
  // decide which pane scrolled, so a report anchored at the origin would scroll
  // the wrong one — and 1,1 is the top-left cell, not the middle of a screen.
  expect(
    reportedUp?.col,
    "the report is not anchored where the pointer is",
  ).toBeGreaterThan(1);
  expect(
    reportedUp?.row,
    "the report is not anchored where the pointer is",
  ).toBeGreaterThan(1);

  const reportedDown = sgrMouseReport(down.join(""));
  expect(
    reportedDown,
    "a wheel-down reached the pty as something other than a mouse report",
  ).not.toBeNull();
  expect(
    reportedDown?.button,
    "both directions sent the same report, so the wheel has no direction",
  ).toBe(65);
});

test("the claim on the gesture is what carries the wheel to the pty", async ({
  page,
}) => {
  await openWorkspace(page);
  await terminalUnderThePointer(page);

  // The claim is read off the running app rather than assumed: if the terminal
  // ever stops marking its container, this fails here instead of silently
  // testing nothing below.
  const claimed = await page.evaluate(
    (attribute) =>
      document
        .querySelector(`[${attribute}]`)
        ?.contains(document.querySelector(".xterm-screen")) ?? false,
    WHEEL_OWNER_ATTRIBUTE,
  );
  expect(claimed, "no wheel owner contains the terminal's screen").toBe(true);

  // A/B. Same terminal, same xterm, same gesture, one attribute.
  await page.evaluate(
    (attribute) =>
      document.querySelector(`[${attribute}]`)?.removeAttribute(attribute),
    WHEEL_OWNER_ATTRIBUTE,
  );
  const unclaimed = await writesDuring(page, () => page.mouse.wheel(0, -240));

  await page.evaluate(
    (attribute) =>
      document
        .querySelector(".xterm")
        ?.parentElement?.setAttribute(attribute, ""),
    WHEEL_OWNER_ATTRIBUTE,
  );
  const reclaimed = await writesDuring(page, () => page.mouse.wheel(0, -240));

  expect(
    unclaimed,
    "the wheel reached the pty with nothing claiming it, so this spec is not testing the fix",
  ).toEqual([]);
  expect(
    sgrMouseReport(reclaimed.join(""))?.button,
    "putting the claim back did not bring the report back",
  ).toBe(64);
});

test("a wheel over the terminal still cannot rubber-band the webview", async ({
  page,
}) => {
  await openWorkspace(page);
  await terminalUnderThePointer(page);

  // Dispatched on the claiming container itself, so xterm's own listeners —
  // which sit on a descendant and cancel everything they handle — are not on
  // the path. What cancels this event can only be the shell's boundary lock,
  // which is the half of its job that must survive the fix: the gesture
  // travels, the rubber-band does not.
  const prevented = await page.evaluate((attribute) => {
    const owner = document.querySelector(`[${attribute}]`);
    if (owner === null) throw new Error("no wheel owner to aim at");
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -120,
    });
    owner.dispatchEvent(event);
    return event.defaultPrevented;
  }, WHEEL_OWNER_ATTRIBUTE);

  expect(prevented, "a wheel over the terminal can pan the whole webview").toBe(
    true,
  );
});
