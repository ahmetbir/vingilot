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
//!
//! **And it is what a scratch shell asks for on purpose.** `Lifetime` is how a
//! caller says so: an ephemeral session takes the same direct-spawn arm as a
//! machine with no tmux, so "leaves nothing behind" is a property of what was
//! started rather than of a teardown that has to run. There is no per-session
//! tmux, no session to find in `tmux ls`, and nothing for a crash to strand.

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

/// How long a session is meant to last — the one thing that decides whether
/// tmux is used for it at all.
///
/// **Why this is a parameter and not a preference.** A scratch shell's whole
/// contract is that it leaves nothing behind, and the only way to keep that
/// promise across a crash, a `kill -9`, or a quit the app never got to run
/// teardown for is to never create the thing that would survive. Closing a
/// tmux-backed session on the way out is cleanup, and cleanup is a promise
/// that holds until the one time it does not.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Lifetime {
    /// A worktree's terminal tab. Outlives this app wherever tmux allows it.
    Persistent,
    /// A scratch shell. A child of this app, which dies with it — by
    /// construction, not by cleanup.
    Ephemeral,
}

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

/// The tmux session name for a PTY session id.
///
/// A session id is `<worktree binding id>#<tab ordinal>` — one shell of a
/// worktree's strip of terminal tabs — so the alphabet this has to survive is
/// the binding id's plus `#`. Nothing special is done for it: `#` is outside
/// `[A-Za-z0-9_]` and is escaped like every other byte, which is exactly what
/// keeps the derivation injective as the id's shape grows. A separator that
/// needed its own case here would be the wrong separator.
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
pub(crate) fn session_name(session_id: &str) -> String {
    let mut name = String::with_capacity(SESSION_PREFIX.len() + session_id.len());
    name.push_str(SESSION_PREFIX);
    for byte in session_id.bytes() {
        if byte.is_ascii_alphanumeric() || byte == b'_' {
            name.push(char::from(byte));
        } else {
            // Infallible: writing to a String never fails.
            let _ = write!(name, "-{byte:02x}");
        }
    }
    name
}

/// The session id a name was derived from, or `None` for a name that is not
/// one of ours.
///
/// The inverse of `session_name`, and it exists because a session's *name* is
/// the only record of what it was opened for that survives the app losing its
/// saved tab layout. `sweep.rs` reads a worktree path back out of it.
///
/// **The round trip is checked by the caller, not asserted here.** Decoding is
/// deliberately permissive — it accepts `-41` for `A`, which `session_name`
/// would never emit — so this is not injective on arbitrary input, and a
/// caller that kills by re-deriving a name from a decoded id could reach a
/// different session than the one it read. `sweep.rs` therefore requires
/// `session_name(&decoded) == name` before acting. Making the decoder strict
/// instead would move that check somewhere harder to see.
pub(crate) fn session_id(name: &str) -> Option<String> {
    let rest = name.strip_prefix(SESSION_PREFIX)?;
    let bytes = rest.as_bytes();
    let mut id = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        let byte = bytes[at];
        if byte == b'-' {
            // `get` rather than indexing: a name may hold any UTF-8, and a
            // slice that would split a character answers `None` here.
            let hex = rest.get(at + 1..at + 3)?;
            id.push(u8::from_str_radix(hex, 16).ok()?);
            at += 3;
        } else if byte.is_ascii_alphanumeric() || byte == b'_' {
            id.push(byte);
            at += 1;
        } else {
            return None;
        }
    }
    String::from_utf8(id).ok()
}

