//! The pull requests of the repository a worktree is a checkout of, read with
//! `gh` (vingilot/docs/plans/2026-08-29-redesign.md, P5).
//!
//! > *"worktreelerdeki pull requestleri göstermek… gh ya da git kullanarak"*
//!
//! The workspace half of this app already knows a worktree's branch, its diff,
//! its log and its status — everything git can answer from the disk. What it
//! cannot answer is the question the owner actually asks next: *is there a pull
//! request open for this, and where has it got to.* That answer lives on GitHub,
//! and the machine already has a tool that holds the credential for it. This
//! island is the door to that tool and nothing else.
//!
//! **There is no fake data in here, and the empty case is the reason to say so.**
//! A repository with no open pull requests answers `[]`, and `[]` is a true
//! answer the surface draws as an empty state — not a bug, not a spinner that
//! never ends, and never a plausible-looking list stitched from local branches.
//! The fork's own `origin`, `ahmetbir/vingilot`, is exactly that repository
//! today.
//!
//! **Every way this can fail to produce a list is a different sentence, and the
//! surface must not have to read English to tell them apart.**
//! [`PullsAnswer`] is one tagged union with eight refusals beside the answer,
//! because each of them has a different next action: install `gh`, run `gh auth
//! login`, add a GitHub remote, pick a directory that is a repository, check the
//! network, wait. Collapsing them into one error string would push the
//! classification into the webview as a pile of `stderr.includes(…)` — which is
//! how a rate-limit message in a new `gh` release silently becomes "you are not
//! logged in".
//!
//! **`vingilot_repo` stays subprocess-free.** That module's header argues at
//! length why "is this a repository" is answered by stat-ing four names and
//! never by running git, and this island does not change it — it *calls* it, for
//! the same answer, before it runs anything at all. A path that is not a git
//! working tree is refused without a single `fork`.
//!
//! **This island only reads.** [`payload`] holds every argument vector it is
//! willing to hand `gh`; there is no vector that creates, merges, closes or
//! comments, and a test asserts it. Authentication is `gh`'s own keyring: no
//! token is read, constructed, passed in argv, put in an environment variable,
//! or logged anywhere in this module, and `gh auth status` is run for its exit
//! code with both its streams thrown away.
//!
//! **Both bounds are in the types rather than in a comment.** A repository with
//! four hundred open pull requests answers with [`PULL_CAP`] of them and
//! [`PullList::more`] set, so the surface can say "the first fifty of more"
//! instead of quietly showing half a truth; and a `gh` that hangs — a proxy
//! swallowing the connection, a captive portal — is killed at [`GH_TIMEOUT`] and
//! reported as [`PullsAnswer::TimedOut`], because a desktop app that waits
//! forever on a subprocess has no way to tell the owner what it is waiting for.

pub mod payload;
pub mod remote;

#[cfg(test)]
#[path = "pulls_tests.rs"]
mod pulls_tests;

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::vingilot_repo::{probe, RepoProbe};
use payload::{auth_args, list_args, parse_list, parse_view, view_args, Pull};
use remote::{choose, parse_remotes, RepoSlug};

/// The GitHub this island talks to. See the `GITHUB_HOSTS` constant in
/// [`remote`] for why an Enterprise host is out of scope rather than guessed at.
const GITHUB_HOST: &str = "github.com";

/// How many pull requests one list carries.
///
/// Fifty is a screenful several times over and one HTTP page for `gh`. The
/// number is reported back in [`PullList::cap`] and the truth about what was
/// left out in [`PullList::more`]: the repository is asked for one *more* than
/// this, so "there are more" is something this module observed rather than
/// assumed.
pub const PULL_CAP: usize = 50;

/// How long any one `gh` or `git` invocation gets.
///
/// Twenty seconds is generous for an API call and short enough that a hung one
/// is a sentence on screen rather than a frozen panel. It is a wall-clock cap on
/// the child, not a request timeout inside `gh`: a process wedged before it ever
/// opens a socket is exactly the case that needs it.
const GH_TIMEOUT: Duration = Duration::from_secs(20);

/// Reading four lines out of a local config file needs nothing like the budget
/// an API call does.
const GIT_TIMEOUT: Duration = Duration::from_secs(10);

