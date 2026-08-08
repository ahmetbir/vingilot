//! Proof that runs: the terminal, against a real PTY, in `cargo test`
//! (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 9).
//!
//! **Why this exists instead of a screenshot.** Task 9 as written asks for live
//! proof under `just dev`. A screenshot cannot establish any of the four claims
//! below — it shows a rectangle of text, not where the shell's `getcwd` points,
//! not whether a reattach *replayed* or the shell merely printed again, not
//! whether a process was reaped or is a zombie. Worse, the E2E screenshot
//! harness stubs `invoke` with a mock bridge, so a shot taken from it proves
//! nothing about the PTY at all: a terminal that says "waiting…" has already
//! been mistaken for proof once on this project.
//!
//! So each claim is asserted against the thing itself. These tests drive
//! `super::open` — `pty_open`'s whole body — against tauri's `MockRuntime`,
//! with the real `PtySessions` registry, a real `portable_pty` master, a real
//! login shell, real tmux, and the real `vingilot://pty` event. What is not
//! covered is the one delegating line inside `#[tauri::command] pty_open`.
//!
//! **They spawn real processes, so:**
//!
//! - Every wait is bounded and fails with what it saw. There is no unbounded
//!   read here; a wrong answer must fail in seconds, never hang a suite.
//! - `LIVE` serialises them. They start shells and scan the process table;
//!   run concurrently they would count each other's children.
//! - tmux gets a socket directory of its own (`isolated_tmux_socket`). The
//!   owner runs tmux, and a test that used the default socket could attach to,
//!   resize, or kill sessions of his that have nothing to do with this app.
//! - Session ids carry this process's pid, so a re-run can never attach to a
//!   session an earlier run left behind and read its screen as this one's.
//! - Nothing here removes a directory tree. Temp directories are `TempDir`'s
//!   own `Drop`; worktrees go through `git worktree remove`.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::test::{mock_app, MockRuntime};
use tauri::{App, Listener, Manager, State};
use tempfile::TempDir;

use super::{open, pty_close, pty_write, tmux, PtySessions, PTY_OUTPUT_EVENT};

/// Section 5 — the wheel — lives in `live/wheel.rs`. Split out because this
/// file reached its 1000-line cap; a child module sees everything private
/// here, so the harness below is shared rather than duplicated.
mod wheel;

/// Section 7 — the scratch terminal — lives in `live/scratch.rs`, for the same
/// reason and on the same terms.
mod scratch;

/// A geometry wide enough that a temp-directory path prints on one line. The
/// assertions look for a path in the stream, and a pty wraps at its width.
const COLS: u16 = 200;
const ROWS: u16 = 50;

/// How long a shell gets to start and answer. Generous because it is a real
/// login shell: the owner's own `.zshrc` sources oh-my-zsh and nvm before it
/// will run anything.
const ANSWER_WITHIN: Duration = Duration::from_secs(30);

/// How long a killed shell gets to be gone from the process table.
const EXIT_WITHIN: Duration = Duration::from_secs(10);

const POLL: Duration = Duration::from_millis(20);

/// One live test at a time. See the module note.
fn live_lock() -> MutexGuard<'static, ()> {
    static LIVE: OnceLock<Mutex<()>> = OnceLock::new();
    LIVE.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// A session id no other run of these tests can collide with. `#<n>` is the
/// tab ordinal production uses, kept so these ids exercise the same shape
/// `tmux::session_name` is tested against.
fn live_id(what: &str) -> String {
    static NEXT: AtomicU32 = AtomicU32::new(1);
    format!(
        "live-{what}-{}#{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    )
}

/// Point every tmux this process starts at a socket directory of its own.
///
/// `TMUX_TMPDIR` moves the whole socket directory, so the server these tests
/// talk to is a *different server*: it cannot see the owner's sessions, and
/// the `kill-server` at the end of the persistence test cannot reach them.
/// Set once, under `live_lock`, before anything spawns.
fn isolated_tmux_socket() -> &'static Path {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let dir = std::env::temp_dir().join(format!("vingilot-live-tmux-{}", std::process::id()));
        if let Err(error) = std::fs::create_dir_all(&dir) {
            panic!(
                "could not make a tmux socket dir at {}: {error}",
                dir.display()
            );
        }
        std::env::set_var("TMUX_TMPDIR", &dir);
        dir
    })
}

