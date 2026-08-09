// What a window close request means to the workspace
// (vingilot/docs/plans/2026-08-09-keys-and-type.md, Task 1).
//
// ⌘W is not resolved here and cannot be: on macOS it is a key equivalent of
// the default application menu's "Close Window", so it never reaches the
// webview as a keydown at all — see
// desktop/src-tauri/src/vingilot_window/mod.rs's header for the whole reading
// and for why that menu is kept rather than replaced. What reaches this side
// is the close request the menu item raises, forwarded over
// `vingilot://close-requested` once the backend has already refused to close
// or hide the window.
//
// So the question this module answers is not "what does this key mean" but
// "what is on top". A close request over a stacked surface takes that surface,
// which is what ⌘W over the scratch shell has to do; a close request over the
// bare workspace is about the window, and the backend has already dealt with
// it (it minimizes — the Dock thumbnail is the way back that hiding never
// gave).
//
// Pure: no React, no Tauri. `useCloseRequest.ts` is the wiring, and it is the
// only caller.

/** What the workspace has stacked over the work surface right now.
 *
 * Deliberately three booleans rather than a list of surfaces: the ordering
 * below is the one thing this module is for, and it is fixed by how the app
 * renders, not by what a caller passes in. */
export interface StackedSurfaces {
  /** Any of the workspace's modal dialogs — new worktree, plan, prune,
   * remove project. One flag because they are already mutually exclusive by
   * construction (`RunsScreen.tsx` holds them all so two can never be on
   * screen at once), so nothing here needs to tell them apart. */
  dialog: boolean;
  /** The command palette (⌘K). */
  palette: boolean;
  /** The scratch shell (⌥⌘T) — the surface the owner pressed ⌘W over. */
  scratch: boolean;
}

/** Which surface a close request takes, or `null` when the request is about
 * the window itself. */
export type CloseRequestAction =
  | { type: "dismiss-dialog" }
  | { type: "dismiss-palette" }
  | { type: "dismiss-scratch" };

/** Resolves a close request against what is on screen.
 *
 * The order is the render order, outermost last. A dialog is modal over
 * everything including the palette; the palette opens over the scratch shell
 * (the palette is a second door to it, so it is on top of what it opened);
 * the scratch shell is over the work surface. Exactly one surface is
 * dismissed per request — a close that emptied the whole stack would cost the
 * owner three surfaces for one keystroke, and only one of them is the one he
 * was looking at. */
export function resolveCloseRequest(
  stacked: StackedSurfaces,
): CloseRequestAction | null {
  if (stacked.dialog) return { type: "dismiss-dialog" };
  if (stacked.palette) return { type: "dismiss-palette" };
  if (stacked.scratch) return { type: "dismiss-scratch" };
  return null;
}

/** Whether a close request would have anything to take.
 *
 * This is what the backend is told (`window_set_dismissible`), and it decides
 * there between dismissing and minimizing. Defined through `resolveCloseRequest`
 * rather than beside it so the two cannot come to disagree: a window that
 * minimized while a surface was still resolvable would take the workspace off
 * screen for a keystroke that was meant to close a shell. */
export function hasStackedSurface(stacked: StackedSurfaces): boolean {
  return resolveCloseRequest(stacked) !== null;
}
