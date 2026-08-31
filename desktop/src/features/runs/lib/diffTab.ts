// The diff tab's arithmetic — the decisions the `.dv` surface draws and does
// not make (redesign P4.6, vingilot/design/mockup/DIFF-TAB-BRIEF.md).
//
// The brief describes a surface: a commit header with a change-ratio bar, a
// toolbar with Ignore whitespace, file cards, `J`/`K` between changed hunks,
// and a footer that tallies what is on screen. Every one of those is a
// *question about numbers or rows*, and every one of them is here so it can be
// tested under `node --test` with no renderer — the discipline every `lib/`
// module in this island keeps.
//
// **Nothing in this file invents a value.** The ratio bar is a rendering of
// git's own `additions`/`deletions`; the tally counts the rows that are really
// on screen; "ignore whitespace" HIDES rows and says how many, rather than
// recomputing a patch git did not answer — the counts in the header stay git's
// numstat, because a header that silently followed a view filter would be this
// surface claiming a smaller change than the one in the repository.
//
// **What is NOT here.** What a unified row is stays `lib/unifiedDiff.ts`'s;
// which tokens of a changed line changed is `lib/wordDiff.ts`'s; how any of it
// is drawn is `ui/PatchUnified.tsx`'s and `ui/DiffTab.tsx`'s.

import type { DiffRow } from "@/features/runs/lib/unifiedDiff";
import { wordDiff, type WordSegment } from "@/features/runs/lib/wordDiff";

// ---------------------------------------------------------------------------
// the change-ratio bar
// ---------------------------------------------------------------------------

/** One block of the mockup's `.barmini`. */
export type RatioBlock = "added" | "deleted" | "none";

/** GitHub's five-block bar: how much of this change is addition, how much
 * removal, and how much of the bar is simply not spoken for.
 *
 * **A change with lines in it always shows at least one block of each colour
 * it really has.** Proportional rounding alone gives a 200-line addition with
 * one deletion five green blocks — a bar that says "nothing was removed" about
 * a change that removed something. So a side with any lines at all takes a
 * block before the remainder is shared out, which is exactly what GitHub's own
 * bar does and the only rule here that is not plain arithmetic.
 *
 * A file git reports as `+0 −0` (a mode change, a binary) gets five neutral
 * blocks rather than an empty row: the bar is a fixed-width thing beside a
 * number, and an absent one would read as a layout bug. */
export function ratioBlocks(
  additions: number,
  deletions: number,
  blocks = 5,
): RatioBlock[] {
  const add = Math.max(0, Math.floor(additions));
  const del = Math.max(0, Math.floor(deletions));
  const total = add + del;
  if (blocks <= 0) return [];
  if (total === 0) return new Array<RatioBlock>(blocks).fill("none");

  let green = Math.round((add / total) * blocks);
  if (add > 0 && green === 0) green = 1;
  if (del > 0 && green === blocks) green = blocks - 1;
  let red = blocks - green;
  if (del === 0) red = 0;
  const out: RatioBlock[] = [];
  for (let at = 0; at < green; at += 1) out.push("added");
  for (let at = 0; at < red; at += 1) out.push("deleted");
  while (out.length < blocks) out.push("none");
  return out.slice(0, blocks);
}

// ---------------------------------------------------------------------------
// which rows are a rewrite of which
// ---------------------------------------------------------------------------

/** One row's word-level markup, keyed by the row's index in `unifiedRows`. */
export type WordMarkup = ReadonlyMap<number, readonly WordSegment[]>;

/** Pair the deletions of each change block with the additions that replace
 * them, and word-diff each pair.
 *
 * **A change block is git's own shape**: a run of `-` rows immediately
 * followed by a run of `+` rows, inside one hunk. Pairing is positional —
 * first removed line against first added line — and stops at the shorter run,
 * because the fourth added line of a block that removed three replaces nothing
 * and marking it up would be an invented correspondence.
 *
 * A block with only additions or only deletions is not a rewrite of anything
 * and gets no markup at all: its row is entirely new or entirely gone, which
 * the row's own tint already says. */
