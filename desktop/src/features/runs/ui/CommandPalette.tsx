// The palette itself: one field, one list, centred over the work surface
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 1).
//
// **Not a Radix dialog.** The overlays this app already has portal to
// `document.body` and centre on the viewport; this one is positioned inside
// the workspace's main region by its parent, so it sits over the surface the
// owner is looking at rather than over the whole window including the sidebar
// he is not. It is also why nothing here traps focus in a portal: the field
// takes focus on open and hands it back on close, which is the whole of what a
// one-field surface needs.
//
// **While it is open, the palette owns the keyboard — wherever focus is.**
// The listener is on `window`, in the capture phase, for the life of an open
// palette. It was on the field, and that was wrong in three states the design
// itself produces: one ⇥ from the field, one ⇧⇥ onto the scrim, and a click on
// a blocked row, which is kept clickable on purpose. In each of those, focus
// is off the field, so a handler on the field answered for nothing — Esc fell
// through to the terminal's own window listener instead of closing this, and
// a sidebar toggle rearranged the columns underneath an open palette (⇧⌘B
// itself is retired — the workspace tree lives in the app sidebar now).
//
// Capture on `window` is what puts this ahead of the chords the surfaces
// underneath bind (`lib/useColumns.ts`, `ui/WorkSurface.tsx`,
// `ui/WorktreeDiffPanel.tsx` — all bubble-phase `window` listeners), so a ⌘2
// typed into a filter cannot switch worktrees behind it. The one exception is
// ⌘K, resolved by a capture listener registered first (`lib/usePalette.ts`),
// so the key that opened this closes it.
//
// Propagation is stopped for every key, resolved or not; the *default action*
// is not, so the field still receives everything typed into it and React's
// `onChange` (an `input` event, a separate dispatch) still fires.
//
// **A blocked row is drawn and refuses.** Its reason replaces its detail line
// and Enter on it does nothing — the alternative is a row that disappears,
// which reads as a command that does not exist.
//
// **Ask mode is this same surface with the list replaced.** Same key, same
// place, same field: a leading `?` turns what is typed into a question, and the
// list into a statement of what that question would be asked *with*. It is not
// a second overlay with its own rules, which is the confusion the palette
// exists to remove — and the scope block is not decoration. It is the only
// thing on screen that keeps "ask about this project" from reading as though
// the workspace had explained the project first.
//
// **The row is three columns, and every one of them is upstream's.** A kind
// icon (`features/search/ui/SearchResultItem.tsx` picks its glyph from the
// result's kind exactly this way), the label over its quiet second line, and
// the chord as keys in the boxes settings' own shortcut list draws
// (`features/settings/ui/KeyboardShortcutsCard.tsx`, and the Esc hint in
// `TopbarSearch.tsx`) — now `ui/Chord.tsx`, shared with the cheatsheet so the
// two surfaces that show the owner a shortcut show him the same thing. The
// outer columns are fixed, so the labels start on one x and the chords end on
// another and the eye scans a column instead of re-finding it per row.
//
// **Nothing here animates in.** Every transition in this file is
// `transition-colors` on a state that changes after the surface is already up;
// there is no enter animation, no opacity or transform ramp, and the field is
// focused in the same commit that mounts it. This is the surface the owner
// reaches for most, and a palette that has to finish arriving before it will
// take a keystroke is a palette that drops the first thing he types.

