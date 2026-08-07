//! A real git repository to test against.
//!
//! The thing under test in this island is git's behaviour at this app's
//! boundary — what `worktree remove` refuses, what `diff --numstat -z` prints
//! for a rename. A mocked git would prove only that these modules can call a
//! mock, so every test here drives the real binary against a `TempDir`.
//!
//! Global and system config are switched off for the setup commands, so the
//! owner's own git settings cannot change what the tests observe.
//!
//! Teardown is `TempDir`'s `Drop` and, where a test needs it, `git worktree
//! remove` itself. Nothing here removes a directory by hand.

use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

use tempfile::TempDir;

use super::git;

pub(crate) struct Repo {
    dir: TempDir,
}

pub(crate) fn temp_dir() -> TempDir {
    match TempDir::new() {
        Ok(dir) => dir,
        Err(error) => panic!("could not create a temp dir: {error}"),
    }
}

impl Repo {
    pub(crate) fn new() -> Self {
        let dir = temp_dir();
        let repo = Repo { dir };
        repo.git(&["init", "-b", "main"]);
        repo.git(&["config", "user.email", "test@vingilot.invalid"]);
        repo.git(&["config", "user.name", "Vingilot Test"]);
        repo.git(&["config", "commit.gpgsign", "false"]);
        repo.write("README.md", "one\n");
        repo.git(&["add", "README.md"]);
        repo.git(&["commit", "-m", "first"]);
        repo
    }

    pub(crate) fn path(&self) -> String {
        self.dir.path().to_string_lossy().into_owned()
    }

    pub(crate) fn write(&self, name: &str, contents: &str) {
        write_at(&self.dir.path().join(name), contents);
    }

    pub(crate) fn write_bytes(&self, name: &str, contents: &[u8]) {
        let path = self.dir.path().join(name);
        if let Err(error) = fs::write(&path, contents) {
            panic!("could not write {}: {error}", path.display());
        }
    }

    pub(crate) fn remove(&self, name: &str) {
        let path = self.dir.path().join(name);
        if let Err(error) = fs::remove_file(&path) {
            panic!("could not remove {}: {error}", path.display());
        }
    }

    pub(crate) fn git(&self, args: &[&str]) {
        let git = git().unwrap_or("git");
        let output = Command::new(git)
            .arg("-C")
            .arg(self.dir.path())
            .args(args)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .output();
        match output {
            Ok(done) if done.status.success() => {}
            Ok(done) => panic!(
                "git {} failed: {}",
                args.join(" "),
                String::from_utf8_lossy(&done.stderr)
            ),
            Err(error) => panic!("git {} did not run: {error}", args.join(" ")),
        }
    }
}

/// Run git in a directory that is not a `Repo` — a linked worktree, most of
/// all, which has its own working files and no `Repo` value behind it.
/// Answers whether git succeeded rather than panicking, so a caller can say
/// what it was trying to do when it did not.
pub(crate) fn git_at(dir: &str, args: &[&str]) -> bool {
    let git = git().unwrap_or("git");
    matches!(
        Command::new(git)
            .arg("-C")
            .arg(dir)
            .args(args)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .status(),
        Ok(status) if status.success()
    )
}

pub(crate) fn write_at(path: &Path, contents: &str) {
    if let Err(error) = fs::write(path, contents) {
        panic!("could not write {}: {error}", path.display());
    }
}

/// Somewhere to hang worktrees off, outside the repository — where the real
/// worktree root is, and the layout `git worktree add` is happiest with.
pub(crate) fn worktree_path(root: &TempDir, name: &str) -> String {
    root.path()
        .join("trees")
        .join(name)
        .to_string_lossy()
        .into_owned()
}
