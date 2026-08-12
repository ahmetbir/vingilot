//! Source control as a surface: what is staged, what is not, what is untracked
//! (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 4).
//!
//! **Where the line is drawn, and Task 4 asked for it to be said out loud:
//! this SHOWS state and does not change it.** There is no stage, no unstage, no
//! discard, no commit — not withheld from the UI, *absent from this module*.
//! The only git verb here is `status`, and
//! `the_status_command_never_carries_a_write_verb` fails a future edit that
//! reaches for another. The reasoning is the plan's own: committing from the app
//! is a different promise from showing what would be committed, it is the
//! promise with a destructive failure mode (a discard is somebody's afternoon),
//! and the terminal is one keystroke away in the pane next door. A read has no
//! such failure mode, and it is the half he cannot get from `git status` without
//! leaving what he is looking at.
//!
//! ## Not to be confused with `stat.rs`
//!
//! `stat.rs` answers `worktree_stats` — *plural* — which is how many files are
//! dirty in each of several worktrees, for the numbers beside the worktree list.
//! This answers `worktree_status` for **one** worktree: which files, by name, in
//! which of the four states. One character apart in the command table and
//! nothing alike; if a third arrives, one of them should be renamed.
//!
//! ## Why `--porcelain=v2 -z` and not `--porcelain` (v1)
//!
//! v1 is two status characters, a space, and a path — and it *cannot* be parsed
//! exactly. It quotes and C-escapes any path that is not plain ASCII, so
//! `süt.txt` arrives as `"s\303\274t.txt"`; with `-z` it stops quoting but then
//! a rename's two paths are separated in a way that differs between git
//! versions. v2 is documented, versioned, and puts every path in a NUL-
//! terminated field of its own — a rename is two consecutive fields, which is
//! unambiguous no matter what is in either path.
//!
//! ## The staged/unstaged split is git's own two columns
//!
//! v2's `XY` is two independent answers: `X` is index-against-HEAD (what would
//! be committed) and `Y` is worktree-against-index (what would not). `.` is
//! "unchanged on this side". **A file can be in both lists** — `AM` is a file
//! added to the index and then edited again — and it appears in both here,
//! because that is what it is. Folding it into one row would hide precisely the
//! state he opened this pane to see.
//!
//! ## Untracked files are counted the way git counts them by default
//!
//! `--untracked-files=normal`, **passed explicitly** rather than relied on as
//! git's default, which collapses a directory nothing in it is tracked into
//! **one row** (`build/`). Deliberately not `=all`: a `node_modules` nobody has
//! ignored yet is a hundred thousand rows and several seconds of walking, in a
//! pane that exists so he does not have to wait for anything. And deliberately
//! not left off: `status.showUntrackedFiles = no` in the owner's config would
//! then delete the Untracked section without a word, and the pane would report a
//! tidier tree than the one he has — the same failure `--renames` is passed
//! explicitly to avoid. `diff.rs` lists untracked *files* instead, because a
//! patch is per file; the two surfaces answer different questions and neither is
//! wrong.

use serde::Serialize;

use super::diff::{change_from_letter, FileChange};
use super::{describe, ensure_repo, run, WorktreeError};

/// Entries carried back across all four lists together.
///
/// **1,000**, and every one of them is a row he might click. A repository in the
/// middle of a large rebase or a generated-file storm can produce far more, and
/// the pane says how many were left out rather than ending in a way that looks
/// like the list.
pub const MAX_ENTRIES: usize = 1_000;

/// One file, in one of the four states below.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub path: String,
    /// Where a rename or copy came from. `None` for everything else.
    pub old_path: Option<String>,
    pub change: FileChange,
    /// git's own two letters for this file — `XY` from porcelain v2, or `??`
    /// for an untracked one. Carried verbatim because a conflict's letters
    /// (`UU`, `DU`, `AA`) say something [`FileChange`] has no word for, and
    /// inventing one here would be this module having an opinion git already
    /// expresses better.
    pub code: String,
}

/// One worktree's uncommitted state.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    /// Index against HEAD: what a `git commit` would record.
    pub staged: Vec<StatusEntry>,
    /// Working tree against index: what it would not.
    pub unstaged: Vec<StatusEntry>,
    /// Files and collapsed directories git has never been told about.
    pub untracked: Vec<StatusEntry>,
    /// Files with an unresolved merge conflict. Their own list because they are
    /// neither staged nor unstaged — they are unfinished, and the next action
    /// for them is different from either.
    pub conflicted: Vec<StatusEntry>,
    /// The cap this answer was produced under.
    pub limit: usize,
    /// Records past the cap, counted but not listed.
    pub omitted: usize,
}

