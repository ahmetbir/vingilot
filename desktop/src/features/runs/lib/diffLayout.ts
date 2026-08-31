// How the Diff pane divides itself between the list of changed files and the
// patch of the one that is open
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 1).
//
// **The complaint, and what was actually wrong.** On the owner's 16-inch
// MacBook Pro the diff was not merely cramped — the patch was gone. Measured at
// its default 1728×1117, on the three-column build this screen had at the time:
// the sidebar takes 300px, the projects rail 192px and
// the worktree column 224px, which leaves the work surface **1003px**. Of that,
// `paneModel.ts`'s `MIN_LEFT_PX` — 80 terminal columns, the top-ranked rule on
// that surface — claims 752px, and the divider 8px, so the Diff pane is laid
// out at **243px**. Inside it the file list was `w-72 shrink-0`: a **288px**
// box that does not give way, 45px wider than the pane containing it. Flex had
// nothing to take from the list, so it took everything from the other child:
// the patch scroller measured **32px** of client width against 704px of
// content. Four characters of a diff.
//
// So the squeeze is not the flexbox being unlucky, and it is not the terminal
// floor being wrong. `MIN_LEFT_PX` is doing exactly what it says and its
// argument still holds — a re-wrapped tmux scrollback does not come back. What
// was wrong is one constant in the pane: **a fixed width that outranked the
// thing the pane exists to show.**
//
// **The decision: the file list yields.** The patch is the reading; the list is
// navigation, and navigation already has `j`/`k`/Enter (`diffKeys.ts`) and the
// open file's name in the patch header. So the list never takes width the patch
// needs. It gives ground first, from its preferred width down to a stated
// minimum, and when even that will not fit it stops standing beside the patch
// at all: it becomes a drawer over it, opened from the patch header. The patch
// then has the whole pane, which at 243px is a narrow patch — but a narrow
// patch is a patch, and 32px was not.
//
// **The numbers moved once and the decision did not.** Merging the two nav
// columns into one (vingilot/docs/plans/2026-08-11-one-column-design.md) gave
// the work surface the 192px the project list was spending, and all of it lands
// here, because `MIN_LEFT_PX` is a floor the terminal was already sitting on:
// the same laptop now measures a **1195px** surface and a **435px** Diff pane.
// That is still under `PATCH_MIN_PX`, so the list still yields and the patch
// still wraps — the pane would have needed another 32px before any of the
// reasoning above changed, which is worth knowing before the next window of
// space arrives and someone assumes it did.
//
// **The numbers are derived, not chosen.** Every one below comes off the
// measurement above so the arithmetic can be checked against what is drawn.

/** What the list is worth when the pane can afford it: today's `w-72`.
 *
 * Measured on a real row, a 288px list spends 80px on things that are not the
 * path — 7px for the change mark, 33px for `+12 −3`, 40px of padding and gaps —
 * and gives the path the remaining 208px. */
export const LIST_PREFERRED_PX = 288;

/** The narrowest a list of paths is still a list of paths.
 *
 * From the same measurement: 80px of the row is spoken for whatever the width,
 * so this leaves the path 96px — around thirteen characters of `text-sm`. That
 * is a file name, because the row elides its *directory* and never its name
 * (`labelParts` in `lib/worktreeDiff.ts`, `PathLabel` in
 * `ui/WorktreeDiffPanel.tsx`); a row that truncated the label as one string
 * would spend those thirteen characters on the head of the directory, which
 * every row in a folder shares. Under this width the name itself starts being
 * cut, and the owner is reading the header instead. */
export const LIST_MIN_PX = 176;

/** One `font-mono text-xs` cell, in CSS pixels. Measured in the pane rather
 * than assumed: a 100-character span in the patch's own classes came back
 * 722.5px wide. */
const PATCH_CELL_PX = 7.225;

/** The patch scroller's `px-4`. Counted for the same reason `paneModel.ts`
 * counts the terminal's chrome: a floor derived from cell width alone is short
 * by the padding, and here that is four characters. */
const PATCH_CHROME_PX = 32;

