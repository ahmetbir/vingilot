//! The ADR-002 mutation protocol on the wire (Task 8).
//!
//! Every handler is thin: parse the request, call the already-tested module
//! function, map its error to an HTTP status and a machine-readable error
//! code. No transition/CAS/fencing logic is duplicated here — it all lives
//! in `workspace`, `run`, `binding`, and `saga`.
//!
//! Auth (V1 single-owner dev, per the plan): a static bearer token compared
//! in constant time. There is no auth-less mode — [`auth_token_from_env`]
//! is the fail-closed gate `main` calls before the server is allowed to
//! bind a socket at all.

use axum::extract::{Path, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::binding::{self, BindingError, OpDenied};
use crate::domain::{Access, RunMode, RunStatus};
use crate::run::{self, NewRun, RunError};
use crate::saga::{self, ProvisionSpec, SagaError, WorktreeSpec};
use crate::workspace::{self, WorkspaceError};

// ---------------------------------------------------------------------
// Boot-time auth gate
// ---------------------------------------------------------------------

/// The server refuses to start without a usable auth token — there is no
/// auth-less mode to forget about (plan §Task 8).
#[derive(Debug, thiserror::Error)]
pub enum HttpBootError {
    #[error(
        "COORD_AUTH_TOKEN must be set to a non-empty value; refusing to start without an auth token"
    )]
    MissingAuthToken,
}

/// Pure validation of a candidate auth token: present and non-empty, or a
/// `MissingAuthToken` refusal. Kept separate from env access so the boot
/// refusal is unit-testable without mutating process-global state.
pub fn require_auth_token(raw: Option<String>) -> Result<String, HttpBootError> {
    match raw {
        Some(token) if !token.is_empty() => Ok(token),
        _ => Err(HttpBootError::MissingAuthToken),
    }
}

/// Reads `COORD_AUTH_TOKEN` from the environment and validates it via
/// [`require_auth_token`]. `main` calls this before connecting to the
/// database or binding a listener.
pub fn auth_token_from_env() -> Result<String, HttpBootError> {
    require_auth_token(std::env::var("COORD_AUTH_TOKEN").ok())
}

// ---------------------------------------------------------------------
// App state + router
// ---------------------------------------------------------------------

#[derive(Clone)]
struct AppState {
    pool: PgPool,
    auth_token: String,
}

/// Builds the full axum app: every `/v1/...` route from the plan's
/// interface table, behind a constant-time bearer-token check.
pub fn router(pool: PgPool, auth_token: String) -> Router {
    let state = AppState { pool, auth_token };

    Router::new()
        .route("/v1/workspaces/{id}/mutations", post(post_mutations))
        .route("/v1/workspaces/{id}", get(get_workspace))
        .route("/v1/workspaces/{id}/runs", get(get_workspace_runs))
        .route("/v1/runs", post(post_create_run))
        .route("/v1/runs/{id}", get(get_run))
        .route("/v1/runs/{id}/transition", post(post_transition))
        .route("/v1/runs/{id}/tokens", post(post_tokens))
        .route("/v1/runs/{id}/provision", post(post_provision))
        .route("/v1/bindings/{id}/validate-op", post(post_validate_op))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            require_bearer,
        ))
        .with_state(state)
}

/// Compares presented bytes against the configured token without an early
/// exit driven by byte content (only the length check short-circuits,
/// which does not leak the token itself).
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

async fn require_bearer(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let presented = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    match presented {
        Some(token) if constant_time_eq(token.as_bytes(), state.auth_token.as_bytes()) => {
            next.run(req).await
        }
        _ => ApiError::new(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "missing or invalid bearer token",
        )
        .into_response(),
    }
}

// ---------------------------------------------------------------------
// Error mapping — { "error": <machine>, "detail": <human> }
// ---------------------------------------------------------------------

#[derive(Debug, Serialize)]
struct ErrorBody {
    error: String,
    detail: String,
}

struct ApiError {
    status: StatusCode,
    error: &'static str,
    detail: String,
}

impl ApiError {
    fn new(status: StatusCode, error: &'static str, detail: impl Into<String>) -> Self {
        Self {
            status,
            error,
            detail: detail.into(),
        }
    }

    fn bad_request(detail: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "bad_request", detail)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorBody {
                error: self.error.to_string(),
                detail: self.detail,
            }),
        )
            .into_response()
    }
}

