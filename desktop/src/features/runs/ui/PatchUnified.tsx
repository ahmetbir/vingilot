// The unified rendering of a patch — the mockup's `.dl` rows in ONE column.
//
// **Split out of `PatchView.tsx`, not forked from it.** That file's own header
// states the rule this move keeps: "the commit diff, the worktree diff and the
// split view are one renderer with two layouts, or the next patch feature gets
// built twice and drifts". P4.6 grew the unified layout by everything a row can
// carry and the two layouts stopped fitting in one file under the 1000-line
// ratchet. So the file split and the renderer did not: `PatchView` still owns
// the decision (`mode`), still hands both layouts the same rows, and every
// surface that draws a patch draws through it.
//
// **P4.8 emptied this file of everything that was not the ARRANGEMENT.** The
// drift the header above warns about had already happened: the word markup, the
// comment affordance, the thread anchor, the hunk strip, the highlighter and
// the tint were all here, which is precisely why the split layout had none of
// them. They are now `ui/PatchRow.tsx`'s, both layouts consume them, and what
// is left below is the one thing that really is unified-only — a single column
// of rows, with both files' numbers in one gutter and a sign column between
// them.
//
// **What P4.4 established and this keeps.** git's wire format is already gone
// (`lib/unifiedDiff.ts` decides what plumbing is); the two line-number columns
// and the sign column are generated content, which is the only technique that
// leaves a drag over the code selectable in Chromium and leaves the numbers out
// of what is copied (P4.2, argued at `.vingilot-dline`); the code is coloured by
// the same Shiki the file viewer uses, never by hand-tagged spans.

import * as React from "react";
import type { ThemedToken } from "shiki";

import { rowWindow, VIRTUALIZE_OVER_ROWS } from "@/features/runs/lib/diffTab";
import type { WordMarkup } from "@/features/runs/lib/diffTab";
import type { DiffRow } from "@/features/runs/lib/unifiedDiff";
import { unifiedRows } from "@/features/runs/lib/unifiedDiff";
import type { WordSegment } from "@/features/runs/lib/wordDiff";
import {
  CommentButton,
  HunkStrip,
  type LineRowData,
  markupAt,
  NoteRow,
  paint,
  ROW_LEADING,
  ROW_PX,
  TINT,
  tokensAt,
  unifiedGutter,
  useDiffTokens,
  useRowOrdinals,
} from "@/features/runs/ui/PatchRow";

export type { LineRowData };

export interface UnifiedProps {
  patch: string;
  /** The file this patch is OF, for the one thing a patch cannot tell about
   * itself: which language to highlight it as. Optional, and the honest
   * fallback is plain text. */
  path?: string;
  wraps: boolean;
  /** Rows to draw instead of `unifiedRows(patch)` — how "ignore whitespace"
   * reaches this component (`diffTab.ts`'s `withoutWhitespaceChanges`). The
   * filtering is the caller's because the caller is the one that reports how
   * many rows it hid. */
  rows?: readonly DiffRow[];
  /** Which tokens changed, per row index. Absent for a surface that has not
   * asked for word-level markup — the rows then draw exactly as P4.4 drew
   * them. */
  markup?: WordMarkup;
  /** The row the keyboard is on, as an index into `rows`. */
  focused?: number | null;
  /** Offer the mockup's `.addbtn` on hover, and act on it. */
  onComment?: (row: number) => void;
  /** What goes BETWEEN this row and the next one — a review thread anchored to
   * the line, the comment composer `⌥⏎` opened, or nothing.
   *
   * One slot rather than two, and a render prop rather than data: this file
   * owns *where* something goes inside a patch and holds no knowledge of what
   * a thread's controls do. `DiffTab.tsx` owns that. */
  renderAfter?: (row: LineRowData, index: number) => React.ReactNode;
  /** The scroller this patch is inside, for windowing. Absent means "draw
   * every row", which is what every surface did before P4.6. */
  window?: { scrollTop: number; viewport: number; top: number };
}

