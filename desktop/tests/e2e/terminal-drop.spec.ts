// What a Finder file drop onto the terminal actually sends to the pty, and the
// proof the other in-app drop targets still read a dropped file after the
// window's native drop was turned on (vingilot/seams/drag-and-drop.yaml).
//
// **Why the drop is synthesized, not dragged.** A real OS drag from Finder
// cannot be issued from a browser, and on macOS the drop the product cares
// about arrives on `getCurrentWebview().onDragDropEvent`, not the DOM. So the
// spec emits exactly the Tauri events that native layer would emit —
// `tauri://drag-enter` / `-drag-drop` with the OS's own `{ paths, position }`
// payload — through the app-installed mock bridge's own emitter. Everything
// downstream is the product: the real routing (`lib/nativeDrop.ts`), the real
// `Terminal`, the real xterm, the real `pty_write` client. Only the IPC
// transport is a recorder, so what is observed is what would have crossed it —
// the same discipline `terminal-wheel.spec.ts` states.
//
// **The escaping is not re-implemented here.** `shellEscapePath` is unit-tested
// exhaustively in `features/runs/lib/shellEscape.test.mjs`; this asserts only
// that a path with a space arrives wrapped so the shell reads it as one
// argument, and that a drop ends in a space and never a newline (an inserted
// line is the owner's to run — a drop that ran itself could run anything).

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPO = {
  id: "repo-drop",
  name: "vingilot",
  path: "/tmp/vingilot-drop",
};

interface DropProbe {
  /** Every `pty_write` payload, in order. */
  writes: string[];
  /** The session id the terminal opened. */
  session: string | null;
}

