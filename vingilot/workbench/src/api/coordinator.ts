// Typed coordinator client. Every method returns an ApiResult<T> and never
// throws on HTTP-level or network-level failure — callers (usePolling, the
// shell, the deck) branch on `ok` instead of try/catch.
//
// The base path is "/coord" in the browser: the Vite dev proxy owns the real
// coordinator origin and injects the bearer token server-side (vite.config.ts).
// The browser never sees the token. Tests override `baseUrl` to point at a
// throwaway http server instead.

import type { RunDetail, RunMode, RunStatus, RunSummary } from "../model/run.ts";

export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "conflict"; error: string; detail: string; revision?: number }
  | { ok: false; kind: "unreachable" }
  | { ok: false; kind: "api"; status: number; error: string; detail: string };

export interface NewRunReq {
  workspace_id: string;
  parent_run_id?: string | null;
  objective: string;
  mode: RunMode;
  wall_limit_secs?: number | null;
}

export interface WorktreeSpec {
  repo_id: string;
  target_id: string;
  role: string;
  base_commit: string;
  branch?: string | null;
  access: string;
  idempotency_key: string;
}

export interface ProvisionSpec {
  worktrees: WorktreeSpec[];
}

export interface WorkspaceSnapshot {
  revision: number;
  state_hash: string;
  state: unknown;
}

export interface MutationOutcome {
  accepted: boolean;
  revision: number;
  state_hash: string;
}

interface RequestOpts {
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "/coord";

interface ErrorBody {
  error?: string;
  detail?: string;
}

async function request<T>(
  method: string,
  path: string,
  body: unknown,
  opts: RequestOpts | undefined,
): Promise<ApiResult<T>> {
  const base = opts?.baseUrl ?? DEFAULT_BASE_URL;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // fetch throws (TypeError) on DNS/connection failure — this IS the
    // "control plane unreachable" signal, not an exception to propagate.
    return { ok: false, kind: "unreachable" };
  }

  if (res.ok) {
    // Success bodies are inconsistent by design across the coordinator's own
    // endpoints — some ack with 204, some with a bare 200 and no body (e.g.
    // transition, provision) — so the client keys off the actual body being
    // empty rather than the status code (a live-tested gap: 200 THIS EMPTY
    // used to hit `res.json()` and throw on `provisionRun`).
    const text = await res.text();
    if (text === "") return { ok: true, value: undefined as T };
    const value = JSON.parse(text) as T;
    return { ok: true, value };
  }

  let errorBody: ErrorBody = {};
  let hasJsonBody = false;
  try {
    errorBody = (await res.json()) as ErrorBody;
    hasJsonBody = true;
  } catch {
    // no/invalid JSON body — fall through with empty error/detail
  }

  // The coordinator's every error path returns {error, detail} JSON (the
  // contract this whole module trades in). A 502/503/504 with no such body
  // was never produced by the coordinator itself — it's the Vite dev
  // proxy answering on the coordinator's behalf because nothing is
  // listening at its target. That is "control plane unreachable", the same
  // fact a fetch-level throw reports, just observed one hop later: the
  // browser's request to the (up) dev server succeeded, but the dev
  // server's request to the (down) coordinator did not.
  if (!hasJsonBody && (res.status === 502 || res.status === 503 || res.status === 504)) {
    return { ok: false, kind: "unreachable" };
  }

  const error = errorBody.error ?? "unknown_error";
  const detail = errorBody.detail ?? res.statusText;

  if (res.status === 409) {
    return { ok: false, kind: "conflict", error, detail };
  }
  return { ok: false, kind: "api", status: res.status, error, detail };
}

export function getWorkspace(workspaceId: string, opts?: RequestOpts): Promise<ApiResult<WorkspaceSnapshot>> {
  return request<WorkspaceSnapshot>("GET", `/v1/workspaces/${workspaceId}`, undefined, opts);
}

/** Applies a (possibly empty) mutation batch to a workspace. The mutations
 * endpoint has ensure semantics server-side: it creates the workspace row on
 * first write, so an empty mutation batch at `expected_revision: 0` is the
 * bootstrap path App.tsx uses when `getWorkspace` first 404s. */
export function applyMutations(
  workspaceId: string,
  expectedRevision: number,
  mutations: unknown[],
  opts?: RequestOpts,
): Promise<ApiResult<MutationOutcome>> {
  return request<MutationOutcome>(
    "POST",
    `/v1/workspaces/${workspaceId}/mutations`,
    { expected_revision: expectedRevision, mutations },
    opts,
  );
}

export function listRuns(workspaceId: string, opts?: RequestOpts): Promise<ApiResult<RunSummary[]>> {
  return request<{ runs: RunSummary[] }>("GET", `/v1/workspaces/${workspaceId}/runs`, undefined, opts).then(
    (r) => (r.ok ? { ok: true, value: r.value.runs } : r),
  );
}

export function getRun(id: string, opts?: RequestOpts): Promise<ApiResult<RunDetail>> {
  return request<RunDetail>("GET", `/v1/runs/${id}`, undefined, opts);
}

export function createRun(req: NewRunReq, opts?: RequestOpts): Promise<ApiResult<{ run_id: string }>> {
  return request<{ run_id: string }>("POST", "/v1/runs", req, opts);
}

export function transitionRun(
  id: string,
  to: RunStatus,
  reason: string,
  opts?: RequestOpts,
): Promise<ApiResult<void>> {
  return request<void>("POST", `/v1/runs/${id}/transition`, { to, reason }, opts);
}

export function provisionRun(id: string, spec: ProvisionSpec, opts?: RequestOpts): Promise<ApiResult<void>> {
  return request<void>("POST", `/v1/runs/${id}/provision`, spec, opts);
}
