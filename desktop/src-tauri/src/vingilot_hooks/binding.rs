//! Which worktree a hook is talking about.
//!
//! A Claude Code hook payload carries `cwd` and nothing else that names a
//! place. The sidebar keys a worktree by a binding id whose `local:` form *is*
//! its path, hex-encoded (`features/runs/lib/projects.ts`'s `localBindingId`),
//! so the whole mapping is: find the checkout the cwd is standing in, and
//! encode its path the way the frontend already does.
//!
//! **Two things make that harder than it sounds, and both are decisions here.**
//!
//! *The cwd is rarely the worktree root.* An agent runs `cd desktop` and every
//! hook after it reports a directory three levels down. Hex-encoding the cwd
//! itself would mint a binding id no row in the app has ever held — a state
//! filed under a key nothing reads, which is indistinguishable from losing it.
//! So the cwd is walked **up** to the first directory holding a `.git`, and
//! that is what gets encoded. `.git` is a directory in an ordinary checkout and
//! a *file* in a linked worktree, which is why the probe asks whether it exists
//! rather than whether it is a directory: a task worktree is exactly the case
//! this feature exists for.
//!
//! *A path has more than one spelling.* `/tmp/x` and `/private/tmp/x` are the
//! same directory on macOS and different strings, and a symlinked project
//! directory is reported by git under its real name. The production probe
//! canonicalises before it walks, so the id derived here is built from the same
//! spelling `git worktree list` prints — which is where the frontend's ids come
//! from (`features/runs/lib/worktreeGit.ts`).
//!
//! **What is deliberately not attempted.** There is no lookup against the
//! project list. This module never asks whether the derived id belongs to a
//! worktree the owner has added, because the answer would be a second opinion
//! about the workspace held on the wrong side of the IPC boundary and stale by
//! however long it has been since the webview last saved. An id for a checkout
//! nobody is watching simply matches no row and draws nothing, which costs
//! exactly one map entry and no correctness.

use std::path::{Path, PathBuf};

/// The prefix of a binding id whose id is its path. Mirrors
/// `LOCAL_WORKTREE_PREFIX` in `features/runs/lib/projects.ts`; the two are one
/// wire format, and a change to either alone files every hook under a key the
/// other side does not read.
pub(crate) const LOCAL_PREFIX: &str = "local:";

/// The prefix of a project's own checkout — synthetic, `main:<repo id>`, and
/// *not* derivable from a path, which is why it can only ever arrive as a hint
/// from the terminal that launched the agent.
const MAIN_PREFIX: &str = "main:";

/// The binding id for a worktree at `path`.
///
/// Byte-for-byte `localBindingId`'s output: lowercase hex of the path's UTF-8
/// bytes, no separator, no padding beyond the per-byte two digits.
pub(crate) fn local_binding_id(path: &str) -> String {
    format!("{LOCAL_PREFIX}{}", hex::encode(path.as_bytes()))
}

/// Where a session's state is filed.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum Attribution {
    /// A binding id the sidebar could be holding, and — when it was derived
    /// from a cwd rather than taken from a hint — the directory it names.
    Binding {
        id: String,
        /// Carried out to the frontend so a row whose id is `main:<repo>` (a
        /// project's own checkout, which has no `local:` id at all) can still
        /// find its agent by comparing paths. `None` for a hinted id, whose
        /// path this module never saw.
        path: Option<String>,
    },
    /// The cwd named no checkout and no usable hint came with it. Held, and
    /// held apart: a session in the owner's home directory is a real live
    /// agent and saying so is honest; drawing it on a worktree row would not
    /// be.
    Unattributed,
}

/// Where one hook's state belongs.
///
/// **The cwd decides, and the hint is the fallback — that order, on purpose.**
/// The cwd is what is true *now*: an agent that was launched in one worktree
/// and `cd`-ed into another is working in the second one, and the dot the owner
/// reads should be the second one's. The hint is what the terminal was opened
/// for, which is the only thing left to go on when the cwd names no checkout at
/// all (a shell in `/tmp`, a directory that has been deleted underneath it).
///
/// `root_of` is injected so every branch — including the two that cannot be
/// staged on a filesystem, an unreadable cwd and a canonicalisation that
/// changes the spelling — is tested without one.
pub(crate) fn attribute(
    cwd: Option<&str>,
    hint: Option<&str>,
    root_of: &impl Fn(&str) -> Option<String>,
) -> Attribution {
    if let Some(root) = cwd.filter(|cwd| !cwd.is_empty()).and_then(root_of) {
        return Attribution::Binding {
            id: local_binding_id(&root),
            path: Some(root),
        };
    }
    match hint.filter(|hint| plausible_binding_id(hint)) {
        Some(hint) => Attribution::Binding {
            id: hint.to_owned(),
            path: None,
        },
        None => Attribution::Unattributed,
    }
}

