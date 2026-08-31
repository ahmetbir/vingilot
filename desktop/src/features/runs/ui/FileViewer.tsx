// The Files pane's right half: the open file, drawn
// (vingilot/docs/plans/2026-08-12-files-pane-design.md §"The viewer";
// split out of `FilesPane.tsx` when the escape hatch's button landed in its
// header, vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 1).
//
// **Split rather than grown.** `FilesPane.tsx` was at 951 lines against this
// repo's 1000-line ratchet, and the rule is that an edit there begins with a
// split. The seam is the one the file already had: everything from `FileViewer`
// down reads a `ViewState` and draws it, and knows nothing about the tree, the
// drawer, the two commands or the keyboard walk. What is left in `FilesPane` is
// the pane; what is here is the file.
//
// **Every decision below arrived with the code it belongs to** — the amber a
// find match wears, why a match is painted over spans rather than over the
// text, why both render paths emit one element per line, and why the marked
// line is set on the DOM rather than in the JSX. They are unchanged; the header
// each one lives under is its own.
//
// The one thing this file gained in the move is the escape hatch's button in
// the viewer header (`OpenInEditor`), which is here because this is where the
// open file is named, and a control about *this file* has to sit beside its
// name.

import * as React from "react";
import type { ThemedToken } from "shiki";

import type { FileTextValue } from "@/features/runs/lib/filesClient";
import {
  type FilesError,
  filesRefusal,
  humanCount,
  humanSize,
} from "@/features/runs/lib/filesModel";
import {
  markedLineIndex,
  previewableAsMarkdown,
  viewerPlan,
} from "@/features/runs/lib/fileViewer";
import {
  type FindLine,
  type FindMatch,
  NO_MATCHES,
  segmentSpan,
} from "@/features/runs/lib/findInFile";
import { useFindInFile } from "@/features/runs/lib/useFindInFile";
import { labelParts } from "@/features/runs/lib/worktreeDiff";
import { FindBar } from "@/features/runs/ui/FindBar";
import { MarkdownPreviewToggle } from "@/features/runs/ui/MarkdownPreviewToggle";
import { OpenInEditor } from "@/features/runs/ui/OpenInEditor";
import { PaneEmpty } from "@/features/runs/ui/PaneEmpty";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { resolveShikiThemeName } from "@/shared/theme/theme-loader";
import { Markdown } from "@/shared/ui/markdown";
import { tokenizeChunked } from "@/shared/ui/markdown/CodeBlock";

/** What the viewer is showing, or why it is not. Four states and not three:
 * `reading` is kept apart from `empty` because a file being read and no file
 * chosen look identical if they share a branch, and one of them is a wait. */
export type ViewState =
  | { status: "empty" }
  | { status: "reading"; path: string }
  | { status: "read"; file: FileTextValue; line: number | null }
  | { status: "refused"; path: string; error: FilesError };

export const NOTHING_OPEN: ViewState = { status: "empty" };