/// Every session name the tmux server is holding, ours and the owner's alike.
///
/// **An empty answer means "nothing was said", not "there is nothing".** No
/// tmux, no server running, a refusal — all arrive here as an empty list, and
/// the only caller (`sweep.rs`) responds by sweeping nothing. That is the safe
/// direction for this particular emptiness, and it is the reason this returns a
/// plain `Vec` rather than an `Option` the caller could forget to unwrap.
pub(crate) fn list_session_names() -> Vec<String> {
    let Some(tmux) = path() else {
        return Vec::new();
    };
    let Ok(output) = Command::new(tmux)
        .args(["list-sessions", "-F", "#{session_name}"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
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
/// $ tmux kill-session -t vingilot_wt_1      # exit 0, vingilot_wt_11 is gone
/// $ tmux kill-session -t '=vingilot_wt_1:'  # "can't find session", refused
/// ```
///
/// Closing one worktree would end another worktree's shell and everything
/// running in it. The hazard is not an edge case either: `pty_close` asks to
/// end a session for **every** id, including shells that never ran under tmux
/// at all, and those are exactly the names that match nothing exactly.
///
/// **Why the trailing `:` is load-bearing too.** It is what says "this names a
/// *session*", and without it `set-option` reads the target as a pane and
/// finds nothing. Measured on 3.6a against a live `vingilot_probe`:
///
/// ```text
/// $ tmux set-option -t '=vingilot_probe' status off   # "no such session"
/// $ tmux set-option -t '=vingilot_probe:' status off  # exit 0
/// ```
///
/// `kill-session` accepts both spellings, so the one form both commands agree
/// on is the one used everywhere — two nearly identical anchored targets is
/// how one of them ends up unanchored.
///
/// Every tmux target this app builds is constructed here, so anchoring is a
/// property of the module rather than of each call site. `new-session -s` is
/// deliberately not routed through it: `-s` names a session rather than
/// resolving a target, and takes no `=` — verified on 3.6a, where
/// `new-session -A -s vingilot_wt_1` beside a live `vingilot_wt_11` creates a
/// second, separate session rather than attaching to the longer one.
fn exact_target(session_id: &str) -> String {
    format!("={}:", session_name(session_id))
}

/// The full argument list for ending one tab's session, so a test can assert
/// what tmux is actually handed rather than a fragment of it.
pub(crate) fn kill_args(session_id: &str) -> [String; 3] {
    [
        "kill-session".to_string(),
        "-t".to_string(),
        exact_target(session_id),
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

/// The separator tmux reads as "and then run this", as one argument of its
/// own. Nothing here goes through a shell, so it needs no escaping — and
/// nothing here may ever be handed to one.
const THEN: &str = ";";

/// Turn off the status line — for one named session, and no other.
///
/// The app draws its own status bar. tmux's, underneath it, says the same
/// things twice and costs a row of the terminal the owner is actually using.
///
/// **Scoped to our sessions, deliberately and structurally.** `status` is a
/// session option, and the tmux *server* is shared with every session the
/// owner started by hand — so `set-option -g` here would blank the status bar
/// of the tmux he was already running, and writing to `~/.tmux.conf` would do
/// it to every session he ever starts again. The anchored per-session target
/// is what makes the blast radius exactly one session, and the absence of
/// `-g` is what keeps it off the server's own defaults.
///
/// Chained onto the spawn rather than run as a second process, because a
/// second process would have to guess when the session exists. Verified on
/// tmux 3.6a: commands after an attaching `new-session` do run, and running
/// this on every spawn (not only on creation) is what turns the bar off for a
/// session an earlier build of this app left behind.
fn quiet_status_args(session_id: &str) -> [String; 5] {
    [
        "set-option".to_string(),
        "-t".to_string(),
        exact_target(session_id),
        "status".to_string(),
        "off".to_string(),
    ]
}

/// Let the wheel scroll — for one named session, and no other.
///
/// **Why scrolling did not work at all.** Under tmux the scrollback is tmux's,
/// not xterm's: what leaves the top of the screen goes into tmux's history, and
/// xterm's own viewport holds only what is currently drawn. So there is nothing
/// for xterm to scroll, and the wheel reaches tmux, which ignores it unless
/// `mouse` is on. The owner saw a terminal whose scrollback was intact and
/// unreachable.
///
/// **What this costs, stated because it is a real trade.** With `mouse on`,
/// tmux captures click-drag too, so a plain drag selects into tmux's buffer
/// rather than the system clipboard. Holding **Shift** bypasses mouse reporting
/// and gives back an ordinary local selection — xterm.js implements that
/// bypass, and it is the same reflex iTerm users already have. Wheel-scrolling
/// is the thing done constantly and copying is the thing done occasionally, so
/// the constant one gets the unmodified gesture.
///
/// Scoped exactly like `quiet_status_args`, for the same reason and by the same
/// mechanism: `mouse` is a session option, the server is shared with sessions
/// the owner started by hand, and an anchored per-session target with no `-g`
/// is what keeps the blast radius at one session.
fn mouse_on_args(session_id: &str) -> [String; 5] {
    [
        "set-option".to_string(),
        "-t".to_string(),
        exact_target(session_id),
        "mouse".to_string(),
        "on".to_string(),
    ]
}

/// Plan the spawn for one terminal.
///
/// `-A` attaches to the named session or creates it, which is what makes this
/// idempotent across app restarts. `-D` detaches any other client first: two
/// clients attached to one session force the smaller of their two window
/// sizes onto both, which is the same geometry-clobbering failure the fit
/// guard exists to prevent, arriving by another route.
///
/// **An ephemeral session takes the same branch as a machine with no tmux on
/// it.** Not a near-copy of it: the two are one arm, so a spawn option added
/// to the direct-shell plan cannot reach one and miss the other, and the
/// scratch terminal inherits the fallback's tested behaviour rather than a
/// second implementation of it.
pub(crate) fn plan_spawn(
    tmux: Option<&str>,
    shell: &str,
    session_id: &str,
    cwd: &str,
    lifetime: Lifetime,
) -> SpawnPlan {
    match (lifetime, tmux) {
        (Lifetime::Persistent, Some(tmux)) => {
            let mut args = vec![
                "new-session".to_string(),
                "-A".to_string(),
                "-D".to_string(),
                "-s".to_string(),
                session_name(session_id),
                "-c".to_string(),
                cwd.to_string(),
                THEN.to_string(),
            ];
            args.extend(quiet_status_args(session_id));
            args.push(THEN.to_string());
            args.extend(mouse_on_args(session_id));
            SpawnPlan {
                program: tmux.to_string(),
                args,
                backing: Backing::Tmux,
            }
        }
        (Lifetime::Ephemeral, _) | (Lifetime::Persistent, None) => SpawnPlan {
            program: shell.to_string(),
            args: Vec::new(),
            backing: Backing::AppProcess,
        },
    }
}

/// End one terminal tab's tmux session.
///
/// Killing the pty's child ends the tmux *client*, and leaving the session
/// behind is the point — that is what a restart reattaches to. But a tab the
/// owner closed, or one whose worktree has left the workspace, will never be
/// reattached to, so its session has to be ended explicitly here or it would
/// outlive the tab by the life of the tmux server.
///
/// `kill-session` is the verb, against an anchored target (`exact_target`) so
/// it can only ever reach the one session named. Nothing here touches the
/// filesystem. A session that is not there (tmux absent, already ended, never
/// created because the shell ran directly) is not an error — the outcome says
/// which, and the caller decides what is worth reporting.
pub(crate) fn kill_session(session_id: &str) -> KillOutcome {
    let Some(tmux) = path() else {
        return KillOutcome::NoTmux;
    };
    match Command::new(tmux)
        .args(kill_args(session_id))
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
            // The tab ordinals a worktree's strip derives: every tab of one
            // worktree is a separate shell and so must be a separate session.
            "main:repo-1#1",
            "main:repo-1#2",
            "main:repo-1#11",
            "main:repo-2#1",
            // An id that already ends in a separator and digits, so the two
            // ways of arriving at the same string are pinned apart.
            "main:repo-1#1#1",
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
        for id in [
            "main:repo-1",
            "wt/7",
            "üñî ✓",
            "a.b:c%d+e@f",
            "main:repo-1#3",
            "wt 7#12",
        ] {
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
    fn a_tab_ordinal_is_escaped_like_any_other_byte_rather_than_special_cased() {
        // The session id a worktree's second terminal tab derives. `#` is
        // 0x23, so it escapes to "-23" and the ordinal that follows passes
        // through — no case for it anywhere, which is what keeps the whole
        // derivation one rule.
        assert_eq!(session_name("main:a#1"), "vingilot_main-3aa-231");
        assert_eq!(session_name("wt_7#2"), "vingilot_wt_7-232");
    }

    #[test]
    fn two_tabs_of_one_worktree_are_two_sessions() {
        // Same checkout, different shells. A derivation that collapsed the
        // ordinal would attach every tab of a worktree to one tmux session,
        // and the owner would type into all of them at once.
        assert_ne!(session_name("wt_7#1"), session_name("wt_7#2"));
        assert_ne!(session_name("wt_7#1"), session_name("wt_7"));
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

        // Tab ordinals put the same hazard inside a single worktree, where it
        // is far more likely to be hit: a worktree with eleven tabs holds both
        // of these at once, and closing the first would end the eleventh.
        let first = session_name("wt_7#1");
        let eleventh = session_name("wt_7#11");
        assert_ne!(first, eleventh);
        assert!(eleventh.starts_with(&first));
    }

    #[test]
    fn the_kill_target_is_anchored_to_an_exact_name() {
        let args = kill_args("wt_1");
        assert_eq!(args[0], "kill-session");
        assert_eq!(args[1], "-t");
        assert_eq!(args[2], "=vingilot_wt_1:");
    }

    #[test]
    fn no_target_this_app_builds_is_left_unanchored() {
        // Structural, not per-case: an unanchored target is what let
        // `kill-session -t vingilot_wt_1` end vingilot_wt_11 on tmux 3.6a,
        // and a target without the trailing `:` is one `set-option` cannot
        // resolve at all.
        for id in ["wt_1", "main:repo-1", "", "üñî", "-", "wt_7#1", "wt_7#11"] {
            for target in [&kill_args(id)[2], &quiet_status_args(id)[2]] {
                assert!(
                    target.starts_with('='),
                    "target would prefix-match another session: {target}"
                );
                assert!(
                    target.ends_with(':'),
                    "target does not name a session: {target}"
                );
            }
        }
    }

    #[test]
    fn an_anchored_target_cannot_name_a_longer_session() {
        // Anchoring is only worth anything if the two targets stay distinct
        // once the `=` is on them.
        assert_ne!(kill_args("wt_1")[2], kill_args("wt_11")[2]);
        assert_ne!(kill_args("wt_7#1")[2], kill_args("wt_7#11")[2]);
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
        let plan = plan_spawn(
            Some("/opt/homebrew/bin/tmux"),
            "/bin/zsh",
            "wt_7",
            "/tmp/w",
            Lifetime::Persistent,
        );
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
                ";",
                "set-option",
                "-t",
                "=vingilot_wt_7:",
                "status",
                "off",
                ";",
                "set-option",
                "-t",
                "=vingilot_wt_7:",
                "mouse",
                "on",
            ]
        );
        assert_eq!(plan.backing, Backing::Tmux);
    }

    #[test]
    fn the_wheel_scrolls_the_session_being_spawned_and_no_other() {
        // Under tmux the scrollback is tmux's, not xterm's, so without this the
        // wheel reaches a tmux that ignores it and the history is intact but
        // unreachable. Same anchored per-session target as `status`: the server
        // is shared with sessions the owner started by hand.
        let plan = plan_spawn(
            Some("tmux"),
            "/bin/zsh",
            "wt_7",
            "/tmp/w",
            Lifetime::Persistent,
        );
        let mouse = plan
            .args
            .iter()
            .position(|arg| arg == "mouse")
            .expect("the spawn plan turns the mouse on");
        assert_eq!(plan.args[mouse + 1], "on");
        // The option immediately follows its own anchored target, not some
        // earlier command's — the two set-options are otherwise identical.
        assert_eq!(plan.args[mouse - 1], "=vingilot_wt_7:");
        assert_eq!(plan.args[mouse - 2], "-t");
    }

    #[test]
    fn the_status_line_is_turned_off_for_the_session_being_spawned_and_no_other() {
        // The app draws its own status bar; tmux's underneath it duplicates it
        // and costs a row.
        let plan = plan_spawn(
            Some("tmux"),
            "/bin/zsh",
            "wt_7",
            "/tmp/w",
            Lifetime::Persistent,
        );
        assert!(plan.args.iter().any(|arg| arg == "status"));
        assert!(plan
            .args
            .windows(2)
            .any(|pair| pair == ["-t", "=vingilot_wt_7:"]));
    }

    #[test]
    fn nothing_this_app_runs_can_reach_a_session_it_did_not_create() {
        // The tmux server is shared with every session the owner started by
        // hand. `-g` would blank their status bars too, and a target naming
        // anything but one of ours could reach one of his. Asserted over the
        // whole argument list rather than the one call site that builds it,
        // because the next spawn option added is the one that forgets.
        let plan = plan_spawn(
            Some("tmux"),
            "/bin/zsh",
            "wt_7",
            "/tmp/w",
            Lifetime::Persistent,
        );
        assert!(
            !plan.args.iter().any(|arg| arg == "-g"),
            "a server-wide option would change the owner's own tmux: {:?}",
            plan.args
        );
        for target in plan
            .args
            .windows(2)
            .filter(|pair| pair[0] == "-t")
            .map(|pair| &pair[1])
        {
            assert_eq!(
                target,
                &format!("={}:", session_name("wt_7")),
                "a target that is not this session's"
            );
        }
    }

    #[test]
    fn without_tmux_there_is_no_status_line_to_turn_off() {
        let plan = plan_spawn(None, "/bin/zsh", "wt_7", "/tmp/w", Lifetime::Persistent);
        assert!(plan.args.is_empty());
    }

    #[test]
    fn a_scratch_shell_runs_outside_tmux_even_where_tmux_is_installed() {
        // The whole contract of the scratch terminal: no tmux session, so
        // there is nothing for a crash, a `kill -9`, or a quit that skipped
        // teardown to leave behind in `tmux ls`.
        let plan = plan_spawn(
            Some("/opt/homebrew/bin/tmux"),
            "/bin/zsh",
            "vingilot-scratch.1",
            "/tmp/w",
            Lifetime::Ephemeral,
        );
        assert_eq!(plan.program, "/bin/zsh");
        assert!(plan.args.is_empty());
        assert_eq!(plan.backing, Backing::AppProcess);
    }

    #[test]
    fn nothing_in_a_scratch_plan_names_a_tmux_session() {
        // Asserted over the whole plan rather than over the branch that
        // builds it: a spawn option added to the tmux arm must not be able to
        // reach this one, and `new-session -s <name>` is the one argument
        // that would create the thing this terminal promises not to create.
        let plan = plan_spawn(
            Some("tmux"),
            "/bin/zsh",
            "vingilot-scratch.1",
            "/tmp/w",
            Lifetime::Ephemeral,
        );
        let words: Vec<&str> = std::iter::once(plan.program.as_str())
            .chain(plan.args.iter().map(String::as_str))
            .collect();
        assert!(
            !words.iter().any(|word| word.contains(SESSION_PREFIX)),
            "a scratch plan named a session: {words:?}"
        );
        assert!(!words.contains(&"new-session"), "{words:?}");
    }

    #[test]
    fn the_two_lifetimes_are_two_different_spawns_on_the_same_machine() {
        // The property the scratch terminal rests on, stated as a comparison:
        // one id, one tmux, two answers. If these ever agree, either the
        // scratch took a tmux session or every terminal lost its persistence.
        let persistent = plan_spawn(
            Some("tmux"),
            "/bin/zsh",
            "wt_7#1",
            "/tmp/w",
            Lifetime::Persistent,
        );
        let scratch = plan_spawn(
            Some("tmux"),
            "/bin/zsh",
            "wt_7#1",
            "/tmp/w",
            Lifetime::Ephemeral,
        );
        assert_eq!(persistent.backing, Backing::Tmux);
        assert_eq!(scratch.backing, Backing::AppProcess);
        assert_ne!(persistent.program, scratch.program);
    }

    #[test]
    fn without_tmux_the_login_shell_is_spawned_directly() {
        let plan = plan_spawn(None, "/bin/zsh", "wt_7", "/tmp/w", Lifetime::Persistent);
        assert_eq!(plan.program, "/bin/zsh");
        assert!(plan.args.is_empty());
        assert_eq!(plan.backing, Backing::AppProcess);
    }

    #[test]
    fn the_plan_reattaches_rather_than_starting_a_second_shell() {
        // -A is what makes a restart land on the same session instead of
        // stacking a new one beside it, and -D is what stops a stale client
        // from forcing its window size onto the reattached one.
        let plan = plan_spawn(
            Some("tmux"),
            "/bin/zsh",
            "wt_7",
            "/tmp/w",
            Lifetime::Persistent,
        );
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