/// Every tmux socket under the directory these tests own, by full path.
///
/// **The isolation has to be an argument, not an environment.** `TMUX_TMPDIR`
/// is process-wide and set from a test thread while 2300 other tests run —
/// a `set_var` beside the `getenv` every `Command::spawn` does. If that value
/// is ever lost, an unqualified `kill-server` does not fail: it finds the
/// default socket and ends the owner's own sessions, which on this machine
/// means a day's work in a terminal he is watching.
///
/// So the target comes from reading our own directory rather than from the
/// environment at call time. An empty directory yields nothing to kill, which
/// is the correct answer to "I cannot prove which socket is mine".
fn test_tmux_sockets() -> Vec<std::path::PathBuf> {
    let mut sockets = Vec::new();
    let Ok(entries) = std::fs::read_dir(isolated_tmux_socket()) else {
        return sockets;
    };
    for entry in entries.flatten() {
        let Ok(found) = std::fs::read_dir(entry.path()) else {
            continue;
        };
        sockets.extend(found.flatten().map(|socket| socket.path()));
    }
    sockets
}

/// End the tmux server these tests started, and only that one.
fn kill_test_tmux_server() {
    let socket_dir = isolated_tmux_socket();
    let Some(tmux) = tmux::path() else { return };
    // `-S <path>` names the socket file itself, so this cannot resolve to any
    // server but the one whose socket we just listed out of our own directory.
    for socket in test_tmux_sockets() {
        let _ = Command::new(tmux)
            .arg("-S")
            .arg(&socket)
            .arg("kill-server")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    // tmux does not always unlink its socket when the server ends, so the
    // named file is removed by name and the directory that held it with
    // `remove_dir` — the `rmdir` of the standard library, which refuses a
    // directory that still has anything in it. That refusal is the guardrail:
    // nothing here is recursive. The parent stays, because a live test that
    // runs after this one needs somewhere for tmux to make its socket.
    if let Ok(entries) = std::fs::read_dir(socket_dir) {
        for entry in entries.flatten() {
            if let Ok(sockets) = std::fs::read_dir(entry.path()) {
                for socket in sockets.flatten() {
                    let _ = std::fs::remove_file(socket.path());
                }
            }
            let _ = std::fs::remove_dir(entry.path());
        }
    }
}

// ---------------------------------------------------------------------------
// a real repository, and a real worktree inside it
// ---------------------------------------------------------------------------

/// A git repository with one commit, and the worktrees opened off it.
struct LiveRepo {
    dir: TempDir,
    trees: TempDir,
    opened: Vec<String>,
}

impl LiveRepo {
    fn new() -> Self {
        let repo = Self {
            dir: temp_dir(),
            trees: temp_dir(),
            opened: Vec::new(),
        };
        repo.git(&["init", "-b", "main"]);
        repo.git(&["config", "user.email", "test@vingilot.invalid"]);
        repo.git(&["config", "user.name", "Vingilot Test"]);
        repo.git(&["config", "commit.gpgsign", "false"]);
        if let Err(error) = std::fs::write(repo.dir.path().join("README.md"), "one\n") {
            panic!("could not write README.md: {error}");
        }
        repo.git(&["add", "README.md"]);
        repo.git(&["commit", "-m", "first"]);
        repo
    }

    fn path(&self) -> String {
        self.dir.path().to_string_lossy().into_owned()
    }

    /// Open a worktree through the app's own command, so what the terminal is
    /// then pointed at is a directory this app made the way the owner would.
    fn worktree(&mut self, branch: &str) -> String {
        let path = self
            .trees
            .path()
            .join(branch)
            .to_string_lossy()
            .into_owned();
        let added = tauri::async_runtime::block_on(crate::vingilot_worktree::worktree_add(
            self.path(),
            branch.to_string(),
            "main".to_string(),
            path.clone(),
        ));
        match added {
            Ok(worktree) => {
                self.opened.push(worktree.path.clone());
                resolved(&worktree.path)
            }
            Err(error) => panic!("could not open a worktree at {path}: {error:?}"),
        }
    }

    fn git(&self, args: &[&str]) {
        let ran = Command::new("git")
            .arg("-C")
            .arg(self.dir.path())
            .args(args)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .output();
        match ran {
            Ok(done) if done.status.success() => {}
            Ok(done) => panic!(
                "git {} failed: {}",
                args.join(" "),
                String::from_utf8_lossy(&done.stderr)
            ),
            Err(error) => panic!("git {} did not run: {error}", args.join(" ")),
        }
    }
}

impl Drop for LiveRepo {
    /// Through git, which is the only door this app has for a worktree. The
    /// two `TempDir`s clean themselves up after.
    fn drop(&mut self) {
        for path in std::mem::take(&mut self.opened) {
            let _ = tauri::async_runtime::block_on(crate::vingilot_worktree::worktree_remove(
                self.path(),
                path,
            ));
        }
    }
}

fn temp_dir() -> TempDir {
    match TempDir::new() {
        Ok(dir) => dir,
        Err(error) => panic!("could not create a temp dir: {error}"),
    }
}

/// macOS hands out `/var/…` for temp directories and a shell's `pwd` prints
/// `/private/var/…`; the two are the same place and only one of them is going
/// to appear in the terminal.
fn resolved(path: &str) -> String {
    std::fs::canonicalize(path)
        .map(|resolved| resolved.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.to_string())
}

// ---------------------------------------------------------------------------
// the app the commands run against
// ---------------------------------------------------------------------------

/// One chunk as it crossed `vingilot://pty` — the payload the webview parses,
/// read back off the same event by the same name.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Chunk {
    session: String,
    data: String,
    seq: u64,
    replay: bool,
}

