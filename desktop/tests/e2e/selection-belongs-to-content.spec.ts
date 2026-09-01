// Selection belongs to content, not to chrome — redesign P4.2, over a real
// pointer drag.
//
// > *"secme kismi sadece dosya olmali ya da terminal ici. dosya satir
// > numaralari filan secilemez olmali."*
//
// His screenshot was one stray drag that selected the entire app: sidebar
// rows, tab labels, project names, the file viewer's line-number gutter, the
// status bar. The rule is that the shell is `user-select: none` and selection
// is opted into by the surfaces whose content is meant to be copied.
//
// **A CSS assertion would not prove this.** `user-select` is inherited,
// overridden per element, and defeated by any one of a dozen utilities; the
// only reading that means anything is the one the owner made — press, drag,
// release, and see what is highlighted. So every test here moves a real mouse
// and reads `window.getSelection()`.
//
// The four claims:
//
// 1. A drag across the shell's chrome selects **nothing**.
// 2. A drag across an open file's text selects the file's own text — and what
//    comes out is a substring of the file, which is what says the line-number
//    gutter did not come with it.
// 3. A drag across a patch selects code and **not** the gutter or the marker
//    column — asserted by containment: everything copied is code.
// 4. The things that select natively still do: an input's caret still selects
//    its own value, and xterm still owns its own.
//
// The data is this repository's own (`real-repo.fixtures.ts`): the file being
// dragged over is one of this app's source files, because a fixture with four
// lines in it cannot be dragged across.

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import {
  openDockTab,
  openRealWorkspace,
  REAL_TS_PATH,
  realFile,
} from "./real-repo.fixtures";

const SHOTS =
  "/private/tmp/claude-501/-Users-ahmetyusufbirinci/9a20f9f6-1102-43cb-8495-976fd565d0ea/scratchpad/p42-shots";

/** Press here, drag there, release — the gesture, not a simulation of it.
 * `steps` because a single jump does not extend a selection in Chromium: the
 * browser needs intermediate `mousemove`s to grow the range the way a hand
 * does. */
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await page.mouse.up();
}

/** How far inside the pane's own edges the drag is allowed to end. Wide enough
 * that the release is over a row rather than over the scroller's padding, and
 * that nothing has to be revealed to reach it. */
const PANE_EDGE_PX = 24;

/** Where a drag over a patch may begin and end: the very start of its first
 * code cell, and the far end of the last code cell **the pane is showing**.
 *
 * **Not the patch's last row, which is the arithmetic that went red.** The
 * subject is this repository's own newest commit under the workspace feature
 * (`real-repo.fixtures.ts` picks it rather than pinning it), so how tall the
 * patch is moves with the branch. Measured at `b5b61a6`: the shown file is 62
 * rows and its last code cell sits at y = 3,328 in a 1,117-tall window — two
 * screens below anywhere a pointer can be. Chromium answers that drag the way
 * it answers a hand dragged off the bottom of the screen: it autoscrolls the
 * pane, and once the pointer is outside the window it hit-tests nothing and
 * **collapses the range to a caret** — 679 characters selected at the last
 * in-window step, 0 at the next one, `getSelection().type` going `Range` →
 * `Caret`. Nothing about selection changed; the patch under the gesture got
 * longer. So the end of the drag is measured against the pane's visible box,
 * which is a real gesture at any patch length instead of one that happened to
 * fit while the subject was short.
 *
 * `crossed` is how many code cells lie between the two ends, so the caller can
 * say out loud that the drag really did cross rows — a drag inside one row
 * crosses no gutter and would prove nothing. */
