// The diff fits the laptop he owns
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 1).
//
// > *"16 inch macbook pro'ya bile şu an diff sidebar sığmıyor, diff
// > görünmüyor"*
//
// **The viewport is the test.** 1728×1117 is the 16-inch MacBook Pro's default
// logical resolution, and this spec runs at it rather than at whatever width
// happens to be convenient — the whole reason the defect shipped is that it is
// invisible on a large display. Measured there before anything was changed, on
// the three-column build this screen no longer has:
//
//   window 1728 → sidebar 300 + projects rail 192 + worktree column 224
//               → work surface 1003
//               → less the 8px divider and the 752px `MIN_LEFT_PX` keeps for
//                 the terminal's 80 columns
//               → **Diff pane 243px**
//   inside it: a `w-72 shrink-0` file list of **288px**, and a patch scroller
//              with **32px** of client width against 704px of content.
//
// **Re-measured after the two nav columns became one**
// (vingilot/docs/plans/2026-08-11-one-column-design.md, §6.8). The work surface
// gained the 192px the project list was spending, and the whole of that gain
// lands in this pane, because `MIN_LEFT_PX` is a floor and the terminal was
// already sitting on it:
//
//   window 1728 → sidebar 300 + workspace nav 224
//               → work surface 1195
//               → less the same 8px divider and the same 752px floor
//               → **Diff pane 435px**
//
// At that step nothing below needed repair: 435 was still under
// `PATCH_MIN_PX`, so the list still yielded and the patch still wrapped.
//
// **Re-measured again after the single-sidebar rework**
// (vingilot/docs/plans/2026-08-14-single-sidebar.md, Task 2). The workspace
// nav moved inside the app sidebar, its whole 224px landed here, and this
// time the regime DID move:
//
//   window 1728 → sidebar 300 (nav inside it)
//               → work surface 1419
//               → **Diff pane 564px**
//
// Not all of it lands in this pane: the divider's default ratio gives the
// terminal more than its 752px floor once the surface can afford to, so the
// pane measures **564px**. That clears `PATCH_MIN_PX` (467) — the patch is a
// grid again, unwrapped — and stays under `LIST_LEAVES_BELOW_PX` (643) and
// `SPLIT_MIN_PX` (695), so the list is still a drawer and the split-refusal
// test's subject is unchanged. The geometry and legibility tests below assert
// that regime.
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
//
// **"It is on screen" is not "he can read it", and the first version of this
// spec proved the first.** Measured on that build at the same 1728×1117: the
// patch had the pane and showed 33 of a 76-column line (`scrollWidth` 581
// against `clientWidth` 243), and the drawer's three rows all read
// `desktop/src/features/ru…` — the spec passed because it clicked
// `worktree-diff-file-2` by testid, which is not an affordance the owner has.
// So the last two readings below are about legibility rather than layout: no
// line of the patch runs off the side, and every row and the header name their
// file. They are asserted by measurement (`scrollWidth` against `clientWidth`
// on the very elements the text is in), because "the element exists" is exactly
// what an element 3px wide also satisfies.
//
// **P3.1: the pane stopped being ratio-scaled and became a clamped card.**
// Everything above describes a right pane whose width was the surface's own
// arithmetic — wider window, wider pane, all the way to `PATCH_MIN_PX` and
// past it. The dock (redesign P3, mockup `.dock`) replaced that with a card
// fixed to `DOCK_DEFAULT_W` 376px, resizable 300–540 (`dockModel.ts`,
// itself reading the mockup's own clamp — vingilot.js's `setChat`/resize is
// `Math.min(540, Math.max(300, …))`, birebir, and not a number this spec may
// ask past). At 376px the pane measures ~374px net of its own border — under
// `PATCH_MIN_PX` (467) on ANY viewport, because window width no longer
// reaches this pane at all. The owner's original complaint survives as a
// narrower, truer claim than "clears a number": at the dock's default width
// the patch WRAPS rather than clips — legible, not cut — and reading it wide
// and unwrapped is what the design's own affordances are for: the float
// (mockup `.float`, 640px, `DockFloat.tsx`) and ⇧⌥⌘B's right-solo (the whole
// surface, uncapped — `dockStyle`'s `flexGrow: 1` in `WorkSurface.tsx`). The
// first two tests below assert the default-width claim against the dock's
// real number; "given the whole surface, the list comes back beside the
// patch" (already using `RIGHT_SOLO`) is the existing proof of the second.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const COORDINATOR_ORIGIN = "http://127.0.0.1:7117";
const REPO = { id: "repo-fit", name: "vingilot", path: "/tmp/vingilot-fit" };

