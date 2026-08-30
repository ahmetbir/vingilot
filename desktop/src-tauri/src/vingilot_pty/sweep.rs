//! Ending the tmux sessions of worktrees that are gone.
//!
//! **Why this exists when the app already closes them.** `pty_close` ends a
//! session's tmux as well as its pty, and `RunsScreen` calls it on all four
//! paths it knows: a worktree removed, a project removed, a tab closed, and a
//! worktree that has left git's listing. Every one of those starts from the tab
//! layout saved in the webview's local storage — which is the only record
//! anywhere of which sessions belong to this app.
//!
//! Lose that record and the sessions become unreachable rather than closed. A
//! fresh install under a new bundle identifier, cleared storage, an app
//! replaced rather than updated: the shells keep running, holding whatever they
//! were running, until the machine reboots, and nothing left alive knows their
//! names.
//!
//! So this sweeps from **tmux's own listing** instead. `tmux.rs` derives a
//! session name from a session id reversibly and on purpose; reading the name
//! back is how a session says what it was opened for without the app having to
//! remember.
//!
//! **What it will not do.** This is the one thing in the app that destroys
//! state without being asked, so its refusals matter more than its work:
//!
//! - Only `local:` bindings, whose id *is* the worktree's path
//!   (`features/runs/lib/worktreeGit.ts`). A `main:` binding names a project's
//!   own checkout, which no worktree action removes and whose sessions the
//!   project-removed path already ends.
//! - Only when the path's **parent** is there to prove the path's absence. His
//!   projects live on an external volume as well as the internal disk, and an
//!   unmounted `/Volumes/ugreen` makes every path under it missing at once. A
//!   missing parent is no answer, never "the worktree was removed".
//! - Only a name that survives the round trip back through `session_name`, so
//!   a session can only ever be ended by the exact name it was listed under.

use std::path::Path;

use super::tmux;

/// The binding-id prefix of a worktree git listed, whose id is its path.
/// Mirrors `localBindingId` in `features/runs/lib/worktreeGit.ts`; the two are
/// one wire format and changing either alone strands sessions.
const LOCAL_BINDING_PREFIX: &str = "local:";

/// What a live session is, as far as sweeping is concerned.
#[derive(Debug, Eq, PartialEq)]
pub(crate) enum Verdict {
    /// Not a session this sweeper owns: another app's, the owner's own, a
    /// `main:` binding, or a name that does not round-trip.
    NotOurs,
    /// The worktree is still on disk.
    Alive,
    /// The path is missing and so is its parent — an unmounted volume, or a
    /// tree that moved. No answer, so no action.
    Unreadable,
    /// Gone, with its parent present to say so.
    Orphan,
}

/// The worktree path a session id was opened on, if it names one.
///
/// A session id is `<binding id>#<tab ordinal>`, and since the terminal
/// split (P2, `lib/terminalSplit.ts`) a tab's second pty is
/// `<binding id>#<tab ordinal>~half`. The ordinal is split off the right and
/// only when it is digits — optionally carrying the `~half` suffix: a path
/// may itself contain `#`, and `local:/tmp/a#b` is a directory, not tab `b`.
/// Without the suffix rule the half's ordinal read `2~half`, failed the
/// digits check, the whole id fell through as a path that does not exist,
/// and the sweeper killed every persisted split half at app start (P2
/// verify, MAJOR 1) — the exact state `splitStore` promises survives.
fn worktree_path(session_id: &str) -> Option<&str> {
    let binding = match session_id.rsplit_once('#') {
        Some((left, ordinal))
            if {
                let digits = ordinal.strip_suffix("~half").unwrap_or(ordinal);
                !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
            } =>
        {
            left
        }
        _ => session_id,
    };
    let path = binding.strip_prefix(LOCAL_BINDING_PREFIX)?;
    if path.is_empty() {
        return None;
    }
    Some(path)
}

/// What to do about one live session name.
///
/// `exists` is injected so both refusals are testable without a filesystem to
/// arrange — in particular the unmounted-volume case, which cannot be staged by
/// creating and deleting directories.
pub(crate) fn verdict(name: &str, exists: &impl Fn(&Path) -> bool) -> Verdict {
    let Some(id) = tmux::session_id(name) else {
        return Verdict::NotOurs;
    };
    if tmux::session_name(&id) != name {
        return Verdict::NotOurs;
    }
    let Some(path) = worktree_path(&id) else {
        return Verdict::NotOurs;
    };
    let path = Path::new(path);
    if exists(path) {
        return Verdict::Alive;
    }
    match path.parent() {
        Some(parent) if exists(parent) => Verdict::Orphan,
        _ => Verdict::Unreadable,
    }
}

/// Every session id that should be ended, from a listing of session names.
///
/// Separated from running tmux so the decision is one testable function and the
/// caller below is only plumbing.
pub(crate) fn orphans(names: &[String], exists: &impl Fn(&Path) -> bool) -> Vec<String> {
    names
        .iter()
        .filter(|name| verdict(name, exists) == Verdict::Orphan)
        .filter_map(|name| tmux::session_id(name))
        .collect()
}

