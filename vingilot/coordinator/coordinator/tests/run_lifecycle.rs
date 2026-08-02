mod common;

use common::test_pool;
use sqlx::PgPool;
use uuid::Uuid;
use vingilot_coordinator::domain::{RunMode, RunStatus};
use vingilot_coordinator::run::{self, NewRun, RunError};

async fn new_workspace(pool: &sqlx::PgPool) -> Uuid {
    let workspace_id = Uuid::new_v4();
    vingilot_coordinator::workspace::ensure_workspace(pool, workspace_id)
        .await
        .unwrap();
    workspace_id
}

/// The coordinator DB is a shared, persistent dev instance (not reset
/// between test runs), and other suites (e.g. store_smoke) assert absolute
/// row counts. Every test that writes a workspace/run must remove exactly
/// what it created so the tables are left as they were found.
async fn cleanup_workspace(pool: &PgPool, workspace_id: Uuid) {
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
async fn create_defaults_to_draft() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let workspace_id = new_workspace(&pool).await;

    let run_id = run::create(
        &pool,
        NewRun {
            workspace_id,
            parent_run_id: None,
            objective: "test objective".to_string(),
            mode: RunMode::Interactive,
            wall_limit_secs: None,
        },
    )
    .await
    .unwrap();

    let (status, mode): (String, String) =
        sqlx::query_as("SELECT status, mode FROM runs WHERE id = $1")
            .bind(run_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(status, RunStatus::Draft.as_str());
    assert_eq!(mode, RunMode::Interactive.as_str());

    cleanup_workspace(&pool, workspace_id).await;
}

#[tokio::test]
async fn legal_chain_recorded_with_sequential_seq() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let workspace_id = new_workspace(&pool).await;
    let run_id = run::create(
        &pool,
        NewRun {
            workspace_id,
            parent_run_id: None,
            objective: "chain".into(),
            mode: RunMode::Delegated,
            wall_limit_secs: None,
        },
    )
    .await
    .unwrap();

    run::transition(&pool, run_id, RunStatus::Provisioning, "start")
        .await
        .unwrap();
    run::transition(&pool, run_id, RunStatus::Ready, "provisioned")
        .await
        .unwrap();
    run::transition(&pool, run_id, RunStatus::Running, "run")
        .await
        .unwrap();

    let rows: Vec<(i64, String, String, String)> = sqlx::query_as(
        "SELECT seq, from_status, to_status, reason FROM run_transitions \
         WHERE run_id = $1 ORDER BY seq",
    )
    .bind(run_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(rows.len(), 3);
    assert_eq!(
        rows[0],
        (
            1,
            "draft".to_string(),
            "provisioning".to_string(),
            "start".to_string()
        )
    );
    assert_eq!(
        rows[1],
        (
            2,
            "provisioning".to_string(),
            "ready".to_string(),
            "provisioned".to_string()
        )
    );
    assert_eq!(
        rows[2],
        (
            3,
            "ready".to_string(),
            "running".to_string(),
            "run".to_string()
        )
    );

    let status: String = sqlx::query_scalar("SELECT status FROM runs WHERE id = $1")
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "running");

    cleanup_workspace(&pool, workspace_id).await;
}

#[tokio::test]
async fn illegal_transition_rejected_without_appending_row() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let workspace_id = new_workspace(&pool).await;
    let run_id = run::create(
        &pool,
        NewRun {
            workspace_id,
            parent_run_id: None,
            objective: "illegal".into(),
            mode: RunMode::Chat,
            wall_limit_secs: None,
        },
    )
    .await
    .unwrap();

    let err = run::transition(&pool, run_id, RunStatus::Running, "skip ahead")
        .await
        .unwrap_err();
    match err {
        RunError::IllegalTransition { from, to } => {
            assert_eq!(from, RunStatus::Draft);
            assert_eq!(to, RunStatus::Running);
        }
        other => panic!("expected IllegalTransition, got {other:?}"),
    }

    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM run_transitions WHERE run_id = $1")
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);

    let status: String = sqlx::query_scalar("SELECT status FROM runs WHERE id = $1")
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "draft");

    cleanup_workspace(&pool, workspace_id).await;
}

#[tokio::test]
async fn depth_walks_parent_chain() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let workspace_id = new_workspace(&pool).await;

    let root = run::create(
        &pool,
        NewRun {
            workspace_id,
            parent_run_id: None,
            objective: "root".into(),
            mode: RunMode::Interactive,
            wall_limit_secs: None,
        },
    )
    .await
    .unwrap();
    let child = run::create(
        &pool,
        NewRun {
            workspace_id,
            parent_run_id: Some(root),
            objective: "child".into(),
            mode: RunMode::Interactive,
            wall_limit_secs: None,
        },
    )
    .await
    .unwrap();
    let grandchild = run::create(
        &pool,
        NewRun {
            workspace_id,
            parent_run_id: Some(child),
            objective: "grandchild".into(),
            mode: RunMode::Interactive,
            wall_limit_secs: None,
        },
    )
    .await
    .unwrap();

    assert_eq!(run::depth(&pool, root).await.unwrap(), 0);
    assert_eq!(run::depth(&pool, child).await.unwrap(), 1);
    assert_eq!(run::depth(&pool, grandchild).await.unwrap(), 2);

    cleanup_workspace(&pool, workspace_id).await;
}

#[tokio::test]
async fn unknown_parent_surfaces_as_run_error() {
    let Some(pool) = test_pool().await else {
        return;
    };
    let workspace_id = new_workspace(&pool).await;
    let bogus_parent = Uuid::new_v4();

    let result = run::create(
        &pool,
        NewRun {
            workspace_id,
            parent_run_id: Some(bogus_parent),
            objective: "orphan".into(),
            mode: RunMode::Interactive,
            wall_limit_secs: None,
        },
    )
    .await;

    assert!(matches!(result, Err(RunError::Db(_))));

    cleanup_workspace(&pool, workspace_id).await;
}
