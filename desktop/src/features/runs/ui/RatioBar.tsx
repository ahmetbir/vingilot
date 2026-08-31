// The mockup's `.barmini` — GitHub's change-ratio bar, five blocks of it
// (DIFF-TAB-BRIEF §1 and §3).
//
// What each block IS is `lib/diffTab.ts`'s `ratioBlocks`, which is where the
// one rule that is not plain arithmetic lives (a side with any lines at all
// takes a block, so a 200-line addition with one deletion cannot draw as five
// greens). This file is the drawing and nothing else.
//
// **The hues are the theme's diff tokens**, `--status-added` /
// `--status-deleted`, the same two the row tint, the numstat and the change
// square already speak — never the mockup's fixed `#3fb950`. A second green
// invented here is how one surface goes emerald while the next goes teal.
//
// `aria-hidden` and a `title`: the bar restates the `+N −N` beside it, so a
// screen reader that read both would read the same fact twice; a pointer has no
// other way to learn what the blocks mean.

import type { RatioBlock } from "@/features/runs/lib/diffTab";

const TONE: Record<RatioBlock, string> = {
  added: "bg-status-added",
  deleted: "bg-status-deleted",
  none: "bg-foreground/[.12]",
};

export function RatioBar({
  blocks,
  title,
}: {
  blocks: readonly RatioBlock[];
  title: string;
}) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center gap-0.5"
      data-ratio-bar={blocks.join(",")}
      title={title}
    >
      {blocks.map((block, at) => (
        <span
          className={`h-2.5 w-[7px] rounded-sm ${TONE[block]}`}
          // biome-ignore lint/suspicious/noArrayIndexKey: five positional blocks, never reordered
          key={at}
        />
      ))}
    </span>
  );
}