/// How often the child is checked for having exited. Twenty-five milliseconds
/// costs nothing next to a network round trip and keeps the answer prompt.
const POLL: Duration = Duration::from_millis(25);

/// The most `gh` may print before this side stops reading.
///
/// A backstop, not the real bound — the real bounds are [`PULL_CAP`] and
/// [`BODY_CAP`], which keep a well-behaved answer three orders of magnitude
/// under this. It exists so that a `gh` which decides to narrate cannot cost the
/// app its memory, and tripping it is reported rather than parsed around.
const MAX_STDOUT_BYTES: usize = 2 * 1024 * 1024;

/// Stderr kept from any one child: enough for a diagnostic, not a log file.
const MAX_STDERR_BYTES: usize = 8 * 1024;

/// How much of a pull request body travels back.
///
/// The one field whose size is a person's writing rather than the shape of a
/// repository. Cut on a character boundary, with [`PullDetail::body_truncated`]
/// saying so.
const BODY_CAP: usize = 16 * 1024;

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

/// What a pulls command answers with: the thing that was asked for, or the one
/// refusal that explains why not.
///
/// **Generic over the payload so the eight refusals are written once.** The
/// listing and the single read have the same failure surface — the same `gh`,
/// the same keyring, the same repository resolution — and two enums would be two
/// places to forget a variant, and two `switch`es for the surface to keep in
/// step. `Answer(T)` is a newtype variant under an internal tag, so a list
/// serialises as `{"kind":"answer","repo":…,"pulls":[…]}` and the webview reads
/// one discriminant for both commands.
///
/// Serialised as `{ "kind": "…", … }`. The surface owns the copy for each kind;
/// nothing here is a sentence.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PullsAnswer<T> {
    /// The real thing. A [`PullList`] here may be empty, and an empty one is a
    /// true answer about a repository with nothing open.
    Answer(T),
    /// The path is not a git working tree. `enclosing` is the nearest ancestor
    /// that is one, when there is one, so the refusal can name where to look
    /// instead — the same hint [`crate::vingilot_repo`] gives the folder picker.
    NotARepo {
        path: String,
        enclosing: Option<String>,
    },
    /// No git on this machine that answers `--version`, so the repository's
    /// remotes cannot be read at all.
    GitMissing,
    /// git ran and refused while reading the config. `detail` is git's own
    /// words.
    GitFailed { detail: String },
    /// The repository is real and has no remote on github.com. `remotes` are
    /// the remote *names* — never their URLs, which may carry a credential
    /// (see [`remote`]'s header). An empty `remotes` means a repository with no
    /// remotes at all, which is a local-only checkout and equally honest.
    ///
    /// **Renamed explicitly, because the derive gets this one wrong.**
    /// `rename_all = "kebab-case"` splits an identifier at every capital, so
    /// `NoGitHubRemote` serialises as `no-git-hub-remote` — "GitHub" is one
    /// word to a person and three to serde. The surface switches on this
    /// string, so the wire name is pinned here rather than left to depend on
    /// how a derive happens to case-split a proper noun.
    #[serde(rename = "no-github-remote")]
    NoGitHubRemote { path: String, remotes: Vec<String> },
    /// There is no `gh` on this machine.
    GhMissing,
    /// `gh` is here and is not logged in to `host`. Established from `gh auth
    /// status`'s exit code, never from words in a stderr.
    GhUnauthenticated { host: String },
    /// `gh` ran and did not produce an answer: no network, a rate limit, a
    /// repository that has been renamed or that this account cannot see, or a
    /// payload that did not parse. `detail` is `gh`'s own stderr (or serde's
    /// sentence), capped to a few lines.
    RequestFailed { repo: String, detail: String },
    /// The child was still running at the deadline and was killed. `command` is
    /// the argument vector, so a hang is attributable to the call that hung.
    TimedOut { command: String, seconds: u64 },
}

/// A repository's open pull requests.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullList {
    /// The repository the list is *of*, so the surface can name it rather than
    /// implying the worktree's own directory has pull requests.
    pub repo: RepoSlug,
    /// Which git remote it was resolved from — a name, never a URL.
    pub remote: String,
    /// Open pull requests, newest first, as GitHub ordered them. May be empty.
    pub pulls: Vec<Pull>,
    /// The cap that was applied. Stated so the surface never has to hardcode it.
    pub cap: usize,
    /// Whether the repository has more open pull requests than `cap`.
    pub more: bool,
}

