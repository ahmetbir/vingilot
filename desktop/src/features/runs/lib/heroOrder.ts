// The hero strip's order: which open worktrees stand on the one tab strip,
// and in what order (2026-09-03; the owner's "terminali sabit tutup worktreeye
// basınca o worktree icin ... tab mi eklese sadece").
//
// **The strip is fixed; a worktree joins it.** Before this, a worktree owned a
// strip and switching worktrees swapped the whole thing — the terminal area
// changed under him every time. Now there is one strip: every worktree with
// tabs open stands on it as a chip, the focused worktree's chip is expanded
// into its tabs, and pressing a worktree in the nav focuses its chip, adding
// it at the end if it was not there. The tab layouts underneath are untouched
// — still keyed by worktree, still per-worktree ordinals, still the same
// sessions — so this layer is an ORDER over keys the tab model already has,
// and nothing on disk changes shape.
//
// **The order is a memory, not a computation.** Sorted keys would reshuffle
// the strip whenever a worktree appeared, which is the disruption this exists
// to end. So the order is kept: a worktree keeps its place until it leaves,
// and a new one goes to the end. `reconcileHeroOrder` is the only rule, and
// it is idempotent and reference-stable so a caller can lean on equality.

/** The order after reconciling with what the tab model actually holds.
 *
 * - Worktrees no longer in `open` are dropped (their strips closed).
 * - Worktrees in `open` but not yet in `order` are appended, `selected` last
 *   so the one just visited is the one at the end of the strip.
 * - Returns `order` itself when nothing changes. */
export function reconcileHeroOrder(
  order: readonly string[],
  open: readonly string[],
  selected: string | null,
): readonly string[] {
  const live = new Set(open);
  const kept = order.filter((id) => live.has(id));
  const seen = new Set(kept);
  const joining = open.filter((id) => !seen.has(id) && id !== selected);
  if (selected !== null && live.has(selected) && !seen.has(selected)) {
    joining.push(selected);
  }
  if (joining.length === 0 && kept.length === order.length) return order;
  return [...kept, ...joining];
}

/** Where to stand after leaving `id`: the chip to its left, else the one to
 * its right, else nowhere — the same rule a tab strip uses for a closed tab. */
export function neighbourOf(
  order: readonly string[],
  id: string,
): string | null {
  const at = order.indexOf(id);
  if (at === -1) return null;
  if (at > 0) return order[at - 1];
  return order.length > 1 ? order[1] : null;
}
