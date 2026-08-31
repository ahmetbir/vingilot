// The active terminal's pty-write door for the status bar's quick actions
// (redesign P4) — resolves the SELECTED worktree's ACTIVE tab into a session
// id the same way the tab strip's own commands do (`sessionIdFor`), and
// types through the same `ptyWrite` channel the drop-a-file paste already
// uses (`Terminal.tsx`'s own act). Visible in the shell, never hidden: this
// is a real keystroke stream into a real session, not a side channel.
//
// Held here rather than computed inside `ProjectStatusBar` itself: the
// active tab is `RunsScreen`'s own state (`useDeckLayers`'s `selectedTabs`),
// and a prop threading every fact the bar names through `RunsScreen` is the
// coupling `ProjectStatusBar`'s own header already warns against — this hook
// is the one door `RunsScreen` hands over instead of the state behind it.

import * as React from "react";

import { ptyWrite } from "./ptyClient.ts";
import { sessionIdFor, type WorktreeTabs } from "./terminalTabs.ts";

export interface ActiveTerminalTyping {
  /** `null` when the selected worktree has no open tab to type into — a
   * quick-action button is a real door only while this is not `null`. */
  activeSessionId: string | null;
  /** Types `text` followed by Enter into the active session. A no-op when
   * there is none — the caller gates the button on `activeSessionId` first,
   * so this only ever fires at a real target. */
  typeIntoActiveTerminal: (text: string) => void;
}

export function useActiveTerminalTyping(
  selectedWorktreeId: string | null,
  selectedTabs: WorktreeTabs | null,
): ActiveTerminalTyping {
  const activeSessionId =
    selectedWorktreeId !== null && selectedTabs !== null
      ? sessionIdFor(selectedWorktreeId, selectedTabs.active)
      : null;

  const typeIntoActiveTerminal = React.useCallback(
    (text: string) => {
      if (activeSessionId === null) return;
      void ptyWrite(activeSessionId, `${text}\n`);
    },
    [activeSessionId],
  );

  return { activeSessionId, typeIntoActiveTerminal };
}
