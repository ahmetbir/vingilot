//! What git already knows: a worktree's commit history
//! (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 4).
//!
//! **Everything in this file reads, and there is no branch of it that writes.**
//! No `add`, no `commit`, no `checkout`, no `reset`, no `rebase`, no index touch
//! of any kind — `git log` and `git rev-parse` are the whole vocabulary, and
//! `the_log_commands_never_carry_a_write_verb` fails a future edit that reaches
//! for one. Task 4 drew that line deliberately: committing from the app is a
//! different promise from showing what is committed, and the terminal is one
//! keystroke away.
//!
//! **The page is bounded at the read, and the bound is reported.** 200 commits
//! per page ([`MAX_COMMITS`]), and the page carries `more` and a `cursor` so the
//! pane can say "there is older history" rather than ending in a way that looks
//! like the repository began there. `more` is not a guess: the read asks for one
//! commit past the page and does not show it, so a page that is full and a page
//! that is exactly full are different answers rather than the same one.
//!
//! **Paging is by cursor, not by offset.** The next page is asked for with the
//! hash of the last commit shown and `--skip=1`, so a commit landing on the
//! branch between two pages cannot slide a row the owner has already read down
//! into the next one. `--skip=<n>` alone would.
//!
//! ## Why the record format is what it is
//!
//! `git log -z --format=%H%n%h%n%an%n%aI%n%D%n%s` — **NUL between commits,
//! newline between fields**, which is exact rather than nearly exact:
//!
//! - `-z` is the only separator git guarantees cannot occur inside a commit's
//!   text, and it is what makes a subject containing anything at all safe.
//! - Every one of the five fields before the subject is newline-free *by git's
//!   own construction*: `%H`/`%h` are hex, `%aI` is an ISO-8601 instant, and git
//!   forbids a newline inside an author ident or a ref name. `%s` collapses the
//!   subject to one line. So a newline is an unambiguous field separator here in
//!   a way it is not anywhere else in git's output.
//! - The subject is read with `splitn`, so it is the field that absorbs a
//!   surprise rather than the one that shifts every other field along by one.
//!
//! `--no-color` for the reason `vingilot_search` gives about the same flag: a
//! `color.ui = always` in the owner's config would otherwise put ANSI escapes
//! inside `%D`, and a ref name would arrive with terminal bytes wrapped round it.

use serde::Serialize;

use super::{answers_yes, commit, describe, ensure_repo, run, WorktreeError};

/// Commits read in one page.
///
/// **200**, and the number is a judgement rather than a round figure: it is
/// several months of a busy branch, it costs one `git log` and about 40 KB of
/// IPC, and it is far past the point at which a human scrolls rather than reads.
/// Older history is a second page, asked for by cursor.
pub const MAX_COMMITS: usize = 200;

/// The record format. See this module's header for why the separators are what
/// they are; `FIELDS` and this string are one decision and must move together.
const FORMAT: &str = "--format=%H%n%h%n%an%n%aI%n%D%n%s";

/// How many fields `FORMAT` produces.
const FIELDS: usize = 6;

/// One commit, as the History pane prints it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    /// The full hash. What every later call is made with — an abbreviation is
    /// for reading, and can become ambiguous as a repository grows.
    pub hash: String,
    /// git's own abbreviation, at whatever length this repository's `core.abbrev`
    /// settled on. For display only.
    pub short: String,
    /// The author's name. Not the committer's: on a rebased or cherry-picked
    /// commit the committer is whoever moved it, and the question the pane
    /// answers is "who wrote this".
    pub author: String,
    /// The author date, ISO-8601 with an offset (`%aI`). Formatted on the
    /// frontend, where the owner's locale is.
    pub date: String,
    /// Ref names pointing at this commit — `HEAD -> main`, `origin/main`,
    /// `tag: v1` — split out of `%D`. Empty for the overwhelming majority of
    /// commits, which is why it is a list and not a string.
    pub refs: Vec<String>,
    /// The first line. Empty for a commit written with an empty subject, which
    /// git allows; the pane says so rather than rendering a blank row.
    pub subject: String,
}

