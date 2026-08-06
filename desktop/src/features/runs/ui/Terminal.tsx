// A real terminal, one instance per worktree, backed by the `vingilot_pty`
// Tauri commands (desktop/src-tauri/src/vingilot_pty/). Renders with
// @xterm/xterm + @xterm/addon-fit — the plan's second and last named
// dependency (vingilot/docs/plans/2026-08-06-projects-and-terminal.md).
//
// **Trust boundary:** this runs the owner's own shell in the worktree named
// by `cwd` — the same risk class as opening Terminal.app there (ADR-003's
// V1 trust model). Nothing here isolates or sandboxes the shell.
//
// Persistence: `WorkSurface` keeps every visited worktree's `<Terminal>`
// mounted for the app's lifetime (toggling `active` rather than
// conditionally rendering), so xterm's own scrollback buffer survives a
// worktree switch without this component ever unmounting.

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

  // One xterm instance for this session's whole mounted lifetime — created
  // once cwd is known, never recreated on prop churn.
  React.useEffect(() => {
    if (cwd === null || containerRef.current === null) return;

    const term = new XTerm({ cursorBlink: true, theme: XTERM_THEME });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;

    fit.fit();
    const { cols, rows } = term;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    async function start() {
      await ptyOpen(sessionId, cwd as string, cols, rows);
      if (cancelled) return;
      unlisten = await onPtyOutput(sessionId, (data) => term.write(data));
    }
    void start();

    const dataDisposable = term.onData((data) => {
      void ptyWrite(sessionId, data);
    });

    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      void ptyResize(sessionId, term.cols, term.rows);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      cancelled = true;
      unlisten?.();
      dataDisposable.dispose();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId, cwd]);

  // Re-fit whenever this terminal becomes the visible one — its container
  // may have been laid out at a stale size while hidden.
  React.useEffect(() => {
    if (!active) return;
    fitRef.current?.fit();
    const term = termRef.current;
    if (term) void ptyResize(sessionId, term.cols, term.rows);
  }, [active, sessionId]);

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
