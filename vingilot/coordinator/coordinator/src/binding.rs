//! WorktreeBindings, leases, and fencing epochs (ADR-002/003).
//!
//! Every binding carries a monotonic `epoch`, bumped on each lease
//! acquisition. `validate_op` is the per-operation check the executor is
//! expected to call before every broker operation (ADR-003 §Fencing) — it is
//! **fail-closed**: anything short of an affirmative match on run ownership,
//! `ready` lifecycle, current epoch, and an unexpired lease is a denial, and
//! the denial names exactly which check failed.

use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::Access;

/// Errors from the binding/lease mutation path.
#[derive(Debug, thiserror::Error)]
pub enum BindingError {
    #[error("binding {0} not found")]
    NotFound(Uuid),
    #[error("stale epoch: binding {binding_id} is at epoch {current}, presented {presented}")]
    StaleEpoch {
        binding_id: Uuid,
        current: i64,
        presented: i64,
    },
    #[error("run already holds a writable worktree")]
    WritableLimitExceeded,
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
}

/// Names exactly which fail-closed check `validate_op` rejected on.
#[derive(Debug, thiserror::Error)]
pub enum OpDenied {
    #[error("binding {0} not found")]
    NotFound(Uuid),
    #[error("run {run_id} does not own binding {binding_id}")]
    WrongRun { run_id: Uuid, binding_id: Uuid },
    #[error("binding {0} lifecycle is not ready")]
    NotReady(Uuid),
    #[error("stale epoch: binding {binding_id} is at epoch {current}, presented {presented}")]
    StaleEpoch {
        binding_id: Uuid,
        current: i64,
        presented: i64,
    },
    #[error("lease expired for binding {0}")]
    LeaseExpired(Uuid),
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
}

/// A held lease: the epoch it was issued at and when it expires.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Lease {
    pub binding_id: Uuid,
    pub epoch: i64,
    pub expires_at: DateTime<Utc>,
}

/// Idempotently creates a `WorktreeBinding` owned by `run_id`. The binding is
/// created directly at `ready` lifecycle — there is no separate confirmation
/// step at this layer. A repeated call with the same `idempotency_key`
/// returns the same binding id and writes no second row (`INSERT ... ON
/// CONFLICT (idempotency_key) DO NOTHING`, atomic against concurrent
/// callers).
#[allow(clippy::too_many_arguments)]
pub async fn create_binding(
    pool: &PgPool,
    run_id: Uuid,
    repo_id: &str,
    target_id: &str,
    role: &str,
    base_commit: &str,
    branch: Option<&str>,
    idempotency_key: &str,
) -> Result<Uuid, BindingError> {
    let id = Uuid::new_v4();

    let inserted: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO worktree_bindings \
         (id, repo_id, target_id, role, base_commit, branch, lifecycle, owner_run_id, idempotency_key) \
         VALUES ($1, $2, $3, $4, $5, $6, 'ready', $7, $8) \
         ON CONFLICT (idempotency_key) DO NOTHING \
         RETURNING id",
    )
    .bind(id)
    .bind(repo_id)
    .bind(target_id)
    .bind(role)
    .bind(base_commit)
    .bind(branch)
    .bind(run_id)
    .bind(idempotency_key)
    .fetch_optional(pool)
    .await?;

    match inserted {
        Some(id) => Ok(id),
        None => {
            let existing: Uuid =
                sqlx::query_scalar("SELECT id FROM worktree_bindings WHERE idempotency_key = $1")
                    .bind(idempotency_key)
                    .fetch_one(pool)
                    .await?;
            Ok(existing)
        }
    }
}

/// Grants `access` on `binding_id` to `run_id`. A second `Write` grant for a
/// run that already holds one (across any binding) is rejected as
/// `WritableLimitExceeded` — the DB's `one_writable_per_run` partial unique
/// index is the source of truth; this maps its violation to a typed error.
pub async fn grant(
    pool: &PgPool,
    run_id: Uuid,
    binding_id: Uuid,
    access: Access,
) -> Result<(), BindingError> {
    let result = sqlx::query(
        "INSERT INTO run_worktree_grants (run_id, binding_id, access) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (run_id, binding_id) DO UPDATE SET access = EXCLUDED.access",
    )
    .bind(run_id)
    .bind(binding_id)
    .bind(access.as_str())
    .execute(pool)
    .await;

    match result {
        Ok(_) => Ok(()),
        Err(sqlx::Error::Database(db_err))
            if db_err.constraint() == Some("one_writable_per_run") =>
        {
            Err(BindingError::WritableLimitExceeded)
        }
        Err(e) => Err(BindingError::Db(e)),
    }
}

