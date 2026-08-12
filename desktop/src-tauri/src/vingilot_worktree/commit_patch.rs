//! The patch of one commit
//! (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 4).
//!
//! > *"The diff pane already renders patches; a commit is another patch source,
//! > so this is mostly about where the patch comes from rather than how it is
//! > drawn."*
//!
//! So this module answers a [`WorktreeDiff`] — **the same type `worktree_diff`
//! returns**, under the same caps, produced by the same parsers and the same
//! `truncate_patch` — and `features/runs/ui/PatchView.tsx` draws it with the
//! component the Diff pane draws with. There is no second patch shape and no
//! second renderer; the only thing that differs between the two commands is
//! which two trees git is asked about.
//!
//! **Everything here reads.** `git diff`, `git diff-tree` and `git rev-list`,
//! and nothing else — no checkout, no cherry-pick, no revert, no index touch.
//! `the_commit_commands_never_carry_a_write_verb` fails a future edit that
//! reaches for one.
//!
//! ## Which two trees, and why it is not `git show`
//!
//! `git show <commit>` is the obvious answer and it is wrong for a third of the
//! commits in a repository: **for a merge it prints the log entry and no patch
//! at all**, so a merge would arrive here as "nothing changed", which is a claim
//! about the owner's history that is not true. Measured on the installed git.
//!
//! So the left-hand side is resolved explicitly, from `git rev-list --parents`:
//!
//! - **One parent** — the ordinary case. `git diff <parent> <commit>`.
//! - **More than one** — a merge. `git diff <first parent> <commit>`, which is
//!   *what this merge brought into the branch it was merged into*. That is a
//!   choice rather than the only answer — the other parents' diffs exist too —
//!   so it is reported (`merge`, `parent`) instead of being left to look like
//!   the whole story.
//! - **No parent at all** — the first commit in the repository. There is nothing
//!   to name on the left, so this is the one case that uses different plumbing:
//!   `git diff-tree --root`, which is git's own way of saying "against nothing".
//!   The alternative was hard-coding the empty tree's hash, which is a different
//!   constant per hash algorithm and would be wrong on a SHA-256 repository.
//!
//! All three are driven by tests against a real repository, because the merge
//! case in particular is invisible from any argument-vector assertion.

use serde::Serialize;

use super::diff::{
    nul_fields, parse_name_status_z, parse_numstat_z, truncate_patch, DiffFile, DiffLimits,
    FileChange, NumStat, WorktreeDiff, MAX_FILES, MAX_PATCH_BYTES, MAX_PATCH_LINES, MAX_UNTRACKED,
    READ_PATCH_BYTES,
};
use super::log::{one, Commit};
use super::{describe, ensure_repo, run, run_capped, WorktreeError};

/// What `WorktreeDiff::base` says for the first commit in a repository. Not a
/// ref, and deliberately not one: nothing can be passed back as this, and it is
/// literally what git diffed against. Reads correctly in the pane's own
/// sentence — "+12 −0 vs the empty tree".
const EMPTY_TREE: &str = "the empty tree";

/// Flags every read below carries.
///
/// `--no-ext-diff` so a `diff.external` in the owner's config cannot put another
/// program's output where a patch should be, and `--no-color` so a
/// `color.ui = always` cannot put ANSI escapes inside one — the same two
/// guards `diff.rs` and `vingilot_search` state for the same reasons.
const COMMON: [&str; 3] = ["--no-ext-diff", "--no-color", "--find-renames"];

/// Which two trees a commit's patch comes from. See this module's header.
enum Source {
    /// A commit with a parent, read against that parent.
    Against { parent: String, commit: String },
    /// A commit with no parent, read against nothing by git's own `--root`.
    Root { commit: String },
}

