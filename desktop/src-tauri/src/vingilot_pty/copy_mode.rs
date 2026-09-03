//! tmux copy-mode, asked about and left — the backend half of the P2 scroll
//! fix (2026-08-29 redesign, decision 4; vingilot/seams/redesign-p2.yaml).
//!
//! Its own module rather than a section of `tmux.rs`: that file is close
//! enough to the repository's 1000-line ratchet (≈920 lines) that growing it
//! here spends headroom upstream merges will need — the house rule is split,
//! never raise, and splitting early is cheaper. Everything here builds its
//! targets through `tmux::exact_target`, so the anchoring argument that file
//! makes (a `-t` that only an exactly-named session can satisfy) holds for
//! these commands by construction, and `live/wheel.rs` proves both halves
//! against a real tmux 3.6a.

use std::process::{Command, Stdio};

use super::tmux::{exact_target, path};

/// Ask whether one session's active pane is sitting in a mode — copy-mode,
/// in practice, which is where a wheel-up puts it (`mouse_on_args`).
///
/// **Why the app needs to know.** Copy-mode is how tmux scrollback is read,
/// and the two tested ways out are wheeling back to the bottom and `q`. A
/// printable key typed while scrolled up is *not* a way out — stock tmux
/// swallows it as a copy-mode command — and to an owner who does not know
/// tmux internals, "I scrolled up, then typed and nothing happened" reads as
/// "scroll doesn't work". The UI answers with the same jump-to-bottom
/// affordance the non-tmux path already has (`terminalScrollback.ts`), and
/// this query is what makes that affordance honest: it appears when the pane
/// really is in copy-mode and only then.
///
/// The full argument list, separate from the run, so a test can assert what
/// tmux is handed: an anchored target (`exact_target`) so the question can
/// only ever be asked of the one session named, `-p` to print rather than
/// display, and tmux's own `#{pane_in_mode}` format variable as the question.
pub(crate) fn pane_mode_args(session_id: &str) -> [String; 5] {
    [
        "display-message".to_string(),
        "-p".to_string(),
        "-t".to_string(),
        exact_target(session_id),
        "#{pane_in_mode}".to_string(),
    ]
}

/// True while the session's active pane is in a mode.
///
/// Every failure answers `false`: no tmux on this machine, no server, no
/// session by that exact name (the ordinary answer for a shell that runs
/// outside tmux — the scratch, every session on a tmux-less machine), or a
/// refusal. `false` means the affordance built on this simply does not
/// appear, which is the state it was in before this existed — the safe
/// direction for this particular silence.
pub(crate) fn pane_in_mode(session_id: &str) -> bool {
    let Some(tmux) = path() else {
        return false;
    };
    let Ok(output) = Command::new(tmux)
        .args(pane_mode_args(session_id))
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
    else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    String::from_utf8_lossy(&output.stdout).trim() == "1"
}

/// Ask whether this session's pane holds a full-screen program that grabbed the
/// mouse and does not scroll on it.
///
/// **Measured against the real case.** With Claude Code running under tmux,
/// `alternate_on` is 1 and `mouse_any_flag` is 1. The alternate screen has no
/// tmux history to scroll, and because the program asked for mouse reporting
/// the wheel is delivered to it — where nothing happens:
///
/// > *"Claude code ile calisirken bi sure sonra Claude code da scroll
/// > yeteneğimi kaybediyorum. Sessioni kapatıp acmam gerekiyor."*
///
/// Ending the session leaves the alternate screen, which is why restarting
/// looked like a fix.
///
/// **Why this has to be asked of tmux.** The webview cannot tell: under tmux
/// EVERY pane is on the alternate screen as far as xterm is concerned, because
/// the attach itself sends `1049` and the mouse modes (that is verbatim what
/// `tests/e2e/tmux-attach-mouse-on.json` captured). Only tmux knows whether the
/// program INSIDE the pane is the one holding them.
///
/// Same exact-target scoping as every other query here: the server is shared
/// with sessions the owner started by hand, and this asks about ours.
pub(crate) fn pane_args_wheel_needs_arrows(session_id: &str) -> [String; 5] {
    [
        "display-message".to_string(),
        "-p".to_string(),
        "-t".to_string(),
        exact_target(session_id),
        "#{&&:#{alternate_on},#{mouse_any_flag}}".to_string(),
    ]
}

