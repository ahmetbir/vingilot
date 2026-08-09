// The sheet, wired: the one chord that puts every other chord on screen
// (vingilot/docs/plans/2026-08-09-keys-and-type.md, Task 4).
//
// What ⌘/ means is `cheatsheetKeys.ts`, and what the sheet says is
// `cheatsheet.ts` — generated from the maps rather than written down. What is
// left here is the part that cannot be tested without React: one piece of
// state, and a listener bound for the life of the screen.
//
// **Capture phase, on `window`, exactly as `usePalette.ts` binds ⌘K**, and for
// the same two reasons. `preventDefault()` is upstream's own deference path
// (AppShell's handler returns early on `event.defaultPrevented`), and stopping
// at the window-capture stage keeps the chord out of the surfaces underneath —
// the terminal in particular, which would otherwise send a literal "/" to the
// owner's shell behind an opening sheet.
//
// Nothing is claimed from anybody: unlike ⌘K, ⌘/ was unbound in this whole app
// before this file — `cheatsheetKeys.ts`'s header carries the claimant check,
// all four of them, and what was found in each.

import * as React from "react";

import { resolveCheatsheetKey } from "@/features/runs/lib/cheatsheetKeys";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

export interface Cheatsheet {
  open: boolean;
  /** Open it, without toggling. The palette's row is a second door, and a row
   * called "Keyboard shortcuts" that closed the sheet would be a row whose
   * label lied about what Enter does — the same rule the scratch shell's row
   * follows (`paletteSources.ts`). The chord is the toggle. */
  show: () => void;
  close: () => void;
}

export function useCheatsheet(): Cheatsheet {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const action = resolveCheatsheetKey({
        altKey: event.altKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action === null) return;
      // See this file's header: both calls, and why each is there.
      event.preventDefault();
      event.stopPropagation();
      setOpen((prev) => !prev);
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);

  return {
    close: React.useCallback(() => setOpen(false), []),
    open,
    show: React.useCallback(() => setOpen(true), []),
  };
}
