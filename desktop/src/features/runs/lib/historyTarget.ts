// The route into the History pane's patch box from OUTSIDE it
// (vingilot/docs/plans/2026-08-14-pane-nav-absorb.md, §3.1).
//
// **`filesTarget.ts`'s shape, for `filesTarget.ts`'s reason.** The status and
// commit lists live in the Deck sidebar's History accordion member now; the
// patch box stays in the pane, shared with a commit's patch exactly as before
// ("do not fork the patch component", unmoved rule, new geometry). Selecting a
// row in the sidebar must open that patch in a pane that may not be mounted
// yet — the sidebar files the target here first, then asks the workspace to
// bring the History pane forward, the same two moves `show-file` makes. A
// request, not a state: picking the same row twice must open it twice, which
// is what `bump` is for.
//
// **`statusGeneration` is the cache invariant that used to be a single ref.**
// When list and patch shared one component, `readTheStatus` emptied the
// pane's cached HEAD diff — by then it was a reading of a tree that had
// moved. Split across two components, the sidebar stamps every status pick
// with the generation of the status read it came from, and the pane keeps its
// HEAD-diff cache only per generation: a pick from a fresher read never lands
// on a stale cache, and a Reread in the sidebar retires the pane's cache
// without either component holding a reference to the other.

import type { Commit, StatusEntry } from "@/features/runs/lib/historyModel";

export type HistoryPick =
  | { kind: "commit"; commit: Commit }
  | { kind: "status"; entry: StatusEntry; statusGeneration: number };

export interface HistoryTarget {
  /** The checkout's own directory — the same string `PaneProps.cwd` carries.
   * Two worktrees of one project both have `src/a.rs`. */
  worktree: string;
  pick: HistoryPick;
}

export interface HistoryRequest extends HistoryTarget {
  bump: number;
}

type Listener = (request: HistoryRequest) => void;

let current: HistoryRequest | null = null;
let bump = 0;
const subscribers = new Set<Listener>();

/** Ask the workspace to show a patch. Safe to call before the pane exists:
 * the request is held, and a pane that mounts later reads it with
 * `pendingHistoryPatch()`. */
export function requestHistoryPatch(target: HistoryTarget): HistoryRequest {
  bump += 1;
  const request: HistoryRequest = { ...target, bump };
  current = request;
  for (const listen of [...subscribers]) {
    try {
      listen(request);
    } catch {
      // The pane reports its own failures; a subscriber's is not the click's.
    }
  }
  return request;
}

/** What has been asked for and not yet consumed, or `null`. */
export function pendingHistoryPatch(): HistoryRequest | null {
  return current;
}

/** Consume the pending request, so a remounting pane does not re-open a patch
 * the owner has since navigated away from. */
export function takeHistoryPatch(): HistoryRequest | null {
  const taken = current;
  current = null;
  return taken;
}

/** Is this request the pane standing in `cwd` should act on? `null` is "no
 * answer", never a wildcard — `filesTarget.shouldLand`'s rule, restated here
 * because that one is typed to a `FileTarget`. */
export function historyShouldLand(
  request: HistoryTarget,
  cwd: string | null,
): boolean {
  if (cwd === null) return false;
  return request.worktree === cwd;
}

export function subscribeHistoryTarget(listen: Listener): () => void {
  subscribers.add(listen);
  return () => {
    subscribers.delete(listen);
  };
}

/** Drop everything. Registered in `resetCommunityState()`
 * (`features/communities/useCommunityInit.ts`) beside `resetFileTargets`: a
 * target naming a worktree from the community just left must not be waiting
 * when the next one's History pane mounts. */
export function resetHistoryTargets(): void {
  current = null;
  bump = 0;
  subscribers.clear();
}
