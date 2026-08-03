//! `execute_run` — the executor's first incarnation of the broker (ADR-003):
//! claims a `ready` delegated Run over the coordinator's HTTP API, provisions
//! a real git worktree, runs the Run's command under lease/fencing
//! discipline, streams evidence, and drives the Run to `completed`/`failed`
//! honestly.
//!
//! Every side-effecting step on the claimed worktree binding is preceded by
//! a `validate-op` fencing check (ADR-003 §Fencing) — a denial (stale epoch,
//! expired lease, wrong run, ...) aborts the run immediately, recording the
//! denial as evidence, and never lets the Run reach `completed`.

pub mod client;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::Command;
use uuid::Uuid;

use client::{Client, ClientError, RunSummary};

/// Lease TTL the executor requests on the worktree binding it claims.
const LEASE_TTL_SECS: i64 = 90;
/// How often the lease is renewed while the command runs — comfortably
/// inside `LEASE_TTL_SECS` so a renewal delay never lets the lease lapse.
const LEASE_RENEW_INTERVAL: Duration = Duration::from_secs(30);
/// Evidence rows carrying command stdout/stderr are chunked at this size
/// (the coordinator's own per-row cap is 64 KiB; this is a much smaller
/// chunk so evidence streams as the command runs, not only at the end).
const EVIDENCE_CHUNK_BYTES: usize = 8 * 1024;

/// Everything `execute_run` needs to claim and run one Run.
pub struct ExecutorConfig {
    /// The coordinator's base URL, e.g. `http://127.0.0.1:7117`.
    pub coord_base: String,
    pub auth_token: String,
    /// `repo_id` -> local clone path. The executor never clones a repo
    /// itself; every `repo_id` a Run's write-granted binding names must
    /// already be a key here.
    pub repo_map: HashMap<String, PathBuf>,
    /// Directory under which each Run's worktree is created, at
    /// `<worktree_root>/<run_id>`.
    pub worktree_root: PathBuf,
    /// argv template; every arg containing the literal `{objective}` has it
    /// substituted with the Run's objective string.
    pub command_template: Vec<String>,
}

/// How a claimed Run's command finished. `Failed` is not an error — it is
/// the honest, successfully-observed result of a nonzero exit (plan
/// §Global Constraints: "a nonzero exit is a `failed` Run ... never a
/// retry-until-green").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Completed,
    Failed { exit_code: i32 },
}