export function wordMarkup(rows: readonly DiffRow[]): WordMarkup {
  const marks = new Map<number, readonly WordSegment[]>();
  let at = 0;
  while (at < rows.length) {
    const row = rows[at];
    if (row.kind !== "line" || row.sign !== "-") {
      at += 1;
      continue;
    }
    const dels: number[] = [];
    while (at < rows.length) {
      const here = rows[at];
      if (here.kind !== "line" || here.sign !== "-") break;
      dels.push(at);
      at += 1;
    }
    const adds: number[] = [];
    while (at < rows.length) {
      const here = rows[at];
      if (here.kind !== "line" || here.sign !== "+") break;
      adds.push(at);
      at += 1;
    }
    const pairs = Math.min(dels.length, adds.length);
    for (let n = 0; n < pairs; n += 1) {
      const before = rows[dels[n]];
      const after = rows[adds[n]];
      if (before.kind !== "line" || after.kind !== "line") continue;
      const found = wordDiff(before.text, after.text);
      if (found === null) continue;
      marks.set(dels[n], found.before);
      marks.set(adds[n], found.after);
    }
  }
  return marks;
}

// ---------------------------------------------------------------------------
// ignore whitespace
// ---------------------------------------------------------------------------

/** The line with every run of whitespace collapsed away — what "ignore
 * whitespace" compares on. */
function bare(text: string): string {
  return text.replace(/\s+/g, "");
}

export interface FilteredRows {
  rows: DiffRow[];
  /** How many rows this filter took off the screen, so the surface can say so.
   * A filter that hid lines silently would be the diff lying by omission. */
  hidden: number;
}

/** The rows with whitespace-only changes dropped — `git diff -w`'s answer,
 * applied to the patch already in hand.
 *
 * **A view filter, and it says so.** git could answer this exactly if it were
 * asked again with `-w`, and it is deliberately not asked: a re-read costs a
 * subprocess per file and would give the toolbar a latency the mockup's toggle
 * does not have. What this does instead is drop the rows a `-w` read would not
 * have produced — a removed line and the added line that replaces it whose
 * only difference is whitespace — and report the count, so the header's
 * numbers (git's own numstat, unfiltered) and the body cannot silently
 * disagree.
 *
 * Only *paired* rows are dropped. A line that was purely added or purely
 * removed is a real change to the file whatever it contains, and blank lines
 * added on their own stay on screen. */
export function withoutWhitespaceChanges(
  rows: readonly DiffRow[],
): FilteredRows {
  const drop = new Set<number>();
  let at = 0;
  while (at < rows.length) {
    const row = rows[at];
    if (row.kind !== "line" || row.sign !== "-") {
      at += 1;
      continue;
    }
    const dels: number[] = [];
    while (at < rows.length) {
      const here = rows[at];
      if (here.kind !== "line" || here.sign !== "-") break;
      dels.push(at);
      at += 1;
    }
    const adds: number[] = [];
    while (at < rows.length) {
      const here = rows[at];
      if (here.kind !== "line" || here.sign !== "+") break;
      adds.push(at);
      at += 1;
    }
    if (dels.length !== adds.length) continue;
    const same = dels.every((index, n) => {
      const before = rows[index];
      const after = rows[adds[n]];
      return (
        before.kind === "line" &&
        after.kind === "line" &&
        before.text !== after.text &&
        bare(before.text) === bare(after.text)
      );
    });
    if (!same) continue;
    for (const index of dels) drop.add(index);
    for (const index of adds) drop.add(index);
  }
  if (drop.size === 0) return { hidden: 0, rows: [...rows] };
  return {
    hidden: drop.size,
    rows: rows.filter((_row, index) => !drop.has(index)),
  };
}

// ---------------------------------------------------------------------------
// J / K
// ---------------------------------------------------------------------------

/** The first row of every change block, in order — where `J` and `K` land.
 *
 * A block and not a line: holding `J` down a forty-line rewrite should walk
 * the file's changes, not its lines. A hunk header is deliberately not an
 * anchor either — git emits one per hunk whether or not the reader cares, and
 * the thing being looked for is the change under it. */
