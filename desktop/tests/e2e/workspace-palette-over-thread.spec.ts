// ⌘K is the top of the workspace, including over a hosted channel surface
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 1).
//
// > *"team chat açıkken cmd k yaparsam bazı şeyler cmd k'nın önüne geliyor,
// > textler"*
//
// **What was painting over it, named.** The palette is `absolute inset-0 z-30`
// inside `RunsScreen`'s work-surface box — positioned rather than portalled on
// purpose, so it covers the surface he is working on and not the chrome he is
// not. `position: relative` with `z-index: auto` creates *no stacking context*,
// and measured at 1728×1117 with a team thread open, neither did anything
// between that box and the hosted channel: `work-surface`, the dock,
// `pane-team`, `team-thread-inset`, `team-thread` and `channel-drop-zone` were
// every one of them `z-index: auto`, no transform, no isolation. So the channel
// surface's own layers were not pane-local numbers at all — they were entries
// in the same stacking context as the palette, and two of them outrank it:
//
//   - `ChannelPane`'s top chrome, `absolute inset-x-0 z-40`, which is the
//     stacking context holding `chat-header` and its backdrop;
//   - `channel-composer-overlay`, `absolute inset-x-0 bottom-0 z-40 isolate`.
//
// Both z-40 against the palette's z-30, both therefore drawn over its scrim —
// the header text and the composer floating undimmed above an open palette,
// which is exactly the "textler" he saw.
//
// **So the fix is not to raise the palette.** Raising it to z-50 would have
// worked until the next hosted surface arrived with a z-index of its own. What
// this asserts is the property that makes the class of bug impossible: a pane
// is a stacking context, so a number inside a pane is a number about the pane.
// The sweep below is deliberately not "the header is behind the scrim" — it is
// "nothing anywhere in the pane is in front of the palette", which is the claim
// a later surface has to keep.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
const REPO = { id: "repo-over", name: "vingilot", path: "/tmp/vingilot-over" };

/** The 16-inch MacBook Pro's default logical resolution — the geometry the
 * report came from, and the one that makes the pane narrow enough that the
 * channel's chrome is a large fraction of it. */
const SIXTEEN_INCH = { height: 1117, width: 1728 };

const PERSONAS = [
  { displayName: "Planner", id: "persona-planner", systemPrompt: "Plan it." },
  { displayName: "Builder", id: "persona-builder", systemPrompt: "Build it." },
];

const TEAM = {
  description: "Plans and builds.",
  id: "team-launch",
  name: "Launch Team",
  personaIds: ["persona-planner", "persona-builder"],
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
    if (url.pathname.endsWith("/runs")) {
      return route.fulfill({ json: { runs: [] } });
    }
    if (url.pathname.endsWith("/worktrees")) {
      return route.fulfill({ json: { worktrees: [] } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });
}

async function stubBackend(page: Page) {
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
      if (name.startsWith("plugin:path|")) return Promise.resolve("/tmp/home/");
      if (name === "pty_backing") return Promise.resolve("tmux");
      if (name.startsWith("pty_")) return Promise.resolve(null);
      return passThrough(cmd, args, opts);
    };
  });
}

/** Put a pane on the dock: the four with a fixed tab (files/diff/history, and
 * team under its "crew" tab) light their tab directly (`dock.spec.ts`'s
 * idiom); anything else has no tab and is chosen from the palette — the
 * dock's only door onto it (`dockModel.ts`). */
async function choosePane(page: Page, key: string) {
  const tab = key === "team" ? "crew" : key;
  if (
    tab === "crew" ||
    tab === "diff" ||
    tab === "files" ||
    tab === "history"
  ) {
    await page.getByTestId(`dock-tab-${tab}`).click();
    return;
  }
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.getByTestId("palette-input").fill(key);
  await page.getByTestId(`palette-row-pane:${key}`).click();
  await expect(page.getByTestId("palette")).toHaveCount(0);
  await waitForAnimations(page);
}

