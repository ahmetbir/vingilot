//! Real terminal sessions, one per worktree — the PTY backend for
//! Vingilot's Terminal tab (vingilot/docs/plans/2026-08-06-projects-and-terminal.md).
//!
//! A session id is `<worktree binding id>#<tab ordinal>`: "same tab of the
//! same worktree ⇒ same session". A worktree owns an ordered strip of terminal
//! tabs (`features/runs/lib/terminalTabs.ts`) the way an iTerm window owns
//! tabs, and each of them is a separate shell in the same checkout. The id is
//! opaque on this side — nothing here parses it — but it does have to survive
//! `tmux::session_name`, which is why that derivation's alphabet is tested
//! against this shape and not only against a bare binding id.
//! `pty_open` is idempotent — opening an already-open session returns
//! immediately without spawning a second shell, and replays that session's
//! retained screen (session.rs, `scrollback.rs`) so the view attaching to it
//! is not blank. Output streams to the webview as a Tauri event named
//! `vingilot://pty/<session>` carrying `{ data, seq, replay }`.
//!
//! Callers must subscribe to that event *before* calling `pty_open`: both
//! the replay and a fresh shell's first prompt are emitted from inside the
//! command, so a listener attached after it returns misses them. That
//! ordering means a live chunk can be emitted after the subscribe and still
//! land in the snapshot `pty_open` takes, so every event carries its position
//! in the session's output stream: live chunks carry their own, and the
//! replay carries the position its screen stops short of. A view discards the
//! live chunks below that mark
//! (`desktop/src/features/runs/lib/ptyStream.ts`). `pty_open` **always**
//! emits exactly one replay event, including for a shell it just spawned
//! (empty, mark 0) — a view has no other signal that the mark has arrived.
//!
//! **Persistence:** where tmux is available the shell runs inside a tmux
//! session, so it survives quitting the app — but not a reboot, a
//! `tmux kill-server`, or a crash (`tmux.rs`). Where it is not, the shell is
//! a child of this app and dies with it. `pty_backing` reports which, and the
//! UI must never claim more than it says.
//!
//! **Trust boundary:** the PTY runs the owner's own shell in the owner's own
//! worktree — the same risk class as them typing in Terminal.app (ADR-003's
//! V1 trust model). Nothing here isolates or sandboxes the shell; UI copy
//! that surfaces a worktree chip must say only where the shell starts.

mod scrollback;
mod session;
mod tmux;
mod utf8_stream;

pub(crate) use session::PtySessions;
use session::{kill_and_reap, PtySession};
use tmux::Backing;
use utf8_stream::decode_stream;

use std::io::Read;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Serialize)]
struct PtyOutputPayload {
    data: String,
    /// For a live chunk, its own position in the session's output stream.
    /// For a replay, the position the replayed screen stops short of.
    seq: u64,
    replay: bool,
}

fn pty_event_name(session_id: &str) -> String {
    format!("vingilot://pty/{session_id}")
}

