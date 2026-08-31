// The diff tab, on this repository's own commits — redesign P4.6
// (vingilot/design/mockup/DIFF-TAB-BRIEF.md).
//
// > *"verify'a gecti ama hala iyi degil be" · "hala cok terminal gibi"*
//
// **Read against the real thing, for `real-repo.fixtures.ts`'s stated reason.**
// A hand-written three-line patch has no directory to dim, no file long enough
// to fold, no paired rewrite to word-diff and no author to name — every one of
// which is a thing the brief asks the SURFACE to draw. So the bridge is fed
// this repository's own `git log --all` and a real commit's real `git diff`,
// and what is asserted is the surface's structure, never a subject, a hash or a
// line count that the next commit would move.
//
// What each test claims maps to a numbered section of the brief:
//
//   §1 the commit header  — subject, author, sha chip, branch chip, file count,
//                           `+N`/`−N`, and the five-block ratio bar; and, on a
//                           worktree diff, the three of those that have no
//                           source are ABSENT rather than invented.
//   §2 the toolbar        — Unified/Split on the app's one flag, Ignore
//                           whitespace and Wrap persisted, Expand all, Next
//                           change, and the P4 reviewer popover (not a second
//                           one).
//   §3 the file cards     — `flex:none` (the brief calls this out: cards squash
//                           and clip without it), collapse per file, and icon
//                           buttons that do NOT collapse.
//   §4 the diff body      — 22px rows, two number columns and a separate sign
//                           column, the word-level highlight, and the hover
//                           comment affordance.
//   §5 the review thread  — rendered only when a real anchored note exists.
//                           This fixture's relay has none, so the assertion is
//                           that the diff draws NO thread: never a seeded one.
//   §6 the footer         — the tally, the unresolved count, the keycaps.
//   behaviour             — `J`/`K` between changed hunks, `⌥⏎` on the focused
//                           line, and the three doors onto the tab.

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import {
  ALL_REFS,
  openDockTab,
  openRealWorkspace,
  REAL_DIFF,
  REAL_MIXED_PATH,
} from "./real-repo.fixtures";

const SHOTS =
  "/private/tmp/claude-501/-Users-ahmetyusufbirinci/9a20f9f6-1102-43cb-8495-976fd565d0ea/scratchpad/p46-shots";

/** P4.8's own evidence — the parity round, shot on the same real commit. */
const SHOTS_48 =
  "/private/tmp/claude-501/-Users-ahmetyusufbirinci/9a20f9f6-1102-43cb-8495-976fd565d0ea/scratchpad/p48-shots";

/** The mockup's `line-height: 22px`. */
const ROW_H = 22;

test.beforeAll(() => {
  // **The preconditions this whole file rests on**, asserted loudly rather
  // than assumed — the pattern `history-and-diff-readable.spec.ts` set. Every
  // claim below would still pass against a trivial fixture while proving
  // nothing.
  expect(REAL_DIFF.files.length).toBeGreaterThan(1);
  expect(ALL_REFS.length).toBeGreaterThan(50);
  expect(REAL_DIFF.additions + REAL_DIFF.deletions).toBeGreaterThan(0);
  // At least one file has a removed line immediately followed by an added one
  // that shares its opening — which is what a word-level highlight is a
  // reading OF. Without one, §4's assertion would be vacuous.
  const rewritten = REAL_DIFF.files.some((file) => {
    const lines = file.patch.split("\n");
    return lines.some((line, at) => {
      const next = lines[at + 1];
      if (!line.startsWith("-") || next === undefined) return false;
      if (!next.startsWith("+")) return false;
      return (
        line.slice(1, 9).trim() !== "" && next.slice(1, 9) === line.slice(1, 9)
      );
    });
  });
  expect(rewritten).toBe(true);
});

/** Open the newest commit as a tab — the History-row door, which is the first
 * of the brief's three. */
async function openCommitTab(page: Page) {
  await openRealWorkspace(page);
  await openDockTab(page, "history");
  await page
    .getByTestId("dock-history-graph")
    .getByRole("option")
    .first()
    .click();
  const tab = page.getByTestId("diff-tab-commit");
  await expect(tab).toBeVisible();
  return tab;
}

