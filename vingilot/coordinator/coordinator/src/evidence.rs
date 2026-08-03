//! Run evidence: an append-only, sequenced log of what the executor did
//! (ADR-003 §Evidence, tier-1 app-witnessed). Mirrors `run_transitions`'
//! seq-allocation shape (`MAX(seq)+1` inside a transaction) — the executor
//! appends rows for every side-effecting step, and the desktop Runs screen
//! polls the list endpoint to render them live.

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

/// Content is capped at 64 KiB per row (plan's fixed contract) so one
/// misbehaving command can't blow up a row or the response payload.
pub const MAX_CONTENT_BYTES: usize = 64 * 1024;

/// The four evidence kinds the SQL `CHECK` constraint allows. Kept as a
/// closed Rust enum (matching `RunStatus`/`RunMode`'s idiom in `domain.rs`)
/// so `append` can never write a string outside the constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EvidenceKind {
    Command,
    Output,
    Error,
    Note,
}

impl EvidenceKind {
    /// The exact string stored in `run_evidence.kind` — must match the SQL
    /// `CHECK` constraint verbatim.
    pub fn as_str(self) -> &'static str {
        match self {
            EvidenceKind::Command => "command",
            EvidenceKind::Output => "output",
            EvidenceKind::Error => "error",
            EvidenceKind::Note => "note",
        }
    }

    pub fn parse(s: &str) -> Option<EvidenceKind> {
        match s {
            "command" => Some(EvidenceKind::Command),
            "output" => Some(EvidenceKind::Output),
            "error" => Some(EvidenceKind::Error),
            "note" => Some(EvidenceKind::Note),
            _ => None,
        }
    }
}

/// Errors from the evidence append/list path.
#[derive(Debug, thiserror::Error)]
pub enum EvidenceError {
    #[error("run {0} not found")]
    RunNotFound(Uuid),
    #[error("evidence content is {actual} bytes, exceeding the {max} byte limit")]
    ContentTooLarge { actual: usize, max: usize },
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
}

/// One `run_evidence` row as returned by `list_after`.
#[derive(Debug, Clone)]
pub struct EvidenceRow {
    pub seq: i64,
    pub kind: EvidenceKind,
    pub content: String,
    pub created_at: DateTime<Utc>,
}

/// Appends one evidence row for `run_id`, allocating the next sequence
/// number as `MAX(seq)+1` inside a transaction (mirrors
/// `run::transition`'s `run_transitions` allocation). Rejects oversize
/// content before touching the database. A `run_id` that does not exist
/// surfaces as the foreign key violation wrapped in `EvidenceError::Db` at
/// the `INSERT` — callers on the HTTP path check run existence in the
/// caller (`fetch_run_detail`-style 404) rather than duplicating that
/// lookup here, matching how `run::observe_tokens` reports "no rows
/// affected" instead of pre-checking.
pub async fn append(
    pool: &PgPool,
    run_id: Uuid,
    kind: EvidenceKind,
    content: &str,
) -> Result<i64, EvidenceError> {
    if content.len() > MAX_CONTENT_BYTES {
        return Err(EvidenceError::ContentTooLarge {
            actual: content.len(),
            max: MAX_CONTENT_BYTES,
        });
    }

    let mut tx = pool.begin().await?;

    let run_exists: Option<Uuid> = sqlx::query_scalar("SELECT id FROM runs WHERE id = $1")
        .bind(run_id)
        .fetch_optional(&mut *tx)
        .await?;
    if run_exists.is_none() {
        return Err(EvidenceError::RunNotFound(run_id));
    }

    let next_seq: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(seq), 0) + 1 FROM run_evidence WHERE run_id = $1")
            .bind(run_id)
            .fetch_one(&mut *tx)
            .await?;

    sqlx::query("INSERT INTO run_evidence (run_id, seq, kind, content) VALUES ($1, $2, $3, $4)")
        .bind(run_id)
        .bind(next_seq)
        .bind(kind.as_str())
        .bind(content)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(next_seq)
}

/// Lists evidence rows for `run_id` with `seq > after`, ordered by `seq`
/// (keyset pagination — the desktop poller passes the highest `seq` it has
/// already rendered).
pub async fn list_after(
    pool: &PgPool,
    run_id: Uuid,
    after: i64,
) -> Result<Vec<EvidenceRow>, EvidenceError> {
    let rows: Vec<(i64, String, String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT seq, kind, content, created_at FROM run_evidence \
         WHERE run_id = $1 AND seq > $2 ORDER BY seq",
    )
    .bind(run_id)
    .bind(after)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|(seq, kind, content, created_at)| {
            let kind = EvidenceKind::parse(&kind).ok_or(EvidenceError::Db(sqlx::Error::Decode(
                format!("unknown evidence kind in database: {kind}").into(),
            )))?;
            Ok(EvidenceRow {
                seq,
                kind,
                content,
                created_at,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_round_trips_through_parse_for_every_variant() {
        for &k in &[
            EvidenceKind::Command,
            EvidenceKind::Output,
            EvidenceKind::Error,
            EvidenceKind::Note,
        ] {
            assert_eq!(EvidenceKind::parse(k.as_str()), Some(k));
        }
    }

    #[test]
    fn parse_rejects_unknown_strings() {
        assert_eq!(EvidenceKind::parse("bogus"), None);
        assert_eq!(EvidenceKind::parse(""), None);
    }
}
