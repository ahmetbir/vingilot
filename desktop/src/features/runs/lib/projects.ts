// Pure model for the Projects/Terminal dashboard (see
// vingilot/docs/plans/2026-08-06-projects-and-terminal.md's "Contracts fixed
// here"): repos live in Workspace state under `repos` (CAS, same protocol as
// `deck.pins`), worktrees come from the coordinator's
// `GET /v1/workspaces/{id}/worktrees` read model. This module has no
// coordinator-client or React imports — it is the thing coordinatorClient.ts
// and every UI component agree on, mirroring runModel.ts's role for runs.
//
//   { "repos": [ { "id": "buzz", "name": "buzz", "path": "/Users/…/vingilot" } ] }
//
// `readRepos` is deliberately tolerant, for the same reason `readPins` is
// (deckPins.ts): it is the boundary between "state that arrived over the
// wire from a coordinator we don't fully trust yet" and the typed `Repo[]`
// the rest of this feature operates on. Bad shapes become `[]`, never a
// throw — and because `readRepos` filters rather than reconstructs, a repo
// object's unknown extra keys survive the read untouched, so a future
// client's fields aren't silently deleted the next time `putRepos` writes
// the whole array back (the array is the unit of change, exactly like
// `deck.pins`).
//
// Tolerance in a read becomes destruction in a read-modify-write, though:
// `putRepos` sends the whole array, so an entry `readRepos` DROPPED would be
// erased from workspace state by the next add or remove — no error, no
// confirm. Whoever writes the array back must therefore use
// `readRepoEntries`/`mergeForeignRepos` instead, which keep the unparseable
// entries aside and put them back where they were. `readRepos` remains the
// right read for anything that only renders.

import type { RunStatus, SemanticClass } from "./runModel.ts";
import { statusClass } from "./runModel.ts";

export interface Repo {
  id: string;
  name: string;
  path: string;
}

function isRepo(value: unknown): value is Repo {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.path === "string"
  );
}

/** Tolerant read of `repos` from arbitrary workspace state. Anything that
 * isn't a well-formed repo is dropped rather than thrown on. A repo object
 * that IS well-formed is returned by reference, not rebuilt — so any extra
 * key a future client wrote onto it (and this client doesn't know about)
 * round-trips through read → write untouched. */
export function readRepos(state: unknown): Repo[] {
  return readRepoEntries(state).repos;
}

/** An element of workspace `repos` this client cannot read as a `Repo` — a
 * malformed seed, or an entry a future client writes in a shape this build
 * predates. `index` is where it sat in the raw array, so it can go back
 * roughly where it was rather than being pushed to one end. */
export interface ForeignRepoEntry {
  index: number;
  value: unknown;
}

/** The same tolerant read as `readRepos`, keeping what it dropped. Callers
 * that write the array back use this; callers that only render use
 * `readRepos`. */
export function readRepoEntries(state: unknown): {
  repos: Repo[];
  foreign: ForeignRepoEntry[];
} {
  if (typeof state !== "object" || state === null)
    return { foreign: [], repos: [] };
  const raw = (state as Record<string, unknown>).repos;
  if (!Array.isArray(raw)) return { foreign: [], repos: [] };

  const repos: Repo[] = [];
  const foreign: ForeignRepoEntry[] = [];
  raw.forEach((value, index) => {
    if (isRepo(value)) repos.push(value);
    else foreign.push({ index, value });
  });
  return { foreign, repos };
}

/** The array to send back: the planned repos with every foreign entry spliced
 * back in at the index it held. Clamped to the end when the plan produced a
 * shorter list, which is the only case where the original index is no longer
 * reachable. Nothing is ever dropped — that is the entire point. */
export function mergeForeignRepos(
  repos: readonly Repo[],
  foreign: readonly ForeignRepoEntry[],
): unknown[] {
  const merged: unknown[] = [...repos];
  for (const entry of [...foreign].sort((a, b) => a.index - b.index)) {
    merged.splice(Math.min(entry.index, merged.length), 0, entry.value);
  }
  return merged;
}