/// One pull request, read whole.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullDetail {
    pub repo: RepoSlug,
    pub remote: String,
    pub pull: Pull,
    /// The description, capped at [`BODY_CAP`] bytes on a character boundary.
    pub body: String,
    /// Whether `body` was cut.
    pub body_truncated: bool,
}

// ---------------------------------------------------------------------------
// Finding gh, and running it
// ---------------------------------------------------------------------------

/// Where `gh` is looked for, in order.
///
/// **PATH first, then the places a package manager actually puts it** — the
/// lesson `vingilot_harbor::candidates` and `vingilot_pty/tmux.rs` both write
/// down, and the one that cost the harbor a whole first install: *an app
/// launched from Finder does not inherit a login shell's `PATH`.* A PATH-only
/// probe on a Dock-launched build would tell an owner with a working, logged-in
/// `gh` that he has no `gh`, and the sentence he would get is the one asking him
/// to install what he already has.
const CANDIDATES: &[&str] = &[
    "gh",
    "/opt/homebrew/bin/gh",
    "/usr/local/bin/gh",
    "/opt/local/bin/gh",
    "/usr/bin/gh",
];

/// Whether a candidate is a `gh` that runs. `--version` and not `auth status`:
/// this question is "is the tool here", and it has to answer yes on a machine
/// where the tool is here and logged out — that is a different refusal.
fn responds_to_version(candidate: &str) -> bool {
    matches!(
        Command::new(candidate)
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status(),
        Ok(status) if status.success()
    )
}

/// The first candidate `usable` accepts.
///
/// Takes the predicate so the ordering rule is tested on a machine without
/// `gh`, and the absent case on one that has it.
pub(crate) fn binary_with(usable: &impl Fn(&str) -> bool) -> Option<&'static str> {
    CANDIDATES
        .iter()
        .copied()
        .find(|candidate| usable(candidate))
}

/// The probe, once per app run: at most five `exec`s, and the answer does not
/// change while the app is open in any way that matters.
fn binary() -> Option<&'static str> {
    static FOUND: OnceLock<Option<&'static str>> = OnceLock::new();
    *FOUND.get_or_init(|| binary_with(&responds_to_version))
}

/// The `PATH` a child of this island gets.
///
/// Resolving `gh` by absolute path is not enough, for the reason
/// `vingilot_harbor::child_path` documents about docker's credential helper:
/// `gh` invokes `git` **through `PATH`** — for its own config, and for the
/// credential helper `gh auth setup-git` installs — so a Finder-launched app's
/// stripped `PATH` produces a `gh` that is found and then fails inside itself.
/// The child gets the app's `PATH` plus the resolved binary's own directory
/// first, then the usual install prefixes, with nothing added twice.
pub(crate) fn child_path(binary: &str, current: Option<&str>) -> String {
    let mut path = current.unwrap_or_default().to_owned();
    let mut extras: Vec<&str> = Vec::new();
    let parent = Path::new(binary).parent().map(Path::to_string_lossy);
    if let Some(parent) = parent.as_deref() {
        if !parent.is_empty() {
            extras.push(parent);
        }
    }
    extras.extend(["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"]);
    extras.extend(["/usr/bin", "/bin"]);
    for extra in extras {
        if path.split(':').any(|segment| segment == extra) {
            continue;
        }
        if !path.is_empty() {
            path.push(':');
        }
        path.push_str(extra);
    }
    path
}

/// What a child produced.
pub(crate) struct Ran {
    pub ok: bool,
    /// The exit status, when the platform reports one. Kept because one caller
    /// needs to tell git's two refusals apart: `config --get-regexp` exits 1
    /// with no output when nothing matched — a repository with no remotes,
    /// which is an answer — and 128 when it could not read the config at all,
    /// which is a fault.
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    /// Whether [`MAX_STDOUT_BYTES`] was reached, which makes `stdout` a
    /// fragment rather than an answer.
    pub capped: bool,
}

/// Why a child produced nothing at all.
pub(crate) enum RunFailure {
    /// It could not be started, or could not be waited on.
    Launch(String),
    /// It was still running at the deadline and was killed.
    TimedOut,
}

