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

fn key(label: &str) -> String {
    format!("{label}-{}", Uuid::new_v4())
}

async fn new_workspace_run_and_binding(pool: &PgPool, label: &str) -> (Uuid, Uuid, Uuid) {
    let workspace_id = Uuid::new_v4();
    workspace::ensure_workspace(pool, workspace_id)
        .await
        .unwrap();
    let run_id = run::create(
        pool,
        NewRun {
            workspace_id,
            parent_run_id: None,
            objective: "lease api test".into(),
            mode: RunMode::Interactive,
            wall_limit_secs: None,
        },
    )
    .await
    .unwrap();
    let binding_id = binding::create_binding(
        pool,
        run_id,
        "repo",
        "target",
        "primary",
        "abc123",
        None,
        &key(label),
    )
    .await
    .unwrap();
    (workspace_id, run_id, binding_id)
}

/// The coordinator DB is a shared, persistent dev instance — every test
/// removes exactly what it created.
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

#[tokio::test]
async fn acquire_lease_returns_epoch_one_on_a_fresh_binding() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, _run_id, binding_id) = new_workspace_run_and_binding(&pool, "acquire").await;
    let base_url = spawn(pool.clone()).await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("{base_url}/v1/bindings/{binding_id}/lease"))
        .bearer_auth(AUTH_TOKEN)
        .json(&json!({ "ttl_secs": 60 }))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["epoch"], json!(1));
    assert!(body["expires_at"].is_string());

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn renew_with_current_epoch_keeps_epoch_and_extends_expiry() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, _run_id, binding_id) = new_workspace_run_and_binding(&pool, "renew").await;
    let base_url = spawn(pool.clone()).await;
    let client = reqwest::Client::new();

    let acquire_resp = client
        .post(format!("{base_url}/v1/bindings/{binding_id}/lease"))
        .bearer_auth(AUTH_TOKEN)
        .json(&json!({ "ttl_secs": 5 }))
        .send()
        .await
        .unwrap();
    let acquired: Value = acquire_resp.json().await.unwrap();
    let epoch = acquired["epoch"].as_i64().unwrap();
    let first_expiry = acquired["expires_at"].as_str().unwrap().to_string();

    let renew_resp = client
        .post(format!("{base_url}/v1/bindings/{binding_id}/lease/renew"))
        .bearer_auth(AUTH_TOKEN)
        .json(&json!({ "epoch": epoch, "ttl_secs": 600 }))
        .send()
        .await
        .unwrap();

    assert_eq!(renew_resp.status(), 200);
    let renewed: Value = renew_resp.json().await.unwrap();
    assert_eq!(renewed["epoch"], json!(epoch));
    let second_expiry = renewed["expires_at"].as_str().unwrap().to_string();
    assert!(
        second_expiry > first_expiry,
        "renewed expiry ({second_expiry}) must be later than the original ({first_expiry})"
    );

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn renew_with_stale_epoch_is_409() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, _run_id, binding_id) =
        new_workspace_run_and_binding(&pool, "stale-renew").await;
    let base_url = spawn(pool.clone()).await;
    let client = reqwest::Client::new();

    let first_acquire = client
        .post(format!("{base_url}/v1/bindings/{binding_id}/lease"))
        .bearer_auth(AUTH_TOKEN)
        .json(&json!({ "ttl_secs": 60 }))
        .send()
        .await
        .unwrap();
    let first: Value = first_acquire.json().await.unwrap();
    let stale_epoch = first["epoch"].as_i64().unwrap();

    // Second acquire bumps the epoch out from under the first holder.
    client
        .post(format!("{base_url}/v1/bindings/{binding_id}/lease"))
        .bearer_auth(AUTH_TOKEN)
        .json(&json!({ "ttl_secs": 60 }))
        .send()
        .await
        .unwrap();

    let renew_resp = client
        .post(format!("{base_url}/v1/bindings/{binding_id}/lease/renew"))
        .bearer_auth(AUTH_TOKEN)
        .json(&json!({ "epoch": stale_epoch, "ttl_secs": 60 }))
        .send()
        .await
        .unwrap();

    assert_eq!(renew_resp.status(), 409);
    let body: Value = renew_resp.json().await.unwrap();
    assert_eq!(body["error"], json!("stale_epoch"));

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn reacquiring_a_lease_bumps_the_epoch() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, _run_id, binding_id) =
        new_workspace_run_and_binding(&pool, "reacquire").await;
    let base_url = spawn(pool.clone()).await;
    let client = reqwest::Client::new();

    let first = client
        .post(format!("{base_url}/v1/bindings/{binding_id}/lease"))
        .bearer_auth(AUTH_TOKEN)
        .json(&json!({ "ttl_secs": 60 }))
        .send()
        .await
        .unwrap();
    let first_body: Value = first.json().await.unwrap();
    assert_eq!(first_body["epoch"], json!(1));

    let second = client
        .post(format!("{base_url}/v1/bindings/{binding_id}/lease"))
        .bearer_auth(AUTH_TOKEN)
        .json(&json!({ "ttl_secs": 60 }))
        .send()
        .await
        .unwrap();
    let second_body: Value = second.json().await.unwrap();
    assert_eq!(second_body["epoch"], json!(2));

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn lease_endpoints_require_bearer() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, _run_id, binding_id) = new_workspace_run_and_binding(&pool, "auth").await;
    let base_url = spawn(pool.clone()).await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("{base_url}/v1/bindings/{binding_id}/lease"))
        .json(&json!({ "ttl_secs": 60 }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);

    cleanup(&pool, workspace_id).await;
}
