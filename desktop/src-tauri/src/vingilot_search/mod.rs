//! Finding a thing in the selected worktree
//! (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 2).
//!
//! > *"bugün işte ne için vscode açtım biliyor musun. projede cmd shift f yapıp
//! > bir şey bulmak için."*
//!
//! **One command, and it reads.** `git grep` over the checkout he has selected —
//! not an index this app maintains, because git already knows the tree, already
//! respects the ignore rules the Files pane and the Diff pane answer from, and
//! cannot go stale between the moment an agent writes a file and the moment he
//! searches for it. An index would be a second opinion about his repository plus
//! a cache to invalidate.
//!
//! ## Why this is not inside `vingilot_files`
//!
//! It reads the same checkout and it hands back the same paths, so the sibling
//! question is a real one. Three things decide it, and all three are about cost
//! rather than tidiness:
//!
//! 1. **`vingilot_files` promises the opposite bound.** Its header says *"one
//!    directory per call, never a walk"*, and every bound in it is built on
//!    that. This command is the walk. Putting them in one module would put one
//!    header over two cost models, and the next reader would believe the wrong
//!    one.
//! 2. **`vingilot_files::run` cannot express what this needs.** It is
//!    `Command::output()` — blocking, unbounded, and with no handle left to kill
//!    anything with. A `git grep` for `e` over this repository prints **87 MB**
//!    (measured), and a pathological `-E` pattern can run for minutes. This
//!    module needs a child it can bound in bytes and in time, which is a
//!    different runner, and giving the tree listing and the file read that
//!    machinery would be paying for it on every keystroke of a pane that does
//!    not need it.
//! 3. **`lib.rs` has one line of headroom per command anyway**, so the module
//!    boundary costs nothing and buys a header that is true.
//!
//! It borrows exactly one thing from its neighbours: `vingilot_worktree::git`,
//! the cached probe, so a search and a tree listing of the same worktree cannot
//! disagree about which git answered.
//!
//! ## The bounds, and all four are reported
//!
//! | Bound | Value | Where | Said to him as |
//! |---|---|---|---|
//! | Hits | 2,000 | [`grep::MAX_HITS`] | `capped`, and a sentence counting what he got |
//! | git's output | 4 MiB | [`MAX_STDOUT_BYTES`] | the same `capped` |
//! | Time | 10 s | [`TIMEOUT`] | [`SearchError::TimedOut`], after the child is killed |
//! | One line's text | 400 chars | `grep::clip` | `clipped` on the hit |
//!
//! **Nothing on that list is applied silently**, which is the rule
//! `vingilot_files` states and the one Task 2 puts hardest: *"a search that
//! silently truncates is a search that lies about what is in the repo."*
//!
//! ## What is never built
//!
//! A shell string. The pattern is the owner's own typing and it goes into an
//! argument vector — `grep::search_args` — where a `;`, a backtick or a `$(…)`
//! is a character to look for and not a command to run.

pub mod grep;

use std::io::Read;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::vingilot_worktree::git;

/// How long one search may take before the child is killed.
///
/// **Ten seconds**, and the number is a judgement about two things. `git grep`
/// over a monorepo with a cold page cache takes seconds — that is the cost the
/// plan asks to be stated rather than discovered — so a shorter bound would kill
/// searches that were about to answer. And this runs off the thread the webview
/// talks on, so nothing is frozen while it waits: the timeout is not there to
/// protect the UI, it is there so a pathological `-E` pattern (a POSIX regex can
/// backtrack for minutes) leaves a sentence rather than a process nobody is
/// waiting for any more.
const TIMEOUT: Duration = Duration::from_secs(10);

/// How often the child is asked whether it is done. Fine enough that the
/// deadline means what it says, coarse enough that waiting costs nothing.
const POLL: Duration = Duration::from_millis(20);