/** Open this worktree's changes as a tab — the Diff-pane door, the second. */
async function openWorktreeTab(page: Page) {
  await openRealWorkspace(page);
  await openDockTab(page, "diff");
  await page.getByTestId("worktree-diff-open-tab").click();
  const tab = page.getByTestId("diff-tab-worktree");
  await expect(tab).toBeVisible();
  return tab;
}

test("§1 the header is git's own record, and says nothing git did not say", async ({
  page,
}) => {
  const tab = await openCommitTab(page);

  // The subject as a title, not a log line.
  const subject = tab.getByTestId("diff-tab-subject");
  await expect(subject).toBeVisible();
  expect((await subject.textContent())?.trim().length ?? 0).toBeGreaterThan(0);
  // Its own type step above the meta beside it — the brief's "reads like a
  // title".
  const sizes = await tab.evaluate((node) => {
    const title = node.querySelector('[data-testid="diff-tab-subject"]');
    const chip = node.querySelector('[data-testid="diff-tab-sha"]');
    const px = (el: Element | null) =>
      el === null ? 0 : Number.parseFloat(getComputedStyle(el).fontSize);
    return { chip: px(chip), title: px(title) };
  });
  expect(sizes.title).toBeGreaterThan(sizes.chip);

  // The meta row: a real author, a real sha, a real ref, a real file count.
  await expect(tab.getByTestId("diff-tab-sha")).toBeVisible();
  await expect(tab).toContainText("files changed");
  // The five-block ratio bar, and the numbers beside it.
  const bar = tab.locator("[data-ratio-bar]").first();
  await expect(bar).toBeVisible();
  expect(
    ((await bar.getAttribute("data-ratio-bar")) ?? "").split(",").length,
  ).toBe(5);
  await expect(tab).toContainText(`+${REAL_DIFF.additions}`);
  await expect(tab).toContainText(`−${REAL_DIFF.deletions}`);
});

test("§1 a worktree diff has no author, no time and no sha, so it draws none", async ({
  page,
}) => {
  // **The honest-data rule, as an assertion.** The mockup's meta row is a
  // COMMIT's; a working tree has not been committed, so a name and a hash over
  // one would be provenance this app invented.
  const tab = await openWorktreeTab(page);
  await expect(tab.getByTestId("diff-tab-subject")).toContainText(
    "Working tree against",
  );
  await expect(tab.getByTestId("diff-tab-sha")).toHaveCount(0);
  await expect(tab).not.toContainText("committed");
  // The branch chip stays: the worktree row really does name one.
  await expect(tab.getByTestId("diff-tab-branch")).toBeVisible();
});

test("§3 every file is a card, cards keep their height, and the scroller scrolls", async ({
  page,
}) => {
  const tab = await openCommitTab(page);
  const cards = tab.locator("[data-diff-card]");
  expect(await cards.count()).toBe(REAL_DIFF.files.length);

  // **The brief's `flex:none`, measured.** Without it a flex child of a column
  // scroller is squashed to share the box: the cards' heights sum to less than
  // the content, and the patch inside is clipped. With it the cards keep their
  // intrinsic height and the SCROLLER is what overflows.
  const laid = await tab.evaluate((node) => {
    const scroll = node.querySelector('[data-testid="diff-tab-scroll"]');
    if (scroll === null) return null;
    const cards = Array.from(node.querySelectorAll("[data-diff-card]"));
    return {
      grow: cards.map((card) => getComputedStyle(card).flexShrink),
      scrollHeight: scroll.scrollHeight,
      viewport: scroll.clientHeight,
    };
  });
  expect(laid).not.toBeNull();
  const box = laid as NonNullable<typeof laid>;
  expect(box.grow.every((value) => value === "0")).toBe(true);
  expect(box.scrollHeight).toBeGreaterThan(box.viewport);

  await waitForAnimations(page);
  await page.getByTestId("work-surface").screenshot({
    path: `${SHOTS}/p46-diff-tab.png`,
  });
});