/// The argument vector for one read of this source.
///
/// **One builder for both shapes**, so the flags cannot drift apart between the
/// root case and every other case — which is exactly the kind of difference that
/// makes the first commit in a repository render subtly unlike the rest.
///
/// `shape` is what this particular read wants out of git (`--numstat -z`,
/// `--name-status -z`, `-p --unified=3`). `-p` is passed for the patch even
/// though `git diff` produces one by default, because `git diff-tree` does not.
fn source_args<'a>(source: &'a Source, shape: &[&'a str], paths: &[&'a str]) -> Vec<&'a str> {
    let mut args: Vec<&str> = match source {
        Source::Against { .. } => vec!["diff"],
        Source::Root { .. } => vec!["diff-tree", "--no-commit-id", "--root", "-r"],
    };
    args.extend_from_slice(&COMMON);
    args.extend_from_slice(shape);
    match source {
        Source::Against { commit, parent } => {
            args.push(parent);
            args.push(commit);
        }
        Source::Root { commit } => args.push(commit),
    }
    args.push("--");
    args.extend_from_slice(paths);
    args
}

/// Every parent of a commit, in git's order. Empty for the first commit in a
/// repository.
fn parents(worktree: &str, hash: &str) -> Result<Vec<String>, WorktreeError> {
    let args = ["rev-list", "--parents", "--max-count=1", hash, "--"];
    let ran = run(worktree, &args)?;
    if !ran.ok {
        return Err(WorktreeError::GitFailed {
            command: describe(&args),
            stderr: ran.stderr,
        });
    }
    // One line: the commit's own hash, then its parents'.
    Ok(ran
        .stdout
        .split_whitespace()
        .skip(1)
        .map(str::to_string)
        .collect())
}

/// Read a list-shaped answer about this source. Unbounded (`run`) on purpose:
/// its size is the shape of one commit, not the contents of a file. A patch is
/// the other thing, and goes through `run_capped`.
fn listing(worktree: &str, source: &Source, shape: &[&str]) -> Result<String, WorktreeError> {
    let args = source_args(source, shape, &[]);
    let ran = run(worktree, &args)?;
    if !ran.ok {
        return Err(WorktreeError::GitFailed {
            command: describe(&args),
            stderr: ran.stderr,
        });
    }
    Ok(ran.stdout)
}

/// One file's patch out of this commit.
///
/// A patch git would not produce is a refusal and not an empty string, for the
/// reason `diff.rs` gives at length: an empty patch beside `+3 −1` renders as
/// "no textual change to show", which is a positive claim, and it may only be
/// made when git actually said so.
fn patch_for(worktree: &str, source: &Source, file: &NumStat) -> Result<String, WorktreeError> {
    let mut paths = vec![file.path.as_str()];
    if let Some(old) = file.old_path.as_deref() {
        paths.push(old);
    }
    let args = source_args(source, &["-p", "--unified=3"], &paths);
    let ran = run_capped(worktree, &args, READ_PATCH_BYTES)?;
    if !ran.ok {
        return Err(WorktreeError::GitFailed {
            command: describe(&args),
            stderr: ran.stderr,
        });
    }
    Ok(ran.stdout)
}

/// The changed files of one commit, capped at `max_files`.
fn changed(
    worktree: &str,
    source: &Source,
    max_files: usize,
) -> Result<Vec<DiffFile>, WorktreeError> {
    let counted = parse_numstat_z(&listing(worktree, source, &["--numstat", "-z"])?);
    // Not `unwrap_or_default()`: an empty status list makes every file
    // "Modified", so a file this commit added would be shown as one it edited.
    let statuses = parse_name_status_z(&listing(worktree, source, &["--name-status", "-z"])?);

    counted
        .into_iter()
        .take(max_files)
        .map(|file| {
            let change = statuses
                .iter()
                .find(|(path, _)| *path == file.path)
                .map(|(_, change)| *change)
                // A file git counted but did not classify. Reported as itself
                // rather than as an edit that may not have happened.
                .unwrap_or(FileChange::Other);
            let binary = file.additions.is_none();
            let (patch, truncated) = if binary {
                (String::new(), false)
            } else {
                truncate_patch(patch_for(worktree, source, &file)?)
            };
            Ok(DiffFile {
                additions: file.additions.unwrap_or(0),
                binary,
                change,
                deletions: file.deletions.unwrap_or(0),
                old_path: file.old_path,
                patch,
                path: file.path,
                truncated,
            })
        })
        .collect()
}

