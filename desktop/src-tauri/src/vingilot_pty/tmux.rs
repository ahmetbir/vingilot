//! Running a worktree's shell inside tmux, when there is a tmux to run it in.
//!
//! **What this buys, exactly.** `tmux new-session -A` attaches to a session by
//! that name or creates it, and the tmux *server* is not a child of this app —
//! so quitting the app detaches the client and leaves the shell running, and
//! reopening it attaches to the same shell with its screen intact. tmux
//! redraws the visible screen on attach, so reattach also stops being blank
//! for free.
//!
//! **What it does not buy, and the UI must say so.** A tmux session lives only
//! as long as the tmux server. A reboot, `tmux kill-server`, or a machine
//! crash ends it, exactly as it ends every other tmux session on the machine.
//! "Survives an app restart" is the whole claim; anything more would be a
//! promise this cannot keep (see `terminalPersistence.ts` for the copy).
//!
//! When tmux is absent the shell is spawned directly, as a child of this app,
//! and dies with it. That is a worse experience but an honest one — the status
//! bar says "this session only" rather than implying a persistence that is
//! not there.

use std::fmt::Write as _;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use serde::Serialize;

/// Namespace for every session this app creates. A `tmux ls` then says who
/// owns what, and nothing here can collide with a session the owner made by
/// hand.
const SESSION_PREFIX: &str = "vingilot_";

/// Where to look for tmux, in order.
///
/// PATH first, then the well-known install locations: a desktop app launched
/// from Finder does not inherit a login shell's `PATH`, so a PATH-only probe
/// would report "no tmux" to someone who has had it installed for years and
/// silently downgrade their terminals to non-persistent.
const CANDIDATES: &[&str] = &[
    "tmux",
    "/opt/homebrew/bin/tmux",
    "/usr/local/bin/tmux",
    "/usr/bin/tmux",
];

/// What is keeping a terminal's shell alive — and therefore the most the UI is
/// allowed to claim about it.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Backing {
    /// A tmux session, which outlives this app but not the tmux server.
    Tmux,
    /// A child process of this app, which does not outlive it.
    AppProcess,
}

/// The tmux this app will use, probed once and cached for its lifetime.
///
/// Once, not per open: a session open is on the path between a click and a
/// visible terminal, and spawning a probe process there would put a fork+exec
/// in front of every one. The cache is why `Backing` is one answer for the
/// whole app run rather than a per-session property.
pub(crate) fn path() -> Option<&'static str> {
    static TMUX: OnceLock<Option<String>> = OnceLock::new();
    TMUX.get_or_init(|| first_usable(CANDIDATES, responds_to_version))
        .as_deref()
}

/// What is backing terminals right now.
pub(crate) fn backing(tmux: Option<&str>) -> Backing {
    match tmux {
        Some(_) => Backing::Tmux,
        None => Backing::AppProcess,
    }
}

/// The first candidate `usable` accepts, in the order given.
pub(crate) fn first_usable(candidates: &[&str], usable: impl Fn(&str) -> bool) -> Option<String> {
    candidates
        .iter()
        .find(|candidate| usable(candidate))
        .map(|candidate| (*candidate).to_string())
}

/// Whether a candidate path is a tmux that runs. `-V` rather than a file
/// existence check: it proves the binary is executable and answers, which a
/// stat cannot.
fn responds_to_version(candidate: &str) -> bool {
    matches!(
        Command::new(candidate)
            .arg("-V")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status(),
        Ok(status) if status.success()
    )
}

/// The tmux session name for a worktree binding id.
///
/// **Why this is an escape and not a substitution.** tmux rewrites `.` and `:`
/// in a session name to `_` and does not tell you — verified against the
/// installed tmux 3.6a, where `new-session -s a:b` creates `a_b`, and a
/// subsequent `-s a.b` fails with "duplicate session: a_b". Binding ids
/// differ in exactly those characters (a repo's own checkout is
/// `main:<repo id>`), so replacing them character-for-character would map two
/// different worktrees onto one shell.
///
/// So: `[A-Za-z0-9_]` pass through, and every other byte becomes `-` followed
/// by its lowercase hex. That makes `-` the one character that never appears
/// literally, which makes the mapping reversible and therefore injective —
/// injectivity being the whole requirement. Same id always the same name;
/// different ids never the same name.
pub(crate) fn session_name(binding_id: &str) -> String {
    let mut name = String::with_capacity(SESSION_PREFIX.len() + binding_id.len());
    name.push_str(SESSION_PREFIX);
    for byte in binding_id.bytes() {
        if byte.is_ascii_alphanumeric() || byte == b'_' {
            name.push(char::from(byte));
        } else {
            // Infallible: writing to a String never fails.
            let _ = write!(name, "-{byte:02x}");
        }
    }
    name
}

