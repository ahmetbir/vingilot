// A chord, drawn as keys (vingilot/docs/plans/2026-08-09-keys-and-type.md,
// Task 4).
//
// The box is settings' own — `features/settings/ui/KeyboardShortcutsCard.tsx`'s
// `KeyCombo`, which is where this app already draws a shortcut — at the meta
// size the workspace gives a keyboard hint (`vingilot/docs/workbench.md`, "The
// type scale").
//
// **One box per key rather than one for the whole chord**: `⇧⌥⌘B` in a single
// box is a word again, and a word in a box is what this idiom exists to stop a
// chord being. Where a key is a name rather than a letter it still takes one
// box — `Esc` split across three would read as three keys held together, which
// is the reason the split is `chordKeys` (pure, tested) rather than a spread.
//
// Lifted out of `CommandPalette.tsx` when the cheatsheet needed the same
// drawing. Two copies of a kbd box is how the palette's chords and the sheet's
// come to disagree about what a shortcut looks like in this app, on a surface
// whose whole job is to show the owner what they look like.

import { chordKeys } from "@/features/runs/lib/cheatsheet";

export function Chord({ chord }: { chord: string }) {
  return (
    <span className="mt-0.5 flex shrink-0 items-center gap-0.5">
      {chordKeys(chord).map((key) => (
        <kbd
          className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border/70 bg-muted/60 px-1 font-mono text-2xs text-muted-foreground"
          key={key}
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
