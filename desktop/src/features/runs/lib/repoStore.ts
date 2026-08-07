// Compare-and-set writes to the workspace's `repos` array — the one place a
// project is added or forgotten (vingilot/docs/plans/2026-08-07-workspace-v1.md,
// Task 4).
//
// **The array is the unit of change**, exactly as it is for `deck.pins`
// (deckPins.ts): a mutation carries the whole list, so `expected_revision` is
// what keeps two clients from writing over each other. It is always sent. A
// write is never attempted at a revision this code did not just read.
//
// **A 409 refreshes and replans, it does not re-send.** The plan is a
// function of the current list, not a fixed payload: whoever won the race may
// have added the very path being added, or removed the project being removed,
// and re-sending a payload computed against the losing read would undo their
// write. Replanning against the winner's list either produces a different
// payload or refuses — both of which are correct where a retry-as-is is not.
//
// Exactly one retry, then the conflict is surfaced. A loop here would be a
// client that always eventually wins, which is precisely the clobbering this
// exists to prevent.
//
// **The write is lossless, not just CAS-safe.** Sending the whole array means
// an entry this build cannot parse would be erased by any add or remove, so
// the plan runs over the parseable repos while the rest are held aside and
// spliced back at their old positions (`projects.ts`'s `readRepoEntries` /
// `mergeForeignRepos`). A revision guard stops another client's write from
// being overwritten; this stops another client's *entries* from being.
//
// The coordinator I/O is a parameter rather than an import so the retry
// path, the refusal path, and the give-up path are ordinary unit tests
// against a scripted client instead of a live coordinator.

import type {
  ApiResult,
  MutationOutcome,
  WorkspaceSnapshot,
} from "./coordinatorClient.ts";
import { mergeForeignRepos, readRepoEntries, type Repo } from "./projects.ts";
import { chooseRepo, type RepoProbe } from "./repoChoice.ts";

export interface WorkspaceRepoIo {
  /** The workspace as it is now, including the revision the next write must
   * quote. */
  read(): Promise<ApiResult<WorkspaceSnapshot>>;
  /** `repos` is `unknown[]`, not `Repo[]`, because the array that goes back
   * carries the entries this client could not parse alongside the ones it
   * could — see `mergeForeignRepos`. */
  write(
    expectedRevision: number,
    repos: readonly unknown[],
  ): Promise<ApiResult<MutationOutcome>>;
}

/** What to do to the repo list, given the list as it currently stands.
 * Re-run from scratch on a refresh, so it must not close over an earlier
 * read. */
export type RepoPlan = (
  repos: readonly Repo[],
) => { ok: true; repos: Repo[] } | { ok: false; reason: string };

export type CommitReposResult =
  | { ok: true; repos: Repo[] }
  | { ok: false; reason: string };

/** Human-readable for a failure the owner is about to be shown. Deliberately
 * not the raw body: `error`/`detail` are the coordinator's words for its own
 * operators, and "unreachable" is a state, not a message. */
function describeFailure(result: ApiResult<unknown>): string {
  if (result.ok) return "";
  if (result.kind === "unreachable") {
    return "the coordinator is not answering — nothing was changed.";
  }
  if (result.kind === "conflict") {
    return (
      "the workspace changed while this was being written, twice in a row. " +
      "Nothing was changed — try again."
    );
  }
  return `the coordinator refused (${result.status} ${result.error}): ${result.detail}`;
}

interface Attempt {
  result: CommitReposResult;
  /** True only for a lost CAS race, the one failure worth another read. */
  conflicted: boolean;
}

async function attempt(io: WorkspaceRepoIo, plan: RepoPlan): Promise<Attempt> {
  const snapshot = await io.read();
  if (!snapshot.ok) {
    return {
      conflicted: false,
      result: { ok: false, reason: describeFailure(snapshot) },
    };
  }

  const { foreign, repos } = readRepoEntries(snapshot.value.state);
  const planned = plan(repos);
  if (!planned.ok) {
    return { conflicted: false, result: { ok: false, reason: planned.reason } };
  }

  const written = await io.write(
    snapshot.value.revision,
    mergeForeignRepos(planned.repos, foreign),
  );
  if (written.ok) {
    return { conflicted: false, result: { ok: true, repos: planned.repos } };
  }
  return {
    conflicted: written.kind === "conflict",
    result: { ok: false, reason: describeFailure(written) },
  };
}

/** Read, plan, write — once, and once more if the write lost the revision. */
export async function commitRepos(
  io: WorkspaceRepoIo,
  plan: RepoPlan,
): Promise<CommitReposResult> {
  const first = await attempt(io, plan);
  if (!first.conflicted) return first.result;
  return (await attempt(io, plan)).result;
}

/** Add the picked directory, if the current list will have it. Validation is
 * inside the plan rather than in front of it because a duplicate can appear
 * between the read and the retry — the check has to run against whichever
 * list is actually being written to. */
export function addRepoPlan(path: string, probe: RepoProbe): RepoPlan {
  return (repos) => {
    const choice = chooseRepo(path, probe, repos);
    if (!choice.ok) return { ok: false, reason: choice.reason };
    return { ok: true, repos: [...repos, choice.repo] };
  };
}

/** Forget a path. Removes the entry and nothing else — this produces a
 * shorter array, and there is no other effect anywhere in this feature: no
 * file is touched, no directory is walked, nothing on disk is read or
 * written. A repo already gone is not an error to report; the owner asked for
 * a state that already holds. */
export function removeRepoPlan(repoId: string): RepoPlan {
  return (repos) => ({
    ok: true,
    repos: repos.filter((repo) => repo.id !== repoId),
  });
}
