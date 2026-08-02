mod common;

use common::test_pool;
use sqlx::PgPool;
use uuid::Uuid;
use vingilot_coordinator::domain::{Access, RunMode, RunStatus};
use vingilot_coordinator::run::{self, NewRun};
use vingilot_coordinator::saga::{self, ProvisionSpec, WorktreeSpec};

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
            objective: "saga test".into(),
            mode: RunMode::Interactive,
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

/// Extra cleanup for a binding created directly (outside a run's workspace
/// cleanup scope), used to seed the "owned by another run" conflict.
async fn cleanup_foreign(pool: &PgPool, workspace_id: Uuid, run_id: Uuid) {
    let _ = sqlx::query("DELETE FROM run_worktree_grants WHERE run_id = $1")
        .bind(run_id)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM worktree_bindings WHERE owner_run_id = $1")
        .bind(run_id)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM run_transitions WHERE run_id = $1")
        .bind(run_id)
        .execute(pool)
        .await;
    let _ = sqlx::query("DELETE FROM runs WHERE id = $1")
        .bind(run_id)
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

fn spec(run_id: Uuid, keys: [&str; 2]) -> ProvisionSpec {
    ProvisionSpec {
        run_id,
        worktrees: vec![
            WorktreeSpec {
                repo_id: "repo".into(),
                target_id: "target-a".into(),
                role: "primary".into(),
                base_commit: "abc123".into(),
                branch: None,
                access: Access::Write,
                idempotency_key: keys[0].to_string(),
            },
            WorktreeSpec {
                repo_id: "repo".into(),
                target_id: "target-b".into(),
                role: "task".into(),
                base_commit: "abc123".into(),
                branch: None,
                access: Access::Read,
                idempotency_key: keys[1].to_string(),
            },
        ],
    }
}

async fn run_status(pool: &PgPool, run_id: Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM runs WHERE id = $1")
        .bind(run_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn binding_count(pool: &PgPool, keys: &[String]) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM worktree_bindings WHERE idempotency_key = ANY($1)")
        .bind(keys)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn provision_moves_draft_to_ready_with_bindings_and_grants() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;
    let key_a = key("provision-a");
    let key_b = key("provision-b");
    let spec = spec(run_id, [&key_a, &key_b]);

    saga::provision(&pool, &spec).await.unwrap();

    assert_eq!(run_status(&pool, run_id).await, "ready");

    let bindings: Vec<(String, Option<Uuid>)> = sqlx::query_as(
        "SELECT lifecycle, owner_run_id FROM worktree_bindings \
         WHERE idempotency_key = ANY($1)",
    )
    .bind(vec![key_a.clone(), key_b.clone()])
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(bindings.len(), 2);
    for (lifecycle, owner) in &bindings {
        assert_eq!(lifecycle, "ready");
        assert_eq!(*owner, Some(run_id));
    }

    let grants: i64 =
        sqlx::query_scalar("SELECT count(*) FROM run_worktree_grants WHERE run_id = $1")
            .bind(run_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(grants, 2);

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn second_call_with_same_spec_is_a_no_op() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;
    let key_a = key("idempotent-a");
    let key_b = key("idempotent-b");
    let spec = spec(run_id, [&key_a, &key_b]);

    saga::provision(&pool, &spec).await.unwrap();
    saga::provision(&pool, &spec).await.unwrap();

    assert_eq!(run_status(&pool, run_id).await, "ready");
    assert_eq!(
        binding_count(&pool, &[key_a.clone(), key_b.clone()]).await,
        2
    );

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn crash_resume_converges_to_ready_without_duplicate_bindings() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;
    let key_a = key("resume-a");
    let key_b = key("resume-b");
    let spec = spec(run_id, [&key_a, &key_b]);

    saga::provision(&pool, &spec).await.unwrap();
    assert_eq!(run_status(&pool, run_id).await, "ready");

    // Simulate a crash between the worktree steps committing and the final
    // Provisioning -> Ready transition landing: roll the run back to
    // Provisioning and drop the transition row that recorded Ready.
    sqlx::query("DELETE FROM run_transitions WHERE run_id = $1 AND to_status = 'ready'")
        .bind(run_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE runs SET status = 'provisioning' WHERE id = $1")
        .bind(run_id)
        .execute(&pool)
        .await
        .unwrap();

    saga::provision(&pool, &spec).await.unwrap();

    assert_eq!(run_status(&pool, run_id).await, "ready");
    assert_eq!(
        binding_count(&pool, &[key_a.clone(), key_b.clone()]).await,
        2
    );

    cleanup(&pool, workspace_id).await;
}

#[tokio::test]
async fn conflicting_idempotency_key_fails_and_compensates() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;

    // A foreign run already owns a binding under `foreign_key`.
    let foreign_workspace_id = Uuid::new_v4();
    vingilot_coordinator::workspace::ensure_workspace(&pool, foreign_workspace_id)
        .await
        .unwrap();
    let foreign_run_id = run::create(
        &pool,
        NewRun {
            workspace_id: foreign_workspace_id,
            parent_run_id: None,
            objective: "foreign".into(),
            mode: RunMode::Interactive,
            wall_limit_secs: None,
        },
    )
    .await
    .unwrap();
    let foreign_key = key("foreign-owned");
    vingilot_coordinator::binding::create_binding(
        &pool,
        foreign_run_id,
        "repo",
        "target-foreign",
        "primary",
        "abc123",
        None,
        &foreign_key,
    )
    .await
    .unwrap();

    let key_a = key("conflict-a");
    let spec = ProvisionSpec {
        run_id,
        worktrees: vec![
            WorktreeSpec {
                repo_id: "repo".into(),
                target_id: "target-a".into(),
                role: "primary".into(),
                base_commit: "abc123".into(),
                branch: None,
                access: Access::Write,
                idempotency_key: key_a.clone(),
            },
            WorktreeSpec {
                repo_id: "repo".into(),
                target_id: "target-b".into(),
                role: "task".into(),
                base_commit: "abc123".into(),
                branch: None,
                access: Access::Read,
                idempotency_key: foreign_key.clone(),
            },
        ],
    };

    let err = saga::provision(&pool, &spec).await.unwrap_err();
    assert!(matches!(
        err,
        vingilot_coordinator::saga::SagaError::WorktreeOwnedByAnotherRun { .. }
    ));

    // This run's own binding (target-a) must not be left ready+owned.
    let (lifecycle, owner): (String, Option<Uuid>) = sqlx::query_as(
        "SELECT lifecycle, owner_run_id FROM worktree_bindings WHERE idempotency_key = $1",
    )
    .bind(&key_a)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_ne!(lifecycle, "ready");
    assert_ne!(lifecycle, "provisioning");
    assert_eq!(owner, Some(run_id));

    let grants: i64 =
        sqlx::query_scalar("SELECT count(*) FROM run_worktree_grants WHERE run_id = $1")
            .bind(run_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(grants, 0);

    assert_eq!(run_status(&pool, run_id).await, "failed");

    // The foreign binding is untouched — still owned by its real owner.
    let (foreign_lifecycle, foreign_owner): (String, Option<Uuid>) = sqlx::query_as(
        "SELECT lifecycle, owner_run_id FROM worktree_bindings WHERE idempotency_key = $1",
    )
    .bind(&foreign_key)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(foreign_lifecycle, "ready");
    assert_eq!(foreign_owner, Some(foreign_run_id));

    cleanup(&pool, workspace_id).await;
    cleanup_foreign(&pool, foreign_workspace_id, foreign_run_id).await;
}

#[tokio::test]
async fn unexpected_status_is_rejected() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let (workspace_id, run_id) = new_workspace_and_run(&pool).await;
    run::transition(&pool, run_id, RunStatus::Provisioning, "start")
        .await
        .unwrap();
    run::transition(&pool, run_id, RunStatus::Cancelled, "abandoned")
        .await
        .unwrap();

    let spec = spec(run_id, ["unused-a", "unused-b"]);
    let err = saga::provision(&pool, &spec).await.unwrap_err();
    assert!(matches!(
        err,
        vingilot_coordinator::saga::SagaError::UnexpectedStatus { .. }
    ));

    cleanup(&pool, workspace_id).await;
}
