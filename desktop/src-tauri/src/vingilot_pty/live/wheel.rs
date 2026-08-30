//! 5. the wheel: what tmux asks for, and what it answers to.
//!
//! A submodule of `live` rather than a section of it, because `live.rs` was at
//! its 1000-line cap and a file at its cap may not grow. Everything the parent
//! set up is in scope through `use super::*`: the same isolated socket, the
//! same one-at-a-time `live_lock`, and the same harness that drives the app's
//! own `pty_open` against a real tmux.

use super::*;

// ---------------------------------------------------------------------------
// 5. the wheel: what tmux asks for, and what it answers to
// ---------------------------------------------------------------------------

/// The mode sets that decide whether a wheel is reported at all, and how.
///
/// `1000`/`1002` are "report button events" and "report button events plus
/// drag"; `1006` is the SGR encoding. A terminal emulator that never sees
/// `1006` encodes its reports the old way, and xterm.js sends *those* on a
/// different channel (`onBinary`) than the SGR ones (`onData`) — so which of
/// these tmux sends is not a detail, it decides which wire the report is on.
const MOUSE_MODE_SETS: [&str; 3] = ["\x1b[?1000h", "\x1b[?1002h", "\x1b[?1006h"];

/// A wheel-up over row 11, column 11, encoded the way xterm.js encodes it once
/// `1006` is on: `CSI < 64 ; col ; row M`. Byte-identical to what the browser
/// harness observes leaving xterm
/// (desktop/tests/e2e/terminal-wheel.spec.ts).
const SGR_WHEEL_UP: &str = "\x1b[<64;11;11M";

/// The same report for the other direction — button 65 rather than 64. This is
/// the way *out* of what a wheel-up starts, which is why it is here.
const SGR_WHEEL_DOWN: &str = "\x1b[<65;11;11M";

/// What xterm.js sends *instead* when no mouse protocol is active and the
/// screen it is showing has no scrollback of its own: cursor-up, once per line
/// (browser/Terminal.ts). Here to prove that this is not a substitute — it is
/// what the shell reads as history navigation.
const ARROW_UP: &str = "\x1b[A";

/// Ask tmux about our own session, by exact name on the isolated socket.
fn ours_says(id: &str, format: &str) -> String {
    tmux_says(&[
        "display-message",
        "-p",
        "-t",
        &format!("={}:", tmux::session_name(id)),
        format,
    ])
}

/// The value actually in force for one of our sessions, inherited options
/// included (`-A`). `#{mouse}` is *not* this — it is a mouse-event format that
/// answers `1` whatever the option says — and plain `show-options` answers with
/// nothing at all when the option was never set on the session itself.
fn ours_option(id: &str, option: &str) -> String {
    tmux_says(&[
        "show-options",
        "-A",
        "-v",
        "-t",
        &format!("={}:", tmux::session_name(id)),
        option,
    ])
}

