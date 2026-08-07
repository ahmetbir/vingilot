//! `git worktree prune` — bookkeeping, never a directory
//! (vingilot/docs/plans/2026-08-07-panes-and-polish.md, Task 3).
//!
//! **What prune actually removes.** `.git/worktrees/<name>/` — the
//! administrative files git keeps for a linked working tree whose directory it
//! can no longer find. It never touches a working tree: a worktree whose
//! directory is still on disk is not prunable and git will not consider it,
//! and a worktree whose directory has been moved away keeps that directory,
//! wherever it now is. This module's tests pin exactly that — the moved
//! directory is still there, with its files, after a prune.
//!
//! **Shown before it is done.** `git worktree prune --dry-run` reports each
//! entry it would remove, in git's own words ("gitdir file points to
//! non-existent location"). Those words are what the confirm displays; nothing
//! here paraphrases them, and nothing here prunes without having been asked
//! twice.
//!
//! **A locked worktree is never pruned**, by git's own check — `git worktree
//! lock` is somebody saying "not this one", and this island reports locks
//! rather than overriding them (`porcelain.rs`).
//!
//! No expiry is passed, so git's own default applies: `git worktree prune`
//! defaults `expire` to `TIME_MAX`, which is the same set `git worktree list
//! --porcelain` marks `prunable`. That equality is the point — what the column
//! shows as prunable is exactly what the preview lists and the prune removes.

use serde::Serialize;

use super::{describe, ensure_repo, run, WorktreeError};

/// The preview. `--dry-run` reports and removes nothing; `--verbose` is
/// redundant beside it on every git this app has met, and is passed anyway so
/// that a git which ever separates the two still reports.
const PREVIEW_ARGS: [&str; 4] = ["worktree", "prune", "--dry-run", "--verbose"];

/// The real thing. `--verbose` so the answer can say what was removed rather
/// than only that something was.
const PRUNE_ARGS: [&str; 3] = ["worktree", "prune", "--verbose"];

/// What prune would remove, or did — one line per entry, git's own wording.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrunePlan {
    pub entries: Vec<String>,
}

/// The report, from wherever this git puts it.
///
/// **Measured, not assumed:** git 2.50.1 writes `Removing worktrees/<n>: …` to
/// **stderr**, both for `--dry-run` and for the real run, while the same lines
/// were historically documented as output. Reading only stdout gave an empty
/// preview for a worktree git had just said it would remove — a confirm dialog
/// listing nothing above a button that prunes something. Both streams are read,
/// stdout first, and the exit status is still what decides whether this ran at
/// all.
fn ran_lines(repo: &str, args: &[&str]) -> Result<PrunePlan, WorktreeError> {
    ensure_repo(repo)?;
    let ran = run(repo, args)?;
    if !ran.ok {
        return Err(WorktreeError::GitFailed {
            command: describe(args),
            stderr: ran.stderr,
        });
    }
    Ok(PrunePlan {
        entries: ran
            .stdout
            .lines()
            .chain(ran.stderr.lines())
            .filter(|line| !line.trim().is_empty())
            .map(str::to_string)
            .collect(),
    })
}

pub(crate) fn preview(repo: &str) -> Result<PrunePlan, WorktreeError> {
    ran_lines(repo, &PREVIEW_ARGS)
}

pub(crate) fn prune(repo: &str) -> Result<PrunePlan, WorktreeError> {
    ran_lines(repo, &PRUNE_ARGS)
}

/// What `git worktree prune` would remove. Removes nothing.
#[tauri::command]
pub async fn worktree_prune_preview(repo: String) -> Result<PrunePlan, WorktreeError> {
    super::off_thread("worktree prune --dry-run", move || preview(&repo)).await
}

