// **The DM sheet over the work surface** — redesign P6, the mockup's `#dmsheet`
// and `#dmpill` (Vingilot.html:496-510, `vingilot.js:31-34`).
//
// Everything asserted here is a claim the unit tests in
// `src/features/runs/lib/dmSheet.test.mjs` cannot make. That file holds the
// three states and the presence sentence as values; this one holds the facts
// that only a real app can answer:
//
// - a DM row on the workspace paints a sheet and does NOT navigate (the URL is
//   the assertion, not a class),
// - the sheet is not a modal — the work surface underneath keeps its own
//   keyboard, and the strips' chords stay refused while the caret is in the
//   composer by `typingTarget.ts`'s existing predicate (P4.5), which is a fact
//   about a real keydown through three claimants,
// - **minimize is not close**: what was typed survives the pill, which is only
//   true because the surface is hidden rather than unmounted,
// - a conversation with nothing in it says so, in the app's own words,
// - and none of these acts touches a pty. The probe records every `pty_*`
//   invoke; the sheet's four acts must add none.

import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const COORDINATOR_ORIGIN = "http://127.0.0.1:8787";
const WORKSPACE_ID = "default";
const REPO = { id: "repo-dm", name: "vingilot", path: "/tmp/vingilot-dm" };

/** The mock bridge's DM with alice — no channel messages of its own, which is
 * exactly the honest-empty case this spec wants. */
const DM_ROW = "channel-alice-tyler";

type TrapWindow = Window & {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args?: unknown, opts?: unknown) => unknown;
  };
  __DM_PTY_PROBE__: string[];
};

async function openWorkspace(page: Page) {
  await page.setViewportSize({ height: 900, width: 1600 });
  await installMockBridge(page);
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
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`) {
      return route.fulfill({ json: { worktrees: [] } });
    }
    if (url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`) {
      return route.fulfill({ json: { runs: [] } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });

  // Every `pty_*` the app asks for, in order. Requirement: the sheet adds none.
  await page.addInitScript(() => {
    const w = window as unknown as TrapWindow;
    const probe: string[] = [];
    w.__DM_PTY_PROBE__ = probe;
    let fallback:
      | ((cmd: string, args?: unknown, opts?: unknown) => unknown)
      | null = null;
    const invoke = (cmd: string, args?: unknown, opts?: unknown): unknown => {
      const name = String(cmd);
      if (name.startsWith("pty_")) {
        probe.push(name);
        if (name === "pty_backing") return Promise.resolve("tmux");
        if (name === "pty_copy_mode") return Promise.resolve(false);
        return Promise.resolve(null);
      }
      if (name === "worktree_list") return Promise.resolve([]);
      if (fallback === null)
        return Promise.reject(new Error(`no host for ${name}`));
      return fallback(cmd, args, opts);
    };
    const internals = (w.__TAURI_INTERNALS__ ??
      {}) as TrapWindow["__TAURI_INTERNALS__"];
    w.__TAURI_INTERNALS__ = internals;
    Object.defineProperty(internals, "invoke", {
      configurable: true,
      get: () => invoke,
      set: (fn: (cmd: string, args?: unknown, opts?: unknown) => unknown) => {
        fallback = fn;
      },
    });
  });

  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
}

/** The sheet's composer is upstream's own — the same rich-text field the
 * channel route mounts, found inside the sheet rather than forked into it. */
function sheetComposer(page: Page) {
  return page.getByTestId("dm-sheet").locator('[contenteditable="true"]');
}

async function openDm(page: Page) {
  await page.getByTestId(DM_ROW).click();
  await expect(page.getByTestId("dm-sheet")).toBeVisible();
}