test("§3 a card collapses, and its icon buttons do not collapse it", async ({
  page,
}) => {
  const tab = await openCommitTab(page);
  const path = REAL_DIFF.files[0].path;
  const header = tab.getByTestId(`history-file-row-${path}`);
  const body = tab.getByTestId(`history-patch-${path}`);

  if ((await header.getAttribute("aria-expanded")) === "false") {
    await header.click();
  }
  await expect(body).toBeVisible();

  // The copy-path button lives BESIDE the collapse control rather than inside
  // it — HTML forbids a button in a button, which is what makes the brief's
  // "icon buttons must not trigger the collapse" structural here.
  await tab.getByTestId(`diff-copy-path-${path}`).click();
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();

  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await expect(body).toHaveCount(0);

  await waitForAnimations(page);
  await page.getByTestId("work-surface").screenshot({
    path: `${SHOTS}/p46-card-collapsed.png`,
  });

  // Expand all puts every card back, including the ones that opened folded.
  await tab.getByTestId("diff-tab-expand-all").click();
  await expect(
    tab.locator('[data-testid^="history-file-row-"][aria-expanded="false"]'),
  ).toHaveCount(0);
});

test("§4 the rows are 22px, the sign has its own column, and changed tokens are highlighted", async ({
  page,
}) => {
  const tab = await openCommitTab(page);
  await tab.getByTestId("diff-tab-expand-all").click();
  await expect(
    tab.locator(`[data-testid="history-patch-${REAL_MIXED_PATH}"]`),
  ).toBeVisible();

  const read = await tab.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("[data-diff-sign]"));
    const codeOf = (row: Element | undefined) =>
      row?.querySelector("[data-diff-code]") ?? null;
    const left = (row: Element | undefined) => {
      const code = codeOf(row);
      return code === null
        ? null
        : Math.round(code.getBoundingClientRect().left);
    };
    const first = (sign: string) =>
      rows.find((row) => row.getAttribute("data-diff-sign") === sign);
    return {
      addLeft: left(first("add")),
      ctxLeft: left(first("ctx")),
      delLeft: left(first("del")),
      height: Math.round(rows[0]?.getBoundingClientRect().height ?? 0),
      words: document.querySelectorAll(".vingilot-wd").length,
    };
  });

  // The mockup's generous row — "not terminal-tight".
  expect(read.height).toBe(ROW_H);
  // The sign is a column of its own, so no code ever moves sideways (P4.4's
  // claim, re-asserted here because P4.6 rewrote the row).
  expect(read.addLeft).toBe(read.ctxLeft);
  expect(read.delLeft).toBe(read.ctxLeft);
  // A REAL intra-line differ marked real tokens — `beforeAll` proved this
  // commit has a rewrite to mark.
  expect(read.words).toBeGreaterThan(0);

  await waitForAnimations(page);
  await page
    .locator(`[data-testid="history-patch-${REAL_MIXED_PATH}"]`)
    .screenshot({ path: `${SHOTS}/p46-word-diff.png` });
});

test("§4 hovering a line offers the comment affordance, and ⌥⏎ opens it on the focused one", async ({
  page,
}) => {
  const tab = await openCommitTab(page);
  await tab.getByTestId("diff-tab-expand-all").click();
  const row = tab.locator("[data-diff-sign]").first();
  await expect(row).toBeVisible();

  // The mockup's `.addbtn`: hidden until the row is hovered.
  const button = row.locator("..").locator("[data-diff-comment-button]");
  await expect(button).toBeHidden();
  await row.hover();
  await expect(button).toBeVisible();

  // `J` puts the ring on the first changed hunk; `⌥⏎` opens a comment there.
  await page.keyboard.press("j");
  await expect(tab.locator('[data-diff-focused="true"]')).toHaveCount(1);
  await page.keyboard.press("Alt+Enter");
  await expect(tab.getByTestId("diff-tab-composer")).toBeVisible();
  // The anchor is `path:line` — the form `reviewThread.ts` reads back, so a
  // comment left here lands under this line when the thread is read again.
  await expect(tab.getByTestId("diff-tab-composer")).toContainText(":");
});