/// Where one record belongs. `Both` is the `AM` case the header describes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Slot {
    Staged,
    Unstaged,
    Both,
    Untracked,
    Conflicted,
}

/// One parsed record: the entry, and which list (or lists) it goes in.
struct Record {
    entry: StatusEntry,
    slot: Slot,
}

/// Whether a v2 status character means "something happened on this side".
/// `.` is git's "unchanged"; a space is accepted too, because that is what the
/// same column reads as in v1 and a reader that refused it would be brittle
/// about a distinction that means nothing here.
fn touched(letter: char) -> bool {
    letter != '.' && letter != ' '
}

/// The `X` and `Y` of a v2 `XY` field.
fn columns(code: &str) -> Option<(char, char)> {
    let mut chars = code.chars();
    let staged = chars.next()?;
    let unstaged = chars.next()?;
    Some((staged, unstaged))
}

/// Read a `1` or `2` record's fixed columns and its path.
///
/// `fields` is how many space-separated columns come before the path — 8 for a
/// `1` record, 9 for a `2` (it carries the rename score as well) and 10 for a
/// `u`. The path is everything after them, **taken whole**: a path may contain
/// spaces, and splitting it further is how a file called `my notes.md` becomes
/// two files that do not exist.
fn tracked_record(line: &str, fields: usize) -> Option<(String, String)> {
    let parts: Vec<&str> = line.splitn(fields + 1, ' ').collect();
    // Exactly, not at least: `splitn` returns fewer parts than asked for when
    // the input has fewer separators, so a short record would otherwise have
    // its last column read as a path — a row for a file that does not exist.
    if parts.len() != fields + 1 {
        return None;
    }
    let code = parts[1].to_string();
    let path = parts[fields].to_string();
    if path.is_empty() {
        return None;
    }
    Some((code, path))
}

/// Parse `git status --porcelain=v2 -z`.
///
/// The `-z` stream is NUL-terminated fields, and a `2` (rename or copy) record
/// is **two** of them: the record itself, then the path it came from. That is
/// why this walks the fields with an index rather than mapping over them.
///
/// A record shape this build does not know is skipped rather than guessed at —
/// git has added record types to this format before and may again, and a status
/// this build cannot fully describe is still a status whose other rows are
/// right.
fn parse_status_v2(text: &str) -> Vec<Record> {
    let fields: Vec<&str> = text.split('\0').filter(|f| !f.is_empty()).collect();
    let mut records = Vec::new();
    let mut at = 0;
    while at < fields.len() {
        let line = fields[at];
        at += 1;

        if let Some(path) = line.strip_prefix("? ") {
            records.push(Record {
                entry: StatusEntry {
                    change: FileChange::Untracked,
                    code: "??".to_string(),
                    old_path: None,
                    path: path.to_string(),
                },
                slot: Slot::Untracked,
            });
            continue;
        }

        // An ignored file, which only appears with `--ignored` and which this
        // module never asks for. Skipped by name so that turning the flag on
        // later cannot silently file build output under "untracked".
        if line.starts_with("! ") {
            continue;
        }

        let (columns_at, is_rename, slot_hint) = match line.chars().next() {
            Some('1') => (8, false, None),
            Some('2') => (9, true, None),
            Some('u') => (10, false, Some(Slot::Conflicted)),
            _ => continue,
        };
        let Some((code, path)) = tracked_record(line, columns_at) else {
            continue;
        };
        // The rename's source is the field after the record, and consuming it
        // here is what keeps the walk in step: read as a record of its own it
        // would be skipped, and read as nothing it would shift every later row.
        let old_path = if is_rename {
            let source = fields.get(at).map(|f| (*f).to_string());
            at += 1;
            source
        } else {
            None
        };

        let Some((staged, unstaged)) = columns(&code) else {
            continue;
        };
        let slot = match slot_hint {
            Some(conflicted) => conflicted,
            None => match (touched(staged), touched(unstaged)) {
                (true, true) => Slot::Both,
                (true, false) => Slot::Staged,
                (false, true) => Slot::Unstaged,
                // Neither column says anything happened. git does not emit
                // these, and inventing a list for them would be this module
                // reporting a change nobody made.
                (false, false) => continue,
            },
        };
        // The letter for the side this row is about: a file staged as a rename
        // and then edited is `R` in the staged list and `M` in the unstaged one,
        // which is exactly what it is.
        let change = |letter: char| change_from_letter(&letter.to_string());
        records.push(Record {
            entry: StatusEntry {
                change: match slot {
                    Slot::Unstaged => change(unstaged),
                    _ => change(staged),
                },
                code,
                old_path,
                path,
            },
            slot,
        });
    }
    records
}