export function FileViewer({
  cwd,
  paneRef,
  state,
}: {
  /** The checkout the open file belongs to — the escape hatch's other half of
   * a target (`FileTarget.worktree`), and meaningless without it: two worktrees
   * of one project both have `src/main.rs`. */
  cwd: string;
  /** The pane's own root, handed down for one reason: it is where the ⌘F
   * boundary is drawn (`findKeys.ts`'s header). */
  paneRef: React.RefObject<HTMLElement | null>;
  state: ViewState;
}) {
  // **The Source⇄Preview choice, held here and nowhere else.** Per-pane, not a
  // module singleton (`MarkdownPreviewToggle`'s header argues the difference from
  // `useDiffMode`): this `FileViewer` is one Files pane's viewer, so its state is
  // that pane's, it survives the file changing under it and the pane losing
  // focus (the pane stays mounted), and it resets when a community switch
  // remounts the subtree — no store to leak, nothing for `resetCommunityState`.
  // Above the `status` branches so the hook is unconditional; the choice
  // outlives an empty→read transition (`FileBody` remounts, this does not).
  const [preview, setPreview] = React.useState(false);
  if (state.status === "empty") {
    // The pane's one designed moment (`PaneEmpty`). The old single sentence
    // ("Pick a file on the left. Arrow keys move, Enter opens.") split into
    // the sentence and the keyboard hint — same words, same claims, arranged
    // as the empty-state shape every pane now shares. Not pinned by any spec;
    // stated here because rewording a state sentence is a decision, not a
    // side effect.
    return (
      <PaneEmpty
        glyph="⌸"
        hint="arrow keys move · Enter opens"
        sentence="Pick a file on the left."
        testid="files-viewer-empty"
      />
    );
  }
  if (state.status === "reading") {
    return (
      <p
        className="p-3 text-xs text-muted-foreground"
        data-testid="files-viewer-reading"
      >
        reading {state.path}…
      </p>
    );
  }
  if (state.status === "refused") {
    // **Each refusal is its own sentence** — Task 3's last checkbox. The words
    // are `filesRefusal`'s, so they are tested without a browser, and every one
    // of them names the thing in the way.
    return (
      <p
        className="p-3 text-xs text-foreground"
        data-testid="files-viewer-refusal"
      >
        {filesRefusal(state.error)}
      </p>
    );
  }

  return (
    <FileBody
      cwd={cwd}
      file={state.file}
      line={state.line}
      onTogglePreview={() => setPreview((on) => !on)}
      paneRef={paneRef}
      preview={preview}
    />
  );
}

/** Said in the field's own title, which is where he is when the question comes
 * up. **Smart case is a rule he cannot see the effect of** — a lower-case query
 * matching a capital looks like a bug until you know the rule — and the plan asks
 * for it in a title rather than as a third control, because a case toggle is one
 * more thing to get into the wrong position. */
const SMART_CASE_TITLE =
  "Find in this file. Smart case: matches either case until you type a capital letter, then it matches exactly. Enter for the next match, ⇧Enter for the previous, Esc to close.";

/** The amber wash `badge.tsx`'s warning variant already speaks and the Search
 * pane already uses for a hit — the one hue every editor uses for a find match,
 * so this is the app's existing vocabulary rather than a new colour.
 *
 * `text-foreground` is not decoration: a `<mark>` carries a UA background *and* a
 * UA colour, so a match inside a Shiki token would otherwise lose the token's
 * colour to `marktext`. On the highlighted path the token's own inline colour
 * overrides this; on the plain path this is what keeps the text readable. */
const MATCH_CLASS = "rounded-sm bg-amber-500/25 text-foreground";

/** The current match, emphasised. **The same hue, more of it, plus a ring** —
 * rather than a second colour, because the two marks mean the same thing and
 * differ only in which one he is on. A ring rather than a weight change: bold
 * would re-flow a monospace line and make the walk look like the file is moving. */
const CURRENT_MATCH_CLASS =
  "rounded-sm bg-amber-500/60 text-foreground ring-1 ring-amber-500";

/** One span of the file, drawn with the find's amber where a match covers it.
 *
 * **This is the seam between the find and the highlighter, and it works over the
 * text on purpose.** `matches` are offsets into `file.text` (`findInFile.ts`'s
 * header argues why), `offset` says where this particular span starts in that
 * same text, and `segmentSpan` does the arithmetic. So one function serves both
 * render paths: on the plain path a span is a whole line, on the highlighted path
 * it is one of Shiki's tokens, and a match that straddles two tokens arrives as
 * two segments carrying the same match index — both amber, both emphasised
 * together when it is the current one.
 *
 * With no matches on the line this renders exactly what the viewer rendered
 * before ⌘F existed: the bare text, or one coloured span. A closed find bar costs
 * the viewer no extra elements at all. */
function Painted({
  color,
  current,
  first,
  matches,
  offset,
  text,
}: {
  color: string | undefined;
  current: number;
  /** Where this line's matches start in the file's list — without it the
   * emphasis lands once per line instead of once per file (`FindLine`'s own
   * doc comment records the defect). */
  first: number;
  matches: FindMatch[];
  offset: number;
  text: string;
}) {
  const style = color === undefined ? undefined : { color };
  if (matches.length === 0) {
    if (style === undefined) return text;
    return <span style={style}>{text}</span>;
  }
  return segmentSpan(text, offset, matches, first).map((segment, at) =>
    segment.match === null ? (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reordered
        key={at}
        style={style}
      >
        {segment.text}
      </span>
    ) : (
      <mark
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reordered
        key={at}
        className={
          segment.match === current ? CURRENT_MATCH_CLASS : MATCH_CLASS
        }
        data-testid={
          segment.match === current ? "files-find-current" : "files-find-match"
        }
        style={style}
      >
        {segment.text}
      </mark>
    ),
  );
}

