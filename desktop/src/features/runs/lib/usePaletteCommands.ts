// Every command the palette can produce, run against the actions that already
// exist (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 1).
//
// **Nothing new is reachable from here.** A palette that could do something no
// button could would be a second implementation of it — so every arm below is a
// call to a handler the workspace already has, and the whole file is a
// translation table rather than behaviour.
//
// **Split out of `RunsScreen.tsx` at the 1000-line ratchet**
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 1 — the escape
// hatch's two rows are what pushed it over). The rule is that an edit to a file
// at the ceiling begins with a split, and this was the seam already there: the
// switch reads a command and calls handlers, and knows nothing about the state
// they close over. What is left in the screen is the state; what is here is the
// table.
//
// **A bag of handlers, not a context.** Every field below is something the
// screen already holds a stable callback for, so this hook adds no state and
// owns nothing — which is why the arms can stay one line each and why the
// dependency list is the caller's problem rather than a second copy of it.

import * as React from "react";

import type { PaletteCommand } from "@/features/runs/lib/paletteModel";
import type { Repo } from "@/features/runs/lib/projects";

/** Everything the table needs to act. Facts and callbacks; no component, no
 * JSX, so this module can be read without a browser. */
export interface PaletteHandlers {
  addProject: () => void;
  ask: (cwd: string, question: string) => void;
  choosePane: (pane: string) => void;
  newTerminalTab: () => void;
  /** A new task chip with a fresh shell (`taskStrip.ts`) — ⌘T's act. */
  newTask: () => void;
  /** Split the active terminal to the right or downward
   * (`terminalSplit.ts`); the workspace resolves which session is active. */
  splitTerminal: (direction: "right" | "down") => void;
  /** Close the active terminal's split half. */
  closeTerminalSplit: () => void;
  /** Two TABS side by side on the stage, or the stage back (`tabSplit.ts`) —
   * ⇧⌘\'s act. A different thing from `splitTerminal` above, which is two
   * shells inside one tab. */
  toggleTabSplit: () => void;
  openCheatsheet: () => void;
  openLanding: () => void;
  openPlanWorktree: () => void;
  openPrune: () => void;
  openScratchMarkdown: () => void;
  openScratchTerminal: () => void;
  /** The explicit ⌘K install of the `vingilot` shell command — the door in's
   * one act with a consequence outside this app's own directories, which is
   * exactly why it is a row he chooses rather than something startup does. */
  installShim: () => void;
  /** Open whatever file the workspace currently has in the viewer, in the
   * owner's editor. Chord-less by decision — see `OpenInEditor.tsx`'s header. */
  openInEditor: () => void;
  newWorktree: () => void;
  /** Open the selected worktree's diff as a view tab (P4.6). The workspace
   * resolves which worktree and which base — the palette names neither, for
   * `paletteSources.ts`'s stated reason: a row is drawn from a snapshot and
   * Enter happens later. */
  openDiffTab: () => void;
  /** Open Settings → Appearance — the palette's door to the surface that
   * replaced the vetoed top-bar tray (P1.1). `goSettings("appearance")`. */
  openAppearance: () => void;
  /** Open upstream's message-search dialog — the door the removed sidebar box
   * left behind (P1.1); `searchRequest.ts`'s mailbox. */
  openMessageSearch: () => void;
  /** Go to a channel — `useAppNavigation`'s `goChannel`, which is where
   * upstream's own switcher goes. The palette hosts their list; it does not
   * navigate its own way (ADR-001). */
  openChannel: (channelId: string) => void;
  /** Show a file in the viewer at a line. The same `show-file` route the Diff
   * pane's button and the Search pane's results already take
   * (`filesTarget.ts`), so this is a fourth caller of one landing. */
  openFile: (worktree: string, path: string, line: number | null) => void;
  /** Put the Captain in front of one crew member with this worktree already
   * named. The handler re-asks `crewReach.ts` for the row, so a member that
   * has since lost its thread refuses here rather than writing a draft into a
   * channel that is not there any more. */
  reachCrew: (personaId: string) => void;
  removeProject: (repo: Repo) => void;
  selectRepo: (repoId: string) => void;
  selectWorktree: (bindingId: string) => void;
  /** The open project, or `null`. Two arms refuse without one, and refusing
   * here is the same fact `paletteSources.ts` already blocked the row on —
   * read twice rather than trusted once, because the row is drawn from a
   * snapshot and Enter happens later. */
  selectedRepo: Repo | null;
  /** Where an ask would run, or `null`. */
  selectedWorktreeCwd: string | null;
  showPane: (pane: string) => void;
  toggleSidebar: () => void;
  toggleSolo: (side: "left" | "right") => void;
}

