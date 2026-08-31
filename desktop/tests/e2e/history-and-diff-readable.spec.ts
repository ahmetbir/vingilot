// The History graph and the diff, read at this repository's real scale —
// redesign P4.3 and P4.4.
//
// > *"suanki hali kullanilamaz gibi… su graph kismina bisi anlasilmiyo."*
// > *"diff ui'i artik guzel olsun bi tik yaaa hala cok terminal gibi."*
//
// **Both defects only exist at scale, so this spec runs on the real thing.**
// The bridge is fed this repository's own `git log --all` (200 commits, two
// dozen concurrent branches), its own `--first-parent` trunk, and a real
// commit's real `git diff` output — plumbing lines, enclosing-function hunk
// headers and all (`real-repo.fixtures.ts` argues why). A hand-written
// two-commit fixture has one lane and cannot show a lane column with no
// ceiling; a hand-written six-line patch has no `diff --git` to drop.
//
// What is asserted is what only real scale can exercise, and never a subject,
// a hash or a lane count — those move on the next commit and belong to the
// hand-written fixtures. What is asserted here is:
//
// P4.3 — the graph must be readable
//   1. In the dock, the lane gutter is BOUNDED and the subject has the room:
//      the graph is no wider than the mockup's own 42px, the subject is a real
//      width, and the sha on the right is inside the row rather than past it.
//   2. The header says which reading is on screen — "first-parent" where the
//      union does not fit, "all branches" where it does. Never the wrong one.
//   3. The same panel, opened as a full-width tab, gets the braid back.
//   4. Rows are the mockup's compact 38px.
//
// P4.4 — the diff must stop looking like terminal output
//   5. Not one line of git's wire format survives on screen.
//   6. The `@@` header is the quiet strip, carrying the enclosing function.
//   7. The code is not shifted: an added line's first character sits at the
//      same x as a context line's, because the sign is a column of its own.
//   8. Shiki coloured it — by language, over the tint.
//   9. A commit's file row is its hunks' header, and a long file is folded.

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
  "/private/tmp/claude-501/-Users-ahmetyusufbirinci/9a20f9f6-1102-43cb-8495-976fd565d0ea/scratchpad/p42-shots";

/** The mockup's `.gsvg` is 42px and `commitGraph.ts`'s `MIN_LANES` is the two
 * columns that fit in it. The dock is narrower than any budget that would buy
 * a third, so this is the ceiling every assertion below is against. */
const MOCKUP_GUTTER_PX = 42;

/** `.grow2`'s own height. */
const ROW_H = 38;

test.beforeAll(() => {
  // **The precondition this whole file rests on.** If the checkout under test
  // had a trivial history, every assertion below would still pass while
  // proving nothing — so the shape of the data is asserted first, loudly.
  expect(ALL_REFS.length).toBeGreaterThan(50);
  const tips = new Set(ALL_REFS.flatMap((commit) => commit.refs));
  expect(tips.size).toBeGreaterThanOrEqual(3);
  expect(REAL_DIFF.files.length).toBeGreaterThan(1);
  expect(REAL_MIXED_PATH).not.toBe("");
  // And the patch really is git's wire format, or "the plumbing is gone" is a
  // claim about nothing.
  const raw = REAL_DIFF.files.map((file) => file.patch).join("\n");
  expect(raw).toContain("diff --git ");
  expect(raw).toContain("\nindex ");
});

/** Everything about one History row that has to be read off the laid-out
 * boxes: the graph's width, the subject's, and whether the meta on the right
 * is still inside the row. */
async function rowGeometry(page: Page) {
  return page.evaluate(() => {
    const row = document.querySelector('[data-testid^="dock-history-commit-"]');
    if (row === null) return null;
    const box = row.getBoundingClientRect();
    const svg = row.querySelector("svg");
    const subject = row.querySelector('[data-testid^="dock-history-subject-"]');
    const meta = row.lastElementChild;
    return {
      graph: svg === null ? 0 : Math.round(svg.getBoundingClientRect().width),
      height: Math.round(box.height),
      metaOverflow:
        meta === null
          ? null
          : Math.round(meta.getBoundingClientRect().right - box.right),
      subject:
        subject === null
          ? 0
          : Math.round(subject.getBoundingClientRect().width),
      subjectText: subject?.textContent ?? "",
    };
  });
}

