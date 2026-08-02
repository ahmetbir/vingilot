//! Provisioning saga (ADR-002 §5.3): idempotent forward, compensating
//! backward.
//!
//! `provision` drives a Run from `Draft` through `Provisioning` to `Ready`,
//! creating (or reusing) each requested worktree binding, granting the Run
//! access, and acquiring a lease on it. Every step is idempotent — running
//! the same spec twice, or resuming after a crash mid-way, converges on the
//! same end state without creating duplicate bindings or double-appending
//! transitions:
//!
//! - `binding::create_binding` dedupes on `idempotency_key`.
//! - `grant` is an upsert.
//! - a lease is only (re-)acquired if none is currently active, so retries
//!   don't needlessly fence out an in-flight holder.
//! - the `Draft -> Provisioning` and `Provisioning -> Ready` transitions are
//!   only attempted from the status they apply to; a Run already at `Ready`
//!   is treated as already converged and `provision` returns `Ok(())`.
//!
//! If any worktree step fails irrecoverably (most notably: the presented
//! `idempotency_key` already belongs to a binding owned by a DIFFERENT run),
//! `provision` calls `compensate` itself before returning the error: every
//! binding THIS run created is walked back to a non-editable lifecycle
//! (`provisioning -> removed`, `ready -> quarantined`), its grants are
//! revoked, and the run is transitioned to `Failed`. No binding this run
//! touched is left both owned by it and in an editable (`ready`) state.

use sqlx::PgPool;
use uuid::Uuid;

use crate::binding::{self, BindingError};
use crate::domain::{Access, RunStatus};
use crate::run::{self, RunError};

/// A single worktree to provision as part of a Run.
pub struct WorktreeSpec {
    pub repo_id: String,
    pub target_id: String,
    pub role: String,
    pub base_commit: String,
    pub branch: Option<String>,
    pub access: Access,
    pub idempotency_key: String,
}

/// The full provisioning request for a Run.
pub struct ProvisionSpec {
    pub run_id: Uuid,
    pub worktrees: Vec<WorktreeSpec>,
}

