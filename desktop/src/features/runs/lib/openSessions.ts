// Which PTY sessions the app is holding open, at module scope — outliving
// every component that reads it.
//
// Why not React state. `RunsScreen` owns the *decision* to open and close a
// session, but it unmounts on any route change away from /runs and on the
// community-key remount in App.tsx. A session list kept in its `useState`
// is forgotten on the way out, and a worktree removed from the workspace
// while the owner is elsewhere can then never be matched against the open set
// — its shell runs unreferenced for the app's lifetime. Keeping the ids here
// means the next mount picks the list back up and closes what really went
// away.
//
// **Deliberately not reset on a community switch**, unlike the singletons in
// `resetCommunityState()` (see CLAUDE.md, "Community Switching"). Those hold
// relay-scoped data. A PTY session is keyed by a worktree binding id from the
// coordinator workspace and runs a shell in a directory on this machine;
// none of that changes when the owner points the app at a different relay,
// and killing their shells because they switched community would be the bug,
// not the fix.

let openSessionIds: readonly string[] = [];

/** The open session ids, in the order their worktrees were first visited. */
export function readOpenSessions(): readonly string[] {
  return openSessionIds;
}

/** Replace the open set. Callers pass the whole list rather than mutating it,
 * so this stays a mirror of the owning component's state and never becomes a
 * second source of truth to reconcile. */
export function writeOpenSessions(sessionIds: readonly string[]): void {
  openSessionIds = sessionIds;
}
