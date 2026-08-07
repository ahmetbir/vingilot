//! Opening and closing a repository's worktrees from the workspace
//! (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 6).
//!
//! Until now a worktree existed only because a Run provisioned one. The owner
//! could not make one himself without leaving the app for a shell, which is
//! the alt-tab this whole workspace exists to end.
//!
//! **Three rules this module is built around.**
//!
//! 1. **A refusal is an answer.** A branch that already exists, a base ref
//!    that does not, a directory already sitting where the worktree would go,
//!    a working tree with uncommitted changes in it — each is reported with
//!    the thing that is in the way named, and nothing is done. None of them is
//!    a state to recover from by overriding.
//! 2. **`--force` is never passed.** `git worktree remove` refuses a dirty
//!    tree, and that refusal *is the feature*: it is the only thing standing
//!    between an afternoon's uncommitted work and an app that throws it away
//!    on a mis-click. This module therefore reads what is dirty and shows it,
//!    then stops. There is no flag, no setting, and no code path here that
//!    proceeds anyway.
//! 3. **Nothing here deletes a directory.** `git worktree add` creates one and
//!    `git worktree remove` removes the one it created, both entirely inside
//!    git. This module contains no filesystem removal of any kind — the only
//!    write it makes is `create_dir_all` for the parent of a worktree about to
//!    be added.
//!
//! **Why shell out to git rather than link a git library.** These three
//! operations are worktree *administration*: they write `.git/worktrees/<n>/`
//! metadata, a `.git` pointer file, `gitdir`/`commondir` links, and an index —
//! and they must interoperate exactly with the git the owner runs in the
//! terminal one pane over. A second implementation of that bookkeeping is a
//! second opinion about the owner's repository, which is the last thing this
//! app should have.

pub mod diff;
mod porcelain;
#[cfg(test)]
mod testrepo;

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use serde::Serialize;

use porcelain::parse_worktree_list;
pub use porcelain::GitWorktree;

/// Where to look for git, in order.
///
/// PATH first, then the well-known install locations, for the same reason
/// `vingilot_pty/tmux.rs` does it: an app launched from Finder does not
/// inherit a login shell's `PATH`, and a PATH-only probe would report "no
/// git" on a machine that plainly has one.
const CANDIDATES: &[&str] = &[
    "git",
    "/opt/homebrew/bin/git",
    "/usr/local/bin/git",
    "/usr/bin/git",
];

/// How many dirty paths travel back to the UI. Enough to recognise what is
/// in the worktree, bounded so that a refusal over a half-built `node_modules`
/// is a sentence and a list, not a megabyte of IPC.
const DIRTY_LIMIT: usize = 40;

/// Why an operation did not happen. Every variant names the thing in the way,
/// because the owner's next action differs for each: pick another branch name,
/// pick a base that exists, commit or stash, remove something else.
///
/// Serialised as `{ "kind": "…", … }` for `features/runs/lib/worktreePlan.ts`,
/// which owns the copy.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum WorktreeError {
    /// No git on this machine that answers `--version`.
    GitMissing,
    /// The project's own path is not a repository (any more).
    NotARepo { path: String },
    /// `git check-ref-format` rejected the branch name.
    InvalidBranch { branch: String },
    /// The branch already exists. Reported rather than reused: attaching a
    /// second working tree to a branch is not what "new worktree" means, and
    /// git would refuse it anyway if the branch were checked out elsewhere.
    BranchExists { branch: String },
    /// Something is already at the path the worktree would occupy. Never
    /// cleared — that is the owner's directory, and this app has no business
    /// deciding it is disposable.
    PathExists { path: String },
    /// The base ref names no commit in this repository.
    UnknownBase { base: String },
    /// The working tree has uncommitted changes or untracked files, listed as
    /// `git status --porcelain` prints them. `total` is the real count;
    /// `entries` is capped at `DIRTY_LIMIT`.
    Dirty {
        path: String,
        entries: Vec<String>,
        total: usize,
    },
    /// The repository's own working tree. Not removable, here or in git.
    MainWorktree { path: String },
    /// git does not know this path as a worktree of this repository.
    NotAWorktree { path: String },
    /// git ran and refused, and this module has no better name for why.
    /// `stderr` is git's own words, which are usually the right ones.
    GitFailed { command: String, stderr: String },
}

