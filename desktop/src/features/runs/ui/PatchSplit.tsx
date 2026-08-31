// The two-column rendering of a patch — old on the left, new on the right,
// hunks aligned row for row (redesign P4.8, P4.8b).
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
// arrangement — the one thing that really is different about this layout.
//
// **P4.8b: there are TWO arrangements, and which one is right is decided by
// `wraps`.** The round before this drew one grid in both cases and stated the
// cost of doing so; the owner then met the cost, and it is not payable.
//
// > He opened a commit in Split and the card for an ADDED file was a
// > full-height wall of hatched filler with no code in it at all.
//
// The cause, measured: `grid-cols-[minmax(0,1fr)_minmax(0,1fr)]` on a box sized
// `w-max`. Under max-content sizing CSS gives equal `fr` tracks the SAME width,
// so the grid is 2 × the widest line in EITHER column — and that file's longest
// line is 2,164 characters, about 14,300px, so the EMPTY left column was
// 14,300px too and the added code began about eleven screens to the right. For
// an added file that is the common case, not an edge: every new file in every
// diff greeted the reader with hatch.
//
// P4.8 deferred the repair as "VS Code's answer — halves at 50% with
// per-column synced scrollers — which a CSS grid cannot express". True of ONE
// grid; the conclusion does not follow. **With wrapping off every row is
// exactly 22px** — the same fact that round used to justify its windowing
// arithmetic — so a pair does not need a shared grid ROW to stay aligned. It
// only needs both cells to be one line tall, which they are by construction.
// So:
//
// - **Wrapping off** — two columns at 50% of the pane, each its own
//   `overflow-x` scroller, the two offsets synchronised. A long line in one
//   column no longer moves the other column's origin, because the other column
//   is a different box. See `ColumnRuns` below.
// - **Wrapping on** — the grid, unchanged. Heights vary there (a pair may be
//   one line on one side and three on the other), so shared grid rows are
//   exactly what keeps the pair aligned — and there is no horizontal scroll to
//   synchronise, because nothing overflows. See `GridRows`.
//
// **What a run is, and why the columns are per-run rather than per-patch.** A
// hunk strip, a note and a review thread belong to NEITHER column — putting one
// inside a column would claim it is a fact about that side's file, and clipping
// it to half the pane would be worse. A child of an `overflow-x` box cannot
// escape that box, so a full-width row cannot live inside a column scroller.
// The vertical flow is therefore: spanning rows at full width, and between them
// RUNS of consecutive pairs, each run a pair of column scrollers. Every scroller
// of the patch carries ONE synchronised offset and the same travel
// (`widestLine`), so the runs read as two columns that a full-width band happens
// to cross, and the two halves stay at the same column of text as each other.
//
// **What that costs, stated rather than discovered later.** One `scroll`
// listener per column scroller — two per run, and a card has as many runs as it
// has hunks. A gesture fires one event on the box under the pointer; the
// handler writes `scrollLeft` to the other runs of that side and returns
// immediately on the events those writes provoke, so a frame costs O(runs)
// property writes and no layout read. The alternative — one scroller for the
// pair, which is what P4.8 had — costs nothing and hides the code, which is the
// trade this round is reversing.
//
// **What is NOT here.** What a row IS stays `lib/unifiedDiff.ts`'s; which
// removed line pairs with which added one, which side of a patch is absent and
// how wide a column must be able to reach are `lib/splitDiff.ts`'s; the tint,
// the gutters, the comment affordance and the hunk strip are `ui/PatchRow.tsx`'s
// and shared with the unified layout. This file arranges them.

import * as React from "react";