impl From<WorkspaceError> for ApiError {
    fn from(err: WorkspaceError) -> Self {
        match &err {
            WorkspaceError::NotFound(_) => ApiError::new(
                StatusCode::NOT_FOUND,
                "workspace_not_found",
                err.to_string(),
            ),
            WorkspaceError::Db(_) => ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                err.to_string(),
            ),
        }
    }
}

impl From<RunError> for ApiError {
    fn from(err: RunError) -> Self {
        match &err {
            RunError::NotFound(_) => {
                ApiError::new(StatusCode::NOT_FOUND, "run_not_found", err.to_string())
            }
            RunError::IllegalTransition { .. } => {
                ApiError::new(StatusCode::CONFLICT, "illegal_transition", err.to_string())
            }
            RunError::CorruptStatus(_) => ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "corrupt_status",
                err.to_string(),
            ),
            RunError::Db(_) => ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                err.to_string(),
            ),
        }
    }
}

impl From<OpDenied> for ApiError {
    fn from(err: OpDenied) -> Self {
        let (status, code) = match &err {
            OpDenied::NotFound(_) => (StatusCode::FORBIDDEN, "binding_not_found"),
            OpDenied::WrongRun { .. } => (StatusCode::FORBIDDEN, "wrong_run"),
            OpDenied::NotReady(_) => (StatusCode::FORBIDDEN, "not_ready"),
            OpDenied::StaleEpoch { .. } => (StatusCode::FORBIDDEN, "stale_epoch"),
            OpDenied::LeaseExpired(_) => (StatusCode::FORBIDDEN, "lease_expired"),
            OpDenied::Db(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal_error"),
        };
        ApiError::new(status, code, err.to_string())
    }
}

impl From<BindingError> for ApiError {
    fn from(err: BindingError) -> Self {
        match &err {
            BindingError::NotFound(_) => {
                ApiError::new(StatusCode::NOT_FOUND, "binding_not_found", err.to_string())
            }
            BindingError::StaleEpoch { .. } => {
                ApiError::new(StatusCode::CONFLICT, "stale_epoch", err.to_string())
            }
            BindingError::WritableLimitExceeded => ApiError::new(
                StatusCode::CONFLICT,
                "writable_limit_exceeded",
                err.to_string(),
            ),
            BindingError::Db(_) => ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                err.to_string(),
            ),
        }
    }
}

impl From<SagaError> for ApiError {
    fn from(err: SagaError) -> Self {
        match err {
            SagaError::RunNotFound(id) => ApiError::new(
                StatusCode::NOT_FOUND,
                "run_not_found",
                format!("run {id} not found"),
            ),
            SagaError::CorruptStatus(id) => ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "corrupt_status",
                format!("run {id} has a status value outside the known set"),
            ),
            SagaError::UnexpectedStatus { run_id, status } => ApiError::new(
                StatusCode::CONFLICT,
                "unexpected_status",
                format!(
                    "run {run_id} is at status {status:?}, which is not valid to (re-)provision"
                ),
            ),
            SagaError::WorktreeOwnedByAnotherRun { run_id, key } => ApiError::new(
                StatusCode::CONFLICT,
                "worktree_owned_by_another_run",
                format!("idempotency key {key} is already bound to a different run than {run_id}"),
            ),
            SagaError::Run(inner) => ApiError::from(inner),
            SagaError::Binding(inner) => ApiError::from(inner),
            SagaError::Db(e) => ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                e.to_string(),
            ),
        }
    }
}

// ---------------------------------------------------------------------
// Request / response DTOs
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct MutationsRequestDto {
    expected_revision: i64,
    mutations: Vec<Value>,
}

#[derive(Debug, Serialize)]
struct MutationsResponseDto {
    accepted: bool,
    revision: i64,
    state_hash: String,
}

#[derive(Debug, Serialize)]
struct WorkspaceSnapshotDto {
    revision: i64,
    state_hash: String,
    state: Value,
}

#[derive(Debug, Deserialize)]
struct CreateRunRequestDto {
    workspace_id: Uuid,
    parent_run_id: Option<Uuid>,
    objective: String,
    mode: String,
    wall_limit_secs: Option<i64>,
}