/// The git this app will use, probed once and cached for its lifetime.
fn git() -> Option<&'static str> {
    static GIT: OnceLock<Option<String>> = OnceLock::new();
    GIT.get_or_init(|| {
        CANDIDATES
            .iter()
            .find(|candidate| responds_to_version(candidate))
            .map(|candidate| (*candidate).to_string())
    })
    .as_deref()
}

/// Whether a candidate path is a git that runs. `--version` rather than a
/// stat: it proves the binary is executable and answers.
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

/// Stderr kept from any one git command. git's diagnostics are a line or two;
/// this is only here so a command that decides to narrate cannot cost memory.
const MAX_STDERR_BYTES: usize = 8 * 1024;

struct Ran {
    /// Whether git is reporting an answer rather than a refusal. For a read
    /// this side cut short (`run_capped`) it is always true: closing the pipe
    /// is what ended git, and that is not a fault to report.
    ok: bool,
    stdout: String,
    stderr: String,
}

/// Run git with `-C <cwd>`, capturing both streams.
///
/// `GIT_TERMINAL_PROMPT=0` because a desktop app has no terminal to answer a
/// credential prompt on: without it a repository with an authenticating remote
/// could hang this call forever with nothing on screen to explain it.
/// `stdin` is closed for the same reason.
///
/// **Unbounded, so only for output whose size is the repository's shape rather
/// than a file's contents** — a path list, a `--numstat` table, a `status
/// --porcelain`. Anything that can carry the bytes of a file the owner wrote
/// goes through `run_capped`.
fn run(cwd: &str, args: &[&str]) -> Result<Ran, WorktreeError> {
    let git = git().ok_or(WorktreeError::GitMissing)?;
    let output = Command::new(git)
        .arg("-C")
        .arg(cwd)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .output()
        .map_err(|error| WorktreeError::GitFailed {
            command: describe(args),
            stderr: error.to_string(),
        })?;
    Ok(Ran {
        ok: output.status.success(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
    })
}

/// Read at most `limit` bytes, then drop the pipe.
///
/// Dropping it is the point: the writer at the other end gets `EPIPE` on its
/// next write and stops, instead of producing output this side would allocate
/// and immediately discard.
fn read_capped(source: Option<impl Read>, limit: usize) -> Vec<u8> {
    let mut buf = Vec::new();
    if let Some(source) = source {
        let _ = source.take(limit as u64).read_to_end(&mut buf);
    }
    buf
}

/// Run git, reading at most `limit` bytes of its stdout.
///
/// **Why this exists.** `Command::output()` buffers all of stdout into a
/// `Vec<u8>` and hands back a second full copy as a `String`, so a cap applied
/// to the result is a cap on what is *displayed*, not on what is *read*: an
/// untracked 191 MB log in a worktree costs ~404 MB of resident memory before
/// the first byte is cut. A per-file patch is exactly that kind of output —
/// its size is a file the owner (or an agent) wrote, not anything about the
/// repository — so the cut has to happen at the pipe.
///
/// stderr is drained on its own thread. Reading it after stdout would deadlock
/// against a git that fills the stderr pipe while this side is still reading
/// stdout, and closing it would turn git's own diagnostics into `EPIPE`.
fn run_capped(cwd: &str, args: &[&str], limit: usize) -> Result<Ran, WorktreeError> {
    let git = git().ok_or(WorktreeError::GitMissing)?;
    let failed = |stderr: String| WorktreeError::GitFailed {
        command: describe(args),
        stderr,
    };
    let mut child = Command::new(git)
        .arg("-C")
        .arg(cwd)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| failed(error.to_string()))?;

    let errors = child.stderr.take();
    let draining = std::thread::spawn(move || read_capped(errors, MAX_STDERR_BYTES));
    let out = read_capped(child.stdout.take(), limit);
    let status = child.wait().map_err(|error| failed(error.to_string()))?;
    let err = draining.join().unwrap_or_default();

    // A command this side cut short cannot be judged by how it ended: git took
    // SIGPIPE on its next write, which is this module's doing.
    let capped = out.len() >= limit;
    Ok(Ran {
        ok: status.success() || capped,
        stderr: String::from_utf8_lossy(&err).into_owned(),
        stdout: String::from_utf8_lossy(&out).into_owned(),
    })
}

