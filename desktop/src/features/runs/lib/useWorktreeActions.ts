// Opening and closing a project's worktrees, as the callbacks the worktree
// column needs (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 6).
//
// The same split `useProjectActions.ts` uses, for the same reason: this hook
// owns sequencing and the transient state a button needs, and no decisions.
// Where a worktree lands and what may be removed are `worktreePlan.ts`; what
// a git listing means is `worktreeGit.ts`; the calls are `worktreeClient.ts`.
// All three are testable without React.
//
// A refusal is state, not a throw. "that branch already exists" and "these
// four files are uncommitted" are things the owner reads and acts on, so they
// live next to the button that caused them.
//
// **Every project is listed, not just the open one.** The workspace reads
// "this worktree is no longer in the index" as "kill its shells"
// (`terminalTabs.ts`), so listing only the selected project would end every
// other project's terminals on a project switch. The listing is cheap and
// event-driven — a git subprocess per project when the project set changes,
// and again after a create or a remove — never a poll.

import * as React from "react";

import type { Repo } from "@/features/runs/lib/projects";
import {
  gitWorktreeAdd,
  gitWorktreeAddWithBrief,
  gitWorktreePrune,
  gitWorktreePrunePreview,
  gitWorktreeRemove,
  gitWorktrees,
} from "@/features/runs/lib/worktreeClient";
import {
  type GitWorktree,
  projectsKey,
  readProjectsKey,
} from "@/features/runs/lib/worktreeGit";
import {
  explainWorktreeError,
  planWorktree,
  type RemovableWorktree,
  type WorktreeRefusal,
} from "@/features/runs/lib/worktreePlan";

/** What a briefed creation actually did. Two separate answers on purpose: the
 * worktree exists, and the brief either does or does not. */
export interface BriefedOutcome {
  /** git's own path for the new worktree. */
  path: string;
  branch: string;
  /** The brief's path, or `null` when it was not written. */
  brief: string | null;
  /** Why it was not, in words. `null` when it was. */
  briefRefusal: WorktreeRefusal | null;
}

export interface WorktreeActions {
  /** What git says each project's worktrees are, keyed by repo id. A project
   * git could not read has **no entry at all** — see `unreadable`. */
  byRepo: Record<string, GitWorktree[]>;
  /** False while `byRepo` predates the current project set — before the
   * first listing of an app run, and between a project being added and its
   * worktrees being read.
   *
   * **A caller that kills things must wait for this.** The workspace reads
   * "not in the worktree index" as "kill this worktree's shells"
   * (`terminalTabs.ts`), and an un-listed project contributes no worktrees:
   * acting on `byRepo` before it has answered would end, on every app start,
   * exactly the terminals the tab layout was saved to bring back. */
  settled: boolean;
  /** The projects that answered with a refusal rather than a listing — an
   * unmounted volume, a directory that is no longer a repository, no git on
   * PATH.
   *
   * `settled` alone is not enough for a caller that kills things: it says the
   * listing is *current*, not that it is *complete*. An unreadable project
   * contributes no worktrees for the same reason an empty one does, and the
   * two must not lead to the same action — `worktreeGit.ts`'s
   * `unlistedWorktrees` is what keeps them apart. */
  unreadable: readonly string[];
  /** Resolves true when the worktree was created — the dialog closes on
   * true, and stays open with the refusal showing on false. */
  create: (branch: string, base: string) => Promise<boolean>;
  /** The same creation, with a document written into the new checkout
   * (`planBrief.ts` decides the filename, `vingilot_worktree/brief.rs` writes
   * it). `null` is a refusal, on `refusal` — nothing was created.
   *
   * An outcome is **not** a claim that the brief landed: the worktree can
   * exist with `briefRefusal` set, and the caller must say so rather than
   * reporting a success it did not get. */
  createWithBrief: (
    branch: string,
    base: string,
    brief: { name: string; text: string },
  ) => Promise<BriefedOutcome | null>;
  remove: (target: RemovableWorktree) => void;
  /** What `git worktree prune` would remove, in git's own words. Removes
   * nothing. `null` means git refused, and the refusal is on `refusal`. */
  previewPrune: () => Promise<string[] | null>;
  /** Prune, then re-list. Bookkeeping only — no directory is removed by this
   * or by anything it calls. Resolves what git said it removed. */
  prune: () => Promise<string[] | null>;
  pending: boolean;
  refusal: WorktreeRefusal | null;
  dismissRefusal: () => void;
}

interface Options {
  repos: readonly Repo[];
  /** The project a create or a remove acts on; `null` on the landing view. */
  selectedRepo: Repo | null;
  worktreeRoot: string | null;
  /** The worktree that just left. Its terminal tabs are closed from here
   * rather than waiting for a poll to notice the checkout is gone. */
  onRemoved?: (bindingId: string) => void;
}

interface Listing {
  key: string;
  byRepo: Record<string, GitWorktree[]>;
  unreadable: string[];
}

/** One project's fresh listing, folded into the state. A listing that arrived
 * at all is proof git can reach that project, so it also clears the project
 * from `unreadable` — a create or a remove is the one moment this hook learns
 * that without waiting for the next project-set change. */
function listed(prev: Listing, repoId: string, git: GitWorktree[]): Listing {
  return {
    ...prev,
    byRepo: { ...prev.byRepo, [repoId]: git },
    unreadable: prev.unreadable.filter((id) => id !== repoId),
  };
}

