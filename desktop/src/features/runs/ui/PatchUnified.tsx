// The unified rendering of a patch — the mockup's `.dl` rows, its `.hunkbar`,
// its `.wd` word highlight, its `.addbtn` and the inline review thread that
// sits between two of them (DIFF-TAB-BRIEF §4 and §5).
//
// **Split out of `PatchView.tsx`, not forked from it.** That file's own header
// states the rule this move keeps: "the commit diff, the worktree diff and the
// split view are one renderer with two layouts, or the next patch feature gets
// built twice and drifts". P4.6 grew the unified layout by everything below —
// word-level markup, a comment affordance, threads between rows, windowing —
// and the two layouts stopped fitting in one file under the 1000-line ratchet.
// So the file split and the renderer did not: `PatchView` still owns the
// decision (`mode`), still hands both layouts the same rows, and every surface
// that draws a patch draws THIS one. There is exactly one `<UnifiedBody>` in
// the app and it is here.
//
// **What P4.4 established and this keeps.** git's wire format is already gone
// (`lib/unifiedDiff.ts` decides what plumbing is); the two line-number columns
// and the sign column are generated content, which is the only technique that
// leaves a drag over the code selectable in Chromium and leaves the numbers out
// of what is copied (P4.2, argued at `gutterText`); the code is coloured by the
// same Shiki the file viewer uses, never by hand-tagged spans.
//
// **What P4.6 adds, and where each answer comes from.** Which tokens of a
// changed line changed is `lib/wordDiff.ts`'s; which removed line pairs with
// which added one is `lib/diffTab.ts`'s `wordMarkup`; which rows are worth
// having in the DOM is its `rowWindow`; what a review note is and whether one
// belongs here at all is `lib/reviewThread.ts`'s. This component takes the
// answers and draws them.

import * as React from "react";
import type { ThemedToken } from "shiki";

import { rowWindow, VIRTUALIZE_OVER_ROWS } from "@/features/runs/lib/diffTab";
import type { WordMarkup } from "@/features/runs/lib/diffTab";
import {
  HIGHLIGHT_BYTE_CEILING,
  languageOf,
} from "@/features/runs/lib/fileViewer";
import {
  codeText,
  type DiffRow,
  unifiedRows,
} from "@/features/runs/lib/unifiedDiff";
import { changedRanges, type WordSegment } from "@/features/runs/lib/wordDiff";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { resolveShikiThemeName } from "@/shared/theme/theme-loader";
import { tokenizeChunked } from "@/shared/ui/markdown/CodeBlock";

/** How wide each gutter number's column is, in monospace characters.
 *
 * Five digits, which is the brief's 44px column read in the unit this drawing
 * is really in — see the derivation in `vingilot-tokens.css` beside
 * `.vingilot-dline`. Four was a 9,999-line ceiling this repository already has
 * files approaching. */
const NO_WIDTH = 5;

/** The row's tint — the mockup's `.dl.add` / `.dl.del`, over the theme's own
 * diff tokens. Defined in shared/styles/globals/vingilot-tokens.css. */
const TINT: Record<" " | "+" | "-", string> = {
  " ": "",
  "+": "vingilot-dline-add",
  "-": "vingilot-dline-del",
};

/** The mockup's `line-height: 22px`, in rem so a ⌘+ zoom scales the row with
 * the type in it. 1.375rem is 22px at the 1× root size the mockup was drawn
 * at; the brief calls this out as the thing that stops a diff reading as
 * terminal output ("generous, not terminal-tight"). */
const ROW_LEADING = "leading-[1.375rem]";

/** The two `.dno` columns as ONE monospace string, right-aligned by padding.
 * The technique and the measurement behind it are in `PatchView.tsx`'s
 * `gutterText` header, unchanged — only the width moved. */
function gutterText(before: number | null, after: number | null): string {
  return `${String(before ?? "").padStart(NO_WIDTH)} ${String(after ?? "").padStart(NO_WIDTH)}`;
}

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

