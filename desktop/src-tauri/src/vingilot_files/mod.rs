//! Seeing a file in a worktree — the tree and the viewer's backing
//! (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 3; design
//! in vingilot/docs/plans/2026-08-12-files-pane-design.md).
//!
//! > *"a file he cannot open is a file he leaves to find elsewhere."*
//!
//! **Two commands, and both of them read.** There is no write of any kind in
//! this module — no create, no rename, no removal, no temp file. The pane above
//! it is a viewer and not an editor, because he has terminals and agents for
//! changing things and an editor is a different promise (undo, saves, a
//! conflict with the agent writing the same file two panes over).
//!
//! **Three rules this module is built around.**
//!
//! 1. **One directory per call, never a walk.** `worktree_tree` lists one level
//!    and expanding a node is another call. A recursive walk of a monorepo is a
//!    freeze, and a freeze in the pane he opened in order *not* to leave is
//!    worse than the editor he left for.
//! 2. **Every bound is reported, and each refusal is its own sentence.** Too
//!    large, looks binary, could not be read — three different next actions for
//!    him, so three different variants of [`FilesError`], each carrying what he
//!    needs to decide. A cap applied silently is a reader that lies about what
//!    is in the repository.
//! 3. **Nothing is read from outside the worktree.** Every caller-supplied path
//!    goes through [`inside`], which refuses `..`, refuses an absolute path,
//!    and — the case the first two cannot see — refuses a symlink whose target
//!    resolves outside the checkout. Task 2 (search) will hand this module
//!    paths that came out of `git grep`, so the route from an arbitrary string
//!    to an arbitrary file read is closed before there is a caller for it.
//!
//! **Why git decides what is listed.** `.gitignore` is not a file, it is a
//! system: per-directory `.gitignore`s, `.git/info/exclude`, `core.excludesFile`
//! and the global excludesfile, with precedence and negation rules. git already
//! implements it, the Diff pane already asks git the same question
//! (`vingilot_worktree/diff.rs` lists untracked files with the same two flags),
//! and Task 2's `git grep` will answer from the same rules. A matcher written
//! here would be a second opinion about the owner's repository — the last thing
//! this app should have — and would be subtly wrong on exactly the one repo
//! that mattered.

pub mod read;
pub mod tree;

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::vingilot_worktree::git;

// No re-exports here. `lib.rs` names each command by its own module
// (`vingilot_files::tree::worktree_tree`), which is how `vingilot_worktree`
// registers its later commands too — a facade that only forwarded would be a
// second name for each command and one more thing to keep in step.

/// Why a read did not happen. Every variant names the thing in the way, because
/// his next action differs for each: open it in the terminal, accept that it is
/// not text, fix a permission, or pick a path inside the worktree.
///
/// Serialised as `{ "kind": "…", … }` for
/// `features/runs/lib/filesModel.ts`, which owns the copy — the same split
/// `WorktreeError` uses, so the words a refusal is shown in are tested without a
/// filesystem and the reasons are tested without a browser.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum FilesError {
    /// No git on this machine that answers `--version`.
    GitMissing,
    /// The worktree's own path is not a repository (any more).
    NotARepo { path: String },
    /// The path leaves the worktree. Either it said so (`..`, or an absolute
    /// path), or it resolved out through a symlink — which is the case the
    /// first two cannot see, and the reason this check canonicalises rather
    /// than only inspecting components.
    OutsidePath { path: String },
    /// Nothing is at that path in this worktree.
    NotFound { path: String },
    /// The file is past the cap. `size` is its real size, because "too large"
    /// without a number is a sentence he can do nothing with; with it, he knows
    /// whether to reach for `less` or for `head`.
    TooLarge { path: String, size: u64, cap: u64 },
    /// A NUL byte inside the first `SNIFF_BYTES`. A heuristic — the same one
    /// `git diff` uses — so the sentence says *looks* binary, which is the
    /// claim the check supports.
    Binary { path: String },
    /// The filesystem refused, and this module has no better name for why.
    /// `detail` is the OS's own words, which are usually the right ones.
    Unreadable { path: String, detail: String },
    /// git ran and refused. `stderr` is git's own words.
    GitFailed { command: String, stderr: String },
}

