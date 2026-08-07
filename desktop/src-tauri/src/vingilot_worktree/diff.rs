//! Reading a worktree's changes — the window this app has to replace last
//! (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 7).
//!
//! What the owner opens VS Code for, in the screenshot this plan was written
//! from, is a side-by-side diff. So: the changed files of one worktree against
//! a base ref, each with git's own `+`/`−` counts and its unified patch.
//!
//! **The working tree, not a commit range.** `git diff <base>` compares the
//! base against the files as they are on disk right now, which is the question
//! being asked — "what have I changed" — and is why this cannot be the
//! coordinator's stored diff evidence, which only ever describes what a Run
//! already committed. Untracked files are listed too, from `ls-files
//! --others`: a file an agent has just created is the single most interesting
//! thing in a worktree, and `git diff` alone would not mention it exists.
//!
//! **Nothing here writes.** No `add`, no `add -N`, no stash, no index touch of
//! any kind — every command in this module is a read, and an untracked file's
//! patch comes from `--no-index` against `/dev/null` rather than from staging
//! it to make git talk about it.
//!
//! **Every limit is reported, not silently applied.** A worktree can hold a
//! regenerated lockfile, a vendored bundle on one line, or ten thousand
//! changed files; rendering all of it would freeze the webview, and rendering
//! part of it while implying it is the whole is worse than either. So each cap
//! travels back with the answer (`DiffLimits`) alongside what it actually cut
//! (`omitted_files`, `omitted_untracked`, per-file `truncated`), and
//! `features/runs/ui/WorktreeDiffPanel.tsx` puts those numbers on screen.

use serde::Serialize;

use super::{answers_yes, commit, describe, ensure_repo, run, WorktreeError};

/// Files rendered before the list is cut. 400 is far past the point a human
/// reads file-by-field, and far below the point the DOM struggles.
const MAX_FILES: usize = 400;

/// Untracked files rendered. Lower than `MAX_FILES` because each one costs a
/// `git diff --no-index` of its own, and an untracked tree that big (a build
/// output directory nobody has gitignored yet) is a thing to notice rather
/// than to page through.
const MAX_UNTRACKED: usize = 100;

/// Patch lines kept per file. One regenerated lockfile is tens of thousands.
const MAX_PATCH_LINES: usize = 2_000;

/// Patch bytes kept per file, for the file that is 40 lines and 8 MB — a
/// minified bundle is one line per file, so a line cap alone does not bound
/// anything.
const MAX_PATCH_BYTES: usize = 256 * 1024;

/// What happened to a file, in the vocabulary `git diff --name-status` uses,
/// plus the one status git has no letter for because it is not in the diff at
/// all.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileChange {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    /// A file's type changed (a regular file became a symlink, say).
    TypeChanged,
    /// git knows nothing about this file yet. Not a `git diff` status —
    /// `ls-files --others --exclude-standard` is where these come from.
    Untracked,
    /// A status letter this build does not know. Reported as itself rather
    /// than guessed at.
    Other,
}

/// One changed file.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    pub path: String,
    /// Where a renamed or copied file came from.
    pub old_path: Option<String>,
    pub change: FileChange,
    /// git's own counts. Both zero for a binary file, where lines are not a
    /// meaningful unit — `binary` is what says so, not a zero count.
    pub additions: usize,
    pub deletions: usize,
    /// git will not produce a textual patch for this file. The UI says so
    /// instead of rendering an empty diff that reads as "no changes".
    pub binary: bool,
    /// The unified patch, or empty for a binary file.
    pub patch: String,
    /// The patch was cut at `MAX_PATCH_LINES` or `MAX_PATCH_BYTES`.
    pub truncated: bool,
}

/// The caps this answer was produced under, so the UI states the real numbers
/// rather than a second copy of them that can drift from these.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLimits {
    pub max_files: usize,
    pub max_untracked: usize,
    pub max_patch_lines: usize,
    pub max_patch_bytes: usize,
}

