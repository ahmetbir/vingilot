// The two-column rendering of a patch — old on the left, new on the right,
// hunks aligned row for row (redesign P4.8).
//
// > *"diff split te unified'dan farkli"* … *"ui olarak ta farkli"*
//
// **This file is an arrangement and nothing else, and that is the fix.** Split
// shipped in Task 2 as a second-class rendering: no word-level highlight, no
// comment affordance, no review threads, no windowing, its own gutters, its own
// wrapping, its own idea of what a filler row looks like. Every one of those
// was a feature that lived inside `PatchUnified` rather than beside it, so
// "split does not have it" was structural. P4.8 lifted them into
// `ui/PatchRow.tsx` and re-derived the row model from the unified rows
// (`lib/splitDiff.ts`'s `pairRows`), and what is left here is the two-column
// grid — the one thing that really is different about this layout.
//
// **A grid, and that is the whole layout decision.** The two obvious
// alternatives were measured against it and lost. Two independent scrolling
// columns keeps the sides aligned only while every row is exactly one line
// tall. Two clipped columns keeps alignment by throwing away the right-hand
// half of every long line, which is the complaint this plan is named after. A
// grid keeps both: the cells of one row are the same height whatever either of
// them contains, so a wrapped pair grows on BOTH sides, and nothing is cut off.
//
// **Wrapping is the caller's decision here exactly as it is in unified, and
// that is a change.** Split used to wrap unconditionally, which is what the
// owner photographed: at a wide pane the left cell re-flowed to three lines and
// the right to one, so the two columns stopped lining up — the one thing a
// side-by-side diff exists to do. Now `wraps` is honoured in both layouts. Off,
// each cell is one line and the two columns share ONE horizontal scroller (the
// grid is `w-max min-w-full` inside `PatchView`'s single `overflow-auto` box,
// so both halves move together and stay aligned). On — a pane under
// `patchWrapsAt`'s floor, or the Wrap toggle — both sides of a pair wrap, with
// the same hanging indent unified uses, and the grid row grows for both.
//
// **And wrapping off is what makes windowing exact**, which answers the other
// half of the deferred list. A pair of one-line cells is one 22px grid row, so
// `rowWindow`'s fixed-height arithmetic is as exact here as it is in unified
// and no measured-height pass is needed; when split wraps it renders whole,
// which is the same rule unified keeps for the same reason.
//
// **The cost of that choice, stated rather than discovered later.** With
// wrapping off the grid is sized to its content, and an `fr` track under
// content sizing takes the widest line in EITHER column — so one 140-column
// line anywhere in a file makes both halves 140 columns wide, and at a
// 1030px box the new side starts past the right edge until the reader scrolls.
// Unified has the same property and half the magnitude. The alternative is
// VS Code's: keep the halves at 50% and give each column its own horizontal
// scroller with the two synchronised — which a CSS grid cannot express, because
// a grid has no per-column scroll box, and which is therefore deferred rather
// than half-built here. What the reader has meanwhile is the toolbar's Wrap,
// which since this round applies to BOTH sides of every pair and puts the two
// halves back on screen; before it, split wrapped always and Wrap did nothing,
// so this is a choice he did not previously have.

import * as React from "react";

import { rowWindow, VIRTUALIZE_OVER_ROWS } from "@/features/runs/lib/diffTab";
import { pairRows } from "@/features/runs/lib/splitDiff";
import type { PairSide } from "@/features/runs/lib/splitDiff";
import type { DiffRow, LineRow } from "@/features/runs/lib/unifiedDiff";
import { unifiedRows } from "@/features/runs/lib/unifiedDiff";
import {
  CommentButton,
  halfGutter,
  HunkStrip,
  markupAt,
  NoteRow,
  paint,
  ROW_LEADING,
  ROW_PX,
  TINT,
  tokensAt,
  useDiffTokens,
  useRowOrdinals,
} from "@/features/runs/ui/PatchRow";
import type { UnifiedProps } from "@/features/runs/ui/PatchUnified";

/** Two columns, and nothing between them but the cells' own border.
 *
 * `minmax(0,1fr)` and not `1fr`: a `1fr` track has an `auto` minimum, so one
 * long unbroken line of source would push the column past its share and the two
 * sides would stop being halves. With the grid sized `w-max` (wrapping off)
 * both tracks resolve to the same max-content width, which is what keeps the
 * halves symmetric while the pair scrolls sideways together.
 *
 * **The gutters are no longer tracks of this grid.** They were, until P4.8, and
 * that is why they did not match unified's: a track of inline `<span>`s is a
 * different drawing from a hanging-indent block's generated content, in width,
 * in colour and in what a drag over the code selects. Each cell now carries its
 * own number the way `.vingilot-dline` does — see `.vingilot-dhalf`. */