/// Wait for `#{pane_in_mode}` to become `1`. tmux enters copy-mode when it
/// accepts a wheel-up over a pane with history, so this is the pane saying it
/// scrolled — not a screenshot of text that may or may not have moved.
fn scrolled_within(id: &str, limit: Duration) -> bool {
    let deadline = Instant::now() + limit;
    loop {
        if ours_says(id, "#{pane_in_mode}") == "1" {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(POLL);
    }
}

#[test]
fn a_wheel_report_is_what_makes_tmux_scroll_and_an_arrow_key_is_not() {
    let _live = live_lock();
    isolated_tmux_socket();

    if tmux::path().is_none() {
        eprintln!(
            "SKIPPED a_wheel_report_is_what_makes_tmux_scroll_and_an_arrow_key_is_not: \
             no tmux on this machine, so there is no scrollback to reach."
        );
        return;
    }

    let mut repo = LiveRepo::new();
    let worktree = repo.worktree("wheel");
    let harness = Harness::new();
    let id = live_id("wheel");
    let marker = format!("VINGILOT-WHEEL-{}", std::process::id());

    harness.open(&id, &worktree);

    // Half of the answer: what the spawn actually asks the terminal for. The
    // browser harness replays these bytes verbatim, so if tmux ever stops
    // sending one of them, that harness is testing a fiction — and this is
    // where it fails.
    harness.settle(&id);
    let attach = harness.stream(&id);
    for mode in MOUSE_MODE_SETS {
        assert!(
            attach.contains(mode),
            "the spawn never asked for {}, so the wheel is never reported: {}",
            mode.escape_debug(),
            tail(&attach).escape_debug()
        );
    }

    // Something to scroll *back* to. A pane whose history is empty has nothing
    // to show above the screen, and tmux answers a wheel there by doing
    // nothing at all — which would make either outcome below look the same.
    harness.ask(
        &id,
        &format!("for i in $(seq 1 200); do echo {marker}-$i; done\n"),
        &format!("{marker}-200"),
    );

    // The other half: an arrow key is not a smaller wheel. It reaches the
    // shell as history navigation and the pane never enters copy-mode.
    harness.write(&id, ARROW_UP);
    assert!(
        !scrolled_within(&id, Duration::from_secs(2)),
        "an arrow key put the pane in copy-mode, which is not what tmux does with one"
    );

    harness.write(&id, SGR_WHEEL_UP);
    assert!(
        scrolled_within(&id, EXIT_WITHIN),
        "tmux ignored a wheel report the terminal is configured to send: \
         mouse={}, pane_in_mode={}",
        ours_option(&id, "mouse"),
        ours_says(&id, "#{pane_in_mode}")
    );

    // What scrolling *is* here, and the way back out of it. A wheel-up puts the
    // pane in copy-mode: the view moves back through tmux's history and the
    // shell below it is not listening until the mode ends. So the exit matters
    // more than the entry — a terminal that enters a mode the owner cannot
    // leave is worse than one that never scrolls. Both doors are proved rather
    // than assumed: wheeling back down to the bottom leaves on its own (tmux's
    // default binding enters with `copy-mode -e`), and `q` leaves at once from
    // anywhere in the history.
    for _ in 0..40 {
        if ours_says(&id, "#{pane_in_mode}") == "0" {
            break;
        }
        harness.write(&id, SGR_WHEEL_DOWN);
        std::thread::sleep(POLL);
    }
    assert_eq!(
        ours_says(&id, "#{pane_in_mode}"),
        "0",
        "wheeling back down to the bottom never left copy-mode"
    );

    harness.write(&id, SGR_WHEEL_UP);
    assert!(
        scrolled_within(&id, EXIT_WITHIN),
        "the pane would not re-enter copy-mode, so the way out of it is untested"
    );
    harness.write(&id, "q");
    let deadline = Instant::now() + EXIT_WITHIN;
    while ours_says(&id, "#{pane_in_mode}") != "0" {
        assert!(
            Instant::now() < deadline,
            "q did not leave copy-mode, so the owner has no key out of it"
        );
        std::thread::sleep(POLL);
    }

    harness.close(&id);
    kill_test_tmux_server();
}

/// A tmux session that was on the server before this app ever ran, with the
/// wheel explicitly off.
///
/// `mouse` is a *session* option, so a session created by an earlier build of
/// this app — or by the owner, by hand — does not acquire it because a later
/// build wants it to. Set to `off` here rather than left at the server's
/// default, because that default is whatever the machine's `tmux.conf` says
/// (the owner's says `on`): a test that inherited it would pass without the
/// attach having done anything at all.
fn session_left_behind_with_the_wheel_off(id: &str, cwd: &str) {
    let name = tmux::session_name(id);
    tmux_says(&["new-session", "-d", "-s", &name, "-c", cwd]);
    tmux_says(&["set-option", "-t", &format!("={name}:"), "mouse", "off"]);
}

#[test]
fn a_session_that_predates_this_app_gets_the_wheel_when_a_terminal_attaches() {
    let _live = live_lock();
    isolated_tmux_socket();

    if tmux::path().is_none() {
        eprintln!(
            "SKIPPED a_session_that_predates_this_app_gets_the_wheel_when_a_terminal_attaches: \
             no tmux on this machine, so there is no session to leave behind."
        );
        return;
    }

    let mut repo = LiveRepo::new();
    let worktree = repo.worktree("predates");
    let harness = Harness::new();
    let id = live_id("predates");
    let marker = format!("VINGILOT-PREDATES-{}", std::process::id());

    // The case the owner is actually in: the shells he has open right now were
    // started by a build that never set this option.
    session_left_behind_with_the_wheel_off(&id, &worktree);
    assert_eq!(
        ours_option(&id, "mouse"),
        "off",
        "the session under test did not start with the wheel off, so it proves nothing"
    );

    // `plan_spawn`'s `new-session -A` attaches to it rather than creating a
    // second one, and the `set-option`s chained after it run on every spawn,
    // not only on creation. That is what has to reach a session this app did
    // not start.
    harness.open(&id, &worktree);
    harness.settle(&id);
    assert_eq!(
        ours_option(&id, "mouse"),
        "on",
        "attaching left the wheel off, so every shell the owner already had stays unscrollable"
    );

    harness.ask(
        &id,
        &format!("for i in $(seq 1 200); do echo {marker}-$i; done\n"),
        &format!("{marker}-200"),
    );
    harness.write(&id, SGR_WHEEL_UP);
    assert!(
        scrolled_within(&id, EXIT_WITHIN),
        "a session that predates this app took the wheel report and did not scroll"
    );

    harness.close(&id);
    kill_test_tmux_server();
}

#[test]
fn the_apps_own_copy_mode_query_and_cancel_are_what_the_button_claims() {
    // The "back to live" affordance (`ui/Terminal.tsx`) is built on two
    // commands: `pty_copy_mode`, which asks whether the pane is in copy-mode,
    // and `pty_copy_mode_exit`, which leaves it. This proves both against a
    // real tmux — the query answers false on a live screen, true once a wheel
    // has scrolled the pane, and the cancel puts it back — and proves the
    // cancel is harmless against a pane that is not in copy-mode, because the
    // button can race the owner wheeling back down on his own.
    let _live = live_lock();
    isolated_tmux_socket();

    if tmux::path().is_none() {
        eprintln!(
            "SKIPPED the_apps_own_copy_mode_query_and_cancel_are_what_the_button_claims: \
             no tmux on this machine, so there is no copy-mode to leave."
        );
        return;
    }

    let mut repo = LiveRepo::new();
    let worktree = repo.worktree("copymode");
    let harness = Harness::new();
    let id = live_id("copymode");
    let marker = format!("VINGILOT-COPYMODE-{}", std::process::id());

    harness.open(&id, &worktree);
    harness.settle(&id);
    harness.ask(
        &id,
        &format!("for i in $(seq 1 200); do echo {marker}-$i; done\n"),
        &format!("{marker}-200"),
    );

    // A pane at the live screen: the query must say so, and the cancel must
    // be a no-op rather than a typed key the shell can read.
    assert!(
        !copy_mode::pane_in_mode(&id),
        "the query claims copy-mode before anything scrolled"
    );
    copy_mode::exit_copy_mode(&id);
    assert!(
        !copy_mode::pane_in_mode(&id),
        "a cancel against a live pane changed its mode"
    );

    // A wheel-up scrolls the pane into copy-mode — the state the affordance
    // exists for — and the app's query is what has to notice.
    harness.write(&id, SGR_WHEEL_UP);
    let deadline = Instant::now() + EXIT_WITHIN;
    while !copy_mode::pane_in_mode(&id) {
        assert!(
            Instant::now() < deadline,
            "the app's own query never saw the copy-mode a wheel-up starts: \
             pane_in_mode={}",
            ours_says(&id, "#{pane_in_mode}")
        );
        std::thread::sleep(POLL);
    }

    // And the app's cancel is the way back — the same act as the `q` the
    // owner would otherwise have had to know.
    copy_mode::exit_copy_mode(&id);
    let deadline = Instant::now() + EXIT_WITHIN;
    while copy_mode::pane_in_mode(&id) {
        assert!(
            Instant::now() < deadline,
            "the app's cancel did not leave copy-mode"
        );
        std::thread::sleep(POLL);
    }

    harness.close(&id);
    kill_test_tmux_server();
}
