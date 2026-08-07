// The work surface is the owner's terminal, and nothing from another feature
// may paint on top of it (vingilot/docs/plans/2026-08-07-panes-and-polish.md,
// Task 1c — a blue avatar badge seen floating inside the terminal area).
//
// Two independent readings, because either one alone has a blind spot:
//
//   1. Hit testing. `document.elementFromPoint` over a grid inside the work
//      surface must always land inside the work surface. This is the reading
//      that matches what a click does, and it catches anything interactive —
//      a stuck popover, a portal, a menu — regardless of how it is styled.
//      Its blind spot is `pointer-events: none`, which hit testing skips and
//      the eye does not.
//
//   2. Geometry. Every element outside the work surface whose box overlaps
//      it must either be a full-bleed layer (its box contains the whole
//      surface — the theme gradient, the burst layers) or carry no visual
//      content of its own (an empty positioning wrapper). A small box with
//      text, an image, or a canvas, sitting inside the surface but owned by
//      another feature, is exactly the badge this guards against.
//
// The terminal is made real here rather than left in its waiting state: the
// mock bridge has no home directory, so `WorkSurface` would otherwise render
// a placeholder and this spec would prove nothing about a screen with an
// xterm on it. The pty commands are stubbed to succeed and emit nothing —
// what is under test is what the app draws around the terminal, not the
// shell.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Matches RunsScreen.tsx's hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPO = {
  id: "repo-guard",
  name: "guarded",
  path: "/tmp/vingilot-guard",
};

/** The coordinator reads RunsScreen issues, answered with one project and no
 * runs — the smallest workspace that still reaches the work surface. */
async function mockCoordinator(page: Page) {
  await page.route(`${COORDINATOR_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (method === "GET" && url.pathname === `/v1/workspaces/${WORKSPACE_ID}`) {
      return route.fulfill({
        json: {
          revision: 1,
          state: { repos: [REPO] },
          state_hash: "mock-state-hash",
        },
      });
    }
    if (
      method === "GET" &&
      url.pathname === `/v1/workspaces/${WORKSPACE_ID}/runs`
    ) {
      return route.fulfill({ json: { runs: [] } });
    }
    if (
      method === "GET" &&
      url.pathname === `/v1/workspaces/${WORKSPACE_ID}/worktrees`
    ) {
      return route.fulfill({ json: { worktrees: [] } });
    }
    return route.fulfill({
      json: { detail: `unmocked route: ${url.pathname}`, error: "not_found" },
      status: 404,
    });
  });
}

/** Answers the two Tauri surfaces the terminal needs — the home directory a
 * worktree cwd derives from, and the pty commands themselves — so an xterm
 * really mounts. Everything else falls through to the mock bridge. */
async function stubTerminalBackend(page: Page) {
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

test.describe("the work surface carries nothing from another feature", () => {
  test("no foreign element paints over the terminal", async ({ page }) => {
    await installMockBridge(page);
    await mockCoordinator(page);
    await page.goto("/#/workspace");
    await expect(page.getByTestId("runs-screen")).toBeVisible();

    // The home-dir lookup runs once, on RunsScreen's mount — so the stub has
    // to be in place before the screen that reads it mounts. Leaving and
    // returning is what re-runs it.
    await stubTerminalBackend(page);
    await page.goto("/#/");
    await page.goto("/#/workspace");

    await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
    await expect(page.getByTestId("work-surface")).toBeVisible();
    await expect(page.locator(".xterm").first()).toBeVisible();

    const findings = await page.evaluate(() => {
      const surface = document.querySelector('[data-testid="work-surface"]');
      if (surface === null) return ["no work surface"];
      const box = surface.getBoundingClientRect();
      const problems: string[] = [];

      function describe(el: Element): string {
        const testId = el.getAttribute("data-testid");
        const rect = el.getBoundingClientRect();
        return `<${el.tagName.toLowerCase()}${testId ? ` data-testid="${testId}"` : ""} class="${String(el.className).slice(0, 80)}"> at ${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
      }

      // 1. Hit testing, on a grid dense enough that a 20px badge cannot slip
      // between samples.
      const step = 16;
      for (let x = box.left + 4; x < box.right - 4; x += step) {
        for (let y = box.top + 4; y < box.bottom - 4; y += step) {
          const top = document.elementFromPoint(x, y);
          if (top === null || surface.contains(top)) continue;
          problems.push(
            `hit test at ${Math.round(x)},${Math.round(y)} landed on ${describe(top)}`,
          );
          // One report per offender is enough; a full grid of the same
          // element would bury everything else.
          return problems;
        }
      }

      // 2. Geometry.
      const VISUAL_TAGS = new Set(["IMG", "SVG", "CANVAS", "VIDEO"]);
      for (const el of document.querySelectorAll("body *")) {
        if (surface.contains(el) || el.contains(surface)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const overlaps =
          rect.left < box.right &&
          rect.right > box.left &&
          rect.top < box.bottom &&
          rect.bottom > box.top;
        if (!overlaps) continue;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.opacity === "0") continue;

        const fullBleed =
          rect.left <= box.left &&
          rect.right >= box.right &&
          rect.top <= box.top &&
          rect.bottom >= box.bottom;
        if (fullBleed) continue;

        const ownText =
          el.childElementCount === 0 && (el.textContent ?? "").trim() !== "";
        const ownGraphic = VISUAL_TAGS.has(el.tagName);
        if (!ownText && !ownGraphic) continue;

        problems.push(
          `overlapping element with its own content: ${describe(el)}`,
        );
      }

      return problems;
    });

    expect(findings).toEqual([]);
  });
});
