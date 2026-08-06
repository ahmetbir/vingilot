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

use axum::body::Body;
use axum::extract::{Path, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::binding::{self, BindingError, Lease, OpDenied};
use crate::domain::{Access, RunMode, RunStatus};
use crate::evidence::{self, EvidenceError, EvidenceKind, EvidenceRow};
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
        .route("/v1/bindings/{id}/lease", post(post_acquire_lease))
        .route("/v1/bindings/{id}/lease/renew", post(post_renew_lease))
        .route(
            "/v1/runs/{id}/evidence",
            post(post_append_evidence).get(get_list_evidence),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            require_bearer,
        ))
        .layer(middleware::from_fn(cors))
        .with_state(state)
}

// ---------------------------------------------------------------------
// CORS — the Buzz desktop webview (Tauri) calls the coordinator directly
// (no dev-server proxy, unlike the sibling app's Vite setup), so the
// coordinator itself must answer preflight and echo allow-origin for the
// handful of dev origins it is willing to talk to. Hand-rolled (no
// tower-http dependency) since the surface is this small: a fixed
// allowlist, one preflight short-circuit, one response-header stamp.
// ---------------------------------------------------------------------

/// Origins allowed to call the coordinator from a browser/webview context.
/// The 1420 pair is the Tauri desktop app's dev origin; `tauri://localhost`
/// is its production webview origin; the 5273 pair is the Workbench sibling
/// app's Vite dev server, kept only until that app is deleted; the 4173
/// pair is the Buzz desktop screenshot harness's Vite preview server
/// (`just desktop-screenshot`) — needed so the executor V1 evidence proof
/// can show LIVE coordinator data in the screenshot, not a mock.
const ALLOWED_ORIGINS: &[&str] = &["tauri://localhost"];

/// True for `http://localhost:<port>` and `http://127.0.0.1:<port>`, any port.
///
/// A fixed port list was wrong: `just dev` assigns the Vite dev server a
/// **per-worktree** port (the `deck` worktree gets 60118), so every new
/// worktree silently fell outside the allowlist and the Runs screen showed
/// "control plane unreachable" while the coordinator was in fact healthy —
/// an honest banner firing for a dishonest reason.
///
/// This widens the origin check to loopback only, which is the actual
/// boundary that matters here: the coordinator binds 127.0.0.1, so anything
/// that can reach it is already on this machine. Bearer auth remains the
/// access control; CORS is not doing security work it was never able to do.
/// A remote origin still gets no CORS headers.
fn is_loopback_dev_origin(origin: &str) -> bool {
    let rest = match origin.strip_prefix("http://") {
        Some(r) => r,
        None => return false,
    };
    let (host, port) = match rest.rsplit_once(':') {
        Some((h, p)) => (h, p),
        None => (rest, ""),
    };
    if host != "localhost" && host != "127.0.0.1" {
        return false;
    }
    port.is_empty() || port.chars().all(|c| c.is_ascii_digit())
}

fn cors_headers_for(origin: &str) -> Option<[(header::HeaderName, HeaderValue); 3]> {
    if !ALLOWED_ORIGINS.contains(&origin) && !is_loopback_dev_origin(origin) {
        return None;
    }
    Some([
        (
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_str(origin).ok()?,
        ),
        (
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("authorization, content-type"),
        ),
        (
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, POST, OPTIONS"),
        ),
    ])
}

fn request_origin(headers: &HeaderMap) -> Option<&str> {
    headers.get(header::ORIGIN)?.to_str().ok()
}

