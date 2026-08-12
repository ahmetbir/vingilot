// The workspace's half of the close request: it tells the backend whether a
// ⌘W would have anything to take, and takes it when one arrives
// (vingilot/docs/plans/2026-08-09-keys-and-type.md, Task 1).
//
// Everything decidable is in `closeRequest.ts`; what is left here is the part
// that cannot be tested without React and a Tauri channel — the subscription,
// and the flag the backend reads synchronously while a native close request is
// held open (see desktop/src-tauri/src/vingilot_window/mod.rs's `WindowLayers`
// for why it is pushed rather than asked for).
//
// Both directions are best-effort against the backend and neither reports a
// failure: outside Tauri — the E2E build, a browser preview — these commands
// do not exist, and a screen that logged once per surface change would drown
// the console for a chord that the backend still answers by minimizing.

import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  hasStackedSurface,
  resolveCloseRequest,
  type StackedSurfaces,
} from "@/features/runs/lib/closeRequest";

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

  React.useEffect(() => {
    let stop: (() => void) | null = null;
    let detached = false;
    void listen(CLOSE_REQUESTED_EVENT, () => {
      const action = resolveCloseRequest(latest.current.stacked);
      // Not an error: the flag the backend decided on can be one keystroke
      // stale, and the surface it named may already be gone. The window is
      // untouched either way, which is the whole point of this path.
      if (action === null) return;
      if (action.type === "dismiss-dialog") latest.current.dismiss.dialog();
      if (action.type === "dismiss-palette") latest.current.dismiss.palette();
      if (action.type === "dismiss-cheatsheet") {
        latest.current.dismiss.cheatsheet();
      }
      if (action.type === "dismiss-scratchMarkdown") {
        latest.current.dismiss.scratchMarkdown();
      }
      if (action.type === "dismiss-scratch") latest.current.dismiss.scratch();
      if (action.type === "dismiss-closableTab") {
        latest.current.dismiss.closableTab();
      }
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
  }, []);
}