#[derive(Debug, Serialize)]
struct RunSummaryDto {
    id: Uuid,
    parent_run_id: Option<Uuid>,
    objective: String,
    mode: String,
    status: String,
    wall_limit_secs: Option<i64>,
    wall_started_at: Option<DateTime<Utc>>,
    tokens_observed: i64,
    tokens_observed_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<run::RunSummaryRow> for RunSummaryDto {
    fn from(row: run::RunSummaryRow) -> Self {
        Self {
            id: row.id,
            parent_run_id: row.parent_run_id,
            objective: row.objective,
            mode: row.mode,
            status: row.status,
            wall_limit_secs: row.wall_limit_secs,
            wall_started_at: row.wall_started_at,
            tokens_observed: row.tokens_observed,
            tokens_observed_at: row.tokens_observed_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
struct RunListDto {
    runs: Vec<RunSummaryDto>,
}

#[derive(Debug, Serialize)]
struct CreateRunResponseDto {
    run_id: Uuid,
}

#[derive(Debug, Serialize)]
struct GrantDto {
    binding_id: Uuid,
    access: String,
}

#[derive(Debug, Serialize)]
struct TransitionRowDto {
    seq: i64,
    from_status: String,
    to_status: String,
    reason: String,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
struct RunDetailDto {
    id: Uuid,
    workspace_id: Uuid,
    parent_run_id: Option<Uuid>,
    objective: String,
    mode: String,
    status: String,
    wall_limit_secs: Option<i64>,
    wall_started_at: Option<DateTime<Utc>>,
    tokens_observed: i64,
    tokens_observed_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    grants: Vec<GrantDto>,
    transitions: Vec<TransitionRowDto>,
}

#[derive(Debug, Deserialize)]
struct TransitionRequestDto {
    to: String,
    reason: String,
}

#[derive(Debug, Deserialize)]
struct TokensRequestDto {
    total: i64,
    observed_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
struct ValidateOpRequestDto {
    run_id: Uuid,
    epoch: i64,
}

#[derive(Debug, Deserialize)]
struct WorktreeSpecDto {
    repo_id: String,
    target_id: String,
    role: String,
    base_commit: String,
    branch: Option<String>,
    access: String,
    idempotency_key: String,
}

#[derive(Debug, Deserialize)]
struct ProvisionRequestDto {
    worktrees: Vec<WorktreeSpecDto>,
}

// ---------------------------------------------------------------------
// Read-model queries backing the two GET endpoints. Straight-line SELECTs
// only — no domain decision-making, so these live here rather than in
// `workspace`/`run` (which own the mutation-side invariants).
// ---------------------------------------------------------------------

async fn fetch_workspace_snapshot(
    pool: &PgPool,
    workspace_id: Uuid,
) -> Result<WorkspaceSnapshotDto, WorkspaceError> {
    let row: Option<(i64, Value, String)> =
        sqlx::query_as("SELECT revision, state, state_hash FROM workspaces WHERE id = $1")
            .bind(workspace_id)
            .fetch_optional(pool)
            .await?;

    let (revision, state, state_hash) = row.ok_or(WorkspaceError::NotFound(workspace_id))?;
    Ok(WorkspaceSnapshotDto {
        revision,
        state_hash,
        state,
    })
}

#[allow(clippy::type_complexity)]
type RunRow = (
    Uuid,
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
);

async fn fetch_run_detail(pool: &PgPool, run_id: Uuid) -> Result<RunDetailDto, RunError> {
    let row: Option<RunRow> = sqlx::query_as(
        "SELECT id, workspace_id, parent_run_id, objective, mode, status, \
                wall_limit_secs, wall_started_at, tokens_observed, tokens_observed_at, \
                created_at, updated_at \
         FROM runs WHERE id = $1",
    )
    .bind(run_id)
    .fetch_optional(pool)
    .await?;

    let (
        id,
        workspace_id,
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
    ) = row.ok_or(RunError::NotFound(run_id))?;

    let grants: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT binding_id, access FROM run_worktree_grants WHERE run_id = $1")
            .bind(run_id)
            .fetch_all(pool)
            .await?;

    let transitions: Vec<(i64, String, String, String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT seq, from_status, to_status, reason, created_at \
         FROM run_transitions WHERE run_id = $1 ORDER BY seq",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;

    Ok(RunDetailDto {
        id,
        workspace_id,
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
        grants: grants
            .into_iter()
            .map(|(binding_id, access)| GrantDto { binding_id, access })
            .collect(),
        transitions: transitions
            .into_iter()
            .map(
                |(seq, from_status, to_status, reason, created_at)| TransitionRowDto {
                    seq,
                    from_status,
                    to_status,
                    reason,
                    created_at,
                },
            )
            .collect(),
    })
}

// ---------------------------------------------------------------------
// Handlers — parse, call the module fn, map the error. Nothing else.
// ---------------------------------------------------------------------

async fn post_mutations(
    State(state): State<AppState>,
    Path(workspace_id): Path<Uuid>,
    Json(body): Json<MutationsRequestDto>,
) -> Result<Response, ApiError> {
    let outcome = workspace::apply_mutations(
        &state.pool,
        workspace_id,
        body.expected_revision,
        &body.mutations,
    )
    .await?;

    let status = if outcome.accepted {
        StatusCode::OK
    } else {
        StatusCode::CONFLICT
    };
    let dto = MutationsResponseDto {
        accepted: outcome.accepted,
        revision: outcome.revision,
        state_hash: outcome.state_hash,
    };
    Ok((status, Json(dto)).into_response())
}

async fn get_workspace(
    State(state): State<AppState>,
    Path(workspace_id): Path<Uuid>,
) -> Result<Json<WorkspaceSnapshotDto>, ApiError> {
    Ok(Json(
        fetch_workspace_snapshot(&state.pool, workspace_id).await?,
    ))
}

async fn get_workspace_runs(
    State(state): State<AppState>,
    Path(workspace_id): Path<Uuid>,
) -> Result<Json<RunListDto>, ApiError> {
    let rows = run::list_for_workspace(&state.pool, workspace_id).await?;
    Ok(Json(RunListDto {
        runs: rows.into_iter().map(RunSummaryDto::from).collect(),
    }))
}

async fn post_create_run(
    State(state): State<AppState>,
    Json(body): Json<CreateRunRequestDto>,
) -> Result<Response, ApiError> {
    let mode = RunMode::parse(&body.mode)
        .ok_or_else(|| ApiError::bad_request(format!("unknown run mode: {}", body.mode)))?;

    let run_id = run::create(
        &state.pool,
        NewRun {
            workspace_id: body.workspace_id,
            parent_run_id: body.parent_run_id,
            objective: body.objective,
            mode,
            wall_limit_secs: body.wall_limit_secs,
        },
    )
    .await?;

    Ok((StatusCode::CREATED, Json(CreateRunResponseDto { run_id })).into_response())
}

async fn get_run(
    State(state): State<AppState>,
    Path(run_id): Path<Uuid>,
) -> Result<Json<RunDetailDto>, ApiError> {
    Ok(Json(fetch_run_detail(&state.pool, run_id).await?))
}

async fn post_transition(
    State(state): State<AppState>,
    Path(run_id): Path<Uuid>,
    Json(body): Json<TransitionRequestDto>,
) -> Result<StatusCode, ApiError> {
    let to = RunStatus::parse(&body.to)
        .ok_or_else(|| ApiError::bad_request(format!("unknown run status: {}", body.to)))?;

    run::transition(&state.pool, run_id, to, &body.reason).await?;
    Ok(StatusCode::OK)
}

async fn post_tokens(
    State(state): State<AppState>,
    Path(run_id): Path<Uuid>,
    Json(body): Json<TokensRequestDto>,
) -> Result<StatusCode, ApiError> {
    run::observe_tokens(&state.pool, run_id, body.total, body.observed_at).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn post_validate_op(
    State(state): State<AppState>,
    Path(binding_id): Path<Uuid>,
    Json(body): Json<ValidateOpRequestDto>,
) -> Result<StatusCode, ApiError> {
    binding::validate_op(&state.pool, body.run_id, binding_id, body.epoch).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn post_provision(
    State(state): State<AppState>,
    Path(run_id): Path<Uuid>,
    Json(body): Json<ProvisionRequestDto>,
) -> Result<StatusCode, ApiError> {
    let worktrees = body
        .worktrees
        .into_iter()
        .map(|w| {
            let access = Access::parse(&w.access).ok_or_else(|| {
                ApiError::bad_request(format!("unknown access level: {}", w.access))
            })?;
            Ok(WorktreeSpec {
                repo_id: w.repo_id,
                target_id: w.target_id,
                role: w.role,
                base_commit: w.base_commit,
                branch: w.branch,
                access,
                idempotency_key: w.idempotency_key,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    saga::provision(&state.pool, &ProvisionSpec { run_id, worktrees }).await?;
    Ok(StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::require_auth_token;

    #[test]
    fn missing_token_is_refused() {
        assert!(require_auth_token(None).is_err());
    }

    #[test]
    fn empty_token_is_refused() {
        assert!(require_auth_token(Some(String::new())).is_err());
    }

    #[test]
    fn non_empty_token_is_accepted() {
        assert_eq!(
            require_auth_token(Some("secret".to_string())).unwrap(),
            "secret"
        );
    }
}
