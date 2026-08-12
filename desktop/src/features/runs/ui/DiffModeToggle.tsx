// The one control that chooses between a unified patch and a split one
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 2).
//
// **It lives in the patch header, and it is one component for both panes.** The
// Diff pane and the History pane each already draw a header over their patch —
// the open file's path on the left, the meta on the right — in the shape the
// polish plan's vocabulary fixed for a section header (`ui/PaneSection.tsx`:
// title left, meta right, one optional control, `border-border/60` under it).
// This is that one optional control, in both of them, so the gesture is in the
// same place whichever patch he is reading.
//
// **A toggle, not a pair of tabs.** `aria-pressed` carries the state and the
// label never changes, which is the same reason `worktree-diff-read` keeps its
// label while a read is in flight: a control that renames itself flickers for
// the whole session, and a two-tab segmented control would spend twice the width
// in a header that has 435px on his laptop.
//
// **Disabled, with the reason in words — never hidden.** Task 2: "Below it, the
// toggle says why it is disabled rather than disappearing." A control that
// vanishes at some widths teaches nothing except that the app is inconsistent;
// one that is visibly unavailable and states its own precondition teaches the
// precondition, which is the thing he can act on (⇧⌥⌘B, or the divider). The
// sentence is `diffLayout.ts`'s, with the arithmetic behind it in the `title`,
// so the number and the reason for the number cannot drift apart.

import {
  SPLIT_REFUSAL_DETAIL,
  splitRefusal,
} from "@/features/runs/lib/diffLayout";
import { setDiffMode } from "@/features/runs/lib/diffMode";
import { useDiffMode } from "@/features/runs/lib/useDiffMode";

const BUTTON_CLASS =
  "shrink-0 rounded border border-border/60 px-1.5 py-0.5 text-2xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

export function DiffModeToggle({
  paneWidth,
  testid,
}: {
  /** The pane's own measured width. The pane knows it and this component does
   * not, exactly as with `PatchView`'s `wraps`. */
  paneWidth: number;
  testid: string;
}) {
  const choice = useDiffMode();
  const refusal = splitRefusal(paneWidth);
  const split = choice === "split" && refusal === null;
  return (
    <>
      <button
        aria-pressed={split}
        className={`${BUTTON_CLASS} ${
          refusal !== null
            ? "cursor-default text-muted-foreground/60"
            : split
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        }`}
        data-testid={testid}
        disabled={refusal !== null}
        onClick={() => setDiffMode(split ? "unified" : "split")}
        title={
          refusal !== null
            ? `${refusal} ${SPLIT_REFUSAL_DETAIL}`
            : split
              ? "One column again — remembered for every diff"
              : "Two columns, old beside new — remembered for every diff"
        }
        type="button"
      >
        Split
      </button>
      {refusal === null ? null : (
        // Its own line of the header rather than a squeeze beside the path:
        // `basis-full` in a wrapping header, which is the arrangement the Diff
        // pane's own form already uses for its summary line. At 435px this is
        // one line of `text-2xs`; the path above it keeps its room.
        <span
          className="min-w-0 basis-full text-2xs text-muted-foreground"
          data-testid={`${testid}-why`}
        >
          {refusal}
        </span>
      )}
    </>
  );
}