async function dragEnds(patch: Locator): Promise<{
  crossed: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
}> {
  const ends = await patch.evaluate((box, edge) => {
    const pane = box.getBoundingClientRect();
    const inside = [...box.querySelectorAll("[data-diff-code]")]
      .map((cell) => cell.getBoundingClientRect())
      .filter(
        (rect) => rect.top >= pane.top && rect.bottom <= pane.bottom - edge,
      );
    const head = inside.at(0);
    const tail = inside.at(-1);
    if (head === undefined || tail === undefined) return null;
    return {
      crossed: inside.length,
      from: { x: head.left + 1, y: head.top + 4 },
      to: { x: Math.min(tail.right, pane.right - edge), y: tail.bottom - 2 },
    };
  }, PANE_EDGE_PX);
  if (ends === null) throw new Error("no diff code cell is on screen");
  return ends;
}

async function selected(page: Page): Promise<string> {
  return page.evaluate(() => window.getSelection()?.toString() ?? "");
}

async function clearSelection(page: Page) {
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
}

/** The middle of a testid'd box, in page coordinates. */
async function centre(page: Page, testid: string) {
  const box = await page.getByTestId(testid).boundingBox();
  if (box === null) throw new Error(`${testid} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function openFileTab(page: Page) {
  await openDockTab(page, "files");
  // Walk down to the file through the tree, which is this repository's own.
  for (const dir of REAL_TS_PATH.split("/")
    .slice(0, -1)
    .reduce<string[]>(
      (paths, part) => [
        ...paths,
        paths.length === 0 ? part : `${paths[paths.length - 1]}/${part}`,
      ],
      [],
    )) {
    await page.getByTestId(`dock-files-row-${dir}`).click();
  }
  await page.getByTestId(`dock-files-row-${REAL_TS_PATH}`).click();
  await expect(page.getByTestId("files-viewer-path")).toHaveText(REAL_TS_PATH);
  await expect(page.getByTestId("files-viewer-body")).toBeVisible();
}

test("a drag across the shell's chrome selects nothing at all", async ({
  page,
}) => {
  await openRealWorkspace(page);
  await openDockTab(page, "history");
  await expect(page.getByTestId("dock-history-graph")).toBeVisible();

  // **The drag he made.** Top-left of the window, across the sidebar's project
  // and channel rows, over the work surface's own furniture, and down to the
  // status bar — the exact sweep whose result he sent as a screenshot.
  const bar = await centre(page, "project-status-bar");
  await drag(page, { x: 40, y: 120 }, { x: bar.x, y: bar.y });
  expect(await selected(page)).toBe("");

  // And inside the dock, whose rows are the ones with the most text on them:
  // the History panel's scope line down through its commit rows. A row's
  // subject is prose and would have come out first.
  await clearSelection(page);
  const scope = await centre(page, "dock-history-scope");
  const graph = await page.getByTestId("dock-history-graph").boundingBox();
  if (graph === null) throw new Error("no graph box");
  await drag(page, scope, { x: graph.x + 40, y: graph.y + graph.height - 20 });
  expect(await selected(page)).toBe("");

  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/p42-drag-over-chrome.png` });
});

