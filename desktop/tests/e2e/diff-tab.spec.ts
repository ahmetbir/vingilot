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
import type { Page } from "@playwright/test";

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
