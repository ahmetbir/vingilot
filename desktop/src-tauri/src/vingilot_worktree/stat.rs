//! What a worktree's row in the column says without being opened: git's own
//! `+`/`−` for the uncommitted work in it, and whether there is any
//! (vingilot/docs/plans/2026-08-07-panes-and-polish.md, Task 3).
//!
//! **Why this is not `diff()`.** The column asks a smaller question than the
//! Diff pane does — two numbers and a yes/no, for every worktree of a project
//! at once. `diff()` answers a much larger one: a `git diff` subprocess *per
//! changed file*, each producing a unified patch, up to ~500 of them for one
//! worktree. Reading a column of eleven that way is several thousand
//! subprocesses and every patch in the project held in memory, to render
//! `+12 −3`. So this module reuses that one's `--numstat` reader
//! (`parse_numstat_z`, `nul_fields`) — the same parse of the same git output,
//! not a second opinion about what a rename record looks like — and stops
//! before the patches.
//!
//! **Against `HEAD`, deliberately.** The column's question is "is there
//! anything here I have not committed", so the base is this worktree's own
//! HEAD rather than the branch it came off. Staged and unstaged both count
//! (`git diff HEAD`). Untracked files are counted as *files*, not as lines: a
//! line count for them costs one `git diff --no-index` per file, which is the
//! per-file cost this module exists to avoid, and "3 new files" is what the
//! row has room to say anyway.
//!
//! **Concurrency: one blocking thread, sequentially, capped.** The freeze the
//! Diff pane had to fix was a `#[tauri::command] fn` running git on the
//! webview's IPC thread; the fix was `async` + `spawn_blocking`, and that is
//! what `worktree_stats` does too. It does *not* fan the worktrees out across
//! threads: the per-worktree cost here is two short git reads, the whole batch
//! is one `await` from the UI, and N concurrent `git diff` processes against
//! one repository multiply peak memory and disk seeks for a number the owner
//! reads at a glance. `MAX_PATHS` bounds the batch so that a project with two
//! hundred worktrees cannot turn a refresh into four hundred subprocesses.
//!
//! **A path git cannot read is `unreadable`, never clean.** One worktree on an
//! unmounted volume must not fail the batch, and must not come back as
//! `+0 −0` either — that is a claim that there is nothing there.

use serde::Serialize;

use super::diff::{nul_fields, parse_numstat_z};
use super::{answers_yes, commit, describe, ensure_repo, run, WorktreeError};

/// Worktrees read in one call. Past this the tail comes back unanswered and
/// the column shows it as unknown, which is the honest rendering of a number
/// this app declined to spend four hundred subprocesses on.
const MAX_PATHS: usize = 64;

/// One worktree's uncommitted state, as the column renders it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStat {
    /// The worktree this describes — the key the caller matches its rows on.
    pub path: String,
    /// git's own counts for tracked changes against `HEAD`, staged included.
    /// Binary files contribute nothing to either, the same way `--numstat`
    /// reports them.
    pub additions: usize,
    pub deletions: usize,
    /// Tracked files that differ from `HEAD`. Not derivable from the counts:
    /// a mode-only change is a changed file with zero lines on both sides.
    pub changed_files: usize,
    /// Files git has never seen, `.gitignore` respected.
    pub untracked: usize,
    /// Anything uncommitted at all. The one field the ordering reads.
    pub dirty: bool,
    /// git could not answer for this path. Every count above is then zero
    /// because there is nothing to report, **not** because the tree is clean —
    /// a caller that renders `dirty: false` here as "clean" is making a claim
    /// git never made.
    pub unreadable: bool,
}

fn unreadable(path: &str) -> WorktreeStat {
    WorktreeStat {
        additions: 0,
        changed_files: 0,
        deletions: 0,
        dirty: false,
        path: path.to_string(),
        untracked: 0,
        unreadable: true,
    }
}

/// Uncommitted tracked changes: `(additions, deletions, changed files)`.
///
/// A repository whose first commit has not happened yet has no `HEAD` to diff
/// against, and `git diff HEAD` there is a refusal rather than an empty diff.
/// Everything in such a worktree is untracked, which the caller counts
/// separately, so the answer is three zeros and not an error.
fn tracked(path: &str) -> Result<(usize, usize, usize), WorktreeError> {
    if !answers_yes(path, &["rev-parse", "--verify", "--quiet", &commit("HEAD")])? {
        return Ok((0, 0, 0));
    }
    let args = ["diff", "--numstat", "-z", "--find-renames", "HEAD", "--"];
    let ran = run(path, &args)?;
    if !ran.ok {
        return Err(WorktreeError::GitFailed {
            command: describe(&args),
            stderr: ran.stderr,
        });
    }
    let records = parse_numstat_z(&ran.stdout);
    Ok((
        records.iter().filter_map(|record| record.additions).sum(),
        records.iter().filter_map(|record| record.deletions).sum(),
        records.len(),
    ))
}