/// Runs outermost (before `require_bearer`, before route matching) so that
/// an unauthenticated CORS preflight (browsers never attach the bearer
/// token to an OPTIONS request) is answered directly instead of falling
/// through to the 401 gate. An origin outside [`ALLOWED_ORIGINS`] gets no
/// CORS headers at all — the request (if not a preflight) still runs
/// through the normal handler chain, it just isn't readable by a browser
/// that sent it, which is the same "no headers, browser enforces" contract
/// a real CORS layer gives you.
async fn cors(req: Request, next: Next) -> Response {
    let origin = request_origin(req.headers()).map(str::to_string);

    if req.method() == Method::OPTIONS {
        let mut res = Response::builder()
            .status(StatusCode::NO_CONTENT)
            .body(Body::empty())
            .expect("static OPTIONS response is well-formed");
        if let Some(headers) = origin.as_deref().and_then(cors_headers_for) {
            for (name, value) in headers {
                res.headers_mut().insert(name, value);
            }
        }
        return res;
    }

    let mut res = next.run(req).await;
    if let Some(headers) = origin.as_deref().and_then(cors_headers_for) {
        for (name, value) in headers {
            res.headers_mut().insert(name, value);
        }
    }
    res
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

impl From<EvidenceError> for ApiError {
    fn from(err: EvidenceError) -> Self {
        match &err {
            EvidenceError::RunNotFound(_) => {
                ApiError::new(StatusCode::NOT_FOUND, "run_not_found", err.to_string())
            }
            EvidenceError::ContentTooLarge { .. } => ApiError::bad_request(err.to_string()),
            EvidenceError::Db(_) => ApiError::new(
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
    repo_id: String,
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

#[derive(Debug, Deserialize)]
struct AcquireLeaseRequestDto {
    ttl_secs: i64,
}

#[derive(Debug, Deserialize)]
struct RenewLeaseRequestDto {
    epoch: i64,
    ttl_secs: i64,
}

#[derive(Debug, Serialize)]
struct LeaseDto {
    epoch: i64,
    expires_at: DateTime<Utc>,
}

impl From<Lease> for LeaseDto {
    fn from(lease: Lease) -> Self {
        Self {
            epoch: lease.epoch,
            expires_at: lease.expires_at,
        }
    }
}

#[derive(Debug, Deserialize)]
struct AppendEvidenceRequestDto {
    kind: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct AppendEvidenceResponseDto {
    seq: i64,
}

#[derive(Debug, Deserialize)]
struct ListEvidenceQueryDto {
    #[serde(default)]
    after: i64,
}

#[derive(Debug, Serialize)]
struct EvidenceRowDto {
    seq: i64,
    kind: String,
    content: String,
    created_at: DateTime<Utc>,
}

impl From<EvidenceRow> for EvidenceRowDto {
    fn from(row: EvidenceRow) -> Self {
        Self {
            seq: row.seq,
            kind: row.kind.as_str().to_string(),
            content: row.content,
            created_at: row.created_at,
        }
    }
}

#[derive(Debug, Serialize)]
struct EvidenceListDto {
    evidence: Vec<EvidenceRowDto>,
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

    // Joins `worktree_bindings` for `repo_id` — the executor (vingilot-executor)
    // needs it to resolve which local clone (via its `repo_map`) to run `git
    // worktree add` against; the grants table alone only names the binding.
    let grants: Vec<(Uuid, String, String)> = sqlx::query_as(
        "SELECT g.binding_id, g.access, b.repo_id \
         FROM run_worktree_grants g \
         JOIN worktree_bindings b ON b.id = g.binding_id \
         WHERE g.run_id = $1",
    )
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
            .map(|(binding_id, access, repo_id)| GrantDto {
                binding_id,
                access,
                repo_id,
            })
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
    // Ensure semantics: the mutations endpoint is the Workbench's workspace
    // bootstrap path (Deck-shell Task 5) — a client that GETs a workspace,
    // finds nothing, and POSTs its first mutation expects that write to
    // create the row, not 404. `ensure_workspace` is idempotent (`ON
    // CONFLICT DO NOTHING`), so this is a no-op on every subsequent call
    // against an already-existing workspace.
    workspace::ensure_workspace(&state.pool, workspace_id).await?;

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

async fn post_acquire_lease(
    State(state): State<AppState>,
    Path(binding_id): Path<Uuid>,
    Json(body): Json<AcquireLeaseRequestDto>,
) -> Result<Json<LeaseDto>, ApiError> {
    let lease = binding::acquire_lease(&state.pool, binding_id, body.ttl_secs).await?;
    Ok(Json(lease.into()))
}

async fn post_renew_lease(
    State(state): State<AppState>,
    Path(binding_id): Path<Uuid>,
    Json(body): Json<RenewLeaseRequestDto>,
) -> Result<Json<LeaseDto>, ApiError> {
    let lease = binding::renew_lease(&state.pool, binding_id, body.epoch, body.ttl_secs).await?;
    Ok(Json(lease.into()))
}

async fn post_append_evidence(
    State(state): State<AppState>,
    Path(run_id): Path<Uuid>,
    Json(body): Json<AppendEvidenceRequestDto>,
) -> Result<Response, ApiError> {
    let kind = EvidenceKind::parse(&body.kind)
        .ok_or_else(|| ApiError::bad_request(format!("unknown evidence kind: {}", body.kind)))?;

    let seq = evidence::append(&state.pool, run_id, kind, &body.content).await?;
    Ok((StatusCode::CREATED, Json(AppendEvidenceResponseDto { seq })).into_response())
}

async fn get_list_evidence(
    State(state): State<AppState>,
    Path(run_id): Path<Uuid>,
    Query(query): Query<ListEvidenceQueryDto>,
) -> Result<Json<EvidenceListDto>, ApiError> {
    let rows = evidence::list_after(&state.pool, run_id, query.after).await?;
    Ok(Json(EvidenceListDto {
        evidence: rows.into_iter().map(EvidenceRowDto::from).collect(),
    }))
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