test("a direct message opens as a sheet over the work, not as a route", async ({
  page,
}) => {
  await openWorkspace(page);
  await openDm(page);

  // The mockup's own corner: bottom-right of the surface, above the bar.
  const sheet = page.getByTestId("dm-sheet");
  const box = await sheet.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (!viewport) return;
  expect(box.width).toBe(360);
  expect(viewport.width - (box.x + box.width)).toBeLessThan(24);
  expect(viewport.height - (box.y + box.height)).toBeLessThan(80);

  // Not a route change: the workspace is still what the app is showing, and
  // the work surface is still on screen under the sheet.
  expect(page.url()).toContain("/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();

  // The name is the sidebar's name for the same conversation, not a second
  // reading of it.
  const sheetName = (
    await page.getByTestId("dm-sheet-name").innerText()
  ).trim();
  expect(sheetName.length).toBeGreaterThan(0);
  expect((await page.getByTestId(DM_ROW).innerText()).trim()).toContain(
    sheetName,
  );

  // Not a modal: it traps nothing, so the surface underneath is still
  // reachable with the mouse and still owns its own focus.
  await expect(page.locator("[data-radix-focus-guard]")).toHaveCount(0);
});

test("the sheet says what it knows: a presence line, and an empty conversation that admits it", async ({
  page,
}) => {
  await openWorkspace(page);
  await openDm(page);

  // The presence slot is never blank and never a persona: it is the socket's
  // word or the other side's, and both are real readings.
  const presence = page.getByTestId("dm-sheet-presence");
  await expect(presence).toBeVisible();
  await expect(presence).toHaveText(
    /(online|away|offline|not connected|connecting|direct message)/,
  );

  // A conversation with no messages says so rather than painting a blank
  // scroller that reads as "nothing new". The words are upstream's own empty
  // state — the sheet did not invent a second set.
  const body = page.getByTestId("dm-sheet-body");
  await expect(body).toBeVisible();
  await expect(body.getByTestId("message-dm-intro")).toBeVisible();
  await expect(body).toContainText(
    "This is the beginning of your direct message with",
  );

  // And the sheet's own header is the only name on it: the hosted surface's
  // header would have been a second copy of it three rows down.
  await expect(body.getByTestId("chat-header")).not.toBeVisible();

  await waitForAnimations(page);
  await page.getByTestId("dm-sheet").screenshot({
    path: "test-results/p6-shots/02-dm-sheet-honest-empty.png",
  });
});

test("minimize keeps the draft, restore brings it back, close is a different act", async ({
  page,
}) => {
  await openWorkspace(page);
  await openDm(page);

  const composer = sheetComposer(page);
  await composer.click();
  await composer.pressSequentially("half a sentence I am not finished with");
  await expect(composer).toContainText(
    "half a sentence I am not finished with",
  );

  await waitForAnimations(page);
  await page.getByTestId("dm-sheet").screenshot({
    path: "test-results/p6-shots/01-dm-sheet-open.png",
  });

  // Minimize: the sheet goes, the pill arrives, and it still knows whose
  // conversation this is.
  const name = await page.getByTestId("dm-sheet-name").innerText();
  await page.getByTestId("dm-minimize").click();
  await expect(page.getByTestId("dm-sheet")).not.toBeVisible();
  const pill = page.getByTestId("dm-pill");
  await expect(pill).toBeVisible();
  await expect(page.getByTestId("dm-pill-name")).toHaveText(name.trim());

  await waitForAnimations(page);
  await pill.screenshot({ path: "test-results/p6-shots/03-dm-pill.png" });

  // Restore: the same conversation, and the words are still in the composer.
  await pill.click();
  await expect(page.getByTestId("dm-sheet")).toBeVisible();
  await expect(page.getByTestId("dm-pill")).toHaveCount(0);
  await expect(sheetComposer(page)).toContainText(
    "half a sentence I am not finished with",
  );

  // Close is the other button, and it dismisses both.
  await page.getByTestId("dm-close").click();
  await expect(page.getByTestId("dm-sheet")).toHaveCount(0);
  await expect(page.getByTestId("dm-pill")).toHaveCount(0);
  expect(page.url()).toContain("/workspace");
});

test("a caret in the sheet's composer keeps the strips' chords from firing", async ({
  page,
}) => {
  await openWorkspace(page);
  await openDm(page);

  const composer = sheetComposer(page);
  await composer.click();
  await composer.pressSequentially("typing, not commanding");

  // ⌘\ is the dock's float↔right toggle and ⇧⌘\ is the tab split; both are
  // answered by a window listener that P4.5 taught to refuse a text field.
  // Nothing about the workspace may move while this caret is where it is.
  const before = await page.getByTestId("runs-screen").innerText();
  await page.keyboard.press("Meta+\\");
  await page.keyboard.press("Shift+Meta+\\");
  await page.keyboard.press("Meta+t");
  await expect(page.getByTestId("dock-float")).toHaveCount(0);
  expect(await page.getByTestId("runs-screen").innerText()).toBe(before);
  await expect(composer).toContainText("typing, not commanding");

  // Escape belongs to whatever already owned it: the sheet claims no key, so
  // it is still here and still holding the draft.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("dm-sheet")).toBeVisible();
  await expect(sheetComposer(page)).toContainText("typing, not commanding");
});

test("opening, minimizing, restoring and closing the sheet touches no pty", async ({
  page,
}) => {
  await openWorkspace(page);
  const before = await page.evaluate(
    () => (window as unknown as TrapWindow).__DM_PTY_PROBE__.length,
  );

  await openDm(page);
  await page.getByTestId("dm-minimize").click();
  await expect(page.getByTestId("dm-pill")).toBeVisible();
  await page.getByTestId("dm-pill").click();
  await expect(page.getByTestId("dm-sheet")).toBeVisible();
  await page.getByTestId("dm-close").click();
  await expect(page.getByTestId("dm-sheet")).toHaveCount(0);

  const after = await page.evaluate(
    () => (window as unknown as TrapWindow).__DM_PTY_PROBE__,
  );
  expect(after.slice(before)).toEqual([]);
});

test("outside the workspace a direct message is still upstream's route", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.goto("/#/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.getByTestId(DM_ROW).click();

  // The sheet is the workspace's answer, not the app's: everywhere else the
  // whole channel surface — threads, members, profile panel — is still what a
  // DM opens.
  await expect(page.getByTestId("dm-sheet")).toHaveCount(0);
  await expect(page.getByTestId("chat-header")).toBeVisible();
});
