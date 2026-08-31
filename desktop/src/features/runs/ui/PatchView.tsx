// The one place a patch is drawn
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 4;
// vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 2).
//
// **This file exists because Task 4 forbade the alternative.** A commit is
// another patch source, and the pane that shows one had to render it "with the
// SAME renderer the diff pane uses (do not fork the patch component)". Until now
// the renderer was twenty lines inside `WorktreeDiffPanel.tsx`, which is not a
// component anything else can reach — so "reuse it" and "copy it" looked the
// same from the outside, and the copy is the one that drifts: one of the two
// gets the colour for a `\ No newline at end of file` marker, or the hanging
// indent, or the `data-wrapped` a spec reads, and the other does not.
//
// So it moved here whole, with no change to what it draws, and both callers
// construct it. `WorktreeDiffPanel` renders a worktree's changes; `HistoryPane`
// renders a commit's and a source-control file's. Three surfaces, one patch.
//
// **Task 2 added a second layout, and NOT a second renderer.** The plan's own
// self-review named the way this goes wrong: "Task 2 shipping a second diff
// renderer. The commit diff, the worktree diff and the split view are one
// renderer with two layouts, or the next patch feature gets built twice and
// drifts."
//
// **P4.8 is what that warning looked like when it came true.** The two layouts
// never forked the component, but the FEATURES only ever landed in one of them:
// P4.6 gave the unified rows a word-level highlight, a comment affordance,
// review threads and windowing, and split got none — so the same diff showed
// different information depending on a toggle that is supposed to be only about
// layout. The rule that failure names is worth stating here, where the toggle
// is: **a rendering mode may change the shape of the information, never its
// content — and never its vocabulary.** It is kept structurally rather than by
// discipline: the row decoration is `ui/PatchRow.tsx`'s and both layouts
// consume it, and both draw the SAME rows — the split model pairs the unified
// rows rather than re-deriving its own from the patch, so "ignore whitespace",
// the markup keys, the focused row and every thread anchor reach both.
//
// This file is left with the decision and the box it happens in: one `mode`
// prop, one set of rows, one `data-mode`, one scroller.
//
// **What is NOT here.** How a patch line is classified is `lib/runModel.ts`'s
// `diffView`; what a unified row IS is `lib/unifiedDiff.ts`'s `unifiedRows`;
// how those rows become aligned two-column rows is `lib/splitDiff.ts`'s
// `pairRows`; whether a narrow pane wraps instead of scrolling sideways is
// `lib/diffLayout.ts`'s `patchWrapsAt`, and whether split is offered at all is
// its `splitFitsAt`. This component takes the answers and draws them.

import type { DiffMode } from "@/features/runs/lib/diffMode";
import { SplitBody } from "@/features/runs/ui/PatchSplit";
import {
  UnifiedBody,
  type UnifiedProps,
} from "@/features/runs/ui/PatchUnified";

interface Props
  extends Pick<
    UnifiedProps,
    "focused" | "markup" | "onComment" | "renderAfter" | "rows" | "window"
  > {
  /** The raw unified patch, as the backend answered it. */
  patch: string;
  /** Wrap long lines instead of scrolling sideways. Decided by the caller from
   * its own measured width (`patchWrapsAt`), because the pane knows how wide it
   * is and this component does not.
   *
   * **Read in both layouts since P4.8.** Split used to ignore it and wrap
   * always, which is what put the owner's two screenshots side by side: at a
   * wide pane one cell of a pair re-flowed to three lines and the other to one,
   * so the two columns stopped lining up. */
  wraps: boolean;
  /** One column or two. The caller resolves it (`effectiveDiffMode` against
   * `splitFitsAt`) for the same reason it resolves `wraps`: the width is the
   * pane's to know.
   *
   * Optional and defaulting to `unified`, so a patch box added anywhere else
   * keeps working and gets the layout that always fits. */
  mode?: DiffMode;
  /** Which patch box this is, so a spec can name it. Both callers pass one; two
   * boxes with the same testid would be a spec that cannot say which pane it is
   * reading. */
  testid: string;
  /** The file this patch is OF, for the one thing a patch cannot tell about
   * itself: which language to highlight it as (redesign P4.4).
   *
   * Optional, and the honest fallback is plain text — a patch box rendered
   * somewhere with no path to hand still draws, it simply draws uncoloured,
   * which is what this component did everywhere before Shiki arrived. */
  path?: string;
}

export function PatchView({ mode = "unified", testid, ...body }: Props) {
  return (
    <div
      // The scroller the patch lives in, whichever layout is inside it — and
      // since P4.8b, in split with wrapping off, no longer the horizontal one.
      // A shared horizontal scroll was what made an added file's code start
      // eleven screens to the right: both halves moved together because both
      // halves were one max-content box. `PatchSplit` now scrolls its two
      // columns itself, so nothing here overflows sideways and this box is left
      // doing what it does in every other mode.
      className="min-h-0 flex-1 overflow-auto px-4 py-2"
      // Which of the renderings is up, so a spec can say the mode out loud
      // instead of inferring it from a scroll width that could also be zero
      // because the fixture's lines are short.
      data-mode={mode}
      data-testid={testid}
      // One reading of one decision, in both modes. It used to be hard-coded
      // `true` under split, which was a fair description of what split did and
      // a false one of what the reader asked for.
      data-wrapped={body.wraps ? "true" : "false"}
    >
      {mode === "split" ? <SplitBody {...body} /> : <UnifiedBody {...body} />}
    </div>
  );
}