import * as React from "react";
import {
  Ban,
  FileCode,
  FolderGit2,
  GitBranch,
  Hash,
  PanelRight,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { Ask } from "@/features/runs/lib/askMode";
import { foldDictationSegment } from "@/features/dictation/lib/dictationFold";
import {
  type Dictation,
  useDictation,
} from "@/features/dictation/lib/useDictation";
import {
  DictationButton,
  DictationStatusRow,
} from "@/features/dictation/ui/DictationButton";
import type { PaletteHint } from "@/features/runs/lib/paletteDoors";
import { resolvePaletteListKey } from "@/features/runs/lib/paletteKeys";
import type {
  MatchRange,
  PaletteKind,
  PaletteMatch,
} from "@/features/runs/lib/paletteModel";
import type { Palette } from "@/features/runs/lib/usePalette";
import { Chord } from "@/features/runs/ui/Chord";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

/** The matched characters, emphasised in place. Built from the ranges the
 * matcher already produced, so what is highlighted is exactly what scored —
 * a second matching pass here would be a second opinion about why a row is in
 * the list. */
function Marked({
  ranges,
  text,
}: {
  ranges: readonly MatchRange[];
  text: string;
}) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const range of ranges) {
    if (range.start > at) parts.push(text.slice(at, range.start));
    parts.push(
      // Ranges never overlap and are ascending, so a start offset names one
      // run for the life of this render.
      <mark
        className="bg-transparent font-semibold text-foreground"
        key={`mark-${range.start}`}
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    at = range.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/** One glyph per kind, repeated down the column, so "these four are panes"
 * arrives from the shape rather than from four labels. Per-row glyphs were the
 * opposite: every row a different mark, which is exactly the arrangement that
 * cannot be scanned. A pane's own glyph still belongs to `PanePicker`, where
 * each row *is* a different pane.
 *
 * Lucide, drawn in `currentColor` like every other icon in this app, so the
 * same file serves both themes — a pair of images would be a second thing to
 * keep in step. */
const KIND_ICON: Record<PaletteKind, LucideIcon> = {
  action: Zap,
  // A hash for a channel — the mark every chat product in the owner's day uses
  // for the same noun, including this one's own sidebar. Borrowing it is what
  // makes a channel row legible in a list of worktrees without reading it.
  channel: Hash,
  file: FileCode,
  pane: PanelRight,
  project: FolderGit2,
  worktree: GitBranch,
};

function Row({
  active,
  match,
  onHover,
  onRun,
  rowRef,
}: {
  active: boolean;
  match: PaletteMatch;
  onHover: () => void;
  onRun: () => void;
  rowRef: React.Ref<HTMLLIElement>;
}) {
  const { blocked, chord, detail, id, kind, label } = match.candidate;
  const Icon = KIND_ICON[kind];
  return (
    <li ref={rowRef}>
      <button
        aria-disabled={blocked !== null}
        // Three states, on two channels that cannot mask each other, because a
        // row can be all three at once. **Where the cursor is** is the primary
        // tint plus a ring of it — upstream's own selected row
        // (`SearchResultItem.tsx`'s shell) — and **where the mouse is** is a
        // plain muted wash, a different hue and a weaker one. Those two used to
        // be `bg-muted` and `bg-muted/60`: the same colour at two strengths,
        // which is a difference nobody sees while typing. The border is on
        // every row, transparent when idle, so gaining it moves nothing.
        //
        // **Blocked is the other channel** — the reason line, in amber behind
        // its own mark — and it deliberately no longer dims the row. Dimming
        // was the whole signal, and it said "less" rather than "not, because…"
        // while making the label he is hunting for harder to read than the
        // runnable ones.
        className={`flex w-full items-start gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-colors ${
          active
            ? "border-primary/30 bg-primary/10"
            : "border-transparent hover:bg-muted/60"
        }`}
        // Where Enter would land, readable from outside React. The background
        // tint says the same thing to a person looking at it, and a test that
        // asserted on a Tailwind class would be asserting on a paint choice.
        data-active={active ? "true" : undefined}
        data-blocked={blocked === null ? undefined : "true"}
        data-kind={kind}
        data-testid={`palette-row-${id}`}
        onClick={onRun}
        onMouseMove={onHover}
        type="button"
      >
        <Icon
          aria-hidden="true"
          className={`mt-0.5 h-4 w-4 shrink-0 ${
            active ? "text-foreground" : "text-muted-foreground"
          }`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">
            {match.field === "label" ? (
              <Marked ranges={match.ranges} text={label} />
            ) : (
              label
            )}
          </span>
          {blocked === null ? (
            <span className="block truncate text-2xs text-muted-foreground/80">
              {match.field === "detail" ? (
                <Marked ranges={match.ranges} text={detail} />
              ) : (
                detail
              )}
            </span>
          ) : (
            <span className="flex min-w-0 items-center gap-1 text-amber-600 dark:text-amber-500">
              <Ban aria-hidden="true" className="h-3 w-3 shrink-0" />
              <span className="min-w-0 truncate text-2xs">{blocked}</span>
            </span>
          )}
        </span>
        {/* A blocked row shows no chord, because the chord is blocked too: the
         * key behind "Hide the worktrees" does nothing on the landing view
         * either. Printing it there would teach a shortcut that does not
         * work. */}
        {blocked === null && chord !== null ? <Chord chord={chord} /> : null}
      </button>
    </li>
  );
}

export function CommandPalette({ palette }: { palette: Palette }) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // Where focus was when the palette opened, so closing it does not strand a
  // keyboard owner on `<body>` — the same promise the pane host makes when a
  // solo takes the control that caused it off screen.
  const returnTo = React.useRef<Element | null>(null);
  const {
    ask,
    close,
    cursor,
    hints,
    moveCursor,
    open,
    placeholder,
    query,
    run,
    runCursor,
    setCursor,
    setQuery,
    view,
  } = palette;

  // ── Dictation into the ask box ──────────────────────────────────────
  // Button only, deliberately no chord here: this surface already claims
  // most of the keyboard in a capture-phase `window` listener while open
  // (this file's header), and a second global chord fighting for the same
  // keys inside a modal is a worse trade than one click — see
  // `dictationKeys.ts`'s header, which gives the message composer hold-right-⌥
  // instead. Query includes its leading `?`; folding onto the whole string
  // (not just the question) keeps this the same "append to what's typed"
  // behavior the composer's fold has.
  const queryRef = React.useRef(query);
  queryRef.current = query;
  const appendDictationSegment = React.useCallback(
    (text: string) => setQuery(foldDictationSegment(queryRef.current, text)),
    [setQuery],
  );
  const dictation = useDictation({ onSegment: appendDictationSegment });
  const dictationStop = dictation.stop;
  React.useEffect(() => {
    if ((!open || ask === null) && dictation.status !== "idle") {
      dictationStop();
    }
  }, [open, ask, dictation.status, dictationStop]);

  React.useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement;
    inputRef.current?.focus();
    return () => {
      const held = returnTo.current;
      returnTo.current = null;
      if (held instanceof HTMLElement && held.isConnected) held.focus();
    };
  }, [open]);

  // See this file's header: window, capture phase, only while open.
  React.useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      const action = resolvePaletteListKey({
        altKey: event.altKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action !== null) {
        event.preventDefault();
        if (action.type === "close") close();
        else if (action.type === "move") moveCursor(action.delta);
        else if (action.type === "refocus") inputRef.current?.focus();
        else runCursor();
      }
      event.stopPropagation();
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [close, moveCursor, open, runCursor]);

  // Keeps the cursor's row in view when the arrows walk past the fold. A
  // callback ref rather than an effect on `cursor`: the ref is attached to
  // whichever row is active, so it is called exactly when that row changes and
  // there is no dependency to keep honest.
  const activeRef = React.useCallback((row: HTMLLIElement | null) => {
    row?.scrollIntoView({ block: "nearest" });
  }, []);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
      {/* A real button rather than a div with a click handler: the scrim is an
       * act ("put this away"), and one an assistive technology should be able
       * to name and reach. */}
      <button
        aria-label="close the palette"
        className="absolute inset-0 cursor-default bg-background/70"
        data-testid="palette-scrim"
        onClick={close}
        type="button"
      />
      <div
        className="relative flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border/60 bg-popover shadow-2xl"
        data-testid="palette"
      >
        <input
          aria-label={ask === null ? placeholder : "ask about this worktree"}
          autoCapitalize="none"
          autoCorrect="off"
          className="w-full shrink-0 border-b border-border/60 bg-transparent px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
          data-testid="palette-input"
          onChange={(event) => setQuery(event.target.value)}
          // Names the door rather than the app, and it is the only thing on
          // screen that does — the surface is identical in all four modes on
          // purpose (`paletteDoors.ts`), so this line and the hint row below
          // are what keep "which list is this" answerable without pressing
          // anything.
          placeholder={placeholder}
          ref={inputRef}
          spellCheck={false}
          type="text"
          value={query}
        />

        {ask !== null ? (
          <AskPanel ask={ask} dictation={dictation} />
        ) : view.rows.length === 0 ? (
          <p
            className="px-3 py-4 text-sm text-muted-foreground"
            data-testid="palette-empty"
          >
            nothing here matches <span className="font-semibold">{query}</span>.
          </p>
        ) : (
          <ul
            className="min-h-0 flex-1 overflow-y-auto p-1.5"
            data-testid="palette-list"
          >
            {view.rows.map((match, index) => (
              <React.Fragment key={match.candidate.id}>
                {index === 0 && view.recentCount > 0 ? (
                  <PaletteHeading>Recent</PaletteHeading>
                ) : null}
                {index === view.recentCount && view.recentCount > 0 ? (
                  <PaletteHeading>Everything else</PaletteHeading>
                ) : null}
                <Row
                  active={index === cursor}
                  match={match}
                  onHover={() => setCursor(index)}
                  onRun={() => run(index)}
                  rowRef={index === cursor ? activeRef : null}
                />
              </React.Fragment>
            ))}
          </ul>
        )}
        {ask === null ? <HintRow hints={hints} /> : null}
      </div>
    </div>
  );
}

