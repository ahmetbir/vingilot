// The one place a patch is drawn
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 4;
// vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 2).
//
// **This file exists because Task 4 forbade the alternative.** A commit is
// another patch source, and the pane that shows one had to render it "with the
// SAME renderer the diff pane uses (do not fork the patch component)". Until now
// the renderer was twenty lines inside `WorktreeDiffPanel.tsx`, which is not a
// component anything else can reach — so "reuse it" and "copy it" looked the
// same from the outside, and the copy is the one that drifts: one of the two
// gets the colour for a `\ No newline at end of file` marker, or the hanging
// indent, or the `data-wrapped` a spec reads, and the other does not.
//
// So it moved here whole, with no change to what it draws, and both callers
// construct it. `WorktreeDiffPanel` renders a worktree's changes; `HistoryPane`
// renders a commit's and a source-control file's. Three surfaces, one patch.
//
// **Task 2 added a second layout, and NOT a second renderer.** The plan's own
// self-review named the way this goes wrong: "Task 2 shipping a second diff
// renderer. The commit diff, the worktree diff and the split view are one
// renderer with two layouts, or the next patch feature gets built twice and
// drifts." So `mode` is a prop, both layouts live in this file, both read the
// same `diffView` classification and the same `DIFF_LINE_CLASS` hues, and every
// surface that had a unified patch has a split one for free.
//
// **P4.4 rewrote the unified layout and kept both of those promises.** The
// owner's complaint — *"diff ui'i artik guzel olsun bi tik yaaa hala cok
// terminal gibi"* — was about what this component drew: git's own stdout, one
// flat monospace line per line of it, `diff --git` and `index` and `---`/`+++`
// included, with every changed line shifted one character right by its marker.
// It is now the mockup's `.hunk` / `.dno` / `.dline` vocabulary: the plumbing
// is gone (`lib/unifiedDiff.ts` decides what plumbing is), old and new line
// numbers have columns of their own, the sign has a column of its own so no
// code ever moves sideways, and the code itself is highlighted by the Shiki
// this app already ships instead of being painted one flat green or red.
//
// **What is NOT here.** How a patch line is classified is `lib/runModel.ts`'s
// `diffView`; what a unified row IS is `lib/unifiedDiff.ts`'s `unifiedRows`;
// how those lines become aligned two-column rows is `lib/splitDiff.ts`'s
// `splitRows`; whether a narrow pane wraps instead of scrolling sideways is
// `lib/diffLayout.ts`'s `patchWrapsAt`, and whether split is offered at all is
// its `splitFitsAt`. This component takes the answers and draws them.

import * as React from "react";
import type { ThemedToken } from "shiki";

import type { DiffMode } from "@/features/runs/lib/diffMode";
import {
  HIGHLIGHT_BYTE_CEILING,
  languageOf,
} from "@/features/runs/lib/fileViewer";
import type { DiffLineKind } from "@/features/runs/lib/runModel";
import { splitRows } from "@/features/runs/lib/splitDiff";
import type { SplitCell } from "@/features/runs/lib/splitDiff";
import {
  codeText,
  type DiffRow,
  unifiedRows,
} from "@/features/runs/lib/unifiedDiff";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { resolveShikiThemeName } from "@/shared/theme/theme-loader";
import { tokenizeChunked } from "@/shared/ui/markdown/CodeBlock";

// The add/del hues are the theme's own diff tokens (`--status-added` /
// `--status-deleted`, set per-theme by `ThemeProvider`) — the same green and
// red upstream's `DiffViewer` speaks in chat, so a patch means the same thing
// by the same colour on every surface of the app
// (vingilot/docs/plans/2026-08-12-polish-the-right-side.md, vocabulary).
const DIFF_LINE_CLASS: Record<DiffLineKind, string> = {
  add: "text-status-added",
  ctx: "text-foreground",
  del: "text-status-deleted",
  hunk: "font-bold text-muted-foreground",
  meta: "text-muted-foreground",
};

/** The gutter's colour strip, per side — VS Code's red-strip/green-strip, drawn
 * as a *border* colour so it is the same `--status-added` / `--status-deleted`
 * token the text beside it uses and not a second green invented here. A
 * transparent strip of the same width on every other row is what keeps the code
 * cells of context rows aligned with the code cells of change rows. */
const STRIP_CLASS: Record<"before" | "after" | "none", string> = {
  after: "border-status-added",
  before: "border-status-deleted",
  none: "border-transparent",
};