/// One page of history.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub commits: Vec<Commit>,
    /// The page size this answer was produced under, so the pane states the
    /// number that was actually applied rather than a second copy of it.
    pub limit: usize,
    /// There is at least one commit older than the last one listed. **Read one
    /// past the page rather than inferred from a full page**, so "exactly 200
    /// commits in this repository" and "the first 200 of thousands" are
    /// different answers.
    pub more: bool,
    /// What to ask the next page with: the hash of the last commit listed.
    /// `None` for a page with nothing on it — there is nothing to continue from,
    /// and inventing one would page from a commit nobody was shown.
    pub cursor: Option<String>,
}

/// Split `%D` into the refs it names. `", "` is git's own separator, and a ref
/// name cannot contain a space, so this cannot split one in half.
fn parse_refs(decoration: &str) -> Vec<String> {
    decoration
        .split(", ")
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect()
}

/// One record of the format above, or `None` for a record this build cannot
/// read.
///
/// **Dropped rather than guessed at.** A record with too few fields would
/// otherwise be read with every field shifted along by one — an author date in
/// the author column, a subject in the refs — and a row of plausible nonsense is
/// worse than a row that is not there.
fn parse_commit(record: &str) -> Option<Commit> {
    let mut fields = record.splitn(FIELDS, '\n');
    let hash = fields.next()?;
    let short = fields.next()?;
    let author = fields.next()?;
    let date = fields.next()?;
    let refs = fields.next()?;
    let subject = fields.next()?;
    if hash.is_empty() {
        return None;
    }
    Some(Commit {
        author: author.to_string(),
        date: date.to_string(),
        hash: hash.to_string(),
        refs: parse_refs(refs),
        short: short.to_string(),
        subject: subject.to_string(),
    })
}

/// Parse the whole listing. `-z` terminates every record including the last, so
/// the trailing empty split is dropped rather than parsed into a phantom commit.
pub(super) fn parse_log(text: &str) -> Vec<Commit> {
    text.split('\0')
        .filter(|record| !record.is_empty())
        .filter_map(parse_commit)
        .collect()
}

/// `git log`'s argument vector, built in one place so a test can read what is —
/// and is not — in it. Nothing here is conditional on anything but where the
/// page starts: there is no branch of this function that writes.
fn log_args<'a>(count: &'a str, skip: &'a str, start: &'a str) -> Vec<&'a str> {
    vec![
        "log",
        "-z",
        "--no-color",
        FORMAT,
        count,
        skip,
        start,
        // Nothing after the separator: this is the whole worktree's history,
        // and a pathspec would make it something else without saying so.
        "--",
    ]
}

/// Whether this worktree has any commit at all.
///
/// A repository that has been `git init`ed and never committed has no `HEAD`,
/// and `git log` there exits 128 with "does not have any commits yet". That is
/// **an answer** — there is no history — and reporting it as git failing would
/// tell the owner his repository is broken because it is new.
fn has_history(worktree: &str) -> Result<bool, WorktreeError> {
    answers_yes(
        worktree,
        &["rev-parse", "--verify", "--quiet", &commit("HEAD")],
    )
}