/// The most of git's output that is read.
///
/// **4 MiB**, and it is a real bound rather than a belt-and-braces one:
/// `git grep -e e` over this repository prints 87 MB, and the hit cap cannot
/// stop that on its own because the cap is applied to the parsed answer and the
/// bytes arrive first. When the reader stops here it drops the pipe, git
/// receives EPIPE and exits — the same thing `| head` does — so the search ends
/// rather than filling memory while nobody is reading.
const MAX_STDOUT_BYTES: u64 = 4 * 1024 * 1024;

/// git's diagnostics are a line or two; this is only here so a command that
/// decides to narrate cannot cost memory.
const MAX_STDERR_BYTES: u64 = 8 * 1024;

/// Why a search did not answer. Every variant is a different next action for
/// him, which is why there is no single "search failed".
///
/// Serialised as `{ "kind": "…", … }` for `features/runs/lib/searchModel.ts`,
/// which owns the words — the same split `FilesError` and `WorktreeError` use,
/// so the sentences are tested without a subprocess and the reasons are tested
/// without a browser.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SearchError {
    /// No git on this machine that answers `--version`.
    GitMissing,
    /// The worktree's own path is not a repository (any more).
    NotARepo { path: String },
    /// **This module's refusal, not git's**, and it is the one place the two
    /// differ. `git grep -e ""` is not an error: it matches every line of every
    /// file, which on this repository is 87 MB of output and, once bounded,
    /// two thousand rows that mean nothing. An empty box is a question nobody
    /// asked, so it is answered as one rather than as a result set.
    EmptyPattern,
    /// The child ran past [`TIMEOUT`] and was killed. `seconds` is the bound it
    /// ran past, because "it timed out" without the number is a sentence he
    /// cannot act on.
    TimedOut { seconds: u64 },
    /// git ran and refused. `stderr` is git's own words, whole — an unbalanced
    /// bracket in a regex is a sentence git already writes better than this
    /// module could, and rewording it would put a paraphrase between him and
    /// the thing that is wrong.
    GitFailed { command: String, stderr: String },
}

/// What one bounded run of git produced.
struct Ran {
    /// `None` when the child was ended by a signal — which includes the EPIPE
    /// this module causes itself when [`MAX_STDOUT_BYTES`] is reached.
    code: Option<i32>,
    stdout: Vec<u8>,
    stderr: String,
    /// The reader stopped at the byte budget, so there was more output.
    over_budget: bool,
    /// The deadline passed and the child was killed.
    timed_out: bool,
}

fn describe(args: &[&str]) -> String {
    format!("git {}", args.join(" "))
}

/// Read at most `cap` bytes off one of the child's pipes, then let it go.
///
/// **Dropping the pipe is the point.** `read_to_end` over a `Take` stops at the
/// cap and returns; the reader is dropped with the thread, which closes this end
/// of the pipe, which is what makes git stop writing rather than block forever
/// against a full buffer with nobody draining it.
fn drain<R: Read>(source: Option<R>, cap: u64) -> Vec<u8> {
    let Some(source) = source else {
        return Vec::new();
    };
    let mut bytes = Vec::new();
    // A read that fails part-way keeps what it got: a truncated answer that
    // says it is truncated is worth more than an error with nothing in it.
    let _ = source.take(cap).read_to_end(&mut bytes);
    bytes
}

/// Wait for a child, and kill it at the deadline. `None` means it was killed.
///
/// **Its own function because the killing is the part with no other proof.** A
/// timeout reached through a real `git grep` needs a repository pathological
/// enough to take ten seconds, which is not a fixture anybody should build — so
/// as a loop inside the runner this could be deleted with every other test in
/// the module still green. Over a child that is only a `sleep` it is
/// deterministic and costs a tenth of a second.
///
/// A child that cannot even be asked about is killed too: there is no bounded
/// thing left to do with it, and leaving it is how a search nobody is waiting
/// for outlives the app.
fn wait_bounded(child: &mut Child, deadline: Instant, poll: Duration) -> Option<ExitStatus> {
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) => {}
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            // Reaped rather than left: a killed child that is never waited on
            // is a zombie for as long as this app runs.
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(poll);
    }
}

