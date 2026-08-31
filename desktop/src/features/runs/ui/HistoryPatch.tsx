// The History pane's patch box — a commit's patch or a status file's, drawn by
// the component the Diff pane draws with (PatchView), never a second renderer.
//
// Split out of `HistoryPane.tsx` when that file reached the 1000-line ratchet:
// the pane file keeps the effects and the layout, this one keeps the patch
// half's rendering. What a patch means, what a note says and which files are in
// a commit's answer are all `lib/historyModel.ts`'s and `lib/worktreeDiff.ts`'s
// decisions, exactly as they were before the split.

import * as React from "react";

import type { DiffMode } from "@/features/runs/lib/diffMode";
import {
  type CommitPatch,
  commitPatchNote,
  commitSubject,
  type FilePatch,
  STATUS_BASE,
} from "@/features/runs/lib/historyModel";
import {
  type DiffFile,
  fileNote,
  labelParts,
} from "@/features/runs/lib/worktreeDiff";
import { ChangeSquare } from "@/features/runs/ui/ChangeSquare";
import { DiffModeToggle } from "@/features/runs/ui/DiffModeToggle";
import { PaneEmpty } from "@/features/runs/ui/PaneEmpty";
import { PatchView } from "@/features/runs/ui/PatchView";

/** One file inside a commit's answer — `WorktreeDiff["files"]`'s member,
 * named here because `FileSection` takes exactly one and nothing else. */
type FilePatchFile = DiffFile;

export type PatchState =
  | { status: "none" }
  | { status: "reading" }
  | { status: "commit"; answer: CommitPatch }
  | { status: "file"; file: FilePatch }
  | { status: "refused"; note: string };

export function Patch({
  mode,
  onBack,
  paneWidth,
  state,
  wraps,
}: {
  /** One column or two, resolved by the pane against its own width. */
  mode: DiffMode;
  /** Given only when the patch has the pane to itself, which is the layout
   * where the list is not on screen to go back to by clicking. */
  onBack?: () => void;
  /** The pane's measured width, for the toggle's own precondition — the same
   * number the pane resolved `mode` from, passed rather than re-derived so the
   * control and the layout cannot disagree about which side of the floor they
   * are on. */
  paneWidth: number;
  state: PatchState;
  wraps: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="history-patch">
      {/* `flex-wrap` for the split toggle's refusal sentence, which takes
          `basis-full` and drops under the row at the width where it is needed;
          nothing else in this header wraps. */}
      <div className="flex shrink-0 flex-wrap items-baseline gap-2 border-b border-border/60 px-2 py-1">
        {onBack === undefined ? null : (
          <button
            className="shrink-0 rounded border border-border/60 px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            data-testid="history-patch-back"
            onClick={onBack}
            type="button"
          >
            ← List
          </button>
        )}
        <PatchTitle state={state} />
        <DiffModeToggle paneWidth={paneWidth} testid="history-split" />
      </div>
      <Body mode={mode} state={state} wraps={wraps} />
    </div>
  );
}

/** The patch header names what is open. A file's path gets the shared
 * truncation rule — the directory dims and gives way, the basename stays
 * bright — because at the width where the patch has the pane to itself this
 * line is the only place the file is named at all. */
function PatchTitle({ state }: { state: PatchState }) {
  if (state.status === "file") {
    const parts = labelParts(state.file.path);
    return (
      <span
        className="flex min-w-0 flex-1 items-baseline text-2xs"
        data-testid="history-patch-title"
        title={state.file.path}
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
    );
  }
  return (
    <span
      className="min-w-0 flex-1 truncate text-2xs text-muted-foreground"
      data-testid="history-patch-title"
    >
      {title(state)}
    </span>
  );
}

function title(state: PatchState): string {
  switch (state.status) {
    case "none":
      return "nothing selected";
    case "reading":
      return "reading…";
    case "refused":
      return "git refused";
    case "file":
      return state.file.path;
    case "commit":
      return `${state.answer.commit.short} · ${commitSubject(state.answer.commit)}`;
  }
}