/// Remove the bookkeeping for worktrees whose directories git can no longer
/// find. Answers what it removed.
#[tauri::command]
pub async fn worktree_prune(repo: String) -> Result<PrunePlan, WorktreeError> {
    super::off_thread("worktree prune", move || prune(&repo)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::path::Path;

    use super::super::testrepo::{temp_dir, worktree_path, Repo};
    use super::super::{add, list};

    /// A worktree git can no longer find, made by **moving** its directory —
    /// which is what happens on the owner's machine when a checkout is
    /// relocated or a volume comes back under a different mount point. Nothing
    /// in this file deletes anything, here least of all.
    fn displace(from: &str, to: &str) {
        if let Err(error) = std::fs::rename(from, to) {
            panic!("could not move {from} to {to}: {error}");
        }
    }

    #[test]
    fn a_repository_with_nothing_prunable_previews_nothing() {
        let repo = Repo::new();
        let root = temp_dir();
        let path = worktree_path(&root, "live");
        assert!(add(&repo.path(), "live", "main", &path).is_ok());

        assert_eq!(preview(&repo.path()), Ok(PrunePlan { entries: vec![] }));
        assert_eq!(prune(&repo.path()), Ok(PrunePlan { entries: vec![] }));
        // The worktree that is plainly still there is plainly still there.
        assert_eq!(list(&repo.path()).unwrap_or_default().len(), 2);
    }

    #[test]
    fn the_preview_names_what_prune_would_remove_and_removes_nothing() {
        let repo = Repo::new();
        let root = temp_dir();
        let path = worktree_path(&root, "gone");
        assert!(add(&repo.path(), "gone", "main", &path).is_ok());
        displace(&path, &worktree_path(&root, "moved-away"));

        let planned = match preview(&repo.path()) {
            Ok(plan) => plan,
            Err(error) => panic!("expected a preview, got {error:?}"),
        };
        assert_eq!(planned.entries.len(), 1);
        assert!(
            planned.entries[0].contains("gone"),
            "the preview has to name the entry: {:?}",
            planned.entries
        );

        // A preview is a read. git still knows about the worktree afterwards.
        assert_eq!(list(&repo.path()).unwrap_or_default().len(), 2);
    }

    #[test]
    fn prune_removes_the_bookkeeping_and_leaves_the_directory_alone() {
        let repo = Repo::new();
        let root = temp_dir();
        let path = worktree_path(&root, "gone");
        assert!(add(&repo.path(), "gone", "main", &path).is_ok());
        let moved = worktree_path(&root, "moved-away");
        displace(&path, &moved);

        let done = match prune(&repo.path()) {
            Ok(plan) => plan,
            Err(error) => panic!("expected a prune, got {error:?}"),
        };
        assert_eq!(done.entries.len(), 1);

        // The administrative entry is what went.
        let listed = list(&repo.path()).unwrap_or_default();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].is_main);

        // The directory, and the owner's files in it, did not.
        assert!(Path::new(&moved).is_dir());
        assert!(Path::new(&moved).join("README.md").is_file());

        // And the branch survives a prune, as it survives a remove.
        let branches = match run(&repo.path(), &["branch", "--list", "gone"]) {
            Ok(ran) => ran.stdout,
            Err(error) => panic!("could not list branches: {error:?}"),
        };
        assert!(branches.contains("gone"), "prune must not delete a branch");
    }

    #[test]
    fn a_locked_worktree_is_left_alone_however_lost_its_directory_is() {
        let repo = Repo::new();
        let root = temp_dir();
        let path = worktree_path(&root, "locked");
        assert!(add(&repo.path(), "locked", "main", &path).is_ok());
        match run(&repo.path(), &["worktree", "lock", &path]) {
            Ok(ran) if ran.ok => {}
            Ok(ran) => panic!("could not lock the worktree: {}", ran.stderr),
            Err(error) => panic!("could not lock the worktree: {error:?}"),
        }
        displace(&path, &worktree_path(&root, "locked-moved"));

        assert_eq!(preview(&repo.path()), Ok(PrunePlan { entries: vec![] }));
        assert_eq!(prune(&repo.path()), Ok(PrunePlan { entries: vec![] }));
        assert_eq!(list(&repo.path()).unwrap_or_default().len(), 2);
    }

    #[test]
    fn a_directory_that_is_not_a_repository_is_refused_by_both() {
        let plain = temp_dir();
        let path = plain.path().to_string_lossy().into_owned();
        let not_a_repo = WorktreeError::NotARepo { path: path.clone() };
        assert_eq!(preview(&path), Err(not_a_repo.clone()));
        assert_eq!(prune(&path), Err(not_a_repo));
    }

    #[test]
    fn neither_argument_vector_can_be_forced_and_the_preview_is_always_dry() {
        // `git worktree prune` has no `--force`, and this is the assertion
        // that keeps it that way if a future git grows one. The second half
        // matters more: a preview that lost its `--dry-run` would prune from
        // the code path whose whole job is to not.
        assert!(PREVIEW_ARGS.contains(&"--dry-run"));
        assert!(!PRUNE_ARGS.contains(&"--dry-run"));
        for args in [PREVIEW_ARGS.as_slice(), PRUNE_ARGS.as_slice()] {
            for arg in args {
                assert_ne!(*arg, "--force");
                assert_ne!(*arg, "-f");
                assert_ne!(*arg, "--expire");
            }
        }
    }
}
