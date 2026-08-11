// The dot itself — drawn from `lib/attentionSignal.ts` and nothing else
// (vingilot/docs/plans/2026-08-09-signals-and-dashboards.md, Task 1).
//
// **Shape carries the state, not colour alone.** Four forms that survive being
// read in greyscale, or by someone who cannot separate the hues: a diamond
// needs you, a filled circle is working, a square is dirty, a hollow ring is
// quiet. The square kept its meaning from the marker this column already had.
//
// **No dot is a state this component draws.** When `mark.state` is `null`
// nothing has answered about that worktree, so no mark appears — but the box is
// still reserved, because a label that shifts left while git is slow is a row
// moving for a reason the owner cannot see.
//
// Both themes: emerald for working and amber for dirty are the island's own —
// `RunList`'s `live` hue and the amber square this column already drew for an
// uncommitted tree. Rose is new here. needs-you had no hue to inherit: the Runs
// tab paints `paused`/`blocked` amber (`SEMANTIC_DOT_CLASS`'s `attn`), and on
// this surface amber is spoken for by dirty. Amber therefore says one thing in
// the run rail and another here, which is why the shapes above carry the state
// and the hue only seconds them. The quiet ring is `muted-foreground`, a theme
// token rather than a fixed grey.
//
// The words are the mark's own (`AttentionMark.sentence`), so the tooltip names
// the signal the dot came from and cannot drift from it. The mark is
// `aria-hidden` and its sentence is repeated in the row's own `title` by all
// three callers — `ProjectRow`, `WorktreeRow`, `TriageBoard`: the dot
// decorates a statement the row already makes in words.

import type {
  AttentionMark,
  AttentionState,
} from "@/features/runs/lib/attentionSignal";

const MARK_CLASS: Record<AttentionState, string> = {
  dirty: "rounded-sm bg-amber-500",
  "needs-you": "rotate-45 bg-rose-500",
  quiet: "rounded-full border border-muted-foreground/50",
  working: "rounded-full bg-emerald-500 motion-safe:animate-pulse",
};

export function AttentionDot({
  className = "",
  mark,
}: {
  /** Where the caller needs the box to sit — margins only; the size is this
   * component's, so two surfaces cannot draw the same state at two sizes. */
  className?: string;
  mark: AttentionMark;
}) {
  return (
    <span
      aria-hidden="true"
      className={`h-2 w-2 shrink-0 ${className} ${
        mark.state === null ? "" : MARK_CLASS[mark.state]
      }`}
      data-attention={mark.state ?? "none"}
      title={mark.sentence === "" ? undefined : mark.sentence}
    />
  );
}