/// A worktree's changes against a base.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDiff {
    /// The ref this was diffed against, as given.
    pub base: String,
    pub files: Vec<DiffFile>,
    /// Summed over the files below — over the ones *listed*, which is why the
    /// omitted counts have to be on screen next to it.
    pub additions: usize,
    pub deletions: usize,
    /// Changed files beyond `max_files`, counted but not read.
    pub omitted_files: usize,
    /// Untracked files beyond `max_untracked`.
    pub omitted_untracked: usize,
    pub limits: DiffLimits,
}

/// One `--numstat -z` record. `additions: None` is git's `-` for a binary
/// file, which is not the same as zero added lines.
#[derive(Clone, Debug, Eq, PartialEq)]
struct NumStat {
    path: String,
    old_path: Option<String>,
    additions: Option<usize>,
    deletions: Option<usize>,
}

/// Split a NUL-delimited stream into its fields, dropping the empty tail the
/// trailing separator leaves behind.
fn nul_fields(text: &str) -> Vec<&str> {
    text.split('\0').filter(|field| !field.is_empty()).collect()
}

fn count(field: &str) -> Option<usize> {
    field.parse::<usize>().ok()
}

/// Parse `git diff --numstat -z`.
///
/// `-z` and not the plain format: without it git quotes and C-escapes any path
/// that is not plain ASCII, so `"süt.txt"` comes back as `"s\303\274t.txt"`
/// and a path with a tab in it is unparseable. With `-z` a record is
/// `adds\tdels\tpath\0`, and a rename is `adds\tdels\t\0old\0new\0` — the
/// empty third column is what says two more fields follow.
fn parse_numstat_z(text: &str) -> Vec<NumStat> {
    let fields = nul_fields(text);
    let mut records = Vec::new();
    let mut index = 0;
    while index < fields.len() {
        let mut parts = fields[index].splitn(3, '\t');
        let (Some(added), Some(deleted), Some(path)) = (parts.next(), parts.next(), parts.next())
        else {
            index += 1;
            continue;
        };
        index += 1;
        let (old_path, path) = if path.is_empty() {
            let old = fields.get(index).map(|f| (*f).to_string());
            let new = fields.get(index + 1).map(|f| (*f).to_string());
            index += 2;
            match (old, new) {
                (Some(old), Some(new)) => (Some(old), new),
                _ => continue,
            }
        } else {
            (None, path.to_string())
        };
        records.push(NumStat {
            additions: count(added),
            deletions: count(deleted),
            old_path,
            path,
        });
    }
    records
}

fn change_from_letter(status: &str) -> FileChange {
    match status.chars().next() {
        Some('A') => FileChange::Added,
        Some('M') => FileChange::Modified,
        Some('D') => FileChange::Deleted,
        Some('R') => FileChange::Renamed,
        Some('C') => FileChange::Copied,
        Some('T') => FileChange::TypeChanged,
        _ => FileChange::Other,
    }
}

/// Parse `git diff --name-status -z` into (path, change) pairs. Rename and
/// copy records carry two paths; the second is the one the file is at now,
/// which is the one every other list here is keyed by.
fn parse_name_status_z(text: &str) -> Vec<(String, FileChange)> {
    let fields = nul_fields(text);
    let mut records = Vec::new();
    let mut index = 0;
    while index < fields.len() {
        let change = change_from_letter(fields[index]);
        let paths = match change {
            FileChange::Renamed | FileChange::Copied => 2,
            _ => 1,
        };
        let Some(path) = fields.get(index + paths) else {
            break;
        };
        records.push(((*path).to_string(), change));
        index += paths + 1;
    }
    records
}

