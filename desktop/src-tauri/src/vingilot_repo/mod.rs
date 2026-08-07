//! What a directory the owner picked actually is, as far as git is concerned
//! — answered *before* any workspace state is written
//! (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 4).
//!
//! Until now a project was seeded by hand, with curl against the
//! coordinator's mutations endpoint, so "is this a repository" was the
//! owner's problem. From the folder picker it is this app's, and the answer
//! has to be one they can act on: a plain directory, a bare repository, and a
//! linked worktree are three different situations with three different next
//! steps, and collapsing them into "not a git repo" would leave the owner
//! guessing which one they hit.
//!
//! **This module only reads.** It stats a handful of well-known names and
//! walks up the parent chain. It runs no git, opens no file's contents,
//! writes nothing, and deletes nothing.
//!
//! **Why not shell out to `git rev-parse`.** The three answers below are
//! exactly the layout on disk, and stat-ing four names is both faster than a
//! subprocess and immune to the owner's git being absent, shimmed, or slow to
//! start from a Finder-launched app's stripped `PATH` (the same hazard
//! `vingilot_pty/tmux.rs` documents for tmux). What this cannot tell apart —
//! a repository whose `.git` is corrupt from one that is fine — is not a
//! distinction the "add a project" step needs to make: the terminal, the
//! worktree list, and the diff each fail honestly on their own if it is.

use std::path::Path;

use serde::Serialize;

/// What the picked directory is. Serialised as `{ "kind": "…" }` for
/// `features/runs/lib/repoChoice.ts`, which owns the copy for each case.
#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RepoProbe {
    /// `.git` is a directory: an ordinary checkout, the common case.
    Repository,
    /// `.git` is a file holding a `gitdir:` pointer — a linked worktree
    /// (`git worktree add`) or a submodule. A real working tree with a real
    /// checkout in it, so it opens as a project like any other; its git
    /// directory simply lives elsewhere. The pointer's contents are never
    /// read here: whether it resolves is git's business, and the three
    /// answers this module gives do not turn on it.
    Worktree,
    /// No `.git`, but the directory *is* an object database — a bare
    /// repository. Nothing to open a shell in and nothing to diff, so it is
    /// refused rather than added as a project that would be empty of every
    /// surface this app has.
    Bare,
    /// Not a repository. `root` is the nearest ancestor that is one, when
    /// there is one, so the refusal can name where to pick instead — picking
    /// a subdirectory of your own checkout is the mistake this exists for.
    NotARepo { root: Option<String> },
}

/// What `<dir>/.git` is, if it is anything.
///
/// `metadata` rather than `symlink_metadata`: a `.git` symlinked to a
/// directory elsewhere is a working repository, and reporting it as a file
/// would call it a linked worktree.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DotGit {
    Directory,
    File,
    Missing,
}

fn dot_git(dir: &Path) -> DotGit {
    match std::fs::metadata(dir.join(".git")) {
        Ok(meta) if meta.is_dir() => DotGit::Directory,
        Ok(_) => DotGit::File,
        Err(_) => DotGit::Missing,
    }
}

/// Whether the directory itself holds a git object database. All three names
/// together, not any one of them: `HEAD` alone is a common enough filename in
/// unrelated trees, and `objects/` alone says nothing.
fn holds_object_database(dir: &Path) -> bool {
    dir.join("HEAD").is_file() && dir.join("objects").is_dir() && dir.join("refs").is_dir()
}

/// The nearest ancestor that is a repository, for the refusal to point at.
/// Lossy for a path that is not valid UTF-8, which is display text either way
/// — the owner picks the directory again through the dialog, they do not type
/// this string back in.
fn enclosing_repo(dir: &Path) -> Option<String> {
    let mut cursor = dir.parent();
    while let Some(candidate) = cursor {
        if dot_git(candidate) != DotGit::Missing {
            return Some(candidate.to_string_lossy().into_owned());
        }
        cursor = candidate.parent();
    }
    None
}

pub(crate) fn probe(dir: &Path) -> RepoProbe {
    match dot_git(dir) {
        DotGit::Directory => RepoProbe::Repository,
        DotGit::File => RepoProbe::Worktree,
        DotGit::Missing if holds_object_database(dir) => RepoProbe::Bare,
        DotGit::Missing => RepoProbe::NotARepo {
            root: enclosing_repo(dir),
        },
    }
}

