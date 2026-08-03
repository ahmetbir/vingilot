//! THE e2e: drives `execute_run` through the whole claim -> worktree ->
//! command -> evidence -> completion loop over HTTP against an in-process
//! coordinator and a real (throwaway) git repository. Skips cleanly (never
//! silently passes) when `COORD_DATABASE_URL` is unset — see `common::test_pool`.

mod common;

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use common::test_pool;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;
use vingilot_executor::{execute_run, ExecError, ExecutorConfig, Outcome};

const AUTH_TOKEN: &str = "test-secret-token";

/// Spawns the coordinator's axum app in-process on an ephemeral port —
/// exactly what the plan's spine requires: the e2e drives the loop through
/// real HTTP, not by poking the DB (except for cleanup).
async fn spawn_coordinator(pool: PgPool) -> String {
    let app = vingilot_coordinator::http::router(pool, AUTH_TOKEN.to_string());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

fn key(label: &str) -> String {
    format!("{label}-{}", Uuid::new_v4())
}

// ---------------------------------------------------------------------
// Real git helpers — a throwaway repo with one commit, plus small readers
// used only to assert the worktree `execute_run` produced.
// ---------------------------------------------------------------------

fn run_git(dir: &Path, args: &[&str]) {
    let status = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?} failed in {dir:?}");
}

fn init_repo_with_one_commit(dir: &Path) {
    run_git(dir, &["init", "-q"]);
    run_git(dir, &["config", "user.email", "executor-test@example.com"]);
    run_git(dir, &["config", "user.name", "Executor Test"]);
    std::fs::write(dir.join("README.md"), "seed\n").unwrap();
    run_git(dir, &["add", "."]);
    run_git(dir, &["commit", "-q", "-m", "seed"]);
}

