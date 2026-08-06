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

    // Entering Running for the FIRST time starts the wall clock — the budget
    // component ADR-002 names as enforceable. COALESCE keeps the original
    // start on resume, so pausing cannot be used to stretch the budget.
    // (Audit finding: before this, nothing in production ever wrote
    // `wall_started_at`, so the wall-clock sweep could never fire.)
    if to == RunStatus::Running {
        sqlx::query(
            "UPDATE runs SET status = $1, updated_at = now(), \
             wall_started_at = COALESCE(wall_started_at, now()) WHERE id = $2",
        )
        .bind(to.as_str())
        .bind(run_id)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query("UPDATE runs SET status = $1, updated_at = now() WHERE id = $2")
            .bind(to.as_str())
            .bind(run_id)
            .execute(&mut *tx)
            .await?;
    }

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

/// A single row of the workspace's run list read-model (`GET
/// /v1/workspaces/{id}/runs`) — the fields the plan's `RunSummary` names.
pub struct RunSummaryRow {
    pub id: Uuid,
    pub parent_run_id: Option<Uuid>,
    pub objective: String,
    pub mode: String,
    pub status: String,
    pub wall_limit_secs: Option<i64>,
    pub wall_started_at: Option<DateTime<Utc>>,
    pub tokens_observed: i64,
    pub tokens_observed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Lists a workspace's Runs newest-first (`updated_at DESC`), capped at 200
/// rows — the row backing the rail's NEEDS YOU/LIVE/RECENT groupings.
pub async fn list_for_workspace(
    pool: &PgPool,
    workspace_id: Uuid,
) -> Result<Vec<RunSummaryRow>, RunError> {
    #[allow(clippy::type_complexity)]
    let rows: Vec<(
        Uuid,
        Option<Uuid>,
        String,
        String,
        String,
        Option<i64>,
        Option<DateTime<Utc>>,
        i64,
        Option<DateTime<Utc>>,
        DateTime<Utc>,
        DateTime<Utc>,
    )> = sqlx::query_as(
        "SELECT id, parent_run_id, objective, mode, status, \
                wall_limit_secs, wall_started_at, tokens_observed, tokens_observed_at, \
                created_at, updated_at \
         FROM runs WHERE workspace_id = $1 \
         ORDER BY updated_at DESC LIMIT 200",
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(
                id,
                parent_run_id,
                objective,
                mode,
                status,
                wall_limit_secs,
                wall_started_at,
                tokens_observed,
                tokens_observed_at,
                created_at,
                updated_at,
            )| RunSummaryRow {
                id,
                parent_run_id,
                objective,
                mode,
                status,
                wall_limit_secs,
                wall_started_at,
                tokens_observed,
                tokens_observed_at,
                created_at,
                updated_at,
            },
        )
        .collect())
}

/// One row of the workspace's worktree list read-model (`GET
/// /v1/workspaces/{id}/worktrees`) — a `worktree_bindings` row joined to its
/// owner run's live status/objective, plus the latest diff/commit evidence
/// for that run. `owner_run_*` and `added`/`removed`/`commit_sha` are `None`
/// when the binding has no owner run or the owner run has not yet produced
/// that evidence — never coerced to a zero/empty placeholder.
pub struct WorktreeSummaryRow {
    pub binding_id: Uuid,
    pub repo_id: String,
    pub branch: Option<String>,
    pub role: String,
    pub lifecycle: String,
    pub base_commit: String,
    pub owner_run_id: Option<Uuid>,
    pub owner_run_status: Option<String>,
    pub owner_run_objective: Option<String>,
    pub added: Option<i64>,
    pub removed: Option<i64>,
    pub commit_sha: Option<String>,
}

/// Counts added/removed lines in a unified diff body: a line starting with
/// `+`/`-` counts, except the `+++`/`---` file-header lines unified diff
/// always emits. Pure and unit-tested below — the HTTP layer never re-derives
/// this by hand.
fn count_diff_lines(diff: &str) -> (i64, i64) {
    let mut added = 0i64;
    let mut removed = 0i64;
    for line in diff.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            added += 1;
        } else if line.starts_with('-') {
            removed += 1;
        }
    }
    (added, removed)
}