/** **The three doors, one line each** — the whole of what this surface teaches
 * about the grammar (`paletteDoors.ts`, Task 2's "one hint row, not a
 * tutorial").
 *
 * It is a footer rather than an empty-state, because the state it has to be
 * read in is the one where the list is *wrong*: he pressed ⌘K, got projects,
 * and wants commands. A hint that only appeared over an empty box would be
 * absent exactly then.
 *
 * The mode he is standing in is not offered, and neither is a door this host
 * has no sources for — both cuts are `paletteHints`', handed down through
 * `palette.hints` so this surface never has to know what a host can answer for.
 * A row that offered ⌘P on a chat route would be teaching a chord that
 * deliberately falls through there. What is left is one to three ways out,
 * drawn as keys in the same boxes the rows draw their chords in, so the one
 * vocabulary for "press this" holds across the whole surface.
 *
 * With nothing left to teach the row does not draw: a rule with no lines in it
 * is a border, and a border under a list is a division that means nothing. */
function HintRow({ hints }: { hints: readonly PaletteHint[] }) {
  if (hints.length === 0) return null;
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 px-3 py-1.5"
      data-testid="palette-hints"
    >
      {hints.map((hint) => (
        <span
          className="flex items-center gap-1 text-2xs text-muted-foreground/80"
          data-testid={`palette-hint-${hint.what}`}
          key={hint.what}
        >
          <Chord chord={hint.key} />
          {hint.what}
        </span>
      ))}
    </div>
  );
}

