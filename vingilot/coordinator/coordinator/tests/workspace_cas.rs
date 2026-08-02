mod common;

use common::test_pool;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;
use vingilot_coordinator::workspace::{apply_mutations, ensure_workspace};

/// The coordinator DB is a shared, persistent dev instance (not reset
/// between test runs), and other suites (e.g. store_smoke) assert absolute
/// row counts. Every test that writes a workspace must remove exactly what
/// it created so the table is left as it was found.
async fn cleanup_workspace(pool: &PgPool, workspace_id: Uuid) {
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
async fn accepts_at_expected_revision() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let workspace_id = Uuid::new_v4();
    ensure_workspace(&pool, workspace_id)
        .await
        .expect("ensure_workspace should succeed");

    let mutations = vec![json!({"foo": "bar"})];
    let outcome = apply_mutations(&pool, workspace_id, 0, &mutations)
        .await
        .expect("apply_mutations should succeed");

    assert!(outcome.accepted);
    assert_eq!(outcome.revision, 1);

    let event_count: (i64,) = sqlx::query_as(
        "SELECT count(*) FROM workspace_events WHERE workspace_id = $1 AND revision = $2",
    )
    .bind(workspace_id)
    .bind(outcome.revision)
    .fetch_one(&pool)
    .await
    .expect("event count query should succeed");

    assert_eq!(event_count.0, 1);

    cleanup_workspace(&pool, workspace_id).await;
}

#[tokio::test]
async fn rejects_stale_with_current_state() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let workspace_id = Uuid::new_v4();
    ensure_workspace(&pool, workspace_id)
        .await
        .expect("ensure_workspace should succeed");

    let mutations = vec![json!({"foo": "bar"})];
    let winner = apply_mutations(&pool, workspace_id, 0, &mutations)
        .await
        .expect("first apply_mutations should succeed");
    assert!(winner.accepted);

    let loser = apply_mutations(&pool, workspace_id, 0, &mutations)
        .await
        .expect("second apply_mutations should succeed (as a rejection)");

    assert!(!loser.accepted);
    assert_eq!(loser.revision, winner.revision);
    assert_eq!(loser.state_hash, winner.state_hash);

    cleanup_workspace(&pool, workspace_id).await;
}

#[tokio::test]
async fn two_racing_writers_one_wins() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let workspace_id = Uuid::new_v4();
    ensure_workspace(&pool, workspace_id)
        .await
        .expect("ensure_workspace should succeed");

    let mutations_a = vec![json!({"writer": "a"})];
    let mutations_b = vec![json!({"writer": "b"})];

    let (result_a, result_b) = tokio::join!(
        apply_mutations(&pool, workspace_id, 0, &mutations_a),
        apply_mutations(&pool, workspace_id, 0, &mutations_b),
    );

    let outcome_a = result_a.expect("apply_mutations a should not error");
    let outcome_b = result_b.expect("apply_mutations b should not error");

    let accepted_count = [outcome_a.accepted, outcome_b.accepted]
        .into_iter()
        .filter(|accepted| *accepted)
        .count();

    assert_eq!(accepted_count, 1);

    cleanup_workspace(&pool, workspace_id).await;
}