/** One row of the coordinator's worktree read model — a `worktree_bindings`
 * row joined to its owner run's live status/objective, plus the latest
 * diff/commit evidence for that run. Mirrors `WorktreeSummaryDto`
 * (vingilot/coordinator/coordinator/src/http.rs) field-for-field.
 * `owner_run_*`/`added`/`removed`/`commit_sha` are `null` when the binding
 * has no owner run, or the owner run has not yet produced that evidence —
 * never coerced to a zero/empty placeholder. */
export interface Worktree {
  binding_id: string;
  repo_id: string;
  branch: string | null;
  role: string;
  lifecycle: string;
  base_commit: string;
  owner_run_id: string | null;
  owner_run_status: RunStatus | null;
  owner_run_objective: string | null;
  added: number | null;
  removed: number | null;
  commit_sha: string | null;
}

/** Prefix marking a synthetic binding id — the repo's own checkout, which the
 * coordinator has no row for. Anything downstream that would call the
 * coordinator with a binding id must check this first: there is no binding to
 * lease, fence, or transition here, only a directory to open a shell in. */
export const MAIN_CHECKOUT_PREFIX = "main:";

/** True when this worktree is a repo's own checkout rather than a
 * coordinator-managed task worktree. */
export function isMainCheckout(wt: Worktree): boolean {
  return wt.binding_id.startsWith(MAIN_CHECKOUT_PREFIX);
}

/** Prefix marking a worktree git knows about and the coordinator does not —
 * one the owner made, from this app or from a shell
 * (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 6). Synthetic in the
 * same sense `MAIN_CHECKOUT_PREFIX` is: there is no binding to lease or
 * transition, only a directory. */
export const LOCAL_WORKTREE_PREFIX = "local:";

/** The binding id for a worktree at `path`.
 *
 * **The path is hex, and that is the point.** A worktree's path is the only
 * thing that identifies it (git has no id for one), and a path may hold
 * spaces, `#`, `:`, or any UTF-8 at all — while the derived id has to survive
 * three separate alphabets downstream: tmux session names, Tauri event names
 * (`[A-Za-z0-9-/:_]`, and an id outside it makes `listen`/`emit` fail with no
 * error on the emit side), and the ids this app's own model is built from.
 * Hex encoding widens the character set by exactly nothing — the id is
 * `local:` plus `[0-9a-f]` — while staying injective, which an escaping or
 * slugging scheme would have to be argued into being.
 *
 * It also means the id *carries* the path, so `worktreeCwd` can answer for a
 * worktree nobody has a row for without a side table to keep in sync. */