test("in the dock the lanes are bounded and the subject is the row", async ({
  page,
}) => {
  await openRealWorkspace(page);
  await openDockTab(page, "history");
  await expect(page.getByTestId("dock-history-graph")).toBeVisible();
  await expect(
    page.getByTestId("dock-history-graph").getByRole("option").first(),
  ).toBeVisible();
  // **A panel must reach a terminal state**: rows, an honest empty sentence, or
  // an honest refusal. A permanent "reading this repository's history…" is the
  // one outcome that is never acceptable — and it is the outcome the owner got
  // live, from an effect that cancelled its own read (`DockHistoryPanel.tsx`).
  // The fixture makes a read cost 60ms so this assertion can fail.
  await expect(page.getByTestId("dock-history-reading")).toHaveCount(0);

  const laid = await rowGeometry(page);
  expect(laid).not.toBeNull();
  const row = laid as NonNullable<typeof laid>;

  // **The defect, inverted.** Measured live before this round: dockWidth 376,
  // subjectWidth 0, the graph 1212px of `shrink-0`. Now the graph is the
  // mockup's own gutter and the subject is what is left.
  expect(row.graph).toBeLessThanOrEqual(MOCKUP_GUTTER_PX);
  expect(row.subject).toBeGreaterThan(120);
  expect(row.subjectText.trim().length).toBeGreaterThan(0);
  // And the sha / author / age did not get pushed off the end of the row.
  expect(row.metaOverflow).not.toBeNull();
  expect(row.metaOverflow as number).toBeLessThanOrEqual(1);
  // The mockup's compact row, not a half-panel canvas.
  expect(row.height).toBe(ROW_H);

  // **The header says so, honestly.** This repository's union needs two dozen
  // lanes and the dock can draw two, so what is on screen is the trunk — and
  // the word for that is the word on screen.
  const scope = page.getByTestId("dock-history-scope");
  await expect(scope).toHaveAttribute("data-scope", "first-parent");
  await expect(scope).toContainText("first-parent");
  await expect(scope).not.toContainText("all branches");

  await waitForAnimations(page);
  await page.getByTestId("dock").screenshot({
    path: `${SHOTS}/p43-dock-history.png`,
  });
});

test("opened as a tab the same panel gets the braid back, and says so", async ({
  page,
}) => {
  await openRealWorkspace(page);
  await openDockTab(page, "history");
  await page.getByTestId("dock-history-open-tab").click();

  const tab = page.getByTestId("view-tab-history");
  await expect(tab).toBeVisible();
  await expect(tab).toHaveAttribute("data-active", "true");

  const staged = page
    .getByTestId("work-surface")
    .locator('[data-view-kind="history"] [data-testid="dock-history"]');
  await expect(staged).toBeVisible();
  // The tab does not offer the door that leads to it — that would be a loop.
  await expect(staged.getByTestId("dock-history-open-tab")).toHaveCount(0);

  const scope = staged.getByTestId("dock-history-scope");
  await expect(scope).toHaveAttribute("data-scope", "all-branches");
  await expect(scope).toContainText("all branches");
  // The rows, before anything is measured off them: the read costs 60ms in
  // this fixture on purpose (`real-repo.fixtures.ts`), so a measurement taken
  // the instant the header settles is a measurement of an empty list.
  await expect(staged.getByRole("option").first()).toBeVisible();

  // The braid is really wider here than the dock's gutter, which is the whole
  // of "the full-width tab is where a big graph gets room" — and it is still
  // bounded, with the subject still on the row.
  const wide = await page.evaluate(() => {
    const row = document.querySelector(
      '[data-view-kind="history"] [data-testid^="dock-history-commit-"]',
    );
    if (row === null) return null;
    const svg = row.querySelector("svg");
    const subject = row.querySelector('[data-testid^="dock-history-subject-"]');
    return {
      graph: svg === null ? 0 : Math.round(svg.getBoundingClientRect().width),
      row: Math.round(row.getBoundingClientRect().width),
      subject:
        subject === null
          ? 0
          : Math.round(subject.getBoundingClientRect().width),
    };
  });
  expect(wide).not.toBeNull();
  const braid = wide as NonNullable<typeof wide>;
  expect(braid.graph).toBeGreaterThan(MOCKUP_GUTTER_PX);
  expect(braid.graph).toBeLessThan(braid.row / 2);
  expect(braid.subject).toBeGreaterThan(200);

  await waitForAnimations(page);
  await page.getByTestId("work-surface").screenshot({
    path: `${SHOTS}/p43-history-tab.png`,
  });
});

