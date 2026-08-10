// The diff fits the laptop he owns
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 1).
//
// > *"16 inch macbook pro'ya bile şu an diff sidebar sığmıyor, diff
// > görünmüyor"*
//
// **The viewport is the test.** 1728×1117 is the 16-inch MacBook Pro's default
// logical resolution, and this spec runs at it rather than at whatever width
// happens to be convenient — the whole reason the defect shipped is that it is
// invisible on a large display. Measured there before anything was changed:
//
//   window 1728 → sidebar 300 + projects rail 192 + worktree column 224
//               → work surface 1003
//               → less the 8px divider and the 752px `MIN_LEFT_PX` keeps for
//                 the terminal's 80 columns
//               → **Diff pane 243px**
//   inside it: a `w-72 shrink-0` file list of **288px**, and a patch scroller
//              with **32px** of client width against 704px of content.
//
// So there are two constraints and only one of them is wrong. `MIN_LEFT_PX` is
// the terminal's 80 columns and outranks everything on that surface for a
// reason `paneModel.ts` argues at length — a re-wrapped tmux scrollback does
// not come back — and this spec asserts it still holds. What was wrong is the
// list's fixed width, and `lib/diffLayout.ts` states the decision that replaces
// it: **the list yields.** Below the width at which both fit it stops standing
// beside the patch and becomes a drawer over it.
//
// What is proved here, and why it needs a browser: that at his width the patch
// has the pane, that nothing inside the pane is laid out wider than the pane,
// that the list is still reachable and still opens files, and that on a display
// wide enough for both the list comes back beside the patch with the patch
// still above its floor. The arithmetic itself is proved in
// `src/features/runs/lib/diffLayout.test.mjs`.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
const REPO = { id: "repo-fit", name: "vingilot", path: "/tmp/vingilot-fit" };

/** The 16-inch MacBook Pro's default logical resolution. */
const SIXTEEN_INCH = { height: 1117, width: 1728 };

/** What the owner's own move gives the pane: ⇧⌥⌘B hands the right pane the
 * whole work surface (`paneKeys.ts`), which on the same laptop is 1003px. The
 * "both fit" case is tested through that rather than through a 2800px viewport,
 * because the point is that the arrangement is reachable on the machine in
 * front of him and not only on a display he does not own.
 *
 * Worth saying why the split alone does not get there: once `MIN_LEFT_PX` is
 * satisfied the ratio is `DEFAULT_RATIO`, so a 1003px surface gives the right
 * pane 0.4 of it — 398px — and the pane would have to be 755px before the list
 * could take its preferred width beside a patch above its floor. */
const RIGHT_SOLO = "Shift+Alt+Meta+b";

/** `MIN_LEFT_PX` in `lib/paneModel.ts`: 80 columns × 9px + 32px of chrome.
 * Written out rather than imported, so this spec fails if the floor moves
 * instead of silently re-deriving the number it is asserting. */
const MIN_LEFT_PX = 752;

/** `PATCH_MIN_PX` in `lib/diffLayout.ts`, written out for the same reason. */
const PATCH_MIN_PX = 467;

/** Long enough that a patch line is a real source line rather than a token —
 * the content the 32px scroller had 704px of. */
const PATCH_LINE =
  "+export function clampRatioAt(ratio: number, surfaceWidth: number): number {";

const PATHS = [
  "desktop/src/features/runs/lib/paneModel.ts",
  "desktop/src/features/runs/ui/WorktreeDiffPanel.tsx",
  "desktop/src/features/runs/lib/diffLayout.ts",
];

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

/** The home directory a worktree cwd derives from, a terminal that mounts and
 * says nothing, and a `worktree_diff` whose answer this spec owns — what is
 * under test is a layout, so a real git would make it a property of the repo
 * this happens to run in. */
async function stubBackend(page: Page) {
  await page.evaluate(
    ({ line, paths }) => {
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
        if (name.startsWith("plugin:path|")) {
          return Promise.resolve("/tmp/home/");
        }
        if (name === "pty_backing") return Promise.resolve("tmux");
        if (name.startsWith("pty_")) return Promise.resolve(null);
        if (name === "worktree_diff") {
          return Promise.resolve({
            additions: paths.length,
            base: String((args as { base?: unknown })?.base ?? "HEAD"),
            deletions: 0,
            files: paths.map((path) => ({
              additions: 1,
              binary: false,
              change: "modified",
              deletions: 0,
              oldPath: null,
              patch: `@@ -1,2 +1,2 @@\n${line}\n   const wanted = clampRatio(ratio);\n`,
              path,
              truncated: false,
            })),
            limits: {
              maxFiles: 400,
              maxPatchBytes: 262_144,
              maxPatchLines: 2_000,
              maxUntracked: 100,
            },
            omittedFiles: 0,
            omittedUntracked: 0,
          });
        }
        return passThrough(cmd, args, opts);
      };
    },
    { line: PATCH_LINE, paths: PATHS },
  );
}