/// Turn a caller-supplied relative path into an absolute one that is provably
/// inside `worktree`.
///
/// **Two checks, and the second is the one that matters.** Rejecting `..` and
/// absolute paths is cheap and catches a mistake. It does not catch a symlink:
/// a checked-in `link -> /Users/him/.ssh` has no `..` anywhere in the path that
/// names it, and reading through it would hand the webview a private key. So
/// the resolved path is compared against the resolved worktree, which is also
/// what makes this correct on macOS, where a `/var/...` path and the
/// `/private/var/...` it is a symlink to are the same directory under two
/// names.
///
/// `""` is the worktree itself, which is what the tree's root listing asks for.
pub(crate) fn inside(worktree: &str, relative: &str) -> Result<PathBuf, FilesError> {
    let named = Path::new(relative);
    let outside = || FilesError::OutsidePath {
        path: relative.to_string(),
    };
    if named.is_absolute() {
        return Err(outside());
    }
    for part in named.components() {
        match part {
            std::path::Component::Normal(_) | std::path::Component::CurDir => {}
            // ParentDir, RootDir and a Windows prefix all mean the same thing
            // here: this path is trying to name somewhere else.
            _ => return Err(outside()),
        }
    }

    let root = std::fs::canonicalize(worktree).map_err(|error| FilesError::Unreadable {
        detail: error.to_string(),
        path: worktree.to_string(),
    })?;
    let joined = root.join(named);
    let resolved = std::fs::canonicalize(&joined).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            FilesError::NotFound {
                path: relative.to_string(),
            }
        } else {
            FilesError::Unreadable {
                detail: error.to_string(),
                path: relative.to_string(),
            }
        }
    })?;
    if !resolved.starts_with(&root) {
        return Err(outside());
    }
    Ok(resolved)
}

/// Whether this directory is a git repository at all. The same probe
/// `vingilot_worktree` makes, and it is here so that "this is not a checkout"
/// is a sentence rather than an empty listing — an empty read is "no answer",
/// never "nothing there".
pub(crate) fn ensure_repo(worktree: &str) -> Result<(), FilesError> {
    let ran = run(worktree, &["rev-parse", "--git-dir"])?;
    if ran.ok {
        return Ok(());
    }
    Err(FilesError::NotARepo {
        path: worktree.to_string(),
    })
}

/// Stderr kept from any one git command. git's diagnostics are a line or two;
/// this is only here so a command that decides to narrate cannot cost memory.
const MAX_STDERR_BYTES: usize = 8 * 1024;

pub(crate) struct Ran {
    pub ok: bool,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

pub(crate) fn describe(args: &[&str]) -> String {
    format!("git {}", args.join(" "))
}

/// Run git with `-C <cwd>`, capturing stdout as bytes.
///
/// **Bytes, not a `String`.** `ls-files -z` prints paths, and a path is not
/// required to be UTF-8 on any platform this ships to. Decoding here would turn
/// one undecodable filename into a listing that is wrong about every entry after
/// it; the split on NUL happens on the bytes and each name is decoded on its
/// own, so a filename this app cannot render costs that one row.
///
/// `GIT_TERMINAL_PROMPT=0` and a closed stdin because a desktop app has no
/// terminal to answer a credential prompt on — without them a repository with an
/// authenticating remote could hang this call forever with nothing on screen to
/// explain it.
pub(crate) fn run(cwd: &str, args: &[&str]) -> Result<Ran, FilesError> {
    let git = git().ok_or(FilesError::GitMissing)?;
    let output = std::process::Command::new(git)
        .arg("-C")
        .arg(cwd)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|error| FilesError::GitFailed {
            command: describe(args),
            stderr: error.to_string(),
        })?;
    let mut stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    stderr.truncate(MAX_STDERR_BYTES);
    Ok(Ran {
        ok: output.status.success(),
        stderr,
        stdout: output.stdout,
    })
}

