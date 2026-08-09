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
// ⇧⌘B rearranged the columns underneath an open palette.
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

import * as React from "react";

import type { Ask } from "@/features/runs/lib/askMode";
import { resolvePaletteListKey } from "@/features/runs/lib/paletteKeys";
import type {
  MatchRange,
  PaletteMatch,
} from "@/features/runs/lib/paletteModel";
import type { Palette } from "@/features/runs/lib/usePalette";
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
  const { blocked, detail, icon, id, kind, label } = match.candidate;
  return (
    <li ref={rowRef}>
      <button
        aria-disabled={blocked !== null}
        className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
          active ? "bg-muted" : "hover:bg-muted/60"
        } ${blocked === null ? "" : "opacity-60"}`}
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
        <span
          aria-hidden="true"
          className="mt-0.5 w-4 shrink-0 text-center text-sm text-muted-foreground"
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">
            {match.field === "label" ? (
              <Marked ranges={match.ranges} text={label} />
            ) : (
              label
            )}
          </span>
          <span
            className={`block truncate text-2xs ${
              blocked === null
                ? "text-muted-foreground/80"
                : "text-amber-600 dark:text-amber-500"
            }`}
          >
            {blocked === null ? (
              match.field === "detail" ? (
                <Marked ranges={match.ranges} text={detail} />
              ) : (
                detail
              )
            ) : (
              blocked
            )}
          </span>
        </span>
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
    moveCursor,
    open,
    query,
    run,
    runCursor,
    setCursor,
    setQuery,
    view,
  } = palette;

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
          aria-label={
            ask === null
              ? "go somewhere, or do something"
              : "ask about this worktree"
          }
          autoCapitalize="none"
          autoCorrect="off"
          className="w-full shrink-0 border-b border-border/60 bg-transparent px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
          data-testid="palette-input"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Go somewhere, or do something… (? to ask)"
          ref={inputRef}
          spellCheck={false}
          type="text"
          value={query}
        />

        {ask !== null ? (
          <AskPanel ask={ask} />
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
      </div>
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
function AskPanel({ ask }: { ask: Ask }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-3" data-testid="palette-ask">
      <p className="text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
        asked with
      </p>
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
 * query. A ranked list is not grouped — see `paletteModel.ts`. */
function PaletteHeading({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-2 pb-0.5 pt-1.5 text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
      {children}
    </li>
  );
}
