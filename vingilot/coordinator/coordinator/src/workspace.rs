//! Workspace CAS — the ADR-002 mutation protocol.
//!
//! A mutation is applied inside one coordinator transaction that checks
//! `expected_revision` against the current row. On success the coordinator
//! writes the next revision and appends an audit event. On conflict it
//! rejects and returns the CURRENT revision and state hash so the caller can
//! render conflict/retry UX rather than guessing — the rejection is data,
//! not just a boolean.

use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

/// Errors from the workspace CAS path. `NotFound` is distinct from a stale
/// (rejected) mutation attempt: a stale attempt is a successful call that
/// carries `accepted: false`, not an `Err`.
#[derive(Debug, thiserror::Error)]
pub enum WorkspaceError {
    #[error("workspace {0} not found")]
    NotFound(Uuid),
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
}

/// Result of an `apply_mutations` call. Always carries the resulting
/// revision and state hash, whether the mutation was accepted or rejected
/// as stale — per ADR-002 the rejection is data-carrying, not a bare bool.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MutationOutcome {
    pub accepted: bool,
    pub revision: i64,
    pub state_hash: String,
}

/// SHA-256 hex digest of a state value's canonical JSON encoding. `Value`'s
/// object keys serialize in sorted order (serde_json's default `Map`
/// without the `preserve_order` feature is a `BTreeMap`), so semantically
/// equal states always hash identically regardless of merge order.
pub fn state_hash(state: &Value) -> String {
    let canonical = serde_json::to_vec(state).unwrap_or_default();
    hex::encode(Sha256::digest(&canonical))
}

/// Idempotently creates a workspace row at revision 0 with empty state if
/// one does not already exist.
pub async fn ensure_workspace(pool: &PgPool, workspace_id: Uuid) -> Result<(), WorkspaceError> {
    let empty_state = Value::Object(serde_json::Map::new());
    let hash = state_hash(&empty_state);

    sqlx::query(
        "INSERT INTO workspaces (id, revision, state, state_hash) \
         VALUES ($1, 0, $2, $3) \
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(workspace_id)
    .bind(&empty_state)
    .bind(&hash)
    .execute(pool)
    .await?;

    Ok(())
}

/// Shallow, top-level merge of `patch` into `base` — the `jsonb ||`
/// semantics referenced by ADR-002: matching keys are overwritten, new keys
/// are added, and a non-object patch replaces `base` wholesale.
fn merge_patch(base: &mut Value, patch: &Value) {
    match (base, patch) {
        (Value::Object(base_map), Value::Object(patch_map)) => {
            for (key, value) in patch_map {
                base_map.insert(key.clone(), value.clone());
            }
        }
        (base_slot, other) => {
            *base_slot = other.clone();
        }
    }
}

/// Applies `mutations` (a sequence of JSON merge-patches) to the workspace's
/// state, gated on `expected_revision` matching the workspace's current
/// revision. The whole check-and-write happens in a single transaction: the
/// current row is locked with `SELECT ... FOR UPDATE`, the caller's expected
/// revision is compared against it, and only a match proceeds to the write.
/// A mismatch commits the (no-op) transaction and returns the CURRENT
/// revision and state hash with `accepted: false` — never a bare rejection.
pub async fn apply_mutations(
    pool: &PgPool,
    workspace_id: Uuid,
    expected_revision: i64,
    mutations: &[Value],
) -> Result<MutationOutcome, WorkspaceError> {
    let mut tx = pool.begin().await?;

    let row: Option<(i64, Value, String)> = sqlx::query_as(
        "SELECT revision, state, state_hash FROM workspaces WHERE id = $1 FOR UPDATE",
    )
    .bind(workspace_id)
    .fetch_optional(&mut *tx)
    .await?;

    let (current_revision, current_state, current_hash) =
        row.ok_or(WorkspaceError::NotFound(workspace_id))?;

    if current_revision != expected_revision {
        tx.commit().await?;
        return Ok(MutationOutcome {
            accepted: false,
            revision: current_revision,
            state_hash: current_hash,
        });
    }

    let mut new_state = current_state;
    for patch in mutations {
        merge_patch(&mut new_state, patch);
    }
    let new_revision = current_revision + 1;
    let new_hash = state_hash(&new_state);
    let mutations_json = Value::Array(mutations.to_vec());

    sqlx::query(
        "UPDATE workspaces \
         SET revision = $1, state = $2, state_hash = $3, updated_at = now() \
         WHERE id = $4",
    )
    .bind(new_revision)
    .bind(&new_state)
    .bind(&new_hash)
    .bind(workspace_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO workspace_events \
         (workspace_id, revision, prev_revision, mutations, state_hash) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(workspace_id)
    .bind(new_revision)
    .bind(current_revision)
    .bind(&mutations_json)
    .bind(&new_hash)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(MutationOutcome {
        accepted: true,
        revision: new_revision,
        state_hash: new_hash,
    })
}

#[cfg(test)]
mod tests {
    use super::state_hash;
    use serde_json::json;

    #[test]
    fn hash_is_deterministic() {
        let state = json!({"b": 2, "a": 1, "nested": {"z": true, "y": false}});
        let first = state_hash(&state);
        let second = state_hash(&state.clone());
        assert_eq!(first, second);
    }
}