declare global {
  interface Window {
    __DROP_PROBE__: DropProbe;
    __BUZZ_E2E_EMIT_TAURI_EVENT__?: (event: string, payload: unknown) => void;
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

/** Record `pty_write` and the opened session; let everything else — crucially
 * `plugin:event|listen`/`|emit`, which is how `onDragDropEvent` subscribes and
 * how this spec emits — pass through to the mock bridge untouched. */
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

    const probe: DropProbe = { session: null, writes: [] };
    window.__DROP_PROBE__ = probe;

    internals.invoke = (cmd, args, opts) => {
      const name = String(cmd);
      const payload = (args ?? {}) as Record<string, string>;
      if (name.startsWith("plugin:path|")) return Promise.resolve("/tmp/home/");
      if (name === "pty_backing") return Promise.resolve("tmux");
      if (name === "pty_open") {
        probe.session = payload.session;
        void passThrough("plugin:event|emit", {
          event: "vingilot://pty",
          payload: { data: "", replay: true, seq: 0, session: payload.session },
        });
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

async function openWorkspaceTerminal(page: Page) {
  await page.setViewportSize({ height: 900, width: 1700 });
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await recordPty(page);
  // The home-dir lookup runs on RunsScreen's mount, so the recorder must be in
  // place before the screen that reads it mounts (terminal-wheel.spec.ts makes
  // the same trip).
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();
  const screen = page.locator(".xterm-screen").first();
  await expect(screen).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__DROP_PROBE__.session))
    .not.toBeNull();
  return screen;
}

/** The centre of the terminal, in the physical pixels a native drop carries.
 * Playwright's default device scale factor is 1, so client and physical
 * coincide — and `lib/nativeDrop.ts` divides by `devicePixelRatio` regardless,
 * exercised at 1:1 here and proven at 2:1 by the unit test. */
async function terminalCentre(page: Page) {
  const box = await page.locator(".xterm-screen").first().boundingBox();
  if (box === null) throw new Error("the terminal has no box to drop on");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function emitDrag(
  page: Page,
  type: "enter" | "drop" | "leave",
  detail: { paths?: string[]; position?: { x: number; y: number } },
) {
  await page.evaluate(
    ({ type, detail }) => {
      const name =
        type === "enter"
          ? "tauri://drag-enter"
          : type === "drop"
            ? "tauri://drag-drop"
            : "tauri://drag-leave";
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(name, detail);
    },
    { type, detail },
  );
}

async function writesAfter(page: Page, from: number) {
  await page.waitForTimeout(200);
  return page.evaluate(
    (start) => window.__DROP_PROBE__.writes.slice(start),
    from,
  );
}

test("a file dropped on the terminal is inserted at the cursor, shell-escaped", async ({
  page,
}) => {
  await openWorkspaceTerminal(page);
  const at = await terminalCentre(page);
  const before = await page.evaluate(() => window.__DROP_PROBE__.writes.length);

  await emitDrag(page, "drop", {
    paths: ["/Users/y/My Documents/report v2.pdf"],
    position: at,
  });

  const written = (await writesAfter(page, before)).join("");
  // Wrapped so the space in the name is one argument, and ending in a space —
  // never a newline — so the line is inserted, not run.
  expect(written).toBe("'/Users/y/My Documents/report v2.pdf' ");
});

test("several files arrive space-separated, each escaped", async ({ page }) => {
  await openWorkspaceTerminal(page);
  const at = await terminalCentre(page);
  const before = await page.evaluate(() => window.__DROP_PROBE__.writes.length);

  await emitDrag(page, "drop", {
    paths: ["/tmp/a b.txt", "/tmp/it's.log"],
    position: at,
  });

  const written = (await writesAfter(page, before)).join("");
  expect(written).toBe("'/tmp/a b.txt' '/tmp/it'\\''s.log' ");
});

test("the terminal shows a drop affordance while a file hovers it, and only then", async ({
  page,
}) => {
  await openWorkspaceTerminal(page);
  const at = await terminalCentre(page);
  const session = await page.evaluate(() => window.__DROP_PROBE__.session);
  const affordance = page.getByTestId(`terminal-drop-target-${session}`);

  await expect(affordance).toBeHidden();
  await emitDrag(page, "enter", { paths: ["/tmp/x.txt"], position: at });
  await expect(affordance).toBeVisible();
  // A drag that leaves without dropping takes the affordance with it and writes
  // nothing to the pty.
  const before = await page.evaluate(() => window.__DROP_PROBE__.writes.length);
  await emitDrag(page, "leave", {});
  await expect(affordance).toBeHidden();
  expect(await writesAfter(page, before)).toEqual([]);
});

test("a drop outside the terminal does not reach the pty", async ({ page }) => {
  await openWorkspaceTerminal(page);
  const before = await page.evaluate(() => window.__DROP_PROBE__.writes.length);

  // Top-left of the window is the sidebar/chrome, not the terminal — no zone
  // owns it, so the drop routes to nobody.
  await emitDrag(page, "drop", {
    paths: ["/tmp/stray.txt"],
    position: { x: 4, y: 4 },
  });

  expect(await writesAfter(page, before)).toEqual([]);
});

test("the composer still reads a dropped file after the flag flip", async ({
  page,
}) => {
  // The preserved blob target. With native drop on, the composer's HTML5
  // `onDrop` no longer fires in the real app; the new native path must read the
  // dropped file back to bytes through `vingilot_drop_read` and hand it to the
  // same uploader. Proving that read happens with the dropped path is proving
  // the target survived the flip.
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  const composer = page.getByTestId("message-composer");
  await expect(composer).toBeVisible();

  const reads = await page.evaluate(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
        };
      }
    ).__TAURI_INTERNALS__;
    const passThrough = internals.invoke.bind(internals);
    const seen: string[] = [];
    (window as unknown as { __DROP_READS__: string[] }).__DROP_READS__ = seen;
    internals.invoke = (cmd, args, opts) => {
      if (String(cmd) === "vingilot_drop_read") {
        seen.push((args as { path: string }).path);
        // A one-byte PNG-ish blob is enough; the uploader is the untouched
        // HTML5 code path and is not what this test is proving.
        return Promise.resolve([0x89]);
      }
      return passThrough(cmd, args, opts);
    };
    return seen;
  });
  expect(reads).toEqual([]);

  const box = await composer.boundingBox();
  if (box === null) throw new Error("the composer has no box to drop on");
  const position = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Re-emit until the read lands: onDragDropEvent subscribes asynchronously on
  // the composer's first mount, and a single fire-and-forget drop emitted
  // before that subscription resolves is simply not received (there is no
  // listener yet to route it). Re-emitting is safe — the assertion is that the
  // dropped path was read at least once, so a duplicate read cannot fail it.
  await expect
    .poll(async () => {
      await emitDrag(page, "drop", { paths: ["/Users/y/photo.png"], position });
      return page.evaluate(
        () =>
          (window as unknown as { __DROP_READS__: string[] }).__DROP_READS__
            .length,
      );
    })
    .toBeGreaterThan(0);

  const landed = await page.evaluate(
    () => (window as unknown as { __DROP_READS__: string[] }).__DROP_READS__,
  );
  expect(landed).toContain("/Users/y/photo.png");
});
