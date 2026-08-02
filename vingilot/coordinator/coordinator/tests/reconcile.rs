mod common;

use chrono::Utc;
use common::test_pool;
use sqlx::PgPool;
use std::time::Duration as StdDuration;
use uuid::Uuid;
use vingilot_coordinator::domain::{RunMode, RunStatus};
use vingilot_coordinator::reconcile::sweep_once;
use vingilot_coordinator::run::{self, NewRun};

async fn new_workspace_and_run(pool: &PgPool, wall_limit_secs: Option<i64>) -> (Uuid, Uuid) {
    let workspace_id = Uuid::new_v4();
    vingilot_coordinator::workspace::ensure_workspace(pool, workspace_id)
        .await
        .unwrap();
    let run_id = run::create(
        pool,
        NewRun {
            workspace_id,
            parent_run_id: None,
            objective: "reconcile test".into(),
            mode: RunMode::Interactive,
            wall_limit_secs,
        },
    )
    .await
    .unwrap();
    (workspace_id, run_id)
}

async fn make_running(pool: &PgPool, run_id: Uuid) {
    run::transition(pool, run_id, RunStatus::Provisioning, "start")
        .await
        .unwrap();
    run::transition(pool, run_id, RunStatus::Ready, "provisioned")
        .await
        .unwrap();
    run::transition(pool, run_id, RunStatus::Running, "run")
        .await
        .unwrap();
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
async fn expired_lease_quarantines_binding_and_pauses_run() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool, None).await;
    make_running(&pool, run_id).await;

    let binding_id = vingilot_coordinator::binding::create_binding(
        &pool,
        run_id,
        "repo",
        "target",
        "primary",
        "abc123",
        None,
        &key("lease-expiry"),
    )
    .await
    .unwrap();
    vingilot_coordinator::binding::acquire_lease(&pool, binding_id, 1)
        .await
        .unwrap();

    tokio::time::sleep(StdDuration::from_secs(2)).await;

    let report = sweep_once(&pool).await.unwrap();
    assert_eq!(report.leases_expired, 1);
    assert_eq!(report.bindings_quarantined, 1);
    assert_eq!(report.runs_paused, 1);
    assert_eq!(report.runs_wall_exceeded, 0);

    let lifecycle: String =
        sqlx::query_scalar("SELECT lifecycle FROM worktree_bindings WHERE id = $1")
            .bind(binding_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(lifecycle, "quarantined");

    let (status, reason): (String, String) = sqlx::query_as(
        "SELECT r.status, t.reason FROM runs r \
         JOIN run_transitions t ON t.run_id = r.id \
         WHERE r.id = $1 ORDER BY t.seq DESC LIMIT 1",
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(status, "paused");
    assert_eq!(reason, "lease lost");

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn wall_clock_budget_exhausted_pauses_run() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool, Some(1)).await;
    make_running(&pool, run_id).await;

    // Simulate the run having started its wall clock 2 seconds ago, against a
    // 1 second budget — direct SQL, as the plan specifies.
    sqlx::query("UPDATE runs SET wall_started_at = now() - interval '2 seconds' WHERE id = $1")
        .bind(run_id)
        .execute(&pool)
        .await
        .unwrap();

    let report = sweep_once(&pool).await.unwrap();
    assert_eq!(report.runs_wall_exceeded, 1);
    assert_eq!(report.runs_paused, 1);
    assert_eq!(report.leases_expired, 0);
    assert_eq!(report.bindings_quarantined, 0);

    let (status, reason): (String, String) = sqlx::query_as(
        "SELECT r.status, t.reason FROM runs r \
         JOIN run_transitions t ON t.run_id = r.id \
         WHERE r.id = $1 ORDER BY t.seq DESC LIMIT 1",
    )
    .bind(run_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(status, "paused");
    assert_eq!(reason, "wall clock budget exhausted");

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn token_observation_never_pauses_the_run() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool, None).await;
    make_running(&pool, run_id).await;

    // Observe a token total wildly over any sane budget.
    run::observe_tokens(&pool, run_id, 999_999_999, Utc::now())
        .await
        .unwrap();

    let status: String = sqlx::query_scalar("SELECT status FROM runs WHERE id = $1")
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "running");

    let tokens_observed: i64 = sqlx::query_scalar("SELECT tokens_observed FROM runs WHERE id = $1")
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(tokens_observed, 999_999_999);

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn token_observation_keeps_the_monotonic_max() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool, None).await;

    run::observe_tokens(&pool, run_id, 500, Utc::now())
        .await
        .unwrap();
    run::observe_tokens(&pool, run_id, 100, Utc::now())
        .await
        .unwrap();

    let tokens_observed: i64 = sqlx::query_scalar("SELECT tokens_observed FROM runs WHERE id = $1")
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(tokens_observed, 500);

    cleanup(&pool, workspace_id).await;
}

/// Audit finding: nothing in production ever wrote `wall_started_at` — only
/// this file's own raw SQL did — so the "enforceable" wall-clock budget could
/// never fire outside the test harness. The clock must start when a Run first
/// enters Running, via the public API alone, and must NOT reset on resume.
#[tokio::test]
async fn wall_clock_starts_on_first_running_and_survives_resume() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool, Some(1)).await;

    // Public API only — no raw SQL seeding of wall_started_at.
    make_running(&pool, run_id).await;

    let started: Option<chrono::DateTime<Utc>> =
        sqlx::query_scalar("SELECT wall_started_at FROM runs WHERE id = $1")
            .bind(run_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let started = started.expect("transition into Running must start the wall clock");

    // Resume path must keep the original clock, not restart it.
    run::transition(&pool, run_id, RunStatus::Paused, "operator pause")
        .await
        .unwrap();
    run::transition(&pool, run_id, RunStatus::Running, "resume")
        .await
        .unwrap();
    let after_resume: Option<chrono::DateTime<Utc>> =
        sqlx::query_scalar("SELECT wall_started_at FROM runs WHERE id = $1")
            .bind(run_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        after_resume,
        Some(started),
        "resume must not reset the wall clock"
    );

    // With a 1s limit and a clock started by production code, the sweep fires.
    tokio::time::sleep(StdDuration::from_secs(2)).await;
    let report = sweep_once(&pool).await.unwrap();
    assert!(report.runs_wall_exceeded >= 1);
    let status: String = sqlx::query_scalar("SELECT status FROM runs WHERE id = $1")
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "paused");

    cleanup(&pool, workspace_id).await;
}
