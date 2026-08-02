//! The reconciler: a periodic sweep that repairs state a Run or binding
//! cannot repair itself from (ADR-002 §Reconciliation).
//!
//! Two independent passes, run in sequence:
//!
//! 1. **Lease-expiry (partition rule):** a `ready` binding owned by a
//!    `running` Run whose lease has expired means the executor holding it
//!    may be partitioned from the coordinator. The binding is quarantined
//!    (no longer editable) and the Run is paused (`"lease lost"`) so a human
//!    or a later saga step decides how to proceed.
//! 2. **Wall-clock budget (the ENFORCEABLE budget component):** a `running`
//!    Run whose `wall_started_at + wall_limit_secs` has elapsed is paused
//!    (`"wall clock budget exhausted"`).
//!
//! Token totals are observed only (`run::observe_tokens`) and never drive a
//! pause here or anywhere else — ADR-002's enforce-vs-observe distinction.
//!
//! `run_reconciler` is a thin `tokio::time::interval` wrapper; all the logic
//! lives in the testable `sweep_once`.

use sqlx::PgPool;
use std::collections::HashSet;
use std::time::Duration;
use uuid::Uuid;

use crate::domain::RunStatus;
use crate::run::{self, RunError};

/// Errors from a reconciler sweep.
#[derive(Debug, thiserror::Error)]
pub enum ReconcileError {
    #[error(transparent)]
    Run(#[from] RunError),
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
}

/// Counts from a single `sweep_once` pass. `runs_paused` is the total number
/// of Run→Paused transitions applied across BOTH mechanisms; `runs_wall_exceeded`
/// is the subset of those attributable specifically to the wall-clock budget.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SweepReport {
    pub leases_expired: u32,
    pub runs_paused: u32,
    pub bindings_quarantined: u32,
    pub runs_wall_exceeded: u32,
}

/// A `ready` binding, owned by a `running` Run, whose lease has expired.
type ExpiredLeaseRow = (Uuid, Uuid);

/// Pauses `run_id` for `reason` if (and only if) it hasn't already been
/// paused earlier in this same sweep — a Run can own more than one expired
/// binding, and re-pausing an already-`Paused` run is an illegal edge, not a
/// no-op, at the domain layer.
async fn pause_once(
    pool: &PgPool,
    run_id: Uuid,
    reason: &str,
    already_paused: &mut HashSet<Uuid>,
) -> Result<bool, ReconcileError> {
    if !already_paused.insert(run_id) {
        return Ok(false);
    }
    run::transition(pool, run_id, RunStatus::Paused, reason).await?;
    Ok(true)
}

async fn sweep_expired_leases(
    pool: &PgPool,
    report: &mut SweepReport,
) -> Result<(), ReconcileError> {
    let expired: Vec<ExpiredLeaseRow> = sqlx::query_as(
        "SELECT b.id, b.owner_run_id FROM worktree_bindings b \
         JOIN runs r ON r.id = b.owner_run_id \
         WHERE b.lifecycle = 'ready' \
           AND b.lease_expires_at IS NOT NULL \
           AND b.lease_expires_at < now() \
           AND r.status = 'running'",
    )
    .fetch_all(pool)
    .await?;

    let mut paused_this_pass = HashSet::new();

    for (binding_id, run_id) in expired {
        report.leases_expired += 1;

        let quarantined = sqlx::query(
            "UPDATE worktree_bindings SET lifecycle = 'quarantined', updated_at = now() \
             WHERE id = $1 AND lifecycle = 'ready'",
        )
        .bind(binding_id)
        .execute(pool)
        .await?;
        if quarantined.rows_affected() > 0 {
            report.bindings_quarantined += 1;
        }

        if pause_once(pool, run_id, "lease lost", &mut paused_this_pass).await? {
            report.runs_paused += 1;
        }
    }

    Ok(())
}

async fn sweep_wall_clock(pool: &PgPool, report: &mut SweepReport) -> Result<(), ReconcileError> {
    let exhausted: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM runs \
         WHERE status = 'running' \
           AND wall_limit_secs IS NOT NULL \
           AND wall_started_at IS NOT NULL \
           AND wall_started_at + (wall_limit_secs * interval '1 second') < now()",
    )
    .fetch_all(pool)
    .await?;

    let mut paused_this_pass = HashSet::new();

    for run_id in exhausted {
        report.runs_wall_exceeded += 1;
        if pause_once(
            pool,
            run_id,
            "wall clock budget exhausted",
            &mut paused_this_pass,
        )
        .await?
        {
            report.runs_paused += 1;
        }
    }

    Ok(())
}

/// Runs one reconciliation sweep: expired-lease partition handling, then
/// wall-clock budget enforcement. Safe to call repeatedly and concurrently
/// with normal operation — every write is guarded by a `WHERE` clause that
/// only flips rows still in the state being swept.
pub async fn sweep_once(pool: &PgPool) -> Result<SweepReport, ReconcileError> {
    let mut report = SweepReport::default();
    sweep_expired_leases(pool, &mut report).await?;
    sweep_wall_clock(pool, &mut report).await?;
    Ok(report)
}

/// Calls `sweep_once` every `period`, logging (not panicking on) sweep
/// failures so one bad tick doesn't kill the reconciler loop.
pub async fn run_reconciler(pool: PgPool, period: Duration) {
    let mut interval = tokio::time::interval(period);
    loop {
        interval.tick().await;
        if let Err(err) = sweep_once(&pool).await {
            tracing::error!("reconciler sweep failed: {err}");
        }
    }
}