async function openDiffPane(
  page: Page,
  viewport: { height: number; width: number },
) {
  await page.setViewportSize(viewport);
  await installMockBridge(page);
  await mockCoordinator(page);
  await page.goto("/#/workspace");
  await expect(page.getByTestId("runs-screen")).toBeVisible();
  // The home-dir lookup runs once, on RunsScreen's mount, and the diff pane has
  // no cwd without it — so the stub has to be in place before the screen that
  // reads it mounts. Leaving and returning is what re-runs it.
  await stubBackend(page);
  await page.goto("/#/");
  await page.goto("/#/workspace");

  await page.getByTestId(`projects-nav-repo-${REPO.id}`).click();
  await expect(page.getByTestId("work-surface")).toBeVisible();

  const picker = page.getByTestId("pane-picker");
  await picker.click();
  await expect(picker).toHaveAttribute("data-state", "open");
  await waitForAnimations(page);
  await page.getByTestId("pane-choice-diff").click();
  await expect(picker).toHaveAttribute("data-state", "closed");
  await waitForAnimations(page);
  await expect(page.getByTestId("pane-diff")).toBeVisible();
  await expect(page.getByTestId("worktree-diff-patch")).toBeVisible();
}

/** Laid-out widths, read off the boxes rather than off the classes. */
async function widths(page: Page) {
  return page.evaluate(() => {
    const width = (selector: string) => {
      const element = document.querySelector(selector);
      return element === null
        ? null
        : Math.round(element.getBoundingClientRect().width);
    };
    const patch = document.querySelector('[data-testid="worktree-diff-patch"]');
    return {
      list: width('[data-testid="worktree-diff-files"]'),
      pane: width('[data-testid="pane-diff"]'),
      patch: width('[data-testid="worktree-diff-patch"]'),
      // What the patch can actually show, which is the number the defect was
      // measured in: a box with 32px of this against 704px of content.
      patchClient: patch === null ? null : patch.clientWidth,
      surface: width('[data-testid="work-surface"]'),
      terminal: width('[data-testid="pane-left"]'),
    };
  });
}

test("on a 16-inch MacBook Pro the patch has the pane, and the list is a gesture away", async ({
  page,
}) => {
  await openDiffPane(page, SIXTEEN_INCH);
  const laid = await widths(page);

  // The constraint that is *not* wrong, asserted so that a later "fix" that
  // bought diff width out of the terminal's 80 columns turns this red.
  expect(laid.terminal).not.toBeNull();
  expect(laid.terminal as number).toBeGreaterThanOrEqual(MIN_LEFT_PX);

  // The pane that leaves, at this window, on this machine.
  expect(laid.pane).not.toBeNull();
  const pane = laid.pane as number;
  expect(pane).toBeLessThan(PATCH_MIN_PX);

  // The list is not standing in it. Before the fix it was here at 288px — 45px
  // wider than the pane — and nothing could take that width back from it.
  await expect(page.getByTestId("worktree-diff-files")).toHaveCount(0);

  // What the owner came for: the patch has the pane, less its own padding.
  expect(laid.patch).toBe(pane);
  expect(laid.patchClient as number).toBeGreaterThan(pane - 16);

  // And nothing in the pane's *layout* is wider than the pane — the shape of
  // the defect, stated so that any future fixed-width child trips it.
  //
  // Content inside a scroller is exempt, and deliberately: a 549px patch line
  // in a 243px scroll box is the pane working, and is the very thing the 288px
  // list was hiding. What is banned is a box that takes width the pane does not
  // have and gives its sibling the shortfall.
  const overflow = await page.evaluate(() => {
    const pane = document.querySelector('[data-testid="pane-diff"]');
    if (pane === null) return ["no pane"];
    const limit = pane.getBoundingClientRect().width;
    const scrolled = (element: Element) => {
      let node: Element | null = element.parentElement;
      while (node !== null && node !== pane) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
        node = node.parentElement;
      }
      return false;
    };
    return Array.from(pane.querySelectorAll("*"))
      .filter(
        (el) => el.getBoundingClientRect().width > limit + 1 && !scrolled(el),
      )
      .map(
        (el) =>
          `${el.tagName.toLowerCase()} ${Math.round(el.getBoundingClientRect().width)} > ${Math.round(limit)}`,
      );
  });
  expect(overflow).toEqual([]);

  // One gesture away, and it still opens files.
  const toggle = page.getByTestId("worktree-diff-list-toggle");
  await expect(toggle).toContainText("3 files");
  await toggle.click();
  await expect(page.getByTestId("worktree-diff-files")).toBeVisible();
  await page.getByTestId("worktree-diff-file-2").click();
  await expect(page.getByTestId("worktree-diff-open")).toHaveText(PATHS[2]);
  await toggle.click();
  await expect(page.getByTestId("worktree-diff-files")).toHaveCount(0);
  // Closing the drawer does not close the file: the patch is still the one he
  // picked, now with the pane to itself.
  await expect(page.getByTestId("worktree-diff-open")).toHaveText(PATHS[2]);
});

test("given the whole surface, the list comes back beside the patch", async ({
  page,
}) => {
  await openDiffPane(page, SIXTEEN_INCH);
  await expect(page.getByTestId("worktree-diff-list-toggle")).toBeVisible();
  await page.keyboard.press(RIGHT_SOLO);
  await expect(page.getByTestId("worktree-diff-files")).toBeVisible();
  const laid = await widths(page);

  expect(laid.list).not.toBeNull();
  expect(laid.pane).not.toBeNull();
  // Beside, not over: the drawer's door is not even drawn.
  await expect(page.getByTestId("worktree-diff-list-toggle")).toHaveCount(0);
  await expect(page.getByTestId("worktree-diff-file-0")).toBeVisible();
  // The list is back at its preferred width, and the patch is above its floor
  // — which is the ordering the decision makes: the list only ever yields.
  expect(laid.list as number).toBe(288);
  expect((laid.pane as number) - (laid.list as number)).toBeGreaterThanOrEqual(
    PATCH_MIN_PX,
  );
});
