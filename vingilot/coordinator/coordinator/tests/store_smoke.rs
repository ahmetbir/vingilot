mod common;

use common::test_pool;

#[tokio::test]
async fn connects_migrates_and_counts_zero_workspaces() {
    let Some(pool) = test_pool().await else {
        return;
    };

    let count: (i64,) = sqlx::query_as("SELECT count(*) FROM workspaces")
        .fetch_one(&pool)
        .await
        .expect("count query should succeed against a migrated schema");

    assert_eq!(count.0, 0);
}