/// True when a hint looks like an id this app mints.
///
/// The hint arrives in a URL, and a URL is a string anything on this machine
/// can send. Keying the answer on arbitrary text would let one stray POST
/// invent a row in a map the sidebar reads by key — so a hint is either one of
/// the two shapes this app has ever produced or it is not used, and a session
/// that arrives with a junk hint lands in the unattributed bucket rather than
/// under a key of its sender's choosing.
pub(crate) fn plausible_binding_id(hint: &str) -> bool {
    (hint.starts_with(LOCAL_PREFIX) && hint.len() > LOCAL_PREFIX.len())
        || (hint.starts_with(MAIN_PREFIX) && hint.len() > MAIN_PREFIX.len())
}

/// The checkout a real directory is standing in, canonically spelled.
///
/// Both failures answer `None` and mean the same thing here — no checkout was
/// found — which is the honest reading: a cwd that cannot be canonicalised is
/// one nothing can be said about, never one that is outside every project.
pub(crate) fn worktree_root_of(cwd: &str) -> Option<String> {
    let canonical = std::fs::canonicalize(cwd).ok()?;
    let root = worktree_root(&canonical, &|dir: &Path| dir.join(".git").exists())?;
    Some(root.to_string_lossy().into_owned())
}

/// The pure half of the walk, so the ancestor loop is tested against a set of
/// directories rather than a disk.
pub(crate) fn worktree_root(cwd: &Path, is_checkout: &impl Fn(&Path) -> bool) -> Option<PathBuf> {
    cwd.ancestors()
        .find(|dir| is_checkout(dir))
        .map(Path::to_path_buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frontend's own encoding, restated as a literal rather than
    /// recomputed: a test that hex-encodes the path itself would agree with a
    /// broken encoder. `/w/a` is `2f 77 2f 61`.
    #[test]
    fn a_binding_id_is_the_hex_the_sidebar_writes() {
        assert_eq!(local_binding_id("/w/a"), "local:2f772f61");
        // Non-ASCII is where a per-character encoder and a per-byte one part
        // company, and the owner's paths are Turkish often enough to matter:
        // `ö` is two bytes, c3 b6.
        assert_eq!(local_binding_id("/ö"), "local:2fc3b6");
    }

    #[test]
    fn a_cwd_below_the_checkout_is_walked_up_to_it() {
        let checkout = Path::new("/w/repo");
        let probe = |dir: &Path| dir == checkout;
        assert_eq!(
            worktree_root(Path::new("/w/repo/desktop/src/app"), &probe),
            Some(checkout.to_path_buf())
        );
        // And a cwd that is already the root stays put.
        assert_eq!(
            worktree_root(checkout, &probe),
            Some(checkout.to_path_buf())
        );
    }

    #[test]
    fn a_cwd_under_no_checkout_walks_off_the_top_rather_than_guessing() {
        let probe = |_: &Path| false;
        assert_eq!(worktree_root(Path::new("/Users/a"), &probe), None);
    }

    #[test]
    fn the_nearest_checkout_wins_over_the_repository_above_it() {
        // The case this whole module exists for: a linked worktree lives
        // *inside* a directory that is itself a checkout on some layouts, and
        // attributing its agent to the parent repository would put the dot on
        // the wrong row.
        let probe = |dir: &Path| dir == Path::new("/w") || dir == Path::new("/w/repo");
        assert_eq!(
            worktree_root(Path::new("/w/repo/src"), &probe),
            Some(Path::new("/w/repo").to_path_buf())
        );
    }

    #[test]
    fn the_cwd_decides_and_carries_its_path_out() {
        let root_of = |cwd: &str| {
            if cwd.starts_with("/w/repo") {
                Some("/w/repo".to_owned())
            } else {
                None
            }
        };
        assert_eq!(
            attribute(Some("/w/repo/src"), Some("local:deadbeef"), &root_of),
            Attribution::Binding {
                id: local_binding_id("/w/repo"),
                path: Some("/w/repo".to_owned()),
            },
            "a cwd inside a checkout outranks the terminal's own hint"
        );
    }

    #[test]
    fn a_cwd_outside_every_checkout_falls_back_to_the_terminals_hint() {
        let root_of = |_: &str| None;
        assert_eq!(
            attribute(Some("/tmp"), Some("main:repo-7"), &root_of),
            Attribution::Binding {
                id: "main:repo-7".to_owned(),
                path: None,
            },
            "a project's own checkout has no derivable id, so only the hint can name it"
        );
    }

    #[test]
    fn a_hint_that_is_not_one_of_our_ids_lands_unattributed() {
        // The refusal that keeps a stray POST from inventing a row.
        let root_of = |_: &str| None;
        for hint in [
            None,
            Some(""),
            Some("local:"),
            Some("main:"),
            Some("../../etc"),
            Some("http://example.com"),
        ] {
            assert_eq!(
                attribute(Some("/tmp"), hint, &root_of),
                Attribution::Unattributed,
                "{hint:?} must not become a key"
            );
        }
    }

    #[test]
    fn a_missing_cwd_is_no_answer_and_not_an_empty_path() {
        let root_of = |cwd: &str| {
            assert!(!cwd.is_empty(), "an empty cwd must never reach the probe");
            Some("/w/repo".to_owned())
        };
        assert_eq!(attribute(None, None, &root_of), Attribution::Unattributed);
        assert_eq!(
            attribute(Some(""), None, &root_of),
            Attribution::Unattributed
        );
    }
}
