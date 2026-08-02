mod common;

use common::test_pool;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;
use vingilot_coordinator::domain::RunMode;
use vingilot_coordinator::run::{self, NewRun};
use vingilot_coordinator::{binding, http, workspace};

const AUTH_TOKEN: &str = "test-secret-token";

/// Spawns the axum app on an ephemeral port and returns its base URL.
async fn spawn(pool: PgPool) -> String {
    let app = http::router(pool, AUTH_TOKEN.to_string());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

async fn new_workspace_and_run(pool: &PgPool) -> (Uuid, Uuid) {
    let workspace_id = Uuid::new_v4();
    workspace::ensure_workspace(pool, workspace_id)
        .await
        .unwrap();
    let run_id = run::create(
        pool,
        NewRun {
            workspace_id,
            parent_run_id: None,
            objective: "http api test".into(),
            mode: RunMode::Interactive,
            wall_limit_secs: None,
        },
    )
    .await
    .unwrap();
    (workspace_id, run_id)
}

fn key(label: &str) -> String {
    format!("{label}-{}", Uuid::new_v4())
}

/// The coordinator DB is a shared, persistent dev instance — every test
/// removes exactly what it created.
async fn cleanup(pool: &PgPool, workspace_id: Uuid) {
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

#[tokio::test]
async fn mutation_conflict_carries_current_state() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let workspace_id = Uuid::new_v4();
    workspace::ensure_workspace(&pool, workspace_id)
        .await
        .unwrap();
    let base_url = spawn(pool.clone()).await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("{base_url}/v1/workspaces/{workspace_id}/mutations"))
        .bearer_auth(AUTH_TOKEN)
        .json(&json!({ "expected_revision": 99, "mutations": [{"foo": "bar"}] }))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 409);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["accepted"], json!(false));
    assert_eq!(body["revision"], json!(0));
    assert_eq!(body["state_hash"], json!(workspace::state_hash(&json!({}))));

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn illegal_transition_names_both_states() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;
    let base_url = spawn(pool.clone()).await;
    let client = reqwest::Client::new();

    // Draft -> Running is not a legal edge (must go through Provisioning/Ready).
    let resp = client
        .post(format!("{base_url}/v1/runs/{run_id}/transition"))
        .bearer_auth(AUTH_TOKEN)
        .json(&json!({ "to": "running", "reason": "skip ahead" }))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 409);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["error"], json!("illegal_transition"));
    let detail = body["detail"].as_str().unwrap();
    assert!(
        detail.contains("Draft"),
        "detail missing from-state: {detail}"
    );
    assert!(
        detail.contains("Running"),
        "detail missing to-state: {detail}"
    );

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn validate_op_403_names_the_failed_check() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;
    let other_run_id = run::create(
        &pool,
        NewRun {
            workspace_id,
            parent_run_id: None,
            objective: "other".into(),
            mode: RunMode::Interactive,
            wall_limit_secs: None,
        },
    )
    .await
    .unwrap();

    let binding_id = binding::create_binding(
        &pool,
        run_id,
        "repo",
        "target",
        "primary",
        "abc123",
        None,
        &key("http-validate-op"),
    )
    .await
    .unwrap();
    let lease = binding::acquire_lease(&pool, binding_id, 60).await.unwrap();

    let base_url = spawn(pool.clone()).await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("{base_url}/v1/bindings/{binding_id}/validate-op"))
        .bearer_auth(AUTH_TOKEN)
        .json(&json!({ "run_id": other_run_id, "epoch": lease.epoch }))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 403);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["error"], json!("wrong_run"));

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn missing_bearer_is_401() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let workspace_id = Uuid::new_v4();
    workspace::ensure_workspace(&pool, workspace_id)
        .await
        .unwrap();
    let base_url = spawn(pool.clone()).await;
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("{base_url}/v1/workspaces/{workspace_id}"))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 401);

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn wrong_bearer_is_401() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let workspace_id = Uuid::new_v4();
    workspace::ensure_workspace(&pool, workspace_id)
        .await
        .unwrap();
    let base_url = spawn(pool.clone()).await;
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("{base_url}/v1/workspaces/{workspace_id}"))
        .bearer_auth("not-the-token")
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 401);

    cleanup(&pool, workspace_id).await;
}

#[test]
fn server_refuses_to_boot_without_auth_token() {
    assert!(http::require_auth_token(None).is_err());
    assert!(http::require_auth_token(Some(String::new())).is_err());
    assert!(http::require_auth_token(Some("configured".to_string())).is_ok());
}
