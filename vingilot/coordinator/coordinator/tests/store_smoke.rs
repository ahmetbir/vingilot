mod common;

use common::test_pool;

/// Schema-health smoke: the pool connects, migrations apply idempotently, and
/// the core table is queryable.
///
/// Deliberately does NOT assert the table is empty: this database is a shared,
/// persistent dev instance, and the live Workbench bootstraps a standing dev
/// workspace into it — an absolute zero-count here goes permanently red the
/// first time anyone runs the app (audit finding). Row-level correctness lives
/// in the suites that create and clean up their own rows.
#[tokio::test]
async fn connects_migrates_idempotently_and_queries() {
    let Some(pool) = test_pool().await else {
        return;
    };

    // test_pool() already migrated once; a second run must be a no-op.
    vingilot_coordinator::store::migrate(&pool)
        .await
        .expect("re-running migrations must be idempotent");

    let count: (i64,) = sqlx::query_as("SELECT count(*) FROM workspaces")
        .fetch_one(&pool)
        .await
        .expect("count query should succeed against a migrated schema");

    assert!(count.0 >= 0);
}
