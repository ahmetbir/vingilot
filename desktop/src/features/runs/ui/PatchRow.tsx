// What a patch ROW is made of, independent of how many columns it is drawn in
// (redesign P4.8).
//
// > *"diff split te unified'dan farkli"* … *"ui olarak ta farkli"*
//
// **The rule this file exists to make structural.** A rendering mode may change
// the shape of the information, never its content — and never its vocabulary.
// P4.6 grew the unified layout by everything a row can carry (word-level
// markup, a comment affordance, a thread anchor between rows, windowing) and
// grew the split layout by none of it, so the same diff showed different
// information depending on a layout toggle. The fix is not to copy the four
// features across: it is to take them OUT of `PatchUnified` so there is exactly
// one of each, and let both layouts consume them. A parity kept by duplication
// is a parity that lasts until the next feature.
//
// So: the tint, the row's height, the highlighter, the word-diff painting, the
// `.addbtn`, the `.hunkbar` and the note row live here, and the two layout
// files below hold nothing but the arrangement —
// `ui/PatchUnified.tsx` one column, `ui/PatchSplit.tsx` two.
//
// **What is NOT here.** What a row IS stays `lib/unifiedDiff.ts`'s; which
// tokens of a changed line changed is `lib/wordDiff.ts`'s; which removed line
// pairs with which added one is `lib/splitDiff.ts`'s `pairRows` and
// `lib/diffTab.ts`'s `wordMarkup` (the same block rule, stated once in each
// because one answers rows and the other answers markup); which rows are worth
// having in the DOM is `rowWindow`'s. This file takes the answers and draws
// them.

import * as React from "react";
import type { ThemedToken } from "shiki";

import type { WordMarkup } from "@/features/runs/lib/diffTab";
import {
  HIGHLIGHT_BYTE_CEILING,
  languageOf,
} from "@/features/runs/lib/fileViewer";
import {
  codeText,
  type DiffRow,
  type HunkRow,
  type LineRow,
} from "@/features/runs/lib/unifiedDiff";
import { changedRanges, type WordSegment } from "@/features/runs/lib/wordDiff";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { resolveShikiThemeName } from "@/shared/theme/theme-loader";
import { tokenizeChunked } from "@/shared/ui/markdown/CodeBlock";

/** One `line` row of `unifiedRows`, named so a render prop can take one. The
 * name is P4.6's and every caller's import still resolves to it. */
export type LineRowData = LineRow;

/** How wide each gutter number's column is, in monospace characters.
 *
 * Five digits, which is the brief's 44px column read in the unit this drawing
 * is really in — see the derivation in `vingilot-tokens.css` beside
 * `.vingilot-dline`. Four was a 9,999-line ceiling this repository already has
 * files approaching. **Both layouts spend the same five**, which is half of
 * what "the gutters are drawn the same" means; the other half is that both
 * draw them as generated content (`.vingilot-dline` / `.vingilot-dhalf`).  */
export const NO_WIDTH = 5;

/** The row's tint — the mockup's `.dl.add` / `.dl.del`, over the theme's own
 * diff tokens. Defined in shared/styles/globals/vingilot-tokens.css.
 *
 * One table, both layouts: the tint, the 8% wash and the `inset 2px 0 0` left
 * edge are the same paint on a unified row and on one side of a split pair,
 * which is gap 8 of P4.8's list ("row height, tint, the inset edge and the hunk
 * strip must be the SAME vocabulary in both modes"). */
export const TINT: Record<" " | "+" | "-", string> = {
  " ": "",
  "+": "vingilot-dline-add",
  "-": "vingilot-dline-del",
};

/** The mockup's `line-height: 22px`, in rem so a ⌘+ zoom scales the row with
 * the type in it. 1.375rem is 22px at the 1× root size the mockup was drawn
 * at; the brief calls this out as the thing that stops a diff reading as
 * terminal output ("generous, not terminal-tight"). */
export const ROW_LEADING = "leading-[1.375rem]";

/** One row's height in CSS pixels, and the precondition it is only true under.
 * `ROW_LEADING` is 22px at 1× and a NON-WRAPPING row is exactly one line, so
 * the windowing arithmetic is exact — see `rowWindow`'s header for why an
 * inexact one would be worse than none.
 *
 * **P4.8: the precondition is the same one in both layouts.** A split pair is
 * two cells in one grid row and a grid row is as tall as its tallest cell, so
 * with wrapping off both cells are one line and the pair is 22px — the same
 * number, exact for the same reason. That is why split is windowed by this
 * constant rather than by a measured-height pass; see `PatchSplit.tsx`. */
export const ROW_PX = 22;

/** The two `.dno` columns as ONE monospace string, right-aligned by padding —
 * unified's gutter, where a row carries both files' numbers. */