export function usePaletteCommands(
  handlers: PaletteHandlers,
): (command: PaletteCommand) => void {
  // Held in a ref so the returned callback is stable for the life of the
  // screen: `usePalette` binds it into a key listener, and a handler identity
  // that changed every render would rebind that listener on every tick of the
  // 2s poll this screen already runs.
  const held = React.useRef(handlers);
  held.current = handlers;

  return React.useCallback((command: PaletteCommand) => {
    const on = held.current;
    switch (command.type) {
      case "open-landing":
        on.openLanding();
        return;
      case "open-project":
        on.selectRepo(command.repoId);
        return;
      case "open-worktree":
        on.selectWorktree(command.bindingId);
        return;
      case "choose-pane":
        // The id is a string so `paletteSources.ts` needs no import from the
        // pane registry; narrowing it against the registry's own list is the
        // caller's job, and an id that is not a pane must land as nothing
        // rather than as a lookup on a key that does not exist.
        on.choosePane(command.pane);
        return;
      case "open-channel":
        on.openChannel(command.channelId);
        return;
      case "open-diff-tab":
        on.openDiffTab();
        return;
      case "open-file":
        on.openFile(command.worktree, command.path, command.line);
        return;
      case "new-worktree":
        on.newWorktree();
        return;
      case "plan-to-worktree":
        // The same dialog the Plan pane's button opens, and it is what reads
        // the plan — so a palette row cannot act on a plan the owner has
        // edited since the row was drawn.
        if (on.selectedRepo !== null) on.openPlanWorktree();
        return;
      case "new-terminal-tab":
        on.newTerminalTab();
        return;
      case "new-task":
        on.newTask();
        return;
      case "split-terminal":
        on.splitTerminal(command.direction);
        return;
      case "close-terminal-split":
        on.closeTerminalSplit();
        return;
      case "toggle-tab-split":
        // The one row here that toggles, and it may: the label says "split the
        // stage" and the stage is what it acts on either way — unlike the
        // scratch rows below, whose label names a thing to OPEN.
        on.toggleTabSplit();
        return;
      case "open-scratch-terminal":
        // Opens, never toggles: a row called "Scratch terminal" that closed one
        // would be a row whose label lied about what Enter does. The chord is
        // the toggle.
        on.openScratchTerminal();
        return;
      case "open-scratch-markdown":
        // Opens, never toggles, for the reason the row above it does. ⇧⌘M is
        // the toggle.
        on.openScratchMarkdown();
        return;
      case "open-cheatsheet":
        on.openCheatsheet();
        return;
      case "open-appearance":
        on.openAppearance();
        return;
      case "open-message-search":
        on.openMessageSearch();
        return;
      case "open-in-editor":
        on.openInEditor();
        return;
      case "install-shim":
        on.installShim();
        return;
      case "add-project":
        on.addProject();
        return;
      case "remove-project":
        // Straight to the same confirm the × on a project row opens. The
        // palette never removes anything itself: the exact words of that
        // interruption are a tested promise (`lib/repoChoice.ts`).
        if (on.selectedRepo !== null) on.removeProject(on.selectedRepo);
        return;
      case "prune-worktrees":
        on.openPrune();
        return;
      case "reach-crew":
        on.reachCrew(command.personaId);
        return;
      case "toggle-sidebar":
        on.toggleSidebar();
        return;
      case "toggle-solo":
        on.toggleSolo(command.side);
        return;
      case "ask":
        // The palette refuses an ask with no directory (`askMode.ts`), so this
        // is the same fact read twice rather than a second rule.
        if (on.selectedWorktreeCwd === null) return;
        // Where the answer lands, brought forward (`lib/useShowPane.ts`).
        on.showPane("agent");
        on.ask(on.selectedWorktreeCwd, command.question);
        return;
    }
  }, []);
}