/// Run git with `-C <cwd>`, bounded in bytes and in time.
///
/// `GIT_TERMINAL_PROMPT=0` and a closed stdin because a desktop app has no
/// terminal to answer a credential prompt on — the same reason
/// `vingilot_files::run` sets them, and here it also means the deadline is never
/// spent waiting on a question nobody can see.
///
/// **`stdout_cap` is a parameter rather than [`MAX_STDOUT_BYTES`] read straight
/// off the constant**, and it is the only reason the byte budget can be proved
/// at all. Overrunning 4 MiB for real needs a repository big enough to print it
/// — which is not a fixture anybody should build — so every test of this bound
/// would otherwise be a test of `drain` over a `Cursor`, which never reaches a
/// subprocess and never reaches the `capped` the owner is shown. With the cap
/// injectable, a temp repo and sixty-four hundred bytes drive the whole path:
/// the reader stops, git dies on EPIPE with no exit code, and the answer comes
/// back marked.
fn run_bounded(cwd: &str, args: &[&str], stdout_cap: u64) -> Result<Ran, SearchError> {
    let git = git().ok_or(SearchError::GitMissing)?;
    let mut child = Command::new(git)
        .arg("-C")
        .arg(cwd)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| SearchError::GitFailed {
            command: describe(args),
            stderr: error.to_string(),
        })?;

    // Both pipes are drained on their own threads, and they have to be: with
    // nobody reading stdout, a search with more output than one pipe buffer
    // blocks git forever and `try_wait` below would never answer.
    let out = child.stdout.take();
    let err = child.stderr.take();
    let reading = std::thread::spawn(move || drain(out, stdout_cap));
    let complaining = std::thread::spawn(move || drain(err, MAX_STDERR_BYTES));

    let finished = wait_bounded(&mut child, Instant::now() + TIMEOUT, POLL);
    let stdout = reading.join().unwrap_or_default();
    let stderr = complaining.join().unwrap_or_default();

    Ok(Ran {
        code: finished.and_then(|status| status.code()),
        over_budget: stdout.len() as u64 >= stdout_cap,
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        stdout,
        timed_out: finished.is_none(),
    })
}

/// Whether this directory is a git repository at all.
///
/// **Asked only when the search has already failed**, which is the difference
/// between this and `vingilot_files::ensure_repo`: a search runs on a debounce
/// while he types, and a second subprocess per keystroke to establish something
/// that is almost always true is a cost with no reader. When `git grep` refuses,
/// this is what tells "this is not a checkout" apart from "that regex has an
/// unbalanced bracket" — two refusals with two different next actions, without
/// this module matching on the words of git's own diagnostics, which are
/// translated on a machine with a localised git.
fn is_repo(worktree: &str) -> bool {
    let Some(git) = git() else {
        return false;
    };
    matches!(
        Command::new(git)
            .arg("-C")
            .arg(worktree)
            .args(["rev-parse", "--git-dir"])
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status(),
        Ok(status) if status.success()
    )
}

/// git's exit codes for `grep`, which are three answers and not two:
/// **0 is "here they are", 1 is "there are none", and anything else is a
/// refusal.** Reading 1 as a failure would turn every unsuccessful search into
/// an error message; reading it as an empty list without saying so would be the
/// other half of the same mistake.
const MATCHED: i32 = 0;
const NO_MATCHES: i32 = 1;

/// Whether git produced an answer at all, as opposed to refusing.
///
/// **The byte budget is read BEFORE the exit code, and the order is the whole
/// of it**: stopping the read kills git with EPIPE, so the child has no exit
/// code at all — read the other way round, every over-long search would be
/// reported as git failing rather than as a capped answer, and the owner would
/// be told his repository was broken because his pattern was popular.
///
/// Its own function so that inversion can be *shown* to fail. Inside `search`
/// it needs a repository large enough to print 4 MiB before anything notices it
/// is gone; over a [`Ran`] built by hand the three cases are three lines.
fn answered(ran: &Ran) -> bool {
    ran.over_budget || matches!(ran.code, Some(MATCHED) | Some(NO_MATCHES))
}