/** The 16-inch MacBook Pro's default logical resolution. */
const SIXTEEN_INCH = { height: 1117, width: 1728 };

/** What the owner's own move gives the pane: ⇧⌥⌘B hands the right pane the
 * whole work surface (`paneKeys.ts`), which on the same laptop is 1195px —
 * 1159px of it to this pane, once the left rail has its 36. The "both fit" case
 * is tested through that rather than through a 2800px viewport, because the
 * point is that the arrangement is reachable on the machine in front of him and
 * not only on a display he does not own.
 *
 * Worth saying why the split alone does not get there: `MIN_LEFT_PX` is a
 * floor and the terminal is on it, so a 1195px surface leaves the right pane
 * 435px — and the pane would have to be 755px before the list could take its
 * preferred width beside a patch above its floor. The one column bought 192px
 * and that is still 320 short, which is the measurement that says this gesture
 * is not a workaround for a window that is merely a bit narrow. */
const RIGHT_SOLO = "Shift+Alt+Meta+b";

/** `MIN_LEFT_PX` in `lib/paneModel.ts`: 80 columns × 9px + 32px of chrome.
 * Written out rather than imported, so this spec fails if the floor moves
 * instead of silently re-deriving the number it is asserting. */
const MIN_LEFT_PX = 752;

/** `PATCH_MIN_PX` in `lib/diffLayout.ts`, written out for the same reason. */
const PATCH_MIN_PX = 467;

/** `LIST_PREFERRED_PX` in `lib/diffLayout.ts`, written out for the same
 * reason: the geometry test asserts the list stands beside the patch at a
 * *yielded* width, and this is the far end of that claim. (`LIST_MIN_PX`,
 * the near end, was P3.1's own casualty — the default-width test that used
 * to bound the pane between it and `PATCH_MIN_PX` now finds the list a
 * drawer instead, with no width of its own to bound.) */
const LIST_PREFERRED_PX = 288;

/** `SPLIT_MIN_PX` in `lib/diffLayout.ts` — two columns of 38 with their gutters,
 * their trailing padding, the divider and the scroller's `px-4`. Written out
 * rather than imported for the same reason as the two above: this spec must fail
 * if the precondition moves, not silently re-derive it. */
const SPLIT_MIN_PX = 695;

/** `DOCK_DEFAULT_W` in `lib/dockModel.ts`, written out for the same reason —
 * P3.1's addendum above is why this pane's width answers to this constant
 * now and not to the viewport. */
const DOCK_DEFAULT_W = 376;

/** `SPLIT_MIN_COLUMNS × PATCH_CELL_PX`, the width one split column owes its
 * code — the half of `SPLIT_MIN_PX` that is actually source rather than chrome,
 * and therefore the number worth measuring on the drawn columns. */
const SPLIT_COLUMN_CODE_PX = 274;

/** Long enough that a patch line is a real source line rather than a token —
 * the content the 32px scroller had 704px of. */
const PATCH_LINE =
  "+export function clampRatioAt(ratio: number, surfaceWidth: number): number {";

/** Three deletions against that one addition, so the fixture's hunk is
 * **uneven** — which is the case a two-column rendering gets wrong by pairing
 * per hunk instead of per change block: the addition ends up below all three
 * deletions and the two sides slide apart. Reading the pairing needs a patch
 * where the right answer and the wrong one look different, and a one-for-one
 * change is not one. */