export function unifiedGutter(
  before: number | null,
  after: number | null,
): string {
  return `${String(before ?? "").padStart(NO_WIDTH)} ${String(after ?? "").padStart(NO_WIDTH)}`;
}

/** One side's number, for a split cell, which carries only its own file's.
 *
 * Five digits and one space — `SPLIT_GUTTER_PX`'s own derivation in
 * `diffLayout.ts` ("six characters … 43.35px", inside the 48px the floor is
 * counted with), so the drawing spends exactly the width the precondition
 * budgeted for it. */
export function halfGutter(no: number | null): string {
  return `${String(no ?? "").padStart(NO_WIDTH)} `;
}

/** The mockup's `.addbtn`: an accent square, revealed on hover, sitting OVER
 * the number gutter.
 *
 * **Out of flow, and that is the whole reason it is drawn this way.** A control
 * in the inline flow at the start of a row is the exact shape that broke
 * selection in Chromium (argued at `.vingilot-dline` in vingilot-tokens.css);
 * an absolutely positioned box over the one band of the row that is already
 * excluded from selection is the shape that does not. Both layouts place it the
 * same way, which is why it is one component rather than two.
 *
 * `aria-label` rather than a visible name because the glyph is one character
 * wide by design and the row beside it already says which line this is.
 *
 * **`select-none`, and that is P4.2's rule rather than a preference** (P4.8b
 * MINOR-3). The glyph is `display:none` until the row is hovered, so it is not
 * on screen — but it IS in the flow of the cell, and a drag down the diff took
 * it: a copied split selection came out as `["+    row.chords.include"]`, a `+`
 * that is not in either file glued to the line under it. The gutters are
 * excluded from selection for exactly this reason and this control sits over
 * them; one word here closes it in both layouts, because both draw this
 * component and not a copy of it. */
export function CommentButton({
  line,
  onClick,
}: {
  line: number;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={`comment on line ${line}`}
      className="absolute left-0.5 top-px hidden h-4 w-4 select-none items-center justify-center rounded-[5px] bg-[var(--vingilot-accent)] text-2xs font-bold text-[#1a1a1a] group-hover:flex focus-visible:flex focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      data-diff-comment-button=""
      onClick={onClick}
      type="button"
    >
      +
    </button>
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
export function HunkStrip({ row }: { row: HunkRow }) {
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

/** Something git printed that is neither plumbing nor a line of either file —
 * `\ No newline at end of file`, `Binary files … differ`, the backend's
 * truncation marker. Kept rather than dropped (`unifiedDiff.ts`'s header), and
 * since P4.8 kept in BOTH layouts: split used to draw git's wire format
 * verbatim and had no vocabulary for a note at all. */
export function NoteRow({ text }: { text: string }) {
  return (
    <div
      className="select-none px-3 py-0.5 text-2xs text-muted-foreground"
      data-diff-note=""
    >
      {text}
    </div>
  );
}

/** Which line row each index is, counted across the whole patch — the index the
 * token lists are keyed by (`codeText` walks the same array in the same order).
 *
 * Precomputed rather than accumulated while drawing, because a windowed render
 * starts in the middle and because the split layout visits the rows in pair
 * order rather than in row order. */
export function useRowOrdinals(rows: readonly DiffRow[]): number[] {
  return React.useMemo(() => {
    const out = new Array<number>(rows.length).fill(-1);
    let at = -1;
    rows.forEach((row, index) => {
      if (row.kind !== "line") return;
      at += 1;
      out[index] = at;
    });
    return out;
  }, [rows]);
}

/** The tokens for the row at `index`, or `null` when nothing is highlighted
 * yet. One lookup shared by both layouts so neither can index the token lists
 * its own way. */
export function tokensAt(
  tokens: ThemedToken[][] | null,
  ordinals: readonly number[],
  index: number,
): ThemedToken[] | null {
  if (tokens === null) return null;
  return tokens[ordinals[index]] ?? null;
}

/** The word-level markup for the row at `index`, or `undefined` for a surface
 * that has not asked for any. */
export function markupAt(
  markup: WordMarkup | undefined,
  index: number,
): readonly WordSegment[] | undefined {
  return markup?.get(index);
}

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
export function paint(
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
 * there are none. The argument for every decision in it is `PatchView.tsx`'s
 * and is unchanged — the same singleton highlighter, the same chunked tokenise,
 * the same byte ceiling, and nothing waits on it.
 *
 * Shared since P4.8 for a reason beyond tidiness: split drew its code as flat
 * red and green, so the same file was syntax-coloured in one mode and not in
 * the other. One hook, one answer, both layouts. */
export function useDiffTokens(
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