fn describe(args: &[&str]) -> String {
    format!("git {}", args.join(" "))
}

/// Whether a query-shaped git command succeeded. Used only for the
/// `rev-parse`/`check-ref-format` probes below, whose failure means "no" and
/// not "something went wrong".
fn answers_yes(cwd: &str, args: &[&str]) -> Result<bool, WorktreeError> {
    Ok(run(cwd, args)?.ok)
}

/// `git worktree add`'s argument vector, built in one place so that a test can
/// assert what is — and is not — in it. Nothing here is conditional: there is
/// no branch of this function that adds a force flag.
fn add_args<'a>(branch: &'a str, path: &'a str, base: &'a str) -> Vec<&'a str> {
    vec!["worktree", "add", "-b", branch, path, base]
}

/// `git worktree remove`'s argument vector. Same reason, and the more
/// important of the two: this is the command whose `--force` would delete the
/// owner's uncommitted work.
fn remove_args(path: &str) -> Vec<&str> {
    vec!["worktree", "remove", path]
}

/// Both sides of a path comparison, resolved. macOS hands out `/var/...`
/// symlinks for temp directories and git prints `/private/var/...`, so a
/// string comparison would call the same directory two different worktrees.
/// A path that cannot be resolved (it does not exist) falls back to itself,
/// which is the right answer for "is this the one git listed" — no.
fn resolved(path: &str) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path))
}

fn same_path(a: &str, b: &str) -> bool {
    resolved(a) == resolved(b)
}

fn ensure_repo(repo: &str) -> Result<(), WorktreeError> {
    if answers_yes(repo, &["rev-parse", "--git-dir"])? {
        return Ok(());
    }
    Err(WorktreeError::NotARepo {
        path: repo.to_string(),
    })
}

fn list(repo: &str) -> Result<Vec<GitWorktree>, WorktreeError> {
    ensure_repo(repo)?;
    let ran = run(repo, &["worktree", "list", "--porcelain"])?;
    if !ran.ok {
        return Err(WorktreeError::GitFailed {
            command: describe(&["worktree", "list", "--porcelain"]),
            stderr: ran.stderr,
        });
    }
    Ok(parse_worktree_list(&ran.stdout))
}

fn add(repo: &str, branch: &str, base: &str, path: &str) -> Result<GitWorktree, WorktreeError> {
    ensure_repo(repo)?;

    // Ask git what a valid branch name is rather than deciding here: the rules
    // (`git check-ref-format`) are longer than they look and are git's to
    // change.
    if !answers_yes(repo, &["check-ref-format", "--branch", branch])? {
        return Err(WorktreeError::InvalidBranch {
            branch: branch.to_string(),
        });
    }
    if answers_yes(repo, &["rev-parse", "--verify", "--quiet", &heads(branch)])? {
        return Err(WorktreeError::BranchExists {
            branch: branch.to_string(),
        });
    }
    if !answers_yes(repo, &["rev-parse", "--verify", "--quiet", &commit(base)])? {
        return Err(WorktreeError::UnknownBase {
            base: base.to_string(),
        });
    }
    // `symlink_metadata`, so a dangling symlink at the path counts as
    // occupied — git would refuse it too, and less clearly.
    if std::fs::symlink_metadata(path).is_ok() {
        return Err(WorktreeError::PathExists {
            path: path.to_string(),
        });
    }

    // The worktree root (`~/.vingilot/worktrees/<project>/`) will not exist
    // the first time. Creating the parent is the only filesystem write this
    // module makes; the leaf is git's to create, and must not exist when git
    // gets there.
    if let Some(parent) = Path::new(path).parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            return Err(WorktreeError::GitFailed {
                command: format!("mkdir -p {}", parent.display()),
                stderr: error.to_string(),
            });
        }
    }

    let args = add_args(branch, path, base);
    let ran = run(repo, &args)?;
    if !ran.ok {
        return Err(WorktreeError::GitFailed {
            command: describe(&args),
            stderr: ran.stderr,
        });
    }

    // Report the worktree as git now sees it, not as it was asked for — the
    // path git recorded is the canonical one, and it is the path every later
    // operation has to match against.
    list(repo)?
        .into_iter()
        .find(|wt| same_path(&wt.path, path))
        .ok_or_else(|| WorktreeError::NotAWorktree {
            path: path.to_string(),
        })
}