/// How many files git has never seen. `--exclude-standard` so a build
/// directory nobody has committed a `.gitignore` rule for is the only kind
/// that counts.
fn untracked_count(path: &str) -> Result<usize, WorktreeError> {
    let args = ["ls-files", "--others", "--exclude-standard", "-z"];
    let ran = run(path, &args)?;
    if !ran.ok {
        return Err(WorktreeError::GitFailed {
            command: describe(&args),
            stderr: ran.stderr,
        });
    }
    Ok(nul_fields(&ran.stdout).len())
}

pub(crate) fn stat(path: &str) -> Result<WorktreeStat, WorktreeError> {
    ensure_repo(path)?;
    let (additions, deletions, changed_files) = tracked(path)?;
    let untracked = untracked_count(path)?;
    Ok(WorktreeStat {
        additions,
        changed_files,
        deletions,
        // Files, not lines: a mode change and an empty new file are both
        // uncommitted work that counts zero on either side.
        dirty: changed_files > 0 || untracked > 0,
        path: path.to_string(),
        untracked,
        unreadable: false,
    })
}

/// Every path's stat, in the order asked. One path that cannot be read comes
/// back as `unreadable` and the rest of the batch still answers — the column
/// is a list, and one bad row must not blank the other ten.
pub(crate) fn stats(paths: &[String]) -> Vec<WorktreeStat> {
    paths
        .iter()
        .take(MAX_PATHS)
        .map(|path| stat(path).unwrap_or_else(|_| unreadable(path)))
        .collect()
}