/// A Tauri app with the PTY registry managed on it, a listener on the output
/// event, and a teardown that closes every session it opened.
struct Harness {
    app: App<MockRuntime>,
    heard: Arc<Mutex<Vec<Chunk>>>,
    opened: Mutex<Vec<String>>,
}

impl Harness {
    fn new() -> Self {
        let app = mock_app();
        app.manage(PtySessions::new());
        let heard: Arc<Mutex<Vec<Chunk>>> = Arc::default();
        let sink = Arc::clone(&heard);
        app.listen(PTY_OUTPUT_EVENT, move |event| {
            if let Ok(chunk) = serde_json::from_str::<Chunk>(event.payload()) {
                sink.lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .push(chunk);
            }
        });
        Self {
            app,
            heard,
            opened: Mutex::new(Vec::new()),
        }
    }

    fn sessions(&self) -> State<'_, PtySessions> {
        self.app.state::<PtySessions>()
    }

    fn open(&self, id: &str, cwd: &str) {
        self.open_with(id, cwd, tmux::Lifetime::Persistent);
    }

    /// A scratch shell — the terminal that must leave nothing behind.
    fn open_scratch(&self, id: &str, cwd: &str) {
        self.open_with(id, cwd, tmux::Lifetime::Ephemeral);
    }

    fn open_with(&self, id: &str, cwd: &str, lifetime: tmux::Lifetime) {
        self.opened
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(id.to_string());
        if let Err(error) = open(
            self.app.handle(),
            &self.sessions(),
            id.to_string(),
            cwd.to_string(),
            COLS,
            ROWS,
            lifetime,
        ) {
            panic!("could not open a terminal for {id} at {cwd}: {error}");
        }
    }

    fn write(&self, id: &str, line: &str) {
        if let Err(error) = pty_write(self.sessions(), id.to_string(), line.to_string()) {
            panic!("could not write to {id}: {error}");
        }
    }

    fn close(&self, id: &str) {
        let _ = pty_close(self.sessions(), id.to_string());
    }

    /// What the session's retained screen holds right now.
    fn screen(&self, id: &str) -> String {
        self.sessions()
            .replay(id)
            .map(|(screen, _)| screen)
            .unwrap_or_default()
    }

    /// Everything the pty has said on this session, in arrival order — the
    /// raw stream, not the retained screen. `screen()` is filtered
    /// (`query_filter.rs`) and is the wrong place to look for what a terminal
    /// was *told to do*; mode sets live here.
    fn stream(&self, id: &str) -> String {
        self.heard
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .filter(|chunk| !chunk.replay && chunk.session == id)
            .map(|chunk| chunk.data.as_str())
            .collect()
    }

    /// The replay chunks a view attaching to `id` was handed, oldest first.
    fn replays(&self, id: &str) -> Vec<Chunk> {
        self.heard
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .filter(|chunk| chunk.replay && chunk.session == id)
            .cloned()
            .collect()
    }

    /// Wait until the session's screen contains `needle`, or fail saying what
    /// it did hold. Bounded — a wrong answer must fail, never hang.
    fn wait_for(&self, id: &str, needle: &str) -> String {
        let deadline = Instant::now() + ANSWER_WITHIN;
        loop {
            let screen = self.screen(id);
            if screen.contains(needle) {
                return screen;
            }
            if Instant::now() >= deadline {
                panic!(
                    "{id} never printed {needle:?} within {ANSWER_WITHIN:?}. Its screen ends: {}",
                    tail(&screen)
                );
            }
            std::thread::sleep(POLL);
        }
    }

    /// Wait for the session to print something and then go quiet.
    ///
    /// **Input written before a terminal is ready is discarded, not queued.**
    /// tmux puts its tty into raw mode with `TCSAFLUSH` when it attaches, and
    /// that flag throws away whatever is already sitting in the input queue;
    /// a shell starting under it does the same. So a command written the
    /// instant `open` returns can vanish without a trace, which is what this
    /// waits out. Best effort by design — `ask` retries, so an unusually noisy
    /// prompt costs a second attempt rather than a failure.
    fn settle(&self, id: &str) {
        let deadline = Instant::now() + ANSWER_WITHIN;
        let mut last = self.screen(id);
        let mut unchanged_since = Instant::now();
        while Instant::now() < deadline {
            std::thread::sleep(POLL);
            let now = self.screen(id);
            if now != last {
                last = now;
                unchanged_since = Instant::now();
                continue;
            }
            if !last.is_empty() && unchanged_since.elapsed() >= Duration::from_millis(400) {
                return;
            }
        }
    }

    /// Run a command in the session and wait for its answer, re-sending it if
    /// the terminal was not listening yet. `echo`/`pwd` are the only commands
    /// these tests send, so a second send costs nothing but a second line.
    fn ask(&self, id: &str, line: &str, needle: &str) -> String {
        self.settle(id);
        let deadline = Instant::now() + ANSWER_WITHIN;
        loop {
            self.write(id, line);
            let attempt = Instant::now() + Duration::from_secs(5);
            loop {
                let screen = self.screen(id);
                if screen.contains(needle) {
                    return screen;
                }
                if Instant::now() >= attempt {
                    break;
                }
                std::thread::sleep(POLL);
            }
            if Instant::now() >= deadline {
                panic!(
                    "{id} never printed {needle:?} within {ANSWER_WITHIN:?}. Its screen ends: {}",
                    tail(&self.screen(id))
                );
            }
        }
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        let opened = std::mem::take(
            &mut *self
                .opened
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        );
        for id in opened {
            let _ = pty_close(self.sessions(), id);
        }
    }
}

