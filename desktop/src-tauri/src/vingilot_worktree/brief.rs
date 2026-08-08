//! A worktree opened with the plan that asked for it
//! (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 4).
//!
//! **The creation is `super::add`, unchanged.** Every refusal a new worktree
//! can meet — a branch that exists, a base that names nothing, a directory
//! already at the path, a name `check-ref-format` rejects — is decided there
//! and reaches the owner in the words `worktreePlan.ts` already owns. This
//! module adds one thing to it: the plan's own text, written into the checkout
//! git has just made, so the work carries its brief instead of leaving it
//! behind in a pane.
//!
//! **The brief can only ever land inside the worktree this call created.**
//! There is no command here that takes a directory: the only path
//! `write_brief` is given is the one `add` came back with, which git has just
//! reported as a linked working tree of this repository. That is why there is
//! no main-checkout guard in this file — a command that could be pointed at
//! the owner's own checkout would need one, and this is not that command.
//!
//! **A brief is never written over anything.** The file is opened
//! `create_new`, so "there was already a `PLAN.md` here" is the filesystem's
//! answer rather than a check this module could lose a race with, and it is
//! reported with nothing changed.
//!
//! **A worktree that was made is reported as made, even when its brief was
//! not.** `BriefedWorktree` carries the refusal beside the worktree rather
//! than in place of it. The alternative — failing the whole call — would be a
//! refusal that describes a worktree which exists, on a branch that exists,
//! and the only way to make that description true again is to remove them.
//! Nothing in this island removes anything to tidy up after itself.

use std::ffi::OsStr;
use std::fs::OpenOptions;
use std::io::{ErrorKind, Write};
use std::path::Path;

use serde::Serialize;

use super::{add, off_thread, GitWorktree, WorktreeError};

/// A new worktree, and what became of the brief for it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefedWorktree {
    /// git's own record of the worktree that was created.
    pub worktree: GitWorktree,
    /// Absolute path of the brief that was written, or `None` when it was not.
    pub brief: Option<String>,
    /// Why the brief did not land. The worktree above exists either way, and
    /// nothing about it is undone by this being set.
    pub brief_refusal: Option<WorktreeError>,
}

/// Whether `name` is a filename rather than a path.
///
/// The caller is this app's own Plan pane, whose filename is a constant — so
/// this is not defending against today's caller. It is what keeps the answer
/// to "where can this write?" a property of the code rather than of the
/// caller's discipline: `..` and `docs/PLAN.md` are refused here, so no later
/// edit that derives a filename from something the owner typed can turn this
/// into a write anywhere in his home directory.
///
/// A leading dot is refused too, for a different reason: a brief is meant to
/// be found by whoever opens the worktree next, and a dotfile is the one place
/// that will not be looked.
///
/// Four clauses, each catching something none of the others does: the first
/// takes `""`, `.`, `..` and anything with a `/` in it; the second `.hidden`;
/// the third a Windows-shaped path, which on this platform is one perfectly
/// legal segment; the fourth a name carrying a newline or a NUL.
fn is_filename(name: &str) -> bool {
    Path::new(name).file_name() == Some(OsStr::new(name))
        && !name.starts_with('.')
        && !name.contains('\\')
        && !name.chars().any(char::is_control)
}

/// Write the brief into a worktree, or say why not.
///
/// `worktree` is git's own path for a working tree it has just created; there
/// is no other caller and no command that would let there be one.
fn write_brief(worktree: &Path, name: &str, text: &str) -> Result<String, WorktreeError> {
    if !is_filename(name) {
        return Err(WorktreeError::InvalidBriefName {
            name: name.to_string(),
        });
    }
    let file = worktree.join(name);
    let shown = file.to_string_lossy().into_owned();
    let exists = |_| WorktreeError::BriefExists {
        path: shown.clone(),
    };
    let failed = |error: std::io::Error| WorktreeError::GitFailed {
        command: format!("write {shown}"),
        stderr: error.to_string(),
    };

    // `create_new`: the refusal to overwrite is the open flag, not a stat this
    // module performed a moment earlier and could be wrong about by now.
    let mut handle = match OpenOptions::new().create_new(true).write(true).open(&file) {
        Ok(handle) => handle,
        Err(error) if error.kind() == ErrorKind::AlreadyExists => return Err(exists(error)),
        Err(error) => return Err(failed(error)),
    };
    handle.write_all(text.as_bytes()).map_err(failed)?;
    Ok(shown)
}