const DELETED_LINES = [
  "-function clampRatio(ratio: number): number {",
  "-  const floor = MIN_LEFT_PX / surfaceWidth;",
  "-  return Math.max(floor, ratio);",
];

/** The context line under the change, kept from the first version of this
 * fixture: its three leading spaces are one marker column plus two of indent. */
const CONTEXT_LINE = "   const wanted = clampRatio(ratio);";

const PATCH = `@@ -1,4 +1,3 @@\n${DELETED_LINES.join("\n")}\n${PATCH_LINE}\n${CONTEXT_LINE}\n`;

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
    ({ patch: body, paths }) => {
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
              deletions: 3,
              oldPath: null,
              patch: body,
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
    { patch: PATCH, paths: PATHS },
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

  await page.getByTestId("dock-tab-diff").click();
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

test("on a 16-inch MacBook Pro the patch wraps rather than clips, and the list is a gesture away", async ({
  page,
}) => {
  // The dock is a fixed card now, not a ratio (P3.1 addendum above) — this
  // pane measures the same ~374px on his 16" as it would on any display wide
  // enough to seat the terminal beside it at all, because window width no
  // longer reaches this pane. Below `PATCH_MIN_PX` (467) the patch wraps
  // (`diffLayout.ts`'s own decision for a pane under its floor) rather than
  // standing as a grid; the claim this spec still owes him is that wrapping
  // is not clipping, and that the list stays a gesture away regardless.
  await openDiffPane(page, SIXTEEN_INCH);
  const laid = await widths(page);

  // The constraint that is *not* wrong, asserted so that a later "fix" that
  // bought diff width out of the terminal's 80 columns turns this red.
  expect(laid.terminal).not.toBeNull();
  expect(laid.terminal as number).toBeGreaterThanOrEqual(MIN_LEFT_PX);

  // The pane is the dock's own default width, less its own card border — not
  // a fraction of the window. Proof this reading is honestly about the
  // dock's clamp, not a stale ratio number left in place.
  expect(laid.pane).not.toBeNull();
  const pane = laid.pane as number;
  expect(pane).toBeLessThanOrEqual(DOCK_DEFAULT_W);
  expect(pane).toBeGreaterThan(DOCK_DEFAULT_W - 10);

  // Below its floor the patch wraps — the honest reading at this width, and
  // the thing the rest of this test proves is not the same as clipping.
  await expect(page.getByTestId("worktree-diff-patch")).toHaveAttribute(
    "data-wrapped",
    "true",
  );

  // The list is not standing in it. Before the fix it was here at 288px and
  // nothing could take that width back from it — still true at any width
  // under `LIST_LEAVES_BELOW_PX`, dock or ratio.
  await expect(page.getByTestId("worktree-diff-files")).toHaveCount(0);

  // What the owner came for even at this width: the patch has the pane, less
  // its own padding — wrapped lines, not a narrower box hiding behind a list.
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

/** Whether a box is showing all of its own text, and how much of it it is
 * showing — the reading that separates "the line is in the DOM" from "the line
 * is on screen". `scrollWidth` is content, `clientWidth` is what is visible;
 * one pixel of slack absorbs sub-pixel text metrics. */
async function legibility(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element) => ({
      client: Math.round(element.clientWidth),
      scroll: Math.round(element.scrollWidth),
      text: (element.textContent ?? "").trim(),
    });
    const patch = document.querySelector('[data-testid="worktree-diff-patch"]');
    const lines = Array.from(patch?.querySelectorAll("span") ?? [], (line) => ({
      ...box(line),
      overflow: line.scrollWidth - line.clientWidth,
    }));
    const named = (root: Element | null) => {
      const name = root?.querySelector("[data-path-name]") ?? null;
      return name === null ? null : box(name);
    };
    return {
      header: named(
        document.querySelector('[data-testid="worktree-diff-open"]'),
      ),
      lines,
      rows: Array.from(
        document.querySelectorAll('[data-testid^="worktree-diff-file-"]'),
        (row) => named(row),
      ),
      wrapped: patch?.getAttribute("data-wrapped") ?? null,
    };
  });
}

