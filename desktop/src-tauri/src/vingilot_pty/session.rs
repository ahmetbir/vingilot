//! The live PTY session registry: session id (the worktree binding id) to
//! its running shell. See `super` for the Tauri command surface that reads
//! and writes this registry.

use std::collections::HashMap;
use std::io::Write;
use std::sync::{Mutex, MutexGuard};

use portable_pty::{Child, MasterPty, PtySize};

use super::scrollback::Scrollback;

/// One live PTY session: the write half of the master pty (keystrokes go
/// in), the master itself (for resize), the spawned shell's child handle
/// (for kill on close), and the bounded record of what the shell has printed
/// (for replay to a view that attaches after the fact).
pub(crate) struct PtySession {
    pub(crate) writer: Box<dyn Write + Send>,
    pub(crate) master: Box<dyn MasterPty + Send>,
    pub(crate) child: Box<dyn Child + Send + Sync>,
    pub(crate) scrollback: Scrollback,
    /// Position the next recorded chunk takes in this session's output
    /// stream. A reattaching view is told where the replay stops so it can
    /// discard the live chunks the replay already contains — the two are
    /// emitted from different threads and otherwise overlap. See
    /// `desktop/src/features/runs/lib/ptyStream.ts`.
    next_seq: u64,
}

impl PtySession {
    pub(crate) fn new(
        writer: Box<dyn Write + Send>,
        master: Box<dyn MasterPty + Send>,
        child: Box<dyn Child + Send + Sync>,
    ) -> Self {
        Self {
            writer,
            master,
            child,
            scrollback: Scrollback::default(),
            next_seq: 0,
        }
    }
}

/// Kill a shell and reap it.
///
/// The reap is not optional: `std::process::Child`'s `Drop` does not wait, so
/// a kill on its own leaves a zombie for as long as the app runs — one per
/// terminal the owner ever closed. The wait follows a signal the process
/// cannot decline and is called with no lock held, so it does not hold up
/// anything else in the registry.
pub(crate) fn kill_and_reap(child: &mut (dyn Child + Send + Sync)) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Thread-safe registry of live PTY sessions, keyed by session id — the
/// worktree binding id, so "same worktree ⇒ same session". Managed as Tauri
/// state; one instance lives for the app's lifetime.
#[derive(Default)]
pub(crate) struct PtySessions(Mutex<HashMap<String, PtySession>>);

impl PtySessions {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Lock the session map, recovering a poisoned lock rather than
    /// surfacing it as an error. A panic on one session's reader thread must
    /// not turn every worktree's terminal into a permanent error screen —
    /// the app already shipped that exact bug once (`agent_config.rs`, an
    /// OOM that poisoned a lock and froze the whole Agents page).
    fn lock(&self) -> MutexGuard<'_, HashMap<String, PtySession>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Insert a freshly spawned session, unless one already exists for this
    /// id — a race between two `pty_open` calls for the same worktree. On
    /// conflict, the session that was just built is handed back so the
    /// caller can tear it down instead of leaking the spawned process.
    pub(crate) fn insert_if_absent(
        &self,
        session_id: String,
        session: PtySession,
    ) -> Result<(), PtySession> {
        let mut sessions = self.lock();
        if sessions.contains_key(&session_id) {
            return Err(session);
        }
        sessions.insert(session_id, session);
        Ok(())
    }

