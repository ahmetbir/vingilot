// The sheet: every chord this workspace binds, on one surface, plus the ones
// that are not its own (vingilot/docs/plans/2026-08-09-keys-and-type.md,
// Task 4).
//
// **Nothing here knows a chord.** The rows come from `lib/cheatsheet.ts`,
// which asks the island's own `resolve*` functions what they answer to; this
// file draws what it is handed and nothing else. A component that wrote a
// chord down would be the stale list the whole feature exists to avoid, and it
// would go stale in the one place nobody re-reads.
//
// **The idiom is the palette's, deliberately.** Same box (`absolute inset-0`
// over the work surface rather than a portal over the whole window, so it
// covers what the owner is working on), same scrim-as-a-button, same rounded
// popover, same eyebrow over a group, and the chords in the same kbd boxes —
// `ui/Chord.tsx`, which the palette's rows now draw with too. This is a second
// surface, not a second design language, and the palette is the one the owner
// already reads.
//
// **While it is up, this surface owns the plain keys and none of the chords.**
// Esc closes it (`resolveOpenCheatsheetKey`); every other unmodified key is
// stopped here rather than reaching the terminal underneath, which would take
// a stray keystroke as shell input. Anything with ⌘ or ⌥ held falls through
// untouched, so the ⌘/ that opened this still closes it, ⌘K still reaches the
// palette, and the chords the owner is reading about still work while he reads
// about them — which is the whole point of a sheet you can leave open.
//
// **Nothing animates in**, for `CommandPalette.tsx`'s reason: this is a
// surface the owner opens mid-thought and closes a second later, and an
// entrance ramp is a second he waits.

import * as React from "react";

import {
  cheatsheet,
  CHORD_ELISION,
  chordRun,
} from "@/features/runs/lib/cheatsheet";
import { resolveOpenCheatsheetKey } from "@/features/runs/lib/cheatsheetKeys";
import type { Cheatsheet } from "@/features/runs/lib/useCheatsheet";
import { Chord } from "@/features/runs/ui/Chord";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

/** Every chord for one row, drawn. `chordRun` folds ⌘1…⌘9 into its two ends —
 * nine boxes in a row is a wall rather than a shortcut — and the ellipsis it
 * leaves is written as text between the boxes rather than inside one, because
 * it is not a key anybody presses. */
function Chords({ chords }: { chords: readonly string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {chordRun(chords).map((chord) =>
        chord === CHORD_ELISION ? (
          <span className="text-2xs text-muted-foreground/70" key={chord}>
            {CHORD_ELISION}
          </span>
        ) : (
          <Chord chord={chord} key={chord} />
        ),
      )}
    </span>
  );
}

export function KeyCheatsheet({ sheet }: { sheet: Cheatsheet }) {
  const { close, open } = sheet;

  // See this file's header: window, capture phase, only while open.
  React.useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      const modified =
        hasPrimaryShortcutModifier(event) || event.altKey === true;
      const action = resolveOpenCheatsheetKey({
        altKey: event.altKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action !== null) {
        event.preventDefault();
        close();
      }
      // A chord is somebody else's — the sheet is a thing you read *while*
      // pressing the keys it describes.
      if (!modified) event.stopPropagation();
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [close, open]);

  if (!open) return null;

  const sections = cheatsheet();

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
      {/* A real button, for `CommandPalette.tsx`'s reason: the scrim is an act
       * an assistive technology should be able to name and reach. */}
      <button
        aria-label="close the keyboard shortcuts"
        className="absolute inset-0 cursor-default bg-background/70"
        data-testid="cheatsheet-scrim"
        onClick={close}
        type="button"
      />
      <div
        className="relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border/60 bg-popover shadow-2xl"
        data-testid="cheatsheet"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">
            Keyboard shortcuts
          </h2>
          {/* The way out, said rather than assumed. The sheet is reachable by
           * a chord and by the palette, and a surface that can be opened two
           * ways by someone who does not know the keys has to name at least
           * one of them on the way back. */}
          <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <Chord chord="Esc" />
            <span>or</span>
            <Chord chord="⌘/" />
            <span>closes this</span>
          </span>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
          data-testid="cheatsheet-sections"
        >
          {sections.map((section) => (
            <section data-testid={`cheatsheet-${section.id}`} key={section.id}>
              <h3 className="px-1 pb-1 pt-3 text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {section.title}
              </h3>
              {section.note === null ? null : (
                <p className="px-1 pb-1.5 text-2xs text-muted-foreground/80">
                  {section.note}
                </p>
              )}
              <ul className="flex flex-col">
                {section.rows.map((row) => (
                  <li
                    className="flex items-start justify-between gap-4 rounded-lg px-1 py-1"
                    key={row.chords.join(" ")}
                  >
                    <span className="min-w-0 text-sm text-foreground">
                      {row.what}
                    </span>
                    <Chords chords={row.chords} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
