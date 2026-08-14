// ⌘F over the terminal's own scrollback — the gap `findKeys.ts`'s header used
// to name as deliberate, closed here with `@xterm/addon-search`
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 1 named the
// cost; this hook pays it).
//
// **Read `findKeys.ts`'s header first.** This is the second hook answering
// its `FindBarModel` — same capture-phase listener, same
// claim-before-upstream-sees-it mechanism, different ownership predicate and
// a different match engine underneath (xterm's own, not a string search over
// a known text).
//
// **Every claimant checked, because ⌘W was lost this way once
// (`terminalKeys.ts`'s header) and the recon that opened this task found the
// claimant list stale once already.**
// - **muda menu** (`app_menu.rs`, current install): no ⌘F at all — ⌃⌘F is
//   fullscreen, a different chord with a different modifier.
// - **AppShell hook** (`useAppShellKeyboardShortcuts.ts`): claims plain ⌘F —
//   upstream's find-in-this-channel (`useChannelFind.ts`), a BUBBLE-phase
//   window listener. This is the one real claimant, and the reason this
//   hook's own listener runs in the CAPTURE phase and calls
//   `stopPropagation` before that bubble listener ever sees the event —
//   `useFindInFile.ts`'s identical technique for the Files pane.
// - **Globals** (settings/zoom/reload/back-forward): none touch F.
// - **This island's own maps**: `findKeys.ts`'s own ⌘F is Files-pane-scoped —
//   its capture listener checks the Files pane's ownership, not this one's,
//   so the two coexist rather than race. `searchKeys.ts`'s ⇧⌘F is a
//   different chord entirely (checkout-wide search).
// - **AppKit's ⌥-synthesis rule**: no ⌥ chord is involved here, so nothing to
//   check.
//
// **Ownership is stricter than Files' own, and that is a deliberate
// divergence, not an oversight.** `useFindInFile.ts` treats "nothing is
// focused" as belonging to the Files pane too, because its body is a
// non-focusable `<pre>`. xterm keeps a real, focusable hidden textarea, and
// — unlike a single Files pane — every worktree's terminal is mounted at
// once (`ui/Terminal.tsx`'s header: "all but one of them inside a hidden
// subtree that measures 0×0"), so only one instance is ever `active`. Giving
// an inactive instance a "nothing focused" fallback would risk it claiming a
// chord for a terminal the owner cannot see — the exact shape of bug the
// solo-pane case would produce (maximising the right pane blurs the
// terminal's focus without unmounting it, `ui/PaneFrame.tsx`'s `hidden`).
// So ownership here is the one-line version: the keydown's target must be
// literally inside THIS terminal's own root. No fallback, because there is
// nothing here that plays the role Files' unfocusable `<pre>` does.

import type { SearchAddon } from "@xterm/addon-search";
import * as React from "react";

import { matchLabel, smartCaseSensitive } from "@/features/runs/lib/findInFile";
import {
  type FindBarModel,
  resolveFindBarKey,
  resolveFindKey,
} from "@/features/runs/lib/findKeys";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

export interface TerminalFind extends FindBarModel {
  /** True while the bar is on screen. */
  open: boolean;
  /** Wires a freshly created `SearchAddon` into this hook's state. Call once,
   * right after `term.loadAddon(search)`, inside `ui/Terminal.tsx`'s own
   * per-attachment effect, and call the returned cleanup inside that same
   * effect's teardown — mirroring how that effect already owns `FitAddon`'s
   * lifecycle. Stable (`useCallback`, no deps), so the caller's effect can
   * depend on it without depending on this hook's own re-renders. */
  attach: (addon: SearchAddon) => () => void;
}

/** The decoration colours handed to `findNext`/`findPrevious` — required for
 * `onDidChangeResults` to fire at all (the addon's own doc comment: "When
 * decorations are enabled, fires when the search results change"). xterm
 * decorations take a literal `#RRGGBB` only — no alpha, no CSS variable — so
 * this cannot be `terminalPalette.ts`'s probed, theme-reactive palette; it is
 * the same amber `FileViewer.tsx`'s `MATCH_CLASS`/`CURRENT_MATCH_CLASS`
 * already speak for a find match (Tailwind's `amber-500`, dimmed to
 * `amber-900` for the ordinary matches), hardcoded because a decoration is
 * read once per call and does not react to a theme switch the way a probed
 * colour does. */
const DECORATIONS = {
  activeMatchBackground: "#f59e0b",
  activeMatchBorder: "#fbbf24",
  activeMatchColorOverviewRuler: "#f59e0b",
  matchBackground: "#78350f",
  matchOverviewRuler: "#78350f",
};

/** Whether a ⌘F that arrived at the window belongs to this terminal — see the
 * header for why this refuses the "nothing focused" case Files' own version
 * accepts. */