/// Whether the list is short of what is in the checkout — from **either** bound.
///
/// The hit cap and the byte budget are two mechanisms and one fact: this is not
/// everything. He is shown one sentence because there is one thing for him to
/// do about it, and `cappedNote` counts what he really got rather than naming
/// whichever limit bit.
fn capped(parsed_capped: bool, ran: &Ran) -> bool {
    parsed_capped || ran.over_budget
}

fn search(worktree: &str, pattern: &str, regex: bool) -> Result<grep::SearchAnswer, SearchError> {
    search_bounded(worktree, pattern, regex, MAX_STDOUT_BYTES)
}

/// One search, with the byte budget it runs under handed in — see `run_bounded`
/// for why that is a parameter and not the constant.
fn search_bounded(
    worktree: &str,
    pattern: &str,
    regex: bool,
    stdout_cap: u64,
) -> Result<grep::SearchAnswer, SearchError> {
    if pattern.is_empty() {
        return Err(SearchError::EmptyPattern);
    }
    let args = grep::search_args(pattern, regex);
    let ran = run_bounded(worktree, &args, stdout_cap)?;

    if ran.timed_out {
        return Err(SearchError::TimedOut {
            seconds: TIMEOUT.as_secs(),
        });
    }

    if !answered(&ran) {
        if !is_repo(worktree) {
            return Err(SearchError::NotARepo {
                path: worktree.to_string(),
            });
        }
        return Err(SearchError::GitFailed {
            command: describe(&args),
            stderr: if ran.stderr.trim().is_empty() {
                "git ended without an exit status.".to_string()
            } else {
                ran.stderr
            },
        });
    }

    let (hits, parsed_capped) = grep::parse(&ran.stdout, grep::MAX_HITS);
    Ok(grep::SearchAnswer {
        capped: capped(parsed_capped, &ran),
        hits,
        limit: grep::MAX_HITS,
        pattern: pattern.to_string(),
        regex,
    })
}

