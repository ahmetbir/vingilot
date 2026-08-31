// The workspace's half of the close gesture — **two doors onto one rule**
// (vingilot/docs/plans/2026-08-09-keys-and-type.md, Task 1; the second door is
// 2026-08-29-redesign.md's P4.7).
//
// 1. **⌘W as a keydown**, which is new and is the owner's own ask ("cmd w ye
//    filan basinca tab kapanmali"). It reaches the webview because
//    `src-tauri/src/app_menu.rs` builds this app's menu without the
//    `close_window` item that used to own the accelerator; `closeKeys.ts`
//    carries the re-run six-claimant audit and what still closes the window.
// 2. **The native close request**, which the red traffic-light button raises
//    and `vingilot_window::apply_close_request` refuses before forwarding here.
//
// Both resolve through the same `resolveCloseRequest`, deliberately: a second
// stack-walker beside the one that was already right is how the sheet's ⌘W row
// and the app's behaviour come to disagree.
//
// Everything decidable is in `closeRequest.ts`; what is left here is the part
// that cannot be tested without React and a Tauri channel — the two
// subscriptions, and the flag the backend reads synchronously while a native
// close request is held open (see
// desktop/src-tauri/src/vingilot_window/mod.rs's `WindowLayers` for why it is
// pushed rather than asked for).
//
// Both directions are best-effort against the backend and neither reports a
// failure: outside Tauri — the E2E build, a browser preview — these commands
// do not exist, and a screen that logged once per surface change would drown
// the console for a chord that the backend still answers by minimizing.

import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  type CloseRequestAction,
  hasStackedSurface,
  resolveCloseRequest,
  type StackedSurfaces,
} from "@/features/runs/lib/closeRequest";
import { resolveCloseKey } from "@/features/runs/lib/closeKeys";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

/** Emitted by `vingilot_window` when a close request lands on a window that
 * has something stacked over it. Must match `CLOSE_REQUESTED_EVENT` in
 * desktop/src-tauri/src/vingilot_window/mod.rs. */
export const CLOSE_REQUESTED_EVENT = "vingilot://close-requested";

/** How to take each surface away. One per member of `StackedSurfaces`, so a
 * surface added to the model without a way to dismiss it does not compile. */
export type CloseRequestDismissers = {
  [Surface in keyof StackedSurfaces]: () => void;
};

export function useCloseRequest(
  stacked: StackedSurfaces,
  dismiss: CloseRequestDismissers,
): void {
  // Read by a listener bound once for the life of the screen. Binding it per
  // change would mean re-subscribing over a Tauri channel on every keystroke
  // that opens or closes a surface, and would race a close request against its
  // own unsubscribe.
  const latest = React.useRef({ dismiss, stacked });
  latest.current = { dismiss, stacked };

  const dismissible = hasStackedSurface(stacked);
  React.useEffect(() => {
    void invoke("window_set_dismissible", { dismissible }).catch(() => {});
    // Cleared on the way out rather than left behind: a screen that unmounted
    // holding the claim would spend the owner's ⌘W on a surface that is no
    // longer there, on every screen in the app.
    return () => {
      void invoke("window_set_dismissible", { dismissible: false }).catch(
        () => {},
      );
    };
  }, [dismissible]);

  // Bound once for the life of the screen, and read through the ref above, for
  // the reason the listener below is: rebinding on every surface change would
  // race a close against its own unsubscribe.
  const take = React.useCallback((action: CloseRequestAction | null) => {
    // Not an error: the flag the backend decided on can be one keystroke
    // stale, and the surface it named may already be gone. The window is
    // untouched either way, which is the whole point of this path.
    if (action === null) return;
    const dismiss = latest.current.dismiss;
    if (action.type === "dismiss-dialog") dismiss.dialog();
    if (action.type === "dismiss-palette") dismiss.palette();
    if (action.type === "dismiss-cheatsheet") dismiss.cheatsheet();
    if (action.type === "dismiss-scratchMarkdown") dismiss.scratchMarkdown();
    if (action.type === "dismiss-scratch") dismiss.scratch();
    if (action.type === "dismiss-closableTab") dismiss.closableTab();
  }, []);

  React.useEffect(() => {
    let stop: (() => void) | null = null;
    let detached = false;
    void listen(CLOSE_REQUESTED_EVENT, () => {
      take(resolveCloseRequest(latest.current.stacked));
    })
      .then((unlisten) => {
        if (detached) unlisten();
        else stop = unlisten;
      })
      .catch(() => {});
    return () => {
      detached = true;
      stop?.();
    };
  }, [take]);

  // **⌘W, as an ordinary keydown. Window, capture phase, and it has to be.**
  //
  // A bubble listener never sees this chord while the surfaces it is *for* are
  // open: `CommandPalette.tsx` and `useCheatsheet`'s sheet both bind a
  // capture-phase window listener that ends in an unconditional
  // `event.stopPropagation()` — the shield that keeps the island's chords out
  // of an open overlay — so a bubble-phase ⌘W would do nothing over the palette
  // and everything over the bare workspace, which is the exact inverse of the
  // documented stack. (The old native close-request path never met that shield
  // because it was not a keystroke at all.)
  //
  // Capture is safe here, and the two claims that must still win do:
  //
  // - **Buzz Term's substrate** binds ⌘W in capture at the window too
  //   (`TerminalSubstrate.tsx:335`), from `AppShell`, which mounts before this
  //   screen — so its listener is registered first, runs first, and
  //   `preventDefault`s what it takes. The `defaultPrevented` check below is
  //   what yields to it.
  // - **A text field** keeps its own ⌘W through the guard below, which is the
  //   only arm of the stack that could reach past what has focus.
  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const action = resolveCloseKey({
        altKey: event.altKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action === null) return;
      const next = resolveCloseRequest(latest.current.stacked);
      // **The typing guard, and why it is only on the bottom rung.** Every
      // surface above it is one the owner opened over his work and ⌘W is
      // documented to take — the palette's own field and the scratch buffer's
      // textarea are *inside* those surfaces, so refusing there would make ⌘W
      // do nothing at all with the palette open. The tab close is the only arm
      // that can reach past what has focus, and a caret in a composer or an
      // objective field must keep its own ⌘W. A terminal is not a text field
      // for this purpose even though xterm's input is a `<textarea>`: closing
      // the tab from inside its own shell is exactly the iTerm hand the owner
      // asked for.
      if (next?.type === "dismiss-closableTab" && typingElsewhere(event.target))
        return;
      // Only claimed once it resolves to something. A ⌘W with nothing to take
      // is the window's, and this app answers that in Rust — where the red
      // button's request already lands (`vingilot_window`).
      if (next === null) return;
      event.preventDefault();
      // Stopped as well as prevented, for the reason `usePalette.ts` gives for
      // its own pair: the overlay this keystroke just dismissed also has a
      // capture listener on this window, and letting the event reach it would
      // spend one ⌘W on two surfaces.
      event.stopPropagation();
      take(next);
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [take]);
}

/** True for a text-entry element that is not a terminal's.
 *
 * xterm's own hidden input is a `<textarea>` inside `.xterm`, and it is the one
 * "field" ⌘W must act over rather than defer to — see the guard above. */
function typingElsewhere(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(".xterm") !== null) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA"
  );
}
