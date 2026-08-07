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
// **While it is open, the palette owns the keyboard.** Every keydown that
// reaches the field has its propagation stopped, because the surfaces
// underneath bind ⌘1…9, ⌘`, ⌘T, ⇧⌘W, ⌥⌘←→ and Esc at the window — and a
// palette that let ⌘2 through would switch worktrees behind itself while the
// owner was typing "2" into a filter. The one exception is ⌘K, which is
// resolved in the capture phase before this handler ever runs
// (`lib/usePalette.ts`), so the key that opened this closes it.
//
// The handler is on the field rather than on the box around it, and that is
// where the keyboard is: the field takes focus on open and the list is walked
// with the arrows rather than tabbed through, so nothing else inside here ever
// holds it. It also keeps the box a plain container — an element with a
// keydown listener and no role of its own is a thing a screen reader cannot
// describe.
//
// **A blocked row is drawn and refuses.** Its reason replaces its detail line
// and Enter on it does nothing — the alternative is a row that disappears,
// which reads as a command that does not exist.

import * as React from "react";

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
        data-blocked={blocked === null ? undefined : "true"}
        data-kind={kind}
        data-testid={`palette-row-${id}`}
        onClick={onRun}
        onMouseMove={onHover}
        type="button"
      >
        <span
          aria-hidden="true"
          className="mt-0.5 w-4 shrink-0 text-center text-xs text-muted-foreground"
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
    close,
    cursor,
    moveCursor,
    open,
    query,
    run,
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

  // Keeps the cursor's row in view when the arrows walk past the fold. A
  // callback ref rather than an effect on `cursor`: the ref is attached to
  // whichever row is active, so it is called exactly when that row changes and
  // there is no dependency to keep honest.
  const activeRef = React.useCallback((row: HTMLLIElement | null) => {
    row?.scrollIntoView({ block: "nearest" });
  }, []);

  if (!open) return null;

  function handleKeyDown(event: React.KeyboardEvent) {
    // ⌘K is the capture-phase listener's, and it has already run.
    if (!hasPrimaryShortcutModifier(event.nativeEvent)) {
      const action = resolvePaletteListKey({
        altKey: event.altKey,
        key: event.key,
        primaryModifier: false,
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action !== null) {
        event.preventDefault();
        if (action.type === "close") close();
        else if (action.type === "move") moveCursor(action.delta);
        else run(cursor);
      }
    }
    // Every key, resolved or not: see this file's header.
    event.stopPropagation();
  }

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
          aria-label="go somewhere, or do something"
          autoCapitalize="none"
          autoCorrect="off"
          className="w-full shrink-0 border-b border-border/60 bg-transparent px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
          data-testid="palette-input"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Go somewhere, or do something…"
          ref={inputRef}
          spellCheck={false}
          type="text"
          value={query}
        />

        {view.rows.length === 0 ? (
          <p
            className="px-3 py-4 text-xs text-muted-foreground"
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

/** The only division the list ever has, and it exists only for the empty
 * query. A ranked list is not grouped — see `paletteModel.ts`. */
function PaletteHeading({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-2 pb-0.5 pt-1.5 text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
      {children}
    </li>
  );
}
