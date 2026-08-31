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
//! **Paging is by cursor, not by offset — in the scope that can be.** The next
//! page of HEAD's own history is asked for with the hash of the last commit
//! shown and `--skip=1`, so a commit landing on the branch between two pages
//! cannot slide a row the owner has already read down into the next one.
//! `--skip=<n>` alone would.
//!
//! ## Two scopes, and why only one of them can page by cursor
//!
//! [`Page::Head`] walks HEAD's own ancestry: one starting rev, so "continue
//! under this commit" is expressible as that commit plus `--skip=1`, and it is
//! exact.
//!
//! [`Page::All`] is `git log --all` — the union of every ref, which is what a
//! branch graph is a picture of. That union has **no single tip**, so there is
//! no rev that means "continue under the row he last read": passing the cursor
//! commit as a starting rev would union it back in with every ref and restart
//! the listing at the newest one. So the all-refs scope pages by offset
//! (`--skip=<n>`), and this comment is the honest statement of what that costs:
//! a commit landing anywhere in the repository between two pages shifts the
//! boundary by one row. It is the wrong trade for a linear reading list and the
//! only available one for a union — a graph that could not show a second branch
//! would be a worse answer than a page boundary that can slip.
//!
//! ## Why the record format is what it is
//!
//! `git log -z --format=%H%n%h%n%an%n%aI%n%D%n%P%n%s` — **NUL between commits,
//! newline between fields**, which is exact rather than nearly exact:
//!
//! - `-z` is the only separator git guarantees cannot occur inside a commit's
//!   text, and it is what makes a subject containing anything at all safe.
//! - Every one of the six fields before the subject is newline-free *by git's
//!   own construction*: `%H`/`%h`/`%P` are hex, `%aI` is an ISO-8601 instant,
//!   and git forbids a newline inside an author ident or a ref name. `%s`
//!   collapses the subject to one line. So a newline is an unambiguous field
//!   separator here in a way it is not anywhere else in git's output.
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
const FORMAT: &str = "--format=%H%n%h%n%an%n%aI%n%D%n%P%n%s";

/// How many fields `FORMAT` produces.
const FIELDS: usize = 7;

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
    /// This commit's parents, in git's own order — `%P`. The first is the one
    /// a patch is read against; a second means a merge.
    ///
    /// **This is the field a lane graph is drawn from, and it is why the
    /// format grew.** Without it a history is a list, and every "branch line"
    /// over such a list is a topology the drawing invented rather than one git
    /// reported. Empty for a root commit, which is a fact and not a gap.
    pub parents: Vec<String>,
    /// The first line. Empty for a commit written with an empty subject, which
    /// git allows; the pane says so rather than rendering a blank row.
    pub subject: String,
}