/// Every matching line in one worktree, or the sentence saying why not.
///
/// `async` for the reason `vingilot_worktree::off_thread` documents: a
/// `#[tauri::command]` declared `fn` is generated `ExecutionContext::Blocking`
/// and inlined into the IPC handler, which on macOS/WKWebView is the main
/// thread. `git grep` over a monorepo there is a frozen terminal, and the
/// terminal staying responsive while a search runs is the difference between
/// this and the shell he already has.
#[tauri::command]
pub async fn worktree_search(
    worktree: String,
    pattern: String,
    regex: bool,
) -> Result<grep::SearchAnswer, SearchError> {
    match tauri::async_runtime::spawn_blocking(move || search(&worktree, &pattern, regex)).await {
        Ok(answer) => answer,
        Err(error) => Err(SearchError::GitFailed {
            command: "worktree search".to_string(),
            stderr: error.to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::vingilot_worktree::testrepo::Repo;

    fn found(answer: &grep::SearchAnswer) -> Vec<(String, u32)> {
        answer
            .hits
            .iter()
            .map(|hit| (hit.path.clone(), hit.line))
            .collect()
    }

    #[test]
    fn a_literal_search_finds_the_line_and_the_column_it_is_at() {
        let repo = Repo::new();
        repo.write("src.rs", "fn main() {}\nlet needle = 1;\n");
        let answer = search(&repo.path(), "needle", false).expect("the search runs");
        assert_eq!(found(&answer), vec![("src.rs".to_string(), 2)]);
        // "let " is four characters, so the match starts at the 0-based 4th.
        assert_eq!(answer.hits[0].column, 4);
        assert_eq!(answer.hits[0].text, "let needle = 1;");
        assert!(!answer.capped);
        assert_eq!(answer.limit, grep::MAX_HITS);
        assert_eq!(answer.pattern, "needle");
        assert!(!answer.regex);
    }

    #[test]
    fn no_matches_is_an_answer_and_not_a_refusal() {
        // git exits 1 when nothing matched, which is not a failure — and the
        // distinction is the whole of "an empty read is no answer, never
        // nothing there". Read as an error, every unsuccessful search would be
        // an error message; read as an empty list with no answer behind it, the
        // pane could not tell it from a search that has not finished.
        let repo = Repo::new();
        repo.write("src.rs", "fn main() {}\n");
        let answer = search(&repo.path(), "nothinglikethis", false).expect("git answered");
        assert!(answer.hits.is_empty());
        assert!(!answer.capped);
    }

    #[test]
    fn a_literal_search_does_not_read_the_pattern_as_a_regex() {
        // The default, and the reason it is the default: `a.c` typed by
        // somebody looking for a filename must not match `abc`.
        let repo = Repo::new();
        repo.write("src.rs", "abc\na.c\n");
        let answer = search(&repo.path(), "a.c", false).expect("the search runs");
        assert_eq!(found(&answer), vec![("src.rs".to_string(), 2)]);
    }

    #[test]
    fn the_regex_toggle_really_reaches_git() {
        let repo = Repo::new();
        repo.write("src.rs", "abc\na.c\n");
        let answer = search(&repo.path(), "a.c", true).expect("the search runs");
        // Both lines now, which is exactly what `-E` buys and what its absence
        // would silently take away.
        assert_eq!(
            found(&answer),
            vec![("src.rs".to_string(), 1), ("src.rs".to_string(), 2)]
        );
        assert!(answer.regex);
    }

    #[test]
    fn an_untracked_file_is_searched_and_an_ignored_one_is_not() {
        // `--untracked --exclude-standard`. A file an agent has just written is
        // the single most interesting thing in a worktree; a build artefact is
        // the least.
        let repo = Repo::new();
        repo.write(".gitignore", "built/\n");
        repo.write("just-written.rs", "let needle = 1;\n");
        std::fs::create_dir_all(std::path::Path::new(&repo.path()).join("built"))
            .expect("the ignored directory is made");
        repo.write("built/artifact.rs", "let needle = 2;\n");

        let answer = search(&repo.path(), "needle", false).expect("the search runs");
        let paths: Vec<&str> = answer.hits.iter().map(|hit| hit.path.as_str()).collect();
        assert!(paths.contains(&"just-written.rs"));
        assert!(!paths.iter().any(|path| path.starts_with("built/")));
    }

    #[test]
    fn a_binary_file_is_never_a_result() {
        // `-I`, and it is the same judgement `vingilot_files::read` makes with
        // its NUL sniff: a pane that offered to open a file the viewer then
        // refuses is a door onto a wall.
        let repo = Repo::new();
        repo.write_bytes("blob.bin", b"needle\0\x01\x02needle");
        repo.write("plain.txt", "needle\n");
        let answer = search(&repo.path(), "needle", false).expect("the search runs");
        assert_eq!(found(&answer), vec![("plain.txt".to_string(), 1)]);
    }

    #[test]
    fn an_empty_pattern_is_refused_rather_than_matching_every_line() {
        // Not git's refusal — git would happily match every line of every file,
        // which on this repository is 87 MB. Measured, and the reason this
        // variant exists at all.
        let repo = Repo::new();
        assert_eq!(
            search(&repo.path(), "", false),
            Err(SearchError::EmptyPattern)
        );
    }

    #[test]
    fn a_directory_that_is_not_a_repository_says_so_in_its_own_sentence() {
        let dir = crate::vingilot_worktree::testrepo::temp_dir();
        let path = dir.path().to_string_lossy().into_owned();
        assert_eq!(
            search(&path, "needle", false),
            Err(SearchError::NotARepo { path })
        );
    }

    #[test]
    fn a_pattern_git_refuses_comes_back_in_gits_own_words() {
        // An unbalanced bracket. git already writes a better sentence about
        // this than this module could, and rewording it would put a paraphrase
        // between him and the thing that is wrong.
        let repo = Repo::new();
        match search(&repo.path(), "[", true) {
            Err(SearchError::GitFailed { command, stderr }) => {
                assert!(command.starts_with("git grep"), "{command}");
                assert!(!stderr.trim().is_empty(), "git said nothing");
            }
            other => panic!("expected git's own refusal, got {other:?}"),
        }
    }

    #[test]
    fn a_pattern_that_is_a_flag_is_searched_for_rather_than_obeyed() {
        // `-e` is what makes this true, and without it git would read the
        // pattern as an option and refuse — or worse, accept it.
        let repo = Repo::new();
        repo.write("src.rs", "run with --force here\n");
        let answer = search(&repo.path(), "--force", false).expect("the search runs");
        assert_eq!(found(&answer), vec![("src.rs".to_string(), 1)]);
    }

    #[test]
    fn a_pattern_full_of_shell_metacharacters_is_just_text() {
        // The claim `search_args` makes as a shape, made again end to end
        // against the real binary: nothing between the field and the process
        // builds a string a shell reads, so this searches for the characters
        // and creates nothing.
        let repo = Repo::new();
        repo.write("src.rs", "echo $(id); rm -rf /\n");
        let answer = search(&repo.path(), "$(id); rm -rf /", false).expect("the search runs");
        assert_eq!(found(&answer), vec![("src.rs".to_string(), 1)]);
        // And the repository is still exactly what it was.
        assert!(std::path::Path::new(&repo.path())
            .join("README.md")
            .exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_child_that_will_not_finish_is_killed_at_the_deadline() {
        // **The timeout, proved.** Reaching it through a real `git grep` needs
        // a repository pathological enough to take ten seconds; over a child
        // that is only a `sleep` it is deterministic and costs a tenth of a
        // second. Deleting the deadline arm leaves this hanging rather than
        // passing, which is the point.
        let mut child = Command::new("sleep")
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("sleep starts");
        let pid = child.id();
        let killed = wait_bounded(
            &mut child,
            Instant::now() + Duration::from_millis(100),
            Duration::from_millis(10),
        );
        assert!(killed.is_none(), "a child past its deadline is killed");
        // **And it was reaped**, which is the half with the leak in it: one
        // zombie per timed-out search, for as long as the app runs. Asked of
        // the process table rather than of the `Child`, because `try_wait`
        // answers `Ok` on a zombie exactly as it does on a reaped child — the
        // assertion that used to stand here could not fail.
        assert!(
            !still_in_the_process_table(pid),
            "a killed child that is never waited on is a zombie"
        );
    }

    /// Whether the operating system still has a process under this id —
    /// **including a zombie**, which is the whole point of asking. A killed
    /// child that nobody waits on keeps its entry, so this is the one question
    /// that tells a reaped child from a leaked one.
    #[cfg(unix)]
    fn still_in_the_process_table(pid: u32) -> bool {
        matches!(
            Command::new("ps")
                .arg("-p")
                .arg(pid.to_string())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status(),
            Ok(status) if status.success()
        )
    }

    #[cfg(unix)]
    #[test]
    fn a_child_that_finishes_in_time_is_waited_for_rather_than_killed() {
        // The boundary in the direction that matters: a deadline that fired
        // early would kill every search on a slow machine, and nothing else in
        // this module would notice.
        let mut child = Command::new("true")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("true starts");
        let finished = wait_bounded(
            &mut child,
            Instant::now() + Duration::from_secs(30),
            Duration::from_millis(5),
        );
        assert!(finished.is_some(), "a child that exits is not killed");
        assert_eq!(finished.and_then(|status| status.code()), Some(0));
    }

    fn ran(code: Option<i32>, over_budget: bool) -> Ran {
        Ran {
            code,
            over_budget,
            stderr: String::new(),
            stdout: Vec::new(),
            timed_out: false,
        }
    }

    #[test]
    fn a_read_stopped_at_its_budget_is_an_answer_rather_than_git_failing() {
        // **The inversion this module spends a comment on, made to fail.**
        // Dropping the pipe kills git with EPIPE, so there is no exit code to
        // read — a build that consulted the code first would report every
        // over-long search as git failing, and the owner would be told his
        // checkout was broken because his pattern was popular.
        let stopped = ran(None, true);
        assert!(answered(&stopped), "a truncated read is still an answer");
        assert!(capped(false, &stopped), "and it is marked as truncated");
    }

    #[test]
    fn a_git_that_really_refused_is_not_dressed_up_as_a_capped_answer() {
        // The other direction, and the reason `over_budget` is a fact about the
        // read rather than a guess from the exit code: 128 with nothing
        // truncated is git refusing, and reading it as a capped answer would
        // show him an empty list under a sentence claiming there is more.
        assert!(!answered(&ran(Some(128), false)));
        // Killed by something else entirely, with nothing read: no answer.
        assert!(!answered(&ran(None, false)));
    }

    #[test]
    fn gits_two_answering_codes_are_answers_and_neither_is_capped_by_itself() {
        // 0 is "here they are" and 1 is "there are none" — both answers, and
        // the cap on either is whatever the hit limit said, not the exit code.
        assert!(answered(&ran(Some(MATCHED), false)));
        assert!(answered(&ran(Some(NO_MATCHES), false)));
        assert!(!capped(false, &ran(Some(MATCHED), false)));
        assert!(!capped(false, &ran(Some(NO_MATCHES), false)));
        // And the hit cap still caps, on its own, with no budget overrun.
        assert!(capped(true, &ran(Some(MATCHED), false)));
    }

    #[test]
    fn a_search_whose_output_overruns_the_budget_answers_and_says_it_is_capped() {
        // **The byte budget, end to end, through the real binary.** Four MiB
        // cannot be provoked by a fixture anybody should build — so the cap is
        // a parameter, and this drives the whole path at four kilobytes: git
        // writes more than the reader will take, the reader drops the pipe, git
        // dies on EPIPE with no exit code, and what comes back is an ANSWER
        // that says it is short. A build that read the exit code first would
        // refuse here; one that forgot to fold the overrun into `capped` would
        // hand him an unlabelled truncated list, which is the "search that lies
        // about what is in the repo" Task 2 names as unacceptable.
        let repo = Repo::new();
        // Comfortably more than one pipe buffer, so git is still writing when
        // the reader lets go — otherwise the child could finish tidily and the
        // EPIPE path would never be taken.
        let many = "let needle = 1;\n".repeat(40_000);
        repo.write("big.rs", &many);

        let answer =
            search_bounded(&repo.path(), "needle", false, 4096).expect("git answered, capped");
        assert!(answer.capped, "a truncated read is said out loud");
        assert!(
            !answer.hits.is_empty(),
            "and what did fit is still shown to him"
        );
    }

    #[test]
    fn a_search_inside_its_budget_is_not_marked_capped() {
        // The boundary in the direction that matters: a budget read as always
        // overrun would put the "there are more" sentence under every search.
        let repo = Repo::new();
        repo.write("src.rs", "let needle = 1;\n");
        let answer = search_bounded(&repo.path(), "needle", false, MAX_STDOUT_BYTES)
            .expect("the search runs");
        assert!(!answer.capped);
        assert_eq!(found(&answer), vec![("src.rs".to_string(), 1)]);
    }

    #[test]
    fn the_reader_stops_at_its_budget_rather_than_taking_everything() {
        // The byte bound, over a cursor: `git grep -e e` over this repository
        // prints 87 MB and the hit cap cannot stop it, because the cap is
        // applied to the parsed answer and the bytes arrive first.
        let plenty = vec![b'x'; 1024];
        assert_eq!(drain(Some(std::io::Cursor::new(plenty)), 16).len(), 16);
        // And a source inside the budget comes back whole.
        assert_eq!(
            drain(Some(std::io::Cursor::new(b"abc".to_vec())), 16),
            b"abc"
        );
        // A pipe that is not there is no bytes, not a panic.
        assert!(drain(None::<std::io::Cursor<Vec<u8>>>, 16).is_empty());
    }

    #[test]
    fn the_command_does_not_run_on_the_thread_the_webview_talks_on() {
        // See the note on `worktree_search`: only an `async fn` gets
        // `respond_async_serialized`. The thread is not observable from here;
        // the shape that decides it is.
        fn accepts_only_a_future<F: std::future::Future>(_: F) {}
        accepts_only_a_future(worktree_search(
            "/nonexistent".to_string(),
            "x".to_string(),
            false,
        ));
    }
}