/// The end of a screen, for a failure message. Whole, it is up to 256 KiB of
/// escape sequences.
fn tail(screen: &str) -> String {
    let from = screen.len().saturating_sub(400);
    screen[screen
        .char_indices()
        .find(|(at, _)| *at >= from)
        .map_or(0, |(at, _)| at)..]
        .to_string()
}

/// A command whose *output* is `marker`, where the command line itself is not.
///
/// The shell echoes what it is sent, so `echo MARKER` puts MARKER on the
/// screen whether or not the shell ever ran it. Splitting the marker with an
/// empty quoted string means only the run can produce it: what is typed is
/// `echo VING""ILOT…`, what is printed is `VINGILOT…`.
fn prints(marker: &str) -> String {
    let (head, tail) = marker.split_at(4);
    format!("echo {head}\"\"{tail}\n")
}

/// Which of these pids are still children of this process — running or
/// zombie. A reaped child is gone from the table entirely; an unreaped one is
/// still there with our pid as its parent, which is the leak being looked for.
fn still_our_children(pids: &[u32]) -> Vec<u32> {
    if pids.is_empty() {
        return Vec::new();
    }
    let me = std::process::id().to_string();
    let list = pids
        .iter()
        .map(|pid| pid.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let ran = Command::new("/bin/ps")
        .args(["-o", "pid=,ppid=", "-p", &list])
        .stdin(Stdio::null())
        .output();
    let Ok(ran) = ran else { return Vec::new() };
    String::from_utf8_lossy(&ran.stdout)
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let pid = fields.next()?.parse::<u32>().ok()?;
            (fields.next()? == me).then_some(pid)
        })
        .collect()
}

// ---------------------------------------------------------------------------
// 1. the cwd is real
// ---------------------------------------------------------------------------

#[test]
fn the_shell_runs_in_the_worktree_the_terminal_was_opened_on() {
    let _live = live_lock();
    isolated_tmux_socket();

    let mut repo = LiveRepo::new();
    let worktree = repo.worktree("fix");
    let harness = Harness::new();
    let id = live_id("cwd");

    harness.open(&id, &worktree);
    // `$(pwd)` is the shell's own answer, from the shell's own process. The
    // typed line contains neither the marker nor the path, so a match is the
    // command having run in that directory and nothing else.
    harness.ask(
        &id,
        "echo VING\"\"ILOT_CWD_IS $(pwd)\n",
        &format!("VINGILOT_CWD_IS {worktree}"),
    );
    harness.close(&id);
}

