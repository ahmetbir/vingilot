//! The refs a diff can be read against — branches, local and remote, and
//! which one is HEAD (2026-09-04, the owner: "branch comparison filan da
//! yapabilelim ... main ile worktree difi vs. configurable bisi istiyom").
//!
//! One read, three questions git already answers: `for-each-ref` for the
//! branches, `symbolic-ref HEAD` for the one checked out, and
//! `symbolic-ref refs/remotes/origin/HEAD` for what the remote calls its
//! default. Nothing is written, and nothing is guessed: a repository with no
//! `origin/HEAD` answers `default: null` and the picker shows no "main" row it
//! cannot back.
//!
//! The diff itself needs no new command. `git diff <base> --` already takes
//! any revision expression, including `main...HEAD` — the merge-base form
//! that is "what this branch changed since it left main". The picker only
//! composes what this module lists.

use serde::Serialize;

use super::{run, WorktreeError};

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRefs {
    /// The branch checked out, or `None` when detached.
    pub head: Option<String>,
    /// The remote's default branch, short (`main`), or `None` when the
    /// remote has not said.
    pub default_branch: Option<String>,
    pub local: Vec<String>,
    /// `origin/main`, `origin/feature` — as git names them.
    pub remote: Vec<String>,
}

fn lines(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect()
}

/// `origin/HEAD` itself is a pointer, not a branch to compare against.
fn without_remote_heads(refs: Vec<String>) -> Vec<String> {
    refs.into_iter().filter(|r| !r.ends_with("/HEAD")).collect()
}

/// `origin/main` → `main`.
fn short_default(symbolic: &str) -> Option<String> {
    let s = symbolic.trim();
    if s.is_empty() {
        return None;
    }
    Some(s.split_once('/').map_or(s, |(_, rest)| rest).to_string())
}

fn refs(worktree: &str) -> Result<WorktreeRefs, WorktreeError> {
    let local_args = ["for-each-ref", "--format=%(refname:short)", "refs/heads/"];
    let local = run(worktree, &local_args)?;
    if !local.ok {
        return Err(WorktreeError::GitFailed {
            command: "git for-each-ref refs/heads/".to_string(),
            stderr: local.stderr,
        });
    }
    let remote_args = ["for-each-ref", "--format=%(refname:short)", "refs/remotes/"];
    let remote = run(worktree, &remote_args)?;
    if !remote.ok {
        return Err(WorktreeError::GitFailed {
            command: "git for-each-ref refs/remotes/".to_string(),
            stderr: remote.stderr,
        });
    }
    // Both symbolic-ref probes fail honestly — detached, or no origin/HEAD —
    // and a failure there is an answer, not an error.
    let head = run(worktree, &["symbolic-ref", "--short", "-q", "HEAD"])?;
    let default = run(
        worktree,
        &["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"],
    )?;
    Ok(WorktreeRefs {
        head: if head.ok {
            lines(&head.stdout).into_iter().next()
        } else {
            None
        },
        default_branch: if default.ok {
            short_default(&default.stdout)
        } else {
            None
        },
        local: lines(&local.stdout),
        remote: without_remote_heads(lines(&remote.stdout)),
    })
}

/// Every ref a diff in this worktree can be read against.
#[tauri::command]
pub async fn worktree_refs(path: String) -> Result<WorktreeRefs, WorktreeError> {
    super::off_thread("worktree refs", move || refs(&path)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_head_is_a_pointer_and_is_not_offered() {
        assert_eq!(
            without_remote_heads(vec![
                "origin/HEAD".to_string(),
                "origin/main".to_string(),
                "origin/feat".to_string()
            ]),
            vec!["origin/main".to_string(), "origin/feat".to_string()]
        );
    }

    #[test]
    fn the_default_branch_loses_its_remote() {
        assert_eq!(short_default("origin/main\n"), Some("main".to_string()));
        assert_eq!(short_default("upstream/trunk"), Some("trunk".to_string()));
        assert_eq!(short_default(""), None);
    }

    #[test]
    fn blank_lines_are_not_branches() {
        assert_eq!(lines("main\n\nfeat \n"), vec!["main", "feat"]);
    }
}