/// True while a wheel over this session's pane would otherwise go nowhere.
///
/// Every failure answers `false` for `pane_in_mode`'s reasons, and one more of
/// its own: a wrong `true` would send arrow keys to a program that wanted a
/// mouse report, which is worse than a wheel that does nothing.
pub(crate) fn wheel_needs_arrows(session_id: &str) -> bool {
    let Some(tmux) = path() else {
        return false;
    };
    let Ok(output) = Command::new(tmux)
        .args(pane_args_wheel_needs_arrows(session_id))
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
    else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    String::from_utf8_lossy(&output.stdout).trim() == "1"
}

/// The argument list for leaving copy-mode in one session, and no other.
///
/// `send-keys -X cancel` runs copy-mode's own cancel command — the same act
/// as the `q` the owner would have had to know — and puts the view back on
/// the live screen. Against a pane that is not in a mode, tmux refuses with
/// "not in a mode", which the runner below deliberately ignores: the button
/// this backs can race the owner wheeling back to the bottom on his own, and
/// losing that race must cost nothing.
pub(crate) fn copy_mode_exit_args(session_id: &str) -> [String; 5] {
    [
        "send-keys".to_string(),
        "-t".to_string(),
        exact_target(session_id),
        "-X".to_string(),
        "cancel".to_string(),
    ]
}

/// Leave copy-mode in one session. Every outcome is fine: not in a mode, no
/// such session, no tmux — all mean there is nothing to leave.
pub(crate) fn exit_copy_mode(session_id: &str) {
    let Some(tmux) = path() else {
        return;
    };
    let _ = Command::new(tmux)
        .args(copy_mode_exit_args(session_id))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(test)]
mod tests {

    #[test]
    fn the_wheel_question_is_asked_of_our_session_and_no_other() {
        // Same guard as every other query here, and it is the reason this lives
        // in tmux rather than in a key binding: `bind-key` has no per-session
        // table, so the first attempt at this fix was server-wide and
        // `tmux.rs`'s own `nothing_this_app_runs_can_reach_a_session_it_did_not
        // _create` caught it. Asking instead of binding keeps the blast radius
        // where the rest of this module keeps it.
        let args = pane_args_wheel_needs_arrows("wt_7");
        assert_eq!(args[2], "-t");
        assert_eq!(args[3], "=vingilot_wt_7:");
        assert!(!args.iter().any(|arg| arg == "-g"));
        // Both halves, because either alone is the wrong question: the
        // alternate screen without mouse reporting is `less`, which tmux
        // already scrolls, and mouse reporting without the alternate screen is
        // a shell that still has history to move.
        assert!(args[4].contains("#{alternate_on}"));
        assert!(args[4].contains("#{mouse_any_flag}"));
    }
    use super::*;

    #[test]
    fn the_mode_question_prints_rather_than_displays() {
        // `-p` is what turns display-message from a status-line flash into an
        // answer on stdout; without it the query would "succeed" and say
        // nothing, forever reading as "not in copy-mode".
        let args = pane_mode_args("wt_1");
        assert_eq!(args[0], "display-message");
        assert_eq!(args[1], "-p");
        assert_eq!(args[4], "#{pane_in_mode}");
    }

    #[test]
    fn leaving_copy_mode_is_the_cancel_command_not_a_typed_q() {
        // `-X cancel` runs copy-mode's own command; a literal `q` sent
        // without `-X` would be typed into the shell whenever the pane is
        // NOT in copy-mode — the exact hazard this arrangement avoids.
        let args = copy_mode_exit_args("wt_1");
        assert_eq!(args[0], "send-keys");
        assert_eq!(args[3], "-X");
        assert_eq!(args[4], "cancel");
    }

    #[test]
    fn no_target_this_module_builds_is_left_unanchored() {
        // The same structural claim tmux.rs makes for its own targets: an
        // unanchored `-t` prefix-matches a longer session's name.
        for id in ["wt_1", "main:repo-1", "", "wt_7#1"] {
            for target in [&pane_mode_args(id)[3], &copy_mode_exit_args(id)[2]] {
                assert!(target.starts_with('='), "unanchored target: {target}");
                assert!(target.ends_with(':'), "not a session target: {target}");
            }
        }
    }
}