// ---------------------------------------------------------------------------
// 2. reattaching replays what the view missed
// ---------------------------------------------------------------------------

#[test]
fn a_view_attaching_to_a_live_session_is_handed_the_screen_it_missed() {
    let _live = live_lock();
    isolated_tmux_socket();

    let mut repo = LiveRepo::new();
    let worktree = repo.worktree("replay");
    let harness = Harness::new();
    let id = live_id("replay");
    let marker = format!("VINGILOT-REPLAY-{}", std::process::id());

    harness.open(&id, &worktree);
    harness.ask(&id, &prints(&marker), &marker);

    // The view goes away without the session going away — a remount, a tab
    // switch, leaving the project and coming back. Nothing is closed here;
    // that is what makes the next open a *reattach*.
    let before = harness.replays(&id).len();
    harness.open(&id, &worktree);

    let replays = harness.replays(&id);
    assert_eq!(
        replays.len(),
        before + 1,
        "a reattach must emit exactly one replay, or the view has no mark to filter on"
    );
    let Some(replay) = replays.last() else {
        panic!("no replay was emitted for {id}");
    };
    assert!(
        replay.data.contains(&marker),
        "the reattaching view was handed a screen without {marker} in it: {}",
        tail(&replay.data)
    );
    assert!(
        replay.seq > 0,
        "the replay's mark must be past the chunks it contains, got {}",
        replay.seq
    );
    // And no second shell: the first open's mark was 0, this one's is not, so
    // both views are reading one stream.
    assert!(replays.first().is_some_and(|first| first.seq == 0));

    harness.close(&id);
}

// ---------------------------------------------------------------------------
// 3. a tmux-backed session outlives the app that started it
// ---------------------------------------------------------------------------

#[test]
fn a_tmux_session_survives_the_client_that_was_attached_to_it() {
    let _live = live_lock();
    isolated_tmux_socket();

    if tmux::path().is_none() {
        // Not a pass: this machine cannot answer the question. The fallback
        // (a shell as this app's child) makes no persistence claim, and the
        // status bar says so — `terminalPersistence.ts`.
        eprintln!(
            "SKIPPED a_tmux_session_survives_the_client_that_was_attached_to_it: \
             no tmux on this machine, so there is no persistence to prove."
        );
        return;
    }

    let mut repo = LiveRepo::new();
    let worktree = repo.worktree("persist");
    let harness = Harness::new();
    let id = live_id("persist");
    let marker = format!("VINGILOT-PERSIST-{}", std::process::id());

    harness.open(&id, &worktree);
    harness.ask(&id, &prints(&marker), &marker);

    // Quitting the app: every pty child dies with the process, and nothing
    // ends the tmux session — `pty_close` would, which is why it is not what
    // is called here. `sessions.close` is exactly what the app's teardown
    // does: kill the client, reap it, forget the session.
    harness.sessions().close(&id);
    assert_eq!(
        harness.sessions().replay(&id),
        None,
        "the registry must have forgotten the session, as it would after a quit"
    );

    // Relaunch: same id, so `tmux new-session -A` attaches to the session that
    // is still there rather than starting a second shell, and tmux redraws the
    // screen it kept.
    harness.open(&id, &worktree);
    let screen = harness.wait_for(&id, &marker);
    assert!(
        screen.contains(&marker),
        "the reattached pane did not hold what the first client left: {}",
        tail(&screen)
    );

    // This is the door that *does* end a tmux session: the worktree is gone
    // from the workspace, so nothing will ever reattach.
    harness.close(&id);
    kill_test_tmux_server();
}

// ---------------------------------------------------------------------------
// 4. our sessions draw no status bar, and nobody else's session changes
// ---------------------------------------------------------------------------

/// A tmux session started the way the owner starts one: by hand, with no part
/// of this app involved. Ends itself, by exact name, on the socket these tests
/// own.
struct OutsiderSession {
    name: String,
}

impl OutsiderSession {
    fn new(name: String) -> Self {
        tmux_says(&["new-session", "-d", "-s", &name, "-c", "/tmp"]);
        Self { name }
    }

    fn target(&self) -> String {
        format!("={}:", self.name)
    }
}

