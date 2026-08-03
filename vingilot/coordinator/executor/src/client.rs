//! A thin, typed HTTP client over the coordinator's `/v1` surface — exactly
//! the calls `execute_run` needs (ADR-003 §Fencing: `validate-op` before
//! every side-effecting step). No retries, no caching: one method per
//! endpoint, mapping the response to a typed value or a typed [`ClientError`].

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Errors from a coordinator call. Distinguishes the fencing-relevant
/// statuses (403 `Denied`, 409 `Conflict`) from everything else so callers
/// can react to a fencing bite without string-matching a generic error.
#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("http transport error: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("denied: {0}")]
    Denied(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("unexpected status {status}: {detail}")]
    Unexpected { status: u16, detail: String },
}

#[derive(Debug, Deserialize)]
struct ErrorBody {
    #[serde(default)]
    detail: String,
}

/// A single grant row on a Run's detail, as the coordinator returns it —
/// carries `repo_id` (joined from `worktree_bindings`) so the executor can
/// resolve which local clone (via its `repo_map`) to provision a worktree in.
#[derive(Debug, Clone, Deserialize)]
pub struct GrantEntry {
    pub binding_id: Uuid,
    pub access: String,
    pub repo_id: String,
}

/// The fields of `GET /v1/runs/{id}` that `execute_run` reads. Extra fields
/// on the response (transitions, timestamps, ...) are ignored by serde.
#[derive(Debug, Clone, Deserialize)]
pub struct RunDetail {
    pub id: Uuid,
    pub status: String,
    pub mode: String,
    pub objective: String,
    pub grants: Vec<GrantEntry>,
}

/// A held lease: the epoch it was issued at and when it expires.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Lease {
    pub epoch: i64,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
struct TransitionRequest<'a> {
    to: &'a str,
    reason: &'a str,
}

#[derive(Debug, Serialize)]
struct AcquireLeaseRequest {
    ttl_secs: i64,
}

#[derive(Debug, Serialize)]
struct RenewLeaseRequest {
    epoch: i64,
    ttl_secs: i64,
}

#[derive(Debug, Serialize)]
struct ValidateOpRequest {
    run_id: Uuid,
    epoch: i64,
}

#[derive(Debug, Serialize)]
struct AppendEvidenceRequest<'a> {
    kind: &'a str,
    content: &'a str,
}

#[derive(Debug, Deserialize)]
struct AppendEvidenceResponse {
    seq: i64,
}

/// Thin client bound to one coordinator base URL and auth token. Cheaply
/// cloneable (the underlying `reqwest::Client` is `Arc`-backed) — clones are
/// handed to the concurrent stdout/stderr/lease-renewal tasks `execute_run`
/// spawns around a running command.
#[derive(Clone)]
pub struct Client {
    http: reqwest::Client,
    base: String,
    token: String,
}

impl Client {
    pub fn new(base: impl Into<String>, auth_token: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            base: base.into(),
            token: auth_token.into(),
        }
    }

    async fn error_from_response(resp: reqwest::Response) -> ClientError {
        let status = resp.status().as_u16();
        let detail = match resp.json::<ErrorBody>().await {
            Ok(body) => body.detail,
            Err(_) => format!("http status {status}"),
        };
        match status {
            404 => ClientError::NotFound(detail),
            403 => ClientError::Denied(detail),
            409 => ClientError::Conflict(detail),
            400 => ClientError::BadRequest(detail),
            _ => ClientError::Unexpected { status, detail },
        }
    }

    pub async fn get_run(&self, run_id: Uuid) -> Result<RunDetail, ClientError> {
        let resp = self
            .http
            .get(format!("{}/v1/runs/{run_id}", self.base))
            .bearer_auth(&self.token)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::error_from_response(resp).await);
        }
        Ok(resp.json().await?)
    }

    pub async fn transition(
        &self,
        run_id: Uuid,
        to: &str,
        reason: &str,
    ) -> Result<(), ClientError> {
        let resp = self
            .http
            .post(format!("{}/v1/runs/{run_id}/transition", self.base))
            .bearer_auth(&self.token)
            .json(&TransitionRequest { to, reason })
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::error_from_response(resp).await);
        }
        Ok(())
    }

    pub async fn acquire_lease(
        &self,
        binding_id: Uuid,
        ttl_secs: i64,
    ) -> Result<Lease, ClientError> {
        let resp = self
            .http
            .post(format!("{}/v1/bindings/{binding_id}/lease", self.base))
            .bearer_auth(&self.token)
            .json(&AcquireLeaseRequest { ttl_secs })
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::error_from_response(resp).await);
        }
        Ok(resp.json().await?)
    }

    pub async fn renew_lease(
        &self,
        binding_id: Uuid,
        epoch: i64,
        ttl_secs: i64,
    ) -> Result<Lease, ClientError> {
        let resp = self
            .http
            .post(format!(
                "{}/v1/bindings/{binding_id}/lease/renew",
                self.base
            ))
            .bearer_auth(&self.token)
            .json(&RenewLeaseRequest { epoch, ttl_secs })
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::error_from_response(resp).await);
        }
        Ok(resp.json().await?)
    }

    /// The per-operation fencing check (ADR-003 §Fencing) — call before
    /// every side-effecting step on `binding_id`.
    pub async fn validate_op(
        &self,
        binding_id: Uuid,
        run_id: Uuid,
        epoch: i64,
    ) -> Result<(), ClientError> {
        let resp = self
            .http
            .post(format!(
                "{}/v1/bindings/{binding_id}/validate-op",
                self.base
            ))
            .bearer_auth(&self.token)
            .json(&ValidateOpRequest { run_id, epoch })
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::error_from_response(resp).await);
        }
        Ok(())
    }

    pub async fn append_evidence(
        &self,
        run_id: Uuid,
        kind: &str,
        content: &str,
    ) -> Result<i64, ClientError> {
        let resp = self
            .http
            .post(format!("{}/v1/runs/{run_id}/evidence", self.base))
            .bearer_auth(&self.token)
            .json(&AppendEvidenceRequest { kind, content })
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::error_from_response(resp).await);
        }
        let body: AppendEvidenceResponse = resp.json().await?;
        Ok(body.seq)
    }
}