test("§4 J and K walk the changed hunks, and clamp rather than wrap", async ({
  page,
}) => {
  const tab = await openCommitTab(page);
  await tab.getByTestId("diff-tab-expand-all").click();

  const focused = () =>
    tab.evaluate((node) => {
      const row = node.querySelector('[data-diff-focused="true"]');
      return row?.getAttribute("data-diff-nos") ?? null;
    });

  await page.keyboard.press("j");
  const first = await focused();
  expect(first).not.toBeNull();
  await page.keyboard.press("j");
  expect(await focused()).not.toBe(first);
  await page.keyboard.press("k");
  expect(await focused()).toBe(first);
  // `K` at the top stays at the top — a diff is a list, not a ring.
  await page.keyboard.press("k");
  expect(await focused()).toBe(first);
});

test("§2 the toolbar writes the app's own flags, and remembers two of them", async ({
  page,
}) => {
  const tab = await openCommitTab(page);

  // Unified/Split is `diffMode.ts` — the one flag the Diff pane reads too.
  await expect(tab.getByTestId("diff-tab-mode-unified")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await tab.getByTestId("diff-tab-mode-split").click();
  await expect(tab.getByTestId("diff-tab-mode-split")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    tab.locator('[data-testid^="history-patch-"]').first(),
  ).toHaveAttribute("data-mode", "split");

  await waitForAnimations(page);
  await page.getByTestId("work-surface").screenshot({
    path: `${SHOTS}/p46-split.png`,
  });
  await tab.getByTestId("diff-tab-mode-unified").click();

  // Ignore whitespace and Wrap persist per user — asserted through storage
  // rather than through a reload, because a reload is a different tab.
  await tab.getByTestId("diff-tab-ignore-whitespace").click();
  await tab.getByTestId("diff-tab-wrap").click();
  const stored = await page.evaluate(() =>
    localStorage.getItem("vingilot-diff-tab-prefs.v1"),
  );
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored as string)).toEqual({
    ignoreWhitespace: true,
    wrap: true,
  });
  await expect(
    tab.locator('[data-testid^="history-patch-"]').first(),
  ).toHaveAttribute("data-wrapped", "true");
});

// ── P4.8 · the same diff, two shapes ────────────────────────────────────────
//
// > *"diff split te unified'dan farkli"* … *"ui olarak ta farkli"*
//
// **A rendering mode may change the shape of the information, never its content
// — and never its vocabulary.** P4.6 shipped split as a lesser citizen: it drew
// no word-level highlight, offered no comment affordance, rendered no review
// thread, was never windowed, and drew its gutters, its wrapping and its filler
// rows in a language of its own. Every claim below is that rule, read off the
// page in both modes on the same real commit.

/** Every line the patch bodies are showing, as `sign · code`, in order — the
 * reading that says two layouts are showing the same diff and not merely two
 * plausible diffs. Numbers come from `data-diff-nos` in both modes because in
 * both modes they are generated content, which is the point of gap 6. */
async function linesOnScreen(page: Page, mode: "split" | "unified") {
  return page.evaluate((which) => {
    const clean = (text: string) => text.replace(/ /g, " ");
    if (which === "unified") {
      return Array.from(
        document.querySelectorAll("[data-diff-sign]"),
        (row) => {
          const code = row.querySelector("[data-diff-code]");
          return `${row.getAttribute("data-diff-sign")}·${clean(code?.textContent ?? "")}`;
        },
      );
    }
    // In split one context row is drawn in TWO cells — the same line of the
    // same file, once per column. Unified draws it once, so the right-hand copy
    // is skipped: this compares what the reader is told, not how many boxes
    // told him. P4.8b: the two cells of a pair are in two different column
    // scrollers now, so "the left one" is a selector rather than "the first
    // child of the row".
    //
    // `[data-diff-code]` and not the cell's own text, in BOTH branches: the
    // comment affordance is a `+` glyph living inside the cell (out of flow,
    // over the gutter), so a cell's `textContent` is the code with a `+` in
    // front of it. It is `display:none` until hovered and therefore not in what
    // a drag copies, but it is in what `textContent` reads — and a reading that
    // included it would be comparing the button, not the line.
    const out: string[] = [];
    for (const cell of document.querySelectorAll(
      '[data-split-cell="before"][data-split-kind="context"]',
    )) {
      const code = cell.querySelector("[data-diff-code]");
      out.push(`ctx·${clean(code?.textContent ?? "")}`);
    }
    return out;
  }, mode);
}

