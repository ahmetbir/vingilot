// The mockup's `.chgsq` — the 9px rounded square at the end of a `.frow`
// (Vingilot.html:230-241), in the one place both file rows draw it from
// (redesign P4.4: "the file row (path lead/name, +N −N, change square) stays
// the header for its hunks").
//
// **What it means, and it is a reading rather than a decoration.** The mockup
// paints it green (`.chgsq.g`) on two rows and red (`.chgsq.r`) on a third,
// with no rule stated. The rule here is the only one the numbers support: a
// file that GREW is green, a file that SHRANK is red. Nothing else on the row
// says that — `+17 −13` and `+188 −21` are both "green and red" until you read
// both numbers and subtract, which is exactly the work a glance is meant to
// save. A file with no textual change at all (binary, a mode change) gets the
// muted square: it changed, and not by lines.
//
// Its own file rather than a copy in each pane, because it is the same claim
// on the Diff panel's list and on the commit patch's per-file header, and a
// second copy is how green comes to mean two things.

import type { DiffFile } from "@/features/runs/lib/worktreeDiff";

export function ChangeSquare({
  file,
}: {
  file: Pick<DiffFile, "additions" | "binary" | "deletions">;
}) {
  const net = file.additions - file.deletions;
  const [tone, title] = file.binary
    ? ["bg-muted-foreground/40", "binary — changed, but not by lines"]
    : net > 0
      ? ["bg-status-added/60", `${net} lines longer`]
      : net < 0
        ? ["bg-status-deleted/60", `${-net} lines shorter`]
        : ["bg-muted-foreground/40", "the same length"];
  return (
    <span
      aria-hidden="true"
      className={`h-[9px] w-[9px] shrink-0 rounded-[2.5px] ${tone}`}
      data-change-square={
        file.binary ? "binary" : net > 0 ? "grew" : net < 0 ? "shrank" : "even"
      }
      title={title}
    />
  );
}