/// Everything that can stop `execute_run` from reaching an `Outcome` at
/// all — as opposed to `Outcome::Failed`, which is the command's own
/// (successfully observed) nonzero exit.
#[derive(Debug, thiserror::Error)]
pub enum ExecError {
    #[error(transparent)]
    Client(#[from] ClientError),
    #[error("run {run_id} is not eligible to execute: {reason}")]
    NotEligible { run_id: Uuid, reason: String },
    #[error("fencing denied {step}: {detail}")]
    Fenced { step: String, detail: String },
    #[error("repo_id {0:?} is not in the executor's repo_map")]
    UnknownRepo(String),
    #[error("git worktree add failed: {0}")]
    Git(String),
    #[error("command argv is empty")]
    EmptyCommand,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// The first 8 characters of a Run id's hyphenated string form — the
/// `run/<id8>` branch-naming contract (plan §Contracts fixed here).
fn short_id(run_id: Uuid) -> String {
    run_id.to_string()[..8].to_string()
}

fn substitute_objective(template: &[String], objective: &str) -> Vec<String> {
    template
        .iter()
        .map(|arg| arg.replace("{objective}", objective))
        .collect()
}

/// The per-operation fencing check (ADR-003 §Fencing): on denial, appends
/// an `error` evidence row naming the step that was denied and returns
/// `ExecError::Fenced` — the caller never proceeds to the side effect.
async fn fence(
    client: &Client,
    binding_id: Uuid,
    run_id: Uuid,
    epoch: i64,
    step: &str,
) -> Result<(), ExecError> {
    if let Err(e) = client.validate_op(binding_id, run_id, epoch).await {
        let _ = client
            .append_evidence(
                run_id,
                "error",
                &format!("validate-op denied before {step}: {e}"),
            )
            .await;
        return Err(ExecError::Fenced {
            step: step.to_string(),
            detail: e.to_string(),
        });
    }
    Ok(())
}

/// `git -C <repo_path> worktree add <worktree_path> -b <branch>`, run to
/// completion. Returns the combined stdout+stderr and whether it succeeded
/// — never panics on a nonzero exit, the caller decides what that means.
async fn run_git_worktree_add(
    repo_path: &Path,
    worktree_path: &Path,
    branch: &str,
) -> Result<(String, bool), std::io::Error> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("add")
        .arg(worktree_path)
        .arg("-b")
        .arg(branch)
        .output()
        .await?;

    let mut combined = String::from_utf8_lossy(&output.stdout).into_owned();
    combined.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok((combined, output.status.success()))
}

/// Reads `reader` to EOF in `EVIDENCE_CHUNK_BYTES` chunks, appending each
/// non-empty chunk as an evidence row of `kind`. Runs until EOF or a read
/// error; a failed evidence append is logged and skipped rather than
/// aborting the stream (the command itself is still running and must not be
/// killed by a coordinator hiccup).
async fn stream_to_evidence<R: tokio::io::AsyncRead + Unpin>(
    mut reader: R,
    client: &Client,
    run_id: Uuid,
    kind: &str,
) {
    let mut buf = vec![0u8; EVIDENCE_CHUNK_BYTES];
    loop {
        let n = match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                tracing::warn!("run {run_id}: {kind} stream read error: {e}");
                break;
            }
        };
        let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
        if let Err(e) = client.append_evidence(run_id, kind, &chunk).await {
            tracing::warn!("run {run_id}: failed to append {kind} evidence: {e}");
        }
    }
}

/// Renews the lease on `binding_id` at `epoch` every `LEASE_RENEW_INTERVAL`,
/// forever — the caller aborts this task once the command it is guarding
/// has exited. A renewal failure (e.g. the lease already lapsed) is logged,
/// not retried early; the next tick tries again.
async fn renewal_loop(client: Client, binding_id: Uuid, epoch: i64) {
    loop {
        tokio::time::sleep(LEASE_RENEW_INTERVAL).await;
        if let Err(e) = client.renew_lease(binding_id, epoch, LEASE_TTL_SECS).await {
            tracing::warn!("run binding {binding_id}: lease renew failed: {e}");
        }
    }
}

