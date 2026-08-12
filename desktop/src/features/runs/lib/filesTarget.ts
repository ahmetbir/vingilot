// The stable route into the viewer from OUTSIDE the Files pane
// (vingilot/docs/plans/2026-08-12-files-pane-design.md, §6).
//
// **This is the part the search task must not reimplement.** Task 2's results
// are described as *"a door: file, line, and the matching line's text… opening
// one lands somewhere that shows the file — which means Task 3 is its
// dependency, not its sequel."* This module is that landing, and it exists
// before its caller does so that the caller is written against one landing
// rather than inventing a second.
//
// **Why a store as well as a `PaneAct`.** `onPaneAct` is the channel a pane
// already has for asking the workspace for something, and the search surface
// will be a pane, so that is its route: `{ type: "show-file", … }`. But
// `paneRegistry.tsx` says in a comment that a pane's ask has no way to carry an
// argument *to the next pane*, and that inventing the channel before one needs
// it would fix its shape blind. This is the pane that needs it. Rather than
// widen `PaneProps` for one case — every pane paying for one pane's argument —
// the argument travels through this module, which the Files pane subscribes to.
//
// That also buys the thing a pane-only channel cannot: a caller that is **not a
// pane** — a notification, a deep link, a future `buzz://file?…` — reaches the
// viewer without going through the pane system at all. One landing, two doors,
// which is the rule already in force for New worktree, Prune and Remove
// project.
//
// **It is a request, not a state.** `requestFile` is an event the pane consumes
// once and clears: asking twice for the same file must show it twice (he
// clicked the same search hit again), and a value that stayed set would make
// the second click do nothing. That is why `bump` exists and why `taken()` is
// part of the surface rather than something the pane does with a ref.

/** Where to land. `worktree` is the checkout's own directory — the same string
 * `PaneProps.cwd` carries — because a target is meaningless without it: two
 * worktrees of one project both have `src/main.rs`. */
export interface FileTarget {
  worktree: string;
  /** Worktree-relative, as the backend takes it. */
  path: string;
  /** 1-based, or `null` for "the top of the file".
   *
   * `null` is not "line 1 emphasised": a file opened from the tree has no
   * interesting line, and inventing one would put a highlight on a row he did
   * not ask about. */
  line: number | null;
}

/** A target plus the count that makes a repeat distinguishable from the
 * original. The pane compares `bump`, not the target. */
export interface FileRequest extends FileTarget {
  bump: number;
}

type Listener = (request: FileRequest) => void;

let current: FileRequest | null = null;
let bump = 0;
const listeners = new Set<Listener>();

/** Ask the workspace to show a file. Safe to call from anywhere, including
 * before the pane exists: the request is held, and a pane that mounts later
 * reads it with `pendingFile()`. */
export function requestFile(target: FileTarget): FileRequest {
  bump += 1;
  const request: FileRequest = { ...target, bump };
  current = request;
  // A listener that throws must not stop the others from being told, and must
  // not take down the click that led here.
  for (const listen of [...listeners]) {
    try {
      listen(request);
    } catch {
      // The pane reports its own failures; a subscriber's is not the caller's.
    }
  }
  return request;
}

/** What has been asked for and not yet consumed, or `null`. Read by a pane on
 * mount — the request may have been made by the palette on the way to choosing
 * this pane, which is exactly the sequence `RunsScreen` performs. */
export function pendingFile(): FileRequest | null {
  return current;
}

/** Consume the pending request. Called by the pane once it has acted on it, so
 * that remounting the pane (a worktree switch, a solo) does not re-open a file
 * he has since navigated away from. */
export function takeFile(): FileRequest | null {
  const taken = current;
  current = null;
  return taken;
}

/** Is this request the pane standing in `cwd` should act on?
 *
 * **Its own function because the `false` branch is the one that matters and the
 * one nothing could reach.** Two checkouts of one project both have
 * `src/main.rs`, and landing on the wrong one silently would be worse than not
 * landing at all — but a browser fixture with a single worktree can only ever
 * produce the `true` side, so as a line inside the component the guard could be
 * deleted with every test still green. Task 2's search results are exactly the
 * caller that produces a target for a checkout that is not on screen.
 *
 * A pane whose `cwd` has not resolved yet lands on nothing rather than on
 * everything: `null` is "no answer", never a wildcard. */
export function shouldLand(request: FileTarget, cwd: string | null): boolean {
  if (cwd === null) return false;
  return request.worktree === cwd;
}

export function subscribeFileTarget(listen: Listener): () => void {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
}

/** Drop everything. A module-level value survives React remounting — the
 * community-switch rule this app has a whole section about — and a target
 * naming a worktree from the community just left must not be waiting when the
 * next one's Files pane mounts.
 *
 * **Registered in `resetCommunityState()`**
 * (`features/communities/useCommunityInit.ts`, declared in
 * `vingilot/seams.yaml`), which is the one list that runs on a community
 * change. Said here because the sentence above is otherwise a claim about a
 * caller: an exported reset nothing calls is a documented invariant that is not
 * enforced anywhere, which is what this was until the wiring landed. */
export function resetFileTargets(): void {
  current = null;
  bump = 0;
  listeners.clear();
}