/// A new worktree with the plan that asked for it written into it.
///
/// **The order is the guarantee.** `add` first, and the brief only into what
/// it came back with — so a refused creation leaves no file anywhere, and the
/// path written to is never one this function chose.
pub(crate) fn add_with_brief(
    repo: &str,
    branch: &str,
    base: &str,
    path: &str,
    name: &str,
    text: &str,
) -> Result<BriefedWorktree, WorktreeError> {
    let worktree = add(repo, branch, base, path)?;
    match write_brief(Path::new(&worktree.path), name, text) {
        Ok(brief) => Ok(BriefedWorktree {
            brief: Some(brief),
            brief_refusal: None,
            worktree,
        }),
        Err(refusal) => Ok(BriefedWorktree {
            brief: None,
            brief_refusal: Some(refusal),
            worktree,
        }),
    }
}

/// The arguments up to `path` are `worktree_add`'s, and reach the same
/// function: this command is that one plus a file, not a second way of making
/// a worktree.
#[tauri::command]
pub async fn worktree_add_with_brief(
    repo: String,
    branch: String,
    base: String,
    path: String,
    name: String,
    text: String,
) -> Result<BriefedWorktree, WorktreeError> {
    off_thread("worktree add with brief", move || {
        add_with_brief(&repo, &branch, &base, &path, &name, &text)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;

    use crate::vingilot_worktree::testrepo::{git_at, temp_dir, worktree_path, Repo};
    use crate::vingilot_worktree::{list, remove};

    /// Committing inside a linked worktree, which has no `Repo` behind it and
    /// therefore none of its identity config.
    fn commit_in(worktree: &str, args: &[&str]) -> bool {
        let mut all = vec![
            "-c",
            "user.email=test@vingilot.invalid",
            "-c",
            "user.name=Vingilot Test",
            "-c",
            "commit.gpgsign=false",
        ];
        all.extend_from_slice(args);
        git_at(worktree, &all)
    }

    #[test]
    fn the_plan_is_in_the_worktree_it_opened() {
        let repo = Repo::new();
        let root = temp_dir();
        let path = worktree_path(&root, "brief");

        let made = match add_with_brief(
            &repo.path(),
            "carry-the-brief",
            "main",
            &path,
            "PLAN.md",
            "# Carry the brief\n\nWhat the work is.\n",
        ) {
            Ok(made) => made,
            Err(error) => panic!("expected a briefed worktree, got {error:?}"),
        };

        assert_eq!(made.brief_refusal, None);
        assert_eq!(made.worktree.branch.as_deref(), Some("carry-the-brief"));
        let brief = made.brief.unwrap_or_default();
        assert_eq!(
            fs::read_to_string(&brief).unwrap_or_default(),
            "# Carry the brief\n\nWhat the work is.\n"
        );
        // In the new checkout, not in the repository the owner is working in.
        assert!(brief.starts_with(&made.worktree.path));
        assert!(!Path::new(&repo.path()).join("PLAN.md").exists());
    }

    #[test]
    fn a_plan_already_in_the_base_commit_is_never_written_over() {
        let repo = Repo::new();
        let root = temp_dir();
        repo.write("PLAN.md", "the plan already on this branch\n");
        repo.git(&["add", "PLAN.md"]);
        repo.git(&["commit", "-m", "a plan of its own"]);
        let path = worktree_path(&root, "occupied");

        let made = match add_with_brief(
            &repo.path(),
            "second-plan",
            "main",
            &path,
            "PLAN.md",
            "the plan from the pane\n",
        ) {
            Ok(made) => made,
            Err(error) => panic!("expected the worktree to be reported, got {error:?}"),
        };

        // The worktree was made and is reported as made — the refusal is about
        // the brief alone.
        assert_eq!(made.brief, None);
        match made.brief_refusal {
            Some(WorktreeError::BriefExists { ref path }) => {
                assert!(path.ends_with("PLAN.md"));
            }
            ref other => panic!("expected a brief-exists refusal, got {other:?}"),
        }
        assert_eq!(list(&repo.path()).unwrap_or_default().len(), 2);
        assert_eq!(
            fs::read_to_string(Path::new(&path).join("PLAN.md")).unwrap_or_default(),
            "the plan already on this branch\n"
        );
    }

    #[test]
    fn a_refused_worktree_writes_no_brief_anywhere() {
        let repo = Repo::new();
        let root = temp_dir();
        repo.git(&["branch", "taken"]);
        let path = worktree_path(&root, "refused");

        assert_eq!(
            add_with_brief(&repo.path(), "taken", "main", &path, "PLAN.md", "unused\n"),
            Err(WorktreeError::BranchExists {
                branch: "taken".to_string()
            })
        );
        assert!(!Path::new(&path).exists());
        assert_eq!(list(&repo.path()).unwrap_or_default().len(), 1);
    }

    #[test]
    fn a_name_that_is_a_path_cannot_reach_outside_the_worktree() {
        let repo = Repo::new();
        let root = temp_dir();
        let path = worktree_path(&root, "traversal");

        let made = match add_with_brief(
            &repo.path(),
            "escape",
            "main",
            &path,
            "../PLAN.md",
            "somewhere else\n",
        ) {
            Ok(made) => made,
            Err(error) => panic!("expected the worktree to be reported, got {error:?}"),
        };
        assert_eq!(made.brief, None);
        assert_eq!(
            made.brief_refusal,
            Some(WorktreeError::InvalidBriefName {
                name: "../PLAN.md".to_string()
            })
        );
        // The parent of the worktree is where `..` would have landed.
        let parent = Path::new(&path).parent().map(Path::to_path_buf);
        assert!(!parent.unwrap_or_default().join("PLAN.md").exists());
    }

    #[test]
    fn a_name_that_is_not_a_filename_is_refused_before_anything_is_opened() {
        for name in [
            "",
            ".",
            "..",
            "PLAN.md/",
            ".plan.md",
            "docs/PLAN.md",
            "docs\\PLAN.md",
            "PLAN\n.md",
        ] {
            assert!(!is_filename(name), "{name} should not be a filename");
        }
        for name in ["PLAN.md", "plan.md", "PLAN"] {
            assert!(is_filename(name), "{name} should be a filename");
        }
    }

    #[test]
    fn a_briefed_worktree_is_still_a_worktree_git_will_close() {
        let repo = Repo::new();
        let root = temp_dir();
        let path = worktree_path(&root, "closable");
        assert!(add_with_brief(&repo.path(), "brief", "main", &path, "PLAN.md", "x\n").is_ok());

        // The brief is uncommitted work in that checkout, so the removal is
        // refused — the same refusal any other untracked file earns, and the
        // one this island never overrides.
        match remove(&repo.path(), &path) {
            Err(WorktreeError::Dirty { entries, .. }) => {
                assert!(entries.iter().any(|line| line.ends_with("PLAN.md")));
            }
            other => panic!("expected a dirty refusal, got {other:?}"),
        }

        // Committed, it closes like any other.
        assert!(commit_in(&path, &["add", "PLAN.md"]));
        assert!(commit_in(&path, &["commit", "-m", "brief"]));
        assert_eq!(remove(&repo.path(), &path), Ok(()));
    }
}
