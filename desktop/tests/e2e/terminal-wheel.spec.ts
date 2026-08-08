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
// **This spec fails today, and that is what it is for.** It is deliberately
// not in `playwright.config.ts`'s projects: it is a reproduction, run by hand
// with a config of its own, until the wheel reaches the pty.

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
  /** One entry per wheel event seen, at each phase it survived to. */
  phases: string[];
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

    const probe: WheelProbe = { phases: [], session: null, writes: [] };
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

    // Where a wheel event gets to. Capture on window fires before anything in
    // the tree; bubble on window fires only if nothing between stopped it.
    const name = (node: EventTarget | null) => {
      const el = node as HTMLElement | null;
      if (el === null || el.tagName === undefined) return String(node);
      const cls = typeof el.className === "string" ? el.className : "";
      return `${el.tagName.toLowerCase()}${cls === "" ? "" : `.${cls.trim().split(/\s+/).join(".")}`}`;
    };
    // On `document`, not `window`: `window` capture is where the app's own
    // locks live, and this probe must not become one of the things under
    // test. `document` capture runs immediately after them, so what it reports
    // is the event as the app's listeners left it.
    document.addEventListener(
      "wheel",
      (event) => {
        probe.phases.push(
          `capture defaultPrevented=${event.defaultPrevented} target=${name(event.target)} deltaY=${(event as WheelEvent).deltaY} path=${event
            .composedPath()
            .slice(0, 8)
            .map(name)
            .join(" < ")}`,
        );
      },
      true,
    );
    document.addEventListener("wheel", (event) => {
      probe.phases.push(`bubble defaultPrevented=${event.defaultPrevented}`);
    });
  });
}

/** Record every capture-phase wheel listener the app puts on `window`, and
 * make each one switchable at runtime.
 *
 * Installed before any app code so the wrappers are what actually get
 * registered. Nothing is removed and no product code is edited — a listener
 * turned off here is the A/B that says whether it is the one eating the
 * gesture, which is the difference between naming a cause and pointing at a
 * plausible line. */
async function interceptWindowWheelListeners(page: Page) {
  await page.addInitScript(() => {
    interface Lock {
      enabled: boolean;
      source: string;
      wrapper: EventListener;
    }
    const locks: Lock[] = [];
    (window as unknown as { __WHEEL_LOCKS__: Lock[] }).__WHEEL_LOCKS__ = locks;
    const byOriginal = new Map<EventListenerOrEventListenerObject, Lock>();
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);

    window.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      const capture =
        options === true ||
        (typeof options === "object" && options?.capture === true);
      if (type !== "wheel" || !capture || typeof listener !== "function") {
        return add(type, listener, options);
      }
      const lock: Lock = {
        enabled: true,
        source: listener.toString().slice(0, 200),
        wrapper: (event: Event) => {
          if (lock.enabled) listener.call(window, event);
        },
      };
      locks.push(lock);
      byOriginal.set(listener, lock);
      return add(type, lock.wrapper, options);
    }) as typeof window.addEventListener;

    window.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => {
      const lock = byOriginal.get(listener);
      if (lock === undefined) return remove(type, listener, options);
      byOriginal.delete(listener);
      const at = locks.indexOf(lock);
      if (at !== -1) locks.splice(at, 1);
      return remove(type, lock.wrapper, options);
    }) as typeof window.removeEventListener;
  });
}

