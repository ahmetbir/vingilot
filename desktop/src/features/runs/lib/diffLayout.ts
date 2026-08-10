// How the Diff pane divides itself between the list of changed files and the
// patch of the one that is open
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 1).
//
// **The complaint, and what was actually wrong.** On the owner's 16-inch
// MacBook Pro the diff was not merely cramped — the patch was gone. Measured at
// its default 1728×1117: the sidebar takes 300px, the projects rail 192px and
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
 * so this leaves the path 96px — around thirteen characters of `text-sm`, which
 * is a file name and the tail of its directory. Under that the column shows
 * an ellipsis and a change mark, and the owner is reading the header instead. */
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
 * drawer open on every mount would be this file making it a third time. */
export function diffListPlacement(paneWidth: number): DiffListPlacement {
  if (!Number.isFinite(paneWidth) || paneWidth <= 0) {
    return { listPx: LIST_PREFERRED_PX, where: "beside" };
  }
  if (paneWidth - LIST_PREFERRED_PX >= PATCH_MIN_PX) {
    return { listPx: LIST_PREFERRED_PX, where: "beside" };
  }
  const yielded = paneWidth - PATCH_MIN_PX;
  if (yielded >= LIST_MIN_PX) return { listPx: yielded, where: "beside" };
  return { where: "over" };
}

/** The pane width at which the list stops standing beside the patch. Exported
 * for the tests and for anything that needs to say the number out loud rather
 * than rediscover it. */
export const LIST_LEAVES_BELOW_PX = PATCH_MIN_PX + LIST_MIN_PX;
