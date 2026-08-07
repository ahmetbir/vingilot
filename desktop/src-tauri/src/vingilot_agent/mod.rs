//! An ACP agent working in one of the workspace's worktrees
//! (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 8).
//!
//! The worktree is the whole point. A run gets a checkout of its own, on a
//! branch of its own, so what an agent does is legible as a diff and does not
//! land on top of what the owner is doing three panes over. Nothing more is
//! claimed for it: **a worktree is a collision boundary, not a security
//! boundary** (ADR-003). The agent runs as this app's child, with this app's
//! environment and this app's credentials, and an approved tool can reach the
//! rest of the machine exactly as the owner's own shell can. No copy in this
//! feature — Rust, TypeScript, or docs — may call it isolated, sandboxed, or
//! contained, because it is none of those.
//!
//! **Why the agent is spawned rather than reached.** `crates/buzz-acp` already
//! drives ACP agents, and it drives them for the relay: an agent there is
//! mentioned in a channel, answers with the Buzz CLI, and works wherever it
//! was started. Here the question is the other one — *this* worktree, *this*
//! prompt, one turn, and the answer read back as a diff — so this module owns
//! the subprocess and speaks the protocol itself (`client.rs`). It reads
//! `BUZZ_ACP_AGENT_COMMAND` so a machine already set up for that harness needs
//! no second setting (`config.rs`).
//!
//! **What this module does not do.** It does not commit, does not push, does
//! not decide what the agent may touch, and does not read the result: what
//! changed in a worktree is `vingilot_worktree::diff`'s answer, from git,
//! the same answer the Diff tab shows for the owner's own edits. One source
//! of truth about a worktree's contents, not two that can disagree.

pub mod client;
pub mod config;
#[cfg(all(test, unix))]
mod live;
pub mod trace;

use std::path::{Path, PathBuf};

use client::{AcpAgent, AgentError, AgentTurn, Deadlines};
use config::Availability;

/// Whether there is an agent to run at all, without starting one.
///
/// Asked before a prompt is typed, so the panel can say "set
/// `VINGILOT_ACP_AGENT_COMMAND`" instead of letting the owner write a
/// paragraph and then failing to spawn.
#[tauri::command]
pub async fn agent_probe() -> Availability {
    // Off the webview's thread for the same reason every `vingilot_worktree`
    // command is (see `off_thread` there): this stats a handful of
    // directories, and a `#[tauri::command] fn` would do it on the thread
    // that also carries every keystroke to a terminal.
    match tauri::async_runtime::spawn_blocking(config::availability).await {
        Ok(availability) => availability,
        // A runtime that cannot run the probe cannot run the agent either,
        // and "not configured" is the honest reading of an answer we do not
        // have — it is the state that asks the owner to set something rather
        // than the one that claims an agent is ready.
        Err(_) => Availability::NotConfigured {
            variables: Vec::new(),
        },
    }
}

/// Run one turn in `cwd` and report what the agent said.
///
/// `cwd` is a worktree's own directory, resolved by the frontend the same way
/// the Diff tab resolves it. Nothing here verifies that it is a worktree: git
/// is the authority on that, and `worktree_diff` asks it.
#[tauri::command]
pub async fn agent_run(cwd: String, prompt: String) -> Result<AgentTurn, AgentError> {
    let deadlines = Deadlines::default();
    match tauri::async_runtime::spawn_blocking(move || run(Path::new(&cwd), &prompt, deadlines))
        .await
    {
        Ok(outcome) => outcome,
        Err(error) => Err(AgentError::Interrupted {
            message: error.to_string(),
        }),
    }
}

/// One turn, start to finish. Separate from the command so the live test
/// drives the code that ships rather than a copy of it.
pub fn run(cwd: &Path, prompt: &str, deadlines: Deadlines) -> Result<AgentTurn, AgentError> {
    if prompt.trim().is_empty() {
        return Err(AgentError::EmptyPrompt);
    }
    let command = match config::availability() {
        Availability::Ready { command, .. } => command,
        Availability::NotConfigured { variables } => {
            return Err(AgentError::NotConfigured { variables })
        }
        Availability::Missing { program } => return Err(AgentError::Missing { program }),
    };
    // One path, used for both the process and the protocol: an agent told one
    // directory in `session/new` and started in another has two answers to
    // "where am I", and the tools it runs believe the second one.
    let cwd = canonical(cwd);
    let mut agent = AcpAgent::spawn(&command, &cwd)?;
    agent.run_turn(&cwd, prompt, deadlines)
}

/// The directory as the filesystem names it. macOS answers `/tmp` and
/// `/private/tmp` for one directory, and an agent that reports its own `pwd`
/// would otherwise look like it was somewhere else.
fn canonical(cwd: &Path) -> PathBuf {
    cwd.canonicalize().unwrap_or_else(|_| cwd.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_prompt_with_nothing_in_it_never_reaches_an_agent() {
        // Before the spawn, deliberately: starting an adapter — which for the
        // hosted ones means a network login — to send it a blank turn is a
        // cost with no possible answer.
        let deadlines = Deadlines::default();
        assert_eq!(
            run(Path::new("/"), "   \n\t ", deadlines).err(),
            Some(AgentError::EmptyPrompt)
        );
    }
}
