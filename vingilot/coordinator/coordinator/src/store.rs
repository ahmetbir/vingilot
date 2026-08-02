use std::time::Duration;

use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

/// Errors from Postgres connection setup and migration.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("failed to connect to postgres: {0}")]
    Connect(#[source] sqlx::Error),
    #[error("failed to run migrations: {0}")]
    Migrate(#[source] sqlx::migrate::MigrateError),
}

/// Connects to Postgres with a bounded acquire timeout so a down/unreachable
/// database fails fast instead of hanging callers.
pub async fn connect(url: &str) -> Result<PgPool, StoreError> {
    PgPoolOptions::new()
        .acquire_timeout(Duration::from_secs(5))
        .connect(url)
        .await
        .map_err(StoreError::Connect)
}

/// Applies the crate's embedded migrations to bring the schema up to date.
pub async fn migrate(pool: &PgPool) -> Result<(), StoreError> {
    sqlx::migrate!("./migrations")
        .run(pool)
        .await
        .map_err(StoreError::Migrate)
}