/** How much of a source line the patch has to be able to show before the list
 * is allowed to stand beside it.
 *
 * Sixty columns is not a standard the way the terminal's eighty is — nothing
 * wraps to it. It is a judgement, and the judgement is that a diff line is a
 * hunk marker, an indent and a statement: under sixty columns every line of
 * ordinary source ends in a horizontal scroll, and a pane the owner has to
 * scroll sideways to read one line of is a pane he opens VS Code instead of. */
const PATCH_MIN_COLUMNS = 60;

/** The patch's floor, in pixels. Unlike `MIN_LEFT_PX` this one is not a
 * guarantee — a pane narrower than this still shows the patch, because by then
 * the list has already left. It is the width at which the list stops being
 * affordable. */
export const PATCH_MIN_PX = Math.ceil(
  PATCH_MIN_COLUMNS * PATCH_CELL_PX + PATCH_CHROME_PX,
);

/** The narrowest a *split* column is still worth reading, in columns
 * (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 2: "width is a
 * precondition, not a hope").
 *
 * **`PATCH_MIN_COLUMNS` is not the number to double, and why is the whole
 * derivation.** Sixty columns is a floor against *horizontal scrolling* — read
 * its own paragraph: "under sixty columns every line of ordinary source ends in
 * a horizontal scroll, and a pane the owner has to scroll sideways to read one
 * line of is a pane he opens VS Code instead of." That paragraph is about a
 * pane the LIST is competing with for width; split is a mode the reader chose
 * for a surface already past 695px, and its two halves scroll sideways together
 * inside one scroller, so a long line moves both columns and never
 * de-aligns them (`ui/PatchSplit.tsx`). The 60 answers a question split does
 * not ask.
 *
 * **P4.8 correction.** This paragraph used to read "a split column does not
 * scroll sideways, it wraps" — which was true of the drawing and was the defect:
 * split wrapped whatever the reader asked for, so at a wide pane one cell of a
 * pair re-flowed to three lines and the other to one and the two columns stopped
 * lining up. Split now honours the same `wraps` unified does, and when it does
 * wrap, the grid is still what keeps a pair the same height on both sides. The
 * number below did not move; the sentence under it was wrong about the drawing.
 *
 * What a split column *does* have to be wide enough for is the comparison: the
 * eye reads the head of both cells and sees where the two lines part.
 *
 * **Measured on this fork's own source rather than judged.** 28,634 non-blank
 * lines of `desktop/src/features/runs/**` (2026-08-12) have a median length of
 * **38 columns** — p75 73, p90 78, which is biome's 80-column print width — and
 * a median leading indent of 2, p75 4. At thirty-eight columns a side, half the
 * lines of a diff of this codebase need no wrap at all and the other half wrap
 * once with their indent intact. Below it the columns start spending most of
 * themselves on indentation, which is the same characters on both sides and
 * therefore the one part of a line that carries no comparison at all. */
const SPLIT_MIN_COLUMNS = 38;

/** The line-number gutter one split column spends, in CSS pixels.
 *
 * `w-12` — the stock 3rem token, 48px at 1× — which seats the five digits and a
 * space that a gutter of `font-mono text-xs` needs (6 × `PATCH_CELL_PX` =
 * 43.35px) with room. Five digits because the backend's 512 KiB read cap
 * arrives a long way before a six-digit line number does.
 *
 * Unified pays no gutter: it has no second side to number against, and the
 * marker column it pays instead is inside the line's own text. That is why this
 * constant appears here and not above. Stated in px like every other number in
 * this file, at the 1× root font size the measurements were taken at; the
 * drawing uses the rem token, so a ⌘+ zoom scales the gutter with the text it
 * is numbering rather than freezing it. */
const SPLIT_GUTTER_PX = 48;

/** The `border-l` between the two columns. One pixel, counted for the same
 * reason `PATCH_CHROME_PX` is: a floor made only of cells is short by its
 * chrome. */
const SPLIT_DIVIDER_PX = 1;

/** What one split column spends on keeping its code off the next gutter:
 * `pr-2`, 8px at 1×.
 *
 * Only the trailing padding is counted. The cell's `pl-4` is cancelled by the
 * hanging indent's `-indent-4` for the *first* visual line of a line, and the
 * first visual line is the one this floor is about — a continuation is
 * deliberately indented under the code it continues. */
const SPLIT_CELL_PAD_PX = 8;