impl Drop for OutsiderSession {
    fn drop(&mut self) {
        // Anchored, on the isolated socket, against a session this test made.
        tmux_says(&["kill-session", "-t", &self.target()]);
    }
}

/// Ask the tmux these tests own something, and answer with what it said.
/// Panics only on a tmux that could not be run at all — a command that
/// refuses is reported as its stderr, which is what the assertions read.
fn tmux_says(args: &[&str]) -> String {
    let Some(tmux) = tmux::path() else {
        return String::new();
    };
    // Addressed by socket path for the same reason `kill_test_tmux_server` is:
    // these arguments include `kill-session`, so a query helper that resolved
    // to the default socket would reach the owner's sessions. No socket of
    // ours means no server of ours, and nothing to say about it.
    let Some(socket) = test_tmux_sockets().into_iter().next() else {
        return String::new();
    };
    match Command::new(tmux)
        .arg("-S")
        .arg(&socket)
        .args(args)
        .stdin(Stdio::null())
        .output()
    {
        Ok(done) if done.status.success() => {
            String::from_utf8_lossy(&done.stdout).trim().to_string()
        }
        Ok(done) => String::from_utf8_lossy(&done.stderr).trim().to_string(),
        Err(error) => panic!("tmux {} did not run: {error}", args.join(" ")),
    }
}

#[test]
fn our_sessions_draw_no_status_bar_and_the_owners_sessions_are_untouched() {
    let _live = live_lock();
    isolated_tmux_socket();

    if tmux::path().is_none() {
        eprintln!(
            "SKIPPED our_sessions_draw_no_status_bar_and_the_owners_sessions_are_untouched: \
             no tmux on this machine, so there is no status bar to turn off."
        );
        return;
    }

    let mut repo = LiveRepo::new();
    let worktree = repo.worktree("status");
    let harness = Harness::new();
    let id = live_id("status");

    harness.open(&id, &worktree);
    harness.settle(&id);

    // Started by hand on the same server, after ours, so it cannot have
    // inherited anything from a state that predates this app's spawn.
    let outsider = OutsiderSession::new(format!("outsider-{}", std::process::id()));

    // `#{status}` is the value that is actually in force for a session, not
    // the one it was configured with — which is what the owner sees.
    let ours = tmux_says(&[
        "display-message",
        "-p",
        "-t",
        &format!("={}:", tmux::session_name(&id)),
        "#{status}",
    ]);
    assert_eq!(
        ours, "off",
        "our own session still draws a second status bar"
    );

    let theirs = tmux_says(&[
        "display-message",
        "-p",
        "-t",
        &outsider.target(),
        "#{status}",
    ]);
    assert_eq!(
        theirs, "on",
        "a session this app did not create lost its status bar"
    );

    // And the server's own default, which is what every session the owner
    // starts from now on will inherit.
    assert_eq!(
        tmux_says(&["show-options", "-g", "status"]),
        "status on",
        "the server-wide default was changed, so every future session inherits it"
    );

    drop(outsider);
    harness.close(&id);
    kill_test_tmux_server();
}

// ---------------------------------------------------------------------------
// 6. no orphan shells
// ---------------------------------------------------------------------------

#[test]
fn closing_a_terminal_leaves_no_shell_behind_and_no_zombie() {
    let _live = live_lock();
    isolated_tmux_socket();

    let mut repo = LiveRepo::new();
    let worktree = repo.worktree("orphans");
    let harness = Harness::new();

    // Four tabs of one worktree, which is what the strip is for.
    let ids: Vec<String> = (0..4).map(|_| live_id("orphan")).collect();
    let mut pids = Vec::new();
    for id in &ids {
        harness.open(id, &worktree);
        match harness.sessions().child_pid(id) {
            Some(pid) => pids.push(pid),
            None => panic!("{id} opened without a process behind it"),
        }
    }
    assert_eq!(pids.len(), 4);
    assert_eq!(
        still_our_children(&pids).len(),
        4,
        "the four shells must be running before there is anything to leak"
    );

    for id in &ids {
        harness.close(id);
    }

    // A kill without a reap leaves a zombie for as long as the app runs — one
    // per terminal the owner ever closed — and a zombie is still a child, so
    // this catches it.
    let deadline = Instant::now() + EXIT_WITHIN;
    loop {
        let surviving = still_our_children(&pids);
        if surviving.is_empty() {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "{} shell(s) outlived the terminal that started them: {surviving:?}",
            surviving.len()
        );
        std::thread::sleep(POLL);
    }
}