/** What the list is replaced by in ask mode: **what this question is being
 * asked with**, stated before it is asked, and the reason it cannot be asked
 * when there is one.
 *
 * The copy is `askMode.ts`'s and is printed verbatim. Nothing is composed here
 * — a sentence about scope assembled in a component is a sentence no test can
 * hold to, and the whole risk of this mode is a nice surface implying the model
 * was handed more than a path. */
function AskPanel({ ask, dictation }: { ask: Ask; dictation: Dictation }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-3" data-testid="palette-ask">
      <div className="flex items-center justify-between gap-2">
        {/* One eyebrow appearance in this overlay — see `PaletteHeading`. */}
        <p className="text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          asked with
        </p>
        <DictationButton dictation={dictation} />
      </div>
      <DictationStatusRow dictation={dictation} />
      {ask.sent.length > 0 ? (
        <ul className="flex flex-col gap-0.5" data-testid="palette-ask-sent">
          {ask.sent.map((line) => (
            <li
              className="truncate font-mono text-2xs text-foreground"
              key={line}
            >
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      <p
        className="text-sm text-muted-foreground"
        data-testid="palette-ask-note"
      >
        {ask.note}
      </p>
      {ask.blocked === null ? (
        <p
          className="text-2xs text-muted-foreground/80"
          data-testid="palette-ask-ready"
        >
          ↵ asks it, and the answer lands in the Agent pane.
        </p>
      ) : (
        <p
          className="text-sm text-amber-600 dark:text-amber-500"
          data-testid="palette-ask-blocked"
        >
          {ask.blocked}
        </p>
      )}
    </div>
  );
}

/** The only division the list ever has, and it exists only for the empty
 * query. A ranked list is not grouped — see `paletteModel.ts`.
 *
 * The size is the workspace's Eyebrow and is not negotiable here
 * (`vingilot/docs/workbench.md`, "The type scale"); what a heading at 8px has
 * left to be legible with is contrast and air, so it takes the full muted
 * foreground rather than 70% of it, and enough room above to read as a break
 * in the list rather than as the first row's own line. */
function PaletteHeading({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-2 pb-1 pt-2.5 text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </li>
  );
}