/// Claims `run_id` (must be `ready` + `delegated` + exactly one
/// write-granted binding), provisions a real worktree for it, runs
/// `cfg.command_template` inside that worktree, and drives the Run to
/// `completed` or `failed` honestly. See the module docs for the fencing
/// contract.
pub async fn execute_run(cfg: &ExecutorConfig, run_id: Uuid) -> Result<Outcome, ExecError> {
    let client = Client::new(cfg.coord_base.clone(), cfg.auth_token.clone());

    // 1. GET run detail; require ready + delegated + exactly one
    //    write-granted binding.
    let detail = client.get_run(run_id).await?;
    if detail.status != "ready" {
        return Err(ExecError::NotEligible {
            run_id,
            reason: format!("status is {:?}, not \"ready\"", detail.status),
        });
    }
    if detail.mode != "delegated" {
        return Err(ExecError::NotEligible {
            run_id,
            reason: format!("mode is {:?}, not \"delegated\"", detail.mode),
        });
    }
    let write_grants: Vec<_> = detail
        .grants
        .iter()
        .filter(|g| g.access == "write")
        .collect();
    if write_grants.len() != 1 {
        return Err(ExecError::NotEligible {
            run_id,
            reason: format!(
                "expected exactly one write-granted binding, found {}",
                write_grants.len()
            ),
        });
    }
    let binding_id = write_grants[0].binding_id;
    let repo_id = write_grants[0].repo_id.clone();
    let repo_path = cfg
        .repo_map
        .get(&repo_id)
        .cloned()
        .ok_or(ExecError::UnknownRepo(repo_id))?;

    // 2. Transition ready -> running.
    client
        .transition(run_id, "running", "executor claimed")
        .await?;

    // 3. Acquire a lease on the binding.
    let lease = client.acquire_lease(binding_id, LEASE_TTL_SECS).await?;
    let epoch = lease.epoch;

    // 4. git worktree add (fenced; evidence carries the exact command + output).
    fence(&client, binding_id, run_id, epoch, "git worktree add").await?;

    let branch = format!("run/{}", short_id(run_id));
    let worktree_path = cfg.worktree_root.join(run_id.to_string());
    tokio::fs::create_dir_all(&cfg.worktree_root).await?;

    let git_command_str = format!(
        "git -C {} worktree add {} -b {branch}",
        repo_path.display(),
        worktree_path.display()
    );
    client
        .append_evidence(run_id, "command", &git_command_str)
        .await?;

    let (git_output, git_ok) = run_git_worktree_add(&repo_path, &worktree_path, &branch).await?;
    client
        .append_evidence(run_id, if git_ok { "output" } else { "error" }, &git_output)
        .await?;
    if !git_ok {
        let _ = client
            .transition(run_id, "failed", "git worktree add failed")
            .await;
        let _ = client
            .append_evidence(run_id, "note", "outcome: failed (git worktree add failed)")
            .await;
        return Err(ExecError::Git(git_output));
    }

    // 5. Run the command (fenced; cwd = the worktree). Stream stdout/stderr
    //    as evidence, renewing the lease every LEASE_RENEW_INTERVAL while it
    //    runs.
    fence(&client, binding_id, run_id, epoch, "run command").await?;

    let argv = substitute_objective(&cfg.command_template, &detail.objective);
    let (program, args) = argv.split_first().ok_or(ExecError::EmptyCommand)?;

    client
        .append_evidence(run_id, "command", &argv.join(" "))
        .await?;

    let mut child = Command::new(program)
        .args(args)
        .current_dir(&worktree_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| std::io::Error::other("child has no captured stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| std::io::Error::other("child has no captured stderr"))?;

    let stdout_task = tokio::spawn({
        let client = client.clone();
        async move { stream_to_evidence(stdout, &client, run_id, "output").await }
    });
    let stderr_task = tokio::spawn({
        let client = client.clone();
        async move { stream_to_evidence(stderr, &client, run_id, "error").await }
    });
    let renewal_task = tokio::spawn({
        let client = client.clone();
        async move { renewal_loop(client, binding_id, epoch).await }
    });

    let status = child.wait().await?;
    let _ = stdout_task.await;
    let _ = stderr_task.await;
    renewal_task.abort();

    // 6. Exit 0 -> running -> verifying -> completed. Nonzero -> running ->
    //    failed. Either way, a `note` evidence row records the outcome.
    let exit_code = status.code().unwrap_or(-1);
    if exit_code == 0 {
        client
            .transition(run_id, "verifying", "command exit 0")
            .await?;
        client
            .transition(run_id, "completed", "executor v1 auto-verify")
            .await?;
        client
            .append_evidence(run_id, "note", "outcome: completed")
            .await?;
        Ok(Outcome::Completed)
    } else {
        client
            .transition(run_id, "failed", &format!("command exit {exit_code}"))
            .await?;
        client
            .append_evidence(
                run_id,
                "note",
                &format!("outcome: failed (command exit {exit_code})"),
            )
            .await?;
        Ok(Outcome::Failed { exit_code })
    }
}

/// The worker loop's claim rule (plan §Task 3: "claim the oldest ready
/// delegated run"): the id of the oldest-created run that is `ready` +
/// `delegated`, or `None` if there isn't one. Pure — no network — so the
/// selection policy is unit-testable without a coordinator.
pub fn select_claim(runs: &[RunSummary]) -> Option<Uuid> {
    runs.iter()
        .filter(|r| r.status == "ready" && r.mode == "delegated")
        .min_by_key(|r| r.created_at)
        .map(|r| r.id)
}

/// Parses `VINGILOT_REPOS`-shaped input (`"buzz=/path,test=/path"`) into a
/// `repo_map`. Empty segments are skipped; a segment without `=` or with an
/// empty id/path is an error naming the bad segment.
pub fn parse_repo_map(spec: &str) -> Result<HashMap<String, PathBuf>, String> {
    let mut map = HashMap::new();
    for segment in spec.split(',') {
        let segment = segment.trim();
        if segment.is_empty() {
            continue;
        }
        let (id, path) = segment
            .split_once('=')
            .ok_or_else(|| format!("repo entry {segment:?} is missing '='"))?;
        let (id, path) = (id.trim(), path.trim());
        if id.is_empty() || path.is_empty() {
            return Err(format!("repo entry {segment:?} has an empty id or path"));
        }
        map.insert(id.to_string(), PathBuf::from(path));
    }
    Ok(map)
}

#[cfg(test)]
mod claim_tests {
    use super::*;
    use chrono::{Duration, Utc};

    fn run(status: &str, mode: &str, age_secs: i64) -> RunSummary {
        RunSummary {
            id: Uuid::new_v4(),
            status: status.to_string(),
            mode: mode.to_string(),
            created_at: Utc::now() - Duration::seconds(age_secs),
        }
    }

    #[test]
    fn picks_oldest_ready_delegated() {
        let older = run("ready", "delegated", 100);
        let newer = run("ready", "delegated", 10);
        let runs = vec![newer.clone(), older.clone()];
        assert_eq!(select_claim(&runs), Some(older.id));
    }

    #[test]
    fn ignores_non_ready_and_non_delegated() {
        let running = run("running", "delegated", 200);
        let manual = run("ready", "manual", 200);
        let eligible = run("ready", "delegated", 5);
        let runs = vec![running, manual, eligible.clone()];
        assert_eq!(select_claim(&runs), Some(eligible.id));
    }

    #[test]
    fn none_when_nothing_eligible() {
        let runs = vec![run("running", "delegated", 5), run("ready", "manual", 5)];
        assert_eq!(select_claim(&runs), None);
    }

    #[test]
    fn none_on_empty_list() {
        let runs: Vec<RunSummary> = vec![];
        assert_eq!(select_claim(&runs), None);
    }
}

#[cfg(test)]
mod repo_map_tests {
    use super::*;

    #[test]
    fn parses_multiple_entries() {
        let map = parse_repo_map("buzz=/a/b,test=/c/d").unwrap();
        assert_eq!(map.get("buzz"), Some(&PathBuf::from("/a/b")));
        assert_eq!(map.get("test"), Some(&PathBuf::from("/c/d")));
    }

    #[test]
    fn trims_whitespace_and_skips_empty_segments() {
        let map = parse_repo_map(" buzz = /a/b , , test=/c/d ").unwrap();
        assert_eq!(map.len(), 2);
        assert_eq!(map.get("buzz"), Some(&PathBuf::from("/a/b")));
    }

    #[test]
    fn empty_spec_yields_empty_map() {
        assert!(parse_repo_map("").unwrap().is_empty());
    }

    #[test]
    fn missing_equals_is_an_error() {
        assert!(parse_repo_map("buzz-only").is_err());
    }

    #[test]
    fn empty_id_or_path_is_an_error() {
        assert!(parse_repo_map("=/a/b").is_err());
        assert!(parse_repo_map("buzz=").is_err());
    }
}
