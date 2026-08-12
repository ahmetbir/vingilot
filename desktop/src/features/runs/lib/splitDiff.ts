// A unified patch, re-shaped into the rows of a two-column diff
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 2).
//
// **The screenshot he sent is VS Code's split diff, and the thing that makes it
// readable is not the two columns — it is that they line up.** A deleted line
// and the line that replaced it are on the same row of the page, so the eye
// travels sideways rather than counting downwards. That alignment is the whole
// content of this file, and it is arithmetic, which is why it is here and not
// in the component: `ui/PatchView.tsx` draws rows, this decides what a row is.
//
// **What is NOT here.** How a patch line is classified is still
// `lib/runModel.ts`'s `diffView` — the same function the unified rendering
// reads, called once here, so the two layouts cannot disagree about what a `+`
// is. Whether split is offered at all is `lib/diffLayout.ts`'s `splitFitsAt`.
// And there is **no word-diff engine**: Task 2 said "intraline emphasis if the
// patch data already carries it — do not build a word-diff engine for this",
// and a unified patch carries none, so no row here claims any. Where a line
// changed within itself is a question this model does not answer and does not
// pretend to.
//
// **The pairing rule, and why it is not "zip the hunk".** A unified hunk is a
// run of context, then a block of `-` lines, then a block of `+` lines, then
// more context. Pairing is per *block*, not per hunk: the nth deletion of a
// block sits beside the nth addition of the same block, and whichever list is
// longer spends its tail on half-rows. That is what makes a hunk with three
// deletions and one addition align — one paired row and two rows with an empty
// right side — instead of the two sides sliding apart for the rest of the file.
// A block ends at anything that is not a `+` or a `-`: context, the next hunk
// header, a meta line, or the end of the patch.

import { diffView } from "@/features/runs/lib/runModel";
import type { DiffLineKind } from "@/features/runs/lib/runModel";

/** One side of one row: the line as it is in that side's file, and its number
 * there. `no` is `null` only for a patch whose hunk header this model could not
 * read — a number it cannot count from is never guessed at. */
export interface SplitCell {
  no: number | null;
  text: string;
}

/** A row of the two-column rendering.
 *
 * - `span` — a line that belongs to neither side: a hunk header, a `+++`/`---`
 *   meta line, the backend's truncation marker, a `\ No newline at end of
 *   file`. It is drawn across both columns, because putting a hunk header in
 *   one of them would claim it is a fact about that side's file.
 * - `context` — an unchanged line, present in both files, numbered in both. A
 *   context row always carries numbers: a line this model could not count is
 *   preamble rather than context, and spans.
 * - `change` — a deletion, an addition, or the two of them paired. Exactly one
 *   of `before`/`after` may be `null`, and that null is the row's whole point:
 *   it is the gap that keeps the other side aligned.
 */
export type SplitRow =
  | { kind: "span"; lineKind: DiffLineKind; text: string }
  | { kind: "context"; before: SplitCell; after: SplitCell }
  | { kind: "change"; before: SplitCell | null; after: SplitCell | null };

/** `@@ -12,7 +30,9 @@`, and the two forms with the count left off (`@@ -1 +1
 * @@`), which git emits for a one-line range. Anything else leaves the
 * numbering unknown rather than wrong. */
const HUNK_RANGE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** The line without its marker column.
 *
 * Stripped because in split the *column* says which side a line is on, so a
 * leading `+` would be the same information twice — and worse, one character of
 * horizontal offset between the two sides, which is exactly the alignment this
 * file exists to keep. Stripped only when the marker is really there: a patch
 * whose context lines have had their leading space trimmed by some tool in the
 * middle is a patch whose first character is code, and eating it would be this
 * model quietly deleting source. */
function body(text: string, marker: string): string {
  return text.startsWith(marker) ? text.slice(marker.length) : text;
}

/** The rows of the two-column rendering of `patch`.
 *
 * Pure, total, and never throws: a patch this model cannot make sense of comes
 * back as span rows, which draw as the lines they are. The one thing it will
 * not do is answer with a number it did not count.
 */
export function splitRows(patch: string): SplitRow[] {
  const lines = diffView(patch).lines;
  const rows: SplitRow[] = [];
  // `null` until a hunk header has been read. Every line before the first one
  // is meta, so nothing is ever numbered from a count that was not stated.
  let beforeNo: number | null = null;
  let afterNo: number | null = null;
  let dels: SplitCell[] = [];
  let adds: SplitCell[] = [];

  /** Close the change block: pair the two lists positionally and let the
   * longer one run on into half-rows. */
  function flush() {
    const height = Math.max(dels.length, adds.length);
    for (let i = 0; i < height; i += 1) {
      rows.push({
        after: adds[i] ?? null,
        before: dels[i] ?? null,
        kind: "change",
      });
    }
    dels = [];
    adds = [];
  }

  const last = lines.length - 1;
  lines.forEach((line, at) => {
    switch (line.kind) {
      case "hunk": {
        flush();
        const range = HUNK_RANGE.exec(line.text);
        beforeNo = range === null ? null : Number(range[1]);
        afterNo = range === null ? null : Number(range[2]);
        rows.push({ kind: "span", lineKind: "hunk", text: line.text });
        return;
      }
      case "meta":
        flush();
        rows.push({ kind: "span", lineKind: "meta", text: line.text });
        return;
      case "del":
        dels.push({ no: beforeNo, text: body(line.text, "-") });
        if (beforeNo !== null) beforeNo += 1;
        return;
      case "add":
        adds.push({ no: afterNo, text: body(line.text, "+") });
        if (afterNo !== null) afterNo += 1;
        return;
      case "ctx": {
        flush();
        // `\ No newline at end of file` is a note about the line above, not a
        // line of either file. It advances no counter and belongs to no column.
        if (line.text.startsWith("\\")) {
          rows.push({ kind: "span", lineKind: "ctx", text: line.text });
          return;
        }
        // Before the first hunk header nothing is a line of either file yet.
        // git's `diff --git a/x b/x`, `index ab12..cd34 100644` and `similarity
        // index 96%` preamble has no marker column for `diffView` to classify it
        // by, so it arrives here as context — and a context row numbered from
        // counters that have not started is not a context row, it is preamble.
        // It spans, which is also what it draws as in unified.
        if (beforeNo === null && afterNo === null) {
          rows.push({ kind: "span", lineKind: "meta", text: line.text });
          return;
        }
        // A patch that ends in a newline splits into a trailing empty string,
        // which `diffView` classifies as context because it has no marker to
        // say otherwise. It is not a line of anybody's file: numbering it would
        // put a phantom line at the end of the diff and shift nothing, but the
        // number beside it would be a lie. The unified rendering shows it as a
        // blank because it has no numbers to be wrong about.
        if (line.text === "" && at === last) return;
        const text = body(line.text, " ");
        rows.push({
          after: { no: afterNo, text },
          before: { no: beforeNo, text },
          kind: "context",
        });
        if (beforeNo !== null) beforeNo += 1;
        if (afterNo !== null) afterNo += 1;
        return;
      }
    }
  });
  flush();
  return rows;
}
