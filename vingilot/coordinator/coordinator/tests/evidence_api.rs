mod common;

use common::test_pool;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;
use vingilot_coordinator::domain::RunMode;
use vingilot_coordinator::run::{self, NewRun};
use vingilot_coordinator::{http, workspace};

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
            objective: "evidence api test".into(),
            mode: RunMode::Delegated,
            wall_limit_secs: None,
        },
    )
    .await
    .unwrap();
    (workspace_id, run_id)
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
async fn append_three_rows_assigns_sequential_seqs() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;
    let base_url = spawn(pool.clone()).await;
    let client = reqwest::Client::new();

    for (kind, content, expected_seq) in [
        ("command", "git worktree add ...", 1),
        ("output", "made-proof", 2),
        ("note", "executor v1 auto-verify", 3),
    ] {
        let resp = client
            .post(format!("{base_url}/v1/runs/{run_id}/evidence"))
            .bearer_auth(AUTH_TOKEN)
            .json(&json!({ "kind": kind, "content": content }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 201);
        let body: Value = resp.json().await.unwrap();
        assert_eq!(body["seq"], json!(expected_seq));
    }

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn list_after_seq_returns_only_later_rows() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;
    let base_url = spawn(pool.clone()).await;
    let client = reqwest::Client::new();

    for (kind, content) in [
        ("command", "first"),
        ("output", "second"),
        ("note", "third"),
    ] {
        client
            .post(format!("{base_url}/v1/runs/{run_id}/evidence"))
            .bearer_auth(AUTH_TOKEN)
            .json(&json!({ "kind": kind, "content": content }))
            .send()
            .await
            .unwrap();
    }

    let resp = client
        .get(format!("{base_url}/v1/runs/{run_id}/evidence?after=1"))
        .bearer_auth(AUTH_TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    let rows = body["evidence"].as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["seq"], json!(2));
    assert_eq!(rows[0]["kind"], json!("output"));
    assert_eq!(rows[0]["content"], json!("second"));
    assert_eq!(rows[1]["seq"], json!(3));
    assert_eq!(rows[1]["kind"], json!("note"));
    assert_eq!(rows[1]["content"], json!("third"));
    assert!(rows[0]["created_at"].is_string());

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn oversize_content_is_400() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;
    let base_url = spawn(pool.clone()).await;
    let client = reqwest::Client::new();

    let oversize = "a".repeat(64 * 1024 + 1);
    let resp = client
        .post(format!("{base_url}/v1/runs/{run_id}/evidence"))
        .bearer_auth(AUTH_TOKEN)
        .json(&json!({ "kind": "output", "content": oversize }))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["error"], json!("bad_request"));

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn unknown_kind_is_400() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;
    let base_url = spawn(pool.clone()).await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("{base_url}/v1/runs/{run_id}/evidence"))
        .bearer_auth(AUTH_TOKEN)
        .json(&json!({ "kind": "bogus", "content": "whatever" }))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 400);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["error"], json!("bad_request"));

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn evidence_endpoints_require_bearer() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;
    let base_url = spawn(pool.clone()).await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("{base_url}/v1/runs/{run_id}/evidence"))
        .json(&json!({ "kind": "note", "content": "no auth" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);

    let resp = client
        .get(format!("{base_url}/v1/runs/{run_id}/evidence"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);

    cleanup(&pool, workspace_id).await;
}