function Body({
  mode,
  state,
  wraps,
}: {
  mode: DiffMode;
  state: PatchState;
  wraps: boolean;
}) {
  switch (state.status) {
    case "none":
      return (
        <PaneEmpty
          glyph="⟲"
          hint="j / k move · Enter opens"
          sentence="pick a commit to read its patch, or a file to read what changed in it."
          testid="history-patch-none"
        />
      );
    case "reading":
      return (
        <p
          className="p-3 text-xs text-muted-foreground"
          data-testid="history-patch-reading"
        >
          reading…
        </p>
      );
    case "refused":
      return (
        <p
          className="whitespace-pre-wrap p-3 font-mono text-2xs text-foreground"
          data-testid="history-patch-refused"
        >
          {state.note}
        </p>
      );
    case "file":
      return (
        <>
          {/* What this patch IS, said rather than implied: it is the file
              against HEAD, which is staged and unstaged together. See
              `historyModel.ts`'s `statusPatch`. */}
          <p
            className="shrink-0 border-b border-border/60 px-2 py-1 text-2xs text-muted-foreground"
            data-testid="history-file-scope"
          >
            against {STATUS_BASE} — staged and unstaged changes together.
          </p>
          <NotedPatch
            mode={mode}
            note={state.file.note}
            noteTestid="history-file-note"
            patch={state.file.patch}
            path={state.file.path}
            testid="history-patch-body"
            wraps={wraps}
          />
        </>
      );
    case "commit":
      return <CommitBody answer={state.answer} mode={mode} wraps={wraps} />;
  }
}

/** One file's patch under the sentence saying what it is not showing.
 *
 * **The note goes ABOVE the patch and not instead of it**, which is the
 * arrangement `WorktreeDiffPanel` keeps (`worktree-diff-file-note`, then
 * `PatchView`) and the reason both panes share this shape rather than only the
 * renderer. `fileNote` says "patch cut off" for a file whose `patch` is a full
 * 2,000-line prefix — showing the sentence in place of it would throw away the
 * two thousand lines git actually read, and the same file clicked in the Diff
 * pane would show more than it does here.
 *
 * The box is dropped only when there is genuinely nothing in it: a binary file's
 * patch is the empty string by construction (`commit_patch.rs`), and an empty
 * box under the sentence explaining the emptiness is a second way of saying
 * nothing.
 *
 * `note` is `fileNote`'s, always — this component does not decide what a file is
 * not showing, it decides where that sentence goes. */
function NotedPatch({
  mode,
  note,
  noteTestid,
  patch,
  path,
  testid,
  wraps,
}: {
  mode: DiffMode;
  note: string | null;
  noteTestid: string;
  patch: string;
  /** The file this patch is of, for the language it is highlighted as. */
  path?: string;
  testid: string;
  wraps: boolean;
}) {
  return (
    <>
      {note === null ? null : (
        <p
          className="shrink-0 border-b border-border/60 bg-muted/40 px-2 py-1 text-2xs text-muted-foreground"
          data-testid={noteTestid}
        >
          {note}
        </p>
      )}
      {patch === "" ? null : (
        <PatchView
          mode={mode}
          patch={patch}
          path={path}
          testid={testid}
          wraps={wraps}
        />
      )}
    </>
  );
}

