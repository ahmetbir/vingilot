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
import { type FitDecision, resolveFit } from "@/features/runs/lib/terminalFit";

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

/** Geometry a session is spawned with when nothing has been measured yet — a
 * terminal mounted inside a hidden subtree, which is the ordinary case when
 * the owner returns to a project and every worktree's view remounts at once.
 * It is a placeholder, not a claim: the fit loop below replaces it with the
 * real one the first time this terminal is actually shown. */
const UNMEASURED_COLS = 80;
const UNMEASURED_ROWS = 24;

/** How many frames to keep re-asking for a measurement before giving up.
 * xterm re-measures its cell box from its own IntersectionObserver once a
 * hidden subtree is shown, which lands a frame or more after the React effect
 * that noticed the change; ~2s is far past that and still terminates. A
 * terminal that somehow exhausts it keeps its last good geometry and is
 * re-fitted by the next ResizeObserver callback. */
const MAX_FIT_FRAMES = 120;

export function Terminal({
  active,
  cwd,
  focusToken,
  sessionId,
}: TerminalProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const termRef = React.useRef<XTerm | null>(null);
  const fitRef = React.useRef<FitAddon | null>(null);
  /** False until `pty_open` has returned for this attachment. Resizing before
   * then would either race the spawn or reach a session that does not exist
   * yet. */
  const openedRef = React.useRef(false);
  const fitFrameRef = React.useRef<number | null>(null);

  /** One fit attempt. Answers with the decision so the caller can tell
   * "measured and refused" (stop) apart from "not measured yet" (ask again on
   * a later frame) — conflating them is how a hidden-born terminal ended up
   * pushing its unmeasured 80×24 to a live shell. */
  const fitOnce = React.useCallback((): FitDecision["type"] => {
    const container = containerRef.current;
    const fit = fitRef.current;
    if (container === null || fit === null) return "refuse";
    if (!openedRef.current) return "wait";

    const { height, width } = container.getBoundingClientRect();
    const decision = resolveFit(width, height, fit.proposeDimensions() ?? null);
    if (decision.type !== "apply") return decision.type;

    // Both halves or neither: fitting the xterm without pushing the same
    // geometry to the pty leaves the shell writing for a shape the view is
    // not rendering.
    fit.fit();
    void ptyResize(sessionId, decision.cols, decision.rows).catch(() => {
      // The session can close under a resize (the shell exited, the worktree
      // left the workspace). Nothing to render for it either way.
    });
    return "apply";
  }, [sessionId]);

  const scheduleFit = React.useCallback(() => {
    if (fitFrameRef.current !== null) {
      cancelAnimationFrame(fitFrameRef.current);
      fitFrameRef.current = null;
    }
    let frames = 0;
    function attempt() {
      fitFrameRef.current = null;
      if (fitOnce() !== "wait") return;
      frames += 1;
      if (frames > MAX_FIT_FRAMES) return;
      fitFrameRef.current = requestAnimationFrame(attempt);
    }
    attempt();
  }, [fitOnce]);

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
    openedRef.current = false;

    // Spawn geometry comes from the addon's own proposal or not at all. A
    // terminal built inside a hidden subtree proposes nothing, and reading
    // `term.cols`/`term.rows` there would spawn the shell at the constructor
    // default while claiming it was measured — `pty_open`'s reattach branch
    // deliberately never resizes, so that geometry would stick.
    const { height, width } = containerRef.current.getBoundingClientRect();
    const spawn = resolveFit(width, height, fit.proposeDimensions() ?? null);
    if (spawn.type === "apply") fit.fit();
    const cols = spawn.type === "apply" ? spawn.cols : UNMEASURED_COLS;
    const rows = spawn.type === "apply" ? spawn.rows : UNMEASURED_ROWS;

    let unlisten: (() => void) | undefined;
    let detached = false;
    let stream = initialPtyStreamState();

    async function attach() {
      // Subscribe before opening, never after: `pty_open` emits the
      // reattach replay — and a fresh shell emits its first prompt —
      // from inside the command, so a listener attached afterwards misses
      // the screen it exists to render. The overlap that ordering creates
      // (a live chunk emitted between the subscribe and the snapshot, and
      // therefore present in both) is resolved by `ptyStream`.
      const stop = await onPtyOutput(sessionId, (chunk) => {
        const accepted = acceptPtyChunk(stream, chunk);
        stream = accepted.state;
        for (const text of accepted.write) term.write(text);
      });
      if (detached) {
        stop();
        return;
      }
      unlisten = stop;
      try {
        await ptyOpen(sessionId, cwd as string, cols, rows);
      } catch (error) {
        if (!detached) term.write(`\r\n[terminal: ${String(error)}]\r\n`);
        return;
      }
      if (detached) return;
      openedRef.current = true;
      // Corrects the placeholder geometry above once this terminal is on
      // screen and xterm has measured a cell.
      scheduleFit();
    }
    void attach();

    const dataDisposable = term.onData((data) => {
      void ptyWrite(sessionId, data);
    });

    const resizeObserver = new ResizeObserver(() => scheduleFit());
    resizeObserver.observe(containerRef.current);

    return () => {
      detached = true;
      openedRef.current = false;
      if (fitFrameRef.current !== null) {
        cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }
      unlisten?.();
      dataDisposable.dispose();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId, cwd, scheduleFit]);

  // Re-fit whenever this terminal becomes the visible one — while hidden its
  // container had no box, so every resize since the last visit was refused,
  // and its cell box may never have been measured at all.
  React.useEffect(() => {
    if (!active) return;
    scheduleFit();
  }, [active, scheduleFit]);

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
