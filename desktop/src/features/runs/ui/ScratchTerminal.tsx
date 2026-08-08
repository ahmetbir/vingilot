// The scratch shell, over the work surface
// (vingilot/docs/plans/2026-08-08-scratch-and-team-thread.md, Task 1).
//
// **It is drawn over the surface, not in it.** Absolutely positioned inside
// the work surface's own box, so the two panes underneath keep the geometry
// they already had. That is not a styling preference: under tmux the sole
// attached client's size *is* the session's size, so a layout that squeezed
// the persistent terminals to make room would reflow every one of the owner's
// live shells and re-wrap their scrollback — the exact failure `terminalFit.ts`
// exists to prevent, arriving from a new direction. Nothing here unmounts,
// remeasures or resizes a terminal that is not its own.
//
// **What it says about itself.** The header names the directory the shell
// starts in, because a scratch shell whose cwd you have to guess is worse than
// no scratch shell. The footer carries `SCRATCH_PERSISTENCE`, printed verbatim
// from `lib/terminalPersistence.ts` beside the sentence it must not be confused
// with — the status bar's persistence line is about the worktree's tabs.
//
// **The keyboard, while it is open.** A container-scoped capture listener, not
// a window one. The palette's argument for `window` was that focus can leave
// its one field; here the whole surface is focusable content and the scrim is
// inside this subtree, so every state the design produces has focus in here.
// It also settles the one case a window listener gets wrong: with the palette
// open over this, focus is in the palette's field — outside this subtree — so
// this hears nothing and ⌘K's own surface keeps its keys.
//
// What is stopped is exactly what the surfaces underneath would have acted on
// (`resolveScratchKey`), so the app's global chords still work and everything
// else reaches the shell. Escape included: a terminal owns Escape, and a modal
// that ate it would make this shell useless for vim, less, and every reader.

import * as React from "react";

import type { ScratchSession } from "@/features/runs/lib/scratchTerminal";
import { resolveScratchKey } from "@/features/runs/lib/scratchTerminal";
import { SCRATCH_PERSISTENCE } from "@/features/runs/lib/terminalPersistence";
import { Terminal } from "@/features/runs/ui/Terminal";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

interface ScratchTerminalProps {
  scratch: ScratchSession;
  onClose: () => void;
}

export function ScratchTerminal({ onClose, scratch }: ScratchTerminalProps) {
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  // Where focus was when this opened, so closing does not strand a keyboard
  // owner on `<body>` — the same promise the palette makes.
  //
  // **This is a return, not a theft.** Focus goes back to the element that had
  // it, by a direct `.focus()`: no `focusToken` is bumped, so no persistent
  // terminal is remeasured and no pty is resized on the way out.
  const returnTo = React.useRef<Element | null>(null);
  React.useEffect(() => {
    returnTo.current = document.activeElement;
    return () => {
      const held = returnTo.current;
      returnTo.current = null;
      if (held instanceof HTMLElement && held.isConnected) held.focus();
    };
  }, []);

  React.useEffect(() => {
    const overlay = overlayRef.current;
    if (overlay === null) return;
    function handleKeyDown(event: KeyboardEvent) {
      const action = resolveScratchKey({
        altKey: event.altKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action === null) return;
      // Propagation only: the default action is left alone so xterm's own
      // handling of anything shielded still reaches the shell.
      event.stopPropagation();
      if (action.type === "close") {
        event.preventDefault();
        onClose();
      }
    }
    overlay.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      overlay.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [onClose]);

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col p-6"
      data-testid="scratch-terminal"
      ref={overlayRef}
    >
      {/* A real button rather than a div with a click handler: dismissing is
       * an act, and one an assistive technology should be able to name. */}
      <button
        aria-label="close the scratch terminal"
        className="absolute inset-0 cursor-default bg-background/70"
        data-testid="scratch-scrim"
        onClick={onClose}
        type="button"
      />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-popover shadow-2xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
          <span aria-hidden="true" className="text-xs text-muted-foreground">
            ⌁
          </span>
          <span className="shrink-0 text-sm text-foreground">
            scratch shell
          </span>
          <span aria-hidden="true" className="text-2xs text-muted-foreground">
            ·
          </span>
          {/* Which worktree, as the path the shell actually starts in rather
           * than as a branch name — the path is what a `cd` in it is relative
           * to, and it is what the owner would have had to guess. */}
          <span
            className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground"
            data-testid="scratch-cwd"
            title={scratch.cwd}
          >
            {scratch.cwd}
          </span>
          <button
            aria-label="close the scratch terminal"
            className="shrink-0 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            data-testid="scratch-close"
            onClick={onClose}
            title="Close the scratch shell (⌥⌘T)"
            type="button"
          >
            ×
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Terminal
            active
            cwd={scratch.cwd}
            ephemeral
            // A pure trigger the xterm reads once on mount, which is what puts
            // the owner's keystrokes in the shell he just opened. It never
            // changes afterwards, so this surface takes focus exactly once.
            focusToken={0}
            sessionId={scratch.sessionId}
          />
        </div>

        <footer
          className="shrink-0 border-t border-border/60 px-3 py-1.5 text-2xs text-muted-foreground"
          data-testid="scratch-boundary"
          title={SCRATCH_PERSISTENCE.detail}
        >
          {SCRATCH_PERSISTENCE.label}
        </footer>
      </div>
    </div>
  );
}