export function useWorktreeActions({
  onRemoved,
  repos,
  selectedRepo,
  worktreeRoot,
}: Options): WorktreeActions {
  // The listing and the project set it describes, together: what makes
  // `settled` an exact statement rather than a flag two effects have to keep
  // in step.
  const [listing, setListing] = React.useState<Listing>({
    byRepo: {},
    key: "",
    unreadable: [],
  });
  const [pending, setPending] = React.useState(false);
  const [refusal, setRefusal] = React.useState<WorktreeRefusal | null>(null);

  // The projects to list, as a string — so the effect below is a function of
  // *which* projects there are and not of an array the polling loop rebuilds
  // every couple of seconds (`worktreeGit.ts`).
  const key = projectsKey(repos);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const listed: Record<string, GitWorktree[]> = {};
      const unreadable: string[] = [];
      for (const repo of readProjectsKey(key)) {
        const result = await gitWorktrees(repo.path);
        // A project git cannot read is not shown a refusal — nobody asked for
        // this listing, and the refusals worth showing are the ones attached
        // to a click. But it is not written down as an empty listing either:
        // that reads as "this project has no worktrees", which is what closes
        // their terminals. It gets no entry, and its id is recorded.
        if (result.ok) listed[repo.id] = result.value;
        else unreadable.push(repo.id);
      }
      if (!cancelled) setListing({ byRepo: listed, key, unreadable });
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  /** The questions both doors ask before git is asked anything: is there a
   * project, and does the plan resolve to a call. One function, so a refusal
   * the plain dialog shows is the refusal the plan's dialog shows. */
  const planCall = React.useCallback(
    (branch: string, base: string) => {
      if (selectedRepo === null) return null;
      setRefusal(null);
      const planned = planWorktree({
        base,
        branch,
        repo: selectedRepo,
        worktreeRoot,
      });
      if (planned.ok) return { plan: planned.plan, repo: selectedRepo };
      setRefusal({ entries: [], message: planned.reason });
      return null;
    },
    [selectedRepo, worktreeRoot],
  );

  const create = React.useCallback(
    async (branch: string, base: string): Promise<boolean> => {
      const call = planCall(branch, base);
      if (call === null) return false;

      setPending(true);
      const result = await gitWorktreeAdd(call.plan);
      setPending(false);
      if (!result.ok) {
        setRefusal(explainWorktreeError(result.error));
        return false;
      }
      setListing((prev) => listed(prev, call.repo.id, result.value));
      return true;
    },
    [planCall],
  );

  const createWithBrief = React.useCallback(
    async (
      branch: string,
      base: string,
      brief: { name: string; text: string },
    ): Promise<BriefedOutcome | null> => {
      const call = planCall(branch, base);
      if (call === null) return null;

      setPending(true);
      const result = await gitWorktreeAddWithBrief(
        call.plan,
        brief.name,
        brief.text,
      );
      if (!result.ok) {
        setPending(false);
        setRefusal(explainWorktreeError(result.error));
        return null;
      }
      // The listing the column renders does not come back with the worktree
      // here (the answer is one record plus a brief), so it is asked for. Left
      // in `pending` until it has: the new row is the whole point, and a
      // dialog that closed onto a column without it in would look like the
      // creation had not happened.
      const relisted = await gitWorktrees(call.repo.path);
      setPending(false);
      if (relisted.ok) {
        setListing((prev) => listed(prev, call.repo.id, relisted.value));
      }
      const { brief: written, briefRefusal, worktree } = result.value;
      return {
        branch: worktree.branch ?? branch,
        brief: written,
        briefRefusal:
          briefRefusal === null ? null : explainWorktreeError(briefRefusal),
        path: worktree.path,
      };
    },
    [planCall],
  );

  const remove = React.useCallback(
    (target: RemovableWorktree) => {
      if (selectedRepo === null) return;
      setRefusal(null);
      setPending(true);
      void (async () => {
        const result = await gitWorktreeRemove(selectedRepo.path, target);
        setPending(false);
        if (!result.ok) {
          setRefusal(explainWorktreeError(result.error));
          return;
        }
        setListing((prev) => listed(prev, selectedRepo.id, result.value));
        onRemoved?.(target.bindingId);
      })();
    },
    [selectedRepo, onRemoved],
  );

  const previewPrune = React.useCallback(async (): Promise<string[] | null> => {
    if (selectedRepo === null) return null;
    setRefusal(null);
    const result = await gitWorktreePrunePreview(selectedRepo.path);
    if (!result.ok) {
      setRefusal(explainWorktreeError(result.error));
      return null;
    }
    return result.value;
  }, [selectedRepo]);

  const prune = React.useCallback(async (): Promise<string[] | null> => {
    if (selectedRepo === null) return null;
    setRefusal(null);
    setPending(true);
    const result = await gitWorktreePrune(selectedRepo.path);
    if (!result.ok) {
      setPending(false);
      setRefusal(explainWorktreeError(result.error));
      return null;
    }
    // Re-list, because the pruned rows are exactly the ones the column is
    // still showing. Left in `pending` until it has, so the button cannot be
    // pressed against a listing that predates the prune.
    const relisted = await gitWorktrees(selectedRepo.path);
    setPending(false);
    if (relisted.ok) {
      setListing((prev) => listed(prev, selectedRepo.id, relisted.value));
    }
    return result.value;
  }, [selectedRepo]);

  const dismissRefusal = React.useCallback(() => setRefusal(null), []);

  return {
    byRepo: listing.byRepo,
    create,
    createWithBrief,
    dismissRefusal,
    pending,
    previewPrune,
    prune,
    refusal,
    remove,
    settled: listing.key === key,
    unreadable: listing.unreadable,
  };
}