/// Run one of this module's reads off the thread the webview talks on.
///
/// **Both commands are `async` for this one reason**, the same one
/// `vingilot_worktree::off_thread` documents: a `#[tauri::command]` declared
/// `fn` is generated with `ExecutionContext::Blocking` (tauri-macros 2.6.3,
/// `command/wrapper.rs`), which inlines the call into the IPC scheme handler —
/// on macOS/WKWebView, the main thread. A `git ls-files` over a monorepo index
/// there is a stall in the terminal beside the pane, and the terminal staying
/// responsive is the product.
pub(crate) async fn off_thread<T, F>(command: &str, work: F) -> Result<T, FilesError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, FilesError> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(work).await {
        Ok(answer) => answer,
        Err(error) => Err(FilesError::GitFailed {
            command: command.to_string(),
            stderr: error.to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::vingilot_worktree::testrepo::Repo;

    #[test]
    fn the_worktree_itself_is_inside_it() {
        let repo = Repo::new();
        let root = inside(&repo.path(), "").expect("the root resolves");
        assert_eq!(root, std::fs::canonicalize(repo.path()).unwrap());
    }

    #[test]
    fn a_file_in_the_worktree_resolves() {
        let repo = Repo::new();
        let found = inside(&repo.path(), "README.md").expect("README.md resolves");
        assert!(found.ends_with("README.md"));
    }

    #[test]
    fn a_parent_component_is_outside() {
        let repo = Repo::new();
        assert_eq!(
            inside(&repo.path(), "../secrets.txt"),
            Err(FilesError::OutsidePath {
                path: "../secrets.txt".to_string(),
            })
        );
        // And one that only reaches out in the middle of the path, which is the
        // shape a naive prefix check on the *string* would let through.
        assert_eq!(
            inside(&repo.path(), "src/../../secrets.txt"),
            Err(FilesError::OutsidePath {
                path: "src/../../secrets.txt".to_string(),
            })
        );
    }

    #[test]
    fn an_absolute_path_is_outside() {
        let repo = Repo::new();
        assert_eq!(
            inside(&repo.path(), "/etc/passwd"),
            Err(FilesError::OutsidePath {
                path: "/etc/passwd".to_string(),
            })
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_pointing_out_of_the_worktree_is_outside() {
        // The case the two checks above cannot see, and the reason `inside`
        // canonicalises: nothing about the string "escape" says it leaves the
        // checkout. Before the resolved-prefix check, this read whatever the
        // link pointed at.
        let repo = Repo::new();
        let elsewhere = crate::vingilot_worktree::testrepo::temp_dir();
        let secret = elsewhere.path().join("id_rsa");
        std::fs::write(&secret, "PRIVATE KEY\n").expect("the target is written");
        let link = std::path::Path::new(&repo.path()).join("escape");
        std::os::unix::fs::symlink(&secret, &link).expect("the symlink is made");

        assert_eq!(
            inside(&repo.path(), "escape"),
            Err(FilesError::OutsidePath {
                path: "escape".to_string(),
            })
        );
    }

    #[test]
    fn a_path_that_is_not_there_is_not_found() {
        let repo = Repo::new();
        assert_eq!(
            inside(&repo.path(), "nowhere.txt"),
            Err(FilesError::NotFound {
                path: "nowhere.txt".to_string(),
            })
        );
    }

    #[test]
    fn a_directory_that_is_not_a_repo_says_so() {
        let dir = crate::vingilot_worktree::testrepo::temp_dir();
        let path = dir.path().to_string_lossy().into_owned();
        assert_eq!(
            ensure_repo(&path),
            Err(FilesError::NotARepo { path: path.clone() })
        );
    }
}