/// The uncommitted state of every worktree of a project.
///
/// `async`, and the whole batch on a blocking thread, for the reason
/// `diff::worktree_diff` is: a `#[tauri::command] fn` is generated with
/// `ExecutionContext::Blocking` and would run every git subprocess here on the
/// thread the webview's IPC arrives on. See this module's header for why the
/// batch is sequential rather than fanned out.
#[tauri::command]
pub async fn worktree_stats(paths: Vec<String>) -> Result<Vec<WorktreeStat>, WorktreeError> {
    super::off_thread("worktree stats", move || Ok(stats(&paths))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::path::Path;

    use super::super::testrepo::{git_at, temp_dir, worktree_path, write_at, Repo};
    use super::super::{add, remove};

    fn read(path: &str) -> WorktreeStat {
        match stat(path) {
            Ok(answer) => answer,
            Err(error) => panic!("expected a stat, got {error:?}"),
        }
    }

    #[test]
    fn a_clean_worktree_is_not_dirty_and_counts_nothing() {
        let repo = Repo::new();
        let answer = read(&repo.path());
        assert!(!answer.dirty);
        assert!(!answer.unreadable);
        assert_eq!((answer.additions, answer.deletions), (0, 0));
        assert_eq!((answer.changed_files, answer.untracked), (0, 0));
    }

    #[test]
    fn an_edit_is_counted_in_gits_own_numbers() {
        let repo = Repo::new();
        repo.write("README.md", "one\ntwo\nthree\n");
        let answer = read(&repo.path());
        assert!(answer.dirty);
        assert_eq!((answer.additions, answer.deletions), (2, 0));
        assert_eq!(answer.changed_files, 1);
    }

    #[test]
    fn staged_work_counts_too() {
        // `git diff` alone would report nothing here, and the row would say
        // "clean" over an index full of the owner's work.
        let repo = Repo::new();
        repo.write("staged.txt", "a\nb\n");
        repo.git(&["add", "staged.txt"]);
        let answer = read(&repo.path());
        assert!(answer.dirty);
        assert_eq!(answer.additions, 2);
        assert_eq!(answer.changed_files, 1);
        assert_eq!(answer.untracked, 0);
    }

    #[test]
    fn an_untracked_file_is_counted_as_a_file_not_as_lines() {
        let repo = Repo::new();
        repo.write("scratch.txt", "one\ntwo\n");
        let answer = read(&repo.path());
        assert!(answer.dirty);
        assert_eq!(answer.untracked, 1);
        // Counting its lines is a `git diff --no-index` per file, which is the
        // per-file cost this module exists to avoid.
        assert_eq!((answer.additions, answer.deletions), (0, 0));
    }

    #[test]
    fn an_edited_binary_file_counts_no_lines_and_is_still_dirty() {
        // The reason `dirty` is asked of the file count and not of the line
        // counts. `--numstat` prints `-` for both sides of a binary file, so
        // summing the counts would report a changed worktree as clean.
        let repo = Repo::new();
        repo.write_bytes("logo.png", &[0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
        repo.git(&["add", "logo.png"]);
        repo.git(&["commit", "-m", "add a binary"]);
        repo.write_bytes("logo.png", &[0x89, 0x50, 0x4e, 0x47, 0x00, 0x02]);

        let answer = read(&repo.path());
        assert!(answer.dirty);
        assert_eq!(answer.changed_files, 1);
        assert_eq!((answer.additions, answer.deletions), (0, 0));
    }

    #[test]
    fn a_gitignored_file_does_not_make_a_worktree_dirty() {
        let repo = Repo::new();
        repo.write(".gitignore", "build/\n");
        repo.git(&["add", ".gitignore"]);
        repo.git(&["commit", "-m", "ignore build"]);
        if let Err(error) = std::fs::create_dir_all(format!("{}/build", repo.path())) {
            panic!("could not create the build directory: {error}");
        }
        repo.write("build/output.o", "junk\n");
        let answer = read(&repo.path());
        assert!(!answer.dirty);
        assert_eq!(answer.untracked, 0);
    }

    #[test]
    fn a_repository_with_no_commit_yet_answers_rather_than_refusing() {
        // There is no HEAD to diff against, which `git diff HEAD` refuses. The
        // worktree is still readable and everything in it is untracked.
        let dir = temp_dir();
        let path = dir.path().to_string_lossy().into_owned();
        assert!(git_at(&path, &["init", "-b", "main"]));
        write_at(&dir.path().join("first.txt"), "hello\n");
        let answer = read(&path);
        assert!(!answer.unreadable);
        assert!(answer.dirty);
        assert_eq!(answer.untracked, 1);
        assert_eq!(answer.changed_files, 0);
    }

    #[test]
    fn a_worktrees_state_is_its_own_and_not_the_repositorys() {
        let repo = Repo::new();
        let root = temp_dir();
        let path = worktree_path(&root, "fix");
        assert!(add(&repo.path(), "fix", "main", &path).is_ok());

        write_at(&Path::new(&path).join("README.md"), "changed here\n");

        assert!(read(&path).dirty);
        assert!(!read(&repo.path()).dirty);

        // The dirty one is not removable, and that is the rule everywhere.
        assert!(remove(&repo.path(), &path).is_err());
    }

    #[test]
    fn one_unreadable_path_does_not_blank_the_rest_of_the_batch() {
        let repo = Repo::new();
        repo.write("edited.txt", "a\n");
        repo.git(&["add", "edited.txt"]);
        let plain = temp_dir();
        let stranger = plain.path().to_string_lossy().into_owned();

        let answers = stats(&[stranger.clone(), repo.path(), "/nowhere/at/all".to_string()]);
        assert_eq!(answers.len(), 3);
        assert!(answers[0].unreadable);
        assert_eq!(answers[0].path, stranger);
        assert!(!answers[1].unreadable);
        assert!(answers[1].dirty);
        assert!(answers[2].unreadable);
        // Unreadable is not clean: nothing here may be read as "no changes".
        assert!(!answers[2].dirty);
    }

    #[test]
    fn a_batch_past_the_cap_stops_at_the_cap() {
        let repo = Repo::new();
        let paths = vec![repo.path(); MAX_PATHS + 10];
        assert_eq!(stats(&paths).len(), MAX_PATHS);
    }

    #[test]
    fn nothing_here_can_write_to_the_repository() {
        // Every command in this module is a read. The temptation a future edit
        // reaches for is `add -N`, to make git describe an untracked file in
        // lines; it would stage the owner's files as a side effect of drawing
        // a column.
        let repo = Repo::new();
        repo.write("untouched.txt", "leave me out of the index\n");
        let _ = read(&repo.path());
        let listed = run(&repo.path(), &["diff", "--cached", "--name-only"]);
        match listed {
            Ok(ran) => assert_eq!(ran.stdout, "", "the index was written to"),
            Err(error) => panic!("could not read the index: {error:?}"),
        }
    }

    #[test]
    fn the_command_is_async_so_the_batch_never_runs_on_the_ipc_thread() {
        // Same shape assertion as `diff.rs`: only an `async fn` command gets
        // `respond_async_serialized`; a plain `fn` is inlined into the IPC
        // scheme handler, which on macOS/WKWebView is the main thread.
        fn accepts_only_a_future<F: std::future::Future>(_: F) {}
        accepts_only_a_future(worktree_stats(vec!["/nonexistent".to_string()]));
    }
}