/** The work surface with a team thread open in the right pane — upstream's
 * channel screen hosted inside a pane, which is the surface this is about. */
async function openTeamThread(page: Page) {
  await page.setViewportSize(SIXTEEN_INCH);
  await installMockBridge(page, { personas: PERSONAS, teams: [TEAM] });
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  await stubBackend(page);
  await page.goto("/#/");
  await page.goto("/#/workspace");
  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();

  await choosePane(page, "team");
  await expect(page.getByTestId("team-choice")).toBeVisible();
  await page.getByTestId(`team-choice-${TEAM.id}`).click();
  await page.getByTestId("team-open").click();
  await expect(
    page.getByTestId("team-thread").getByTestId("message-composer"),
  ).toBeVisible({ timeout: 20_000 });
}

/** Every element that is painted in front of the open palette somewhere over
 * the pane, sampled on a grid across the pane's whole box.
 *
 * `elementsFromPoint` answers front-to-back, so "in front of the palette" is
 * "appears before the palette's overlay in that list". Anything belonging to
 * the palette itself is excluded — the palette drawing over its own scrim is
 * the palette working. */
async function inFrontOfThePalette(page: Page) {
  return page.evaluate(() => {
    const overlay = document.querySelector(
      '[data-testid="palette-scrim"]',
    )?.parentElement;
    const pane = document.querySelector('[data-testid="dock"]');
    if (overlay === null || overlay === undefined) return ["no palette"];
    if (pane === null) return ["no right pane"];
    const box = pane.getBoundingClientRect();
    const found: string[] = [];
    const step = 12;
    for (let y = box.top + 2; y < box.bottom - 2; y += step) {
      for (let x = box.left + 2; x < box.right - 2; x += step) {
        const stack = document.elementsFromPoint(x, y);
        const at = stack.findIndex(
          (element) => element === overlay || overlay.contains(element),
        );
        if (at <= 0) continue;
        for (let i = 0; i < at; i += 1) {
          const element = stack[i] as HTMLElement;
          const name = `${element.tagName.toLowerCase()}${
            element.dataset?.testid === undefined
              ? ""
              : `[${element.dataset.testid}]`
          } z=${getComputedStyle(element).zIndex}`;
          if (!found.includes(name)) found.push(name);
        }
      }
    }
    return found;
  });
}

test("nothing in the team thread is painted over the palette", async ({
  page,
}) => {
  await openTeamThread(page);

  // The two z-40 layers this is about are really there and really over the
  // pane — asserted so that a channel surface which stopped drawing them would
  // make this spec say so rather than pass by vacancy.
  const chrome = await page.evaluate(() => {
    const pane = document.querySelector('[data-testid="dock"]');
    if (pane === null) return [];
    return Array.from(pane.querySelectorAll("*"))
      .filter((element) => {
        const z = Number(getComputedStyle(element).zIndex);
        return Number.isFinite(z) && z >= 40;
      })
      .map((element) => (element as HTMLElement).dataset?.testid ?? "unnamed");
  });
  expect(chrome).toContain("channel-composer-overlay");
  expect(chrome.length).toBeGreaterThanOrEqual(2);

  await page.keyboard.press("Meta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await waitForAnimations(page);

  // The whole claim, in one reading: over the pane's entire box, the palette is
  // the top layer. Before the fix this answered with the channel header, its
  // title, its buttons, the composer's footer and the composer form itself.
  expect(await inFrontOfThePalette(page)).toEqual([]);

  // And it is not merely on top, it is reachable: the scrim answers a click at
  // a point over the thread's own header, which is where the header used to be
  // the thing under the pointer.
  const headerBox = await page
    .getByTestId("dock")
    .getByTestId("chat-header")
    .boundingBox();
  expect(headerBox).not.toBeNull();
  const box = headerBox as {
    height: number;
    width: number;
    x: number;
    y: number;
  };
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("palette")).toHaveCount(0);
});
