// The one line that names the open file, and holds the controls that are about
// THAT file
// (split out of `FileViewer.tsx` on 2026-09-01, when a picture became a second
// thing the viewer can show).
//
// **Split rather than copied.** A raster picture has no text, so it never
// reaches `FileBody` — `file_read` refuses a `.png` as binary, correctly — and
// it still has to be named, sized, previewed and opened in an editor by the same
// header, in the same places, at the same widths. Two headers that agreed today
// would disagree the first time either was touched. So this is one component
// with the pieces both callers have (the path, the meta, the escape hatch) and a
// slot for the piece only one of them ever has (the Source⇄Preview toggle, which
// a picture with no source form is not offered).

import type { ReactNode } from "react";

import { labelParts } from "@/features/runs/lib/worktreeDiff";
import { OpenInEditor } from "@/features/runs/ui/OpenInEditor";

export function ViewerHeader({
  control,
  cwd,
  line,
  meta,
  path,
}: {
  /** The Source⇄Preview toggle, or `null` for a file that has nothing to toggle
   * between. **Absent rather than disabled**, which is the rule the markdown
   * toggle already keeps: a control that explained its own uselessness would be
   * the noise the plain-note is careful not to add. */
  control: ReactNode;
  /** The checkout the open file belongs to — the escape hatch's other half of a
   * target, and meaningless without it: two worktrees of one project both have
   * `src/main.rs`. */
  cwd: string;
  line: number | null;
  /** The right-hand facts, already formatted — lines and size for a file, size
   * alone for a picture, which has no lines and must not be given a made-up
   * count. */
  meta: string;
  path: string;
}) {
  const parts = labelParts(path);
  return (
    <div className="flex shrink-0 items-baseline gap-2 border-b border-border/60 px-2 py-1">
      {/* The shared truncation rule: the directory dims and gives way, the
          basename stays bright — the same `labelParts` arrangement the Diff
          pane's header keeps, because this line is the only place the open
          file is named at this width. */}
      <span
        className="flex min-w-0 items-baseline text-xs"
        data-testid="files-viewer-path"
        title={path}
      >
        {parts.lead === "" ? null : (
          <span className="min-w-0 truncate text-muted-foreground">
            {parts.lead}
          </span>
        )}
        <span className="max-w-full shrink-0 truncate text-foreground">
          {parts.name}
        </span>
      </span>
      <span className="ml-auto shrink-0 text-2xs tabular-nums text-muted-foreground">
        {meta}
      </span>
      {control}
      {/* **The escape hatch, where the file is named.** Not hover-revealed
          here: this is a header rather than a row, the file it acts on is the
          one the whole pane is showing, and a control that appeared only under
          the pointer would be a door he had to already know about. `line` is
          the viewer's landing line, so "open in Cursor" from a search hit
          arrives at the hit — which is the entire point of the rung (ADR-005,
          rung 3), and the thing `open -a` cannot do. */}
      <OpenInEditor
        line={line}
        path={path}
        testid="files-open-in-editor"
        worktree={cwd}
      />
    </div>
  );
}