export function changeAnchors(rows: readonly DiffRow[]): number[] {
  const anchors: number[] = [];
  let inBlock = false;
  rows.forEach((row, at) => {
    const changed = row.kind === "line" && row.sign !== " ";
    if (changed && !inBlock) anchors.push(at);
    inBlock = changed;
  });
  return anchors;
}

/** Where the cursor goes from `from` (a flat index across the whole tab, or
 * `null` for "nowhere yet").
 *
 * Clamped at both ends rather than wrapping — `historyModel.ts`'s `stepRow`
 * rule and its reason: `J` held down at the last change silently starting
 * again at the top is how the owner ends up reading the wrong hunk. */
export function stepAnchor(
  anchors: readonly number[],
  from: number | null,
  dir: -1 | 1,
): number | null {
  if (anchors.length === 0) return null;
  if (from === null)
    return dir === 1 ? anchors[0] : anchors[anchors.length - 1];
  const at = anchors.indexOf(from);
  if (at === -1) {
    const next = anchors.findIndex((anchor) => anchor > from);
    if (dir === 1)
      return next === -1 ? anchors[anchors.length - 1] : anchors[next];
    return next <= 0 ? anchors[0] : anchors[next - 1];
  }
  return anchors[Math.min(Math.max(at + dir, 0), anchors.length - 1)];
}

// ---------------------------------------------------------------------------
// virtualization
// ---------------------------------------------------------------------------

/** How many rows past the viewport are drawn on each side, so a scroll does
 * not show blank ground before React catches up. */
const OVERSCAN = 24;

export interface RowWindow {
  start: number;
  end: number;
}

/** Which rows of a card are worth having in the DOM.
 *
 * **Fixed-height windowing, and the precondition is stated rather than
 * assumed.** In the layout this is used in — unified, not wrapping — every row
 * is exactly `rowHeight` tall, so the arithmetic is exact and no measurement
 * pass is needed: the spacers above and below are the missing rows' height and
 * the scrollbar never moves under the reader. The caller does not virtualize
 * at all where that is not true (split, or wrapped), because a windowing that
 * guessed heights would jump the scroll position, which is worse than a long
 * DOM.
 *
 * `top` is the card body's offset inside the scroller's content; `scrollTop`
 * and `viewport` are the scroller's own. A card entirely above or below the
 * viewport answers an empty window, which is the whole point. */
export function rowWindow(input: {
  count: number;
  rowHeight: number;
  scrollTop: number;
  top: number;
  viewport: number;
}): RowWindow {
  const { count, rowHeight, scrollTop, top, viewport } = input;
  if (count <= 0 || rowHeight <= 0 || viewport <= 0) {
    return { end: count, start: 0 };
  }
  const first = Math.floor((scrollTop - top) / rowHeight) - OVERSCAN;
  const last = Math.ceil((scrollTop + viewport - top) / rowHeight) + OVERSCAN;
  return {
    end: Math.max(0, Math.min(count, last)),
    start: Math.min(count, Math.max(0, first)),
  };
}

/** Past this many rows a file card is windowed. Under it the whole card is in
 * the DOM, because the spacers and the scroll bookkeeping cost more than 600
 * `<div>`s do. */
export const VIRTUALIZE_OVER_ROWS = 600;

// ---------------------------------------------------------------------------
// the footer's tally
// ---------------------------------------------------------------------------

/** How many files, in words. Counted from the cards really drawn, never from a
 * header number — a diff answer can list fewer files than it counted (the
 * backend's file cap) and the footer is the place that says what is on
 * screen. */
export function fileTally(files: number): string {
  return `${files} file${files === 1 ? "" : "s"}`;
}

/** The whitespace note, or `null` when nothing is hidden. */
export function hiddenNote(hidden: number): string | null {
  if (hidden <= 0) return null;
  return `${hidden} whitespace-only line${hidden === 1 ? "" : "s"} hidden`;
}