function CommitBody({
  answer,
  mode,
  wraps,
}: {
  answer: CommitPatch;
  mode: DiffMode;
  wraps: boolean;
}) {
  const note = commitPatchNote(answer);
  const files = answer.diff.files;
  return (
    <>
      <div className="shrink-0 border-b border-border/60 px-2 py-1">
        <p className="text-2xs text-muted-foreground">
          <span className="tabular-nums">
            {files.length} file{files.length === 1 ? "" : "s"}
          </span>
          ,{" "}
          <span className="tabular-nums text-status-added">
            +{answer.diff.additions}
          </span>{" "}
          <span className="tabular-nums text-status-deleted">
            −{answer.diff.deletions}
          </span>{" "}
          vs {answer.diff.base}
        </p>
        {note === null ? null : (
          // The merge sentence, and the first-commit one. Said out loud because
          // a first-parent patch that looked like the whole merge would be a
          // claim about the owner's history that is not true.
          <p
            className="text-2xs text-foreground"
            data-testid="history-commit-note"
          >
            {note}
          </p>
        )}
      </div>
      {files.length === 0 ? (
        <p
          className="p-3 text-xs text-muted-foreground"
          data-testid="history-commit-empty"
        >
          this commit changed no files git can produce a patch for.
        </p>
      ) : (
        // One `PatchView` per file, the same component the Diff pane draws its
        // open file with. Concatenating the patches into one string would have
        // been fewer boxes and would have lost the per-file heading, which is
        // the thing that makes a twelve-file commit readable.
        //
        // **And each carries its own `fileNote`**, from the limits this answer
        // was produced under. Without it a commit that added a PNG rendered as a
        // heading, `+0 −0` and an empty box — the exact claim `fileNote` exists
        // to prevent, and one the Diff pane does make about the same file.
        <div className="min-h-0 flex-1 overflow-auto">
          {files.map((file) => (
            <FileSection
              file={file}
              key={file.path}
              limits={answer.diff.limits}
              mode={mode}
              wraps={wraps}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** A patch this long is folded away until it is asked for.
 *
 * **A commit is not a file, and a twelve-file commit where one file is a
 * 900-line regenerated lockfile is a commit nobody scrolls to the end of.**
 * Sixty lines is about two screens of the patch box at this type size: past it
 * the file is a heading with its numbers, and one click opens it. Under it
 * nothing is hidden, because a fold over four lines is a control that costs
 * more than it saves. */
const COLLAPSE_OVER_LINES = 60;

/** One file inside a commit's patch: the mockup's `.frow` as the header for
 * its own hunks (redesign P4.4), and the patch under it.
 *
 * The row carries what the mockup's does — the path under the shared lead/name
 * rule, `+N −N`, and the `.chgsq` change square — and one thing the mockup's
 * does not: it is the control that folds the file away, because a mockup with
 * three files in it never had to answer for a commit with forty. */
function FileSection({
  file,
  limits,
  mode,
  wraps,
}: {
  file: FilePatchFile;
  limits: CommitPatch["diff"]["limits"];
  mode: DiffMode;
  wraps: boolean;
}) {
  const long = file.patch.split("\n").length > COLLAPSE_OVER_LINES;
  const [open, setOpen] = React.useState(!long);
  return (
    <div>
      <button
        aria-expanded={open}
        className="sticky top-0 z-10 flex w-full items-center gap-1.5 bg-background px-2 py-1 text-left text-2xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid={`history-file-row-${file.path}`}
        onClick={() => setOpen((was) => !was)}
        type="button"
      >
        <span aria-hidden="true" className="w-2 shrink-0 text-muted-foreground">
          {open ? "▾" : "▸"}
        </span>
        <FilePathLabel path={file.path} />
        <span className="ml-auto shrink-0 tabular-nums">
          <span className="text-status-added">+{file.additions}</span>{" "}
          <span className="text-status-deleted">−{file.deletions}</span>
        </span>
        <ChangeSquare file={file} />
      </button>
      {open ? (
        <NotedPatch
          mode={mode}
          note={fileNote(file, limits)}
          noteTestid={`history-file-note-${file.path}`}
          patch={file.patch}
          path={file.path}
          testid={`history-patch-${file.path}`}
          wraps={wraps}
        />
      ) : null}
    </div>
  );
}

/** The per-file heading's path, under the shared truncation rule: the
 * directory dims and is the half allowed to give way, the basename stays
 * bright. The same `labelParts` arrangement `WorktreeDiffPanel`'s `PathLabel`
 * keeps, drawn locally because this heading also carries the numstat beside
 * it. */
function FilePathLabel({ path }: { path: string }) {
  const parts = labelParts(path);
  return (
    <span className="flex min-w-0 items-baseline" title={path}>
      {parts.lead === "" ? null : (
        <span className="min-w-0 truncate text-muted-foreground">
          {parts.lead}
        </span>
      )}
      <span className="max-w-full shrink-0 truncate text-foreground">
        {parts.name}
      </span>
    </span>
  );
}