/** Grid columns: gutter, code, gutter, code.
 *
 * `3rem` is `w-12`, the stock token `diffLayout.ts`'s `SPLIT_GUTTER_PX` names
 * and counts as 48px — in rem here so a ⌘+ zoom scales the gutter with the
 * digits in it rather than freezing it. `minmax(0,1fr)` and not `1fr`: a `1fr`
 * track has an `auto` minimum, so one long unbroken line of source would push
 * the column past its share and the two sides would stop being halves. */
const SPLIT_GRID = "grid-cols-[3rem_minmax(0,1fr)_3rem_minmax(0,1fr)]";

/** Wrapped, the hanging indent is what keeps a diff readable: the second visual
 * line of a line starts under the code and not under the marker column, so a
 * continuation is never mistaken for a line of its own. */
const WRAP_CLASS = "-indent-4 whitespace-pre-wrap break-words pl-4";

interface Props {
  /** The raw unified patch, as the backend answered it. */
  patch: string;
  /** Wrap long lines instead of scrolling sideways. Decided by the caller from
   * its own measured width (`patchWrapsAt`), because the pane knows how wide it
   * is and this component does not. Read in `unified` only — see `mode`. */
  wraps: boolean;
  /** One column or two. The caller resolves it (`effectiveDiffMode` against
   * `splitFitsAt`) for the same reason it resolves `wraps`: the width is the
   * pane's to know.
   *
   * Optional and defaulting to `unified`, so a patch box added anywhere else
   * keeps working and gets the layout that always fits. */
  mode?: DiffMode;
  /** Which patch box this is, so a spec can name it. Both callers pass one; two
   * boxes with the same testid would be a spec that cannot say which pane it is
   * reading. */
  testid: string;
  /** The file this patch is OF, for the one thing a patch cannot tell about
   * itself: which language to highlight it as (redesign P4.4).
   *
   * Optional, and the honest fallback is plain text — a patch box rendered
   * somewhere with no path to hand still draws, it simply draws uncoloured,
   * which is what this component did everywhere before Shiki arrived. */
  path?: string;
}

export function PatchView({
  mode = "unified",
  patch,
  path,
  testid,
  wraps,
}: Props) {
  // Split's cells always wrap, and `data-wrapped` says so rather than repeating
  // the caller's unified decision: the attribute is a reading of what the box
  // on screen does. Wrapping costs unified its grid — a re-flowed line is no
  // longer aligned with the one above it, which is why `patchWrapsAt` is a floor
  // and not a preference — and costs split nothing, because in split the grid is
  // the grid's job: two cells of one row are the same height whatever either of
  // them wraps to.
  const wrapped = mode === "split" ? true : wraps;
  return (
    <div
      className="min-h-0 flex-1 overflow-auto px-4 py-2"
      // Which of the renderings is up, so a spec can say the mode out loud
      // instead of inferring it from a scroll width that could also be zero
      // because the fixture's lines are short.
      data-mode={mode}
      data-testid={testid}
      data-wrapped={wrapped ? "true" : "false"}
    >
      {mode === "split" ? (
        <SplitBody patch={patch} />
      ) : (
        <UnifiedBody patch={patch} path={path} wraps={wraps} />
      )}
    </div>
  );
}

/** How wide each gutter number's column is, in monospace characters. Four
 * digits is a 9,999-line file; past that the column simply grows, because a
 * number that does not fit is worse than a column that is one character
 * wider. */
const NO_WIDTH = 4;

/** The row's tint — the mockup's `.dline.add` / `.dline.del` alphas, over the
 * theme's own diff tokens rather than the mockup's fixed hexes so a diff means
 * the same thing by the same colour on every surface of the app. Defined in
 * shared/styles/globals/vingilot-tokens.css. */
const TINT: Record<" " | "+" | "-", string> = {
  " ": "",
  "+": "vingilot-dline-add",
  "-": "vingilot-dline-del",
};