/// One page of a worktree's history, with the page size handed in.
///
/// **`limit` is a parameter rather than [`MAX_COMMITS`] read straight off the
/// constant**, and it is the only reason the paging can be proved at all:
/// crossing a 200-commit boundary for real means a fixture that makes 201
/// commits, which is seconds of subprocesses per test. With the page size
/// injectable, five commits and a page of two drive the whole path — the
/// `more` flag, the cursor, the `--skip=1` that keeps the pages from
/// overlapping, and the last page's `more: false`.
pub(super) fn log_bounded(
    worktree: &str,
    before: Option<&str>,
    limit: usize,
) -> Result<LogPage, WorktreeError> {
    ensure_repo(worktree)?;

    let start = match before {
        Some(cursor) => {
            // A cursor that names nothing is a refusal and not an empty page:
            // an empty page reads as "there is no more history", which is a
            // claim about the owner's repository.
            if !answers_yes(
                worktree,
                &["rev-parse", "--verify", "--quiet", &commit(cursor)],
            )? {
                return Err(WorktreeError::UnknownBase {
                    base: cursor.to_string(),
                });
            }
            cursor.to_string()
        }
        None => {
            if !has_history(worktree)? {
                return Ok(LogPage {
                    commits: Vec::new(),
                    cursor: None,
                    limit,
                    more: false,
                });
            }
            "HEAD".to_string()
        }
    };

    // One past the page, so `more` is something that was read rather than
    // something inferred from the page being full.
    let count = format!("--max-count={}", limit.saturating_add(1));
    // The cursor commit is already on screen; the next page starts under it.
    let skip = format!("--skip={}", usize::from(before.is_some()));
    let args = log_args(&count, &skip, &start);
    let ran = run(worktree, &args)?;
    if !ran.ok {
        return Err(WorktreeError::GitFailed {
            command: describe(&args),
            stderr: ran.stderr,
        });
    }

    let mut commits = parse_log(&ran.stdout);
    let more = commits.len() > limit;
    commits.truncate(limit);
    Ok(LogPage {
        cursor: commits.last().map(|last| last.hash.clone()),
        more,
        commits,
        limit,
    })
}

/// One commit's own record, or `None` when this worktree has no such commit.
///
/// Here rather than in `commit_patch.rs` because it is the same read, the same
/// format and the same parser as a page of history: a second `--format` string
/// over there would be a second answer to "what does this app know about a
/// commit", and the two would drift.
pub(super) fn one(worktree: &str, hash: &str) -> Result<Option<Commit>, WorktreeError> {
    let count = "--max-count=1".to_string();
    let skip = "--skip=0".to_string();
    let args = log_args(&count, &skip, hash);
    let ran = run(worktree, &args)?;
    if !ran.ok {
        return Ok(None);
    }
    Ok(parse_log(&ran.stdout).into_iter().next())
}

