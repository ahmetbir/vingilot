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
//
// How far that persistence reaches is the backend's answer, not this
// component's guess: with tmux the shell also outlives the app itself, though
// not a reboot (vingilot_pty/tmux.rs). The status bar states which mode is
// live (features/runs/lib/terminalPersistence.ts); nothing here may imply
// more than it says.
//
// **A session is opened by a measurement, not by mounting.** Terminals for
// every worktree mount at once, all but one of them inside a hidden subtree
// that measures 0×0. Opening those at a placeholder size does not merely
// start a shell small: under tmux the sole attached client's size *is* the
// session's size, so it reshapes a session restored from a previous app run
// and re-wraps its scrollback. So this waits — being shown is what measures
// it, and being measured is what opens it (features/runs/lib/terminalFit.ts).
// A worktree the owner never looks at costs no shell at all.

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
import {
  acceptPtyChunk,
  initialPtyStreamState,
} from "@/features/runs/lib/ptyStream";
import {
  resolveFit,
  resolveFitAction,
  type SessionPhase,
} from "@/features/runs/lib/terminalFit";

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

/** How many frames to keep re-asking for a measurement before giving up.
 * xterm re-measures its cell box from its own IntersectionObserver once a
 * hidden subtree is shown, which lands a frame or more after the React effect
 * that noticed the change; ~2s is far past that and still terminates. A
 * terminal that somehow exhausts it keeps its last good geometry and is
 * re-fitted by the next ResizeObserver callback.
 *
 * Exhausting it is not a deadline for opening the session, only for this
 * burst of frames. A terminal that is never shown is never measured and so
 * never opened — which is the point — and being shown starts a fresh burst. */
const MAX_FIT_FRAMES = 120;

export function Terminal({
  active,
  cwd,
  focusToken,
  sessionId,
}: TerminalProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const termRef = React.useRef<XTerm | null>(null);
  /** Re-runs the live attachment's measure step. Held in a ref because the
   * attachment owns it: it closes over that attachment's xterm, phase, and
   * frame handle, and is null between attachments. */
  const remeasureRef = React.useRef<(() => void) | null>(null);

  // One xterm instance per attachment. Tearing this down detaches a view; it
  // does not end the session, and re-running it reattaches to the same live
  // shell — `pty_open` replays what the screen held rather than spawning a
  // second one.
  React.useEffect(() => {
    const mounted = containerRef.current;
    if (cwd === null || mounted === null) return;
    // Re-bound as non-nullable: the hoisted helpers below are function
    // declarations, which do not inherit the narrowing from the guard.
    const container: HTMLDivElement = mounted;
    const shellCwd: string = cwd;

    const term = new XTerm({ cursorBlink: true, theme: XTERM_THEME });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;

    let detached = false;
    let phase: SessionPhase = "unopened";
    let frame: number | null = null;
    let stream = initialPtyStreamState();
    let unlisten: (() => void) | undefined;

    // Subscribed once per attachment, and always before any `pty_open`: that
    // command emits the reattach replay — and a fresh shell its first prompt
    // — from inside itself, so a listener attached afterwards misses the
    // screen it exists to render. The overlap that ordering creates (a live
    // chunk emitted between the subscribe and the snapshot, and so present in
    // both) is resolved by `ptyStream`. Subscribing here rather than inside
    // `open` also means a retried open cannot stack a second listener.
    const subscribed = onPtyOutput(sessionId, (chunk) => {
      const accepted = acceptPtyChunk(stream, chunk);
      stream = accepted.state;
      for (const text of accepted.write) term.write(text);
    }).then((stop) => {
      if (detached) stop();
      else unlisten = stop;
    });

    async function open(cols: number, rows: number) {
      phase = "opening";
      await subscribed;
      if (detached) return;
      try {
        await ptyOpen(sessionId, shellCwd, cols, rows);
      } catch (error) {
        // Back to unopened, so being shown again retries rather than
        // stranding the pane with no shell and no explanation but this line.
        phase = "unopened";
        if (!detached) term.write(`\r\n[terminal: ${String(error)}]\r\n`);
        return;
      }
      if (detached) return;
      phase = "open";
      // The container can have been resized while the open was in flight, and
      // nothing else is watching for that.
      remeasure();
    }

    /** One measurement, and whatever it licenses. Answers whether to ask
     * again on a later frame. */
    function step(): "retry" | "settled" {
      if (detached) return "settled";
      const { height, width } = container.getBoundingClientRect();
      const action = resolveFitAction(
        phase,
        resolveFit(width, height, fit.proposeDimensions() ?? null),
      );
      if (action.type === "retry") return "retry";
      if (action.type === "idle") return "settled";

      // Both halves or neither: sizing the xterm without handing the pty the
      // same geometry leaves the shell writing for a shape the view is not
      // rendering.
      fit.fit();
      if (action.type === "open") {
        void open(action.cols, action.rows);
      } else {
        void ptyResize(sessionId, action.cols, action.rows).catch(() => {
          // The session can close under a resize (the shell exited, the
          // worktree left the workspace). Nothing to render for it either way.
        });
      }
      return "settled";
    }

    function remeasure() {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      let frames = 0;
      function attempt() {
        frame = null;
        if (step() !== "retry") return;
        frames += 1;
        if (frames > MAX_FIT_FRAMES) return;
        frame = requestAnimationFrame(attempt);
      }
      attempt();
    }

    remeasureRef.current = remeasure;
    remeasure();

    const dataDisposable = term.onData((data) => {
      void ptyWrite(sessionId, data);
    });

    const resizeObserver = new ResizeObserver(() => remeasure());
    resizeObserver.observe(container);

    return () => {
      detached = true;
      remeasureRef.current = null;
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      unlisten?.();
      dataDisposable.dispose();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId, cwd]);

  // Being shown is what measures this terminal, and a measurement is the only
  // thing that opens its session — so for a terminal that mounted hidden this
  // is the open, not merely a re-fit. For one already open it is still the
  // re-fit: every resize while it was hidden measured 0×0 and was refused.
  React.useEffect(() => {
    if (!active) return;
    remeasureRef.current?.();
  }, [active]);

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