/** One rendered line of the viewer, either path. Empty lines render one space
 * — a block-level span with no content collapses to zero height, which is a
 * file whose blank lines have vanished (`PatchView` keeps the same rule).
 *
 * `lines` is the find's per-line match set or `null` for "no find running", and
 * it is indexed positionally — the same positional agreement between the two
 * render paths that `markedLineIndex` already depends on. */
function ViewerLines({
  current,
  lines,
  text,
  tokens,
}: {
  current: number;
  lines: FindLine[] | null;
  text: string;
  tokens: ThemedToken[][] | null;
}) {
  if (tokens !== null) {
    return tokens.map((lineTokens, index) => {
      const line = lines?.[index];
      // Where each token starts in the file, accumulated across the line.
      // Shiki tokenises the very text this walk measures — `tokenizeChunked` is
      // handed `file.text` and its tokens partition each line of it — so the
      // running total and `line.start` are two readings of one string.
      let at = line?.start ?? 0;
      return (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
          key={index}
          className="block"
          data-line=""
        >
          {lineTokens.length === 0
            ? " "
            : lineTokens.map((token, tokenAt) => {
                const offset = at;
                at += token.content.length;
                return (
                  <Painted
                    // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional and never reordered
                    key={tokenAt}
                    color={token.color}
                    current={current}
                    first={line?.first ?? 0}
                    matches={line?.matches ?? NO_MATCHES}
                    offset={offset}
                    text={token.content}
                  />
                );
              })}
        </span>
      );
    });
  }
  return text.split("\n").map((lineText, index) => {
    const line = lines?.[index];
    return (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
        key={index}
        className="block"
        data-line=""
      >
        {lineText === "" ? (
          " "
        ) : (
          <Painted
            color={undefined}
            current={current}
            first={line?.first ?? 0}
            matches={line?.matches ?? NO_MATCHES}
            offset={line?.start ?? 0}
            text={lineText}
          />
        )}
      </span>
    );
  });
}

/** Both render paths share one class list, so the background swap changes the
 * colours and nothing else: same font, same size, same `code-block-lines` line
 * numbers, no geometry to jump. `text-xs` rather than the chat block's
 * `text-sm` — the viewer's body sits beside `PatchView`'s patches and the
 * pane's own rows, and the file body is the one thing on the right side that
 * was speaking chat's size. */
const VIEWER_BODY_CLASS =
  "code-block-lines w-max min-w-full whitespace-pre font-mono text-xs text-foreground";

/** **The file's text is one of the five surfaces that may be selected**
 * (redesign P4.2). The shell is `user-select: none` and this opts back in — on
 * the `<pre>` that holds the source and NOT on the header, the path or the
 * plain-text note above it.
 *
 * The line numbers are already excluded and were before this rule existed:
 * they are `.code-block-lines [data-line]::before` generated content carrying
 * its own `user-select: none` (shared/styles/globals/markdown.css), which is
 * exactly the owner's "dosya satir numaralari filan secilemez olmali". So a
 * drag down the viewer copies the code and never the gutter. */
const VIEWER_SELECTABLE = { "data-select": "text" } as const;

