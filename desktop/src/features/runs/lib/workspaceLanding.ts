// **"Open this when the workspace is next on screen"** — the route into
// /workspace from a palette that is not standing in it
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2).
//
// ⌘K from a channel can offer a project or a worktree, and pressing Enter on
// one has to do two things in order: navigate to /workspace, and *then* select
// it. The navigation is the router's; the selection is `RunsScreen`'s, and that
// component does not exist yet at the moment the row is run.
//
// So the selection is filed here and consumed on the other side, which is
// exactly the shape `filesTarget.ts` already uses for the viewer — same reasons,
// same three functions (`request`, `pending`, `take`), same "it is a request,
// not a state". A caller that is not a component reaches the workspace without
// anything widening a props chain to carry it.
//
// **It is taken once.** Selecting the same project twice must select it twice
// (he navigated away in between), and a value that stayed set would have the
// workspace re-select on every remount — dragging him off the worktree he had
// since opened, which is the exact bug `selectRepo`'s idempotence guard exists
// to prevent from the other direction.
//
// **A file is not landed here.** `filesTarget.requestFile` is the one door into
// the viewer and this module does not become a second one: a row that opens a
// file files *both*, the worktree here and the file there, in that order.

export interface WorkspaceLanding {
  /** The project to open, or `null` to leave the current selection alone. */
  repoId: string | null;
  /** The worktree to open under it, or `null`. */
  bindingId: string | null;
  /** Bring the Files pane forward on arrival — set by a row that also filed a
   * file target, so the pane that reads it is the pane on screen. */
  showFiles: boolean;
}

let pending: WorkspaceLanding | null = null;
type Listener = (landing: WorkspaceLanding) => void;
const listeners = new Set<Listener>();

/** Ask the workspace to land somewhere. Safe to call before the workspace
 * exists — which is the whole point of it. */
export function requestLanding(landing: WorkspaceLanding): void {
  pending = landing;
  for (const listen of [...listeners]) {
    try {
      listen(landing);
    } catch {
      // A subscriber's failure must not take down the click that led here.
    }
  }
}

/** What has been asked for and not consumed, or `null`. */
export function pendingLanding(): WorkspaceLanding | null {
  return pending;
}

/** Consume it. */
export function takeLanding(): WorkspaceLanding | null {
  const taken = pending;
  pending = null;
  return taken;
}

export function subscribeLanding(listen: Listener): () => void {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
}

/** Drop everything. A pending landing names a project id, and an id from the
 * community just left must not still be waiting when the next one's workspace
 * mounts — the same argument `filesTarget.ts`'s reset makes, and it is wired
 * into `resetCommunityState()` beside it. */
export function resetWorkspaceLandings(): void {
  pending = null;
  listeners.clear();
}