/// Errors from the provisioning saga.
#[derive(Debug, thiserror::Error)]
pub enum SagaError {
    #[error("run {0} not found")]
    RunNotFound(Uuid),
    #[error("run {0} has a status value outside the known set")]
    CorruptStatus(Uuid),
    #[error("run {run_id} is at status {status:?}, which is not valid to (re-)provision")]
    UnexpectedStatus { run_id: Uuid, status: RunStatus },
    #[error("idempotency key {key} is already bound to a different run than {run_id}")]
    WorktreeOwnedByAnotherRun { run_id: Uuid, key: String },
    #[error(transparent)]
    Run(#[from] RunError),
    #[error(transparent)]
    Binding(#[from] BindingError),
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
}

/// Default TTL for the lease acquired on each worktree a saga provisions.
/// Not part of `WorktreeSpec` (the interface doesn't carry one) — the
/// executor is expected to `renew_lease` as it goes; this is just the
/// initial grant.
const PROVISION_LEASE_TTL_SECS: i64 = 3600;

async fn current_run_status(pool: &PgPool, run_id: Uuid) -> Result<RunStatus, SagaError> {
    let status_str: Option<String> = sqlx::query_scalar("SELECT status FROM runs WHERE id = $1")
        .bind(run_id)
        .fetch_optional(pool)
        .await?;
    let status_str = status_str.ok_or(SagaError::RunNotFound(run_id))?;
    RunStatus::parse(&status_str).ok_or(SagaError::CorruptStatus(run_id))
}

async fn binding_owner(pool: &PgPool, binding_id: Uuid) -> Result<Option<Uuid>, SagaError> {
    let owner: Option<Uuid> =
        sqlx::query_scalar("SELECT owner_run_id FROM worktree_bindings WHERE id = $1")
            .bind(binding_id)
            .fetch_one(pool)
            .await?;
    Ok(owner)
}

/// Acquires a lease on `binding_id` only if it does not already hold one
/// that is still active — makes lease acquisition idempotent across saga
/// retries (an unconditional `acquire_lease` would bump the fencing epoch,
/// and thus fence out an in-flight holder, on every no-op retry).
async fn ensure_lease(pool: &PgPool, binding_id: Uuid) -> Result<(), SagaError> {
    let has_active: Option<bool> =
        sqlx::query_scalar("SELECT lease_expires_at > now() FROM worktree_bindings WHERE id = $1")
            .bind(binding_id)
            .fetch_one(pool)
            .await?;

    if has_active != Some(true) {
        binding::acquire_lease(pool, binding_id, PROVISION_LEASE_TTL_SECS).await?;
    }
    Ok(())
}

async fn provision_worktrees(pool: &PgPool, spec: &ProvisionSpec) -> Result<(), SagaError> {
    for wt in &spec.worktrees {
        let binding_id = binding::create_binding(
            pool,
            spec.run_id,
            &wt.repo_id,
            &wt.target_id,
            &wt.role,
            &wt.base_commit,
            wt.branch.as_deref(),
            &wt.idempotency_key,
        )
        .await?;

        let owner = binding_owner(pool, binding_id).await?;
        if owner != Some(spec.run_id) {
            return Err(SagaError::WorktreeOwnedByAnotherRun {
                run_id: spec.run_id,
                key: wt.idempotency_key.clone(),
            });
        }

        binding::grant(pool, spec.run_id, binding_id, wt.access).await?;
        ensure_lease(pool, binding_id).await?;
    }
    Ok(())
}

/// Drives `spec.run_id` from `Draft` (or resumes from `Provisioning`) to
/// `Ready`, provisioning every requested worktree along the way. Idempotent:
/// safe to call repeatedly with the same spec, including after a crash
/// mid-way. On an irrecoverable failure, compensates before returning the
/// error (see module docs).
pub async fn provision(pool: &PgPool, spec: &ProvisionSpec) -> Result<(), SagaError> {
    let run_id = spec.run_id;
    let status = current_run_status(pool, run_id).await?;

    match status {
        RunStatus::Ready => return Ok(()),
        RunStatus::Draft => {
            run::transition(
                pool,
                run_id,
                RunStatus::Provisioning,
                "provisioning started",
            )
            .await?;
        }
        RunStatus::Provisioning => {}
        other => {
            return Err(SagaError::UnexpectedStatus {
                run_id,
                status: other,
            })
        }
    }

    if let Err(err) = provision_worktrees(pool, spec).await {
        compensate(pool, run_id).await?;
        return Err(err);
    }

    run::transition(pool, run_id, RunStatus::Ready, "provisioning complete").await?;
    Ok(())
}

/// Compensates a failed (or abandoned) provisioning attempt for `run_id`:
/// every worktree binding this run owns is walked back to a non-editable
/// lifecycle (`provisioning -> removed`, `ready -> quarantined`; any other
/// lifecycle is left as-is), its grants are revoked, and the run is
/// transitioned to `Failed`. Idempotent: a run already at `Failed` is left
/// untouched by the status transition.
pub async fn compensate(pool: &PgPool, run_id: Uuid) -> Result<(), SagaError> {
    sqlx::query("DELETE FROM run_worktree_grants WHERE run_id = $1")
        .bind(run_id)
        .execute(pool)
        .await?;

    let bindings: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id, lifecycle FROM worktree_bindings WHERE owner_run_id = $1")
            .bind(run_id)
            .fetch_all(pool)
            .await?;

    for (binding_id, lifecycle) in bindings {
        let next_lifecycle = match lifecycle.as_str() {
            "provisioning" => "removed",
            "ready" => "quarantined",
            other => other,
        };
        sqlx::query(
            "UPDATE worktree_bindings SET lifecycle = $2, updated_at = now() WHERE id = $1",
        )
        .bind(binding_id)
        .bind(next_lifecycle)
        .execute(pool)
        .await?;
    }

    let status = current_run_status(pool, run_id).await?;
    if status != RunStatus::Failed {
        run::transition(
            pool,
            run_id,
            RunStatus::Failed,
            "provisioning saga compensated",
        )
        .await?;
    }

    Ok(())
}