/** A readable band of the card `target` sits in, centred on it.
 *
 * A whole file card is thousands of pixels tall — `locator.screenshot()` of one
 * is a picture of mostly nothing with the subject somewhere in it, which is a
 * screenshot nobody reads. The band is the card's own width (so both columns
 * are in frame) and a few rows of height, clamped to the viewport. */
async function band(page: Page, target: Locator, path: string) {
  const HEIGHT = 300;
  const spot = await target.boundingBox();
  const card = await target
    .locator("xpath=ancestor::*[@data-diff-card][1]")
    .boundingBox();
  const view = page.viewportSize();
  expect(spot).not.toBeNull();
  expect(card).not.toBeNull();
  const box = spot as NonNullable<typeof spot>;
  const outer = card as NonNullable<typeof card>;
  const height = Math.min(HEIGHT, view?.height ?? HEIGHT);
  const y = Math.max(
    0,
    Math.min(box.y - height / 3, (view?.height ?? height) - height),
  );
  await waitForAnimations(page);
  await page.screenshot({
    clip: { height, width: outer.width, x: outer.x, y },
    path,
  });
}

test("§4 · P4.8 split shows the SAME lines as unified, in the same vocabulary", async ({
  page,
}) => {
  const tab = await openCommitTab(page);
  await tab.getByTestId("diff-tab-expand-all").click();
  const patch = tab.locator(`[data-testid="history-patch-${REAL_MIXED_PATH}"]`);
  await expect(patch).toBeVisible();

  // **Unified first**, and everything that is true of it is what split is then
  // held to. A patch this size is not windowed in either mode, so both readings
  // are of the whole file.
  await expect(patch).toHaveAttribute("data-mode", "unified");
  await expect(patch).toHaveAttribute("data-wrapped", "false");
  const unifiedWords = await tab.locator(".vingilot-wd").count();
  expect(unifiedWords).toBeGreaterThan(0);
  const unifiedContext = await linesOnScreen(page, "unified");
  await waitForAnimations(page);
  await patch.screenshot({ path: `${SHOTS_48}/p48-unified-hunk.png` });

  await tab.getByTestId("diff-tab-mode-split").click();
  await expect(patch).toHaveAttribute("data-mode", "split");

  // **Gap 5, and it is the one the two screenshots were of.** Split used to
  // wrap whatever the pane's width said, so a long line re-flowed on one side
  // and not the other and the pair stopped lining up. It now reads the same
  // `wraps` unified does — above the floor, off in both.
  await expect(patch).toHaveAttribute("data-wrapped", "false");

  // **Content.** Every context line unified drew, split draws, in order.
  const splitContext = await linesOnScreen(page, "split");
  expect(splitContext).toEqual(
    unifiedContext.filter((row) => row.startsWith("ctx·")),
  );
  expect(splitContext.length).toBeGreaterThan(0);

  const read = await patch.evaluate((card) => {
    const cells = Array.from(
      document.querySelectorAll("[data-split-cell]:not([data-split-filler])"),
    );
    // A pair is joined by `data-split-pair` since P4.8b — the two cells are in
    // two different column scrollers, which is what stopped one column's
    // longest line from setting the other column's width.
    //
    // **Scoped to THIS card, and that is the whole reason the join needs a
    // scope.** `data-split-pair` is a pair's index within its own patch, so
    // with every file expanded the fifth pair of six cards is six elements
    // under one key and `cells.length === 2` is never true — the reading would
    // silently find no pair to measure and the alignment claim would evaporate
    // while still looking asserted. Before this round the two cells of a pair
    // shared an ancestor, which scoped the join by construction; they are in
    // two different scrollers now, so the scope has to be said.
    const paired = new Map<string, Element[]>();
    for (const cell of card.querySelectorAll(
      '[data-split-cell][data-split-kind="change"]',
    )) {
      const at = cell.getAttribute("data-split-pair") ?? "";
      paired.set(at, [...(paired.get(at) ?? []), cell]);
    }
    const box = (el: Element | null | undefined) =>
      el === null || el === undefined ? null : el.getBoundingClientRect();
    const both =
      Array.from(paired.values()).find(
        (cells) =>
          cells.length === 2 &&
          cells.every((cell) => !cell.hasAttribute("data-split-filler")),
      ) ?? [];
    return {
      // Gap 1: the word-level highlight, on the layout where comparing tokens
      // is the entire point.
      words: document.querySelectorAll(".vingilot-wd").length,
      // Gap 6: the numbers are generated content in split too — nothing in the
      // cell's own text is a line number, so a drag over the code copies code.
      digitsInText: cells.filter((cell) =>
        /^\s*\d/.test(
          cell.querySelector("[data-diff-code]")?.textContent ?? "",
        ),
      ).length,
      numbered: cells.filter(
        (cell) => (cell.getAttribute("data-diff-nos") ?? "").trim() !== "",
      ).length,
      gutterColour:
        cells[0] === undefined
          ? null
          : getComputedStyle(cells[0], "::before").color,
      // Gap 8 / the alignment claim: the two cells of a pair start at the same
      // y and are the same height, and that height is the mockup's 22px row.
      pairTops: both.map((cell) => Math.round(box(cell)?.top ?? -1)),
      pairHeights: both.map((cell) => Math.round(box(cell)?.height ?? -1)),
      // Gap 7: a gap is a drawn band rather than an unpainted hole. Scoped to
      // the fillers that really are gaps: P4.8b draws the OTHER kind — a side
      // the patch does not have at all — as plain ground, because a wall of
      // hatch down an added file says "nothing here" once per row about a side
      // that does not exist.
      fillers: document.querySelectorAll('[data-split-filler="gap"]').length,
      hatched: Array.from(
        document.querySelectorAll('[data-split-filler="gap"]'),
      ).every((cell) => getComputedStyle(cell).backgroundImage !== "none"),
    };
  });

  expect(read.words).toBeGreaterThan(0);
  expect(read.numbered).toBeGreaterThan(0);
  expect(read.digitsInText).toBe(0);
  // The same muted ink unified's numbers wear — one gutter drawing, not two.
  expect(read.gutterColour).not.toBeNull();
  expect(read.pairTops.length).toBe(2);
  expect(read.pairTops[0]).toBe(read.pairTops[1]);
  expect(read.pairHeights[0]).toBe(ROW_H);
  expect(read.pairHeights[1]).toBe(ROW_H);
  expect(read.fillers).toBeGreaterThan(0);
  expect(read.hatched).toBe(true);

  await waitForAnimations(page);
  await patch.screenshot({ path: `${SHOTS_48}/p48-split-hunk.png` });
  await page.getByTestId("work-surface").screenshot({
    path: `${SHOTS_48}/p48-split-surface.png`,
  });

  // And the word highlight where it can actually be looked at: the first marked
  // pair, scrolled to and shot in its own card. Aimed rather than cropped —
  // "the first `.wd` on the page" is a different row in every commit, and a
  // fixed clip would eventually photograph blank ground and still pass.
  const marked = tab.locator(".vingilot-wd").first();
  await marked.scrollIntoViewIfNeeded();
  await band(page, marked, `${SHOTS_48}/p48-split-word-diff.png`);
});