    /// Write raw bytes to a session's shell. Errors when no session is open
    /// for this id.
    pub(crate) fn write(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let mut sessions = self.lock();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("no pty session open for {session_id}"))?;
        session.writer.write_all(data).map_err(|e| e.to_string())
    }

    /// Resize a session's pty (and the shell's controlling terminal).
    /// Errors when no session is open for this id.
    pub(crate) fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.lock();
        let session = sessions
            .get(session_id)
            .ok_or_else(|| format!("no pty session open for {session_id}"))?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    /// Record output a session's shell just produced, so a view attaching
    /// later can be shown what it missed, and answer with the position this
    /// chunk takes in the session's output stream. `None` when the session is
    /// no longer registered — the shell is gone and nothing will ever
    /// reattach to it, so the output is dropped.
    ///
    /// Callers must record whole characters: the position returned here is
    /// what a reattaching view compares against, so the recorded bytes and
    /// the emitted text have to describe the same span exactly.
    pub(crate) fn record_output(&self, session_id: &str, bytes: &[u8]) -> Option<u64> {
        let mut sessions = self.lock();
        let session = sessions.get_mut(session_id)?;
        session.scrollback.push(bytes);
        let seq = session.next_seq;
        session.next_seq = session.next_seq.saturating_add(1);
        Some(seq)
    }

    /// What a session's screen holds right now and the stream position that
    /// screen stops short of, for replay to a freshly attached view. `None`
    /// when no session is open for this id — the caller is about to spawn a
    /// shell, and a fresh shell has nothing to replay.
    pub(crate) fn replay(&self, session_id: &str) -> Option<(String, u64)> {
        self.lock()
            .get(session_id)
            .map(|session| (session.scrollback.replay(), session.next_seq))
    }

    /// The pid of a session's shell.
    ///
    /// Test-only, and deliberately so: nothing in the app has any business
    /// with a pid — `close` is the only thing that ends a shell, and it holds
    /// the handle itself. It exists because "no orphan shells" cannot be
    /// asserted by counting this process's children (the tests run in threads
    /// of one process and would count each other's), only by naming the exact
    /// processes a terminal started and looking for them afterwards.
    #[cfg(test)]
    pub(crate) fn child_pid(&self, session_id: &str) -> Option<u32> {
        self.lock().get(session_id)?.child.process_id()
    }

    /// Remove and kill a session. Idempotent: closing an unknown or
    /// already-closed session id is a no-op, not an error.
    pub(crate) fn close(&self, session_id: &str) {
        let removed = self.lock().remove(session_id);
        if let Some(mut session) = removed {
            kill_and_reap(session.child.as_mut());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use portable_pty::{Child, ChildKiller, ExitStatus, MasterPty, PtySize};
    use std::io::{self, Read, Write};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    /// A `Write` sink that just counts bytes — enough to prove a session's
    /// writer was reached.
    #[derive(Default)]
    struct FakeWriter {
        written: Vec<u8>,
    }

    impl Write for FakeWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.written.extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    /// A `MasterPty` that records the last resize it was asked to perform.
    struct FakeMaster {
        last_resize: Mutex<Option<PtySize>>,
    }

    impl FakeMaster {
        fn new() -> Self {
            Self {
                last_resize: Mutex::new(None),
            }
        }
    }

    impl MasterPty for FakeMaster {
        fn resize(&self, size: PtySize) -> anyhow::Result<()> {
            *self.last_resize.lock().unwrap_or_else(|e| e.into_inner()) = Some(size);
            Ok(())
        }
        fn get_size(&self) -> anyhow::Result<PtySize> {
            Ok(self
                .last_resize
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .unwrap_or_default())
        }
        fn try_clone_reader(&self) -> anyhow::Result<Box<dyn Read + Send>> {
            Ok(Box::new(io::empty()))
        }
        fn take_writer(&self) -> anyhow::Result<Box<dyn Write + Send>> {
            Ok(Box::new(FakeWriter::default()))
        }
        #[cfg(unix)]
        fn process_group_leader(&self) -> Option<libc::pid_t> {
            None
        }
        #[cfg(unix)]
        fn as_raw_fd(&self) -> Option<std::os::fd::RawFd> {
            None
        }
        #[cfg(unix)]
        fn tty_name(&self) -> Option<std::path::PathBuf> {
            None
        }
    }

    /// A `Child` that records whether it was killed and whether it was
    /// waited on — a kill without the wait is what leaves a zombie behind.
    struct FakeChild {
        killed: Arc<AtomicBool>,
        waited: Arc<AtomicBool>,
    }

    impl std::fmt::Debug for FakeChild {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.debug_struct("FakeChild").finish()
        }
    }

    impl ChildKiller for FakeChild {
        fn kill(&mut self) -> io::Result<()> {
            self.killed.store(true, Ordering::SeqCst);
            Ok(())
        }
        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(FakeChild {
                killed: Arc::clone(&self.killed),
                waited: Arc::clone(&self.waited),
            })
        }
    }

    impl Child for FakeChild {
        fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
            Ok(None)
        }
        fn wait(&mut self) -> io::Result<ExitStatus> {
            self.waited.store(true, Ordering::SeqCst);
            Ok(ExitStatus::with_exit_code(0))
        }
        fn process_id(&self) -> Option<u32> {
            None
        }
        #[cfg(windows)]
        fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
            None
        }
    }

    /// What a fake session's shell recorded about its own teardown.
    #[derive(Clone)]
    struct Teardown {
        killed: Arc<AtomicBool>,
        waited: Arc<AtomicBool>,
    }

    fn fake_session() -> (PtySession, Teardown) {
        let teardown = Teardown {
            killed: Arc::new(AtomicBool::new(false)),
            waited: Arc::new(AtomicBool::new(false)),
        };
        let session = PtySession::new(
            Box::new(FakeWriter::default()),
            Box::new(FakeMaster::new()),
            Box::new(FakeChild {
                killed: Arc::clone(&teardown.killed),
                waited: Arc::clone(&teardown.waited),
            }),
        );
        (session, teardown)
    }

    /// Presence, asked the way production asks it: `replay` answers `None`
    /// for a session that is not open, which is exactly the signal `pty_open`
    /// uses to decide between replaying and spawning.
    fn is_open(sessions: &PtySessions, session_id: &str) -> bool {
        sessions.replay(session_id).is_some()
    }

    /// Just the retained screen, for the assertions that do not care where
    /// the stream position sits.
    fn replayed_screen(sessions: &PtySessions, session_id: &str) -> Option<String> {
        sessions.replay(session_id).map(|(screen, _)| screen)
    }

    #[test]
    fn a_session_is_not_present_until_inserted() {
        let sessions = PtySessions::new();
        assert!(!is_open(&sessions, "wt-1"));
    }

    #[test]
    fn insert_then_the_session_is_open() {
        let sessions = PtySessions::new();
        let (session, _teardown) = fake_session();
        assert!(sessions
            .insert_if_absent("wt-1".to_string(), session)
            .is_ok());
        assert!(is_open(&sessions, "wt-1"));
    }

    #[test]
    fn opening_an_already_open_session_id_is_idempotent() {
        let sessions = PtySessions::new();
        let (first, first_teardown) = fake_session();
        assert!(sessions.insert_if_absent("wt-1".to_string(), first).is_ok());

        // A second "open" for the same worktree must not replace the
        // running session — the caller is expected to check for an existing
        // one first, but even a raced `insert_if_absent` hands the loser
        // back instead of silently overwriting the winner.
        let (second, _second_teardown) = fake_session();
        let result = sessions.insert_if_absent("wt-1".to_string(), second);
        assert!(result.is_err(), "second insert for the same id must lose");

        // The original session is untouched.
        assert!(!first_teardown.killed.load(Ordering::SeqCst));
        assert!(is_open(&sessions, "wt-1"));
    }

    #[test]
    fn close_removes_the_session_and_kills_the_child() {
        let sessions = PtySessions::new();
        let (session, teardown) = fake_session();
        assert!(sessions
            .insert_if_absent("wt-1".to_string(), session)
            .is_ok());

        sessions.close("wt-1");

        assert!(!is_open(&sessions, "wt-1"));
        assert!(teardown.killed.load(Ordering::SeqCst));
    }

    #[test]
    fn close_reaps_the_shell_it_killed_instead_of_leaving_a_zombie() {
        // A kill without a wait leaves one zombie per terminal the owner ever
        // closed, for as long as the app runs — Child's Drop does not reap.
        let sessions = PtySessions::new();
        let (session, teardown) = fake_session();
        assert!(sessions
            .insert_if_absent("wt-1".to_string(), session)
            .is_ok());

        sessions.close("wt-1");

        assert!(teardown.waited.load(Ordering::SeqCst));
    }

    #[test]
    fn a_session_torn_down_before_it_was_registered_is_also_reaped() {
        // The raced-open path: the loser was spawned and never inserted, so
        // nothing else will ever reap it.
        let (mut session, teardown) = fake_session();
        kill_and_reap(session.child.as_mut());
        assert!(teardown.killed.load(Ordering::SeqCst));
        assert!(teardown.waited.load(Ordering::SeqCst));
    }

    #[test]
    fn closing_an_unknown_session_is_a_no_op_not_an_error() {
        let sessions = PtySessions::new();
        sessions.close("never-opened");
        assert!(!is_open(&sessions, "never-opened"));
    }

    #[test]
    fn write_against_an_unknown_session_errors_without_panicking() {
        let sessions = PtySessions::new();
        assert!(sessions.write("nope", b"echo hi").is_err());
    }

    #[test]
    fn resize_against_an_unknown_session_errors_without_panicking() {
        let sessions = PtySessions::new();
        assert!(sessions.resize("nope", 80, 24).is_err());
    }

    #[test]
    fn resize_reaches_the_sessions_master() {
        let sessions = PtySessions::new();
        let (session, _teardown) = fake_session();
        assert!(sessions
            .insert_if_absent("wt-1".to_string(), session)
            .is_ok());

        sessions.resize("wt-1", 120, 40).expect("resize succeeds");
    }

    #[test]
    fn reattaching_to_a_live_session_returns_the_bytes_it_retained() {
        // The whole point of the ring: `pty_open` against a live session must
        // not spawn a second shell, and until this existed it also had
        // nothing to hand the newly attached view, which rendered blank.
        let sessions = PtySessions::new();
        let (session, _teardown) = fake_session();
        assert!(sessions
            .insert_if_absent("wt-1".to_string(), session)
            .is_ok());

        sessions.record_output("wt-1", b"$ cargo test\r\n");
        sessions.record_output("wt-1", b"test result: ok\r\n");

        assert_eq!(
            replayed_screen(&sessions, "wt-1").as_deref(),
            Some("$ cargo test\r\ntest result: ok\r\n")
        );
    }

    #[test]
    fn a_session_that_has_printed_nothing_replays_an_empty_screen_not_none() {
        let sessions = PtySessions::new();
        let (session, _teardown) = fake_session();
        assert!(sessions
            .insert_if_absent("wt-1".to_string(), session)
            .is_ok());

        assert_eq!(replayed_screen(&sessions, "wt-1").as_deref(), Some(""));
    }

    #[test]
    fn an_unopened_session_has_no_replay_so_the_caller_spawns_a_shell() {
        let sessions = PtySessions::new();
        assert_eq!(sessions.replay("never-opened"), None);
    }

    #[test]
    fn output_recorded_against_an_unknown_session_is_dropped_not_panicked_on() {
        // The reader thread races `close`: the shell can exit (or the owner
        // can close the worktree) between a read and the record that follows.
        let sessions = PtySessions::new();
        assert_eq!(sessions.record_output("gone", b"late output"), None);
        assert_eq!(sessions.replay("gone"), None);
    }

    #[test]
    fn each_recorded_chunk_takes_the_next_position_in_the_stream() {
        let sessions = PtySessions::new();
        let (session, _teardown) = fake_session();
        assert!(sessions
            .insert_if_absent("wt-1".to_string(), session)
            .is_ok());

        assert_eq!(sessions.record_output("wt-1", b"a"), Some(0));
        assert_eq!(sessions.record_output("wt-1", b"b"), Some(1));
        assert_eq!(sessions.record_output("wt-1", b"c"), Some(2));
    }

    #[test]
    fn a_replay_stops_short_of_the_next_chunk_the_reader_will_emit() {
        // The mark a reattaching view compares against: everything below it
        // is already in the replayed screen, everything at or above it is
        // not. Off by one here and the pane shows a chunk twice.
        let sessions = PtySessions::new();
        let (session, _teardown) = fake_session();
        assert!(sessions
            .insert_if_absent("wt-1".to_string(), session)
            .is_ok());

        sessions.record_output("wt-1", b"first\r\n");
        sessions.record_output("wt-1", b"second\r\n");

        assert_eq!(
            sessions.replay("wt-1"),
            Some(("first\r\nsecond\r\n".to_string(), 2))
        );
    }

    #[test]
    fn a_session_that_has_printed_nothing_replays_from_the_start_of_its_stream() {
        let sessions = PtySessions::new();
        let (session, _teardown) = fake_session();
        assert!(sessions
            .insert_if_absent("wt-1".to_string(), session)
            .is_ok());

        assert_eq!(sessions.replay("wt-1"), Some((String::new(), 0)));
    }

    #[test]
    fn a_closed_and_reopened_session_does_not_replay_the_dead_shells_screen() {
        let sessions = PtySessions::new();
        let (first, _first_teardown) = fake_session();
        assert!(sessions.insert_if_absent("wt-1".to_string(), first).is_ok());
        sessions.record_output("wt-1", b"from the first shell");
        sessions.close("wt-1");

        let (second, _second_teardown) = fake_session();
        assert!(sessions
            .insert_if_absent("wt-1".to_string(), second)
            .is_ok());
        // The stream position restarts with the shell: a view attaching to
        // the new session must not discard its output as "already replayed".
        assert_eq!(sessions.replay("wt-1"), Some((String::new(), 0)));
    }

    #[test]
    fn a_poisoned_lock_is_recovered_not_surfaced_as_an_error() {
        let sessions = Arc::new(PtySessions::new());
        let (session, _teardown) = fake_session();
        assert!(sessions
            .insert_if_absent("wt-1".to_string(), session)
            .is_ok());

        // Poison the inner mutex by panicking while holding the lock, on
        // another thread, exactly like a panic inside a session's reader
        // thread would.
        let poisoner = Arc::clone(&sessions);
        let poisoned = std::thread::spawn(move || {
            let _guard = poisoner.lock();
            panic!("simulated panic while holding the pty session lock");
        })
        .join();
        assert!(poisoned.is_err(), "the poisoner thread must have panicked");

        // Every subsequent operation must recover the poisoned lock rather
        // than propagate the poison as an error — this is the exact bug
        // class `agent_config.rs` shipped (an OOM turned a page permanently
        // into an error screen).
        assert!(is_open(&sessions, "wt-1"));
        sessions.close("wt-1");
        assert!(!is_open(&sessions, "wt-1"));
    }
}