/// The commit sha is the first whitespace-separated token of a `commit`
/// evidence row's content (the executor writes `"{sha} {commit_message}"` —
/// see `vingilot-executor`'s capture step). `None` for empty content.
fn commit_sha_from_content(content: &str) -> Option<String> {
    content.split_whitespace().next().map(str::to_string)
}

/// Lists every `worktree_bindings` row visible to `workspace_id`: bindings
/// owned by a Run that belongs to this workspace, plus any binding with no
/// owner run at all (a `main`/primary checkout is not scoped to a workspace
/// by the schema — `owner_run_id` is nullable and there is no
/// `worktree_bindings.workspace_id` column — so an ownerless binding cannot
/// be excluded without inventing a workspace it doesn't actually belong to;
/// it is surfaced everywhere instead of silently dropped, matching the "a
/// worktree with no owner run still appears" contract). One query: a
/// `LEFT JOIN` to `runs` for the owner's live state, plus a `LEFT JOIN
/// LATERAL` per evidence kind for the latest `diff`/`commit` row.
pub async fn list_worktrees_for_workspace(
    pool: &PgPool,
    workspace_id: Uuid,
) -> Result<Vec<WorktreeSummaryRow>, RunError> {
    #[allow(clippy::type_complexity)]
    let rows: Vec<(
        Uuid,
        String,
        Option<String>,
        String,
        String,
        String,
        Option<Uuid>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT b.id, b.repo_id, b.branch, b.role, b.lifecycle, b.base_commit, \
                b.owner_run_id, r.status, r.objective, \
                diff_ev.content, commit_ev.content \
         FROM worktree_bindings b \
         LEFT JOIN runs r ON r.id = b.owner_run_id \
         LEFT JOIN LATERAL ( \
             SELECT content FROM run_evidence \
             WHERE run_id = b.owner_run_id AND kind = 'diff' \
             ORDER BY seq DESC LIMIT 1 \
         ) diff_ev ON b.owner_run_id IS NOT NULL \
         LEFT JOIN LATERAL ( \
             SELECT content FROM run_evidence \
             WHERE run_id = b.owner_run_id AND kind = 'commit' \
             ORDER BY seq DESC LIMIT 1 \
         ) commit_ev ON b.owner_run_id IS NOT NULL \
         WHERE r.workspace_id = $1 OR b.owner_run_id IS NULL \
         ORDER BY b.created_at",
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(
                binding_id,
                repo_id,
                branch,
                role,
                lifecycle,
                base_commit,
                owner_run_id,
                owner_run_status,
                owner_run_objective,
                diff_content,
                commit_content,
            )| {
                let (added, removed) = match diff_content {
                    Some(content) => {
                        let (a, r) = count_diff_lines(&content);
                        (Some(a), Some(r))
                    }
                    None => (None, None),
                };
                let commit_sha = commit_content.and_then(|c| commit_sha_from_content(&c));
                WorktreeSummaryRow {
                    binding_id,
                    repo_id,
                    branch,
                    role,
                    lifecycle,
                    base_commit,
                    owner_run_id,
                    owner_run_status,
                    owner_run_objective,
                    added,
                    removed,
                    commit_sha,
                }
            },
        )
        .collect())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn count_diff_lines_ignores_file_header_but_counts_content_lines() {
        let diff = "--- a/x\n+++ b/x\n+one\n+two\n+three\n-old one\n-old two\n";
        assert_eq!(count_diff_lines(diff), (3, 2));
    }

    #[test]
    fn count_diff_lines_on_empty_diff_is_zero_zero() {
        assert_eq!(count_diff_lines(""), (0, 0));
    }

    #[test]
    fn commit_sha_from_content_takes_the_first_token() {
        assert_eq!(
            commit_sha_from_content("75269de latest commit message"),
            Some("75269de".to_string())
        );
    }

    #[test]
    fn commit_sha_from_content_is_none_for_empty_string() {
        assert_eq!(commit_sha_from_content(""), None);
        assert_eq!(commit_sha_from_content("   "), None);
    }
}