test("§4 · P4.8 split offers the comment affordance and the same thread slot", async ({
  page,
}) => {
  const tab = await openCommitTab(page);
  await tab.getByTestId("diff-tab-expand-all").click();
  await tab.getByTestId("diff-tab-mode-split").click();

  // **Gap 2.** Hidden until hovered, over the gutter, on the side the reader is
  // actually on — the same `.addbtn` the unified row has offered since P4.6.
  const cell = tab
    .locator(
      '[data-split-cell][data-split-kind="change"]:not([data-split-filler])',
    )
    .first();
  await expect(cell).toBeVisible();
  const button = cell.locator("[data-diff-comment-button]");
  await expect(button).toBeHidden();
  await cell.hover();
  await expect(button).toBeVisible();
  await waitForAnimations(page);
  // The row that is really hovered, not a fixed box: two shots of the same box
  // in two states is how a screenshot set comes out byte-identical.
  await band(page, cell, `${SHOTS_48}/p48-split-hover.png`);

  // **Gap 3.** The slot a review thread renders into is `renderAfter`'s, and in
  // split it now exists — spanning both columns, between the pair and the next
  // one. This fixture's relay has no anchored note (§5 asserts exactly that, and
  // a seeded one would be words no agent wrote), so what is read here is the
  // other thing that lands in the same slot: the composer `⌥⏎` opens.
  await page.keyboard.press("j");
  await expect(tab.locator('[data-diff-focused="true"]')).toHaveCount(1);
  await page.keyboard.press("Alt+Enter");
  const composer = tab.getByTestId("diff-tab-composer");
  await expect(composer).toBeVisible();
  await expect(composer).toContainText(":");
  // It spans the pair rather than sitting in one column: a note about a line is
  // not a fact about one side's file.
  const spans = await composer.evaluate((node) => {
    const grid = node.closest("[data-select='text']");
    const slot = node.parentElement;
    if (grid === null || slot === null) return null;
    return {
      cell: Math.round(slot.getBoundingClientRect().width),
      grid: Math.round(grid.getBoundingClientRect().width),
    };
  });
  expect(spans).not.toBeNull();
  const laid = spans as NonNullable<typeof spans>;
  expect(Math.abs(laid.cell - laid.grid)).toBeLessThanOrEqual(1);

  await composer.scrollIntoViewIfNeeded();
  await band(page, composer, `${SHOTS_48}/p48-split-thread-slot.png`);
});

