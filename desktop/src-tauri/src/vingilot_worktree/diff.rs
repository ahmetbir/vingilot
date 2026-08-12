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
//!
//! **And every cap is applied to the read, not to the answer.** A patch is cut
//! at the pipe (`run_capped`), because a cap applied after `Command::output()`
//! has already buffered the whole thing bounds only what is displayed — an
//! agent's 191 MB `run.log` in a worktree cost ~404 MB resident before the
//! first byte was cut. The whole read then runs on a blocking thread
//! (`off_thread`): it is up to ~500 `git` subprocesses, and a
//! `#[tauri::command] fn` would run all of them on the thread the webview's
//! IPC arrives on — the macOS main thread — with every keystroke bound for a
//! terminal queued behind them.

use serde::Serialize;

use super::{answers_yes, commit, describe, ensure_repo, run, run_capped, WorktreeError};

/// Files rendered before the list is cut. 400 is far past the point a human
/// reads file-by-field, and far below the point the DOM struggles.
pub(super) const MAX_FILES: usize = 400;

/// Untracked files rendered. Lower than `MAX_FILES` because each one costs a
/// `git diff --no-index` of its own, and an untracked tree that big (a build
/// output directory nobody has gitignored yet) is a thing to notice rather
/// than to page through.
pub(super) const MAX_UNTRACKED: usize = 100;

/// Patch lines kept per file. One regenerated lockfile is tens of thousands.
pub(super) const MAX_PATCH_LINES: usize = 2_000;

/// Patch bytes kept per file, for the file that is 40 lines and 8 MB — a
/// minified bundle is one line per file, so a line cap alone does not bound
/// anything.
pub(super) const MAX_PATCH_BYTES: usize = 256 * 1024;

/// Patch bytes *read* per file. One past the cap on purpose: a read that
/// stopped here has produced more than `MAX_PATCH_BYTES`, which is exactly the
/// condition `truncate_patch` cuts on — so a read cut short at the pipe and a
/// patch cut short in memory are reported as the same thing, by the same code,
/// and there is no second truncation flag to keep in step with the first.
pub(super) const READ_PATCH_BYTES: usize = MAX_PATCH_BYTES + 1;

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
pub(super) struct NumStat {
    pub(super) path: String,
    pub(super) old_path: Option<String>,
    pub(super) additions: Option<usize>,
    pub(super) deletions: Option<usize>,
}