/// A tmux `-t` target that only an exactly-named session can satisfy.
///
/// **Why the `=` is load-bearing.** A tmux target-session falls back to a
/// **prefix** match when nothing matches exactly. Session names are injective
/// but not prefix-free — `vingilot_wt_1` is a prefix of `vingilot_wt_11` —
/// so an unanchored target ends whichever session happens to start with it.
/// Measured on the installed tmux 3.6a, on a throwaway socket holding
/// `vingilot_other` and `vingilot_wt_11`:
///
/// ```text
/// $ tmux kill-session -t vingilot_wt_1     # exit 0, vingilot_wt_11 is gone
/// $ tmux kill-session -t '=vingilot_wt_1'  # "can't find session", refused
/// ```
///
/// Closing one worktree would end another worktree's shell and everything
/// running in it. The hazard is not an edge case either: `pty_close` asks to
/// end a session for **every** id, including shells that never ran under tmux
/// at all, and those are exactly the names that match nothing exactly.
///
/// Every tmux target this app builds is constructed here, so anchoring is a
/// property of the module rather than of each call site. `new-session -s` is
/// deliberately not routed through it: `-s` names a session rather than
/// resolving a target, and takes no `=` — verified on 3.6a, where
/// `new-session -A -s vingilot_wt_1` beside a live `vingilot_wt_11` creates a
/// second, separate session rather than attaching to the longer one.
fn exact_target(binding_id: &str) -> String {
    format!("={}", session_name(binding_id))
}

/// The full argument list for ending one worktree's session, so a test can
/// assert what tmux is actually handed rather than a fragment of it.
pub(crate) fn kill_args(binding_id: &str) -> [String; 3] {
    [
        "kill-session".to_string(),
        "-t".to_string(),
        exact_target(binding_id),
    ]
}

/// What a `kill-session` did.
///
/// Most calls are for a shell that never ran under tmux, where "no such
/// session" is the correct and expected answer. Reporting that as a fault
/// would bury the faults that are real, and swallowing every status alike —
/// which is what this replaced — hides a session that outlived its worktree.
#[derive(Debug, Eq, PartialEq)]
pub(crate) enum KillOutcome {
    /// No tmux on this machine, so nothing was ever created to end.
    NoTmux,
    /// The session existed and is gone.
    Ended,
    /// Nothing by that exact name: a shell that ran outside tmux, a session
    /// already ended, or a tmux server that is no longer running.
    Absent,
    /// tmux ran and refused, or could not be run at all. The caller reports
    /// this; nothing else will.
    Failed(String),
}

/// What tmux says when the session, or the server holding it, is not there.
/// It exits non-zero for this and for genuine faults alike, so the message is
/// the only thing separating them. Measured on 3.6a: a missing session gives
/// "can't find session: <name>"; a socket with no server behind it gives
/// "error connecting to <socket> (No such file or directory)", and older
/// builds phrase that as "no server running on <socket>".
const ABSENT_PHRASES: &[&str] = &[
    "can't find session",
    "no server running",
    "error connecting to",
];

/// Read a kill's exit status and stderr as one of the four outcomes.
/// Separated from the spawn so the reading is testable without a tmux server.
pub(crate) fn classify_kill(succeeded: bool, stderr: &str) -> KillOutcome {
    if succeeded {
        return KillOutcome::Ended;
    }
    let lowered = stderr.to_ascii_lowercase();
    if ABSENT_PHRASES.iter().any(|phrase| lowered.contains(phrase)) {
        return KillOutcome::Absent;
    }
    KillOutcome::Failed(stderr.trim().to_string())
}

/// How to start a session's shell: the program, its arguments, and what that
/// choice means for persistence. Separated from the spawn itself so the
/// decision is testable without a tty.
#[derive(Debug, Eq, PartialEq)]
pub(crate) struct SpawnPlan {
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) backing: Backing,
}