import { rowWindow, VIRTUALIZE_OVER_ROWS } from "@/features/runs/lib/diffTab";
import { emptySide, pairRows, widestLine } from "@/features/runs/lib/splitDiff";
import type { PairedRow, PairSide } from "@/features/runs/lib/splitDiff";
import type { DiffRow, LineRow } from "@/features/runs/lib/unifiedDiff";
import { unifiedRows } from "@/features/runs/lib/unifiedDiff";
import {
  CommentButton,
  halfGutter,
  HunkStrip,
  markupAt,
  NO_WIDTH,
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

/** Two columns, and nothing between them but the cells' own border — the
 * WRAPPING arrangement, and since P4.8b only that one.
 *
 * `minmax(0,1fr)` and not `1fr`: a `1fr` track has an `auto` minimum, so one
 * long unbroken line of source would push the column past its share and the two
 * sides would stop being halves. The box is `w-full` here, never `w-max`: with
 * a definite width each track resolves to exactly half of it, which is the one
 * thing the max-content sizing could not do.
 *
 * **The gutters are no longer tracks of this grid.** They were, until P4.8, and
 * that is why they did not match unified's: a track of inline `<span>`s is a
 * different drawing from a hanging-indent block's generated content, in width,
 * in colour and in what a drag over the code selects. Each cell now carries its
 * own number the way `.vingilot-dline` does — see `.vingilot-dhalf`. */
const SPLIT_GRID = "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]";

/** A row that belongs to neither column — a hunk strip, a note, a review
 * thread, the comment composer, a windowing spacer — inside the grid. */
const SPANS = "col-span-2";

/** One column's own box: exactly half the pair, and its own horizontal
 * scroller. `min-w-0` because a flex item's `auto` minimum is its content, and
 * a 2,164-character line would take that minimum and stop the two from being
 * halves — the flex spelling of the same mistake `minmax(0,1fr)` avoids in the
 * grid. */
const COLUMN = "min-w-0 flex-1 overflow-x-auto";

/** The scrolled content INSIDE a column: as wide as the widest line it holds,
 * and never narrower than the column. Without it a cell would be the column's
 * own width and its tint would stop at the fold — the row's ground has to reach
 * as far as the row's text does. */
const COLUMN_CONTENT = "w-max min-w-full";

/** A code cell's trailing `pr-2`, in pixels. It belongs to the width reserve
 * below: a gap has no padding of its own, so a reserve counted in characters
 * alone makes the empty column exactly this much narrower than the full one —
 * and two scrollers that cannot reach the same offset are not synchronised. */
const CELL_PAD_PX = 8;

type Which = "after" | "before";

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

/** One drawn thing, in the order it is drawn: either a pair of cells or a row
 * that spans both columns. Derived once and consumed by whichever arrangement
 * is up, so the two layouts cannot disagree about what is in the patch or about
 * where a thread goes. */
type Slot =
  | {
      after: PairSide | null;
      at: number;
      before: PairSide | null;
      key: string;
      kind: "context" | "change";
      /** The number the LEFT cell shows, and the number the RIGHT one shows. A
       * cell never shows the other file's number. */
      nos: [number | null, number | null];
    }
  | {
      key: string;
      kind: "span";
      node: React.ReactNode;
      /** `hunk` / `note` for the two the model names, `null` for whatever a
       * caller's `renderAfter` put under a row. */
      row: "hunk" | "note" | null;
    };

/** A slot that really is a pair of cells — what a column holds. */
type PairSlot = Extract<Slot, { kind: "change" | "context" }>;

export function SplitBody(props: Props) {
  const { patch, renderAfter, wraps } = props;
  const derived = React.useMemo(() => unifiedRows(patch), [patch]);
  const rows: readonly DiffRow[] = props.rows ?? derived;
  const pairs = React.useMemo(() => pairRows(rows), [rows]);
  const tokens = useDiffTokens(rows, props.path);
  const ordinals = useRowOrdinals(rows);
  // Which side of this patch has no line at all, so the drawing can stop
  // shouting it once per row (`emptySide`'s own header).
  const absent = React.useMemo(() => emptySide(pairs), [pairs]);
  // How far a column has to be able to scroll, in characters — one answer for
  // both, because both carry one offset.
  const reach = React.useMemo(() => widestLine(pairs), [pairs]);
  const scroll = useColumnScroll();

  // Windowed under exactly the precondition unified states: not wrapping, so
  // every pair is one 22px row and the spacers are the missing pairs' real
  // height. Counted in PAIRS rather than in unified rows — a change block of
  // three deletions and one addition is three rows here and four there, and a
  // spacer sized from the wrong count is a scrollbar that moves under the
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

  const look: Look = {
    absent,
    focused: props.focused ?? null,
    markup: props.markup,
    onComment: props.onComment,
    ordinals,
    tokens,
    wraps,
  };
  // Not memoised: `renderAfter` is an inline closure at every call site, so a
  // memo keyed on it would miss on every render and cost a comparison to do it.
  const slots = slotsOf(pairs, view.start, view.end, renderAfter);

  return (
    // Selectable as one region, with the gutters cut out of it — the unified
    // body's own arrangement and for the same measured reason.
    <div
      className={`font-mono text-xs ${ROW_LEADING} w-full`}
      data-highlighted={tokens === null ? "false" : "true"}
      data-select="text"
      // Which of the two arrangements is drawn, so a spec can say it out loud
      // rather than infer it from a box's overflow.
      data-split-layout={wraps ? "grid" : "columns"}
      data-virtualized={windowed ? "true" : "false"}
    >
      {view.start > 0 ? (
        <div aria-hidden="true" style={{ height: view.start * ROW_PX }} />
      ) : null}
      {wraps ? (
        <GridRows look={look} slots={slots} />
      ) : (
        <ColumnRuns look={look} reach={reach} scroll={scroll} slots={slots} />
      )}
      {view.end < pairs.length ? (
        <div
          aria-hidden="true"
          style={{ height: (pairs.length - view.end) * ROW_PX }}
        />
      ) : null}
    </div>
  );
}

/** The pairs of the window, in order, with whatever the caller draws under a
 * row folded in as a spanning slot.
 *
 * **`renderAfter` is asked once per unified row the pair really carries**, so a
 * context line — one row in two cells — is asked once and a paired rewrite is
 * asked for the removed line and for the added one, exactly as unified asks for
 * each of its two rows. **And its answer is only kept if it draws anything**
 * (P4.8b MINOR-4): a caller that returns an empty fragment for every row — which
 * `DiffTab` does, because a thread is rare — used to get one empty spanning box
 * per row, seven of them for eight drawn rows. Unified emits nothing in the same
 * case, and now so does this. */
function slotsOf(
  pairs: readonly PairedRow[],
  start: number,
  end: number,
  renderAfter: Props["renderAfter"],
): Slot[] {
  const out: Slot[] = [];
  for (let at = start; at < end; at += 1) {
    const pair = pairs[at];
    if (pair.kind === "hunk") {
      out.push({
        key: `p${at}`,
        kind: "span",
        node: <HunkStrip row={pair.row} />,
        row: "hunk",
      });
      continue;
    }
    if (pair.kind === "note") {
      out.push({
        key: `p${at}`,
        kind: "span",
        node: <NoteRow text={pair.text} />,
        row: "note",
      });
      continue;
    }
    const context = pair.kind === "context";
    const side = context ? { at: pair.at, row: pair.row } : null;
    const before = context ? side : pair.before;
    const after = context ? side : pair.after;
    out.push({
      after,
      at,
      before,
      key: `p${at}`,
      kind: pair.kind,
      nos: context
        ? [pair.row.before, pair.row.after]
        : [before?.row.before ?? null, after?.row.after ?? null],
    });
    if (renderAfter === undefined) continue;
    const seen = new Set<number>();
    for (const one of [before, after]) {
      if (one === null || seen.has(one.at)) continue;
      seen.add(one.at);
      const node = renderAfter(one.row, one.at);
      if (!draws(node)) continue;
      out.push({ key: `a${one.at}`, kind: "span", node, row: null });
    }
  }
  return out;
}

/** Whether a render prop's answer will put anything on the page.
 *
 * Not `node === null`: the surface that owns the thread slot returns a fragment
 * whether or not there is a thread in it, so "did it return something" is the
 * wrong question. `React.Children.toArray` drops nulls and booleans but treats
 * a fragment as ONE node, so fragments are opened here rather than counted. */
function draws(node: React.ReactNode): boolean {
  return React.Children.toArray(node).some((child) => {
    if (!React.isValidElement(child)) return true;
    if (child.type !== React.Fragment) return true;
    const { children } = child.props as { children?: React.ReactNode };
    return draws(children);
  });
}

/** Everything a cell needs that is the same for every cell in the patch,
 * gathered once rather than threaded through six props at each call site. */
interface Look {
  absent: Which | null;
  focused: number | null;
  markup: Props["markup"];
  onComment: ((row: number) => void) | undefined;
  ordinals: readonly number[];
  tokens: ReturnType<typeof useDiffTokens>;
  wraps: boolean;
}

/** **Wrapping on**: one grid, and the pair is aligned because its two cells are
 * cells of the same grid row. A wrapped pair is one line on one side and three
 * on the other, and a grid row is as tall as its tallest cell, so both grow
 * together — which two independent columns could not do. Nothing overflows
 * sideways here, so there is no horizontal scroll to divide. */
function GridRows({ look, slots }: { look: Look; slots: readonly Slot[] }) {
  return (
    <div className={`grid ${SPLIT_GRID} w-full`}>
      {slots.map((slot) =>
        slot.kind === "span" ? (
          <div
            className={SPANS}
            data-split-row={slot.row ?? undefined}
            key={slot.key}
          >
            {slot.node}
          </div>
        ) : (
          // No `data-split-row` on a PAIR since P4.8b: that attribute now names
          // only the rows that belong to neither column, in both arrangements,
          // and a pair says what it is on each of its cells (`data-split-kind`)
          // — which is the only place a column layout has to put it.
          <div className="contents" key={slot.key}>
            <Cell divides={false} look={look} slot={slot} which="before" />
            <Cell divides look={look} slot={slot} which="after" />
          </div>
        ),
      )}
    </div>
  );
}

/** **Wrapping off**: the spanning rows at full width, and between them runs of
 * pairs drawn as two 50% columns that scroll independently and in step.
 *
 * The pair is aligned because both its cells are exactly one 22px line, in the
 * same position of two lists of the same length — `ROW_PX`'s own precondition,
 * which this layout is only ever used under. */
function ColumnRuns({
  look,
  reach,
  scroll,
  slots,
}: {
  look: Look;
  reach: number;
  scroll: ColumnScroll;
  slots: readonly Slot[];
}) {
  const out: React.ReactNode[] = [];
  let run: PairSlot[] = [];
  const close = () => {
    if (run.length === 0) return;
    const group = run;
    run = [];
    out.push(
      <div className="flex" data-split-run="" key={group[0].key}>
        <Column
          look={look}
          reach={reach}
          scroll={scroll}
          slots={group}
          which="before"
        />
        <Column
          look={look}
          reach={reach}
          scroll={scroll}
          slots={group}
          which="after"
        />
      </div>,
    );
  };
  for (const slot of slots) {
    if (slot.kind !== "span") {
      run.push(slot);
      continue;
    }
    close();
    out.push(
      <div data-split-row={slot.row ?? undefined} key={slot.key}>
        {slot.node}
      </div>,
    );
  }
  close();
  return <>{out}</>;
}

/** One side of one run: a scroller of exactly half the pair, holding that
 * side's cells and nothing else.
 *
 * `reach` in `ch` and not in pixels: the column is monospace and this is the
 * unit its width is really in, so the floor scales with a ⌘+ zoom the way every
 * other measurement in this drawing does. `NO_WIDTH + 1` is the gutter the cell
 * spends before its first character (`.vingilot-dhalf`'s 6ch). */
function Column({
  look,
  reach,
  scroll,
  slots,
  which,
}: {
  look: Look;
  reach: number;
  scroll: ColumnScroll;
  slots: readonly PairSlot[];
  which: Which;
}) {
  return (
    <div
      // The `border-l` between the two columns — `SPLIT_DIVIDER_PX`, counted
      // into the width floor. On the SCROLLER and not on the cells, so it stays
      // where the fold is instead of sliding away with the code.
      className={`${COLUMN} ${which === "after" ? "border-l border-border/60" : ""}`}
      data-split-column={which}
      onScroll={scroll.moved}
      ref={scroll.attach}
    >
      <div
        className={COLUMN_CONTENT}
        // The reserve has to count what a real cell really occupies, trailing
        // padding included. A code cell carries `pr-2`; a gap does not, so a
        // reserve of characters alone left the empty column 8px short and the
        // two scrollers could not reach the same offset — which is the one
        // thing this arrangement exists to guarantee.
        style={{
          minWidth: `calc(${reach + NO_WIDTH + 1}ch + ${CELL_PAD_PX}px)`,
        }}
      >
        {slots.map((slot) => (
          <Cell
            divides={false}
            key={slot.key}
            look={look}
            slot={slot}
            which={which}
          />
        ))}
      </div>
    </div>
  );
}

/** One side of one row: its number, its tint, its code — and, on hover, the
 * same comment affordance a unified row offers.
 *
 * **A `null` side is the gap that keeps the other column aligned**, and what it
 * is drawn as depends on what it is saying. Opposite a change block inside a
 * file that has both sides, it is the quiet hatched band of `.vingilot-dfill`:
 * the claim is local — *this row* has nothing here — and a flat fill at the
 * scale of a twelve-line addition reads as a hole in the page rather than as
 * deliberate blankness.
 *
 * **On a side the patch does not have at all, it is plain ground** (P4.8b). An
 * added file makes that claim on every one of its rows, about a side that does
 * not exist, and forty rows of hatch is not a quiet way to say it — it is the
 * loudest thing on the card. The file's own header already says `added` beside
 * its name and the whole column's gutter is empty, which are two truthful
 * statements of the same fact; a third, repeated per row, is texture. Nothing
 * is invented to fill it, because an added file genuinely has no old side. */
function Cell({
  divides,
  look,
  slot,
  which,
}: {
  /** Draw the fold between the columns on this cell. The grid has nowhere else
   * to put it; a run has its scroller's own border and does not want it. */
  divides: boolean;
  look: Look;
  slot: PairSlot;
  which: Which;
}) {
  const side = which === "before" ? slot.before : slot.after;
  const no = which === "before" ? slot.nos[0] : slot.nos[1];
  const edge = divides && which === "after" ? "border-l border-border/60" : "";
  if (side === null) {
    return (
      <div
        aria-hidden="true"
        className={`${look.absent === which ? "" : "vingilot-dfill"} ${edge}`}
        // Still named by its COLUMN, and additionally as a filler. A gap that
        // stopped saying which side it was on would leave the two columns
        // unreadable from the outside — a spec could no longer say "the right
        // side of this row is the gap", which is the alignment claim itself.
        data-split-cell={which}
        // `absent` where the whole side is missing, `gap` where this row's is:
        // the two are drawn differently and a spec that could not tell them
        // apart could not read either claim.
        data-split-filler={look.absent === which ? "absent" : "gap"}
        data-split-kind={slot.kind}
        data-split-pair={slot.at}
      >
        {/* One line of nothing, so a cell with no text is still 22px tall.
            The grid took this height from the cell opposite; a column has no
            cell opposite to take it from. */}
        <span className="whitespace-pre"> </span>
      </div>
    );
  }
  const row: LineRow = side.row;
  const isFocused = look.focused === side.at;
  return (
    <div
      className={`group relative vingilot-dhalf pr-2 ${edge} ${TINT[row.sign]} ${
        isFocused ? "vingilot-dline-focus" : ""
      }`}
      data-diff-focused={isFocused ? "true" : undefined}
      data-diff-nos={halfGutter(no)}
      data-diff-sign={
        row.sign === " " ? "ctx" : row.sign === "+" ? "add" : "del"
      }
      data-split-cell={which}
      data-split-kind={slot.kind}
      data-split-pair={slot.at}
    >
      {look.onComment === undefined ? null : (
        <CommentButton
          line={no ?? side.at + 1}
          onClick={() => look.onComment?.(side.at)}
        />
      )}
      <span
        className={`text-foreground ${look.wraps ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}
        data-diff-code=""
      >
        {paint(
          row.text,
          tokensAt(look.tokens, look.ordinals, side.at),
          markupAt(look.markup, side.at),
        )}
      </span>
    </div>
  );
}

/** The one horizontal offset every column scroller of this patch carries, and
 * the scrollers carrying it. */
interface ColumnScroll {
  attach: (box: HTMLDivElement | null) => (() => void) | undefined;
  moved: (event: React.UIEvent<HTMLDivElement>) => void;
}

/** One offset for the life of this patch box.
 *
 * **One and not two**, which is the difference between a side-by-side diff and
 * two files side by side: the reader compares the eightieth column of the old
 * line with the eightieth column of the new one, so a half that stayed put
 * while the other moved would be a comparison of two different places. Every
 * run of both columns therefore shares this number, and `widestLine` gives them
 * all the same travel so none of them runs out before the others.
 *
 * A ref rather than state: the offset is not something the drawing is derived
 * from, it is where the boxes already are, and re-rendering fifty rows because
 * a column moved sideways is what a native scroller exists to avoid. */
function useColumnScroll(): ColumnScroll {
  const held = React.useRef<ColumnScroll | null>(null);
  if (held.current === null) held.current = columnScroll();
  return held.current;
}

function columnScroll(): ColumnScroll {
  const boxes: HTMLElement[] = [];
  let at = 0;
  return {
    // A run mounted by a windowed scroll adopts the offset the patch is already
    // at, rather than arriving at zero and tearing the column in half.
    attach: (box: HTMLDivElement | null) => {
      if (box === null) return;
      boxes.push(box);
      if (box.scrollLeft !== at) box.scrollLeft = at;
      return () => {
        const found = boxes.indexOf(box);
        if (found >= 0) boxes.splice(found, 1);
      };
    },
    // The whole sync, and its whole cost. The writes below provoke a `scroll` on
    // each box they touch; those re-enter here, find the offset already recorded
    // and return — so a gesture costs one pass over the scrollers and no layout
    // read, not a cascade.
    moved: (event: React.UIEvent<HTMLDivElement>) => {
      const left = event.currentTarget.scrollLeft;
      if (left === at) return;
      at = left;
      for (const box of boxes) {
        if (box !== event.currentTarget && box.scrollLeft !== left) {
          box.scrollLeft = left;
        }
      }
    },
  };
}
