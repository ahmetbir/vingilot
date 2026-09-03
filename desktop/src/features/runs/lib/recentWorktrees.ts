// Which worktrees he has been in, most recent last (2026-09-03).
//
// His second report through the drop, on the strip of worktree chips:
// *"Worktree'ler birikmez; worktree'ler arasında geçilir."* A worktree is not
// a tab, it is the context the terminal runs in — so the chips are gone, the
// sidebar is the one place to choose a worktree, and what this module keeps
// is the thing a switcher needs that the sidebar does not have: **where he
// was just before**. Most of the time he moves between the two or three
// worktrees he was last in, not across the whole list.
//
// A memory, not a computation: visiting moves a worktree to the end; a
// worktree whose strip closed leaves. Persisted (`recentWorktreesStore.ts`) so
// a restart remembers. Idempotent and reference-stable, so a caller can lean
// on equality.

/** The order after a visit to `selected` (or none), reconciled against the
 * worktrees that actually hold tabs. Most recent LAST. Returns `order` itself
 * when nothing changes. */
export function reconcileRecent(
  order: readonly string[],
  open: readonly string[],
  selected: string | null,
): readonly string[] {
  const live = new Set(open);
  const kept = order.filter((id) => live.has(id));
  const seen = new Set(kept);
  // Worktrees with tabs that were never visited this way (a restored layout
  // from an older build) count as the least recent: they exist, but he was
  // not just in them.
  const unseen = open.filter((id) => !seen.has(id) && id !== selected);
  let next = [...unseen, ...kept];
  if (selected !== null && live.has(selected)) {
    next = [...next.filter((id) => id !== selected), selected];
  }
  const same =
    next.length === order.length && next.every((id, i) => id === order[i]);
  return same ? order : next;
}

/** The worktrees to offer as "recent": most recent first, the current one
 * left out — it is where he is, not where he could go. */
export function recentToOffer(
  order: readonly string[],
  current: string | null,
  limit = 6,
): string[] {
  const out: string[] = [];
  for (let i = order.length - 1; i >= 0 && out.length < limit; i -= 1) {
    if (order[i] !== current) out.push(order[i]);
  }
  return out;
}