/** How wide the patch box has to be before two columns are offered at all.
 *
 * **695px**, and the whole of it is above: two columns of `SPLIT_MIN_COLUMNS`
 * with their gutters and their trailing padding, the divider between them, and
 * the scroller's own `px-4`. Unlike `PATCH_MIN_PX` this is not an accommodation
 * the patch falls back from — it is a *precondition*. Below it split is not
 * drawn narrow, it is not offered, and the toggle says so (`splitRefusal`).
 *
 * What that means on the machine the plan was written about, at 1728×1117:
 * the Diff pane in the side slot is 435px, so split is refused there — and
 * ⇧⌥⌘B, which hands the right pane the whole 1195px work surface (1159 of it
 * once the left rail takes its 36), leaves the patch 871px and split is
 * offered, at 50 columns a side. That is exactly the sentence Task 2 opens
 * with: room at full-screen diff view, not always in a side pane. */
export const SPLIT_MIN_PX = Math.ceil(
  2 *
    (SPLIT_MIN_COLUMNS * PATCH_CELL_PX + SPLIT_GUTTER_PX + SPLIT_CELL_PAD_PX) +
    SPLIT_DIVIDER_PX +
    PATCH_CHROME_PX,
);

/** Where the changed-file list goes.
 *
 * - `beside`: the list holds `listPx` of the pane and the patch has the rest.
 * - `over`: the patch has the pane, and the list is a drawer over it that the
 *   patch header opens. Not "the list is gone" — it is one gesture away, and
 *   the header says how many files it has. */
export type DiffListPlacement =
  | { where: "beside"; listPx: number }
  | { where: "over" };

/** The placement for a pane of `paneWidth` CSS pixels.
 *
 * A width of 0 — measured mid-layout, or inside a subtree with no box — answers
 * `beside` at the preferred width, which is what the pane rendered before it
 * had ever been measured. Inventing a narrow layout from a width nobody has
 * read is the mistake `paneModel.ts` names twice, and a pane that flashed its
 * drawer open on every mount would be this file making it a third time.
 *
 * `patchFloorPx` is how much the patch must be left, and it is a parameter
 * because a *split* patch needs more than a unified one (`SPLIT_MIN_PX`). The
 * decision this file states does not change by being handed a bigger floor —
 * "the list never takes width the patch needs" is the whole of it, and a split
 * patch needs more. Defaulting to `PATCH_MIN_PX` keeps every existing caller
 * and every existing number exactly as it was. */
export function diffListPlacement(
  paneWidth: number,
  patchFloorPx: number = PATCH_MIN_PX,
): DiffListPlacement {
  if (!Number.isFinite(paneWidth) || paneWidth <= 0) {
    return { listPx: LIST_PREFERRED_PX, where: "beside" };
  }
  if (paneWidth - LIST_PREFERRED_PX >= patchFloorPx) {
    return { listPx: LIST_PREFERRED_PX, where: "beside" };
  }
  const yielded = paneWidth - patchFloorPx;
  if (yielded >= LIST_MIN_PX) return { listPx: yielded, where: "beside" };
  return { where: "over" };
}

/** The pane width at which the list stops standing beside the patch. Exported
 * for the tests and for anything that needs to say the number out loud rather
 * than rediscover it. */
export const LIST_LEAVES_BELOW_PX = PATCH_MIN_PX + LIST_MIN_PX;

/** What the patch itself is laid out in, once the list has taken what it takes.
 * `beside` is never below `patchFloorPx` — that is what the placement above
 * guarantees — so this only says something new in the `over` case. */
function patchWidthPx(
  paneWidth: number,
  patchFloorPx: number = PATCH_MIN_PX,
): number {
  const placement = diffListPlacement(paneWidth, patchFloorPx);
  return placement.where === "over" ? paneWidth : paneWidth - placement.listPx;
}

