// The one place a unified patch is drawn
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 4).
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
// **What is NOT here.** How a patch line is classified is `lib/runModel.ts`'s
// `diffView`, and whether a narrow pane wraps instead of scrolling sideways is
// `lib/diffLayout.ts`'s `patchWrapsAt`. This component takes the answers and
// draws them; it decides nothing, which is what lets three panes agree.

import { diffView } from "@/features/runs/lib/runModel";
import type { DiffLineKind } from "@/features/runs/lib/runModel";

const DIFF_LINE_CLASS: Record<DiffLineKind, string> = {
  add: "text-emerald-600 dark:text-emerald-400",
  ctx: "text-foreground",
  del: "text-destructive",
  hunk: "font-bold text-muted-foreground",
  meta: "text-muted-foreground",
};

interface Props {
  /** The raw unified patch, as the backend answered it. */
  patch: string;
  /** Wrap long lines instead of scrolling sideways. Decided by the caller from
   * its own measured width (`patchWrapsAt`), because the pane knows how wide it
   * is and this component does not. */
  wraps: boolean;
  /** Which patch box this is, so a spec can name it. Both callers pass one; two
   * boxes with the same testid would be a spec that cannot say which pane it is
   * reading. */
  testid: string;
}

export function PatchView({ patch, testid, wraps }: Props) {
  const lines = diffView(patch).lines;
  return (
    <div
      className="min-h-0 flex-1 overflow-auto px-4 py-2"
      // Which of the two renderings is up, so a spec can say the mode out loud
      // instead of inferring it from a scroll width that could also be zero
      // because the fixture's lines are short.
      data-testid={testid}
      data-wrapped={wraps ? "true" : "false"}
    >
      <div
        className={`flex flex-col font-mono text-xs ${wraps ? "w-full" : "w-max min-w-full"}`}
      >
        {lines.map((line, i) => (
          <span
            // Wrapped, the hanging indent is what keeps a diff readable: the
            // second visual line of a `+` line starts under the code and not
            // under the marker column, so a continuation is never mistaken for
            // a context line.
            className={`${wraps ? "-indent-4 whitespace-pre-wrap break-words pl-4" : "whitespace-pre"} ${DIFF_LINE_CLASS[line.kind]}`}
            // biome-ignore lint/suspicious/noArrayIndexKey: patch lines are positional content, never reordered
            key={i}
          >
            {line.text === "" ? " " : line.text}
          </span>
        ))}
      </div>
    </div>
  );
}