/** One row's height in CSS pixels, and the precondition it is only true under.
 * `ROW_LEADING` is 22px at 1× and a non-wrapping row is exactly one line, so
 * the windowing arithmetic is exact — see `rowWindow`'s header for why an
 * inexact one would be worse than none. */
const ROW_PX = 22;

/** One `line` row of `unifiedRows`, named so a render prop can take one. */
export type LineRowData = Extract<DiffRow, { kind: "line" }>;

export function UnifiedBody(props: UnifiedProps) {
  const { markup, patch, path, renderAfter, wraps } = props;
  const derived = React.useMemo(() => unifiedRows(patch), [patch]);
  const rows = props.rows ?? derived;
  const tokens = useDiffTokens(rows, path);

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

  // Which line row each index is, counted across the whole patch — the index
  // the token lists are keyed by (`codeText` walks the same array in the same
  // order). Precomputed rather than accumulated while drawing, because a
  // windowed render starts in the middle.
  const ordinals = React.useMemo(() => {
    const out = new Array<number>(rows.length).fill(-1);
    let at = -1;
    rows.forEach((row, index) => {
      if (row.kind !== "line") return;
      at += 1;
      out[index] = at;
    });
    return out;
  }, [rows]);

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
        if (row.kind === "note") {
          return (
            <div
              className="select-none px-3 py-0.5 text-2xs text-muted-foreground"
              data-diff-note=""
              key={at}
            >
              {row.text}
            </div>
          );
        }
        return (
          <React.Fragment key={at}>
            <LineRow
              focused={props.focused === at}
              markup={markup?.get(at)}
              onComment={props.onComment}
              row={row}
              rowIndex={at}
              tokens={tokens === null ? null : (tokens[ordinals[at]] ?? null)}
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

/** The mockup's `.hunkbar`: a blue-tinted strip carrying the mono range, then
 * git's enclosing-symbol hint as plain text (DIFF-TAB-BRIEF §4).
 *
 * **The order is the brief's, and P4.4's reason for the other order is gone.**
 * That round put the human half first because the ranges drawn at
 * `text-foreground/70` measured 3.87:1 on this band — under the floor, which is
 * not "quiet" but unreadable. The fix there was the order; the fix here is the
 * colour: the range wears the strip's own blue at full strength (measured 7.5:1
 * on this ground) and the context wears `/70` (7.1:1), so both are legal and the
 * strip reads the way the mockup draws it. `select-none`, because a hunk header
 * is not code. */
export function HunkStrip({
  row,
}: {
  row: Extract<DiffRow, { kind: "hunk" }>;
}) {
  return (
    <div
      className="mt-2 flex select-none items-center gap-2.5 bg-[rgba(127,178,201,.07)] px-3 py-0.5 text-2xs first:mt-0"
      data-diff-hunk=""
    >
      <span className="shrink-0 font-mono text-[#7fb2c9]">{row.range}</span>
      {row.context === "" ? null : (
        <span className="min-w-0 truncate font-sans text-foreground/70">
          {row.context}
        </span>
      )}
    </div>
  );
}

/** One `.dl`.
 *
 * The wrapper is `relative` and the row itself is unchanged from P4.4 — the
 * comment affordance is absolutely positioned OVER THE GUTTER, which is the one
 * band of the row that is already excluded from selection. A control in the
 * inline flow at the start of a row is the exact shape that broke selection in
 * Chromium (`PatchView.tsx`'s `gutterText`), and an out-of-flow box over a
 * region nothing selects is the shape that does not. */
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
        // The mockup's `.addbtn`: an accent square, revealed on hover, left of
        // the sign column. `aria-label` rather than a visible name because the
        // glyph is one character wide by design and the row beside it already
        // says which line this is.
        <button
          aria-label={`comment on line ${row.after ?? row.before ?? rowIndex + 1}`}
          className="absolute left-0.5 top-px hidden h-4 w-4 items-center justify-center rounded-[5px] bg-[var(--vingilot-accent)] text-2xs font-bold text-[#1a1a1a] group-hover:flex focus-visible:flex focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-diff-comment-button=""
          onClick={() => onComment(rowIndex)}
          type="button"
        >
          +
        </button>
      )}
      <div
        className={`vingilot-dline pr-2 ${TINT[row.sign]} ${focused ? "vingilot-dline-focus" : ""}`}
        data-diff-focused={focused ? "true" : undefined}
        data-diff-nos={gutterText(row.before, row.after)}
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

