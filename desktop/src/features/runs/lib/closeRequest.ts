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
  /** The keyboard cheatsheet (⌘/). */
  cheatsheet: boolean;
  /** The scratch markdown buffer (⇧⌘M). Before its shell sibling: the two are
   * drawn at the same layer, and the buffer is a *typing* surface — ⌘W with
   * text on screen must take the thing the cursor is in, never the shell
   * behind it. */
  scratchMarkdown: boolean;
  /** The scratch shell (⌥⌘T) — the surface the owner pressed ⌘W over. */
  scratch: boolean;
  /** Whether the selected worktree's terminal strip has a tab that closing
   * would merely *remove* — true only when there is more than one, because
   * `terminalTabs.ts`'s `closeTab` answers a lone tab by ending its shell and
   * spawning a fresh one, and a ⌘W that silently killed a tmux session to hand
   * back an empty prompt would be destruction dressed as tidying. The last tab
   * is the worktree's terminal itself, and a close request over it is about
   * the window — VS Code's own reading of ⌘W on the last editor. */
  closableTab: boolean;
}

/** Which surface a close request takes, or `null` when the request is about
 * the window itself. */
export type CloseRequestAction =
  | { type: "dismiss-dialog" }
  | { type: "dismiss-palette" }
  | { type: "dismiss-cheatsheet" }
  | { type: "dismiss-scratchMarkdown" }
  | { type: "dismiss-scratch" }
  | { type: "dismiss-closableTab" };

/** Resolves a close request against what is on screen.
 *
 * The order is the render order, outermost last. A dialog is modal over
 * everything including the palette; the palette opens over the cheatsheet and
 * over the scratch shell (the palette is a second door to both, so it is on
 * top of what it opened); the cheatsheet is drawn over the scratch shell,
 * which is over the work surface. Exactly one surface is dismissed per
 * request — a close that emptied the whole stack would cost the owner four
 * surfaces for one keystroke, and only one of them is the one he was looking
 * at.
 *
 * The cheatsheet's own row for ⌘W prints this order back to the owner
 * (`cheatsheet.ts`'s `ELSEWHERE`), so a surface inserted here without a word
 * there leaves the sheet describing a stack the app no longer has. */
export function resolveCloseRequest(
  stacked: StackedSurfaces,
): CloseRequestAction | null {
  if (stacked.dialog) return { type: "dismiss-dialog" };
  if (stacked.palette) return { type: "dismiss-palette" };
  if (stacked.cheatsheet) return { type: "dismiss-cheatsheet" };
  if (stacked.scratchMarkdown) return { type: "dismiss-scratchMarkdown" };
  if (stacked.scratch) return { type: "dismiss-scratch" };
  // The bottom rung, and the one that is not an overlay: with nothing stacked,
  // ⌘W closes the active terminal tab the way ⇧⌘W always has — the VS Code hand
  // the owner asked for by pressing it. Only past this does the backend
  // minimize, so "⌘W closes the thing I am looking at, then the window" is one
  // rule from the top of the stack to the Dock.
  if (stacked.closableTab) return { type: "dismiss-closableTab" };
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
