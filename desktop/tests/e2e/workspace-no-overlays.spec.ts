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

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

// Matches RunsScreen.tsx's hardcoded dev workspace id.
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";

const REPO = {
  id: "repo-guard",
  name: "guarded",
  path: "/tmp/vingilot-guard",
};

/** Every pane the right slot can hold here, with what has to be on screen
 * before the surface is worth auditing. Evidence is absent because it is
 * genuinely unavailable in this workspace — no run owns this worktree, so
 * there is no transcript — and the picker refuses it. That refusal is asserted
 * below rather than worked around. */
const PANES: Array<{ key: string; ready: string }> = [
  { key: "diff", ready: '[data-testid="pane-diff"]' },
  { key: "agent", ready: '[data-testid="pane-agent"]' },
  { key: "runs", ready: '[data-testid="pane-runs"]' },
];

/** A second worktree nobody's run made — the common case the reviewer's
 * failure used: the main checkout plus one the owner created by hand. It is
 * what makes a worktree *switch* possible at all in this workspace. */
const SECOND_WORKTREE = {
  added: null,
  base_commit: "0".repeat(40),
  binding_id: "wt-hand-made",
  branch: "spike",
  commit_sha: null,
  lifecycle: "active",
  owner_run_id: null,
  owner_run_objective: null,
  owner_run_status: null,
  removed: null,
  repo_id: REPO.id,
  role: "task",
};

/** The coordinator reads RunsScreen issues, answered with one project and no
 * runs — the smallest workspace that still reaches the work surface. */