function ownsChord(target: EventTarget | null, pane: HTMLElement | null) {
  if (pane === null || target === null) return false;
  if (!(target instanceof Node)) return false;
  return pane.contains(target);
}

interface UseTerminalFindArgs {
  /** Only this terminal's capture listener installs while true — the
   * currently shown, focus-eligible instance (`ui/Terminal.tsx`'s own
   * `active` prop, which is true for exactly one mounted terminal at a
   * time). Every other mounted instance never registers one at all, so
   * there is never more than one live capture listener for this chord. */
  active: boolean;
  /** This terminal's own root — the ownership boundary. */
  paneRef: React.RefObject<HTMLElement | null>;
  /** Where focus goes when the bar closes. */
  focusTerminal: () => void;
}

export function useTerminalFind({
  active,
  focusTerminal,
  paneRef,
}: UseTerminalFindArgs): TerminalFind {
  const [open, setOpen] = React.useState(false);
  const [query, setQueryState] = React.useState("");
  const [opened, setOpened] = React.useState(0);
  const [resultIndex, setResultIndex] = React.useState(-1);
  const [resultCount, setResultCount] = React.useState(0);
  const addonRef = React.useRef<SearchAddon | null>(null);

  const attach = React.useCallback((addon: SearchAddon) => {
    addonRef.current = addon;
    const disposable = addon.onDidChangeResults(
      ({ resultCount: count, resultIndex: index }) => {
        setResultCount(count);
        setResultIndex(index);
      },
    );
    return () => {
      disposable.dispose();
      // Guards against the (never-expected) case of a stale cleanup racing a
      // newer attach: only clear the ref if it is still this attachment's.
      if (addonRef.current === addon) addonRef.current = null;
      setResultCount(0);
      setResultIndex(-1);
    };
  }, []);

  const setQuery = React.useCallback((next: string) => {
    setQueryState(next);
    const addon = addonRef.current;
    if (addon === null) return;
    if (next === "") {
      // An empty query is no matches, the same rule `findInFile.ts` states —
      // a find bar he has just opened (or just cleared) must not claim to
      // have found anything.
      addon.clearDecorations();
      setResultCount(0);
      setResultIndex(-1);
      return;
    }
    // `incremental` only here, not in `walk` below: it is what makes typing
    // feel like a live search rather than a walk starting from the top on
    // every keystroke, and the addon's own doc says it affects `findNext`
    // only, which is what typing always calls (there is no "typed
    // backwards").
    addon.findNext(next, {
      caseSensitive: smartCaseSensitive(next),
      decorations: DECORATIONS,
      incremental: true,
    });
  }, []);

  const walk = React.useCallback(
    (direction: 1 | -1) => {
      const addon = addonRef.current;
      if (addon === null || query === "") return;
      const options = {
        caseSensitive: smartCaseSensitive(query),
        decorations: DECORATIONS,
      };
      if (direction === 1) addon.findNext(query, options);
      else addon.findPrevious(query, options);
    },
    [query],
  );

  const close = React.useCallback(() => {
    setOpen(false);
    setQueryState("");
    addonRef.current?.clearDecorations();
    setResultCount(0);
    setResultIndex(-1);
    // Escape hands the keyboard back to the shell, the same rule
    // `useFindInFile.ts` states for the Files viewer's body: a bar that
    // closed onto nothing would leave the pane keyboard-dead.
    focusTerminal();
  }, [focusTerminal]);

  const onFieldKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const action = resolveFindBarKey({
        altKey: event.altKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event.nativeEvent),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action === null) return;
      event.preventDefault();
      // Stops here so the terminal's own Escape (`terminalKeys.ts`'s
      // `leave-terminal`) does not also fire when the bar's Escape closes it.
      event.stopPropagation();
      if (action.type === "close") {
        close();
        return;
      }
      walk(action.type === "next" ? 1 : -1);
    },
    [close, walk],
  );

  // The capture-phase listener — the whole of the boundary (see header).
  React.useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => {
      const action = resolveFindKey({
        altKey: event.altKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action === null) return;
      if (!ownsChord(event.target, paneRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
      // Counted rather than toggled: the field reads this to select what is
      // already in it, which is the gesture a second ⌘F actually means.
      setOpened((count) => count + 1);
    };
    window.addEventListener("keydown", listener, { capture: true });
    return () =>
      window.removeEventListener("keydown", listener, { capture: true });
  }, [active, paneRef]);

  // A terminal that is no longer the shown one has nothing on screen to find
  // in — the bar goes with it rather than staying open over a pane the owner
  // has since switched away from.
  React.useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);

  return {
    attach,
    close,
    label: matchLabel(resultCount, resultIndex),
    matchCount: resultCount,
    onFieldKeyDown,
    open,
    opened,
    query,
    setQuery,
    walk,
  };
}