/// `git status`'s argument vector, in one place so a test can read what is — and
/// is not — in it. Nothing here is conditional: there is no branch of this
/// function that stages, discards or commits anything.
fn status_args() -> [&'static str; 5] {
    // `--renames` explicitly rather than by default, so a `status.renames =
    // false` in the owner's config cannot turn every rename in this pane into a
    // delete beside an add — the same answer wearing a much more alarming face.
    //
    // `--untracked-files=normal` for exactly the same reason and it is the
    // sharper of the two: `status.showUntrackedFiles = no` would otherwise empty
    // the Untracked section entirely, and a section that is absent reads as
    // "there is nothing there" rather than as "you asked git not to look".
    [
        "status",
        "--porcelain=v2",
        "-z",
        "--renames",
        "--untracked-files=normal",
    ]
}

/// One worktree's status, with the entry cap handed in.
///
/// **`limit` is a parameter rather than [`MAX_ENTRIES`] read straight off the
/// constant**, for the reason `log_bounded` gives about the page size: crossing
/// a 1,000-entry cap for real means a fixture that writes 1,001 files, so
/// without this the `omitted` count — the one number whose failure mode is
/// silent, because zero omitted is what *suppresses* the pane's banner — could
/// not be exercised at all. With the cap injectable, four dirty files and a
/// limit of two drive the whole path.
///
/// The cap is over *records*, which is what git emitted, not over the entries
/// they become: an `AM` file is one record and two rows (see [`both_sides`]), so
/// a page can carry one row more than its limit rather than splitting a file's
/// two truths across a boundary.
fn status_bounded(worktree: &str, limit: usize) -> Result<WorktreeStatus, WorktreeError> {
    ensure_repo(worktree)?;
    let args = status_args();
    let ran = run(worktree, &args)?;
    if !ran.ok {
        return Err(WorktreeError::GitFailed {
            command: describe(&args),
            stderr: ran.stderr,
        });
    }

    let records = parse_status_v2(&ran.stdout);
    let omitted = records.len().saturating_sub(limit);
    let mut answer = WorktreeStatus {
        conflicted: Vec::new(),
        limit,
        omitted,
        staged: Vec::new(),
        unstaged: Vec::new(),
        untracked: Vec::new(),
    };
    for record in records.into_iter().take(limit) {
        match record.slot {
            Slot::Staged => answer.staged.push(record.entry),
            Slot::Unstaged => answer.unstaged.push(record.entry),
            Slot::Untracked => answer.untracked.push(record.entry),
            Slot::Conflicted => answer.conflicted.push(record.entry),
            Slot::Both => {
                // One file, two true things about it. See the header: folding
                // this into one row hides exactly what the pane is for.
                let (staged, unstaged) = both_sides(record.entry);
                answer.staged.push(staged);
                answer.unstaged.push(unstaged);
            }
        }
    }
    Ok(answer)
}

pub(crate) fn status(worktree: &str) -> Result<WorktreeStatus, WorktreeError> {
    status_bounded(worktree, MAX_ENTRIES)
}

/// The two rows a file changed on both sides produces. The staged row keeps the
/// rename source, because the rename is the thing the index records; the
/// unstaged row is about the same path's later edit.
fn both_sides(entry: StatusEntry) -> (StatusEntry, StatusEntry) {
    let unstaged_change = columns(&entry.code)
        .map(|(_, unstaged)| change_from_letter(&unstaged.to_string()))
        .unwrap_or(FileChange::Modified);
    let unstaged = StatusEntry {
        change: unstaged_change,
        code: entry.code.clone(),
        old_path: None,
        path: entry.path.clone(),
    };
    (entry, unstaged)
}