const SPLIT_GRID = "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]";

/** A row that belongs to neither column — a hunk strip, a note, a review
 * thread, the comment composer, a windowing spacer.
 *
 * `w-0 min-w-full` rather than plain `col-span-2`: with the grid sized to its
 * content (wrapping off), a spanning item's own max-content would widen the two
 * code columns to fit a paragraph of review prose. A definite `width:0`
 * contributes nothing to track sizing and `min-width:100%` still draws it the
 * full width of the pair. */
const SPANS = "col-span-2 w-0 min-w-full";

type Props = Pick<
  UnifiedProps,
  | "focused"
  | "markup"
  | "onComment"
  | "patch"
  | "path"
  | "renderAfter"
  | "rows"
  | "window"
  | "wraps"
>;

export function SplitBody(props: Props) {
  const { markup, patch, path, renderAfter, wraps } = props;
  const derived = React.useMemo(() => unifiedRows(patch), [patch]);
  const rows: readonly DiffRow[] = props.rows ?? derived;
  const pairs = React.useMemo(() => pairRows(rows), [rows]);
  const tokens = useDiffTokens(rows, path);
  const ordinals = useRowOrdinals(rows);

  // Windowed under exactly the precondition unified states: not wrapping, so
  // every pair is one 22px grid row and the spacers are the missing pairs'
  // real height. Counted in PAIRS rather than in unified rows — a change block
  // of three deletions and one addition is three rows here and four there, and
  // a spacer sized from the wrong count is a scrollbar that moves under the
  // reader.
  const windowed =
    !wraps && props.window !== undefined && pairs.length > VIRTUALIZE_OVER_ROWS;
  const view = windowed
    ? rowWindow({
        count: pairs.length,
        rowHeight: ROW_PX,
        scrollTop: props.window?.scrollTop ?? 0,
        top: props.window?.top ?? 0,
        viewport: props.window?.viewport ?? 0,
      })
    : { end: pairs.length, start: 0 };

  /** What goes under a pair: the thread anchored to that line, the composer
   * `⌥⏎` opened. Called once per unified row the pair really carries, so a
   * context line — one row in two cells — is asked once and a paired rewrite is
   * asked for the removed line and for the added one, exactly as unified asks
   * for each of its two rows. */
  function after(sides: readonly (PairSide | null)[]): React.ReactNode {
    if (renderAfter === undefined) return null;
    const seen = new Set<number>();
    const out: React.ReactNode[] = [];
    for (const side of sides) {
      if (side === null || seen.has(side.at)) continue;
      seen.add(side.at);
      out.push(
        <div className={SPANS} key={side.at}>
          {renderAfter(side.row, side.at)}
        </div>,
      );
    }
    return out;
  }

  return (
    // Selectable as one region, with the gutters cut out of it — the unified
    // body's own arrangement and for the same measured reason.
    <div
      className={`grid font-mono text-xs ${ROW_LEADING} ${SPLIT_GRID} ${wraps ? "w-full" : "w-max min-w-full"}`}
      data-highlighted={tokens === null ? "false" : "true"}
      data-select="text"
      data-virtualized={windowed ? "true" : "false"}
    >
      {view.start > 0 ? (
        <div
          aria-hidden="true"
          className={SPANS}
          style={{ height: view.start * ROW_PX }}
        />
      ) : null}
      {pairs.slice(view.start, view.end).map((pair, offset) => {
        // Positional content, never reordered — the unified body's own key
        // rule. Absolute so a windowed render does not re-key every row on
        // every scroll.
        const key = view.start + offset;
        if (pair.kind === "hunk") {
          return (
            <div className="contents" data-split-row="hunk" key={key}>
              <div className={SPANS}>
                <HunkStrip row={pair.row} />
              </div>
            </div>
          );
        }
        if (pair.kind === "note") {
          return (
            <div className="contents" data-split-row="note" key={key}>
              <div className={SPANS}>
                <NoteRow text={pair.text} />
              </div>
            </div>
          );
        }
        if (pair.kind === "context") {
          const side = { at: pair.at, row: pair.row };
          return (
            <div className="contents" data-split-row="context" key={key}>
              <Cell
                {...cellProps(props, tokens, ordinals, markup)}
                no={pair.row.before}
                side={side}
                which="before"
              />
              <Cell
                {...cellProps(props, tokens, ordinals, markup)}
                no={pair.row.after}
                side={side}
                which="after"
              />
              {after([side])}
            </div>
          );
        }
        return (
          <div className="contents" data-split-row="change" key={key}>
            <Cell
              {...cellProps(props, tokens, ordinals, markup)}
              no={pair.before?.row.before ?? null}
              side={pair.before}
              which="before"
            />
            <Cell
              {...cellProps(props, tokens, ordinals, markup)}
              no={pair.after?.row.after ?? null}
              side={pair.after}
              which="after"
            />
            {after([pair.before, pair.after])}
          </div>
        );
      })}
      {view.end < pairs.length ? (
        <div
          aria-hidden="true"
          className={SPANS}
          style={{ height: (pairs.length - view.end) * ROW_PX }}
        />
      ) : null}
    </div>
  );
}