/// Read at most `limit` bytes, then drop the pipe — the writer takes `EPIPE` on
/// its next write instead of producing output this side would discard.
fn read_capped(source: Option<impl Read>, limit: usize) -> Vec<u8> {
    let mut buf = Vec::new();
    if let Some(source) = source {
        let _ = source.take(limit as u64).read_to_end(&mut buf);
    }
    buf
}

/// Run a child with a wall-clock deadline, capturing both streams.
///
/// **Both pipes are drained on their own threads, and the deadline is a poll
/// rather than a blocking wait.** The two constraints fight: a blocking
/// `wait()` cannot be interrupted with only `std`, and reading stdout to EOF on
/// this thread would make the timeout unreachable for the exact child that needs
/// it — one that has printed nothing and never will. So the readers run beside
/// the child (which also stops a child that fills a 64 KiB pipe buffer from
/// deadlocking against a parent that is not reading it), and this thread does
/// nothing but ask whether it has exited yet.
///
/// **On the timeout path the reader threads are dropped, not joined.** After
/// `kill` the child's pipes close and both threads end on their own; joining
/// them would reintroduce the hang this function exists to prevent, in the one
/// case where a grandchild of the child still holds the write end open.
///
/// The environment is the app's own, plus a `PATH` (see [`child_path`]) and
/// three switches that make a child of a *desktop* app behave: no prompts, since
/// there is no terminal to answer one on and a child waiting for input is a
/// hang; no update check, since it is latency on every call.
/// **No credential of any kind is constructed here.** `gh` reads its own
/// keyring, and this app never learns what is in it.
fn run(binary: &str, args: &[String], timeout: Duration) -> Result<Ran, RunFailure> {
    let mut child = Command::new(binary)
        .args(args)
        .env(
            "PATH",
            child_path(binary, std::env::var("PATH").ok().as_deref()),
        )
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| RunFailure::Launch(format!("{binary} did not start: {error}")))?;

    let out_pipe = child.stdout.take();
    let err_pipe = child.stderr.take();
    let reading_out = std::thread::spawn(move || read_capped(out_pipe, MAX_STDOUT_BYTES));
    let reading_err = std::thread::spawn(move || read_capped(err_pipe, MAX_STDERR_BYTES));

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Err(error) => return Err(RunFailure::Launch(error.to_string())),
            Ok(Some(status)) => {
                let out = reading_out.join().unwrap_or_default();
                let err = reading_err.join().unwrap_or_default();
                return Ok(Ran {
                    ok: status.success(),
                    code: status.code(),
                    capped: out.len() >= MAX_STDOUT_BYTES,
                    stdout: String::from_utf8_lossy(&out).into_owned(),
                    stderr: String::from_utf8_lossy(&err).into_owned(),
                });
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    // Returning here drops both handles, which detaches the
                    // threads. That is the intent: see this function's header.
                    return Err(RunFailure::TimedOut);
                }
                std::thread::sleep(POLL);
            }
        }
    }
}

/// The first `count` non-blank lines of a diagnostic, joined. A refusal is a
/// sentence in a panel, not a log viewer.
pub(crate) fn first_lines(raw: &str, count: usize) -> String {
    raw.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(count)
        .collect::<Vec<&str>>()
        .join(" ")
}

/// The argument vector, for a refusal that has to name the call that hung.
/// `gh`'s arguments are a verb, a repository and a field list — nothing here can
/// carry a secret, and [`remote`] guarantees the repository never does.
fn describe(binary: &str, args: &[String]) -> String {
    let name = Path::new(binary)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| binary.to_owned());
    format!("{name} {}", args.join(" "))
}

/// Cut a list to [`PULL_CAP`], answering whether there were more.
///
/// The list was asked for at `PULL_CAP + 1`, so a fifty-first element is proof
/// there is a fifty-first pull request — not the "we filled the page, there may
/// be more" guess a cap-sized request would have to make. Separate from
/// [`list`] so the boundary is a test rather than a network round trip.
fn apply_cap(pulls: &mut Vec<Pull>) -> bool {
    let more = pulls.len() > PULL_CAP;
    pulls.truncate(PULL_CAP);
    more
}

