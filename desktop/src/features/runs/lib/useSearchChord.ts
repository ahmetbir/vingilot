// ⇧⌘F, wired (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md,
// Task 2).
//
// What the chord means is `searchKeys.ts` — including the claimant check, all
// four of them, and what was found in each. What is left here is the part that
// cannot be tested without React: a listener bound for the life of the screen.
//
// **Capture phase, on `window`, exactly as `usePalette.ts` binds ⌘K and
// `useCheatsheet.ts` binds ⌘/**, and for the same two reasons.
// `preventDefault()` is upstream's own deference path (AppShell's handler
// returns early on `event.defaultPrevented`), and stopping at the
// window-capture stage keeps the chord out of the surfaces underneath — the
// terminal in particular, which would otherwise send a literal "F" to the
// owner's shell behind an opening pane.
//
// Nothing is taken from anybody. ⌘F is upstream's find-in-this-channel
// (`features/search/useChannelFind.ts`) and it guards on `!event.shiftKey`, so
// this chord reaches nothing there — which is why it is ⇧⌘F and not ⌘F.

import * as React from "react";

import { resolveSearchKey } from "@/features/runs/lib/searchKeys";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

/** Call `open` when the owner asks for the search surface.
 *
 * `open` is a callback rather than a piece of state this hook owns, because
 * what "open" means is the host's: the search surface is a **pane**, so opening
 * it is choosing it in the right slot and giving the surface back if the
 * terminal is soloing — two moves that belong to `RunsScreen` and to nothing
 * else. A hook that owned a boolean would be a second, disagreeing idea of
 * which pane is on screen. */
export function useSearchChord(open: () => void): void {
  // Held in a ref so the listener is bound once for the life of the screen: a
  // handler rebound on every render of a screen that re-renders on a 2s tick is
  // an add/remove pair twice a second, and the chord is unbound for the instant
  // in between.
  const latest = React.useRef(open);
  latest.current = open;

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const action = resolveSearchKey({
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
      latest.current();
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);
}