/// One worktree's staged, unstaged, untracked and conflicted files.
///
/// `path` is the worktree, not the repository: a linked worktree has its own
/// index and its own working files.
///
/// `async` for the reason `off_thread` documents — `git status` on a large
/// repository with a cold cache is not instant, and the terminal staying
/// responsive is the product.
#[tauri::command]
pub async fn worktree_status(path: String) -> Result<WorktreeStatus, WorktreeError> {
    super::off_thread("worktree status", move || status(&path)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    use super::super::testrepo::{temp_dir, Repo};

    /// A `-z` stream out of the records given.
    fn stream(fields: &[&str]) -> String {
        fields.iter().map(|f| format!("{f}\0")).collect()
    }

    fn slotted(records: &[Record], slot: Slot) -> Vec<&str> {
        records
            .iter()
            .filter(|record| record.slot == slot)
            .map(|record| record.entry.path.as_str())
            .collect()
    }

    // ---------------------------------------------------------------------
    // the parser, on git's own record shapes (bytes measured from the binary)
    // ---------------------------------------------------------------------

    #[test]
    fn the_two_columns_are_two_answers_and_land_in_two_lists() {
        let parsed = parse_status_v2(&stream(&[
            "1 .M N... 100644 100644 100644 aaa bbb only-unstaged.txt",
            "1 A. N... 000000 100644 100644 000 ccc only-staged.txt",
        ]));
        assert_eq!(slotted(&parsed, Slot::Unstaged), vec!["only-unstaged.txt"]);
        assert_eq!(slotted(&parsed, Slot::Staged), vec!["only-staged.txt"]);
    }

    #[test]
    fn a_file_changed_on_both_sides_is_in_both_lists_rather_than_folded_into_one() {
        // `AM` — added to the index, then edited again. This is the state the
        // pane is FOR, and a reader that picked one column would hide it.
        let parsed = parse_status_v2(&stream(&[
            "1 AM N... 000000 100644 100644 000 ddd both.txt",
        ]));
        assert_eq!(slotted(&parsed, Slot::Both), vec!["both.txt"]);

        // And through the whole assembly, which is where the two rows are made.
        let (staged, unstaged) = both_sides(parsed.into_iter().next().expect("one record").entry);
        assert_eq!(staged.change, FileChange::Added);
        assert_eq!(unstaged.change, FileChange::Modified);
        assert_eq!(staged.path, unstaged.path);
        // Both rows carry git's own letters, so the pane can show `AM` for what
        // it is rather than two rows that look unrelated.
        assert_eq!(staged.code, "AM");
        assert_eq!(unstaged.code, "AM");
    }

    #[test]
    fn a_renames_source_is_the_next_field_and_does_not_shift_the_rows_after_it() {
        // The one record shape that is two fields. Read as one, every row after
        // a rename is off by one — and the source path would be parsed as a
        // record of its own.
        //
        // **The source path is one the parser would otherwise recognise**, and
        // that is the whole point of the fixture. A source of `s.txt` re-entered
        // as a record hits `parse_status_v2`'s `_ => continue` and vanishes
        // harmlessly, so the half of this test's name after the comma could not
        // fail. A path beginning `"? "` — which git can legally produce, since a
        // file may be named that — is read as an untracked record instead, so
        // failing to consume the field produces a phantom row.
        let parsed = parse_status_v2(&stream(&[
            "2 R. N... 100644 100644 100644 eee fff R100 renamed.txt",
            "? old notes.txt",
            "1 .M N... 100644 100644 100644 ggg hhh after.txt",
        ]));
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].entry.path, "renamed.txt");
        assert_eq!(parsed[0].entry.old_path.as_deref(), Some("? old notes.txt"));
        assert_eq!(parsed[0].entry.change, FileChange::Renamed);
        // The row after it is still itself, in the right list.
        assert_eq!(parsed[1].entry.path, "after.txt");
        assert_eq!(parsed[1].slot, Slot::Unstaged);
        // And the source was consumed rather than read: a rename's origin is not
        // a file git is reporting as new.
        assert!(parsed.iter().all(|record| record.slot != Slot::Untracked));
    }

    #[test]
    fn a_path_with_spaces_in_it_survives_whole() {
        // The reason the path is taken as the remainder rather than split: a
        // file called `my notes.md` must not become two files that do not exist.
        let parsed = parse_status_v2(&stream(&[
            "1 .M N... 100644 100644 100644 iii jjj docs/my notes.md",
            "? another new file.txt",
        ]));
        assert_eq!(parsed[0].entry.path, "docs/my notes.md");
        assert_eq!(parsed[1].entry.path, "another new file.txt");
    }

    #[test]
    fn an_unmerged_record_is_its_own_state_rather_than_staged_or_unstaged() {
        let parsed = parse_status_v2(&stream(&[
            "u UU N... 100644 100644 100644 100644 kkk lll mmm conflicted.txt",
        ]));
        assert_eq!(slotted(&parsed, Slot::Conflicted), vec!["conflicted.txt"]);
        // git's own letters, because `FileChange` has no word for this and
        // inventing one would be worse than passing through what git says.
        assert_eq!(parsed[0].entry.code, "UU");
    }

    #[test]
    fn an_untracked_record_is_read_and_an_ignored_one_is_not() {
        let parsed = parse_status_v2(&stream(&["? new.txt", "! build/output.o"]));
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].entry.path, "new.txt");
        assert_eq!(parsed[0].entry.code, "??");
        assert_eq!(parsed[0].entry.change, FileChange::Untracked);
    }

    #[test]
    fn a_record_shape_this_build_does_not_know_is_skipped_rather_than_guessed_at() {
        let parsed = parse_status_v2(&stream(&[
            "# branch.head main",
            "x something git added later",
            "1 .M N... 100644 100644 100644 nnn ooo real.txt",
        ]));
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].entry.path, "real.txt");
    }

    #[test]
    fn an_empty_status_is_a_clean_worktree_and_not_an_error() {
        assert!(parse_status_v2("").is_empty());
    }

    // ---------------------------------------------------------------------
    // against a real repository
    // ---------------------------------------------------------------------

    fn read(worktree: &str) -> WorktreeStatus {
        match status(worktree) {
            Ok(answer) => answer,
            Err(error) => panic!("expected a status, got {error:?}"),
        }
    }

    fn paths(entries: &[StatusEntry]) -> Vec<&str> {
        entries.iter().map(|entry| entry.path.as_str()).collect()
    }

    #[test]
    fn a_clean_worktree_is_four_empty_lists_and_not_a_refusal() {
        let repo = Repo::new();
        let answer = read(&repo.path());
        assert_eq!(answer.staged, Vec::new());
        assert_eq!(answer.unstaged, Vec::new());
        assert_eq!(answer.untracked, Vec::new());
        assert_eq!(answer.conflicted, Vec::new());
        assert_eq!(answer.omitted, 0);
        assert_eq!(answer.limit, MAX_ENTRIES);
    }

    #[test]
    fn the_four_states_arrive_as_themselves_against_the_real_binary() {
        // Everything the parser claims, through git rather than through bytes
        // this test wrote: a fixture that only ever fed itself would keep
        // passing after git changed the format under it.
        let repo = Repo::new();
        repo.write("tracked.txt", "one\n");
        repo.write("move-me.txt", "unchanged content\n");
        repo.git(&["add", "tracked.txt", "move-me.txt"]);
        repo.git(&["commit", "-m", "second"]);

        repo.write("staged-only.txt", "new\n");
        repo.git(&["add", "staged-only.txt"]);
        repo.write("tracked.txt", "one\ntwo\n");
        repo.write("untracked.txt", "nobody knows\n");
        repo.git(&["mv", "move-me.txt", "moved.txt"]);

        let answer = read(&repo.path());
        assert!(paths(&answer.staged).contains(&"staged-only.txt"));
        assert!(paths(&answer.staged).contains(&"moved.txt"));
        assert!(paths(&answer.unstaged).contains(&"tracked.txt"));
        assert_eq!(paths(&answer.untracked), vec!["untracked.txt"]);
        assert_eq!(answer.conflicted, Vec::new());

        let renamed = answer
            .staged
            .iter()
            .find(|entry| entry.path == "moved.txt")
            .expect("the rename is staged");
        assert_eq!(renamed.old_path.as_deref(), Some("move-me.txt"));
        assert_eq!(renamed.change, FileChange::Renamed);
    }

    #[test]
    fn a_directory_of_new_files_is_one_row_rather_than_all_of_them() {
        // `--untracked-files=normal`, git's default: an unignored build
        // directory is a row, not ten thousand. The pane he opened so as not to
        // wait for anything must not be the thing that walks it.
        let repo = Repo::new();
        let build = std::path::Path::new(&repo.path()).join("build");
        if let Err(error) = std::fs::create_dir_all(&build) {
            panic!("could not create the build directory: {error}");
        }
        repo.write("build/a.o", "junk\n");
        repo.write("build/b.o", "junk\n");

        let answer = read(&repo.path());
        assert_eq!(paths(&answer.untracked), vec!["build/"]);
    }

    #[test]
    fn an_untracked_file_survives_a_config_that_told_git_not_to_look() {
        // **The behaviour `--untracked-files=normal` is passed FOR**, rather
        // than the flag's presence in an array. `the_status_command_never_
        // carries_a_write_verb` asserts the string; this asserts what dropping
        // it would cost, against the config that makes the cost real. Without
        // the flag git honours `status.showUntrackedFiles = no` and the section
        // is empty — a tidier tree than the one he has, reported in silence.
        //
        // The config is set on the repository rather than globally, and that is
        // the only way this can be written: `testrepo.rs` points every setup
        // command at `/dev/null` for global and system config precisely so the
        // owner's own settings cannot reach these tests. A local `[status]` is
        // read by the module's own `run`, which is what the pane will meet.
        let repo = Repo::new();
        repo.git(&["config", "status.showUntrackedFiles", "no"]);
        repo.write("untracked.txt", "nobody knows\n");

        let answer = read(&repo.path());
        assert_eq!(
            paths(&answer.untracked),
            vec!["untracked.txt"],
            "the flag is what stands between this row and the owner's config",
        );
    }

    #[test]
    fn a_rename_stays_one_row_under_a_config_that_turned_rename_detection_off() {
        // The other half of the same claim, for `--renames`. Without the flag,
        // `status.renames = false` makes git report this as a delete beside an
        // add: the same answer wearing a much more alarming face, and two rows
        // where the pane should draw one.
        let repo = Repo::new();
        repo.write(
            "move-me.txt",
            "a line long enough that git has something to match on\n",
        );
        repo.git(&["add", "move-me.txt"]);
        repo.git(&["commit", "-m", "second"]);
        repo.git(&["config", "status.renames", "false"]);
        repo.git(&["mv", "move-me.txt", "moved.txt"]);

        let answer = read(&repo.path());
        // One row, and it is the moved path — not `move-me.txt` deleted beside
        // `moved.txt` added, which is what the config asks for and the flag
        // refuses.
        assert_eq!(paths(&answer.staged), vec!["moved.txt"]);
        let renamed = &answer.staged[0];
        assert_eq!(renamed.change, FileChange::Renamed);
        assert_eq!(renamed.old_path.as_deref(), Some("move-me.txt"));
    }

    #[test]
    fn a_file_changed_on_both_sides_is_never_split_across_the_cap() {
        // **`status_bounded`'s cap semantic, asserted rather than only
        // described.** The doc comment says the cap is over *records*, so an
        // `AM` file is one record and two rows and a page can carry one row
        // past its limit rather than splitting a file's two truths across a
        // boundary. Nothing exercised a `Slot::Both` record AT the boundary, so
        // an edit that moved the cap to entries — or that truncated inside
        // `both_sides` — would satisfy every other assertion here and silently
        // hide the state this pane exists to show.
        //
        // `AAA.txt` sorts before `README.md` and git emits `1` records in path
        // order, so the both-sides record is the one a limit of 1 admits.
        let repo = Repo::new();
        repo.write("AAA.txt", "new\n");
        repo.git(&["add", "AAA.txt"]);
        repo.write("AAA.txt", "new\nand edited again\n");
        repo.write("README.md", "one\ntwo\n");

        let answer = match status_bounded(&repo.path(), 1) {
            Ok(answer) => answer,
            Err(error) => panic!("expected a status, got {error:?}"),
        };
        // Two records, one of them listed — the count is over what git emitted.
        assert_eq!(answer.omitted, 1);
        // …and that one record is two rows, which is one MORE than the limit.
        assert_eq!(paths(&answer.staged), vec!["AAA.txt"]);
        assert_eq!(paths(&answer.unstaged), vec!["AAA.txt"]);
        assert_eq!(
            answer.staged.len() + answer.unstaged.len(),
            2,
            "the documented over-limit row: a file's two truths are not split",
        );
        assert_eq!(answer.staged[0].change, FileChange::Added);
        assert_eq!(answer.unstaged[0].change, FileChange::Modified);
    }

    #[test]
    fn past_the_cap_the_entries_are_counted_rather_than_listed() {
        // **The number whose failure mode is silent.** Zero omitted is what
        // suppresses the pane's banner, so an `omitted` hard-coded to zero
        // renders a truncated list as a complete one — the header promises "the
        // pane says how many were left out rather than ending in a way that
        // looks like the list", and this is where that promise is kept.
        //
        // Read at a limit of two rather than at `MAX_ENTRIES`, which is the
        // reason `status_bounded` takes the cap as a parameter: proving this at
        // 1,000 means writing 1,001 files per run.
        let repo = Repo::new();
        for name in ["a.txt", "b.txt", "c.txt", "d.txt"] {
            repo.write(name, "new\n");
        }

        let answer = match status_bounded(&repo.path(), 2) {
            Ok(answer) => answer,
            Err(error) => panic!("expected a status, got {error:?}"),
        };
        assert_eq!(answer.limit, 2);
        assert_eq!(answer.omitted, 2, "four files, two of them listed");
        assert_eq!(
            answer.staged.len()
                + answer.unstaged.len()
                + answer.untracked.len()
                + answer.conflicted.len(),
            2,
        );

        // And the same worktree read under the real cap leaves nothing out, so
        // the count above is the cap doing its work and not the fixture.
        let whole = read(&repo.path());
        assert_eq!(whole.omitted, 0);
        assert_eq!(
            paths(&whole.untracked),
            vec!["a.txt", "b.txt", "c.txt", "d.txt"]
        );
    }

    #[test]
    fn a_gitignored_file_is_not_reported_at_all() {
        let repo = Repo::new();
        repo.write(".gitignore", "ignored.txt\n");
        repo.git(&["add", ".gitignore"]);
        repo.git(&["commit", "-m", "ignore it"]);
        repo.write("ignored.txt", "invisible\n");

        let answer = read(&repo.path());
        assert_eq!(answer.untracked, Vec::new());
        assert_eq!(answer.staged, Vec::new());
        assert_eq!(answer.unstaged, Vec::new());
    }

    #[test]
    fn the_status_read_leaves_the_worktree_exactly_as_it_found_it() {
        // The module's whole promise, asserted as an outcome rather than as an
        // argument vector: a read that staged what it listed would be the worst
        // possible bug here, and it would be invisible to every test above.
        let repo = Repo::new();
        repo.write("untracked.txt", "nobody knows\n");
        repo.write("README.md", "one\ntwo\n");

        let before = read(&repo.path());
        assert_eq!(paths(&before.untracked), vec!["untracked.txt"]);
        assert!(paths(&before.unstaged).contains(&"README.md"));
        assert_eq!(before.staged, Vec::new());

        // Read it again. Nothing has moved between the lists, which is what a
        // stray `add` (or an `add -N`, the usual temptation) would show up as.
        let after = read(&repo.path());
        assert_eq!(after, before);
        assert_eq!(after.staged, Vec::new());
    }

    #[test]
    fn a_directory_that_is_not_a_repository_is_refused() {
        let plain = temp_dir();
        let path = plain.path().to_string_lossy().into_owned();
        assert_eq!(status(&path), Err(WorktreeError::NotARepo { path }));
    }

    // ---------------------------------------------------------------------
    // the promise in this module's header
    // ---------------------------------------------------------------------

    #[test]
    fn the_status_command_never_carries_a_write_verb() {
        let args = status_args();
        assert_eq!(args[0], "status");
        // The two flags the header names, asserted so the prose and the argument
        // vector are one thing. Both are passed explicitly against a config that
        // would otherwise change the answer without saying so: `status.renames =
        // false` turns every rename into a delete beside an add, and
        // `status.showUntrackedFiles = no` empties the Untracked section — which
        // reads as a tidier tree than the one he has.
        assert!(args.contains(&"--renames"), "{args:?}");
        assert!(args.contains(&"--untracked-files=normal"), "{args:?}");
        for arg in args {
            for forbidden in [
                "add",
                "commit",
                "checkout",
                "reset",
                "restore",
                "revert",
                "stash",
                "clean",
                "-N",
                "--intent-to-add",
                "--force",
            ] {
                assert_ne!(arg, forbidden, "a read may not carry {forbidden}");
            }
        }
    }

    #[test]
    fn the_command_is_async_so_the_read_never_runs_on_the_ipc_thread() {
        fn accepts_only_a_future<F: std::future::Future>(_: F) {}
        accepts_only_a_future(worktree_status("/nonexistent".to_string()));
    }
}