/// `body`, cut at [`BODY_CAP`] bytes on a character boundary.
fn capped_body(body: String) -> (String, bool) {
    if body.len() <= BODY_CAP {
        return (body, false);
    }
    let mut cut = BODY_CAP;
    while cut > 0 && !body.is_char_boundary(cut) {
        cut -= 1;
    }
    (body[..cut].to_owned(), true)
}

// ---------------------------------------------------------------------------
// From a worktree path to a repository
// ---------------------------------------------------------------------------

/// The repository a worktree belongs to, and the remote it was named by.
///
/// Generic in the answer's payload only so the refusal can be returned as one:
/// none of the refusal variants mentions `T`, so a resolution failure is already
/// a finished [`PullsAnswer`] for whichever command asked. That is what lets the
/// eight refusals be written once and used by both commands.
fn resolve<T>(worktree: &str) -> Result<remote::Chosen, PullsAnswer<T>> {
    // Stat-only, and deliberately first: a path that is not a repository is
    // refused without starting a single process. `vingilot_repo` runs no
    // subprocess and this island does not make it start.
    if let RepoProbe::NotARepo { root } = probe(Path::new(worktree)) {
        return Err(PullsAnswer::NotARepo {
            path: worktree.to_owned(),
            enclosing: root,
        });
    }
    let git = crate::vingilot_worktree::git().ok_or(PullsAnswer::GitMissing)?;
    let args = git_config_args(worktree);
    let ran = match run(git, &args, GIT_TIMEOUT) {
        Ok(ran) => ran,
        Err(RunFailure::TimedOut) => {
            return Err(PullsAnswer::TimedOut {
                command: describe(git, &args),
                seconds: GIT_TIMEOUT.as_secs(),
            })
        }
        Err(RunFailure::Launch(detail)) => return Err(PullsAnswer::GitFailed { detail }),
    };
    // Exit 1 is "nothing matched": a repository with no remotes, which is an
    // answer and falls through to `NoGitHubRemote` with an empty list. Anything
    // else non-zero (128, typically an unreadable config) is git having a real
    // problem, and is reported as one rather than dressed up as "no remotes".
    if !ran.ok && ran.code != Some(1) {
        return Err(PullsAnswer::GitFailed {
            detail: first_lines(&ran.stderr, 3),
        });
    }
    let remotes = parse_remotes(&ran.stdout);
    choose(&remotes).ok_or_else(|| PullsAnswer::NoGitHubRemote {
        path: worktree.to_owned(),
        // Names only. A URL here would put a credential-bearing remote on
        // screen; see `remote`'s header.
        remotes: remotes.into_iter().map(|entry| entry.name).collect(),
    })
}

/// `git -C <worktree> config --local --null --get-regexp ^remote\..*\.url$`.
///
/// `--local` rather than the default scope so that a directory which is not a
/// repository cannot answer out of the owner's *global* config — and this side
/// never has to wonder whether `origin` came from the tree it asked about.
fn git_config_args(worktree: &str) -> Vec<String> {
    vec![
        "-C".to_owned(),
        worktree.to_owned(),
        "config".to_owned(),
        "--local".to_owned(),
        "--null".to_owned(),
        "--get-regexp".to_owned(),
        r"^remote\..*\.url$".to_owned(),
    ]
}

// ---------------------------------------------------------------------------
// Asking gh
// ---------------------------------------------------------------------------

/// Run `gh` and give back its stdout, or the refusal the surface draws.
fn ask<T>(binary: &str, args: &[String], repo: &RepoSlug) -> Result<String, PullsAnswer<T>> {
    match run(binary, args, GH_TIMEOUT) {
        Err(RunFailure::TimedOut) => Err(PullsAnswer::TimedOut {
            command: describe(binary, args),
            seconds: GH_TIMEOUT.as_secs(),
        }),
        Err(RunFailure::Launch(detail)) => Err(PullsAnswer::RequestFailed {
            repo: repo.slug(),
            detail,
        }),
        Ok(ran) if ran.capped => Err(PullsAnswer::RequestFailed {
            repo: repo.slug(),
            detail: format!("gh printed more than {MAX_STDOUT_BYTES} bytes and was cut short"),
        }),
        Ok(ran) if ran.ok => Ok(ran.stdout),
        Ok(ran) => Err(classify(binary, repo, &ran.stderr)),
    }
}

