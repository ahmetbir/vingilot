//! 7. the scratch terminal: a shell that leaves nothing behind.
//!
//! A submodule of `live` rather than a section of it, because `live.rs` is at
//! its 1000-line cap and a file at its cap may not grow. Everything the parent
//! set up is in scope through `use super::*`: the same isolated socket, the
//! same one-at-a-time `live_lock`, and the same harness that drives the app's
//! own `pty_open` against a real tmux.
//!
//! **What is actually being proved.** That the scratch terminal creates no
//! tmux session is not a claim about cleanup — nothing here closes anything
//! before looking — it is a claim about what was *started*. So the test opens
//! two shells in one worktree at the same time, on the same tmux, and asks
//! tmux itself which of them it is holding. The persistent one is the control:
//! without it, "no session named that" would also be the answer on a machine
//! where the listing silently failed, where tmux was never reached, or where
//! the derivation of a session's name had changed under the assertion.

use super::*;

/// What a pid is actually running, or an empty string when it is gone.
///
/// The second half of the proof, and the half a session listing cannot give:
/// under tmux the pty's child is a tmux *client*, and the shell itself belongs
/// to a server this app did not start and does not own. A scratch shell has to
/// be the other thing — this app's own child, which is what makes "dies with
/// the app" true by construction rather than by teardown.
fn command_of(pid: u32) -> String {
    let ran = Command::new("/bin/ps")
        .args(["-o", "comm=", "-p", &pid.to_string()])
        .stdin(Stdio::null())
        .output();
    match ran {
        Ok(done) => String::from_utf8_lossy(&done.stdout).trim().to_string(),
        Err(_) => String::new(),
    }
}

/// Every session name the tmux these tests own is currently holding.
fn live_session_names() -> Vec<String> {
    tmux_says(&["list-sessions", "-F", "#{session_name}"])
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect()
}

#[test]
fn a_scratch_shell_leaves_no_tmux_session_behind() {
    let _live = live_lock();
    isolated_tmux_socket();

    if tmux::path().is_none() {
        // Not a pass: with no tmux on the machine every shell is already a
        // child of this app, so the question this test asks cannot be put.
        eprintln!(
            "SKIPPED a_scratch_shell_leaves_no_tmux_session_behind: \
             no tmux on this machine, so there is no session to avoid taking."
        );
        return;
    }

    let mut repo = LiveRepo::new();
    let worktree = repo.worktree("scratch");
    let harness = Harness::new();

    // The control and the subject, in one worktree, on one tmux server, at the
    // same time. Same code path but for `Lifetime`.
    let tab = live_id("scratch-tab");
    let scratch = live_id("scratch-shell");
    let tab_marker = format!("VINGILOT-TAB-{}", std::process::id());
    let scratch_marker = format!("VINGILOT-SCRATCH-{}", std::process::id());

    harness.open(&tab, &worktree);
    harness.ask(&tab, &prints(&tab_marker), &tab_marker);
    harness.open_scratch(&scratch, &worktree);
    harness.ask(&scratch, &prints(&scratch_marker), &scratch_marker);

    // Both shells are live and answering *now* — nothing has been closed, so
    // an absent session cannot be an already-cleaned-up one.
    let names = live_session_names();
    let tab_name = tmux::session_name(&tab);
    let scratch_name = tmux::session_name(&scratch);
    assert!(
        names.iter().any(|name| name == &tab_name),
        "the control never appeared in tmux, so this listing proves nothing about the scratch. \
         tmux is holding: {names:?}"
    );
    assert!(
        !names.iter().any(|name| name == &scratch_name),
        "the scratch terminal took a tmux session ({scratch_name}), which would outlive it. \
         tmux is holding: {names:?}"
    );

    // And nothing else of ours crept in either: a scratch shell must not be
    // reachable under any name, not merely under the one derived from its id.
    let ours: Vec<&String> = names
        .iter()
        .filter(|name| name.starts_with("vingilot_"))
        .collect();
    assert_eq!(
        ours,
        vec![&tab_name],
        "a session this app created that is not the control"
    );

    // The other half: what each pty is really running. The tab's child is a
    // tmux client (the shell is the server's); the scratch's child is the
    // shell itself, which is why quitting this app ends it.
    let Some(tab_pid) = harness.sessions().child_pid(&tab) else {
        panic!("the control opened without a process behind it");
    };
    let Some(scratch_pid) = harness.sessions().child_pid(&scratch) else {
        panic!("the scratch opened without a process behind it");
    };
    assert!(
        command_of(tab_pid).contains("tmux"),
        "the control's pty child is not a tmux client, so the comparison below means nothing: {}",
        command_of(tab_pid)
    );
    assert!(
        !command_of(scratch_pid).contains("tmux"),
        "the scratch's pty child is a tmux client, so its shell belongs to a server this app does not own: {}",
        command_of(scratch_pid)
    );

    harness.close(&scratch);
    harness.close(&tab);
    kill_test_tmux_server();
}

#[test]
fn closing_a_scratch_shell_leaves_no_process_and_no_zombie() {
    let _live = live_lock();
    isolated_tmux_socket();

    let mut repo = LiveRepo::new();
    let worktree = repo.worktree("scratch-exit");
    let harness = Harness::new();
    let id = live_id("scratch-exit");

    harness.open_scratch(&id, &worktree);
    let Some(pid) = harness.sessions().child_pid(&id) else {
        panic!("{id} opened without a process behind it");
    };
    assert_eq!(
        still_our_children(&[pid]).len(),
        1,
        "the scratch shell must be running before there is anything to leak"
    );

    harness.close(&id);

    // A kill without a reap leaves a zombie for as long as the app runs, and a
    // zombie is still a child — so this catches "closing it ends it" being
    // half-true.
    let deadline = Instant::now() + EXIT_WITHIN;
    loop {
        let surviving = still_our_children(&[pid]);
        if surviving.is_empty() {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the scratch shell outlived the terminal that started it: {surviving:?}"
        );
        std::thread::sleep(POLL);
    }
}