/// Hand a newly attached view the session's screen and the mark it filters
/// live output against. Emitted for a reattach and for a fresh spawn alike:
/// the mark is what unblocks the view, not the screen.
fn emit_replay(app: &AppHandle, session_id: &str, screen: String, next_seq: u64) {
    let _ = app.emit(
        &pty_event_name(session_id),
        PtyOutputPayload {
            data: screen,
            seq: next_seq,
            replay: true,
        },
    );
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
///
/// **`cols`/`rows` must be a geometry the caller actually measured.** The
/// spawn below adopts them, and under tmux the pty's size becomes the
/// *session's* size — `-D` having detached every other client, the one
/// attaching is the only one left to size it. A placeholder therefore does
/// not merely start a shell small: measured on tmux 3.6a, a session restored
/// at 213×51 becomes 80×23 the moment an 80×24 client attaches, re-wrapping
/// the scrollback it was restored for. There is no way to tell a placeholder
/// from a real 80×24 here, so the refusal lives with the caller, which is the
/// only side that knows whether anything was laid out
/// (`features/runs/lib/terminalFit.ts`).
#[tauri::command]
pub fn pty_open(
    app: AppHandle,
    sessions: State<'_, PtySessions>,
    session: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if let Some((screen, next_seq)) = sessions.replay(&session) {
        // Deliberately no resize here. The `cols`/`rows` a reattaching view
        // reports may be its pre-layout defaults, and adopting them would
        // reflow the live shell to a geometry nobody is looking at — the
        // exact way the previous version destroyed scrollback. The view
        // resizes the pty itself once it is on screen and measured
        // (features/runs/lib/terminalFit.ts).
        emit_replay(&app, &session, screen, next_seq);
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

    let plan = tmux::plan_spawn(tmux::path(), &default_shell(), &session, &cwd);
    let mut cmd = CommandBuilder::new(&plan.program);
    for arg in &plan.args {
        cmd.arg(arg);
    }
    cmd.cwd(&cwd);
    // If the app itself was launched from inside tmux, this variable makes
    // the new session refuse to start ("sessions should be nested with
    // care"). Our session is not nested inside the launching one and must not
    // be told it is.
    cmd.env_remove("TMUX");

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

    let pty_session = PtySession::new(writer, pair.master, child);

    if let Err(mut losing_session) = sessions.insert_if_absent(session.clone(), pty_session) {
        // Lost a race with a concurrent pty_open for the same worktree — the
        // winner is already running, so tear down the shell we just spawned
        // instead of leaking it, and serve this view from the winner's screen
        // as any other reattach would. Without that, the view waits forever
        // for a mark that nothing is going to send.
        kill_and_reap(losing_session.child.as_mut());
        if let Some((screen, next_seq)) = sessions.replay(&session) {
            emit_replay(&app, &session, screen, next_seq);
        }
        return Ok(());
    }

    // Before the reader thread, so this view's mark is in flight ahead of the
    // first byte the shell prints.
    //
    // Empty by construction, not by choice: the session was registered a
    // moment ago and has recorded nothing. That is what keeps the scrollback
    // ring and tmux's own attach redraw from ever competing — this is the
    // only branch on which tmux attaches and redraws, and it is the only
    // branch that replays no screen (`scrollback.rs`).
    emit_replay(&app, &session, String::new(), 0);
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
///
/// This is the "really closed" path — the worktree left the workspace, so
/// nothing will ever reattach. That is why it also ends the tmux session,
/// which a mere client teardown deliberately does not: outliving its client
/// is the whole point of the tmux backing, and outliving its worktree is not.
///
/// A tmux that ran and refused is logged rather than returned: most calls
/// here are for a shell that never ran under tmux at all, so "no such
/// session" is the ordinary answer and failing the close on it would make
/// every non-tmux teardown look broken. Only the outcome tmux has no excuse
/// for reaches the log, and it names the session so it can be found by hand.
#[tauri::command]
pub fn pty_close(sessions: State<'_, PtySessions>, session: String) -> Result<(), String> {
    sessions.close(&session);
    if let tmux::KillOutcome::Failed(reason) = tmux::kill_session(&session) {
        eprintln!("buzz-desktop: could not end tmux session for {session}: {reason}");
    }
    Ok(())
}

/// What is keeping terminals alive, so the UI can say so and claim no more.
///
/// One answer for the whole app run: tmux is probed once and cached
/// (`tmux.rs`), so every session opened in this run has the same backing.
#[tauri::command]
pub fn pty_backing() -> Backing {
    tmux::backing(tmux::path())
}

/// Stream a session's pty output to the webview — recording it into the
/// session's scrollback on the way past, so a view that attaches later can
/// be shown the same screen — until the shell exits (EOF) or the read
/// errors, then remove the session so the next `pty_open` for this worktree
/// spawns a fresh shell instead of silently doing nothing against a dead one.
///
/// What is recorded and what is emitted are the same span, decoded once: a
/// chunk's position in the stream is the mark a reattaching view filters on,
/// so the two must not describe different bytes. A read that ends
/// mid-character therefore contributes nothing until the next read completes
/// it (`utf8_stream.rs`).
fn spawn_reader_thread(app: AppHandle, session_id: String, mut reader: Box<dyn Read + Send>) {
    std::thread::spawn(move || {
        let event_name = pty_event_name(&session_id);
        let sessions = app.state::<PtySessions>();
        let mut buf = [0u8; 4096];
        let mut partial: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    partial.extend_from_slice(&buf[..n]);
                    let (data, rest) = decode_stream(&partial);
                    partial = rest;
                    if data.is_empty() {
                        continue;
                    }
                    let Some(seq) = sessions.record_output(&session_id, data.as_bytes()) else {
                        // The session was closed under us; nothing will ever
                        // render this.
                        break;
                    };
                    let _ = app.emit(
                        &event_name,
                        PtyOutputPayload {
                            data,
                            seq,
                            replay: false,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        sessions.close(&session_id);
    });
}