/// Why a failed `gh` failed: not logged in, or something else.
///
/// **The classification is an exit code, not a substring.** `gh auth status`
/// answers 1 when there is no usable credential for the host and 0 when there
/// is, and that is the whole test. Matching `gh`'s stderr for "not logged in"
/// would be a guess that breaks on the release that rewords it — and it would
/// misread a rate-limit message the moment one mentions authentication.
///
/// It runs only here, on the failure path, so the ordinary answer costs one
/// process and not two.
fn classify<T>(binary: &str, repo: &RepoSlug, stderr: &str) -> PullsAnswer<T> {
    let logged_in = matches!(
        run(binary, &auth_args(GITHUB_HOST), GH_TIMEOUT),
        Ok(ran) if ran.ok
    );
    if logged_in {
        PullsAnswer::RequestFailed {
            repo: repo.slug(),
            detail: first_lines(stderr, 3),
        }
    } else {
        PullsAnswer::GhUnauthenticated {
            host: GITHUB_HOST.to_owned(),
        }
    }
}

fn list(worktree: &str) -> PullsAnswer<PullList> {
    let chosen = match resolve(worktree) {
        Ok(chosen) => chosen,
        Err(refusal) => return refusal,
    };
    let Some(gh) = binary() else {
        return PullsAnswer::GhMissing;
    };
    // One more than the cap, so "there are more than fifty" is something this
    // module saw rather than inferred from a full page.
    let args = list_args(&chosen.repo.slug(), PULL_CAP + 1);
    let raw = match ask(gh, &args, &chosen.repo) {
        Ok(raw) => raw,
        Err(refusal) => return refusal,
    };
    let mut pulls = match parse_list(&raw) {
        Ok(pulls) => pulls,
        Err(detail) => {
            return PullsAnswer::RequestFailed {
                repo: chosen.repo.slug(),
                detail,
            }
        }
    };
    let more = apply_cap(&mut pulls);
    PullsAnswer::Answer(PullList {
        repo: chosen.repo,
        remote: chosen.remote,
        pulls,
        cap: PULL_CAP,
        more,
    })
}

fn view(worktree: &str, number: u64) -> PullsAnswer<PullDetail> {
    let chosen = match resolve(worktree) {
        Ok(chosen) => chosen,
        Err(refusal) => return refusal,
    };
    let Some(gh) = binary() else {
        return PullsAnswer::GhMissing;
    };
    let args = view_args(&chosen.repo.slug(), number);
    let raw = match ask(gh, &args, &chosen.repo) {
        Ok(raw) => raw,
        Err(refusal) => return refusal,
    };
    match parse_view(&raw) {
        Err(detail) => PullsAnswer::RequestFailed {
            repo: chosen.repo.slug(),
            detail,
        },
        Ok((pull, body)) => {
            let (body, body_truncated) = capped_body(body);
            PullsAnswer::Answer(PullDetail {
                repo: chosen.repo,
                remote: chosen.remote,
                pull,
                body,
                body_truncated,
            })
        }
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Run `work` off the IPC thread.
///
/// `async` and `spawn_blocking` for `vingilot_worktree::off_thread`'s reason: a
/// synchronous `#[tauri::command]` runs on the thread the webview's IPC arrives
/// on, and this one can spend [`GH_TIMEOUT`] waiting on a network. A failure to
/// even schedule it is reported as a refusal like any other, so no caller has to
/// handle an `Err` this island otherwise never produces.
async fn off_thread<T, F>(work: F) -> PullsAnswer<T>
where
    T: Send + 'static,
    F: FnOnce() -> PullsAnswer<T> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(work).await {
        Ok(answer) => answer,
        Err(error) => PullsAnswer::RequestFailed {
            repo: String::new(),
            detail: error.to_string(),
        },
    }
}

/// The open pull requests of the repository this worktree is a checkout of.
///
/// Never an `Err`: "you have no `gh`", "this repository is not on GitHub" and
/// "there are none open" are all answers the surface draws, not failures it
/// apologises for.
#[tauri::command]
pub async fn pulls_list(worktree: String) -> PullsAnswer<PullList> {
    off_thread(move || list(&worktree)).await
}

/// One pull request of that repository, read whole.
#[tauri::command]
pub async fn pulls_view(worktree: String, number: u64) -> PullsAnswer<PullDetail> {
    off_thread(move || view(&worktree, number)).await
}