/// Acquires a lease on `binding_id`, bumping its epoch by one. A re-acquire
/// after expiry (or contention) always fences out whatever epoch a previous
/// holder was carrying — presenting the old epoch to `validate_op` after
/// this call is rejected as `StaleEpoch`.
pub async fn acquire_lease(
    pool: &PgPool,
    binding_id: Uuid,
    ttl_secs: i64,
) -> Result<Lease, BindingError> {
    let expires_at = Utc::now() + Duration::seconds(ttl_secs);

    let epoch: Option<i64> = sqlx::query_scalar(
        "UPDATE worktree_bindings \
         SET epoch = epoch + 1, lease_expires_at = $2, updated_at = now() \
         WHERE id = $1 \
         RETURNING epoch",
    )
    .bind(binding_id)
    .bind(expires_at)
    .fetch_optional(pool)
    .await?;

    let epoch = epoch.ok_or(BindingError::NotFound(binding_id))?;

    Ok(Lease {
        binding_id,
        epoch,
        expires_at,
    })
}

/// Renews a held lease, extending `lease_expires_at` without bumping the
/// epoch. The caller must present the epoch it currently holds; a mismatch
/// (another holder has since re-acquired) is rejected as `StaleEpoch` and
/// the lease is left untouched.
pub async fn renew_lease(
    pool: &PgPool,
    binding_id: Uuid,
    epoch: i64,
    ttl_secs: i64,
) -> Result<Lease, BindingError> {
    let mut tx = pool.begin().await?;

    let current_epoch: Option<i64> =
        sqlx::query_scalar("SELECT epoch FROM worktree_bindings WHERE id = $1 FOR UPDATE")
            .bind(binding_id)
            .fetch_optional(&mut *tx)
            .await?;
    let current_epoch = current_epoch.ok_or(BindingError::NotFound(binding_id))?;

    if current_epoch != epoch {
        return Err(BindingError::StaleEpoch {
            binding_id,
            current: current_epoch,
            presented: epoch,
        });
    }

    let expires_at = Utc::now() + Duration::seconds(ttl_secs);

    sqlx::query(
        "UPDATE worktree_bindings SET lease_expires_at = $2, updated_at = now() WHERE id = $1",
    )
    .bind(binding_id)
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Lease {
        binding_id,
        epoch,
        expires_at,
    })
}

/// `(owner_run_id, lifecycle, epoch, lease_expires_at)` — the columns
/// `validate_op` needs from a `worktree_bindings` row.
type BindingFenceRow = (Option<Uuid>, String, i64, Option<DateTime<Utc>>);

/// The per-operation fencing check (ADR-003 §Fencing): fail-closed unless
/// the binding exists, is owned by `run_id`, is at `ready` lifecycle, is at
/// the presented `epoch`, and its lease has not expired. Every failure mode
/// is a distinct `OpDenied` variant naming the exact check that failed — the
/// executor surfaces it, so "denied" is never a mystery.
pub async fn validate_op(
    pool: &PgPool,
    run_id: Uuid,
    binding_id: Uuid,
    epoch: i64,
) -> Result<(), OpDenied> {
    let row: Option<BindingFenceRow> = sqlx::query_as(
        "SELECT owner_run_id, lifecycle, epoch, lease_expires_at \
         FROM worktree_bindings WHERE id = $1",
    )
    .bind(binding_id)
    .fetch_optional(pool)
    .await?;

    let (owner_run_id, lifecycle, current_epoch, lease_expires_at) =
        row.ok_or(OpDenied::NotFound(binding_id))?;

    if owner_run_id != Some(run_id) {
        return Err(OpDenied::WrongRun { run_id, binding_id });
    }

    if lifecycle != "ready" {
        return Err(OpDenied::NotReady(binding_id));
    }

    if current_epoch != epoch {
        return Err(OpDenied::StaleEpoch {
            binding_id,
            current: current_epoch,
            presented: epoch,
        });
    }

    match lease_expires_at {
        Some(expires_at) if expires_at > Utc::now() => Ok(()),
        _ => Err(OpDenied::LeaseExpired(binding_id)),
    }
}