/// Split a NUL-delimited stream into its fields, dropping the empty tail the
/// trailing separator leaves behind.
pub(super) fn nul_fields(text: &str) -> Vec<&str> {
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
pub(super) fn parse_numstat_z(text: &str) -> Vec<NumStat> {
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

pub(super) fn change_from_letter(status: &str) -> FileChange {
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
pub(super) fn parse_name_status_z(text: &str) -> Vec<(String, FileChange)> {
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
pub(super) fn truncate_patch(patch: String) -> (String, bool) {
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
/// same thing.
///
/// Counted from the first hunk header rather than by excluding `+++`: this is
/// a single-file patch, so everything before the first `@@` is header and
/// everything after it is content. Excluding the prefix instead would drop a
/// real added line whose own text begins `++`, which a diff of a diff does.
fn added_lines(patch: &str) -> usize {
    patch
        .lines()
        .skip_while(|line| !line.starts_with("@@"))
        .filter(|line| line.starts_with('+'))
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

/// One file's patch.
///
/// **A patch that could not be read is a refusal, not an empty string.** An
/// empty patch beside `+3 −1` renders as "no textual change to show — an empty
/// file, or a mode change" (`worktreeDiff.ts`), which is a positive claim about
/// the owner's work; making it on the strength of a git that did not run is the
/// failure mode this module's header rules out.
fn patch_for(worktree: &str, base: &str, file: &NumStat) -> Result<String, WorktreeError> {
    let mut paths = vec![file.path.as_str()];
    if let Some(old) = file.old_path.as_deref() {
        paths.push(old);
    }
    let args = diff_args(base, &paths);
    let ran = run_capped(worktree, &args, READ_PATCH_BYTES)?;
    if !ran.ok {
        return Err(WorktreeError::GitFailed {
            command: describe(&args),
            stderr: ran.stderr,
        });
    }
    Ok(ran.stdout)
}

fn no_index_args(path: &str) -> [&str; 8] {
    [
        "diff",
        "--no-ext-diff",
        "--no-color",
        "--no-index",
        "--unified=3",
        "--",
        "/dev/null",
        path,
    ]
}

/// Read a `--no-index` run, which cannot be judged by its exit status.
///
/// It exits 1 both for "these two files differ" — the normal outcome here —
/// and for "could not access this path", measured on the installed git:
///
/// ```text
/// $ git diff --no-index -- /dev/null not-on-disk.txt
/// error: Could not access 'not-on-disk.txt'
/// $ echo $?
/// 1
/// ```
///
/// What separates them is what came back. A difference is a patch on stdout; a
/// fault is a sentence on stderr and nothing else. Two files that are the same
/// (an empty new file against `/dev/null`) produce neither, and that is the
/// zero-addition file it says it is — not a fault, and not silence about one.
fn no_index_answer(args: &[&str], stdout: String, stderr: String) -> Result<String, WorktreeError> {
    if stdout.is_empty() && !stderr.trim().is_empty() {
        return Err(WorktreeError::GitFailed {
            command: describe(args),
            stderr,
        });
    }
    Ok(stdout)
}

/// The patch for a file git has never seen, against nothing.
fn untracked_patch(worktree: &str, path: &str) -> Result<String, WorktreeError> {
    let args = no_index_args(path);
    let ran = run_capped(worktree, &args, READ_PATCH_BYTES)?;
    no_index_answer(&args, ran.stdout, ran.stderr)
}

/// git's own addition count for one untracked file.
///
/// Only asked for a file whose patch was cut at the byte cap, where counting
/// `+` lines in what was read would report a number smaller than the truth
/// with nothing saying so. Costs a second read of that one file — which is
/// what `added_lines` exists to avoid for the other ninety-nine.
fn untracked_additions(worktree: &str, path: &str) -> Result<usize, WorktreeError> {
    let mut args = vec!["diff", "--numstat", "-z"];
    args.extend_from_slice(&no_index_args(path)[1..]);
    let ran = run(worktree, &args)?;
    let counted = no_index_answer(&args, ran.stdout, ran.stderr)?;
    Ok(parse_numstat_z(&counted)
        .first()
        .and_then(|record| record.additions)
        .unwrap_or(0))
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

    // Not `unwrap_or_default()`: an empty status list makes every file
    // "Modified", so an added file would be shown as one the owner edited.
    let status_args = ["diff", "--name-status", "-z", "--find-renames", base, "--"];
    let statuses = run(worktree, &status_args)?;
    if !statuses.ok {
        return Err(WorktreeError::GitFailed {
            command: describe(&status_args),
            stderr: statuses.stderr,
        });
    }
    let statuses = parse_name_status_z(&statuses.stdout);

    counted
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
                truncate_patch(patch_for(worktree, base, &file)?)
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

fn untracked_changes(worktree: &str) -> Result<(Vec<DiffFile>, usize), WorktreeError> {
    let list_args = ["ls-files", "--others", "--exclude-standard", "-z"];
    let ran = run(worktree, &list_args)?;
    if !ran.ok {
        return Err(WorktreeError::GitFailed {
            command: describe(&list_args),
            stderr: ran.stderr,
        });
    }
    let listed: Vec<String> = nul_fields(&ran.stdout)
        .into_iter()
        .map(str::to_string)
        .collect();

    let omitted = listed.len().saturating_sub(MAX_UNTRACKED);
    let files = listed
        .into_iter()
        .take(MAX_UNTRACKED)
        .map(|path| {
            let raw = untracked_patch(worktree, &path)?;
            let binary = says_binary(&raw);
            let counted = if binary { 0 } else { added_lines(&raw) };
            let (patch, truncated) = if binary {
                (String::new(), false)
            } else {
                truncate_patch(raw)
            };
            // Counting `+` lines in a patch that was cut would under-report
            // the file's additions while the total beside it read as complete.
            let additions = if truncated && !binary {
                untracked_additions(worktree, &path)?
            } else {
                counted
            };
            Ok(DiffFile {
                additions,
                binary,
                change: FileChange::Untracked,
                deletions: 0,
                old_path: None,
                patch,
                path,
                truncated,
            })
        })
        .collect::<Result<Vec<_>, WorktreeError>>()?;
    Ok((files, omitted))
}

pub(crate) fn diff(worktree: &str, base: &str) -> Result<WorktreeDiff, WorktreeError> {
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
    let omitted_files = count_beyond_cap(worktree, base, tracked.len())?;
    let (untracked, omitted_untracked) = untracked_changes(worktree)?;

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
///
/// A failure here is returned, not counted as zero: zero omitted files is what
/// **suppresses** the omission banner, so swallowing this failure would hide
/// exactly the truncation the banner exists to announce.
fn count_beyond_cap(worktree: &str, base: &str, listed: usize) -> Result<usize, WorktreeError> {
    if listed < MAX_FILES {
        return Ok(0);
    }
    let args = ["diff", "--name-only", "-z", "--find-renames", base, "--"];
    let ran = run(worktree, &args)?;
    if !ran.ok {
        return Err(WorktreeError::GitFailed {
            command: describe(&args),
            stderr: ran.stderr,
        });
    }
    Ok(nul_fields(&ran.stdout).len().saturating_sub(listed))
}

/// One worktree's changes against `base`, working tree included.
///
/// `path` is the worktree, not the repository: a linked worktree has its own
/// working files and its own `HEAD`, and `git -C <worktree>` is how you ask
/// about them.
///
/// `async`, and the whole read on a blocking thread: this is the command that
/// spawns the most subprocesses in the app — up to two probes, three list
/// passes and one `git diff` per file — and a `fn` command would run every one
/// of them on the thread the webview's IPC arrives on. See `off_thread`.
#[tauri::command]
pub async fn worktree_diff(path: String, base: String) -> Result<WorktreeDiff, WorktreeError> {
    super::off_thread("worktree diff", move || diff(&path, &base)).await
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

    #[test]
    fn an_added_line_that_looks_like_a_header_is_still_a_line() {
        // A file containing "++ a line" — a diff pasted into a document, a
        // markdown snippet — makes the patch line "+++ a line".
        let patch = concat!(
            "diff --git a/dev/null b/notes.md\n",
            "--- /dev/null\n",
            "+++ b/notes.md\n",
            "@@ -0,0 +1,2 @@\n",
            "+++ a line that begins with two pluses\n",
            "+ordinary\n",
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

    // ---------------------------------------------------------------------
    // what a read costs, and what it does when it cannot answer
    // ---------------------------------------------------------------------

    #[test]
    fn a_huge_untracked_file_is_cut_at_the_cap_and_still_counted_by_git() {
        // The failure this pins: the caps used to be display caps. The whole
        // patch was materialised — twice, by `Command::output()` and then by
        // `from_utf8_lossy` — before a byte was cut, so an agent's `run.log`
        // in a worktree cost hundreds of MB to look at. The cut is now at the
        // pipe, which means the `+` lines in what was read are no longer the
        // file's real count, which is why the count comes from git instead.
        let repo = Repo::new();
        let lines = (MAX_PATCH_BYTES / 16) + 500;
        repo.write("run.log", &"0123456789abcde\n".repeat(lines));

        let answer = read(&repo.path(), "HEAD");
        let log = file(&answer, "run.log");
        assert!(log.truncated, "a patch past the cap must say it was cut");
        assert!(
            log.patch.len() <= MAX_PATCH_BYTES,
            "kept {} bytes, cap is {MAX_PATCH_BYTES}",
            log.patch.len()
        );
        assert_eq!(
            log.additions, lines,
            "the count must be the file's, not the shown part's"
        );
        assert_eq!(answer.additions, lines);
    }

    #[test]
    fn a_patch_git_would_not_produce_is_a_refusal_not_an_empty_patch() {
        // An empty patch beside "+3 −1" renders as "no textual change to
        // show", which is a claim about the owner's work. It may only be made
        // when git actually said so.
        let repo = Repo::new();
        let missing = NumStat {
            additions: Some(3),
            deletions: Some(1),
            old_path: None,
            path: "keep.txt".to_string(),
        };
        assert!(patch_for(&repo.path(), "no-such-ref", &missing).is_err());
        assert!(untracked_patch(&repo.path(), "not-on-disk.txt").is_err());
    }

    #[test]
    fn a_failed_count_of_the_omitted_files_does_not_read_as_nothing_omitted() {
        // Zero omitted files is what suppresses the amber banner, so this
        // failure path is the one that hides a truncation.
        let repo = Repo::new();
        assert!(count_beyond_cap(&repo.path(), "no-such-ref", MAX_FILES).is_err());
        // Below the cap nothing is asked at all, which is not a failure.
        assert_eq!(count_beyond_cap(&repo.path(), "no-such-ref", 3), Ok(0));
    }

    #[test]
    fn the_command_is_async_so_the_read_never_runs_on_the_ipc_thread() {
        // `#[tauri::command] fn` is generated with ExecutionContext::Blocking
        // (tauri-macros 2.6.3, command/wrapper.rs), which inlines the call
        // into the IPC scheme handler — the main thread on macOS/WKWebView —
        // for the whole of a read that is up to ~500 git subprocesses. Only an
        // `async fn` gets `respond_async_serialized`. The thread is not
        // observable from here; the shape that decides it is.
        fn accepts_only_a_future<F: std::future::Future>(_: F) {}
        accepts_only_a_future(worktree_diff(
            "/nonexistent".to_string(),
            "HEAD".to_string(),
        ));
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