/** What the unified patch drew, read off the boxes. */
async function patchReading(page: Page, root: string) {
  return page.evaluate((selector) => {
    const patch = document.querySelector(selector);
    if (patch === null) return null;
    const rows = Array.from(patch.querySelectorAll("[data-diff-sign]"));
    const codeOf = (row: Element) => row.querySelector("[data-diff-code]");
    const left = (row: Element | null) => {
      const code = row === null ? null : codeOf(row);
      return code === null
        ? null
        : Math.round(code.getBoundingClientRect().left);
    };
    const first = (sign: string) =>
      rows.find((row) => row.getAttribute("data-diff-sign") === sign) ?? null;
    const colours = new Set<string>();
    for (const row of rows.slice(0, 80)) {
      const code = codeOf(row);
      for (const span of code?.querySelectorAll("span") ?? []) {
        colours.add(getComputedStyle(span).color);
      }
    }
    return {
      addLeft: left(first("add")),
      colours: [...colours],
      ctxLeft: left(first("ctx")),
      delLeft: left(first("del")),
      highlighted:
        patch
          .querySelector("[data-highlighted]")
          ?.getAttribute("data-highlighted") ?? null,
      hunks: Array.from(
        patch.querySelectorAll("[data-diff-hunk]"),
        (hunk) => hunk.textContent ?? "",
      ),
      rows: rows.length,
      text: patch.textContent ?? "",
    };
  }, root);
}

test("the diff drops git's plumbing and stops shifting the code", async ({
  page,
}) => {
  await openRealWorkspace(page);
  await openDockTab(page, "diff");
  await expect(page.getByTestId("worktree-diff-patch")).toBeVisible();
  // **A MODIFIED file, not an added one.** The alignment reading below needs a
  // context line and an added line in the same patch, and a newly added file's
  // patch is nothing but `+` rows — the first fixture picked one and could not
  // have failed. `REAL_MIXED_PATH` is located, not pinned.
  const at = REAL_DIFF.files.findIndex((file) => file.path === REAL_MIXED_PATH);
  expect(at).toBeGreaterThanOrEqual(0);
  await page.getByTestId("worktree-diff-list-toggle").click();
  await page.getByTestId(`worktree-diff-file-${at}`).click();
  await expect(page.getByTestId("worktree-diff-open")).toHaveText(
    REAL_MIXED_PATH,
  );

  const read = await patchReading(page, '[data-testid="worktree-diff-patch"]');
  expect(read).not.toBeNull();
  const patch = read as NonNullable<typeof read>;
  expect(patch.rows).toBeGreaterThan(10);

  // **1. The plumbing is gone.** Every one of these is in the raw patch this
  // fixture was built from (asserted in `beforeAll`), and none of them is on
  // screen. The file row above already says which file this is.
  for (const wire of ["diff --git ", "index ", "--- a/", "+++ b/"]) {
    expect(patch.text).not.toContain(wire);
  }

  // **2. The `@@` header is the quiet strip with the human part.** git puts
  // the enclosing construct after the ranges when it can find one; that is
  // what a reader is actually looking for, so it leads.
  expect(patch.hunks.length).toBeGreaterThan(0);
  expect(patch.hunks.join("\n")).toContain("@@");

  // **3. The code is not shifted one character right.** This is the whole of
  // what made a diff read as terminal spew: the sign has a column, so an added
  // line's code starts at the same x as a context line's.
  expect(patch.addLeft).not.toBeNull();
  expect(patch.ctxLeft).not.toBeNull();
  expect(patch.addLeft).toBe(patch.ctxLeft);
  if (patch.delLeft !== null) expect(patch.delLeft).toBe(patch.ctxLeft);

  // **4. Shiki coloured it**, rather than a flat green and red wall. The
  // tokens arrive in the background, so this is the one thing here that waits.
  await expect(
    page.locator('[data-testid="worktree-diff-patch"] [data-highlighted]'),
  ).toHaveAttribute("data-highlighted", "true", { timeout: 15_000 });
  const lit = await patchReading(page, '[data-testid="worktree-diff-patch"]');
  expect((lit as NonNullable<typeof lit>).colours.length).toBeGreaterThan(2);

  // Put the list away before the shot: the drawer is a gesture the panel
  // offers, not the state the patch is read in.
  await page.getByTestId("worktree-diff-list-toggle").click();
  await expect(page.getByTestId("worktree-diff-files")).toHaveCount(0);
  await waitForAnimations(page);
  await page.getByTestId("dock").screenshot({
    path: `${SHOTS}/p44-dock-diff.png`,
  });
});

