// Thin wrapper around the four `vingilot_pty` Tauri commands (see
// desktop/src-tauri/src/vingilot_pty/mod.rs and
// vingilot/docs/plans/2026-08-06-projects-and-terminal.md's "Contracts fixed
// here"). Follows the same `invokeTauri` + `listen` pattern every other
// Tauri-backed client in this app uses (shared/api/tauri.ts). No pure logic
// lives here — Terminal.tsx is the only caller, and the PTY session map's
// own tests (session.rs) cover the Rust-side behavior this wraps.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import {
  PTY_OUTPUT_EVENT,
  type PtyChunk,
  type PtyOutputEvent,
} from "@/features/runs/lib/ptyStream";

/** Session id = `<worktree binding id>#<tab ordinal>` (see mod.rs's file
 * header): "same tab of the same worktree ⇒ same session". Derived by
 * `lib/terminalTabs.ts`; opaque everywhere else. */
export function ptyOpen(
  session: string,
  cwd: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("pty_open", { session, cwd, cols, rows });
}

export function ptyWrite(session: string, data: string): Promise<void> {
  return invoke("pty_write", { session, data });
}

export function ptyResize(
  session: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("pty_resize", { session, cols, rows });
}

export function ptyClose(session: string): Promise<void> {
  return invoke("pty_close", { session });
}

/** What is keeping terminals alive — `tmux` for a session that outlives the
 * app, `app-process` for one that does not. One answer for the whole app run
 * (desktop/src-tauri/src/vingilot_pty/tmux.rs probes tmux once), and the only
 * thing the UI is allowed to base a persistence claim on. */
export type PtyBacking = "app-process" | "tmux";

export function ptyBacking(): Promise<PtyBacking> {
  return invoke("pty_backing");
}

/** Subscribes to one session's output. Returns the unlisten function —
 * callers tear it down on unmount.
 *
 * Every session shares one event name and is told apart by the id in the
 * payload (`PTY_OUTPUT_EVENT`), so this filters before handing anything over:
 * a caller sees only its own session's chunks and never learns that the
 * others crossed the same channel.
 *
 * Chunks are handed over as they arrive, which is not necessarily the order
 * they were sent: the reattach replay and the live stream are emitted from
 * different threads. Ordering (and de-duplicating the overlap between them)
 * is `lib/ptyStream.ts`'s job, not this wrapper's. */
export function onPtyOutput(
  session: string,
  onChunk: (chunk: PtyChunk) => void,
): Promise<UnlistenFn> {
  return listen<PtyOutputEvent>(PTY_OUTPUT_EVENT, (event) => {
    if (event.payload.session !== session) return;
    onChunk(event.payload);
  });
}
