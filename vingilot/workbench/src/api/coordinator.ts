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
    if (res.status === 204) return { ok: true, value: undefined as T };
    const value = (await res.json()) as T;
    return { ok: true, value };
  }

  let errorBody: ErrorBody = {};
  try {
    errorBody = (await res.json()) as ErrorBody;
  } catch {
    // no/invalid JSON body — fall through with empty error/detail
  }
  const error = errorBody.error ?? "unknown_error";
  const detail = errorBody.detail ?? res.statusText;

  if (res.status === 409) {
    return { ok: false, kind: "conflict", error, detail };
  }
  return { ok: false, kind: "api", status: res.status, error, detail };
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