async function openWorkspace(page: Page) {
  await page.setViewportSize({ height: 900, width: 1700 });
  await interceptWindowWheelListeners(page);
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

test("a wheel over the terminal: what reaches the pty", async ({ page }) => {
  await openWorkspace(page);

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
  // Enough lines that a viewport-scrolling terminal would have somewhere to go.
  await page.evaluate(() => {
    window.__WHEEL_PROBE_FEED__(
      Array.from({ length: 200 }, (_, i) => `probe-line-${i + 1}\r\n`).join(""),
    );
  });
  await page.waitForTimeout(300);

  const before = await page.evaluate(() => ({
    // Which element is actually under the pointer where the wheel lands, and
    // what xterm's own DOM looks like around it.
    dom: (() => {
      const xterm = document.querySelector(".xterm");
      const box = document
        .querySelector(".xterm-screen")
        ?.getBoundingClientRect();
      const at =
        box === undefined
          ? null
          : document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            );
      return {
        elementAtWheelPoint: at === null ? null : at.className || at.tagName,
        xtermClasses: xterm?.className ?? null,
        xtermChildren: [...(xterm?.children ?? [])].map((c) => c.className),
      };
    })(),
    // xterm stamps this class on its element the moment a mouse protocol goes
    // active (browser/Terminal.ts, onProtocolChange) — the one honest DOM
    // signal of whether the wheel is being reported at all.
    mouseEvents: Boolean(
      document
        .querySelector(".xterm")
        ?.classList.contains("enable-mouse-events"),
    ),
    writes: [...window.__WHEEL_PROBE__.writes],
  }));

  // Reach the live xterm instance the component holds. It is not a global —
  // `Terminal.tsx` keeps it in `termRef` — so it is read out of React's own
  // hook state for that component. Nothing is replaced: two extra listeners
  // are added beside the app's, so what is measured is the app's own object.
  const wiring = await page.evaluate(() => {
    const container = document.querySelector(".xterm")?.parentElement;
    if (!container) return { error: "no xterm container" };
    const fiberKey = Object.keys(container).find((k) =>
      k.startsWith("__reactFiber$"),
    );
    if (fiberKey === undefined) return { error: "no react fiber" };
    interface Fiber {
      return: Fiber | null;
      memoizedState: { memoizedState?: unknown; next?: unknown } | null;
    }
    let fiber = (container as unknown as Record<string, Fiber>)[fiberKey];
    for (let up = 0; up < 12 && fiber; up += 1) {
      let hook = fiber.memoizedState;
      for (let n = 0; n < 40 && hook; n += 1) {
        const held = (hook.memoizedState ?? null) as {
          current?: Record<string, unknown>;
        } | null;
        const term = held?.current;
        if (term && typeof term.onBinary === "function") {
          const core = term._core as {
            coreMouseService: {
              activeProtocol: string;
              activeEncoding: string;
              areMouseEventsActive: boolean;
            };
          };
          const seen: string[] = [];
          (term.onBinary as (cb: (d: string) => void) => void)((d) =>
            seen.push(`onBinary ${JSON.stringify(d)}`),
          );
          (term.onData as (cb: (d: string) => void) => void)((d) =>
            seen.push(`onData ${JSON.stringify(d)}`),
          );
          (window as unknown as { __XTERM_SEEN__: string[] }).__XTERM_SEEN__ =
            seen;
          (
            window as unknown as { __XTERM__: Record<string, unknown> }
          ).__XTERM__ = term;
          // Wrap — not replace — the four steps xterm takes between a wheel
          // event and a byte on the pty, so the one that stops is named
          // rather than inferred.
          const spy = <A extends unknown[], R>(
            host: Record<string, unknown>,
            method: string,
            show: (result: R) => string,
          ) => {
            const original = host[method] as (...a: A) => R;
            if (typeof original !== "function") {
              seen.push(`MISSING ${method}`);
              return;
            }
            host[method] = (...args: A): R => {
              const result = original.apply(host, args);
              seen.push(`${method} -> ${show(result)}`);
              return result;
            };
          };
          const inner = term._core as Record<string, Record<string, unknown>>;
          spy(inner.coreMouseService, "triggerMouseEvent", String);
          spy(inner._mouseService, "getMouseReportCoords", (r) =>
            JSON.stringify(r),
          );
          spy(inner.viewport, "getLinesScrolled", String);
          spy(inner.coreService, "triggerDataEvent", () => "fired");
          spy(inner.coreService, "triggerBinaryEvent", () => "fired");
          return {
            activeEncoding: core.coreMouseService.activeEncoding,
            activeProtocol: core.coreMouseService.activeProtocol,
            areMouseEventsActive: core.coreMouseService.areMouseEventsActive,
          };
        }
        hook = (hook.next ?? null) as { memoizedState?: unknown } | null;
      }
      fiber = fiber.return as Fiber;
    }
    return { error: "no xterm instance found on any ancestor fiber" };
  });

  const box = await screen.boundingBox();
  if (box === null) throw new Error("the terminal has no box to point at");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => ({
    phases: [...window.__WHEEL_PROBE__.phases],
    writes: [...window.__WHEEL_PROBE__.writes],
    xtermEmitted: [
      ...((window as unknown as { __XTERM_SEEN__?: string[] }).__XTERM_SEEN__ ??
        []),
    ],
  }));

  // Which of the preconditions in xterm's own `sendEvent` the wheel failed,
  // asked of the app's live instance rather than reasoned about.
  const insides = await page.evaluate(() => {
    const term = (window as unknown as { __XTERM__?: Record<string, unknown> })
      .__XTERM__;
    if (term === undefined) return { error: "no xterm captured" };
    const core = term._core as {
      _mouseService: {
        getMouseReportCoords: (
          ev: MouseEvent,
          el: HTMLElement,
        ) => { col: number; row: number; x: number; y: number } | undefined;
      };
      screenElement: HTMLElement;
      viewport: { getLinesScrolled: (ev: WheelEvent) => number };
      coreMouseService: {
        triggerMouseEvent: (e: Record<string, unknown>) => boolean;
      };
    };
    const rect = core.screenElement.getBoundingClientRect();
    const ev = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
      deltaMode: 0,
      deltaY: -240,
    });
    return {
      // `undefined` here is sendEvent's first `return false`.
      reportCoords: core._mouseService.getMouseReportCoords(
        ev,
        core.screenElement,
      ),
      // `0` here is sendEvent's second `return false`.
      linesScrolled: core.viewport.getLinesScrolled(ev),
      // Bypasses both: does the encoder itself still produce a report?
      encoderAcceptedAWheelUp: core.coreMouseService.triggerMouseEvent({
        action: 0,
        alt: false,
        button: 4,
        col: 0,
        ctrl: false,
        row: 0,
        shift: false,
        x: 0,
        y: 0,
      }),
    };
  });

  // The A/B. Same terminal, same xterm, same gesture — with exactly one
  // capture-phase wheel listener on `window` switched off: the one that walks
  // `composedPath()` looking for something scrollable
  // (`shared/hooks/useWebviewScrollBoundaryLock.ts`). Every other listener,
  // including this file's own probe, stays on, so the difference in what
  // follows can only be that one.
  const locks = await page.evaluate(() => {
    interface Lock {
      enabled: boolean;
      source: string;
    }
    const found = (window as unknown as { __WHEEL_LOCKS__: Lock[] })
      .__WHEEL_LOCKS__;
    const disabled: string[] = [];
    for (const lock of found) {
      if (!lock.source.includes("composedPath")) continue;
      lock.enabled = false;
      disabled.push(lock.source);
    }
    return { all: found.map((lock) => lock.source), disabled };
  });
  const beforeSecondWheel = await page.evaluate(() => [
    ...window.__WHEEL_PROBE__.writes,
  ]);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(300);
  const withoutLock = await page.evaluate(() => ({
    phases: [...window.__WHEEL_PROBE__.phases],
    writes: [...window.__WHEEL_PROBE__.writes],
  }));

  const sent = after.writes.slice(before.writes.length);
  // Reported, not asserted: this test exists to say what happens, and the
  // answer is what tells the fix apart from the three other fixes.
  console.log(
    JSON.stringify(
      {
        dom: before.dom,
        insideXtermSendEvent: insides,
        mouseProtocolActive: before.mouseEvents,
        wheelPhases: after.phases,
        writesBeforeWheel: before.writes,
        writesFromWheel: sent,
        // What xterm itself emitted for the wheel, before the app's wiring
        // gets a say. `onData` is wired to `pty_write`; `onBinary` is not.
        xtermEmittedForWheel: after.xtermEmitted,
        xtermMouse: wiring,
        captureWheelListenersOnWindow: locks.all,
        disabledForTheSecondWheel: locks.disabled,
        wheelPhasesWithBoundaryLockOff: withoutLock.phases.slice(
          after.phases.length,
        ),
        writesFromWheelWithBoundaryLockOff: withoutLock.writes.slice(
          beforeSecondWheel.length,
        ),
      },
      null,
      2,
    ),
  );

  expect(before.mouseEvents, "xterm has no mouse protocol active").toBe(true);
  expect(sent.join(""), "nothing reached the pty from the wheel").not.toBe("");
});