/// Cut a patch to the line and byte caps, saying whether anything was cut.
///
/// The byte cut lands on a char boundary and then backs up to the last
/// newline, so a truncated patch never ends mid-line — a half line of diff
/// reads as content rather than as an edge.
fn truncate_patch(patch: String) -> (String, bool) {
    let line_cut = patch
        .char_indices()
        .filter(|(_, c)| *c == '\n')
        .map(|(index, _)| index)
        .nth(MAX_PATCH_LINES - 1);
    let byte_cut = if patch.len() > MAX_PATCH_BYTES {
        let mut at = MAX_PATCH_BYTES;
        while at > 0 && !patch.is_char_boundary(at) {
            at -= 1;
        }
        Some(patch[..at].rfind('\n').unwrap_or(at))
    } else {
        None
    };
    match line_cut.into_iter().chain(byte_cut).min() {
        Some(cut) => (patch[..cut].to_string(), true),
        None => (patch, false),
    }
}

/// Whether a patch is git saying "this is binary" rather than a patch.
fn says_binary(patch: &str) -> bool {
    patch
        .lines()
        .any(|line| line.starts_with("Binary files ") || line.starts_with("GIT binary patch"))
}

/// Lines a `--no-index` patch adds — the additions count for an untracked
/// file, since `--numstat` would have to be a second subprocess to learn the
/// same thing. `+++` is the header, not an added line.
fn added_lines(patch: &str) -> usize {
    patch
        .lines()
        .filter(|line| line.starts_with('+') && !line.starts_with("+++"))
        .count()
}