test("at his width the patch wraps at its floor and every row still names its file", async ({
  page,
}) => {
  await openDiffPane(page, SIXTEEN_INCH);

  // The dock's default is under `PATCH_MIN_PX` (467) on any display — see the
  // P3.1 addendum above — so the honest reading at his width is the wrap, not
  // the grid: `diffLayout.ts`'s own decision for a pane under its floor. What
  // survives from the pre-dock claim is that wrapping is not clipping — every
  // line stays fully on screen, broken rather than cut, which the overflow
  // check below is the one that actually proves.
  const before = await legibility(page);
  expect(before.wrapped).toBe("true");
  expect(before.lines.length).toBeGreaterThan(0);
  // The fixture's 76-column source line is on screen — asserted by content,
  // so a build that rendered an empty patch could not pass by having nothing
  // to draw. A wrapped line is still one text node, so its full text is still
  // here to find.
  expect(before.lines.map((line) => line.text)).toContain(PATCH_LINE.trim());
  // And it is on screen whole: wrapped means broken across visual rows, not
  // scrolled past the edge. `scrollWidth` over `clientWidth` is the reading
  // the grid regime deliberately did not take here (a scroller is allowed to
  // hold more than it shows); the wrap regime has no scroller to hide behind.
  for (const line of before.lines) {
    expect(line.overflow).toBeLessThanOrEqual(1);
  }

  // The header names the open file. Before: "desktop/src/feat…".
  expect(before.header).not.toBeNull();
  expect((before.header as { text: string }).text).toBe("paneModel.ts");
  const header = before.header as { client: number; scroll: number };
  expect(header.scroll).toBeLessThanOrEqual(header.client + 1);

  // The drawer's rows. Before: three rows, all reading
  // `desktop/src/features/ru…`, told apart only by a testid.
  await page.getByTestId("worktree-diff-list-toggle").click();
  await expect(page.getByTestId("worktree-diff-files")).toBeVisible();
  const open = await legibility(page);
  const names = open.rows.map((row) => row?.text ?? null);
  expect(names).toEqual([
    "paneModel.ts",
    "WorktreeDiffPanel.tsx",
    "diffLayout.ts",
  ]);
  expect(new Set(names).size).toBe(names.length);
  // Each name is shown in full, not ellipsised — the row elides the directory.
  expect(
    open.rows.filter((row) => row !== null && row.scroll > row.client + 1),
  ).toEqual([]);
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
  expect(laid.list as number).toBe(LIST_PREFERRED_PX);
  expect((laid.pane as number) - (laid.list as number)).toBeGreaterThanOrEqual(
    PATCH_MIN_PX,
  );
  // And with the room for it, the patch is a grid again: wrapping is the
  // accommodation for a pane under its floor, not the new rendering of a diff.
  // Above the floor a line is a line, aligned with the one above it, and the
  // scroller is what handles the long ones.
  await expect(page.getByTestId("worktree-diff-patch")).toHaveAttribute(
    "data-wrapped",
    "false",
  );
});

// ── VS Code-style split diff ─────────────────────────────────────────────────
//
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 2.)
//
// The arithmetic is proved without a browser in
// `src/features/runs/lib/diffLayout.test.mjs` (the 695px precondition, the
// refusal's words, and that growing the pane never takes split away) and the row
// alignment in `src/features/runs/lib/splitDiff.test.mjs` (uneven blocks pair
// per block, and the leftover side is a gap). What needs a browser is everything
// those two cannot see: that the toggle is really in the header at his width and
// really unavailable there **with its sentence on screen**, that the two columns
// laid out by a CSS grid are two halves of the box rather than one column and a
// clipped one, that the row alignment survives being drawn (a `contents`
// wrapper and four grid children is exactly the kind of thing that pairs
// correctly in the model and renders staggered), and that the remembered flag is
// remembered — declined in a pane too narrow for it and honoured again in a pane
// that is not, without being chosen twice.

