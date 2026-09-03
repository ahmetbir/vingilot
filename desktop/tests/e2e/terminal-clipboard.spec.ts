// The xterm half of copying (2026-09-03, "cmd c calismiyor"): an OSC 52
// sequence arriving on the pty lands on the pasteboard through the app's own
// clipboard command, and a read request gets no answer.
//
// The tmux half — that tmux actually sends the sequence when something inside
// it copies — is `src-tauri/src/vingilot_pty/live/clipboard.rs`, against a
// real tmux. This spec feeds the bytes that test proves arrive.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPO = {
  id: "repo-clipboard",
  name: "vingilot",
  path: "/tmp/vingilot-clipboard",
};

interface ClipboardProbe {
  /** Every `copy_text_to_clipboard` payload, in order. */
  copies: string[];
  /** Every `pty_write` payload — an answered read would show up here. */
  writes: string[];
  session: string | null;
}

declare global {
  interface Window {
    __CLIP_PROBE__: ClipboardProbe;
    __CLIP_PROBE_FEED__: (data: string) => void;
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

/** `terminal-wheel.spec.ts`'s recorder, with the clipboard command recorded
 * beside the pty writes. */
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

    const probe: ClipboardProbe = { copies: [], session: null, writes: [] };
    window.__CLIP_PROBE__ = probe;

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

    window.__CLIP_PROBE_FEED__ = (data: string) => {
      if (probe.session === null) throw new Error("no session opened yet");
      emitChunk({ data, replay: false, seq: seq++, session: probe.session });
    };

    internals.invoke = (cmd, args, opts) => {
      const name = String(cmd);
      const payload = (args ?? {}) as Record<string, string>;
      if (name.startsWith("plugin:path|")) return Promise.resolve("/tmp/home/");
      if (name === "pty_backing") return Promise.resolve("tmux");
      if (name === "copy_text_to_clipboard") {
        probe.copies.push(payload.text);
        return Promise.resolve(null);
      }
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

async function openTerminal(page: Page) {
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
  await expect(page.locator(".xterm-screen").first()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__CLIP_PROBE__.session))
    .not.toBeNull();
}

test("an OSC 52 write from the pty lands on the pasteboard", async ({
  page,
}) => {
  await openTerminal(page);
  // What tmux sends after a drag with `set-clipboard on`: "Hello", base64,
  // BEL-terminated. Wrapped in ordinary output so the parser is mid-stream.
  await page.evaluate(() =>
    window.__CLIP_PROBE_FEED__("prompt$ \u001b]52;c;SGVsbG8=\u0007 done\r\n"),
  );
  await expect
    .poll(() => page.evaluate(() => window.__CLIP_PROBE__.copies))
    .toEqual(["Hello"]);
  // And the sequence itself was consumed, not drawn. Polled: the DOM renderer
  // paints a frame after the parser has run, and reading the rows on the
  // same tick as the copy sees a screen that is still blank.
  const rows = page.locator(".xterm-rows").first();
  await expect(rows).toContainText("done");
  expect(await rows.innerText()).not.toContain("52;");
});

test("the ST terminator is accepted too, and UTF-8 survives", async ({
  page,
}) => {
  await openTerminal(page);
  await page.evaluate(() =>
    window.__CLIP_PROBE_FEED__("\u001b]52;c;bWVyaGFiYSBkw7xueWE=\u001b\\"),
  );
  await expect
    .poll(() => page.evaluate(() => window.__CLIP_PROBE__.copies))
    .toEqual(["merhaba dünya"]);
});

test("a clipboard READ is refused: nothing is copied and nothing is written back", async ({
  page,
}) => {
  await openTerminal(page);
  const before = await page.evaluate(() => window.__CLIP_PROBE__.writes.length);
  await page.evaluate(() => window.__CLIP_PROBE_FEED__("\u001b]52;c;?\u0007"));
  // Give a wrong implementation the time it would need to answer.
  await page.waitForTimeout(300);
  const probe = await page.evaluate(() => window.__CLIP_PROBE__);
  expect(probe.copies).toEqual([]);
  expect(probe.writes.length).toBe(before);
});