/** The code of one row: Shiki's colours, with the changed tokens wearing the
 * mockup's `.wd`.
 *
 * **One walk, two answers.** The syntax tokens and the word-diff segments are
 * two different partitions of the same string, so the drawing splits on the
 * union of their boundaries: a Shiki token that straddles the edge of a changed
 * run is cut there and the two halves keep the same colour. Doing it the other
 * way — a highlight span wrapping coloured spans — would need the changed run
 * to be token-aligned, which it is not.
 *
 * An empty line draws one space so the row keeps its height. */
function paint(
  text: string,
  tokens: ThemedToken[] | null,
  markup: readonly WordSegment[] | undefined,
): React.ReactNode {
  const ranges = markup === undefined ? [] : changedRanges(markup);
  if (tokens === null) {
    if (ranges.length === 0) return text === "" ? " " : text;
    return slice(text, 0, ranges, undefined);
  }
  if (tokens.length === 0) return " ";
  const out: React.ReactNode[] = [];
  let at = 0;
  tokens.forEach((token, index) => {
    out.push(
      // biome-ignore lint/suspicious/noArrayIndexKey: syntax tokens are positional pieces of one line, never reordered
      <React.Fragment key={index}>
        {slice(token.content, at, ranges, token.color)}
      </React.Fragment>,
    );
    at += token.content.length;
  });
  return out;
}

/** `content`, which starts at character `from` of the line, cut at every edge
 * of `ranges` and painted `color`. */
function slice(
  content: string,
  from: number,
  ranges: readonly { start: number; end: number }[],
  color: string | undefined,
): React.ReactNode {
  if (ranges.length === 0) {
    return color === undefined ? (
      content
    ) : (
      <span style={{ color }}>{content}</span>
    );
  }
  const out: React.ReactNode[] = [];
  let at = 0;
  while (at < content.length) {
    const absolute = from + at;
    const inside = ranges.find(
      (range) => absolute >= range.start && absolute < range.end,
    );
    const next = inside
      ? Math.min(content.length, inside.end - from)
      : Math.min(
          content.length,
          ...ranges
            .filter((range) => range.start > absolute)
            .map((range) => range.start - from),
        );
    const stop = Math.max(at + 1, next);
    const piece = content.slice(at, stop);
    out.push(
      <span
        className={inside ? "vingilot-wd" : undefined}
        key={at}
        style={color === undefined ? undefined : { color }}
      >
        {piece}
      </span>,
    );
    at = stop;
  }
  return out;
}

/** Shiki's tokens for a patch's code, one list per line row, or `null` while
 * there are none. Moved here whole with `UnifiedBody`; the argument for every
 * decision in it is `PatchView.tsx`'s and is unchanged — the same singleton
 * highlighter, the same chunked tokenise, the same byte ceiling, and nothing
 * waits on it. */
function useDiffTokens(
  rows: readonly DiffRow[],
  path: string | undefined,
): ThemedToken[][] | null {
  const code = React.useMemo(() => codeText(rows), [rows]);
  const language = path === undefined ? "plain" : languageOf(path);
  const { themeName } = useTheme();
  const shikiTheme = resolveShikiThemeName(themeName);
  const [swap, setSwap] = React.useState<{
    code: string;
    tokens: ThemedToken[][];
  } | null>(null);

  const ok = language !== "plain" && code.length <= HIGHLIGHT_BYTE_CEILING;

  React.useEffect(() => {
    if (!ok) return;
    let cancelled = false;
    void tokenizeChunked(code, language, shikiTheme, () => cancelled).then(
      (answered) => {
        if (cancelled || answered === null) return;
        setSwap({ code, tokens: answered });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code, language, ok, shikiTheme]);

  return swap !== null && swap.code === code ? swap.tokens : null;
}