/** Does the patch soft-wrap its lines instead of scrolling sideways?
 *
 * Sending the list away buys the patch the whole pane, and on this machine the
 * whole pane is still not `PATCH_MIN_COLUMNS`. Measured on the fixed build at
 * 1728×1117: the patch box is 243px, 211px of it inside its own `px-4`, which
 * at `PATCH_CELL_PX` is **29 columns** — and the fixture's 76-column source
 * line reported `scrollWidth` 581 against `clientWidth` 243. That is the
 * sentence `PATCH_MIN_COLUMNS` writes about itself: *a pane the owner has to
 * scroll sideways to read one line of is a pane he opens VS Code instead of.*
 * A third of a line is more than four characters and still not the complaint
 * answered.
 *
 * So below its own floor the patch stops pretending it has a column count and
 * wraps. Wrapping is not free — a diff is a grid, and a re-flowed line is no
 * longer aligned with the one above it — which is exactly why this is a floor
 * and not a preference: **above** `PATCH_MIN_PX` the grid is worth more than
 * the wrap, and below it there is no grid to protect, only a line the owner
 * cannot finish reading. Wrapped, 100% of every line is on screen; unwrapped
 * at 243px, 43% of one is.
 *
 * The alternative considered and not taken: widen the pane by giving the Diff
 * pane the surface to itself below some width (the `effectiveSolo` route that
 * already fires at 1512). That decides *for* him which of the terminal and the
 * diff he is looking at, on a machine where he demonstrably watches an agent
 * work in one while reading the other. Wrapping decides nothing; it only stops
 * hiding the right-hand half of every line. ⇧⌥⌘B is still there, and the pane
 * it gives is above the floor and does not wrap.
 *
 * Unmeasured (`0`) does not wrap, for the reason `diffListPlacement` gives:
 * a width nobody has read is not a narrow pane. */
export function patchWrapsAt(paneWidth: number): boolean {
  if (!Number.isFinite(paneWidth) || paneWidth <= 0) return false;
  return patchWidthPx(paneWidth) < PATCH_MIN_PX;
}

/** Is this pane wide enough to be *offered* two columns?
 *
 * Asked of the pane and answered through the same placement the pane will
 * actually lay out, with the split floor — so the answer is the truth about
 * what the patch will get, not about what the pane is. That matters because it
 * is what makes the answer **monotonic**: with the split floor in the
 * arithmetic, `splitFitsAt(w)` is exactly `w >= SPLIT_MIN_PX` for every width
 * (checked over 1…3000px in the tests). Had this asked the *unified* placement
 * instead, growing the pane could have taken split away — at 641px the list is
 * a drawer and the patch has 641, at 642px the list stands up and the patch
 * drops to 466 — and a control that appears, disappears and reappears as a
 * divider is dragged is worse than one that is never there.
 *
 * Unmeasured (`0`, NaN) is `false`, which is the opposite of `patchWrapsAt`'s
 * answer and right for the opposite reason: wrapping is the accommodation and
 * must not be applied to a width nobody read, while split is the luxury and
 * must not be *claimed* from one. The default is unified either way, so a pane
 * mid-layout offers nothing and the first real measurement decides. */
export function splitFitsAt(paneWidth: number): boolean {
  if (!Number.isFinite(paneWidth) || paneWidth <= 0) return false;
  return patchWidthPx(paneWidth, SPLIT_MIN_PX) >= SPLIT_MIN_PX;
}

/** Why split is not on offer here, in words, or `null` when it is.
 *
 * Task 2: "below it, the toggle says why it is disabled rather than
 * disappearing." A control that vanishes at some widths teaches the owner
 * nothing except that the app is inconsistent; one that is visibly unavailable
 * and states its own precondition teaches him the precondition. So the sentence
 * is short enough to sit on one line of the patch header at the 435px this pane
 * has on his laptop, and `splitRefusalDetail` carries the arithmetic for the
 * `title` of anyone who wants it. */
export function splitRefusal(paneWidth: number): string | null {
  if (splitFitsAt(paneWidth)) return null;
  if (!Number.isFinite(paneWidth) || paneWidth <= 0) {
    return `split needs ${SPLIT_MIN_PX}px of pane; this one has not been measured yet.`;
  }
  return `split needs ${SPLIT_MIN_PX}px of pane; this one has ${Math.round(paneWidth)}px.`;
}

/** The same refusal with its derivation, for a hover. Kept beside the sentence
 * rather than written into the component, so the number and the reason for the
 * number cannot drift apart. */
export const SPLIT_REFUSAL_DETAIL = `two readable columns are ${SPLIT_MIN_COLUMNS} columns a side plus their line-number gutters, which is ${SPLIT_MIN_PX}px of patch — widen the pane or give it the whole surface with ⇧⌥⌘B.`;