/// One page of a worktree's commit history, newest first.
///
/// `path` is the worktree, not the repository: a linked worktree has its own
/// `HEAD`, and its history is its branch's rather than the repository's.
///
/// `before` is the hash of the last commit already shown; omit it for the first
/// page. `async`, and off the thread the webview talks on, for the reason
/// `off_thread` documents.
#[tauri::command]
pub async fn worktree_log(path: String, before: Option<String>) -> Result<LogPage, WorktreeError> {
    super::off_thread("worktree log", move || {
        log_bounded(&path, before.as_deref(), MAX_COMMITS)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---------------------------------------------------------------------
    // the parser, on git's own record shape
    // ---------------------------------------------------------------------

    /// One record, built the way git writes it.
    fn record(fields: [&str; FIELDS]) -> String {
        format!("{}\0", fields.join("\n"))
    }

    #[test]
    fn a_record_is_read_field_by_field() {
        let parsed = parse_log(&record([
            "1111111111111111111111111111111111111111",
            "1111111",
            "Ada Lovelace",
            "2026-08-12T02:03:21+03:00",
            "HEAD -> main, origin/main",
            "the subject line",
        ]));
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].hash, "1111111111111111111111111111111111111111");
        assert_eq!(parsed[0].short, "1111111");
        assert_eq!(parsed[0].author, "Ada Lovelace");
        assert_eq!(parsed[0].date, "2026-08-12T02:03:21+03:00");
        assert_eq!(parsed[0].refs, vec!["HEAD -> main", "origin/main"]);
        assert_eq!(parsed[0].subject, "the subject line");
    }

    #[test]
    fn a_commit_nothing_points_at_has_no_refs_rather_than_one_empty_one() {
        let parsed = parse_log(&record([
            "a".repeat(40).as_str(),
            "aaaaaaa",
            "T",
            "d",
            "",
            "s",
        ]));
        assert_eq!(parsed[0].refs, Vec::<String>::new());
    }

    #[test]
    fn an_empty_subject_is_kept_as_empty_rather_than_shifting_the_fields() {
        // git allows a commit with no subject. The row must arrive with every
        // other field where it belongs, and the pane says what to do about the
        // blank — this module does not invent one.
        let parsed = parse_log(&record([
            "b".repeat(40).as_str(),
            "bbbbbbb",
            "T",
            "d",
            "",
            "",
        ]));
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].author, "T");
        assert_eq!(parsed[0].subject, "");
    }

    #[test]
    fn a_short_record_is_dropped_rather_than_read_with_every_field_shifted() {
        // Four fields where six are expected. Read positionally, this would put
        // a date in the refs column and a plausible-looking row on screen.
        assert_eq!(parse_log("only\ntwo\nthree\nfour\0"), Vec::new());
        assert_eq!(parse_log(""), Vec::new());
    }

    #[test]
    fn the_terminating_nul_does_not_produce_a_phantom_commit() {
        let two = format!(
            "{}{}",
            record(["c".repeat(40).as_str(), "ccccccc", "T", "d", "", "one"]),
            record(["d".repeat(40).as_str(), "ddddddd", "T", "d", "", "two"]),
        );
        assert_eq!(parse_log(&two).len(), 2);
    }

    // ---------------------------------------------------------------------
    // against a real repository
    // ---------------------------------------------------------------------

    use super::super::testrepo::{temp_dir, worktree_path, Repo};
    use super::super::{add, remove};

    /// A repository with `first` (from `Repo::new`) plus the subjects given,
    /// oldest first.
    fn history(subjects: &[&str]) -> Repo {
        let repo = Repo::new();
        for (at, subject) in subjects.iter().enumerate() {
            repo.write("log.txt", &format!("{at}\n"));
            repo.git(&["add", "log.txt"]);
            repo.git(&["commit", "-m", subject]);
        }
        repo
    }

    fn subjects(page: &LogPage) -> Vec<&str> {
        page.commits
            .iter()
            .map(|entry| entry.subject.as_str())
            .collect()
    }

    fn read(worktree: &str, before: Option<&str>, limit: usize) -> LogPage {
        match log_bounded(worktree, before, limit) {
            Ok(page) => page,
            Err(error) => panic!("expected a page of history, got {error:?}"),
        }
    }

    #[test]
    fn history_arrives_newest_first_with_the_fields_filled_in() {
        let repo = history(&["second", "third"]);
        let page = read(&repo.path(), None, MAX_COMMITS);
        assert_eq!(subjects(&page), vec!["third", "second", "first"]);
        assert!(!page.more);
        assert_eq!(page.limit, MAX_COMMITS);

        let newest = &page.commits[0];
        assert_eq!(newest.hash.len(), 40);
        assert!(newest.hash.starts_with(&newest.short));
        assert_eq!(newest.author, "Vingilot Test");
        // An ISO-8601 instant, which is what the frontend formats. Asserted as
        // a shape rather than a value, since the value is "now".
        assert!(newest.date.contains('T'), "{}", newest.date);
        // HEAD is on this commit, and the branch with it.
        assert!(
            newest.refs.iter().any(|name| name.contains("main")),
            "{:?}",
            newest.refs
        );
        // And an older commit has nothing pointing at it.
        assert_eq!(page.commits[1].refs, Vec::<String>::new());
    }

    #[test]
    fn the_cursor_pages_without_repeating_or_skipping_a_commit() {
        // The whole of paging, at a page size of two over five commits.
        let repo = history(&["second", "third", "fourth", "fifth"]);

        let first = read(&repo.path(), None, 2);
        assert_eq!(subjects(&first), vec!["fifth", "fourth"]);
        assert!(first.more, "there are three commits older than these");

        let second = read(&repo.path(), first.cursor.as_deref(), 2);
        // `--skip=1`: the cursor commit is already on screen and must not come
        // back. Without it this page reads ["fourth", "third"].
        assert_eq!(subjects(&second), vec!["third", "second"]);
        assert!(second.more);

        let third = read(&repo.path(), second.cursor.as_deref(), 2);
        assert_eq!(subjects(&third), vec!["first"]);
        // The last page, and it says so — a `more` that stayed true here would
        // leave a "load more" that answers nothing forever.
        assert!(!third.more);
    }

    #[test]
    fn a_page_that_is_exactly_full_is_not_reported_as_having_more() {
        // The boundary the extra read exists for: five commits, a page of five.
        // Inferring `more` from a full page reports history that is not there.
        let repo = history(&["second", "third", "fourth", "fifth"]);
        let page = read(&repo.path(), None, 5);
        assert_eq!(page.commits.len(), 5);
        assert!(!page.more);
    }

    #[test]
    fn a_repository_with_no_commits_yet_is_an_empty_page_and_not_a_refusal() {
        // `git log` exits 128 here ("does not have any commits yet"). Reported
        // as git failing, it would tell him his repository is broken because it
        // is new.
        let dir = temp_dir();
        let path = dir.path().to_string_lossy().into_owned();
        assert!(super::super::testrepo::git_at(
            &path,
            &["init", "-b", "main"]
        ));

        let page = read(&path, None, MAX_COMMITS);
        assert_eq!(page.commits, Vec::new());
        assert!(!page.more);
        assert_eq!(page.cursor, None);
    }

    #[test]
    fn a_cursor_that_names_nothing_is_a_refusal_not_the_end_of_the_history() {
        // An empty page here would read as "there is no more history", which is
        // a claim about his repository made from a question that failed.
        let repo = Repo::new();
        assert_eq!(
            log_bounded(&repo.path(), Some("no-such-commit"), MAX_COMMITS),
            Err(WorktreeError::UnknownBase {
                base: "no-such-commit".to_string()
            })
        );
    }

    #[test]
    fn a_directory_that_is_not_a_repository_is_refused() {
        let plain = temp_dir();
        let path = plain.path().to_string_lossy().into_owned();
        assert_eq!(
            log_bounded(&path, None, MAX_COMMITS),
            Err(WorktreeError::NotARepo { path })
        );
    }

    #[test]
    fn a_worktrees_history_is_its_own_branchs_and_not_the_repositorys() {
        let repo = history(&["second"]);
        let root = temp_dir();
        let path = worktree_path(&root, "fix");
        assert!(add(&repo.path(), "fix", "main", &path).is_ok());

        // A commit on the repository's branch, which the worktree's branch has
        // never seen.
        repo.write("log.txt", "on main only\n");
        repo.git(&["add", "log.txt"]);
        repo.git(&["commit", "-m", "only on main"]);

        let in_worktree = read(&path, None, MAX_COMMITS);
        assert_eq!(subjects(&in_worktree), vec!["second", "first"]);
        let in_repo = read(&repo.path(), None, MAX_COMMITS);
        assert_eq!(subjects(&in_repo), vec!["only on main", "second", "first"]);

        assert_eq!(remove(&repo.path(), &path), Ok(()));
    }

    #[test]
    fn one_commit_can_be_read_on_its_own() {
        let repo = history(&["second"]);
        let page = read(&repo.path(), None, MAX_COMMITS);
        let newest = &page.commits[0];

        let found = one(&repo.path(), &newest.hash);
        assert_eq!(found, Ok(Some(newest.clone())));
        // A hash this repository has never heard of is `None`, not a failure:
        // the caller says "no such commit", which is the honest sentence.
        assert_eq!(one(&repo.path(), "0".repeat(40).as_str()), Ok(None));
    }

    // ---------------------------------------------------------------------
    // the promise in this module's header
    // ---------------------------------------------------------------------

    #[test]
    fn the_log_commands_never_carry_a_write_verb() {
        // This module reads. A future edit that reaches for the index, the
        // working tree or a ref fails here.
        let args = log_args("--max-count=10", "--skip=0", "HEAD");
        assert_eq!(args[0], "log");
        for arg in args {
            for forbidden in [
                "add", "commit", "checkout", "reset", "rebase", "restore", "revert", "stash",
                "--force", "-f",
            ] {
                assert_ne!(arg, forbidden, "a read may not carry {forbidden}");
            }
        }
    }

    #[test]
    fn the_command_is_async_so_the_read_never_runs_on_the_ipc_thread() {
        // See `off_thread`: only an `async fn` gets `respond_async_serialized`.
        // The thread is not observable from here; the shape that decides it is.
        fn accepts_only_a_future<F: std::future::Future>(_: F) {}
        accepts_only_a_future(worktree_log("/nonexistent".to_string(), None));
    }
}