/** Everything about the split rendering that has to be read off the laid-out
 * boxes rather than out of the model: the rows in order, the resolved colour of
 * each side's code, and the geometry of the two columns. */
async function splitReading(page: Page) {
  return page.evaluate(() => {
    const patch = document.querySelector('[data-testid="worktree-diff-patch"]');
    if (patch === null) return null;
    const rows = Array.from(
      patch.querySelectorAll("[data-split-row]"),
      (row) => {
        const cells = Array.from(row.querySelectorAll("span"));
        const cell = (at: number) => cells[at] ?? null;
        const read = (at: number) => {
          const element = cell(at);
          return element === null
            ? null
            : {
                color: getComputedStyle(element).color,
                // Content against visible width, on the very element the text
                // is in: this is what says "nothing is clipped" rather than
                // "an element exists".
                overflow: element.scrollWidth - element.clientWidth,
                text: element.textContent ?? "",
                width: Math.round(element.getBoundingClientRect().width),
              };
        };
        return {
          // gutter, code, gutter, code — or one spanning cell.
          after: read(3),
          afterNo: cell(2)?.textContent ?? null,
          before: read(1),
          beforeNo: cell(0)?.textContent ?? null,
          kind: row.getAttribute("data-split-row"),
          span: cells.length === 1 ? read(0) : null,
        };
      },
    );
    return { columns: patch.clientWidth, rows };
  });
}

test("at his width the split toggle is on screen, unavailable, and says why", async ({
  page,
}) => {
  await openDiffPane(page, SIXTEEN_INCH);

  // Not hidden. Task 2: "Below it, the toggle says why it is disabled rather
  // than disappearing" — a control that vanishes at some widths teaches the
  // owner nothing he can act on.
  const toggle = page.getByTestId("worktree-diff-split");
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  // And the sentence is on screen, in words, naming both numbers — checked
  // against the pane's *measured* width rather than against a literal 435, so
  // this reads as a self-checking sum instead of a magic number that goes stale
  // the next time the surface moves.
  const pane = await page.evaluate(() =>
    Math.round(
      document
        .querySelector('[data-testid="pane-diff"]')
        ?.getBoundingClientRect().width ?? 0,
    ),
  );
  expect(pane).toBeLessThan(SPLIT_MIN_PX);
  await expect(page.getByTestId("worktree-diff-split-why")).toHaveText(
    `split needs ${SPLIT_MIN_PX}px of pane; this one has ${pane}px.`,
  );

  // The patch beside it is the one column that fits, and the toggle being
  // unavailable is the pane refusing rather than the pane forgetting: nothing on
  // screen claims two columns.
  await expect(page.getByTestId("worktree-diff-patch")).toHaveAttribute(
    "data-mode",
    "unified",
  );
  // Not a single two-column row is drawn: the refusal is a refusal, not a
  // narrow split with the toggle mislabelled.
  await expect(
    page.locator('[data-testid="worktree-diff-patch"] [data-split-row]'),
  ).toHaveCount(0);
});