/// How many of this commit's files were not listed.
///
/// A failure here is returned rather than counted as zero, for the reason
/// `diff.rs` gives: zero omitted files is what *suppresses* the omission
/// banner, so swallowing this would hide the truncation the banner exists to
/// announce.
fn beyond_cap(
    worktree: &str,
    source: &Source,
    listed: usize,
    max_files: usize,
) -> Result<usize, WorktreeError> {
    if listed < max_files {
        return Ok(0);
    }
    let all = listing(worktree, source, &["--name-only", "-z"])?;
    Ok(nul_fields(&all).len().saturating_sub(listed))
}

/// One commit, its patch, and where its left-hand side came from.
///
/// `diff` is the very same `WorktreeDiff` the Diff pane renders — see this
/// module's header. `parent` and `merge` are beside it rather than inside it
/// because they are facts about the *commit*, and `WorktreeDiff` is a shape that
/// has to keep meaning the same thing for both commands that answer it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitPatch {
    pub commit: Commit,
    /// The commit this was read against — the first parent — or `None` for the
    /// first commit in the repository.
    pub parent: Option<String>,
    /// This commit has more than one parent, so what is below is what it brought
    /// into its first parent's branch and not the whole of what it joined. Said
    /// out loud because the alternative is a partial answer that looks complete.
    pub merge: bool,
    pub diff: WorktreeDiff,
}

/// One commit's patch, with the file cap handed in.
///
/// **`max_files` is a parameter rather than [`MAX_FILES`] read straight off the
/// constant**, for the reason `log_bounded` gives about the page size and
/// `status_bounded` about the entry cap: `omitted_files` is the field whose
/// failure mode is silent — zero omitted is what *suppresses* the pane's
/// omission banner — and proving it at 400 means a fixture that commits 401
/// files. With the cap injectable, a three-file commit read at two proves the
/// whole path.
fn commit_patch_bounded(
    worktree: &str,
    hash: &str,
    max_files: usize,
) -> Result<CommitPatch, WorktreeError> {
    ensure_repo(worktree)?;

    // The record first: it is also the existence check, and a commit this
    // repository has never heard of is a refusal rather than an empty patch —
    // "this commit changed nothing" is a claim, and it may not be made from a
    // question that failed.
    let Some(commit) = one(worktree, hash)? else {
        return Err(WorktreeError::UnknownBase {
            base: hash.to_string(),
        });
    };

    let parents = parents(worktree, &commit.hash)?;
    let parent = parents.first().cloned();
    let source = match parent.clone() {
        Some(parent) => Source::Against {
            commit: commit.hash.clone(),
            parent,
        },
        None => Source::Root {
            commit: commit.hash.clone(),
        },
    };

    let files = changed(worktree, &source, max_files)?;
    let omitted_files = beyond_cap(worktree, &source, files.len(), max_files)?;

    Ok(CommitPatch {
        diff: WorktreeDiff {
            additions: files.iter().map(|file| file.additions).sum(),
            base: parent.clone().unwrap_or_else(|| EMPTY_TREE.to_string()),
            deletions: files.iter().map(|file| file.deletions).sum(),
            files,
            limits: DiffLimits {
                // The cap that was applied, not the constant: the pane quotes
                // this number in the sentence that says what was left out.
                max_files,
                max_patch_bytes: MAX_PATCH_BYTES,
                max_patch_lines: MAX_PATCH_LINES,
                // Carried because the shape carries it, and it is honestly zero
                // work here: a commit has no untracked files, which is why
                // `omitted_untracked` below is 0 and not a number that was cut.
                max_untracked: MAX_UNTRACKED,
            },
            omitted_files,
            omitted_untracked: 0,
        },
        merge: parents.len() > 1,
        parent,
        commit,
    })
}