/// Which commits a page is a page of, and how the next one is asked for.
///
/// Two variants rather than a `bool` plus two optional cursors, because the
/// two scopes page differently and a shape that let a caller pass a cursor
/// with `--all` would be a shape that let it ask for something git cannot
/// answer. See this module's header for why the union cannot use a cursor.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Page<'a> {
    /// HEAD's own ancestry, continued under the commit named. Exact.
    ///
    /// `first_parent` adds `--first-parent`, which walks only the first parent
    /// of every merge — the branch's own trunk, one lane wide by construction.
    /// **It exists because a lane column needs a ceiling** (redesign P4.3): at
    /// the dock's 376px this repository's `--all` union needs 24 lanes, and
    /// the only bounded thing to fall back to is a chain that cannot fork. The
    /// panel that asks for it says "first-parent" in its header rather than
    /// letting the reader think he is seeing every branch.
    Head {
        before: Option<&'a str>,
        first_parent: bool,
    },
    /// Every ref in the repository, continued at an offset.
    All { skip: usize },
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
    let parents = fields.next()?;
    let subject = fields.next()?;
    if hash.is_empty() {
        return None;
    }
    Some(Commit {
        author: author.to_string(),
        date: date.to_string(),
        hash: hash.to_string(),
        // `%P` is space-separated hashes, empty for a root commit.
        parents: parents.split_whitespace().map(str::to_string).collect(),
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
fn log_args<'a>(
    count: &'a str,
    skip: &'a str,
    start: Option<&'a str>,
    all: bool,
    first_parent: bool,
) -> Vec<&'a str> {
    let mut args = vec!["log", "-z", "--no-color", FORMAT, count, skip];
    // `--all` and a starting rev are alternatives, never a pair: `git log --all
    // <rev>` is the union of every ref *with* that rev, which is the union
    // again — so a caller passing both would silently get page one back.
    if all {
        args.push("--all");
    }
    // Only ever with a starting rev, and `Page` is what makes that true: the
    // union has no trunk to walk the first parent of, so `Page::All` cannot
    // spell this.
    if first_parent {
        args.push("--first-parent");
    }
    if let Some(rev) = start {
        args.push(rev);
    }
    // Nothing after the separator: this is the whole worktree's history, and a
    // pathspec would make it something else without saying so.
    args.push("--");
    args
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

/// Whether this repository has any ref at all — the [`Page::All`] counterpart
/// of [`has_history`].
///
/// `HEAD` is not the question in the union scope: a worktree can sit on an
/// unborn branch while the repository has branches with commits on them, and
/// `git log --all` there is a perfectly good answer that `has_history` would
/// have refused to ask for. `rev-list --all --max-count=1` names one commit or
/// none, and costs one object read.
fn has_any_ref(worktree: &str) -> Result<bool, WorktreeError> {
    let args = ["rev-list", "--all", "--max-count=1"];
    let ran = run(worktree, &args)?;
    Ok(ran.ok && !ran.stdout.trim().is_empty())
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
    page: Page<'_>,
    limit: usize,
) -> Result<LogPage, WorktreeError> {
    ensure_repo(worktree)?;

    let (start, skip_by) = match page {
        Page::Head {
            before: Some(cursor),
            ..
        } => {
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
            // The cursor commit is already on screen; the next page starts
            // under it.
            (Some(cursor.to_string()), 1)
        }
        Page::Head { before: None, .. } => {
            if !has_history(worktree)? {
                return Ok(LogPage {
                    commits: Vec::new(),
                    cursor: None,
                    limit,
                    more: false,
                });
            }
            (Some("HEAD".to_string()), 0)
        }
        Page::All { skip } => {
            // `git log --all` in a repository with no commits at all exits 128
            // the same way `git log HEAD` does, and for the same reason: there
            // is no ref to walk. Answered as an empty page here too — a new
            // repository is not a broken one.
            if !has_any_ref(worktree)? {
                return Ok(LogPage {
                    commits: Vec::new(),
                    cursor: None,
                    limit,
                    more: false,
                });
            }
            (None, skip)
        }
    };

    // One past the page, so `more` is something that was read rather than
    // something inferred from the page being full.
    let count = format!("--max-count={}", limit.saturating_add(1));
    let skip = format!("--skip={skip_by}");
    let args = log_args(
        &count,
        &skip,
        start.as_deref(),
        matches!(page, Page::All { .. }),
        matches!(
            page,
            Page::Head {
                first_parent: true,
                ..
            }
        ),
    );
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
    let args = log_args(&count, &skip, Some(hash), false, false);
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
/// **Two scopes.** `all: false` (or omitted) is HEAD's own ancestry, paged by
/// `before` — the hash of the last commit already shown; omit it for the first
/// page. `all: true` is `git log --all`, the union of every ref, which is what
/// a branch graph is a picture of; it is paged by `skip`, the number of rows
/// already on screen. See this module's header for why the union cannot use a
/// cursor, and what that costs.
///
/// A `before` sent with `all: true` is **ignored rather than honoured**: it
/// cannot mean anything in the union (git would union the commit back in and
/// return page one), and silently returning page one to a caller that asked
/// for page three is the kind of answer this island refuses to give.
///
/// `first_parent` narrows the HEAD scope to the branch's own trunk
/// (`--first-parent`) — a chain that cannot fork, which is the one reading a
/// bounded lane column can always draw (redesign P4.3). It is **ignored with
/// `all: true`** for the same reason `before` is: the union has no trunk, and
/// answering a narrower question than the one asked would be worse than
/// answering the one asked.
///
/// `async`, and off the thread the webview talks on, for the reason
/// `off_thread` documents.
#[tauri::command]
pub async fn worktree_log(
    path: String,
    before: Option<String>,
    all: Option<bool>,
    skip: Option<usize>,
    first_parent: Option<bool>,
) -> Result<LogPage, WorktreeError> {
    super::off_thread("worktree log", move || {
        let page = if all == Some(true) {
            Page::All {
                skip: skip.unwrap_or(0),
            }
        } else {
            Page::Head {
                before: before.as_deref(),
                first_parent: first_parent == Some(true),
            }
        };
        log_bounded(&path, page, MAX_COMMITS)
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
            "2222222222222222222222222222222222222222",
            "the subject line",
        ]));
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].hash, "1111111111111111111111111111111111111111");
        assert_eq!(parsed[0].short, "1111111");
        assert_eq!(parsed[0].author, "Ada Lovelace");
        assert_eq!(parsed[0].date, "2026-08-12T02:03:21+03:00");
        assert_eq!(parsed[0].refs, vec!["HEAD -> main", "origin/main"]);
        assert_eq!(
            parsed[0].parents,
            vec!["2222222222222222222222222222222222222222"]
        );
        assert_eq!(parsed[0].subject, "the subject line");
    }

    #[test]
    fn a_merges_two_parents_are_both_read_and_a_roots_none_are() {
        // The two facts a lane graph is drawn from. `%P` is space-separated;
        // a merge has two (or more) and a root commit has the empty string,
        // which must read as no parents rather than as one empty one.
        let merge = parse_log(&record([
            "e".repeat(40).as_str(),
            "eeeeeee",
            "T",
            "d",
            "",
            &format!("{} {}", "a".repeat(40), "b".repeat(40)),
            "Merge branch 'x'",
        ]));
        assert_eq!(merge[0].parents, vec!["a".repeat(40), "b".repeat(40)]);

        let root = parse_log(&record([
            "f".repeat(40).as_str(),
            "fffffff",
            "T",
            "d",
            "",
            "",
            "first",
        ]));
        assert_eq!(root[0].parents, Vec::<String>::new());
    }

    #[test]
    fn a_commit_nothing_points_at_has_no_refs_rather_than_one_empty_one() {
        let parsed = parse_log(&record([
            "a".repeat(40).as_str(),
            "aaaaaaa",
            "T",
            "d",
            "",
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
            "",
        ]));
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].author, "T");
        assert_eq!(parsed[0].subject, "");
    }

    #[test]
    fn a_short_record_is_dropped_rather_than_read_with_every_field_shifted() {
        // Four fields where seven are expected. Read positionally, this would
        // put a date in the refs column and a plausible-looking row on screen.
        assert_eq!(parse_log("only\ntwo\nthree\nfour\0"), Vec::new());
        assert_eq!(parse_log(""), Vec::new());
    }

    #[test]
    fn the_terminating_nul_does_not_produce_a_phantom_commit() {
        let two = format!(
            "{}{}",
            record(["c".repeat(40).as_str(), "ccccccc", "T", "d", "", "", "one"]),
            record(["d".repeat(40).as_str(), "ddddddd", "T", "d", "", "", "two"]),
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
        match log_bounded(
            worktree,
            Page::Head {
                before,
                first_parent: false,
            },
            limit,
        ) {
            Ok(page) => page,
            Err(error) => panic!("expected a page of history, got {error:?}"),
        }
    }

    fn read_trunk(worktree: &str, limit: usize) -> LogPage {
        match log_bounded(
            worktree,
            Page::Head {
                before: None,
                first_parent: true,
            },
            limit,
        ) {
            Ok(page) => page,
            Err(error) => panic!("expected a page of history, got {error:?}"),
        }
    }

    fn read_all(worktree: &str, skip: usize, limit: usize) -> LogPage {
        match log_bounded(worktree, Page::All { skip }, limit) {
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
            log_bounded(
                &repo.path(),
                Page::Head {
                    before: Some("no-such-commit"),
                    first_parent: false,
                },
                MAX_COMMITS
            ),
            Err(WorktreeError::UnknownBase {
                base: "no-such-commit".to_string()
            })
        );
    }

    // ---------------------------------------------------------------------
    // the union scope: parents, every ref, and offset paging
    // ---------------------------------------------------------------------

    #[test]
    fn every_commits_parents_arrive_and_they_chain() {
        // The claim a lane graph rests on: row N's parent is row N+1's hash,
        // all the way down, and the root commit has none.
        let repo = history(&["second", "third"]);
        let page = read(&repo.path(), None, MAX_COMMITS);
        assert_eq!(page.commits.len(), 3);
        assert_eq!(page.commits[0].parents, vec![page.commits[1].hash.clone()]);
        assert_eq!(page.commits[1].parents, vec![page.commits[2].hash.clone()]);
        assert_eq!(page.commits[2].parents, Vec::<String>::new());
    }

    #[test]
    fn the_union_scope_sees_a_branch_head_never_walked_to_and_names_a_merges_two_parents() {
        // HEAD's own ancestry cannot show a sibling branch — that is exactly
        // the gap `--all` closes — and a merge is where the second lane is
        // real rather than drawn.
        let repo = history(&["second"]);
        repo.git(&["checkout", "-b", "side"]);
        repo.write("side.txt", "on the side\n");
        repo.git(&["add", "side.txt"]);
        repo.git(&["commit", "-m", "only on side"]);
        repo.git(&["checkout", "main"]);

        let head = read(&repo.path(), None, MAX_COMMITS);
        assert_eq!(subjects(&head), vec!["second", "first"]);

        let all = read_all(&repo.path(), 0, MAX_COMMITS);
        assert!(
            all.commits.iter().any(|c| c.subject == "only on side"),
            "--all must reach a ref HEAD cannot walk to: {:?}",
            subjects(&all)
        );
        // And the ref name rides along, which is what the branch chips draw.
        assert!(
            all.commits
                .iter()
                .any(|c| c.refs.iter().any(|r| r.contains("side"))),
            "{:?}",
            all.commits.iter().map(|c| &c.refs).collect::<Vec<_>>()
        );

        repo.git(&["merge", "--no-ff", "-m", "Merge side", "side"]);
        let merged = read(&repo.path(), None, MAX_COMMITS);
        assert_eq!(merged.commits[0].subject, "Merge side");
        assert_eq!(
            merged.commits[0].parents.len(),
            2,
            "a --no-ff merge has two parents: {:?}",
            merged.commits[0].parents
        );
    }

    #[test]
    fn the_union_scope_pages_by_offset() {
        // Offset rather than cursor, for the reason the header states. What is
        // asserted here is that the offset is really applied and that the last
        // page says it is the last.
        let repo = history(&["second", "third", "fourth"]);
        let first = read_all(&repo.path(), 0, 2);
        assert_eq!(first.commits.len(), 2);
        assert!(first.more);
        let second = read_all(&repo.path(), 2, 2);
        assert_eq!(subjects(&second), vec!["second", "first"]);
        assert!(!second.more);
    }

    #[test]
    fn a_repository_with_no_refs_is_an_empty_union_page_and_not_a_refusal() {
        // `git log --all` exits 128 in a fresh repository exactly as `git log
        // HEAD` does. Reported as git failing it would say the same wrong
        // thing about a new repository.
        let dir = temp_dir();
        let path = dir.path().to_string_lossy().into_owned();
        assert!(super::super::testrepo::git_at(
            &path,
            &["init", "-b", "main"]
        ));
        let page = read_all(&path, 0, MAX_COMMITS);
        assert_eq!(page.commits, Vec::new());
        assert!(!page.more);
        assert_eq!(page.cursor, None);
    }

    #[test]
    fn the_two_scopes_never_hand_git_a_rev_and_all_at_once() {
        // `git log --all <rev>` is the union again, so a page-three request
        // would silently come back as page one. The shape of `Page` is what
        // makes that unspellable; this is the proof the arg builder agrees.
        let union = log_args("--max-count=10", "--skip=20", None, true, false);
        assert!(union.contains(&"--all"));
        assert!(!union.contains(&"HEAD"));

        let head = log_args("--max-count=10", "--skip=0", Some("HEAD"), false, false);
        assert!(!head.contains(&"--all"));
        assert!(head.contains(&"HEAD"));
        // And `--first-parent` is only ever spelled beside a starting rev.
        assert!(!head.contains(&"--first-parent"));
        let trunk = log_args("--max-count=10", "--skip=0", Some("HEAD"), false, true);
        assert!(trunk.contains(&"--first-parent"));
        assert!(!trunk.contains(&"--all"));
    }

    #[test]
    fn the_trunk_scope_walks_only_first_parents_and_the_head_scope_walks_both() {
        // **The bounded reading a lane column can always draw** (redesign
        // P4.3). A merge's side branch is in HEAD's ancestry and is NOT on the
        // trunk, so the two scopes give different pages — and the trunk's page
        // is the one whose graph is one lane wide by construction.
        let repo = history(&["second"]);
        repo.git(&["checkout", "-b", "side"]);
        repo.write("side.txt", "on the side\n");
        repo.git(&["add", "side.txt"]);
        repo.git(&["commit", "-m", "only on side"]);
        repo.git(&["checkout", "main"]);
        repo.git(&["merge", "--no-ff", "-m", "Merge side", "side"]);

        let ancestry = read(&repo.path(), None, MAX_COMMITS);
        assert!(
            subjects(&ancestry).contains(&"only on side"),
            "HEAD's ancestry includes the merged branch: {:?}",
            subjects(&ancestry)
        );

        let trunk = read_trunk(&repo.path(), MAX_COMMITS);
        assert_eq!(subjects(&trunk), vec!["Merge side", "second", "first"]);
        // Every row's first parent is the row below it — which is what makes
        // the drawing one lane. The merge still REPORTS both parents; the
        // second names a commit no row on screen carries, and the panel clips
        // it rather than opening a column for it.
        assert_eq!(trunk.commits[0].parents.len(), 2);
        assert_eq!(trunk.commits[0].parents[0], trunk.commits[1].hash);
        assert_eq!(
            trunk.commits[1].parents,
            vec![trunk.commits[2].hash.clone()]
        );
    }

    #[test]
    fn a_directory_that_is_not_a_repository_is_refused() {
        let plain = temp_dir();
        let path = plain.path().to_string_lossy().into_owned();
        assert_eq!(
            log_bounded(
                &path,
                Page::Head {
                    before: None,
                    first_parent: false,
                },
                MAX_COMMITS
            ),
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
        let args = log_args("--max-count=10", "--skip=0", Some("HEAD"), false, true);
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
        accepts_only_a_future(worktree_log(
            "/nonexistent".to_string(),
            None,
            None,
            None,
            None,
        ));
    }
}
