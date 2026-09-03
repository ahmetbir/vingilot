// Where the workspace opens (2026-09-04): the worktree he was last in, not
// the board.
//
// > *"su deck landing page kismi tam bi faia. kullanilamaz durumda. olmasa
// > daha iyi olur diyecem neredeyse."*
//
// The board (`TriageBoard`) is every worktree ranked by signal — a fine thing
// to consult and a bad thing to be made to walk through on every open when
// what he wants is the terminal he left. So the first landing is the most
// recent worktree the memory holds (`recentWorktrees.ts`) that the workspace
// still knows; the board stays one act away, behind the Deck row and ⌘K's
// Overview. Nothing is guessed: with no memory, or a memory of worktrees
// that no longer exist, the answer is `null` and the board is the landing it
// always was.

/** What the workspace knows a binding id belongs to. */
export interface LandingIndex {
  get(bindingId: string): { repo: { id: string } } | undefined;
  /** How many worktrees the workspace knows — zero is "not answered yet". */
  readonly size: number;
}

/** The most recent remembered worktree the index still holds, or `null`. */
export function homeLanding(
  recent: readonly string[],
  index: LandingIndex,
): { repoId: string; bindingId: string } | null {
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const entry = index.get(recent[i]);
    if (entry !== undefined) {
      return { bindingId: recent[i], repoId: entry.repo.id };
    }
  }
  return null;
}
