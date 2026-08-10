// Typed coordinator client. Every method returns an ApiResult<T> and never
// throws on HTTP-level or network-level failure — callers (usePolling, the
// Projects screen, the deck) branch on `ok` instead of try/catch.
//
// Ported from vingilot/workbench/src/api/coordinator.ts (ADR-001's
// 2026-08-03 reversal). The base path changes here: the sibling app talked
// to "/coord" behind a Vite dev-server proxy that injected the bearer token
// server-side, so the browser never saw it. Inside Buzz desktop there is no
// such proxy — the webview calls the coordinator's real origin directly
// (the coordinator's CORS layer, http.rs, exists for exactly this) — so the
// dev bearer token has to live in this file as a plain constant instead.
// That is a known, accepted V1 cost for a coordinator that only ever binds
// to localhost; the follow-up is a Tauri-side keychain-backed proxy so the
// token never ships in webview-readable code.

import type { Pin } from "./deckPins.ts";
import type { Worktree } from "./projects.ts";
import type {
  EvidenceRow,
  RunDetail,
  RunMode,
  RunStatus,
  RunSummary,
} from "./runModel.ts";

export type ApiResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      kind: "conflict";
      error: string;
      detail: string;
      revision?: number;
    }
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

const DEFAULT_BASE_URL = "http://127.0.0.1:7117";

// Dev-only bearer token (see the file header). Matches the coordinator's
// COORD_AUTH_TOKEN dev default (vingilot/scripts/coordinator-run.sh).
const DEV_AUTH_TOKEN = "vingilot-dev-token";

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
      headers: {
        authorization: `Bearer ${DEV_AUTH_TOKEN}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
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
  // was never produced by the coordinator itself — it's an intermediary
  // (a dev proxy, or nothing listening at all) answering on the
  // coordinator's behalf. That is "control plane unreachable", the same
  // fact a fetch-level throw reports, just observed one hop later.
  if (
    !hasJsonBody &&
    (res.status === 502 || res.status === 503 || res.status === 504)
  ) {
    return { ok: false, kind: "unreachable" };
  }

  const error = errorBody.error ?? "unknown_error";
  const detail = errorBody.detail ?? res.statusText;

  if (res.status === 409) {
    return { ok: false, kind: "conflict", error, detail };
  }
  return { ok: false, kind: "api", status: res.status, error, detail };
}

export function getWorkspace(
  workspaceId: string,
  opts?: RequestOpts,
): Promise<ApiResult<WorkspaceSnapshot>> {
  return request<WorkspaceSnapshot>(
    "GET",
    `/v1/workspaces/${workspaceId}`,
    undefined,
    opts,
  );
}

/** Applies a (possibly empty) mutation batch to a workspace. The mutations
 * endpoint has ensure semantics server-side: it creates the workspace row on
 * first write, so an empty mutation batch at `expected_revision: 0` is the
 * bootstrap path the Projects screen uses when `getWorkspace` first 404s. */
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

/** Writes the whole `deck.pins` array as a single CAS mutation — the array
 * is the unit of change (see the phase-3 plan's "Contracts fixed here").
 * `expected_revision` is passed straight to `applyMutations`; a mismatch
 * comes back as `kind: "conflict"`, never a silent overwrite or a retry. */
export function putDeckPins(
  workspaceId: string,
  expectedRevision: number,
  pins: Pin[],
  opts?: RequestOpts,
): Promise<ApiResult<MutationOutcome>> {
  return applyMutations(
    workspaceId,
    expectedRevision,
    [{ deck: { pins } }],
    opts,
  );
}

/** Writes the whole `repos` array as a single CAS mutation — same shape as
 * `putDeckPins`: the array is the unit of change, `expected_revision` is
 * always sent, and a mismatch comes back as `kind: "conflict"` rather than
 * a silent overwrite.
 *
 * `repos` is `unknown[]` rather than `Repo[]` on purpose: because the whole
 * array is replaced, the caller must send back every element it read,
 * including any it could not parse as a `Repo` (`localProjects.ts`'s
 * `pushPlan`, which is the only caller). Narrowing
 * this parameter would make dropping those elements the easy path. */
export function putRepos(
  workspaceId: string,
  expectedRevision: number,
  repos: readonly unknown[],
  opts?: RequestOpts,
): Promise<ApiResult<MutationOutcome>> {
  return applyMutations(workspaceId, expectedRevision, [{ repos }], opts);
}

/** Lists a workspace's worktrees — `worktree_bindings` joined to their
 * owner run's live status/objective, plus diff counts (see
 * `run::list_worktrees_for_workspace` on the coordinator side). This is the
 * read model the worktree column polls; `projects.ts`'s `worktreeSummary`
 * turns each row into what the column actually renders. */
export function listWorktrees(
  workspaceId: string,
  opts?: RequestOpts,
): Promise<ApiResult<Worktree[]>> {
  return request<{ worktrees: Worktree[] }>(
    "GET",
    `/v1/workspaces/${workspaceId}/worktrees`,
    undefined,
    opts,
  ).then((r) => (r.ok ? { ok: true, value: r.value.worktrees } : r));
}

export function listRuns(
  workspaceId: string,
  opts?: RequestOpts,
): Promise<ApiResult<RunSummary[]>> {
  return request<{ runs: RunSummary[] }>(
    "GET",
    `/v1/workspaces/${workspaceId}/runs`,
    undefined,
    opts,
  ).then((r) => (r.ok ? { ok: true, value: r.value.runs } : r));
}

export function getRun(
  id: string,
  opts?: RequestOpts,
): Promise<ApiResult<RunDetail>> {
  return request<RunDetail>("GET", `/v1/runs/${id}`, undefined, opts);
}

export function createRun(
  req: NewRunReq,
  opts?: RequestOpts,
): Promise<ApiResult<{ run_id: string }>> {
  return request<{ run_id: string }>("POST", "/v1/runs", req, opts);
}

export function transitionRun(
  id: string,
  to: RunStatus,
  reason: string,
  opts?: RequestOpts,
): Promise<ApiResult<void>> {
  return request<void>(
    "POST",
    `/v1/runs/${id}/transition`,
    { to, reason },
    opts,
  );
}

export function provisionRun(
  id: string,
  spec: ProvisionSpec,
  opts?: RequestOpts,
): Promise<ApiResult<void>> {
  return request<void>("POST", `/v1/runs/${id}/provision`, spec, opts);
}

/** Lists evidence rows for a run, optionally after a given seq (defaults to
 * 0 — the full history). A thin passthrough: ordering/capping for display
 * is `evidenceView`'s job (runModel.ts), not this client's. */
export function listEvidence(
  id: string,
  after = 0,
  opts?: RequestOpts,
): Promise<ApiResult<EvidenceRow[]>> {
  return request<{ evidence: EvidenceRow[] }>(
    "GET",
    `/v1/runs/${id}/evidence?after=${after}`,
    undefined,
    opts,
  ).then((r) => (r.ok ? { ok: true, value: r.value.evidence } : r));
}