fn heads(branch: &str) -> String {
    format!("refs/heads/{branch}")
}

/// `<ref>^{commit}` — a base that resolves to a tree or a blob is not
/// something a worktree can be checked out at, and `rev-parse` will say so.
fn commit(base: &str) -> String {
    format!("{base}^{{commit}}")
}

/// What `git status --porcelain` reports in a worktree, or an empty list.
/// Untracked files included (the default): `git worktree remove` refuses over
/// them too, so a check that ignored them would promise a removal git will not
/// perform.
fn dirty_entries(path: &str) -> Result<Vec<String>, WorktreeError> {
    let ran = run(path, &["status", "--porcelain"])?;
    if !ran.ok {
        return Err(WorktreeError::GitFailed {
            command: describe(&["status", "--porcelain"]),
            stderr: ran.stderr,
        });
    }
    Ok(ran
        .stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

fn remove(repo: &str, path: &str) -> Result<(), WorktreeError> {
    let known = list(repo)?;
    let target = known
        .iter()
        .find(|wt| same_path(&wt.path, path))
        .ok_or_else(|| WorktreeError::NotAWorktree {
            path: path.to_string(),
        })?;

    // The repository itself. git refuses this too ("is a main working tree"),
    // but the refusal belongs here where it can be worded for someone who did
    // not ask for it in a shell.
    if target.is_main {
        return Err(WorktreeError::MainWorktree {
            path: target.path.clone(),
        });
    }

    // Read what is dirty *before* asking git to remove, so the refusal can
    // show it. git's own check is the backstop and stays in force — this one
    // exists to answer "dirty how?", not to replace it.
    let entries = dirty_entries(&target.path)?;
    if !entries.is_empty() {
        let total = entries.len();
        return Err(WorktreeError::Dirty {
            entries: entries.into_iter().take(DIRTY_LIMIT).collect(),
            path: target.path.clone(),
            total,
        });
    }

    let args = remove_args(&target.path);
    let ran = run(repo, &args)?;
    if !ran.ok {
        return Err(WorktreeError::GitFailed {
            command: describe(&args),
            stderr: ran.stderr,
        });
    }
    Ok(())
}

/// Run one of this module's git operations off the thread the webview talks
/// on, and report a runtime that could not run it rather than swallowing it.
///
/// **Every command below is `async` for this one reason.** A `#[tauri::command]`
/// declared `fn` is generated with `ExecutionContext::Blocking`
/// (tauri-macros 2.6.3, `command/wrapper.rs`), which inlines the call into the
/// IPC scheme handler — on macOS/WKWebView, the main thread. Each of these
/// operations is one or more `git` subprocesses against a real checkout, and
/// while one runs, nothing else the app is asked to do can start: not the next
/// IPC, not a keystroke on its way to a terminal. The terminal staying
/// responsive is the product.
async fn off_thread<T, F>(command: &str, work: F) -> Result<T, WorktreeError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, WorktreeError> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(work).await {
        Ok(answer) => answer,
        Err(error) => Err(WorktreeError::GitFailed {
            command: command.to_string(),
            stderr: error.to_string(),
        }),
    }
}

/// Every worktree of a project, git's answer verbatim.
#[tauri::command]
pub async fn worktree_list(repo: String) -> Result<Vec<GitWorktree>, WorktreeError> {
    off_thread("worktree list", move || list(&repo)).await
}

/// A new branch on a new working tree. `path` is chosen by the caller
/// (`features/runs/lib/worktreePlan.ts` derives it from the same worktree root
/// the executor uses) because only the frontend can resolve the home
/// directory it hangs off.
#[tauri::command]
pub async fn worktree_add(
    repo: String,
    branch: String,
    base: String,
    path: String,
) -> Result<GitWorktree, WorktreeError> {
    off_thread("worktree add", move || add(&repo, &branch, &base, &path)).await
}

/// Close a worktree, if git will. See this module's rule 2: no force, ever.
#[tauri::command]
pub async fn worktree_remove(repo: String, path: String) -> Result<(), WorktreeError> {
    off_thread("worktree remove", move || remove(&repo, &path)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;

    use super::testrepo::{temp_dir, worktree_path, write_at, Repo};

    #[test]
    fn a_fresh_repository_lists_only_its_own_working_tree() {
        let repo = Repo::new();
        let listed = list(&repo.path()).unwrap_or_default();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].is_main);
        assert_eq!(listed[0].branch.as_deref(), Some("main"));
    }

    #[test]
    fn a_worktree_is_created_on_a_new_branch_and_then_listed() {
        let repo = Repo::new();
        let root = temp_dir();
        let path = worktree_path(&root, "fix");

        let created = add(&repo.path(), "fix", "main", &path);
        let created = match created {
            Ok(wt) => wt,
            Err(error) => panic!("expected a worktree, got {error:?}"),
        };
        assert_eq!(created.branch.as_deref(), Some("fix"));
        assert!(!created.is_main);
        assert!(same_path(&created.path, &path));
        assert!(Path::new(&path).join(".git").exists());

        let listed = list(&repo.path()).unwrap_or_default();
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().any(|wt| wt.branch.as_deref() == Some("fix")));

        // Teardown through the same door the app uses.
        assert_eq!(remove(&repo.path(), &path), Ok(()));
        assert_eq!(list(&repo.path()).unwrap_or_default().len(), 1);
    }

    #[test]
    fn the_parent_of_the_worktree_root_is_created_when_it_is_missing() {
        let repo = Repo::new();
        let root = temp_dir();
        // Two levels that do not exist yet — the shape of
        // `~/.vingilot/worktrees/<project>/<branch>` on a first run.
        let path = root
            .path()
            .join("worktrees")
            .join("project")
            .join("fix")
            .to_string_lossy()
            .into_owned();
        assert!(add(&repo.path(), "fix", "main", &path).is_ok());
        assert!(Path::new(&path).is_dir());
        assert_eq!(remove(&repo.path(), &path), Ok(()));
    }

    #[test]
    fn a_branch_that_already_exists_is_reported_not_reused() {
        let repo = Repo::new();
        let root = temp_dir();
        repo.git(&["branch", "taken"]);
        assert_eq!(
            add(&repo.path(), "taken", "main", &worktree_path(&root, "t")),
            Err(WorktreeError::BranchExists {
                branch: "taken".to_string()
            })
        );
    }

    #[test]
    fn a_base_ref_that_names_nothing_is_reported() {
        let repo = Repo::new();
        let root = temp_dir();
        assert_eq!(
            add(
                &repo.path(),
                "fix",
                "no-such-ref",
                &worktree_path(&root, "t")
            ),
            Err(WorktreeError::UnknownBase {
                base: "no-such-ref".to_string()
            })
        );
    }

    #[test]
    fn an_unusable_branch_name_is_reported_in_gits_own_terms() {
        let repo = Repo::new();
        let root = temp_dir();
        assert_eq!(
            add(
                &repo.path(),
                "has a space",
                "main",
                &worktree_path(&root, "t")
            ),
            Err(WorktreeError::InvalidBranch {
                branch: "has a space".to_string()
            })
        );
    }

    #[test]
    fn a_directory_already_at_the_path_is_reported_never_cleared() {
        let repo = Repo::new();
        let root = temp_dir();
        let path = worktree_path(&root, "occupied");
        if let Err(error) = fs::create_dir_all(&path) {
            panic!("could not create {path}: {error}");
        }
        write_at(&Path::new(&path).join("keep-me.txt"), "the owner's file\n");

        assert_eq!(
            add(&repo.path(), "fix", "main", &path),
            Err(WorktreeError::PathExists { path: path.clone() })
        );
        // The refusal left it exactly as it was.
        assert!(Path::new(&path).join("keep-me.txt").is_file());
    }

    #[test]
    fn a_dirty_worktree_is_not_removed_and_says_what_is_dirty() {
        let repo = Repo::new();
        let root = temp_dir();
        let path = worktree_path(&root, "dirty");
        assert!(add(&repo.path(), "fix", "main", &path).is_ok());

        write_at(&Path::new(&path).join("README.md"), "changed\n");
        write_at(&Path::new(&path).join("scratch.txt"), "untracked\n");

        match remove(&repo.path(), &path) {
            Err(WorktreeError::Dirty {
                entries,
                total,
                path: reported,
            }) => {
                assert!(same_path(&reported, &path));
                assert_eq!(total, 2);
                assert!(entries.iter().any(|line| line.ends_with("README.md")));
                assert!(entries.iter().any(|line| line.starts_with("?? ")));
            }
            other => panic!("expected a dirty refusal, got {other:?}"),
        }

        // Still there, with the owner's work in it.
        assert!(Path::new(&path).join("scratch.txt").is_file());
        assert_eq!(list(&repo.path()).unwrap_or_default().len(), 2);
    }

    #[test]
    fn the_repositorys_own_working_tree_is_refused_before_git_is_asked() {
        let repo = Repo::new();
        match remove(&repo.path(), &repo.path()) {
            Err(WorktreeError::MainWorktree { path }) => assert!(same_path(&path, &repo.path())),
            other => panic!("expected a main-worktree refusal, got {other:?}"),
        }
        assert!(Path::new(&repo.path()).join("README.md").is_file());
    }

    #[test]
    fn a_path_that_is_not_a_worktree_of_this_repository_is_refused() {
        let repo = Repo::new();
        let stranger = temp_dir();
        let path = stranger.path().to_string_lossy().into_owned();
        assert_eq!(
            remove(&repo.path(), &path),
            Err(WorktreeError::NotAWorktree { path })
        );
    }

    #[test]
    fn a_directory_that_is_not_a_repository_is_refused_by_every_operation() {
        let plain = temp_dir();
        let path = plain.path().to_string_lossy().into_owned();
        let not_a_repo = WorktreeError::NotARepo { path: path.clone() };
        assert_eq!(list(&path), Err(not_a_repo.clone()));
        assert_eq!(
            add(&path, "fix", "main", &format!("{path}/nowhere")),
            Err(not_a_repo.clone())
        );
        assert_eq!(remove(&path, &path), Err(not_a_repo));
    }

    #[test]
    fn a_capped_read_stops_at_the_pipe_rather_than_after_the_allocation() {
        // Measured before this existed: `git diff --no-index` against a 191 MB
        // untracked file returned 202,000,125 bytes, which `Command::output()`
        // held as a Vec and `from_utf8_lossy` copied into a String — ~404 MB
        // resident, per file, before any cap was applied. A file an agent
        // wrote is not bounded by anything about the repository, so the read
        // has to be.
        let repo = Repo::new();
        repo.write("big.txt", &"x".repeat(400_000));
        let args = [
            "diff",
            "--no-ext-diff",
            "--no-color",
            "--no-index",
            "--",
            "/dev/null",
            "big.txt",
        ];

        let capped = match run_capped(&repo.path(), &args, 4096) {
            Ok(ran) => ran,
            Err(error) => panic!("expected a capped read, got {error:?}"),
        };
        assert_eq!(capped.stdout.len(), 4096);
        // git died of SIGPIPE because this side stopped reading. That is this
        // module's doing and must not surface as a failed command.
        assert!(capped.ok);

        let whole = match run(&repo.path(), &args) {
            Ok(ran) => ran,
            Err(error) => panic!("expected a full read, got {error:?}"),
        };
        assert!(whole.stdout.len() > 400_000);
    }

    #[test]
    fn a_read_that_fits_under_its_cap_is_not_reported_as_cut() {
        let repo = Repo::new();
        let ran = match run_capped(&repo.path(), &["rev-parse", "--abbrev-ref", "HEAD"], 4096) {
            Ok(ran) => ran,
            Err(error) => panic!("expected an answer, got {error:?}"),
        };
        assert_eq!(ran.stdout.trim(), "main");
        assert!(ran.ok);
    }

    #[test]
    fn a_capped_read_of_a_command_that_refuses_still_reports_the_refusal() {
        let repo = Repo::new();
        let ran = match run_capped(&repo.path(), &["diff", "no-such-ref"], 4096) {
            Ok(ran) => ran,
            Err(error) => panic!("expected a refusal to be readable, got {error:?}"),
        };
        assert!(!ran.ok);
        assert!(
            !ran.stderr.is_empty(),
            "git's own words are the useful ones"
        );
    }

    #[test]
    fn neither_command_can_be_forced() {
        // The one invariant worth asserting on an argument vector: there is no
        // input, and no branch of the code, that puts a force flag in front of
        // git. A future edit that adds one fails here.
        let add = add_args("fix", "/tmp/x", "main");
        let remove = remove_args("/tmp/x");
        for args in [add, remove] {
            for arg in args {
                assert_ne!(arg, "--force");
                assert_ne!(arg, "-f");
            }
        }
    }
}
