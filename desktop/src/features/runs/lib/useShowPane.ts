// Putting a pane where he can read it — one gesture, three callers.
//
// **Three strikes, then you refactor**, and this is the third. The same two
// moves were written out at three places in `RunsScreen.tsx`:
//
// - the palette's `ask`, which puts the Agent pane up because the answer lands
//   in it (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 2);
// - `show-file`, which puts the Files pane up because the file lands in it
//   (vingilot/docs/plans/2026-08-12-files-pane-design.md, §6);
// - ⇧⌘F, which puts the Search pane up because that is what the chord is for
//   (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 2).
//
// **Choosing the pane is not enough, and the second move is the one that gets
// forgotten.** A work surface the owner has given entirely to the terminal
// (⌥⌘B) is a surface where the right pane is not drawn at all, so choosing a
// pane there puts the answer behind something he cannot see — a toast with
// extra steps. Written out three times, that second line is three chances to
// leave it out, and leaving it out fails in the one state that is hardest to
// notice: it works perfectly whenever the terminal is not soloing.
//
// The split is deliberately this small. What is shared is a *gesture*, not the
// pane state — `usePanes` still owns that, and every other caller of
// `choose`/`toggleSolo` (the picker, the divider, ⌥⌘B itself) goes on calling
// them directly, because those are the owner arranging his surface rather than
// the workspace bringing him something.

import * as React from "react";

import type { PaneId, PaneSide } from "@/features/runs/lib/paneModel";

/** As much of `usePanes` as this gesture needs. A structural type rather than
 * the hook's own, so a test can drive it with two functions and a value. */
export interface PaneSurface {
  choose: (pane: PaneId) => void;
  toggleSolo: (side: PaneSide) => void;
  solo: PaneSide | null;
}

/** Put `pane` in the right slot **and make sure the right slot is on screen.**
 *
 * Only the terminal's solo is undone. A surface the owner has given to the
 * *right* pane is already showing the slot this is about, and shrinking it back
 * to a split would be undoing an arrangement he made in order to read
 * something. */
export function useShowPane(panes: PaneSurface): (pane: PaneId) => void {
  const { choose, solo, toggleSolo } = panes;
  return React.useCallback(
    (pane: PaneId) => {
      choose(pane);
      if (solo === "left") toggleSolo("left");
    },
    [choose, solo, toggleSolo],
  );
}