/** Everything a cell needs that is the same for every cell in the patch,
 * gathered once rather than threaded through five props at each of four call
 * sites. */
function cellProps(
  props: Props,
  tokens: ReturnType<typeof useDiffTokens>,
  ordinals: readonly number[],
  markup: Props["markup"],
) {
  return {
    focused: props.focused ?? null,
    markup,
    onComment: props.onComment,
    ordinals,
    tokens,
    wraps: props.wraps,
  };
}

/** One side of one row: its number, its tint, its code — and, on hover, the
 * same comment affordance a unified row offers.
 *
 * **A `null` side is the gap that keeps the other column aligned**, and it is
 * drawn rather than left empty. Until P4.8 it was a flat `bg-muted/30` block,
 * which at the scale of a real change block reads as a hole in the page rather
 * than as "there is nothing here": a twelve-line addition put a twelve-line
 * void down the left of the diff. It is now the quiet hatched band of
 * `.vingilot-dfill` — no text, so nothing in it is a contrast question, and
 * faint enough that the eye skims it instead of stopping on it. */
function Cell({
  focused,
  markup,
  no,
  onComment,
  ordinals,
  side,
  tokens,
  which,
  wraps,
}: {
  focused: number | null;
  markup: Props["markup"];
  /** The number this CELL shows: the row's `before` in the left column, its
   * `after` in the right. A cell never shows the other file's number, which is
   * the difference between this gutter and unified's. */
  no: number | null;
  onComment: ((row: number) => void) | undefined;
  ordinals: readonly number[];
  side: PairSide | null;
  tokens: ReturnType<typeof useDiffTokens>;
  which: "before" | "after";
  wraps: boolean;
}) {
  // The `border-l` between the two columns — `SPLIT_DIVIDER_PX`, counted into
  // the width floor. Only the new side carries it.
  const divides = which === "after" ? "border-l border-border/60" : "";
  if (side === null) {
    return (
      <div
        aria-hidden="true"
        className={`vingilot-dfill ${divides}`}
        // Still named by its COLUMN, and additionally as a filler. A gap that
        // stopped saying which side it was on would leave the two columns
        // unreadable from the outside — a spec could no longer say "the right
        // side of this row is the gap", which is the alignment claim itself.
        data-split-cell={which}
        data-split-filler=""
      />
    );
  }
  const row: LineRow = side.row;
  const isFocused = focused === side.at;
  return (
    <div
      className={`group relative vingilot-dhalf pr-2 ${divides} ${TINT[row.sign]} ${
        isFocused ? "vingilot-dline-focus" : ""
      }`}
      data-diff-focused={isFocused ? "true" : undefined}
      data-diff-nos={halfGutter(no)}
      data-diff-sign={
        row.sign === " " ? "ctx" : row.sign === "+" ? "add" : "del"
      }
      data-split-cell={which}
    >
      {onComment === undefined ? null : (
        <CommentButton
          line={no ?? side.at + 1}
          onClick={() => onComment(side.at)}
        />
      )}
      <span
        className={`text-foreground ${wraps ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}
        data-diff-code=""
      >
        {paint(
          row.text,
          tokensAt(tokens, ordinals, side.at),
          markupAt(markup, side.at),
        )}
      </span>
    </div>
  );
}
