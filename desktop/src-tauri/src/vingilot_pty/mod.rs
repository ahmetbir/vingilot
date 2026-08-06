//! Real terminal sessions, one per worktree — the PTY backend for
//! Vingilot's Terminal tab (vingilot/docs/plans/2026-08-06-projects-and-terminal.md).
//!
//! A session id is the worktree binding id: "same worktree ⇒ same session".
//! `pty_open` is idempotent — opening an already-open session returns
//! immediately without spawning a second shell, and replays that session's
//! retained screen (session.rs, `scrollback.rs`) so the view attaching to it
//! is not blank. Output streams to the webview as a Tauri event named
//! `vingilot://pty/<session>` carrying `{ data: string }`.
//!
//! Callers must subscribe to that event *before* calling `pty_open`: both
//! the replay above and a fresh shell's first prompt are emitted from inside
//! the command, so a listener attached after it returns misses them.
//!
//! **Trust boundary:** the PTY runs the owner's own shell in the owner's own
//! worktree — the same risk class as them typing in Terminal.app (ADR-003's
//! V1 trust model). Nothing here isolates or sandboxes the shell; UI copy
//! that surfaces a worktree chip must say only where the shell starts.

mod scrollback;
mod session;

use scrollback::Scrollback;
use session::PtySession;
pub(crate) use session::PtySessions;

use std::io::Read;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Serialize)]
struct PtyOutputPayload {
    data: String,
}

fn pty_event_name(session_id: &str) -> String {
    format!("vingilot://pty/{session_id}")
}

/// The owner's login shell — the same one Terminal.app would launch.
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

/// Open a PTY session rooted at `cwd`, running the owner's shell. Idempotent:
/// when `session` is already open, no second shell is spawned — instead the
/// running session's retained screen is replayed to the view that just
/// attached, which is otherwise blank until the shell happens to print again
/// (at an idle prompt: never).
#[tauri::command]
pub fn pty_open(
    app: AppHandle,
    sessions: State<'_, PtySessions>,
    session: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if let Some(retained) = sessions.replay(&session) {
        // Deliberately no resize here. The `cols`/`rows` a reattaching view
        // reports may be its pre-layout defaults, and adopting them would
        // reflow the live shell to a geometry nobody is looking at — the
        // exact way the previous version destroyed scrollback. The view
        // resizes the pty itself once it is on screen and measured
        // (features/runs/lib/terminalFit.ts).
        if !retained.is_empty() {
            let _ = app.emit(
                &pty_event_name(&session),
                PtyOutputPayload { data: retained },
            );
        }
        return Ok(());
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("open pty: {e}"))?;

    let mut cmd = CommandBuilder::new(default_shell());
    cmd.cwd(&cwd);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn shell: {e}"))?;
    // The slave fd now belongs to the child; drop our copy so the master
    // side observes EOF once the child exits instead of staying open.
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone pty reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take pty writer: {e}"))?;

    let pty_session = PtySession {
        writer,
        master: pair.master,
        child,
        scrollback: Scrollback::default(),
    };

    if let Err(mut losing_session) = sessions.insert_if_absent(session.clone(), pty_session) {
        // Lost a race with a concurrent pty_open for the same worktree — the
        // winner is already running, so tear down the shell we just spawned
        // instead of leaking it.
        let _ = losing_session.child.kill();
        return Ok(());
    }

    spawn_reader_thread(app, session, reader);

    Ok(())
}

/// Write raw input bytes (keystrokes, pasted text) to a session's shell.
#[tauri::command]
pub fn pty_write(
    sessions: State<'_, PtySessions>,
    session: String,
    data: String,
) -> Result<(), String> {
    sessions.write(&session, data.as_bytes())
}

/// Resize a session's pty — and the shell's controlling terminal — to match
/// the webview's terminal viewport.
#[tauri::command]
pub fn pty_resize(
    sessions: State<'_, PtySessions>,
    session: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    sessions.resize(&session, cols, rows)
}

/// Close a session and kill its shell. Idempotent: closing an unknown or
/// already-closed session id is not an error.
#[tauri::command]
pub fn pty_close(sessions: State<'_, PtySessions>, session: String) -> Result<(), String> {
    sessions.close(&session);
    Ok(())
}

/// Stream a session's pty output to the webview — recording it into the
/// session's scrollback on the way past, so a view that attaches later can
/// be shown the same screen — until the shell exits (EOF) or the read
/// errors, then remove the session so the next `pty_open` for this worktree
/// spawns a fresh shell instead of silently doing nothing against a dead one.
fn spawn_reader_thread(app: AppHandle, session_id: String, mut reader: Box<dyn Read + Send>) {
    std::thread::spawn(move || {
        let event_name = pty_event_name(&session_id);
        let sessions = app.state::<PtySessions>();
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    // Record the raw bytes, emit the decoded ones. A read can
                    // end mid-character, so only the buffer — which keeps the
                    // halves and decodes the whole span at replay time — can
                    // put such a character back together.
                    sessions.record_output(&session_id, &buf[..n]);
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app.emit(&event_name, PtyOutputPayload { data });
                }
                Err(_) => break,
            }
        }
        sessions.close(&session_id);
    });
}
