// Thin wrapper around the four `vingilot_pty` Tauri commands (see
// desktop/src-tauri/src/vingilot_pty/mod.rs and
// vingilot/docs/plans/2026-08-06-projects-and-terminal.md's "Contracts fixed
// here"). Follows the same `invokeTauri` + `listen` pattern every other
// Tauri-backed client in this app uses (shared/api/tauri.ts). No pure logic
// lives here — Terminal.tsx is the only caller, and the PTY session map's
// own tests (session.rs) cover the Rust-side behavior this wraps.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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

interface PtyOutputPayload {
  data: string;
}

/** Subscribes to a session's output event (`vingilot://pty/<session>`).
 * Returns the unlisten function — callers tear it down on unmount. */
export function onPtyOutput(
  session: string,
  onData: (data: string) => void,
): Promise<UnlistenFn> {
  return listen<PtyOutputPayload>(`vingilot://pty/${session}`, (event) => {
    onData(event.payload.data);
  });
}