/// End every tmux session whose worktree is gone, and say which.
///
/// Called once, at app start. Logged by name rather than counted: a sweeper
/// that kills silently reads exactly like a sweeper that is broken, and the
/// name is what makes an argument about it possible afterwards.
pub(crate) fn sweep_orphans() {
    let exists = |path: &Path| path.exists();
    for id in orphans(&tmux::list_session_names(), &exists) {
        match tmux::kill_session(&id) {
            tmux::KillOutcome::Ended => {
                eprintln!("vingilot: ended the tmux session of a worktree that is gone: {id}");
            }
            tmux::KillOutcome::Failed(reason) => {
                eprintln!("vingilot: could not end the orphaned tmux session {id}: {reason}");
            }
            // Listed a moment ago and absent now: another client ended it, or
            // the server went away. Nothing to report and nothing to do.
            tmux::KillOutcome::Absent | tmux::KillOutcome::NoTmux => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A filesystem that answers from a list, so a test can state exactly what
    /// is on disk — including "the volume is not mounted", which no temporary
    /// directory can arrange.
    fn only<'a>(present: &'a [&'a str]) -> impl Fn(&Path) -> bool + use<'a> {
        move |path: &Path| present.iter().any(|entry| Path::new(entry) == path)
    }

    fn name_for(id: &str) -> String {
        tmux::session_name(id)
    }

    #[test]
    fn a_name_round_trips_through_the_decoder() {
        for id in [
            "local:/Users/a/.vingilot/worktrees/0711a62e-11fc#1",
            "main:repo-1#2",
            "wt_7",
            "a-3ab",
            "a.b:c#10",
        ] {
            assert_eq!(tmux::session_id(&name_for(id)).as_deref(), Some(id));
        }
    }

    #[test]
    fn a_session_this_app_did_not_create_is_not_ours() {
        // The owner's own tmux, sharing the server with ours.
        assert_eq!(verdict("work", &only(&[])), Verdict::NotOurs);
        assert_eq!(verdict("vingilot", &only(&[])), Verdict::NotOurs);
    }

    #[test]
    fn a_projects_own_checkout_is_never_swept() {
        // `main:` bindings name a repo id, not a path: there is nothing to
        // check for existence, and the project-removed path already ends them.
        let name = name_for("main:repo-1#1");
        assert_eq!(verdict(&name, &only(&[])), Verdict::NotOurs);
    }

    #[test]
    fn a_worktree_that_is_still_on_disk_is_left_alone() {
        let name = name_for("local:/w/one#1");
        assert_eq!(verdict(&name, &only(&["/w/one", "/w"])), Verdict::Alive);
    }

    #[test]
    fn a_worktree_that_was_removed_is_an_orphan() {
        let name = name_for("local:/w/one#1");
        assert_eq!(verdict(&name, &only(&["/w"])), Verdict::Orphan);
    }

    #[test]
    fn an_unmounted_volume_is_not_a_removed_worktree() {
        // /Volumes/ugreen is not mounted, so the worktree AND everything it
        // hangs off are missing together. Sweeping here would end every shell
        // on the external disk the moment it was unplugged.
        let name = name_for("local:/Volumes/ugreen/projects/api#1");
        assert_eq!(verdict(&name, &only(&["/Volumes"])), Verdict::Unreadable);
    }

    #[test]
    fn a_tab_ordinal_is_not_mistaken_for_part_of_the_path() {
        let name = name_for("local:/w/one#3");
        assert_eq!(verdict(&name, &only(&["/w/one", "/w"])), Verdict::Alive);
    }

    #[test]
    fn a_hash_inside_a_path_is_part_of_the_path() {
        // `#b` is not an ordinal, so the whole thing is the binding id.
        let name = name_for("local:/w/a#b");
        assert_eq!(verdict(&name, &only(&["/w/a#b", "/w"])), Verdict::Alive);
    }

    #[test]
    fn a_split_half_lives_and_dies_with_its_worktree() {
        // The P2 verify's MAJOR 1: `#2~half` must parse as tab 2's split
        // half, not as a path named `/w/one#2~half` — which does not exist,
        // reads as Orphan, and gets the owner's half killed on every launch.
        let half = name_for("local:/w/one#2~half");
        assert_eq!(verdict(&half, &only(&["/w/one", "/w"])), Verdict::Alive);
        assert_eq!(verdict(&half, &only(&["/w"])), Verdict::Orphan);
        // `~half` alone is not an ordinal; a path may end that way.
        let odd = name_for("local:/w/a#~half");
        assert_eq!(verdict(&odd, &only(&["/w/a#~half", "/w"])), Verdict::Alive);
    }

    #[test]
    fn only_the_orphans_are_collected() {
        let names = vec![
            name_for("local:/w/gone#1"),
            name_for("local:/w/here#1"),
            name_for("main:repo-1#1"),
            "somebody-elses-session".to_string(),
        ];
        assert_eq!(
            orphans(&names, &only(&["/w", "/w/here"])),
            vec!["local:/w/gone#1".to_string()],
        );
    }

    #[test]
    fn nothing_is_swept_from_a_listing_that_said_nothing() {
        // No tmux, no server, a refusal: all arrive as an empty listing.
        assert!(orphans(&[], &only(&["/w"])).is_empty());
    }
}