test("§2 Review… opens P4's reviewer popover, not a second one", async ({
  page,
}) => {
  const tab = await openCommitTab(page);
  await tab.getByTestId("diff-tab-review").click();
  // The same body the status bar renders (`StatusBarReviewPopover`), with the
  // same `useReviewDispatch` behind it — one reviewer, one instruction, one
  // real send.
  await expect(page.getByTestId("review-popover")).toBeVisible();
  await expect(page.getByTestId("review-instruction")).toBeVisible();
});

test("§5 with no anchored note in the thread, no review thread is drawn", async ({
  page,
}) => {
  // **The rule the owner's clarification makes, as an assertion.** The inline
  // thread is the LOCAL review agent's — a reply in this worktree's team
  // thread naming a `path:line` in this diff. This fixture's relay has no such
  // reply, so the honest rendering is none at all: a seeded sample comment
  // would put words on screen that no agent wrote, and a PR fetch would be the
  // wrong section of the app entirely.
  const tab = await openCommitTab(page);
  await tab.getByTestId("diff-tab-expand-all").click();
  await expect(tab.locator("[data-review-note]")).toHaveCount(0);
  await expect(tab.getByTestId("diff-tab-unresolved")).toContainText(
    "0 unresolved review comments",
  );
});

test("§6 the footer tallies what is on screen, and ⌘K is a third door onto the tab", async ({
  page,
}) => {
  const tab = await openCommitTab(page);
  const foot = tab.getByTestId("diff-tab-foot");
  await expect(foot).toContainText(`${REAL_DIFF.files.length} files`);
  await expect(foot).toContainText(`+${REAL_DIFF.additions}`);
  await expect(foot).toContainText("next change");
  await expect(foot).toContainText("comment");

  // ⌘K's row — the brief's third door. The other two are the History row this
  // test opened with and the Diff pane's own button.
  await page.keyboard.press("Meta+k");
  await page.getByTestId("palette-input").fill("worktree's diff");
  await page.getByTestId("palette-row-action:open-diff-tab").click();
  await expect(page.getByTestId("diff-tab-worktree")).toBeVisible();
});
