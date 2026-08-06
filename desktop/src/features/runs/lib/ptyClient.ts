// Thin wrapper around the four `vingilot_pty` Tauri commands (see
// desktop/src-tauri/src/vingilot_pty/mod.rs and
// vingilot/docs/plans/2026-08-06-projects-and-terminal.md's "Contracts fixed
// here"). Follows the same `invokeTauri` + `listen` pattern every other
// Tauri-backed client in this app uses (shared/api/tauri.ts). No pure logic
// lives here — Terminal.tsx is the only caller, and the PTY session map's
// own tests (session.rs) cover the Rust-side behavior this wraps.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { PtyChunk } from "@/features/runs/lib/ptyStream";

/** Session id = the worktree binding id (see mod.rs's file header): "same
 * worktree ⇒ same session". */
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

/** Subscribes to a session's output event (`vingilot://pty/<session>`).
 * Returns the unlisten function — callers tear it down on unmount.
 *
 * Chunks are handed over as they arrive, which is not necessarily the order
 * they were sent: the reattach replay and the live stream are emitted from
 * different threads. Ordering (and de-duplicating the overlap between them)
 * is `lib/ptyStream.ts`'s job, not this wrapper's. */
export function onPtyOutput(
  session: string,
  onChunk: (chunk: PtyChunk) => void,
): Promise<UnlistenFn> {
  return listen<PtyChunk>(`vingilot://pty/${session}`, (event) => {
    onChunk(event.payload);
  });
}