function FileBody({
  cwd,
  file,
  line,
  onTogglePreview,
  paneRef,
  preview,
}: {
  cwd: string;
  file: FileTextValue;
  line: number | null;
  onTogglePreview: () => void;
  paneRef: React.RefObject<HTMLElement | null>;
  preview: boolean;
}) {
  const plan = viewerPlan(file.path, file.bytes);
  // Only a `.md` is offered — and only actually shown as prose — as rendered
  // markdown (`previewableAsMarkdown`). `showPreview` folds the pane's choice
  // with what this file can do: a preview that survived onto a `.rs` the reader
  // then opened would draw one span of source as if it were prose.
  const canPreview = previewableAsMarkdown(file.path);
  const showPreview = preview && canPreview;

  // **Task 0: the tokens arrive in the background, the text never waits.**
  // The file renders as plain `data-line` spans immediately — the pane must
  // never wait on a tokeniser — and `tokenizeChunked` (the same Shiki, the
  // same caches, sliced; measurements at its definition) delivers the token
  // lines when they are ready. The answer is kept WITH the text it is an
  // answer about: a swap that outlived its file would colour the next file
  // with this one's tokens.
  const [swap, setSwap] = React.useState<{
    text: string;
    tokens: ThemedToken[][];
  } | null>(null);
  const { themeName } = useTheme();
  const shikiTheme = resolveShikiThemeName(themeName);
  React.useEffect(() => {
    if (plan.render !== "highlighted") return;
    let cancelled = false;
    void tokenizeChunked(
      file.text,
      plan.language,
      shikiTheme,
      () => cancelled,
    ).then((tokens) => {
      if (cancelled || tokens === null) return;
      setSwap({ text: file.text, tokens });
    });
    return () => {
      cancelled = true;
    };
  }, [file.text, plan.language, plan.render, shikiTheme]);
  const tokens =
    plan.render === "highlighted" && swap !== null && swap.text === file.text
      ? swap.tokens
      : null;

  // **What makes `line` a landing rather than a label.** Both render paths draw
  // one element per line — `ViewerLines` emits a `<span data-line>` per line on
  // each — so the asked-for line is found by index, marked and scrolled to,
  // whichever path rendered it. A search result that named a line and then
  // dropped him at the top of a 2,000-line file would be a door onto the wrong
  // side of the room.
  //
  // **Marked in the DOM rather than in the JSX** so the index arithmetic stays
  // one call of `markedLineIndex`, and re-marked after the background swap —
  // the swap replaces every line element, and a mark that survived only until
  // the colours arrived would be a door that closes itself.
  const bodyRef = React.useRef<HTMLElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the file and the swap are not read inside the effect, but they are what the effect reads the DOM *after* — the rows only exist once this file's text (or its tokenised replacement) has rendered, and two search hits at the same line in different files carry the same `line`. Dropping them would leave the second hit scrolled to wherever the first one left the box, and dropping `tokens` would lose the mark at the moment the swap rebuilds the rows.
  React.useEffect(() => {
    const index = markedLineIndex(line);
    if (index === null) return;
    const body = bodyRef.current;
    if (body === null) return;
    const found = body.querySelectorAll("[data-line]")[index];
    if (found === undefined) return;
    found.classList.add("bg-muted");
    found.setAttribute("data-testid", "files-viewer-marked-line");
    found.scrollIntoView({ block: "center" });
    return () => {
      found.classList.remove("bg-muted");
      found.removeAttribute("data-testid");
    };
  }, [line, file.path, file.text, tokens]);

  // **⌘F, over the text.** The hook owns the chord boundary (`findKeys.ts`'s
  // header) and the match set; what it is handed is `file.text` and never the
  // rendered spans, so the count is the same number before and after the
  // background tokenise lands. `enabled` is unconditional here because this
  // component only exists when a file is open — the empty state and the refusals
  // are earlier branches of `FileViewer`, and on those the chord stays upstream's.
  // ⌘F paints its amber over the file's source spans (`ViewerLines`), and the
  // preview renders none — it is prose, not one element per line. So find is a
  // source-view tool: disabled while previewing rather than left to count
  // matches it cannot show, which would light the find bar over a file with
  // nothing highlighted in it. Toggling back to source re-enables it.
  const find = useFindInFile({
    enabled: !showPreview,
    paneRef,
    text: file.text,
    viewerRef: bodyRef,
  });

  // **Tried and reverted: focusing the viewer whenever a file opens.** The
  // row that opens a file lives in the sidebar's tree (pane-nav-absorb moved
  // the tree out of this pane), so a MOUSE click leaves focus on a button
  // `paneRef` does not contain — `ownsChord` (`findKeys.ts`'s boundary)
  // answers "not mine", and ⌘F right after opening a file that way does
  // nothing. An effect that focused `bodyRef` on every `file.path` change
  // fixed exactly that (`workspace-find.spec.ts`'s "no click in between"
  // tests went green) — and broke `workspace-files.spec.ts`'s "the tree
  // walks under the arrow keys and opens a file under Enter": Enter is a
  // KEYBOARD open, and that test's whole claim is that focus stays on the
  // tree afterward so ArrowLeft keeps walking it. The DOM at the moment this
  // effect would fire is IDENTICAL in both cases — a tree row has focus,
  // a file is open — so nothing here can tell "he clicked, about to search"
  // from "he pressed Enter, about to keep walking" apart. Fixing one broke
  // the other outright; reverted rather than trade a regression for a
  // regression. The mouse-click case is real, open debt — the honest fix
  // needs either `ownsChord` to recognise the sidebar's tree row as this
  // pane's own (new coupling `findKeys.ts` does not have today) or the
  // opening click itself to carry an explicit "and take the keyboard" intent
  // through `filesTarget.ts` — not a blind focus grab in this effect.

  // **Walking scrolls the viewer**, which is the half that makes Enter a walk
  // rather than a counter. Read off the DOM rather than computed as a line
  // number, for the reason the marked-line effect above already records: both
  // render paths produce their own elements, and the current match is whichever
  // element carries the mark — so this is right on the plain path, on the
  // highlighted path, and across the swap between them.
  //
  // `nearest` and not `center`: he is walking matches a few lines apart, and a
  // viewer that re-centred on every Enter would move the file under him even
  // when the next match was already on screen. The landing from outside the pane
  // centres, because that is an arrival rather than a step.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `find.matches` and `tokens` are not read in the effect — they are what the effect reads the DOM *after*. A keystroke that changes the match set, and the swap that rebuilds every line element, both move the mark this scrolls to.
  React.useEffect(() => {
    if (!find.open || find.current < 0) return;
    bodyRef.current
      ?.querySelector('[data-testid="files-find-current"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [find.open, find.current, find.matches, tokens]);

  const parts = labelParts(file.path);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="files-viewer">
      <div className="flex shrink-0 items-baseline gap-2 border-b border-border/60 px-2 py-1">
        {/* The shared truncation rule: the directory dims and gives way, the
            basename stays bright — the same `labelParts` arrangement the Diff
            pane's header keeps, because this line is the only place the open
            file is named at this width. */}
        <span
          className="flex min-w-0 items-baseline text-xs"
          data-testid="files-viewer-path"
          title={file.path}
        >
          {parts.lead === "" ? null : (
            <span className="min-w-0 truncate text-muted-foreground">
              {parts.lead}
            </span>
          )}
          <span className="max-w-full shrink-0 truncate text-foreground">
            {parts.name}
          </span>
        </span>
        <span className="ml-auto shrink-0 text-2xs tabular-nums text-muted-foreground">
          {humanCount(file.lines)} lines · {humanSize(file.bytes)}
        </span>
        {/* **Source⇄Preview, only for a `.md`.** Absent for every other file
            rather than disabled — a `.rs` has no prose form, so a control that
            explained its own uselessness would be the noise the plain-note is
            careful not to add. A toolbar toggle only: no keyboard chord ships,
            because ⇧⌘V is the one free corner and claiming it owes the full
            five-claimant re-audit + the AppKit ⌥-synthesis check the island's
            key maps carry (`scratchMarkdownKeys.ts`), and the header button
            alone satisfies "markdown preview" honestly. */}
        {canPreview ? (
          <MarkdownPreviewToggle
            onToggle={onTogglePreview}
            preview={preview}
            testid="files-preview-toggle"
          />
        ) : null}
        {/* **The escape hatch, where the file is named.** Not hover-revealed
            here: this is a header rather than a row, the file it acts on is the
            one the whole pane is showing, and a control that appeared only
            under the pointer would be a door he had to already know about.
            `line` is the viewer's landing line, so "open in Cursor" from a
            search hit arrives at the hit — which is the entire point of the
            rung (ADR-005, rung 3), and the thing `open -a` cannot do. */}
        <OpenInEditor
          line={line}
          path={file.path}
          testid="files-open-in-editor"
          worktree={cwd}
        />
      </div>
      {plan.why === null || showPreview ? null : (
        // The honest half of the one remaining ceiling: a file the viewer will
        // not highlight says why, in words, with the numbers. A fallback he
        // cannot see is a bug report. See `fileViewer.ts`'s header. Silent while
        // previewing: the sentence explains the *source* rendering, and a
        // markdown file past the tokenise budget is still rendered as prose —
        // the budget bounds Shiki, not the chat pipeline.
        <p
          className="shrink-0 border-b border-border/60 px-2 py-1 text-2xs text-muted-foreground"
          data-testid="files-viewer-plain-note"
        >
          {plan.why}
        </p>
      )}
      {/* `relative` so the find bar floats over the file rather than over the
          whole pane, and `overflow-hidden` so it is the inner box that scrolls —
          a bar inside the scrolling box would slide off the top on the first
          PageDown. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {showPreview ? (
          // **The prose half, drawn by the app's own chat pipeline** — the same
          // `Markdown` the README panel renders a repo's readme with
          // (`ProjectReadmePanel`), `interactive={false}` so its mention,
          // channel-link and link-preview machinery goes inert: an external link
          // renders as plain text rather than an `<a>` that would navigate the
          // webview, and nothing here reaches the relay. No new parser and no new
          // cache — it rides `renderCachedMarkdown`/`clearMarkdownNodeCache`,
          // which is already wired into `resetCommunityState()`.
          //
          // **Content is `file.text`, the buffer itself.** The Files viewer is
          // read-only (there is no editor here to reconcile against), so the
          // preview is the current buffer by construction — live, not a snapshot
          // taken at toggle time.
          <div
            className="h-full overflow-auto p-3"
            data-testid="files-viewer-preview"
          >
            <Markdown
              className="text-sm"
              content={file.text}
              interactive={false}
            />
          </div>
        ) : (
          <>
            {/* **A focusable scroll region**, which it had to become for two
                reasons that arrived together: Escape out of the find bar has
                somewhere to put focus, and the file he is reading answers
                ↑↓/PageDown without a click first. The focus ring is upstream's
                inset one, so nothing moves. */}
            {/* A `<section>` rather than a div with `role="region"` — the element
                carries the role, which is what `useSemanticElements` is for. */}
            <section
              aria-label="the open file"
              className="h-full overflow-auto p-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              data-testid="files-viewer-body"
              ref={bodyRef}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region that cannot be reached by keyboard is a WCAG 2.1.1 failure, and `tabindex="0"` on the scroll container is the technique for it — there is no interactive element here to hang it on, because the viewer is deliberately not an editor. It is also where Escape puts focus when the find bar closes, and a bar that closed onto nothing would leave this pane keyboard-dead.
              tabIndex={0}
            >
              {plan.render === "highlighted" ? (
                // `data-highlighted` says which of the two renderings is up, so a
                // spec can assert the swap happened instead of inferring it from
                // colour counts alone.
                <pre
                  {...VIEWER_SELECTABLE}
                  className={VIEWER_BODY_CLASS}
                  data-highlighted={tokens === null ? "false" : "true"}
                  data-testid="files-viewer-code"
                >
                  <ViewerLines
                    current={find.current}
                    lines={find.lines}
                    text={file.text}
                    tokens={tokens}
                  />
                </pre>
              ) : (
                <pre
                  {...VIEWER_SELECTABLE}
                  className={VIEWER_BODY_CLASS}
                  data-testid="files-viewer-plain"
                >
                  {/* `data-line` on every line and nothing about `line` here: which
                  one is marked is the effect's single answer, so the two
                  renderers cannot disagree about what "line 12" means. */}
                  <ViewerLines
                    current={find.current}
                    lines={find.lines}
                    text={file.text}
                    tokens={null}
                  />
                </pre>
              )}
            </section>
            {find.open ? (
              <FindBar
                ariaLabel="find in this file"
                find={find}
                hint={SMART_CASE_TITLE}
                testIdPrefix="files-find"
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
