// The cross-worktree overlap mark — drawn from `lib/worktreeOverlap.ts` and
// nothing else.
//
// **Why this is not a fifth `AttentionDot` state.** The dot answers "where is
// my attention needed": four states, a written precedence, a project rollup,
// and a place on the triage board. An overlap is none of those — nothing is
// waiting on the owner, nothing is blocked, and two worktrees off one feature
// branch touching the same file is often exactly right. Adding it to that
// taxonomy would have forced three wrong answers (where it ranks, what the
// rollup says, what the board does with it); `lib/worktreeOverlap.ts`'s header
// argues that in full. So it is a separate component, a separate derivation,
// and it reaches neither `rollupMark` nor `triageModel`.
//
// **Which is why it is a glyph and not a shape.** `AttentionDot` owns four
// forms — diamond, filled circle, square, hollow ring — and a fifth would read
// as a fifth attention state however it were coloured, because that box is
// where the owner has learned to look for one. This draws a character instead,
// `⋈`, in `muted-foreground`: outside the shape vocabulary, outside the hue
// vocabulary (rose/emerald/amber are all spoken for), and legible in greyscale
// for the same reason the shapes are — it is not carrying its meaning in
// colour at all. It sits after the label rather than before it, so the dot
// column stays exactly as wide and as meaningful as it was.
//
// The words are the overlap's own (`WorktreeOverlap.detail`), so the title
// names the files it came from and cannot drift. Like `AttentionDot` this is
// `aria-hidden` and the row repeats the shorter sentence in its own `title` —
// the mark decorates a statement the row already makes in words.

import type { WorktreeOverlap } from "@/features/runs/lib/worktreeOverlap";

export function OverlapMark({
  className = "",
  overlap,
}: {
  /** Margins only; the size is this component's, so two surfaces cannot draw
   * the same fact at two sizes. */
  className?: string;
  overlap: WorktreeOverlap;
}) {
  return (
    <span
      aria-hidden="true"
      className={`shrink-0 text-2xs leading-none text-muted-foreground/70 ${className}`}
      data-overlap-files={overlap.files.length}
      data-testid="worktree-overlap"
      title={overlap.detail}
    >
      ⋈
    </span>
  );
}