pub(crate) fn commit_patch(worktree: &str, hash: &str) -> Result<CommitPatch, WorktreeError> {
    commit_patch_bounded(worktree, hash, MAX_FILES)
}

/// The patch of one commit in one worktree.
///
/// `async`, and the whole read on a blocking thread, for the reason
/// `off_thread` documents: this is one `git diff` per changed file, and a `fn`
/// command would run every one of them on the thread the webview's IPC arrives
/// on.
#[tauri::command]
pub async fn commit_diff(path: String, commit: String) -> Result<CommitPatch, WorktreeError> {
    super::off_thread("commit diff", move || commit_patch(&path, &commit)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    use super::super::testrepo::{temp_dir, Repo};

    fn read(worktree: &str, hash: &str) -> CommitPatch {
        match commit_patch(worktree, hash) {
            Ok(answer) => answer,
            Err(error) => panic!("expected a commit patch, got {error:?}"),
        }
    }

    fn head(repo: &Repo) -> String {
        let page = super::super::log::log_bounded(&repo.path(), None, 1).expect("a page");
        page.commits[0].hash.clone()
    }

    fn file<'a>(answer: &'a CommitPatch, path: &str) -> &'a DiffFile {
        match answer.diff.files.iter().find(|file| file.path == path) {
            Some(file) => file,
            None => panic!(
                "{path} is not in the patch; it lists {:?}",
                answer
                    .diff
                    .files
                    .iter()
                    .map(|f| &f.path)
                    .collect::<Vec<_>>()
            ),
        }
    }

    #[test]
    fn an_ordinary_commit_is_read_against_its_parent() {
        let repo = Repo::new();
        repo.write("README.md", "one\ntwo\n");
        repo.write("added.txt", "new\n");
        repo.git(&["add", "README.md", "added.txt"]);
        repo.git(&["commit", "-m", "second"]);

        let answer = read(&repo.path(), &head(&repo));
        assert!(!answer.merge);
        assert!(answer.parent.is_some());
        assert_eq!(answer.diff.base, answer.parent.clone().unwrap_or_default());
        assert_eq!(answer.commit.subject, "second");

        assert_eq!(file(&answer, "added.txt").change, FileChange::Added);
        let readme = file(&answer, "README.md");
        assert_eq!(readme.change, FileChange::Modified);
        assert_eq!((readme.additions, readme.deletions), (1, 0));
        assert!(readme.patch.contains("+two"));
        // The totals are of what is listed, and nothing was left out.
        assert_eq!(answer.diff.additions, 2);
        assert_eq!(answer.diff.omitted_files, 0);
        // A commit has no untracked files, and this is the honest zero.
        assert_eq!(answer.diff.omitted_untracked, 0);
    }

    #[test]
    fn the_first_commit_in_a_repository_has_a_patch_rather_than_nothing() {
        // The case with no left-hand side to name. Without `--root` this is an
        // empty answer, which reads as "the repository began with no files".
        let repo = Repo::new();
        let root = head(&repo);
        let answer = read(&repo.path(), &root);

        assert_eq!(answer.parent, None);
        assert!(!answer.merge);
        assert_eq!(answer.diff.base, EMPTY_TREE);
        let readme = file(&answer, "README.md");
        assert_eq!(readme.change, FileChange::Added);
        assert_eq!(readme.additions, 1);
        assert!(readme.patch.contains("+one"));
    }

    #[test]
    fn a_merge_is_read_against_its_first_parent_and_says_that_it_is_a_merge() {
        // **The case `git show` answers with nothing.** Measured: `git show` on
        // a merge prints the log entry and no patch, so a build that used it
        // would render this commit as "nothing changed" — a claim about the
        // owner's history that is false.
        let repo = Repo::new();
        repo.git(&["checkout", "-q", "-b", "side"]);
        repo.write("from-side.txt", "s\n");
        repo.git(&["add", "from-side.txt"]);
        repo.git(&["commit", "-m", "on side"]);
        repo.git(&["checkout", "-q", "main"]);
        repo.write("on-main.txt", "m\n");
        repo.git(&["add", "on-main.txt"]);
        repo.git(&["commit", "-m", "on main"]);
        repo.git(&["merge", "--no-ff", "-m", "merge side", "side"]);

        let answer = read(&repo.path(), &head(&repo));
        assert!(answer.merge, "a merge must say it is one");
        assert!(answer.parent.is_some());
        // What the merge brought in, against the branch it was merged into.
        assert_eq!(answer.diff.files.len(), 1);
        assert_eq!(file(&answer, "from-side.txt").change, FileChange::Added);
        // And not the other parent's side of it, which would be `on-main.txt`
        // and is what `diff-tree -m` hands back for a merge — two diffs
        // interleaved under one list.
        assert!(!answer
            .diff
            .files
            .iter()
            .any(|entry| entry.path == "on-main.txt"));
    }

    #[test]
    fn a_rename_carries_where_it_came_from() {
        let repo = Repo::new();
        repo.write("move-me.txt", "unchanged content\n");
        repo.git(&["add", "move-me.txt"]);
        repo.git(&["commit", "-m", "add it"]);
        repo.git(&["mv", "move-me.txt", "moved.txt"]);
        repo.git(&["commit", "-am", "move it"]);

        let answer = read(&repo.path(), &head(&repo));
        let renamed = file(&answer, "moved.txt");
        assert_eq!(renamed.change, FileChange::Renamed);
        assert_eq!(renamed.old_path.as_deref(), Some("move-me.txt"));
    }

    #[test]
    fn a_binary_file_says_so_instead_of_rendering_an_empty_patch() {
        let repo = Repo::new();
        repo.write_bytes("logo.png", &[0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
        repo.git(&["add", "logo.png"]);
        repo.git(&["commit", "-m", "add a binary"]);

        let answer = read(&repo.path(), &head(&repo));
        let binary = file(&answer, "logo.png");
        assert!(binary.binary);
        assert_eq!(binary.patch, "");
        // Zero counts here mean "lines are not the unit" — which is why the
        // flag exists rather than the counts being read as "no change".
        assert_eq!((binary.additions, binary.deletions), (0, 0));
    }

    #[test]
    fn a_huge_patch_is_cut_at_the_same_cap_the_diff_pane_uses() {
        // The caps are `diff.rs`'s, applied by `diff.rs`'s own `truncate_patch`
        // — a second set of numbers over here would be right until the day one
        // of them changed.
        let repo = Repo::new();
        repo.write(
            "run.log",
            &"0123456789abcde\n".repeat(MAX_PATCH_LINES + 500),
        );
        repo.git(&["add", "run.log"]);
        repo.git(&["commit", "-m", "an agent's log"]);

        let answer = read(&repo.path(), &head(&repo));
        let log = file(&answer, "run.log");
        assert!(log.truncated, "a patch past the cap must say it was cut");
        assert!(log.patch.len() <= MAX_PATCH_BYTES);
        assert_eq!(answer.diff.limits.max_patch_lines, MAX_PATCH_LINES);
    }

    #[test]
    fn past_the_file_cap_the_rest_are_counted_rather_than_silently_dropped() {
        // **The field whose failure mode is silent.** `omitted_files == 0` is
        // what *suppresses* the pane's omission banner, so a zero returned by
        // mistake renders a commit that touched a hundred files as one that
        // touched four hundred — with nothing on screen saying otherwise. Every
        // other assertion in this module is about a commit that fits.
        //
        // Read at a cap of two rather than at `MAX_FILES`, which is why
        // `commit_patch_bounded` takes it: proving this at 400 means committing
        // 401 files per run.
        let repo = Repo::new();
        for name in ["a.txt", "b.txt", "c.txt"] {
            repo.write(name, "new\n");
        }
        repo.git(&["add", "a.txt", "b.txt", "c.txt"]);
        repo.git(&["commit", "-m", "three files"]);

        let answer = match commit_patch_bounded(&repo.path(), &head(&repo), 2) {
            Ok(answer) => answer,
            Err(error) => panic!("expected a commit patch, got {error:?}"),
        };
        assert_eq!(answer.diff.files.len(), 2);
        assert_eq!(
            answer.diff.omitted_files, 1,
            "three files, two of them read"
        );
        // The cap the answer quotes is the cap that was applied, so the pane's
        // sentence cannot name a number nothing was held to.
        assert_eq!(answer.diff.limits.max_files, 2);

        // And the same commit under the real cap leaves nothing out, so the
        // count above is the cap doing its work rather than the fixture.
        let whole = read(&repo.path(), &head(&repo));
        assert_eq!(whole.diff.files.len(), 3);
        assert_eq!(whole.diff.omitted_files, 0);
        assert_eq!(whole.diff.limits.max_files, MAX_FILES);
    }

    #[test]
    fn a_commit_this_repository_has_never_heard_of_is_a_refusal_not_an_empty_patch() {
        // "This commit changed nothing" is a claim, and it may not be made from
        // a question that failed.
        let repo = Repo::new();
        let missing = "0".repeat(40);
        assert_eq!(
            commit_patch(&repo.path(), &missing),
            Err(WorktreeError::UnknownBase { base: missing })
        );
    }

    #[test]
    fn a_directory_that_is_not_a_repository_is_refused() {
        let plain = temp_dir();
        let path = plain.path().to_string_lossy().into_owned();
        assert_eq!(
            commit_patch(&path, "HEAD"),
            Err(WorktreeError::NotARepo { path })
        );
    }

    // ---------------------------------------------------------------------
    // the promise in this module's header
    // ---------------------------------------------------------------------

    #[test]
    fn the_commit_commands_never_carry_a_write_verb() {
        let against = Source::Against {
            commit: "b".repeat(40),
            parent: "a".repeat(40),
        };
        let root = Source::Root {
            commit: "c".repeat(40),
        };
        for source in [&against, &root] {
            for shape in [
                ["--numstat", "-z"],
                ["--name-status", "-z"],
                ["-p", "--unified=3"],
            ] {
                let args = source_args(source, &shape, &["a.txt"]);
                for arg in args {
                    for forbidden in [
                        "--cached",
                        "--staged",
                        "-N",
                        "--intent-to-add",
                        "add",
                        "commit",
                        "checkout",
                        "reset",
                        "revert",
                        "cherry-pick",
                        "--force",
                    ] {
                        assert_ne!(arg, forbidden, "a read may not carry {forbidden}");
                    }
                }
            }
        }
    }

    #[test]
    fn the_root_shape_is_the_only_one_that_names_a_single_tree() {
        // The distinction the header is about, made checkable: an `Against`
        // read names both sides, a `Root` read names one and says `--root`.
        let parented = Source::Against {
            commit: "b".repeat(40),
            parent: "a".repeat(40),
        };
        let against = source_args(&parented, &["--numstat", "-z"], &[]);
        assert_eq!(against[0], "diff");
        assert!(!against.contains(&"--root"));

        let first = Source::Root {
            commit: "c".repeat(40),
        };
        let root = source_args(&first, &["--numstat", "-z"], &[]);
        assert_eq!(root[0], "diff-tree");
        assert!(root.contains(&"--root"));
        assert!(root.contains(&"--no-commit-id"));
    }

    #[test]
    fn the_command_is_async_so_the_read_never_runs_on_the_ipc_thread() {
        fn accepts_only_a_future<F: std::future::Future>(_: F) {}
        accepts_only_a_future(commit_diff("/nonexistent".to_string(), "HEAD".to_string()));
    }
}