test("given the whole surface, split draws two aligned columns and neither is clipped", async ({
  page,
}) => {
  await openDiffPane(page, SIXTEEN_INCH);
  await page.keyboard.press(RIGHT_SOLO);

  const toggle = page.getByTestId("worktree-diff-split");
  await expect(toggle).toBeEnabled();
  // The refusal is gone with the reason for it — a sentence that outlived its
  // cause would be worse than none.
  await expect(page.getByTestId("worktree-diff-split-why")).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("worktree-diff-patch")).toHaveAttribute(
    "data-mode",
    "split",
  );

  const reading = await splitReading(page);
  expect(reading).not.toBeNull();
  const { columns, rows } = reading as NonNullable<typeof reading>;

  // The hunk header belongs to neither file and spans; the three deletions
  // against one addition are three change rows; the context line is one row.
  expect(rows.map((row) => row.kind)).toEqual([
    "span",
    "change",
    "change",
    "change",
    "context",
  ]);

  // **The alignment, read off the page.** The addition is on the SAME row as the
  // first deletion — not below all three, which is what a per-hunk pairing draws
  // and what would make every row after it a comparison of two unrelated lines.
  expect(rows[1].before?.text).toBe(DELETED_LINES[0].slice(1));
  expect(rows[1].after?.text).toBe(PATCH_LINE.slice(1));
  expect(rows[1].beforeNo).toBe("1");
  expect(rows[1].afterNo).toBe("1");

  // And the two rows the addition ran out for are gaps on the right: numbered on
  // the left, numbered nowhere on the right.
  expect(rows[2].before?.text).toBe(DELETED_LINES[1].slice(1));
  expect(rows[2].afterNo).toBe("");
  expect(rows[3].before?.text).toBe(DELETED_LINES[2].slice(1));
  expect(rows[3].afterNo).toBe("");

  // The context line is in both columns and numbered in both, past the block:
  // three lines gone from the old file, one arrived in the new.
  expect(rows[4].before?.text).toBe(CONTEXT_LINE.slice(1));
  expect(rows[4].after?.text).toBe(CONTEXT_LINE.slice(1));
  expect(rows[4].beforeNo).toBe("4");
  expect(rows[4].afterNo).toBe("2");

  // **Colour is information, and it is the theme's own diff tokens.** Read as
  // resolved colours rather than as class names: a class assertion says which
  // paint was written, not which one the browser arrived at. Three distinct
  // colours — deleted, added, context — is the claim.
  const deleted = rows[2].before?.color;
  const added = rows[1].after?.color;
  const context = rows[4].before?.color;
  expect(new Set([deleted, added, context]).size).toBe(3);
  // And the deleted side of a change row is the same red as the deleted side of
  // any other, which is what makes it a token rather than a per-row decision.
  expect(rows[3].before?.color).toBe(deleted);

  // **Two halves, and nothing cut off.** The columns are the same width to
  // within a pixel, each has the code width the precondition promised, and no
  // cell has content wider than it can show — which is the whole reason the
  // layout is a grid and not two clipped boxes.
  const code = rows[4];
  expect(
    Math.abs((code.before?.width ?? 0) - (code.after?.width ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(code.before?.width ?? 0).toBeGreaterThanOrEqual(SPLIT_COLUMN_CODE_PX);
  expect(columns).toBeGreaterThanOrEqual(SPLIT_MIN_PX - 32);
  const clipped = rows.flatMap((row) =>
    [row.before, row.after, row.span].filter(
      (cell) => cell !== null && cell.overflow > 1,
    ),
  );
  expect(clipped).toEqual([]);

  // Back again, on the same control. One renderer, two layouts.
  await toggle.click();
  await expect(page.getByTestId("worktree-diff-patch")).toHaveAttribute(
    "data-mode",
    "unified",
  );
});

test("the choice is remembered — declined in a pane too narrow for it, honoured again when it is not", async ({
  page,
}) => {
  await openDiffPane(page, SIXTEEN_INCH);
  await page.keyboard.press(RIGHT_SOLO);
  await page.getByTestId("worktree-diff-split").click();
  await expect(page.getByTestId("worktree-diff-patch")).toHaveAttribute(
    "data-mode",
    "split",
  );

  // Back to the split surface: 435px cannot hold two columns, so the pane draws
  // one and says why. This is the pane DECLINING the choice.
  await page.keyboard.press(RIGHT_SOLO);
  await expect(page.getByTestId("worktree-diff-patch")).toHaveAttribute(
    "data-mode",
    "unified",
  );
  await expect(page.getByTestId("worktree-diff-split-why")).toBeVisible();

  // And back out: split returns without being chosen a second time. If the
  // narrow pane had *cleared* the flag, this would come back unified — the app
  // would have un-chosen it while he watched.
  await page.keyboard.press(RIGHT_SOLO);
  await expect(page.getByTestId("worktree-diff-patch")).toHaveAttribute(
    "data-mode",
    "split",
  );
  await expect(page.getByTestId("worktree-diff-split")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