test("the same diff on the whole stage, and the commit patch's files are its headers", async ({
  page,
}) => {
  await openRealWorkspace(page);
  await openDockTab(page, "diff");
  await page.getByTestId("worktree-diff-open-tab").click();

  const staged = page
    .getByTestId("work-surface")
    .locator('[data-view-kind="diff"] [data-testid="pane-diff"]');
  await expect(staged).toBeVisible();
  // The mixed file, so the shot is of a patch with all three kinds of line in
  // it rather than of a one-line addition.
  const at = REAL_DIFF.files.findIndex((file) => file.path === REAL_MIXED_PATH);
  await staged.getByTestId(`worktree-diff-file-${at}`).click();
  await expect(staged.getByTestId("worktree-diff-open")).toHaveText(
    REAL_MIXED_PATH,
  );
  await expect(
    staged.locator('[data-testid="worktree-diff-patch"] [data-highlighted]'),
  ).toHaveAttribute("data-highlighted", "true", { timeout: 15_000 });
  // The file row carries the mockup's change square beside its numstat.
  await expect(staged.locator("[data-change-square]").first()).toBeVisible();

  await waitForAnimations(page);
  await page.getByTestId("work-surface").screenshot({
    path: `${SHOTS}/p44-diff-tab.png`,
  });

  // And the commit patch: one file row per file, each the header of its own
  // hunks, with the long ones folded until asked for.
  await openDockTab(page, "history");
  const first = page
    .getByTestId("dock-history-graph")
    .getByRole("option")
    .first();
  await first.click();
  await expect(page.getByTestId("history-patch-title")).toBeVisible();

  const rows = page.locator('[data-testid^="history-file-row-"]');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBe(REAL_DIFF.files.length);
  // At least one of this commit's files is long enough to be folded — the
  // fixture is a real commit, and a real commit has one. Clicking its row
  // opens it, which is the only thing a fold owes anybody.
  const folded = page.locator(
    '[data-testid^="history-file-row-"][aria-expanded="false"]',
  );
  expect(await folded.count()).toBeGreaterThan(0);
  const target = folded.first();
  const path = (await target.getAttribute("data-testid"))?.replace(
    "history-file-row-",
    "",
  );
  await expect(page.getByTestId(`history-patch-${path}`)).toHaveCount(0);
  await target.click();
  await expect(page.getByTestId(`history-patch-${path}`)).toBeVisible();
});