/// Classify a directory the owner picked. Never fails: "this is not a
/// repository" is an answer, not an error, and the UI has copy for it.
#[tauri::command]
pub fn repo_probe(path: String) -> RepoProbe {
    probe(Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;

    use tempfile::TempDir;

    /// Layouts are built by hand rather than by running git: the probe reads
    /// exactly these names, and a test that shelled out to git would be
    /// proving git's behaviour instead of this module's. Each tempdir removes
    /// itself on drop.
    fn tempdir() -> TempDir {
        match TempDir::new() {
            Ok(dir) => dir,
            Err(error) => panic!("could not create a temp dir: {error}"),
        }
    }

    fn make_dir(path: &Path) {
        if let Err(error) = fs::create_dir_all(path) {
            panic!("could not create {}: {error}", path.display());
        }
    }

    fn write(path: &Path, contents: &str) {
        if let Err(error) = fs::write(path, contents) {
            panic!("could not write {}: {error}", path.display());
        }
    }

    /// An ordinary checkout: `.git` is a directory.
    fn checkout(root: &Path) {
        make_dir(&root.join(".git"));
    }

    /// A bare repository: the object database, at the top level, no `.git`.
    fn bare(root: &Path) {
        write(&root.join("HEAD"), "ref: refs/heads/main\n");
        make_dir(&root.join("objects"));
        make_dir(&root.join("refs"));
    }

    #[test]
    fn a_checkout_is_a_repository() {
        let dir = tempdir();
        checkout(dir.path());
        assert_eq!(probe(dir.path()), RepoProbe::Repository);
    }

    #[test]
    fn a_dot_git_file_is_a_linked_worktree() {
        // What `git worktree add` writes into the new tree.
        let dir = tempdir();
        write(
            &dir.path().join(".git"),
            "gitdir: /Users/o/repo/.git/worktrees/feature\n",
        );
        assert_eq!(probe(dir.path()), RepoProbe::Worktree);
    }

    #[test]
    fn a_worktree_is_read_from_the_shape_of_dot_git_not_its_contents() {
        // The pointer may name a repository this machine no longer has. That
        // is git's problem to report, not a reason to call the directory
        // something it is not.
        let dir = tempdir();
        write(&dir.path().join(".git"), "gitdir: /gone/.git/worktrees/x\n");
        assert_eq!(probe(dir.path()), RepoProbe::Worktree);
    }

    #[test]
    fn a_bare_repository_is_named_as_one_rather_than_refused_as_a_stranger() {
        let dir = tempdir();
        bare(dir.path());
        assert_eq!(probe(dir.path()), RepoProbe::Bare);
    }

    #[test]
    fn a_plain_directory_is_not_a_repository() {
        let dir = tempdir();
        make_dir(&dir.path().join("src"));
        assert_eq!(probe(dir.path()), RepoProbe::NotARepo { root: None });
    }

    #[test]
    fn one_object_database_name_on_its_own_is_not_a_bare_repository() {
        // HEAD is an ordinary enough filename; a tree holding one is not an
        // object database and must not be offered as a project.
        let dir = tempdir();
        write(&dir.path().join("HEAD"), "not a repository\n");
        assert_eq!(probe(dir.path()), RepoProbe::NotARepo { root: None });
    }

    #[test]
    fn a_subdirectory_of_a_checkout_names_the_checkout_to_pick_instead() {
        let dir = tempdir();
        checkout(dir.path());
        let nested = dir.path().join("desktop").join("src");
        make_dir(&nested);
        assert_eq!(
            probe(&nested),
            RepoProbe::NotARepo {
                root: Some(dir.path().to_string_lossy().into_owned()),
            }
        );
    }

    #[test]
    fn the_nearest_enclosing_repository_wins_over_a_further_one() {
        // A submodule inside a checkout: the useful answer is the submodule,
        // not the superproject two levels up.
        let dir = tempdir();
        checkout(dir.path());
        let inner = dir.path().join("vendor").join("lib");
        make_dir(&inner);
        write(&inner.join(".git"), "gitdir: ../../.git/modules/lib\n");
        let nested = inner.join("src");
        make_dir(&nested);
        assert_eq!(
            probe(&nested),
            RepoProbe::NotARepo {
                root: Some(inner.to_string_lossy().into_owned()),
            }
        );
    }

    #[test]
    fn the_three_answers_serialise_to_what_the_ui_switches_on() {
        assert_eq!(
            serde_json::to_string(&RepoProbe::Repository).ok().as_deref(),
            Some(r#"{"kind":"repository"}"#)
        );
        assert_eq!(
            serde_json::to_string(&RepoProbe::Worktree).ok().as_deref(),
            Some(r#"{"kind":"worktree"}"#)
        );
        assert_eq!(
            serde_json::to_string(&RepoProbe::Bare).ok().as_deref(),
            Some(r#"{"kind":"bare"}"#)
        );
        assert_eq!(
            serde_json::to_string(&RepoProbe::NotARepo { root: None })
                .ok()
                .as_deref(),
            Some(r#"{"kind":"not-a-repo","root":null}"#)
        );
    }
}
