//! `vingilot-executor` CLI: `worker --workspace <id>` polls a workspace for
//! `ready` delegated Runs and executes them one at a time (plan §Task 3);
//! `execute --run <id>` runs a single already-identified Run once, for
//! scripting/debugging.

use std::time::Duration;

use uuid::Uuid;
use vingilot_executor::client::Client;
use vingilot_executor::{select_claim, ExecutorConfig};

/// How often the worker loop polls the workspace's run list for a new
/// claimable run.
const POLL_INTERVAL: Duration = Duration::from_secs(3);

#[derive(Debug, thiserror::Error)]
enum MainError {
    #[error("COORD_AUTH_TOKEN must be set")]
    MissingAuthToken,
    #[error("VINGILOT_WORKTREE_ROOT must be set")]
    MissingWorktreeRoot,
    #[error("VINGILOT_REPOS: {0}")]
    BadRepoMap(String),
    #[error("{0}")]
    Usage(String),
}

fn config_from_env() -> Result<ExecutorConfig, MainError> {
    let coord_base =
        std::env::var("COORD_BASE").unwrap_or_else(|_| "http://127.0.0.1:7117".to_string());
    let auth_token = std::env::var("COORD_AUTH_TOKEN").map_err(|_| MainError::MissingAuthToken)?;
    let repo_map =
        vingilot_executor::parse_repo_map(&std::env::var("VINGILOT_REPOS").unwrap_or_default())
            .map_err(MainError::BadRepoMap)?;
    let worktree_root = std::env::var("VINGILOT_WORKTREE_ROOT")
        .map_err(|_| MainError::MissingWorktreeRoot)?
        .into();
    let command_template = match std::env::var("VINGILOT_CMD") {
        Ok(cmd) => vec!["sh".to_string(), "-c".to_string(), cmd],
        Err(_) => vec![
            "sh".to_string(),
            "-c".to_string(),
            "echo executing: {objective}".to_string(),
        ],
    };
    Ok(ExecutorConfig {
        coord_base,
        auth_token,
        repo_map,
        worktree_root,
        command_template,
    })
}

/// Parses `--flag value` pairs from `args` into a lookup by flag name
/// (without the leading `--`).
fn parse_flags(args: &[String]) -> std::collections::HashMap<String, String> {
    let mut flags = std::collections::HashMap::new();
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        if let Some(name) = arg.strip_prefix("--") {
            if let Some(value) = it.next() {
                flags.insert(name.to_string(), value.clone());
            }
        }
    }
    flags
}

async fn run_worker(args: &[String]) -> Result<(), MainError> {
    let flags = parse_flags(args);
    let workspace_id: Uuid = flags
        .get("workspace")
        .ok_or_else(|| MainError::Usage("worker requires --workspace <id>".to_string()))?
        .parse()
        .map_err(|e| MainError::Usage(format!("--workspace: {e}")))?;

    let cfg = config_from_env()?;
    let client = Client::new(cfg.coord_base.clone(), cfg.auth_token.clone());

    tracing::info!("worker polling workspace {workspace_id} every {POLL_INTERVAL:?}");
    loop {
        match client.list_workspace_runs(workspace_id).await {
            Ok(runs) => {
                if let Some(run_id) = select_claim(&runs) {
                    tracing::info!("claiming run {run_id}");
                    match vingilot_executor::execute_run(&cfg, run_id).await {
                        Ok(outcome) => tracing::info!("run {run_id} finished: {outcome:?}"),
                        Err(e) => tracing::warn!("run {run_id} did not complete: {e}"),
                    }
                }
            }
            Err(e) => tracing::warn!("failed to list runs for workspace {workspace_id}: {e}"),
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

async fn run_execute(args: &[String]) -> Result<(), MainError> {
    let flags = parse_flags(args);
    let run_id: Uuid = flags
        .get("run")
        .ok_or_else(|| MainError::Usage("execute requires --run <id>".to_string()))?
        .parse()
        .map_err(|e| MainError::Usage(format!("--run: {e}")))?;

    let cfg = config_from_env()?;
    match vingilot_executor::execute_run(&cfg, run_id).await {
        Ok(outcome) => {
            tracing::info!("run {run_id} finished: {outcome:?}");
            Ok(())
        }
        Err(e) => {
            tracing::warn!("run {run_id} did not complete: {e}");
            Ok(())
        }
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let args: Vec<String> = std::env::args().collect();
    let result = match args.get(1).map(String::as_str) {
        Some("worker") => run_worker(&args[2..]).await,
        Some("execute") => run_execute(&args[2..]).await,
        _ => Err(MainError::Usage(
            "usage: vingilot-executor <worker --workspace <id> | execute --run <id>>".to_string(),
        )),
    };

    if let Err(e) = result {
        eprintln!("{e}");
        std::process::exit(2);
    }
}