fn diff_args<'a>(base: &'a str, paths: &[&'a str]) -> Vec<&'a str> {
    let mut args = vec![
        "diff",
        "--no-ext-diff",
        "--no-color",
        "--find-renames",
        "--unified=3",
        base,
        "--",
    ];
    args.extend_from_slice(paths);
    args
}

fn patch_for(worktree: &str, base: &str, file: &NumStat) -> String {
    let mut paths = vec![file.path.as_str()];
    if let Some(old) = file.old_path.as_deref() {
        paths.push(old);
    }
    run(worktree, &diff_args(base, &paths))
        .map(|ran| ran.stdout)
        .unwrap_or_default()
}

/// The patch for a file git has never seen, against nothing.
///
/// `--no-index` puts git in "compare two paths" mode, where it exits 1 to mean
/// "they differ" — the normal outcome here — so this reads stdout rather than
/// the status. An empty new file legitimately produces no patch at all, and is
/// reported as the zero-addition file it is.
fn untracked_patch(worktree: &str, path: &str) -> String {
    run(
        worktree,
        &[
            "diff",
            "--no-ext-diff",
            "--no-color",
            "--no-index",
            "--unified=3",
            "--",
            "/dev/null",
            path,
        ],
    )
    .map(|ran| ran.stdout)
    .unwrap_or_default()
}

fn tracked_changes(worktree: &str, base: &str) -> Result<Vec<DiffFile>, WorktreeError> {
    let numstat_args = ["diff", "--numstat", "-z", "--find-renames", base, "--"];
    let ran = run(worktree, &numstat_args)?;
    if !ran.ok {
        return Err(WorktreeError::GitFailed {
            command: describe(&numstat_args),
            stderr: ran.stderr,
        });
    }
    let counted = parse_numstat_z(&ran.stdout);

    let status_args = ["diff", "--name-status", "-z", "--find-renames", base, "--"];
    let statuses = run(worktree, &status_args)
        .map(|ran| parse_name_status_z(&ran.stdout))
        .unwrap_or_default();

    Ok(counted
        .into_iter()
        .take(MAX_FILES)
        .map(|file| {
            let change = statuses
                .iter()
                .find(|(path, _)| *path == file.path)
                .map(|(_, change)| *change)
                .unwrap_or(FileChange::Modified);
            let binary = file.additions.is_none();
            let (patch, truncated) = if binary {
                (String::new(), false)
            } else {
                truncate_patch(patch_for(worktree, base, &file))
            };
            DiffFile {
                additions: file.additions.unwrap_or(0),
                binary,
                change,
                deletions: file.deletions.unwrap_or(0),
                old_path: file.old_path,
                patch,
                path: file.path,
                truncated,
            }
        })
        .collect())
}

fn untracked_changes(worktree: &str) -> (Vec<DiffFile>, usize) {
    let listed = run(
        worktree,
        &["ls-files", "--others", "--exclude-standard", "-z"],
    )
    .map(|ran| {
        nul_fields(&ran.stdout)
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>()
    })
    .unwrap_or_default();

    let omitted = listed.len().saturating_sub(MAX_UNTRACKED);
    let files = listed
        .into_iter()
        .take(MAX_UNTRACKED)
        .map(|path| {
            let raw = untracked_patch(worktree, &path);
            let binary = says_binary(&raw);
            let additions = if binary { 0 } else { added_lines(&raw) };
            let (patch, truncated) = if binary {
                (String::new(), false)
            } else {
                truncate_patch(raw)
            };
            DiffFile {
                additions,
                binary,
                change: FileChange::Untracked,
                deletions: 0,
                old_path: None,
                patch,
                path,
                truncated,
            }
        })
        .collect();
    (files, omitted)
}

fn diff(worktree: &str, base: &str) -> Result<WorktreeDiff, WorktreeError> {
    ensure_repo(worktree)?;
    if !answers_yes(
        worktree,
        &["rev-parse", "--verify", "--quiet", &commit(base)],
    )? {
        return Err(WorktreeError::UnknownBase {
            base: base.to_string(),
        });
    }

    let tracked = tracked_changes(worktree, base)?;
    // Only the listed files are summed. The count of what was left out rides
    // alongside so the total is never read as "everything".
    let omitted_files = count_beyond_cap(worktree, base, tracked.len());
    let (untracked, omitted_untracked) = untracked_changes(worktree);

    let mut files = tracked;
    files.extend(untracked);
    Ok(WorktreeDiff {
        additions: files.iter().map(|file| file.additions).sum(),
        base: base.to_string(),
        deletions: files.iter().map(|file| file.deletions).sum(),
        files,
        limits: DiffLimits {
            max_files: MAX_FILES,
            max_patch_bytes: MAX_PATCH_BYTES,
            max_patch_lines: MAX_PATCH_LINES,
            max_untracked: MAX_UNTRACKED,
        },
        omitted_files,
        omitted_untracked,
    })
}

/// How many changed files were not listed. Asked separately, and cheaply
/// (`--name-only`), because `tracked_changes` stops reading at the cap and so
/// cannot know how far past it the real list went.
fn count_beyond_cap(worktree: &str, base: &str, listed: usize) -> usize {
    if listed < MAX_FILES {
        return 0;
    }
    run(
        worktree,
        &["diff", "--name-only", "-z", "--find-renames", base, "--"],
    )
    .map(|ran| nul_fields(&ran.stdout).len().saturating_sub(listed))
    .unwrap_or(0)
}

/// One worktree's changes against `base`, working tree included.
///
/// `path` is the worktree, not the repository: a linked worktree has its own
/// working files and its own `HEAD`, and `git -C <worktree>` is how you ask
/// about them.
#[tauri::command]
pub fn worktree_diff(path: String, base: String) -> Result<WorktreeDiff, WorktreeError> {
    diff(&path, &base)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---------------------------------------------------------------------
    // the parsers, on git's own output shapes
    // ---------------------------------------------------------------------

    #[test]
    fn numstat_reads_counts_and_paths() {
        let parsed = parse_numstat_z("3\t1\tsrc/a.rs\0");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].additions, Some(3));
        assert_eq!(parsed[0].deletions, Some(1));
        assert_eq!(parsed[0].path, "src/a.rs");
        assert_eq!(parsed[0].old_path, None);
    }

    #[test]
    fn numstat_reads_a_rename_as_two_paths() {
        let parsed = parse_numstat_z("0\t0\t\0old/name.txt\0new/name.txt\0");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].old_path.as_deref(), Some("old/name.txt"));
        assert_eq!(parsed[0].path, "new/name.txt");
    }

    #[test]
    fn numstat_reads_a_binary_file_as_no_count_rather_than_zero() {
        let parsed = parse_numstat_z("-\t-\tlogo.png\0");
        assert_eq!(parsed[0].additions, None);
        assert_eq!(parsed[0].deletions, None);
    }

    #[test]
    fn numstat_keeps_a_path_a_tab_or_a_quote_would_have_broken() {
        // The reason `-z` is used: without it git C-escapes this path and
        // wraps it in quotes, and the plain format cannot say where a path
        // with a tab in it ends.
        let parsed = parse_numstat_z("1\t0\tnotes/süt\tçay.md\0");
        assert_eq!(parsed[0].path, "notes/süt\tçay.md");
    }

    #[test]
    fn name_status_pairs_a_letter_with_the_path_it_describes() {
        let parsed = parse_name_status_z("A\0new.txt\0D\0gone.txt\0R100\0old.txt\0moved.txt\0");
        assert_eq!(
            parsed,
            vec![
                ("new.txt".to_string(), FileChange::Added),
                ("gone.txt".to_string(), FileChange::Deleted),
                ("moved.txt".to_string(), FileChange::Renamed),
            ]
        );
    }

    #[test]
    fn a_status_letter_this_build_does_not_know_is_not_guessed_at() {
        let parsed = parse_name_status_z("X\0odd.txt\0");
        assert_eq!(parsed, vec![("odd.txt".to_string(), FileChange::Other)]);
    }

    // ---------------------------------------------------------------------
    // the caps
    // ---------------------------------------------------------------------

    #[test]
    fn a_patch_under_both_caps_is_not_touched() {
        let (patch, truncated) = truncate_patch("one\ntwo\n".to_string());
        assert_eq!(patch, "one\ntwo\n");
        assert!(!truncated);
    }

    #[test]
    fn a_long_patch_is_cut_at_the_line_cap_and_says_so() {
        let long = "x\n".repeat(MAX_PATCH_LINES + 10);
        let (patch, truncated) = truncate_patch(long);
        assert!(truncated);
        assert_eq!(patch.lines().count(), MAX_PATCH_LINES);
    }

    #[test]
    fn one_enormous_line_is_cut_by_bytes_at_a_line_boundary() {
        // A minified bundle is one line and several megabytes: the line cap
        // alone bounds nothing.
        let huge = format!("head\n{}\n", "y".repeat(MAX_PATCH_BYTES * 2));
        let (patch, truncated) = truncate_patch(huge);
        assert!(truncated);
        assert!(patch.len() <= MAX_PATCH_BYTES);
        assert_eq!(patch, "head");
    }

    #[test]
    fn a_multibyte_char_is_never_cut_in_half() {
        let huge = format!("{}\n", "ş".repeat(MAX_PATCH_BYTES));
        let (patch, truncated) = truncate_patch(huge);
        assert!(truncated);
        // The assertion is that this is a `String` at all — a cut inside the
        // two bytes of `ş` would not have been valid UTF-8.
        assert!(patch.chars().all(|c| c == 'ş'));
    }

    #[test]
    fn git_saying_binary_is_recognised_however_it_says_it() {
        assert!(says_binary(
            "diff --git a/l.png b/l.png\nBinary files a/l.png and b/l.png differ\n"
        ));
        assert!(says_binary("GIT binary patch\nliteral 12\n"));
        assert!(!says_binary(
            "+not binary, just a line starting with plus\n"
        ));
    }

    #[test]
    fn added_lines_counts_content_not_the_file_header() {
        let patch = concat!(
            "diff --git a/dev/null b/new.txt\n",
            "--- /dev/null\n",
            "+++ b/new.txt\n",
            "@@ -0,0 +1,2 @@\n",
            "+one\n",
            "+two\n",
        );
        assert_eq!(added_lines(patch), 2);
    }

    // ---------------------------------------------------------------------
    // against a real repository
    // ---------------------------------------------------------------------

    use std::path::Path;

    use super::super::testrepo::{temp_dir, worktree_path, write_at, Repo};
    use super::super::{add, remove};

    fn read(worktree: &str, base: &str) -> WorktreeDiff {
        match diff(worktree, base) {
            Ok(answer) => answer,
            Err(error) => panic!("expected a diff, got {error:?}"),
        }
    }

    fn file<'a>(answer: &'a WorktreeDiff, path: &str) -> &'a DiffFile {
        match answer.files.iter().find(|file| file.path == path) {
            Some(file) => file,
            None => panic!(
                "{path} is not in the diff; it lists {:?}",
                answer.files.iter().map(|f| &f.path).collect::<Vec<_>>()
            ),
        }
    }

    #[test]
    fn a_clean_worktree_is_an_empty_diff_not_an_error() {
        let repo = Repo::new();
        let answer = read(&repo.path(), "HEAD");
        assert_eq!(answer.files, Vec::new());
        assert_eq!(answer.additions, 0);
        assert_eq!(answer.deletions, 0);
        assert_eq!(answer.omitted_files, 0);
    }

    #[test]
    fn added_modified_deleted_and_renamed_each_arrive_as_themselves() {
        let repo = Repo::new();
        repo.write("keep.txt", "a\nb\nc\n");
        repo.write("move-me.txt", "unchanged content\n");
        repo.git(&["add", "keep.txt", "move-me.txt"]);
        repo.git(&["commit", "-m", "second"]);

        repo.write("keep.txt", "a\nB\nc\nd\n");
        repo.write("brand-new.txt", "hello\n");
        repo.git(&["add", "brand-new.txt"]);
        repo.remove("README.md");
        repo.git(&["mv", "move-me.txt", "moved.txt"]);

        let answer = read(&repo.path(), "HEAD");

        assert_eq!(file(&answer, "brand-new.txt").change, FileChange::Added);
        assert_eq!(file(&answer, "README.md").change, FileChange::Deleted);

        let modified = file(&answer, "keep.txt");
        assert_eq!(modified.change, FileChange::Modified);
        assert_eq!((modified.additions, modified.deletions), (2, 1));
        assert!(modified.patch.contains("@@"));
        assert!(modified.patch.contains("+B"));

        let renamed = file(&answer, "moved.txt");
        assert_eq!(renamed.change, FileChange::Renamed);
        assert_eq!(renamed.old_path.as_deref(), Some("move-me.txt"));

        // The total is the sum of what is listed, and nothing was left out.
        let summed: usize = answer.files.iter().map(|f| f.additions).sum();
        assert_eq!(answer.additions, summed);
        assert_eq!(answer.omitted_files, 0);
    }

    #[test]
    fn an_untracked_file_is_listed_rather_than_left_out() {
        // `git diff` alone never mentions it, and a file an agent has just
        // created is the most interesting thing in a worktree.
        let repo = Repo::new();
        repo.write("scratch.txt", "one\ntwo\n");
        let answer = read(&repo.path(), "HEAD");
        let untracked = file(&answer, "scratch.txt");
        assert_eq!(untracked.change, FileChange::Untracked);
        assert_eq!(untracked.additions, 2);
        assert_eq!(untracked.deletions, 0);
        assert!(untracked.patch.contains("+two"));
    }

    #[test]
    fn a_gitignored_file_is_not_reported_as_a_change() {
        let repo = Repo::new();
        repo.write(".gitignore", "build/\n");
        repo.git(&["add", ".gitignore"]);
        repo.git(&["commit", "-m", "ignore build"]);
        if let Err(error) = std::fs::create_dir_all(format!("{}/build", repo.path())) {
            panic!("could not create the build directory: {error}");
        }
        repo.write("build/output.o", "junk\n");
        let answer = read(&repo.path(), "HEAD");
        assert_eq!(answer.files, Vec::new());
    }

    #[test]
    fn a_binary_file_says_so_instead_of_rendering_an_empty_patch() {
        let repo = Repo::new();
        repo.write_bytes(
            "logo.png",
            &[0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x00],
        );
        repo.git(&["add", "logo.png"]);
        repo.git(&["commit", "-m", "add a binary"]);
        repo.write_bytes(
            "logo.png",
            &[0x89, 0x50, 0x4e, 0x47, 0x00, 0x03, 0x04, 0x00],
        );

        let answer = read(&repo.path(), "HEAD");
        let binary = file(&answer, "logo.png");
        assert!(binary.binary);
        assert_eq!(binary.patch, "");
        // Zero counts here mean "lines are not the unit", which is why the
        // flag exists rather than the counts being read as "no change".
        assert_eq!((binary.additions, binary.deletions), (0, 0));
    }

    #[test]
    fn an_untracked_binary_file_is_recognised_too() {
        let repo = Repo::new();
        repo.write_bytes("blob.bin", &[0x00, 0xff, 0x00, 0xff]);
        let answer = read(&repo.path(), "HEAD");
        let binary = file(&answer, "blob.bin");
        assert_eq!(binary.change, FileChange::Untracked);
        assert!(binary.binary);
        assert_eq!(binary.additions, 0);
    }

    #[test]
    fn a_file_with_no_trailing_newline_keeps_gits_own_marker() {
        let repo = Repo::new();
        repo.write("no-newline.txt", "first line\n");
        repo.git(&["add", "no-newline.txt"]);
        repo.git(&["commit", "-m", "third"]);
        repo.write("no-newline.txt", "first line\nsecond, unterminated");

        let answer = read(&repo.path(), "HEAD");
        let patch = &file(&answer, "no-newline.txt").patch;
        assert!(
            patch.contains("\\ No newline at end of file"),
            "the marker is the only thing that distinguishes these two files: {patch}"
        );
    }

    #[test]
    fn a_worktrees_changes_are_its_own_and_not_the_repositorys() {
        let repo = Repo::new();
        let root = temp_dir();
        let path = worktree_path(&root, "fix");
        assert!(add(&repo.path(), "fix", "main", &path).is_ok());

        write_at(
            &Path::new(&path).join("README.md"),
            "changed in the worktree\n",
        );
        repo.write("README.md", "changed in the repository\n");

        let in_worktree = read(&path, "HEAD");
        assert_eq!(in_worktree.files.len(), 1);
        assert_eq!(in_worktree.files[0].path, "README.md");
        assert!(in_worktree.files[0]
            .patch
            .contains("+changed in the worktree"));

        assert!(remove(&repo.path(), &path).is_err()); // dirty, and that is the rule
    }

    #[test]
    fn a_base_that_names_nothing_is_a_refusal_not_an_empty_diff() {
        let repo = Repo::new();
        assert_eq!(
            diff(&repo.path(), "no-such-ref"),
            Err(WorktreeError::UnknownBase {
                base: "no-such-ref".to_string()
            })
        );
    }

    #[test]
    fn a_directory_that_is_not_a_repository_is_refused() {
        let plain = temp_dir();
        let path = plain.path().to_string_lossy().into_owned();
        assert_eq!(diff(&path, "HEAD"), Err(WorktreeError::NotARepo { path }));
    }

    #[test]
    fn a_branch_can_be_the_base_so_the_whole_branch_is_readable() {
        let repo = Repo::new();
        repo.git(&["checkout", "-q", "-b", "fix"]);
        repo.write("README.md", "one\ntwo\n");
        repo.git(&["add", "README.md"]);
        repo.git(&["commit", "-m", "on the branch"]);
        repo.write("README.md", "one\ntwo\nthree\n");

        // Committed and uncommitted work together — the question is "what does
        // this branch change", not "what have I not committed".
        let answer = read(&repo.path(), "main");
        let readme = file(&answer, "README.md");
        assert_eq!((readme.additions, readme.deletions), (2, 0));
        assert_eq!(answer.base, "main");
    }

    #[test]
    fn the_diff_command_never_carries_a_write_flag() {
        // This module reads. A future edit that reaches for the index to make
        // git describe an untracked file (`add -N` is the usual temptation)
        // fails here.
        for arg in diff_args("HEAD", &["a.txt"]) {
            assert_ne!(arg, "--cached");
            assert_ne!(arg, "--staged");
            assert_ne!(arg, "-N");
            assert_ne!(arg, "--intent-to-add");
        }
    }
}