export function localBindingId(path: string): string {
  let hex = "";
  for (const byte of new TextEncoder().encode(path)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `${LOCAL_WORKTREE_PREFIX}${hex}`;
}

/** The path back out of a local binding id, or `null` for an id that is not
 * one. Tolerant on purpose: ids round-trip through stored tab layouts
 * (`terminalTabStore.ts`), so a hand-edited or older-format id must read as
 * "not a local worktree" rather than decode to garbage a shell would be
 * opened in. */
export function localWorktreePath(bindingId: string): string | null {
  if (!bindingId.startsWith(LOCAL_WORKTREE_PREFIX)) return null;
  const hex = bindingId.slice(LOCAL_WORKTREE_PREFIX.length);
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

/** True when this worktree is one git knows and the coordinator does not. */
export function isLocalWorktree(wt: Worktree): boolean {
  return wt.binding_id.startsWith(LOCAL_WORKTREE_PREFIX);
}

/** The repo's own checkout as a `Worktree`, so the column and the terminal can
 * treat it like any other row. `role: "primary"` and a null owner run are the
 * honest description: nothing is running there and nobody holds a grant. */
export function mainCheckout(repo: Repo): Worktree {
  return {
    added: null,
    base_commit: "",
    binding_id: `${MAIN_CHECKOUT_PREFIX}${repo.id}`,
    branch: null,
    commit_sha: null,
    lifecycle: "ready",
    owner_run_id: null,
    owner_run_objective: null,
    owner_run_status: null,
    removed: null,
    repo_id: repo.id,
    role: "primary",
  };
}

export interface GroupedWorktrees {
  /** Every known repo's id maps to its worktrees (possibly `[]` — a repo
   * with no worktrees yet is still a project, per the plan's contract). */
  byRepo: Record<string, Worktree[]>;
  /** Worktrees whose `repo_id` matches no repo in `repos` land here instead
   * of vanishing — a coordinator can know about a binding before this
   * client's `repos` state has caught up to it. */
  unknown: Worktree[];
}

/** Groups worktrees under their owning repo. Every repo in `repos` gets an
 * entry (even `[]`); a worktree whose `repo_id` matches no known repo is
 * bucketed into `unknown` rather than dropped. */
export function groupWorktrees(
  repos: Repo[],
  worktrees: Worktree[],
): GroupedWorktrees {
  // Every project starts with its own checkout. The coordinator only knows
  // worktrees a Run created, so without this a project you have not run
  // anything in yet opens onto "no worktrees yet" — nothing to look at, no
  // terminal, exactly the emptiness this whole screen exists to end. The main
  // checkout is not stored anywhere because it needs no storing: it is the
  // repo's own path, already in Workspace state.
  const byRepo: Record<string, Worktree[]> = {};
  for (const repo of repos) byRepo[repo.id] = [mainCheckout(repo)];

  const unknown: Worktree[] = [];
  for (const wt of worktrees) {
    const bucket = byRepo[wt.repo_id];
    if (bucket === undefined) {
      unknown.push(wt);
    } else {
      bucket.push(wt);
    }
  }

  return { byRepo, unknown };
}

export interface WorktreeSummary {
  /** What the worktree column shows in place of a branch name: the branch
   * itself when there is one, else a readable stand-in for the primary/main
   * checkout (which has no branch in the coordinator's model). */
  label: string;
  /** `"clean"` for a worktree with no owner run (nothing running there);
   * otherwise the owner run's own semantic class (runModel.ts's
   * `statusClass`), so the worktree column and the Runs tab agree on what
   * each hue means. */
  stateClass: SemanticClass | "clean";
  /** `null` when no diff evidence exists yet — never coerced to `{0, 0}`,
   * which would claim "no changes" instead of "no data". */
  diff: { added: number; removed: number } | null;
}

/** Pure render-model for one worktree row. `WorktreeColumn` renders exactly
 * this shape and nothing else. */
export function worktreeSummary(wt: Worktree): WorktreeSummary {
  const label = wt.branch ?? (wt.role === "primary" ? "main" : wt.role);
  const stateClass =
    wt.owner_run_status === null ? "clean" : statusClass(wt.owner_run_status);
  const diff =
    wt.added !== null && wt.removed !== null
      ? { added: wt.added, removed: wt.removed }
      : null;
  return { label, stateClass, diff };
}

/** Default root the executor checks task worktrees out under
 * (`VINGILOT_WORKTREE_ROOT`, see `executor-run.sh`) — `<worktreeRoot>/<run_id>`
 * (`vingilot-executor`'s `execute_run`, `worktree_path = cfg.worktree_root.join(run_id...)`).
 * Passed as a parameter to `worktreeCwd` rather than read from an env var
 * here, because this module has no Tauri/Node imports; the caller resolves
 * the real value (home dir + this suffix) once, asynchronously. */
export const DEFAULT_WORKTREE_ROOT_SUFFIX = ".vingilot/worktrees";

/** The terminal's cwd for a worktree, per the coordinator's own naming
 * convention (see the constant above) — the coordinator's worktree read
 * model has no `path` column (a Task 1 boundary this task does not cross),
 * so the path is derived rather than fetched. The primary/main checkout has
 * no owner run and no separate worktree directory: it *is* the repo, so its
 * cwd is `repo.path`. A task worktree's cwd is
 * `<worktreeRoot>/<owner_run_id>` — `null` when the binding has no owner
 * run yet (nothing to derive from; the caller should not open a terminal
 * for it). */
export function worktreeCwd(
  repo: Repo,
  wt: Worktree,
  worktreeRoot: string,
): string | null {
  // A worktree git listed carries its own path inside its binding id
  // (`localBindingId`), so it needs no derivation and no side table — which
  // is what lets a worktree the owner made in a shell get a terminal on the
  // same terms as one a Run provisioned.
  const local = localWorktreePath(wt.binding_id);
  if (local !== null) return local;
  if (wt.role === "primary") return repo.path;
  if (wt.owner_run_id === null) return null;
  const root = worktreeRoot.endsWith("/")
    ? worktreeRoot.slice(0, -1)
    : worktreeRoot;
  return `${root}/${wt.owner_run_id}`;
}