async function mockCoordinator(page: Page, worktrees: unknown[] = []) {
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
      return route.fulfill({ json: { worktrees } });
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

/** Put a pane in the right slot, waiting out the menu on both sides of the
 * click — Radix animates it in and out, and a choice clicked mid-animation is
 * a click on a moving target. */
async function choosePane(page: Page, key: string) {
  const picker = page.getByTestId("pane-picker");
  await picker.click();
  await expect(picker).toHaveAttribute("data-state", "open");
  await waitForAnimations(page);
  await page.getByTestId(`pane-choice-${key}`).click();
  await expect(picker).toHaveAttribute("data-state", "closed");
  await waitForAnimations(page);
}

/** Both readings over whatever the work surface currently shows. Returns one
 * line per offender, empty when the surface is clean. */
async function auditSurface(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const surface = document.querySelector('[data-testid="work-surface"]');
    if (surface === null) return ["no work surface"];
    const box = surface.getBoundingClientRect();
    const problems: string[] = [];

    // `className` is a plain string only on HTML elements; on an SVG it is an
    // SVGAnimatedString, which stringifies to "[object SVGAnimatedString]" and
    // names nothing. The attribute reads the same on both.
    function describe(el: Element): string {
      const testId = el.getAttribute("data-testid");
      const cls = el.getAttribute("class") ?? "";
      const rect = el.getBoundingClientRect();
      return `<${el.tagName.toLowerCase()}${testId ? ` data-testid="${testId}"` : ""} class="${cls.slice(0, 80)}"> at ${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
    }

    // 1. Hit testing. A box is only guaranteed a sample when it is larger than
    // the step in both axes, so the step has to sit below the smallest thing
    // worth catching: lucide's default icon is `h-4 w-4` — 16px — and the app
    // renders it in 264 places.
    const step = 8;
    for (let x = box.left + 4; x < box.right - 4; x += step) {
      for (let y = box.top + 4; y < box.bottom - 4; y += step) {
        const top = document.elementFromPoint(x, y);
        if (top === null || surface.contains(top)) continue;
        // Upstream's own sidebar rail (`data-sidebar="rail"`, shared/ui/
        // sidebar.tsx) straddles the sidebar's right border by design — a
        // 16px hover strip translated half over whatever stands beside it,
        // the same affordance every screen in the app lives with. Since the
        // single-sidebar rework removed the nav column that used to absorb
        // that half, the surface's left edge is the rail's neighbor now; the
        // rail is the app's own chrome, not a foreign element.
        if (top.closest('[data-sidebar="rail"]') !== null) continue;
        problems.push(
          `hit test at ${Math.round(x)},${Math.round(y)} landed on ${describe(top)}`,
        );
        // One report per offender is enough; a full grid of the same
        // element would bury everything else.
        return problems;
      }
    }

    // 2. Geometry. `tagName` uppercases for HTML elements only — an SVG
    // reports lowercase "svg", so an uppercase set silently excluded every
    // icon in the app, which is the exact shape a stray badge has.
    const VISUAL_TAGS = new Set(["IMG", "IMAGE", "SVG", "CANVAS", "VIDEO"]);
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
      const ownGraphic = VISUAL_TAGS.has(el.tagName.toUpperCase());
      if (!ownText && !ownGraphic) continue;

      problems.push(
        `overlapping element with its own content: ${describe(el)}`,
      );
    }

    return problems;
  });
}

test.describe("the work surface carries nothing from another feature", () => {
  test("no foreign element paints over any of its panes", async ({ page }) => {
    // Wide enough that the work surface can hold a split. Playwright's default
    // 1280×720 leaves it 555px, which `effectiveSolo` correctly renders as the
    // terminal alone with the right pane railed — so a test about the panes
    // beside each other has to ask for a window that fits them.
    await page.setViewportSize({ height: 900, width: 1700 });
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

    // The terminal is the left pane and the one the badge was seen over, and
    // it is on screen throughout — so every reading below is a reading of the
    // terminal *and* of whatever is beside it. A pane that only misbehaves on
    // Diff is the same bug, so each one gets both readings.
    await expect(page.locator(".xterm").first()).toBeVisible();
    expect(await auditSurface(page), "terminal").toEqual([]);

    const picker = page.getByTestId("pane-picker");
    for (const pane of PANES) {
      await picker.click();
      await page.getByTestId(`pane-choice-${pane.key}`).click();
      await expect(page.locator(pane.ready).first()).toBeVisible();
      // The picker's own menu overlaps the surface by design, and it leaves on
      // an animation that outlives the pane appearing — auditing before it has
      // gone would report the menu the owner just used as a foreign overlay.
      await expect(picker).toHaveAttribute("data-state", "closed");
      await waitForAnimations(page);
      expect(await auditSurface(page), `${pane.key} pane`).toEqual([]);
    }

    // A pane whose backing is missing is offered and refused, with the reason
    // on it. Vanishing from the picker would read as a bug in the picker, and
    // rendering empty would read as a run with nothing in it.
    await picker.click();
    const evidence = page.getByTestId("pane-choice-evidence");
    await expect(evidence).toHaveAttribute("aria-disabled", "true");
    await expect(evidence).toContainText("no run owns this worktree");
    await page.keyboard.press("Escape");
    await expect(picker).toHaveAttribute("data-state", "closed");
    await waitForAnimations(page);
    expect(await auditSurface(page), "picker closed").toEqual([]);

    // Hidden and brought back: the collapsed surface is a render of its own,
    // and the rail that restores it is the only way back that does not need a
    // shortcut remembered.
    await page.getByTestId("pane-right-collapse").click();
    await expect(page.getByTestId("pane-right-rail")).toBeVisible();
    expect(await auditSurface(page), "collapsed").toEqual([]);
    // And focus came with it. Collapsing unmounts the control that did the
    // collapsing, which drops focus to <body> — from there a keyboard owner
    // has to Tab from the top of the document to reach anything at all, which
    // makes the rail exactly the trap it exists to prevent.
    await expect(page.getByTestId("pane-right-expand")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("pane-divider")).toBeVisible();
    await expect(page.getByTestId("pane-divider")).toBeFocused();
  });

  test("work in the right pane survives the terminal's shortcuts and a worktree switch", async ({
    page,
  }) => {
    // Wide enough to hold a split; see the note on the first test.
    await page.setViewportSize({ height: 900, width: 1700 });
    await installMockBridge(page);
    await mockCoordinator(page, [SECOND_WORKTREE]);
    await page.goto("/#/workspace");
    await expect(page.getByTestId("runs-screen")).toBeVisible();
    await stubTerminalBackend(page);
    await page.goto("/#/");
    await page.goto("/#/workspace");

    await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
    await expect(page.getByTestId("work-surface")).toBeVisible();

    const runsPane = page.getByTestId("pane-runs");
    // Runs on the right in *both* worktrees. The arrangement is per worktree,
    // so a switch that changed which pane is showing would prove nothing about
    // what a switch costs the pane that stays.
    const second = page.getByTestId(
      `worktree-row-${SECOND_WORKTREE.binding_id}`,
    );
    await second.click();
    await choosePane(page, "runs");
    await expect(runsPane).toBeVisible();
    await page.getByTestId(`worktree-row-main:${REPO.id}`).click();
    await choosePane(page, "runs");
    await expect(runsPane).toBeVisible();

    const objective = runsPane.getByLabel("objective");
    await objective.click();
    await objective.fill("fix the login redirect");

    // The two sides are co-visible, so a text field and the terminal are on
    // screen at once for the first time. ⌥⌘→ with the cursor here used to step
    // the terminal's tabs and yank focus into the xterm; ⇧⌘W closed a tab,
    // which under tmux ends its session.
    await page.keyboard.press("Alt+Meta+ArrowRight");
    await expect(objective).toBeFocused();
    await page.keyboard.press("Shift+Meta+KeyW");
    await expect(objective).toBeFocused();
    await expect(objective).toHaveValue("fix the login redirect");

    // And the pane is not re-taken on a worktree switch: the Runs pane reads
    // the workspace, not the worktree under it, and its registry row says so.
    // Keyed by the worktree, this field came back empty.
    await second.click();
    await expect(runsPane).toBeVisible();
    await expect(objective).toHaveValue("fix the login redirect");
  });
});