/// Plan the spawn for one worktree.
///
/// `-A` attaches to the named session or creates it, which is what makes this
/// idempotent across app restarts. `-D` detaches any other client first: two
/// clients attached to one session force the smaller of their two window
/// sizes onto both, which is the same geometry-clobbering failure the fit
/// guard exists to prevent, arriving by another route.
pub(crate) fn plan_spawn(
    tmux: Option<&str>,
    shell: &str,
    binding_id: &str,
    cwd: &str,
) -> SpawnPlan {
    match tmux {
        Some(tmux) => SpawnPlan {
            program: tmux.to_string(),
            args: vec![
                "new-session".to_string(),
                "-A".to_string(),
                "-D".to_string(),
                "-s".to_string(),
                session_name(binding_id),
                "-c".to_string(),
                cwd.to_string(),
            ],
            backing: Backing::Tmux,
        },
        None => SpawnPlan {
            program: shell.to_string(),
            args: Vec::new(),
            backing: Backing::AppProcess,
        },
    }
}

/// End a worktree's tmux session.
///
/// Killing the pty's child ends the tmux *client*, and leaving the session
/// behind is the point — that is what a restart reattaches to. But a worktree
/// that has really left the workspace will never be reattached to, so its
/// session has to be ended explicitly here or it would outlive the worktree
/// by the life of the tmux server.
///
/// `kill-session` is the verb, against an anchored target (`exact_target`) so
/// it can only ever reach the one session named. Nothing here touches the
/// filesystem. A session that is not there (tmux absent, already ended, never
/// created because the shell ran directly) is not an error — the outcome says
/// which, and the caller decides what is worth reporting.
pub(crate) fn kill_session(binding_id: &str) -> KillOutcome {
    let Some(tmux) = path() else {
        return KillOutcome::NoTmux;
    };
    match Command::new(tmux)
        .args(kill_args(binding_id))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(output) => classify_kill(
            output.status.success(),
            &String::from_utf8_lossy(&output.stderr),
        ),
        Err(error) => KillOutcome::Failed(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_is_namespaced_to_this_app() {
        assert!(session_name("wt-1").starts_with("vingilot_"));
    }

    #[test]
    fn the_same_binding_id_always_derives_the_same_name() {
        assert_eq!(session_name("main:repo-1"), session_name("main:repo-1"));
    }

    #[test]
    fn an_ordinary_id_passes_through_unescaped() {
        assert_eq!(session_name("wt_7"), "vingilot_wt_7");
    }

    #[test]
    fn the_characters_tmux_rewrites_are_escaped_rather_than_replaced() {
        // tmux 3.6a turns both `.` and `:` into `_` on its own. Letting it do
        // that would map two different worktrees onto one shell.
        assert_eq!(session_name("a:b"), "vingilot_a-3ab");
        assert_eq!(session_name("a.b"), "vingilot_a-2eb");
        assert_ne!(session_name("a:b"), session_name("a.b"));
    }

    #[test]
    fn the_escape_character_cannot_be_forged_by_an_id_containing_it() {
        // If a literal `-` passed through, "a-3ab" and "a:b" would collide.
        assert_eq!(session_name("a-3ab"), "vingilot_a-2d3ab");
        assert_ne!(session_name("a-3ab"), session_name("a:b"));
    }

    #[test]
    fn distinct_ids_never_share_a_name() {
        let ids = [
            "main:repo-1",
            "main:repo-2",
            "main.repo-1",
            "main_repo_1",
            "main-repo-1",
            "wt/7",
            "wt 7",
            "wt%7",
            "",
            "-",
            "_",
            "üñî",
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000002",
        ];
        let mut names: Vec<String> = ids.iter().map(|id| session_name(id)).collect();
        names.sort();
        let derived = names.len();
        names.dedup();
        assert_eq!(names.len(), derived, "two binding ids derived one name");
    }

    #[test]
    fn a_name_only_uses_characters_tmux_keeps_verbatim() {
        // Verified against the installed tmux: [A-Za-z0-9_-] survives a
        // round trip through new-session/list-sessions unchanged.
        for id in ["main:repo-1", "wt/7", "üñî ✓", "a.b:c%d+e@f"] {
            let name = session_name(id);
            assert!(
                name.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'),
                "derived an unsafe name: {name}"
            );
        }
    }

    #[test]
    fn a_multi_byte_character_escapes_to_one_pair_per_byte() {
        // "é" is two bytes; nothing here may assume one byte per character.
        assert_eq!(session_name("é"), "vingilot_-c3-a9");
    }

    #[test]
    fn a_derived_name_can_be_a_strict_prefix_of_another_derived_name() {
        // The hazard the anchor exists for, pinned: injective is not
        // prefix-free, and tmux resolves an unmatched target by prefix. The
        // alphabet tests above all pass while this is true, which is why they
        // did not catch it.
        let shorter = session_name("wt_1");
        let longer = session_name("wt_11");
        assert_ne!(shorter, longer);
        assert!(longer.starts_with(&shorter));
    }

    #[test]
    fn the_kill_target_is_anchored_to_an_exact_name() {
        let args = kill_args("wt_1");
        assert_eq!(args[0], "kill-session");
        assert_eq!(args[1], "-t");
        assert_eq!(args[2], "=vingilot_wt_1");
    }

    #[test]
    fn no_kill_target_is_left_unanchored() {
        // Structural, not per-case: an unanchored target is what let
        // `kill-session -t vingilot_wt_1` end vingilot_wt_11 on tmux 3.6a.
        for id in ["wt_1", "main:repo-1", "", "üñî", "-"] {
            let target = &kill_args(id)[2];
            assert!(
                target.starts_with('='),
                "target would prefix-match another session: {target}"
            );
        }
    }

    #[test]
    fn an_anchored_target_cannot_name_a_longer_session() {
        // Anchoring is only worth anything if the two targets stay distinct
        // once the `=` is on them.
        assert_ne!(kill_args("wt_1")[2], kill_args("wt_11")[2]);
    }

    #[test]
    fn a_kill_that_ended_a_session_says_so() {
        assert_eq!(classify_kill(true, ""), KillOutcome::Ended);
    }

    #[test]
    fn tmuxs_own_words_for_a_missing_session_are_not_a_fault() {
        // Measured on tmux 3.6a: both of these exit 1, and neither means
        // anything went wrong — the shell simply never ran under tmux.
        assert_eq!(
            classify_kill(false, "can't find session: vingilot_wt_7\n"),
            KillOutcome::Absent
        );
        assert_eq!(
            classify_kill(
                false,
                "error connecting to /private/tmp/tmux-501/default (No such file or directory)\n"
            ),
            KillOutcome::Absent
        );
        assert_eq!(
            classify_kill(false, "no server running on /tmp/tmux-501/default\n"),
            KillOutcome::Absent
        );
    }

    #[test]
    fn a_refusal_tmux_has_no_excuse_for_is_reported_rather_than_swallowed() {
        assert_eq!(
            classify_kill(false, "  permission denied\n"),
            KillOutcome::Failed("permission denied".to_string())
        );
    }

    #[test]
    fn with_tmux_the_shell_is_spawned_under_it() {
        let plan = plan_spawn(Some("/opt/homebrew/bin/tmux"), "/bin/zsh", "wt_7", "/tmp/w");
        assert_eq!(plan.program, "/opt/homebrew/bin/tmux");
        assert_eq!(
            plan.args,
            vec![
                "new-session",
                "-A",
                "-D",
                "-s",
                "vingilot_wt_7",
                "-c",
                "/tmp/w",
            ]
        );
        assert_eq!(plan.backing, Backing::Tmux);
    }

    #[test]
    fn without_tmux_the_login_shell_is_spawned_directly() {
        let plan = plan_spawn(None, "/bin/zsh", "wt_7", "/tmp/w");
        assert_eq!(plan.program, "/bin/zsh");
        assert!(plan.args.is_empty());
        assert_eq!(plan.backing, Backing::AppProcess);
    }

    #[test]
    fn the_plan_reattaches_rather_than_starting_a_second_shell() {
        // -A is what makes a restart land on the same session instead of
        // stacking a new one beside it, and -D is what stops a stale client
        // from forcing its window size onto the reattached one.
        let plan = plan_spawn(Some("tmux"), "/bin/zsh", "wt_7", "/tmp/w");
        assert!(plan.args.contains(&"-A".to_string()));
        assert!(plan.args.contains(&"-D".to_string()));
    }

    #[test]
    fn the_mode_the_ui_is_told_follows_whether_tmux_was_found() {
        assert_eq!(backing(Some("/opt/homebrew/bin/tmux")), Backing::Tmux);
        assert_eq!(backing(None), Backing::AppProcess);
    }

    #[test]
    fn the_mode_serialises_to_what_the_ui_switches_on() {
        assert_eq!(
            serde_json::to_string(&Backing::Tmux).ok().as_deref(),
            Some("\"tmux\"")
        );
        assert_eq!(
            serde_json::to_string(&Backing::AppProcess).ok().as_deref(),
            Some("\"app-process\"")
        );
    }

    #[test]
    fn detection_takes_the_first_candidate_that_answers() {
        let found = first_usable(&["a", "b", "c"], |candidate| candidate != "a");
        assert_eq!(found.as_deref(), Some("b"));
    }

    #[test]
    fn detection_gives_up_rather_than_guessing_when_nothing_answers() {
        assert_eq!(first_usable(&["a", "b"], |_| false), None);
        assert_eq!(first_usable(&[], |_| true), None);
    }
}