export function UnifiedBody(props: UnifiedProps) {
  const { markup, patch, path, renderAfter, wraps } = props;
  const derived = React.useMemo(() => unifiedRows(patch), [patch]);
  const rows = props.rows ?? derived;
  const tokens = useDiffTokens(rows, path);
  const ordinals = useRowOrdinals(rows);

  // **Windowed only where the arithmetic is exact.** A wrapped row is taller
  // than one line and its height is not knowable without measuring, so a
  // wrapping patch draws whole however long it is. Hunk strips and notes are
  // not 22px either — but they are rare beside the lines, and the window is
  // computed over row INDICES with the spacers sized from the same count, so a
  // strip inside the window only makes the drawn block taller than the spacers
  // predicted, which the browser absorbs.
  const windowed =
    !wraps && props.window !== undefined && rows.length > VIRTUALIZE_OVER_ROWS;
  const view = windowed
    ? rowWindow({
        count: rows.length,
        rowHeight: ROW_PX,
        scrollTop: props.window?.scrollTop ?? 0,
        top: props.window?.top ?? 0,
        viewport: props.window?.viewport ?? 0,
      })
    : { end: rows.length, start: 0 };

  return (
    <div
      className={`font-mono text-xs ${ROW_LEADING} ${wraps ? "w-full" : "w-max min-w-full"}`}
      data-highlighted={tokens === null ? "false" : "true"}
      // **The selectable region is the whole patch body, with the gutters cut
      // out of it** (P4.2). Not the code cells one at a time: measured in
      // Chromium, a `user-select: text` island inside a `none` region cannot
      // have a selection STARTED in it.
      data-select="text"
      data-virtualized={windowed ? "true" : "false"}
    >
      {view.start > 0 ? (
        <div aria-hidden="true" style={{ height: view.start * ROW_PX }} />
      ) : null}
      {rows.slice(view.start, view.end).map((row, offset) => {
        // Positional content, never reordered — the same key rule the split
        // body keeps. Absolute so a windowed render does not re-key every row
        // on every scroll.
        const at = view.start + offset;
        if (row.kind === "hunk") return <HunkStrip key={at} row={row} />;
        if (row.kind === "note") return <NoteRow key={at} text={row.text} />;
        return (
          <React.Fragment key={at}>
            <LineRow
              focused={props.focused === at}
              markup={markupAt(markup, at)}
              onComment={props.onComment}
              row={row}
              rowIndex={at}
              tokens={tokensAt(tokens, ordinals, at)}
              wraps={wraps}
            />
            {renderAfter === undefined ? null : renderAfter(row, at)}
          </React.Fragment>
        );
      })}
      {view.end < rows.length ? (
        <div
          aria-hidden="true"
          style={{ height: (rows.length - view.end) * ROW_PX }}
        />
      ) : null}
    </div>
  );
}

/** One `.dl`.
 *
 * The wrapper is `relative` and the row itself is unchanged from P4.4 — the
 * comment affordance is absolutely positioned OVER THE GUTTER, which is the one
 * band of the row that is already excluded from selection (`CommentButton`'s
 * own header carries the measurement). */
const LineRow = React.memo(function LineRow({
  focused,
  markup,
  onComment,
  row,
  rowIndex,
  tokens,
  wraps,
}: {
  focused: boolean;
  markup: readonly WordSegment[] | undefined;
  onComment: ((row: number) => void) | undefined;
  row: LineRowData;
  rowIndex: number;
  tokens: ThemedToken[] | null;
  wraps: boolean;
}) {
  return (
    <div className="group relative">
      {onComment === undefined ? null : (
        <CommentButton
          line={row.after ?? row.before ?? rowIndex + 1}
          onClick={() => onComment(rowIndex)}
        />
      )}
      <div
        className={`vingilot-dline pr-2 ${TINT[row.sign]} ${focused ? "vingilot-dline-focus" : ""}`}
        data-diff-focused={focused ? "true" : undefined}
        data-diff-nos={unifiedGutter(row.before, row.after)}
        data-diff-sign={
          row.sign === " " ? "ctx" : row.sign === "+" ? "add" : "del"
        }
      >
        <span className="vingilot-dmark" data-diff-mark={` ${row.sign} `}>
          <span
            className={`text-foreground ${wraps ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}
            data-diff-code=""
          >
            {paint(row.text, tokens, markup)}
          </span>
        </span>
      </div>
    </div>
  );
});