fn git_rev_parse_head(dir: &Path) -> String {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .arg("rev-parse")
        .arg("HEAD")
        .output()
        .unwrap();
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn current_branch(dir: &Path) -> String {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .output()
        .unwrap();
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

// ---------------------------------------------------------------------
// HTTP setup helpers — every Run this suite exercises is created,
// provisioned, and read back purely through the coordinator's public API.
// ---------------------------------------------------------------------

async fn create_workspace(base_url: &str, http: &reqwest::Client) -> Uuid {
    let workspace_id = Uuid::new_v4();
    let resp = http
        .post(format!("{base_url}/v1/workspaces/{workspace_id}/mutations"))
        .bearer_auth(AUTH_TOKEN)
        .json(&json!({ "expected_revision": 0, "mutations": [] }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    workspace_id
}

async fn create_delegated_run(
    base_url: &str,
    http: &reqwest::Client,
    workspace_id: Uuid,
    objective: &str,
) -> Uuid {
    let resp = http
        .post(format!("{base_url}/v1/runs"))
        .bearer_auth(AUTH_TOKEN)
        .json(&json!({
            "workspace_id": workspace_id,
            "parent_run_id": null,
            "objective": objective,
            "mode": "delegated",
            "wall_limit_secs": null,
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 201);
    let body: Value = resp.json().await.unwrap();
    Uuid::parse_str(body["run_id"].as_str().unwrap()).unwrap()
}

async fn get_run(base_url: &str, http: &reqwest::Client, run_id: Uuid) -> Value {
    let resp = http
        .get(format!("{base_url}/v1/runs/{run_id}"))
        .bearer_auth(AUTH_TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    resp.json().await.unwrap()
}

async fn list_evidence(base_url: &str, http: &reqwest::Client, run_id: Uuid) -> Vec<Value> {
    let resp = http
        .get(format!("{base_url}/v1/runs/{run_id}/evidence"))
        .bearer_auth(AUTH_TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    body["evidence"].as_array().unwrap().clone()
}

/// Provisions one write-granted worktree binding on `run_id` and returns its
/// binding id (read back via `GET /v1/runs/{id}` — the provision endpoint
/// itself only answers 200, it does not echo the binding id).
async fn provision_write_binding(
    base_url: &str,
    http: &reqwest::Client,
    run_id: Uuid,
    repo_id: &str,
    base_commit: &str,
    idempotency_key: &str,
) -> Uuid {
    let resp = http
        .post(format!("{base_url}/v1/runs/{run_id}/provision"))
        .bearer_auth(AUTH_TOKEN)
        .json(&json!({
            "worktrees": [{
                "repo_id": repo_id,
                "target_id": "primary",
                "role": "primary",
                "base_commit": base_commit,
                "branch": null,
                "access": "write",
                "idempotency_key": idempotency_key,
            }]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let run = get_run(base_url, http, run_id).await;
    let grants = run["grants"].as_array().unwrap();
    assert_eq!(
        grants.len(),
        1,
        "expected exactly one grant after provision"
    );
    Uuid::parse_str(grants[0]["binding_id"].as_str().unwrap()).unwrap()
}

/// Full setup shared by all three tests: workspace, delegated run, one
/// write-granted binding against `repo_id`.
async fn setup_delegated_run(
    base_url: &str,
    http: &reqwest::Client,
    repo_id: &str,
    base_commit: &str,
    objective: &str,
    key_label: &str,
) -> (Uuid, Uuid, Uuid) {
    let workspace_id = create_workspace(base_url, http).await;
    let run_id = create_delegated_run(base_url, http, workspace_id, objective).await;
    let binding_id = provision_write_binding(
        base_url,
        http,
        run_id,
        repo_id,
        base_commit,
        &key(key_label),
    )
    .await;
    (workspace_id, run_id, binding_id)
}

/// The coordinator DB is a shared, persistent dev instance — every test
/// removes exactly what it created (mirrors the coordinator crate's own
/// test cleanup idiom).
async fn cleanup(pool: &PgPool, workspace_id: Uuid) {
    let _ = sqlx::query(
        "DELETE FROM run_evidence WHERE run_id IN \
         (SELECT id FROM runs WHERE workspace_id = $1)",
    )
    .bind(workspace_id)
    .execute(pool)
    .await;
    let _ = sqlx::query(
        "DELETE FROM run_worktree_grants WHERE run_id IN \
         (SELECT id FROM runs WHERE workspace_id = $1)",
    )
    .bind(workspace_id)
    .execute(pool)
    .await;
    let _ = sqlx::query(
        "DELETE FROM worktree_bindings WHERE owner_run_id IN \
         (SELECT id FROM runs WHERE workspace_id = $1)",
    )
    .bind(workspace_id)
    .execute(pool)
    .await;
    let _ = sqlx::query(
        "DELETE FROM run_transitions WHERE run_id IN \
         (SELECT id FROM runs WHERE workspace_id = $1)",
    )
    .bind(workspace_id)
    .execute(pool)
    .await;
    let _ = sqlx::query("DELETE FROM runs WHERE workspace_id = $1")
        .bind(workspace_id)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM workspace_events WHERE workspace_id = $1")
        .bind(workspace_id)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM workspaces WHERE id = $1")
        .bind(workspace_id)
        .execute(pool)
        .await;
}

// ---------------------------------------------------------------------
// Test 1 — the spine: real HTTP, real worktree, real evidence.
// ---------------------------------------------------------------------

#[tokio::test]
async fn full_loop_completes_a_delegated_run_with_a_real_worktree() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let base_url = spawn_coordinator(pool.clone()).await;
    let http = reqwest::Client::new();

    let repo_dir = tempfile::tempdir().unwrap();
    init_repo_with_one_commit(repo_dir.path());
    let base_commit = git_rev_parse_head(repo_dir.path());
    let worktree_root = tempfile::tempdir().unwrap();

    let (workspace_id, run_id, _binding_id) = setup_delegated_run(
        &base_url,
        &http,
        "test",
        &base_commit,
        "touch PROOF.txt",
        "full-loop",
    )
    .await;

    let mut repo_map = HashMap::new();
    repo_map.insert("test".to_string(), repo_dir.path().to_path_buf());

    let cfg = ExecutorConfig {
        coord_base: base_url.clone(),
        auth_token: AUTH_TOKEN.to_string(),
        repo_map,
        worktree_root: worktree_root.path().to_path_buf(),
        command_template: vec![
            "sh".to_string(),
            "-c".to_string(),
            "touch PROOF.txt && echo made-proof".to_string(),
        ],
    };

    let outcome = execute_run(&cfg, run_id).await.unwrap();
    assert_eq!(outcome, Outcome::Completed);

    // Run status completed, via the API.
    let run = get_run(&base_url, &http, run_id).await;
    assert_eq!(run["status"], json!("completed"));

    // Transitions contain "executor claimed" and "command exit 0".
    let transitions = run["transitions"].as_array().unwrap();
    let reasons: Vec<&str> = transitions
        .iter()
        .map(|t| t["reason"].as_str().unwrap())
        .collect();
    assert!(
        reasons.contains(&"executor claimed"),
        "transitions were: {reasons:?}"
    );
    assert!(
        reasons.iter().any(|r| r.contains("command exit 0")),
        "transitions were: {reasons:?}"
    );

    // The worktree directory exists, is on branch run/<id8>, and contains
    // PROOF.txt — asserted against the real filesystem, not the DB.
    let id8 = &run_id.to_string()[..8];
    let worktree_path = worktree_root.path().join(run_id.to_string());
    assert!(
        worktree_path.is_dir(),
        "worktree dir missing: {worktree_path:?}"
    );
    assert!(
        worktree_path.join("PROOF.txt").is_file(),
        "PROOF.txt missing in worktree"
    );
    assert_eq!(current_branch(&worktree_path), format!("run/{id8}"));

    // Evidence rows include the git worktree add command, the made-proof
    // output, and the outcome note, in seq order.
    let evidence = list_evidence(&base_url, &http, run_id).await;
    let seqs: Vec<i64> = evidence
        .iter()
        .map(|e| e["seq"].as_i64().unwrap())
        .collect();
    let mut sorted_seqs = seqs.clone();
    sorted_seqs.sort_unstable();
    assert_eq!(seqs, sorted_seqs, "evidence rows were not in seq order");

    let contents: Vec<&str> = evidence
        .iter()
        .map(|e| e["content"].as_str().unwrap())
        .collect();
    assert!(
        contents
            .iter()
            .any(|c| c.contains("git") && c.contains("worktree add")),
        "no git worktree add command evidence: {contents:?}"
    );
    assert!(
        contents.iter().any(|c| c.contains("made-proof")),
        "no made-proof output evidence: {contents:?}"
    );
    assert!(
        contents.iter().any(|c| c.contains("outcome: completed")),
        "no outcome note evidence: {contents:?}"
    );

    cleanup(&pool, workspace_id).await;
}

// ---------------------------------------------------------------------
// Test 2 — fencing bites: an out-of-band epoch bump denies execute_run.
// ---------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fencing_bites_when_epoch_is_bumped_out_of_band() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let base_url = spawn_coordinator(pool.clone()).await;
    let http = reqwest::Client::new();

    let repo_dir = tempfile::tempdir().unwrap();
    init_repo_with_one_commit(repo_dir.path());
    let base_commit = git_rev_parse_head(repo_dir.path());
    let worktree_root = tempfile::tempdir().unwrap();

    let (workspace_id, run_id, binding_id) = setup_delegated_run(
        &base_url,
        &http,
        "test",
        &base_commit,
        "should be fenced",
        "fencing",
    )
    .await;

    let mut repo_map = HashMap::new();
    repo_map.insert("test".to_string(), repo_dir.path().to_path_buf());

    let cfg = ExecutorConfig {
        coord_base: base_url.clone(),
        auth_token: AUTH_TOKEN.to_string(),
        repo_map,
        worktree_root: worktree_root.path().to_path_buf(),
        command_template: vec![
            "sh".to_string(),
            "-c".to_string(),
            "touch PROOF.txt".to_string(),
        ],
    };

    let exec_task = tokio::spawn(async move { execute_run(&cfg, run_id).await });

    // Hammer an out-of-band lease acquisition on the same binding across
    // execute_run's entire concurrent lifetime. `acquire_lease` always
    // bumps the binding's epoch regardless of who calls it, so at least one
    // of these acquisitions is guaranteed to land strictly after
    // execute_run's own step-3 acquire — which makes the epoch it captured
    // stale for its very next validate-op call (ADR-003 §Fencing).
    for _ in 0..300 {
        let _ = http
            .post(format!("{base_url}/v1/bindings/{binding_id}/lease"))
            .bearer_auth(AUTH_TOKEN)
            .json(&json!({ "ttl_secs": 60 }))
            .send()
            .await;
    }

    let result = tokio::time::timeout(Duration::from_secs(15), exec_task)
        .await
        .expect("execute_run task timed out")
        .expect("execute_run task panicked");

    match result {
        Err(ExecError::Fenced { .. }) => {}
        other => panic!("expected a Fenced error, got {other:?}"),
    }

    // The run must NOT reach completed.
    let run = get_run(&base_url, &http, run_id).await;
    assert_ne!(run["status"], json!("completed"));

    // Evidence records the denial.
    let evidence = list_evidence(&base_url, &http, run_id).await;
    let contents: Vec<&str> = evidence
        .iter()
        .map(|e| e["content"].as_str().unwrap())
        .collect();
    assert!(
        contents
            .iter()
            .any(|c| c.contains("denied") || c.contains("stale")),
        "no denial evidence recorded: {contents:?}"
    );

    cleanup(&pool, workspace_id).await;
}

// ---------------------------------------------------------------------
// Test 3 — failure honesty: a nonzero exit is an honest Failed outcome.
// ---------------------------------------------------------------------

#[tokio::test]
async fn failure_honesty_nonzero_exit_yields_failed_outcome() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let base_url = spawn_coordinator(pool.clone()).await;
    let http = reqwest::Client::new();

    let repo_dir = tempfile::tempdir().unwrap();
    init_repo_with_one_commit(repo_dir.path());
    let base_commit = git_rev_parse_head(repo_dir.path());
    let worktree_root = tempfile::tempdir().unwrap();

    let (workspace_id, run_id, _binding_id) = setup_delegated_run(
        &base_url,
        &http,
        "test",
        &base_commit,
        "deliberately fail",
        "failure-honesty",
    )
    .await;

    let mut repo_map = HashMap::new();
    repo_map.insert("test".to_string(), repo_dir.path().to_path_buf());

    let cfg = ExecutorConfig {
        coord_base: base_url.clone(),
        auth_token: AUTH_TOKEN.to_string(),
        repo_map,
        worktree_root: worktree_root.path().to_path_buf(),
        command_template: vec!["sh".to_string(), "-c".to_string(), "exit 7".to_string()],
    };

    let outcome = execute_run(&cfg, run_id).await.unwrap();
    assert_eq!(outcome, Outcome::Failed { exit_code: 7 });

    let run = get_run(&base_url, &http, run_id).await;
    assert_eq!(run["status"], json!("failed"));

    let transitions = run["transitions"].as_array().unwrap();
    let reasons: Vec<&str> = transitions
        .iter()
        .map(|t| t["reason"].as_str().unwrap())
        .collect();
    assert!(
        reasons.iter().any(|r| r.contains("exit 7")),
        "transitions were: {reasons:?}"
    );

    cleanup(&pool, workspace_id).await;
}
