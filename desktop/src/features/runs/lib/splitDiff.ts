// The rows of the unified rendering, PAIRED into the rows of a two-column one
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 2; redesign
// P4.8).
//
// **The screenshot he sent is VS Code's split diff, and the thing that makes it
// readable is not the two columns — it is that they line up.** A deleted line
// and the line that replaced it are on the same row of the page, so the eye
// travels sideways rather than counting downwards. That alignment is the whole
// content of this file, and it is arithmetic, which is why it is here and not
// in the component: `ui/PatchSplit.tsx` draws rows, this decides what a row is.
//
// **P4.8 changed what this takes in, and that is the round's whole fix.** Until
// now it took the raw patch and re-derived everything from it — its own line
// numbering, its own idea of what plumbing is, its own row vocabulary. Two
// models of one patch is how a layout toggle came to change the CONTENT of the
// diff: the word markup, the review threads and the comment affordance were all
// keyed by a unified row index that this model had no notion of, so split could
// not draw any of them; "ignore whitespace" filtered the unified rows and this
// file never saw the filter, so the toggle did nothing in split. Now it takes
// `unifiedRows`' own output and only PAIRS it. Every row here points back at
// the index it came from, so anything keyed by a unified row index — markup,
// focus, a thread anchor, a comment — reaches both layouts unchanged, and
// neither layout can disagree with the other about what is in the patch.
//
// **The pairing rule, and why it is not "zip the hunk".** A unified hunk is a
// run of context, then a block of `-` lines, then a block of `+` lines, then
// more context. Pairing is per *block*, not per hunk: the nth deletion of a
// block sits beside the nth addition of the same block, and whichever list is
// longer spends its tail on half-rows. That is what makes a hunk with three
// deletions and one addition align — one paired row and two rows with an empty
// right side — instead of the two sides sliding apart for the rest of the file.
// A block ends at anything that is not a `+` or a `-`: context, the next hunk
// header, a note, or the end of the patch.
//
// It is deliberately the same block shape `diffTab.ts`'s `wordMarkup` pairs on,
// stated once in each file because one answers "which rows sit beside which"
// and the other answers "which tokens changed between them". They agree by
// construction: both walk `unifiedRows`' array, so the pair this file draws is
// the pair that module marked up.
//
// **What is NOT here.** How a patch line is classified is `lib/runModel.ts`'s
// `diffView`; what a row IS and what number it carries is
// `lib/unifiedDiff.ts`'s; whether split is offered at all is
// `lib/diffLayout.ts`'s `splitFitsAt`. And there is **no word-diff engine**
// here: which tokens of a pair changed is `lib/wordDiff.ts`'s answer, arrived
// at once for the whole patch and read by both layouts.

import type {
  DiffRow,
  HunkRow,
  LineRow,
} from "@/features/runs/lib/unifiedDiff";

/** One side of one paired row: the unified row itself, and **the index it has
 * in the unified rows array**.
 *
 * The index is the load-bearing field. It is what the word markup is keyed by
 * (`diffTab.ts`'s `WordMarkup`), what the keyboard's focus is (`DiffTab`'s
 * `focus.row`), what a comment is opened on and what a review thread is
 * anchored after — so carrying it here is what makes those four things
 * available in split without a single one of them being reimplemented. */
export interface PairSide {
  at: number;
  row: LineRow;
}

/** A row of the two-column rendering.
 *
 * - `hunk` — a hunk header. Drawn across both columns, because putting one in
 *   a column would claim it is a fact about that side's file.
 * - `note` — something git printed that is neither plumbing nor a line of
 *   either file (`\ No newline at end of file`, the backend's truncation
 *   marker). Also spans; also not a fact about one side.
 * - `context` — an unchanged line, present in both files and numbered in both.
 *   ONE unified row, drawn in two cells: the two sides are the same row, which
 *   is why this carries a single `at` rather than a `PairSide` each. A thread
 *   anchored to it is therefore anchored once.
 * - `change` — a deletion, an addition, or the two of them paired. Exactly one
 *   of `before`/`after` may be `null`, and that null is the row's whole point:
 *   it is the gap that keeps the other side aligned.
 */
export type PairedRow =
  | { kind: "hunk"; at: number; row: HunkRow }
  | { kind: "note"; at: number; text: string }
  | { kind: "context"; at: number; row: LineRow }
  | { kind: "change"; before: PairSide | null; after: PairSide | null };

/** `rows` — the output of `unifiedRows`, optionally filtered — as the rows of
 * the two-column rendering.
 *
 * Pure, total, and never throws. Every `at` is an index into the array that was
 * passed in, so a caller that filtered its rows gets pairs over the filtered
 * rows and indices that still address them.
 */
export function pairRows(rows: readonly DiffRow[]): PairedRow[] {
  const out: PairedRow[] = [];
  let at = 0;
  while (at < rows.length) {
    const row = rows[at];
    if (row.kind === "hunk") {
      out.push({ at, kind: "hunk", row });
      at += 1;
      continue;
    }
    if (row.kind === "note") {
      out.push({ at, kind: "note", text: row.text });
      at += 1;
      continue;
    }
    if (row.sign === " ") {
      out.push({ at, kind: "context", row });
      at += 1;
      continue;
    }
    // A change block: the run of deletions, then the run of additions that
    // replaces them. Either run may be empty — a pure addition is a block whose
    // deletions are none, and its rows are gaps on the left.
    const dels: PairSide[] = [];
    while (at < rows.length) {
      const here = rows[at];
      if (here.kind !== "line" || here.sign !== "-") break;
      dels.push({ at, row: here });
      at += 1;
    }
    const adds: PairSide[] = [];
    while (at < rows.length) {
      const here = rows[at];
      if (here.kind !== "line" || here.sign !== "+") break;
      adds.push({ at, row: here });
      at += 1;
    }
    const height = Math.max(dels.length, adds.length);
    for (let n = 0; n < height; n += 1) {
      out.push({
        after: adds[n] ?? null,
        before: dels[n] ?? null,
        kind: "change",
      });
    }
  }
  return out;
}
