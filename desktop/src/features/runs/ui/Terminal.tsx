// A real terminal, one instance per PTY session, backed by the
// `vingilot_pty` Tauri commands (desktop/src-tauri/src/vingilot_pty/).
// Renders with @xterm/xterm + @xterm/addon-fit — the plan's second and last
// named dependency (vingilot/docs/plans/2026-08-06-projects-and-terminal.md).
//
// **Trust boundary:** this runs the owner's own shell in the worktree named
// by `cwd` — the same risk class as opening Terminal.app there (ADR-003's
// V1 trust model). Nothing here isolates or sandboxes the shell.
//
// **Persistence is the pty's, not this component's.** Mounting attaches a
// view to a session; unmounting detaches it and leaves the shell running, so
// a worktree switch, a project switch, or any re-render is survivable. What
// the screen held comes back from the session's own scrollback, replayed by
// `pty_open` on reattach — this component never assumes its xterm outlives
// anything. The shell is killed only when the worktree itself leaves the
// workspace (features/runs/lib/terminalSessions.ts), which is the only event
// that means "really closed".

import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import * as React from "react";

import {
  onPtyOutput,
  ptyOpen,
  ptyResize,
  ptyWrite,
} from "@/features/runs/lib/ptyClient";
import { shouldFit, shouldResizePty } from "@/features/runs/lib/terminalFit";

interface TerminalProps {
  /** The worktree binding id — the PTY session id (mod.rs: "same worktree
   * ⇒ same session"). */
  sessionId: string;
  /** Where the shell starts. `null` means this worktree's cwd cannot yet be
   * derived (e.g. a task worktree with no owner run) — the terminal shows a
   * waiting state instead of opening a session. */
  cwd: string | null;
  /** False while a different worktree/tab is showing — the DOM stays
   * mounted (scrollback intact) but hidden, never torn down. */
  active: boolean;
  /** Bumped by the work surface's ⌘` handler; focusing only happens when
   * `active` is also true, so a background terminal never steals focus. */
  focusToken: number;
}

const XTERM_THEME = {
  background: "transparent",
} as const;

export function Terminal({
  active,
  cwd,
  focusToken,
  sessionId,
}: TerminalProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const termRef = React.useRef<XTerm | null>(null);
  const fitRef = React.useRef<FitAddon | null>(null);

  /** Fit and push the result to the pty, but only from a container that is
   * actually on screen. A hidden container measures 0×0, and adopting that
   * would reflow the live shell's output to a geometry nobody is looking at
   * — which is how the scrollback used to disappear between two visits to
   * the same worktree. */
  const fitToContainer = React.useCallback(() => {
    const container = containerRef.current;
    const term = termRef.current;
    if (container === null || term === null) return;

    const { height, width } = container.getBoundingClientRect();
    if (!shouldFit(width, height)) return;

    fitRef.current?.fit();
    if (!shouldResizePty(term.cols, term.rows)) return;
    void ptyResize(sessionId, term.cols, term.rows);
  }, [sessionId]);

  // One xterm instance per attachment. Tearing this down detaches a view; it
  // does not end the session, and re-running it reattaches to the same live
  // shell — `pty_open` replays what the screen held rather than spawning a
  // second one.
  React.useEffect(() => {
    if (cwd === null || containerRef.current === null) return;

    const term = new XTerm({ cursorBlink: true, theme: XTERM_THEME });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;

    const { height, width } = containerRef.current.getBoundingClientRect();
    if (shouldFit(width, height)) fit.fit();
    const { cols, rows } = term;

    let unlisten: (() => void) | undefined;
    let detached = false;

    async function attach() {
      // Subscribe before opening, never after: `pty_open` emits the
      // reattach replay — and a fresh shell emits its first prompt —
      // from inside the command, so a listener attached afterwards misses
      // the screen it exists to render.
      const stop = await onPtyOutput(sessionId, (data) => term.write(data));
      if (detached) {
        stop();
        return;
      }
      unlisten = stop;
      await ptyOpen(sessionId, cwd as string, cols, rows);
    }
    void attach();

    const dataDisposable = term.onData((data) => {
      void ptyWrite(sessionId, data);
    });

    const resizeObserver = new ResizeObserver(() => fitToContainer());
    resizeObserver.observe(containerRef.current);

    return () => {
      detached = true;
      unlisten?.();
      dataDisposable.dispose();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId, cwd, fitToContainer]);

  // Re-fit whenever this terminal becomes the visible one — while hidden its
  // container had no box, so every resize since the last visit was refused.
  React.useEffect(() => {
    if (!active) return;
    fitToContainer();
  }, [active, fitToContainer]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focusToken is a pure trigger, its value is never read
  React.useEffect(() => {
    if (!active) return;
    termRef.current?.focus();
  }, [active, focusToken]);

  return (
    <div
      className={`min-h-0 min-w-0 flex-1 ${active ? "flex" : "hidden"}`}
      data-testid={`terminal-${sessionId}`}
    >
      {cwd === null ? (
        <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          waiting for this worktree's checkout…
        </p>
      ) : (
        <div className="flex-1 overflow-hidden px-2 py-1" ref={containerRef} />
      )}
    </div>
  );
}
