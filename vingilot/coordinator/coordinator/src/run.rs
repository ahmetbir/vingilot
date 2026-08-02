//! Runs persisted — create, validated transitions, and derived depth.
//!
//! Transitions are validated against the domain's closed transition table
//! (ADR-002 §Run transitions) inside a single transaction: the row is locked
//! with `SELECT ... FOR UPDATE`, the edge is checked, and only a legal edge
//! is written (status update + an appended `run_transitions` row). An
//! illegal edge returns an error and leaves no trace — the transaction rolls
//! back on drop without ever writing.
//!
//! `depth` is always derived by walking the `parent_run_id` chain in the
//! database — it is never accepted as trusted input from a caller.

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::{RunMode, RunStatus};

/// Errors from the Run persistence path.
#[derive(Debug, thiserror::Error)]
pub enum RunError {
    #[error("run {0} not found")]
    NotFound(Uuid),
    #[error("illegal transition from {from:?} to {to:?}")]
    IllegalTransition { from: RunStatus, to: RunStatus },
    #[error("run {0} has a status value outside the known set")]
    CorruptStatus(Uuid),
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
}

/// Parameters to create a new Run. Always created at `RunStatus::Draft`.
pub struct NewRun {
    pub workspace_id: Uuid,
    pub parent_run_id: Option<Uuid>,
    pub objective: String,
    pub mode: RunMode,
    pub wall_limit_secs: Option<i64>,
}

/// Inserts a new Run row at `RunStatus::Draft`. Returns the generated id.
/// An unknown `parent_run_id` surfaces as the foreign key violation wrapped
/// in `RunError::Db`.
pub async fn create(pool: &PgPool, new: NewRun) -> Result<Uuid, RunError> {
    let id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO runs \
         (id, workspace_id, parent_run_id, objective, mode, status, wall_limit_secs) \
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(id)
    .bind(new.workspace_id)
    .bind(new.parent_run_id)
    .bind(&new.objective)
    .bind(new.mode.as_str())
    .bind(RunStatus::Draft.as_str())
    .bind(new.wall_limit_secs)
    .execute(pool)
    .await?;

    Ok(id)
}

/// Validates and applies a Run status transition, appending a
/// `run_transitions` row with the next sequence number. The check and the
/// write happen in one transaction under `SELECT ... FOR UPDATE`; an illegal
/// edge returns `RunError::IllegalTransition` and appends nothing.
pub async fn transition(
    pool: &PgPool,
    run_id: Uuid,
    to: RunStatus,
    reason: &str,
) -> Result<(), RunError> {
    let mut tx = pool.begin().await?;

    let current_str: Option<String> =
        sqlx::query_scalar("SELECT status FROM runs WHERE id = $1 FOR UPDATE")
            .bind(run_id)
            .fetch_optional(&mut *tx)
            .await?;
    let current_str = current_str.ok_or(RunError::NotFound(run_id))?;
    let from = RunStatus::parse(&current_str).ok_or(RunError::CorruptStatus(run_id))?;

    if !from.can_transition_to(to) {
        return Err(RunError::IllegalTransition { from, to });
    }

    let next_seq: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(seq), 0) + 1 FROM run_transitions WHERE run_id = $1",
    )
    .bind(run_id)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO run_transitions (run_id, seq, from_status, to_status, reason) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(run_id)
    .bind(next_seq)
    .bind(from.as_str())
    .bind(to.as_str())
    .bind(reason)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE runs SET status = $1, updated_at = now() WHERE id = $2")
        .bind(to.as_str())
        .bind(run_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

/// Walks the `parent_run_id` chain from `run_id` up to its root, returning
/// the number of hops (a root Run has depth 0). Always derived from the
/// database — never trusted as caller-supplied input.
pub async fn depth(pool: &PgPool, run_id: Uuid) -> Result<i64, RunError> {
    let mut current = run_id;
    let mut depth = 0i64;

    loop {
        let parent: Option<Option<Uuid>> =
            sqlx::query_scalar("SELECT parent_run_id FROM runs WHERE id = $1")
                .bind(current)
                .fetch_optional(pool)
                .await?;

        match parent {
            None => return Err(RunError::NotFound(current)),
            Some(None) => return Ok(depth),
            Some(Some(parent_id)) => {
                current = parent_id;
                depth += 1;
            }
        }
    }
}

/// Records an observed cumulative token total for `run_id`. Tokens are
/// **observed, not enforced** (ADR-002): this never touches `status` and can
/// never pause a Run — only the wall-clock budget does that (see
/// `reconcile::sweep_once`). The stored value is a monotonic max: a total
/// lower than what's already recorded is silently ignored so an
/// out-of-order/duplicate observation can't roll the counter backward.
pub async fn observe_tokens(
    pool: &PgPool,
    run_id: Uuid,
    total: i64,
    observed_at: DateTime<Utc>,
) -> Result<(), RunError> {
    let result = sqlx::query(
        "UPDATE runs \
         SET tokens_observed = GREATEST(tokens_observed, $2), \
             tokens_observed_at = $3, \
             updated_at = now() \
         WHERE id = $1",
    )
    .bind(run_id)
    .bind(total)
    .bind(observed_at)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(RunError::NotFound(run_id));
    }
    Ok(())
}