/** The two `.dno` columns as ONE monospace string, right-aligned by padding.
 *
 * **The gutter is generated content, and that is a measured decision rather
 * than a stylistic one.** It was first built as three `<span>`s carrying
 * `user-select: none`, which is the obvious reading of "the gutter is not
 * selectable" — and in Chromium a drag over the code beside them selected
 * NOTHING AT ALL. Bisected in the browser: with the three spans removed from
 * the row the same drag selects immediately, so an unselectable sibling
 * element at the start of a row is a barrier Blink will not begin or extend a
 * selection across.
 *
 * Generated content has no such problem, and this app already had the proof:
 * the file viewer's line numbers are `.code-block-lines [data-line]::before`
 * with `user-select: none`, and dragging down a file has always worked and has
 * never copied a line number. So the diff's gutter is the same technique — one
 * pseudo for the numbers, one for the marker — and the columns line up because
 * the type is monospace and the string is padded. */
function gutterText(before: number | null, after: number | null): string {
  return `${String(before ?? "").padStart(NO_WIDTH)} ${String(after ?? "").padStart(NO_WIDTH)}`;
}

function UnifiedBody({
  patch,
  path,
  wraps,
}: {
  patch: string;
  path: string | undefined;
  wraps: boolean;
}) {
  const rows = React.useMemo(() => unifiedRows(patch), [patch]);
  const tokens = useDiffTokens(rows, path);
  // Which line row this is, counted across the whole patch — the index the
  // token lists are keyed by (`unifiedDiff.ts`'s `codeText` walks the same
  // array in the same order).
  let ordinal = -1;
  return (
    <div
      className={`font-mono text-xs ${wraps ? "w-full" : "w-max min-w-full"}`}
      data-highlighted={tokens === null ? "false" : "true"}
      // **The selectable region is the whole patch body, with the gutters cut
      // out of it** (redesign P4.2). Not the code cells one at a time:
      // measured in Chromium, a `user-select: text` island inside a `none`
      // region cannot have a selection STARTED in it, so a drag over the code
      // came back empty. A `text` region with `none` children is the shape the
      // spec is written for — the excluded columns are simply skipped in what
      // is copied, which is exactly the rule ("dosya satir numaralari filan
      // secilemez olmali").
      data-select="text"
    >
      {rows.map((row, i) => {
        // Positional content, never reordered — the same key rule the split
        // body below keeps.
        const key = i;
        if (row.kind === "hunk") {
          // The mockup's `.hunk` strip. **The human half first**: git's
          // enclosing-function hint is what tells a reader where in the file
          // he is, and the ranges are kept beside it rather than instead of
          // it. `select-none`, because a hunk header is not code.
          return (
            <div
              className="mt-2 select-none bg-[rgba(127,178,201,.07)] px-3 py-0.5 text-2xs text-[#7fb2c9] first:mt-0"
              data-diff-hunk=""
              key={key}
            >
              {/* **The human half leads, and the ranges keep full strength.**
                  Drawn at `/70` first, the ranges measured 3.87:1 on this
                  band — under the 4.5:1 floor, which is not "quiet", it is
                  unreadable. The hierarchy is carried by order and weight
                  instead, and the colour stays legal (6.3:1 measured). */}
              <span className="font-medium">
                {row.context === "" ? row.range : row.context}
              </span>
              {row.context === "" ? null : (
                <span className="ml-2">{row.range}</span>
              )}
            </div>
          );
        }
        if (row.kind === "note") {
          return (
            <div
              className="select-none px-3 py-0.5 text-2xs text-muted-foreground"
              data-diff-note=""
              key={key}
            >
              {row.text}
            </div>
          );
        }
        ordinal += 1;
        const line = tokens?.[ordinal] ?? null;
        return (
          // The two gutter columns and the marker are this row's own `::before`
          // and its child's — see `gutterText`. `vingilot-dline` carries the
          // hanging indent that keeps a wrapped line starting under the code
          // rather than under the numbers.
          <div
            className={`vingilot-dline pr-2 ${TINT[row.sign]}`}
            data-diff-nos={gutterText(row.before, row.after)}
            data-diff-sign={
              row.sign === " " ? "ctx" : row.sign === "+" ? "add" : "del"
            }
            key={key}
          >
            <span className="vingilot-dmark" data-diff-mark={` ${row.sign} `}>
              <span
                className={`text-foreground ${wraps ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}
                data-diff-code=""
              >
                {line === null
                  ? row.text === ""
                    ? " "
                    : row.text
                  : line.length === 0
                    ? " "
                    : line.map((token, at) => (
                        <span
                          // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional and never reordered
                          key={at}
                          style={{ color: token.color }}
                        >
                          {token.content}
                        </span>
                      ))}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Shiki's tokens for a patch's code, one list per line row, or `null` while
 * there are none.
 *
 * **The same Shiki the file viewer uses, asked the same way** — the singleton
 * highlighter, the grammar cache and the chunked tokenise in
 * `shared/ui/markdown/CodeBlock.tsx`. Nothing waits on it: the patch renders
 * uncoloured immediately and the colours arrive when they arrive, which is
 * `FileViewer`'s own rule and the reason a 2,000-line patch does not stall the
 * pane.
 *
 * The answer is kept WITH the text it is an answer about, so a swap that
 * outlived its patch cannot colour the next file with this one's tokens. */
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

  // The same byte ceiling the viewer applies, and for the same reason:
  // TextMate grammars are superlinear on line length and a patch of a minified
  // bundle is one very long line.
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

/** Old on the left, new on the right, hunks aligned row for row.
 *
 * **A grid, and that is the whole design decision.** The two obvious
 * alternatives were measured against it and lost. Two independent scrolling
 * columns keeps the sides aligned only while every row is exactly one line
 * tall, which stops being true the moment a line wraps — and at half a pane
 * every other line wraps. Two clipped columns with the overflow hidden keeps
 * alignment by throwing away the right-hand half of every long line, which is
 * the complaint this whole plan is named after. A grid keeps both: cells in one
 * row are the same height whatever either of them wraps to, so wrapping is free
 * here, and nothing is ever cut off. */
function SplitBody({ patch }: { patch: string }) {
  const rows = splitRows(patch);
  return (
    // Selectable as one region, with the two gutters cut out of it — the
    // unified body's own arrangement and for the same measured reason.
    <div
      className={`grid w-full font-mono text-xs ${SPLIT_GRID}`}
      data-select="text"
    >
      {rows.map((row, i) => {
        // `contents` so the row is a named thing a spec can read while its four
        // children remain direct grid items — a real box here would be one grid
        // cell containing everything and there would be no columns at all.
        // biome-ignore lint/suspicious/noArrayIndexKey: patch rows are positional content, never reordered
        const key = i;
        if (row.kind === "span") {
          return (
            <div className="contents" data-split-row="span" key={key}>
              <span
                className={`col-span-4 ${WRAP_CLASS} ${DIFF_LINE_CLASS[row.lineKind]}`}
              >
                {row.text === "" ? " " : row.text}
              </span>
            </div>
          );
        }
        if (row.kind === "context") {
          return (
            <div className="contents" data-split-row="context" key={key}>
              <Gutter cell={row.before} side="none" />
              <Code cell={row.before} className="text-foreground" />
              <Gutter cell={row.after} divides side="none" />
              <Code cell={row.after} className="text-foreground" />
            </div>
          );
        }
        return (
          <div className="contents" data-split-row="change" key={key}>
            <Gutter cell={row.before} side="before" />
            <Code cell={row.before} className="text-status-deleted" />
            <Gutter cell={row.after} divides side="after" />
            <Code cell={row.after} className="text-status-added" />
          </div>
        );
      })}
    </div>
  );
}

/** One side's line number, and the strip that says what happened to that line.
 *
 * A `null` cell is the gap that keeps the other side aligned, and it is drawn
 * rather than left empty: a flat `bg-muted/30` band, which is how the eye reads
 * "there is nothing here" instead of "the file ends here". No hatching, no
 * gradient — the restraint clause of the polish plan holds. */
function Gutter({
  cell,
  divides = false,
  side,
}: {
  cell: SplitCell | null;
  /** The `border-l` between the two columns, which is `SPLIT_DIVIDER_PX`. Only
   * the new side's gutter carries it. */
  divides?: boolean;
  side: "before" | "after" | "none";
}) {
  return (
    <span
      className={`select-none border-r-2 pr-1 text-right text-2xs tabular-nums text-muted-foreground ${
        STRIP_CLASS[cell === null ? "none" : side]
      } ${divides ? "border-l border-border/60" : ""} ${
        cell === null ? "bg-muted/30" : ""
      }`}
      data-select="none"
      data-split-gutter={side}
    >
      {cell?.no ?? ""}
    </span>
  );
}

function Code({
  cell,
  className,
}: {
  cell: SplitCell | null;
  className: string;
}) {
  return (
    <span
      className={`${WRAP_CLASS} pr-2 ${cell === null ? "bg-muted/30" : className}`}
    >
      {cell === null || cell.text === "" ? " " : cell.text}
    </span>
  );
}
