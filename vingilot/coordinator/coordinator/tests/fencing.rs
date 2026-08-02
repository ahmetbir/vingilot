mod common;

use common::test_pool;
use sqlx::PgPool;
use std::time::Duration as StdDuration;
use uuid::Uuid;
use vingilot_coordinator::binding::{self, BindingError, OpDenied};
use vingilot_coordinator::domain::{Access, RunMode};
use vingilot_coordinator::run::{self, NewRun};

async fn new_workspace_and_run(pool: &PgPool) -> (Uuid, Uuid) {
    let workspace_id = Uuid::new_v4();
    vingilot_coordinator::workspace::ensure_workspace(pool, workspace_id)
        .await
        .unwrap();
    let run_id = run::create(
        pool,
        NewRun {
            workspace_id,
            parent_run_id: None,
            objective: "fencing test".into(),
            mode: RunMode::Interactive,
            wall_limit_secs: None,
        },
    )
    .await
    .unwrap();
    (workspace_id, run_id)
}

/// The coordinator DB is a shared, persistent dev instance (see
/// `run_lifecycle.rs`) — every test removes exactly what it created.
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

fn key(label: &str) -> String {
    format!("{label}-{}", Uuid::new_v4())
}

#[tokio::test]
async fn happy_path_validates() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;

    let binding_id = binding::create_binding(
        &pool,
        run_id,
        "repo",
        "target",
        "primary",
        "abc123",
        None,
        &key("happy"),
    )
    .await
    .unwrap();

    let lease = binding::acquire_lease(&pool, binding_id, 60).await.unwrap();

    binding::validate_op(&pool, run_id, binding_id, lease.epoch)
        .await
        .unwrap();

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn wrong_run_is_denied() {
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
        &key("wrong-run"),
    )
    .await
    .unwrap();
    let lease = binding::acquire_lease(&pool, binding_id, 60).await.unwrap();

    let err = binding::validate_op(&pool, other_run_id, binding_id, lease.epoch)
        .await
        .unwrap_err();
    match err {
        OpDenied::WrongRun {
            run_id: got_run,
            binding_id: got_binding,
        } => {
            assert_eq!(got_run, other_run_id);
            assert_eq!(got_binding, binding_id);
        }
        other => panic!("expected WrongRun, got {other:?}"),
    }

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn quarantined_lifecycle_is_denied() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;

    let binding_id = binding::create_binding(
        &pool,
        run_id,
        "repo",
        "target",
        "primary",
        "abc123",
        None,
        &key("quarantined"),
    )
    .await
    .unwrap();
    let lease = binding::acquire_lease(&pool, binding_id, 60).await.unwrap();

    sqlx::query("UPDATE worktree_bindings SET lifecycle = 'quarantined' WHERE id = $1")
        .bind(binding_id)
        .execute(&pool)
        .await
        .unwrap();

    let err = binding::validate_op(&pool, run_id, binding_id, lease.epoch)
        .await
        .unwrap_err();
    match err {
        OpDenied::NotReady(id) => assert_eq!(id, binding_id),
        other => panic!("expected NotReady, got {other:?}"),
    }

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn stale_epoch_after_reacquire_is_denied() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;

    let binding_id = binding::create_binding(
        &pool,
        run_id,
        "repo",
        "target",
        "primary",
        "abc123",
        None,
        &key("stale-epoch"),
    )
    .await
    .unwrap();
    let first_lease = binding::acquire_lease(&pool, binding_id, 60).await.unwrap();
    let second_lease = binding::acquire_lease(&pool, binding_id, 60).await.unwrap();
    assert!(second_lease.epoch > first_lease.epoch);

    let err = binding::validate_op(&pool, run_id, binding_id, first_lease.epoch)
        .await
        .unwrap_err();
    match err {
        OpDenied::StaleEpoch {
            binding_id: got,
            current,
            presented,
        } => {
            assert_eq!(got, binding_id);
            assert_eq!(current, second_lease.epoch);
            assert_eq!(presented, first_lease.epoch);
        }
        other => panic!("expected StaleEpoch, got {other:?}"),
    }

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn expired_lease_is_denied() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;

    let binding_id = binding::create_binding(
        &pool,
        run_id,
        "repo",
        "target",
        "primary",
        "abc123",
        None,
        &key("expired"),
    )
    .await
    .unwrap();
    let lease = binding::acquire_lease(&pool, binding_id, 1).await.unwrap();

    tokio::time::sleep(StdDuration::from_secs(2)).await;

    let err = binding::validate_op(&pool, run_id, binding_id, lease.epoch)
        .await
        .unwrap_err();
    match err {
        OpDenied::LeaseExpired(id) => assert_eq!(id, binding_id),
        other => panic!("expected LeaseExpired, got {other:?}"),
    }

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn create_binding_is_idempotent() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;
    let idempotency_key = key("idempotent");

    let first = binding::create_binding(
        &pool,
        run_id,
        "repo",
        "target",
        "primary",
        "abc123",
        None,
        &idempotency_key,
    )
    .await
    .unwrap();
    let second = binding::create_binding(
        &pool,
        run_id,
        "repo",
        "target",
        "primary",
        "abc123",
        None,
        &idempotency_key,
    )
    .await
    .unwrap();

    assert_eq!(first, second);

    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM worktree_bindings WHERE idempotency_key = $1")
            .bind(&idempotency_key)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1);

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn second_writable_grant_on_same_run_is_rejected() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;

    let binding_a = binding::create_binding(
        &pool,
        run_id,
        "repo",
        "target-a",
        "primary",
        "abc123",
        None,
        &key("writable-a"),
    )
    .await
    .unwrap();
    let binding_b = binding::create_binding(
        &pool,
        run_id,
        "repo",
        "target-b",
        "task",
        "abc123",
        None,
        &key("writable-b"),
    )
    .await
    .unwrap();

    binding::grant(&pool, run_id, binding_a, Access::Write)
        .await
        .unwrap();
    let err = binding::grant(&pool, run_id, binding_b, Access::Write)
        .await
        .unwrap_err();
    assert!(matches!(err, BindingError::WritableLimitExceeded));

    cleanup(&pool, workspace_id).await;
}