test("a drag across an open file selects the file's own text, and never the gutter", async ({
  page,
}) => {
  await openRealWorkspace(page);
  await openFileTab(page);

  // The `<pre>` itself, not the scroll region around it: **the padding is
  // chrome and a press there starts nothing at all**, which is the rule
  // working rather than a defect. The drag begins on the code and ends at the
  // left edge four lines down, so it crosses the line-number gutter of every
  // line in between — precisely the drag that used to bring the numbers with
  // it.
  const pre = await page
    .locator(
      '[data-testid="files-viewer-code"], [data-testid="files-viewer-plain"]',
    )
    .first()
    .boundingBox();
  if (pre === null) throw new Error("no viewer pre");
  await drag(
    page,
    { x: pre.x + 90, y: pre.y + 8 },
    { x: pre.x + 2, y: pre.y + 120 },
  );

  const copied = await selected(page);
  expect(copied.length).toBeGreaterThan(40);

  // **What proves the gutter stayed behind.** Everything selected is text that
  // is in the file: a line number that had come along would put digits in
  // front of a line that does not start with them, and the containment check
  // would fail. Whitespace is normalised on both sides because a selection
  // across block elements introduces its own newlines.
  const flat = (text: string) => text.replace(/\s+/g, " ").trim();
  expect(flat(realFile(REAL_TS_PATH).text)).toContain(flat(copied));

  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/p42-drag-over-file-text.png` });
});

test("a drag across a patch takes the code and leaves the gutter and the marker", async ({
  page,
}) => {
  await openRealWorkspace(page);
  await openDockTab(page, "diff");
  const patch = page.getByTestId("worktree-diff-patch");
  await expect(patch).toBeVisible();

  // From the very start of the first row's code down to the end of the last
  // row the pane is SHOWING, so the drag crosses both `.dno` columns and the
  // marker column of every row in between. Starting ON the gutter is not a
  // case that has to work — it is generated content, and a press there begins
  // no selection at all, which is the rule rather than a gap.
  const rows = patch.locator("[data-diff-sign]");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(2);
  const cells = patch.locator("[data-diff-code]");
  await expect(cells).toHaveCount(count);
  const ends = await dragEnds(patch);
  // It has to cross rows, or it says nothing about the columns between them.
  expect(ends.crossed).toBeGreaterThan(1);
  await drag(page, ends.from, ends.to);

  const copied = await selected(page);
  expect(copied.length).toBeGreaterThan(20);

  // **Everything copied is code, and nothing else is.** The two line-number
  // columns and the marker are `::before` content carrying `user-select:
  // none`, so a drag down a patch brings back the source and leaves the
  // gutter where it is — the owner's rule, in the only form that can be read
  // off a real drag.
  const allCode = (await cells.allTextContents()).join("\n");
  const flat = (text: string) => text.replace(/\s+/g, " ").trim();
  expect(flat(allCode)).toContain(flat(copied));
});

test("what selects natively still does — an input's own text, and xterm's", async ({
  page,
}) => {
  await openRealWorkspace(page);
  await openDockTab(page, "diff");

  // The `against` box. A triple click is the browser's own "select this
  // field", and `selectionStart`/`selectionEnd` is the field's own reading of
  // what happened — not a CSS assertion.
  const field = page.getByTestId("worktree-diff-base");
  await expect(field).toBeVisible();
  await field.click({ clickCount: 3 });
  const range = await field.evaluate((node) => {
    const input = node as HTMLInputElement;
    return {
      end: input.selectionEnd ?? 0,
      start: input.selectionStart ?? 0,
      value: input.value,
    };
  });
  expect(range.value.length).toBeGreaterThan(0);
  expect(range.end - range.start).toBe(range.value.length);

  // **xterm owns its own selection and this rule does not fight it.**
  // `.xterm` computes `none` — and that is xterm's OWN declaration
  // (@xterm/xterm 5.5.0 css/xterm.css:41), not the shell default reaching in:
  // xterm draws its selection itself and answers `term.getSelection()` from
  // its own model. So the reading that matters is that the value is xterm's
  // and unchanged, which is what "do not fight it" means. Adding a rule that
  // forced `text` here would be the mistake, and it would lose to xterm's own
  // rule besides — measured, when this spec was first written that way.
  //
  // Attached rather than visible: the Diff tab is showing, so the shell behind
  // it is mounted and un-laid-out — the state every background tab is already
  // in (`WorkSurface`'s header) — and a computed style is readable there.
  const terminal = page.locator(".xterm").first();
  await expect(terminal).toBeAttached();
  expect(
    await terminal.evaluate((node) => getComputedStyle(node).userSelect),
  ).toBe("none");
  // And the half of the terminal the browser DOES own still works: xterm's
  // hidden input is a `<textarea>`, which the opt-in list names, so typing
  // into a shell is untouched by any of this.
  const helper = page.locator("textarea.xterm-helper-textarea").first();
  await expect(helper).toBeAttached();
  expect(
    await helper.evaluate((node) => getComputedStyle(node).userSelect),
  ).not.toBe("none");
});
