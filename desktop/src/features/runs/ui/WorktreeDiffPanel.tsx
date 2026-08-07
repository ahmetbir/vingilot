// Reading a worktree's changes without leaving the workspace
// (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 7) — the last window
// this app had to replace, and the one the owner keeps VS Code open for.
//
// Changed files on the left, that file's patch on the right, `j`/`k` to move
// and `Enter` to open (`lib/diffKeys.ts`). Every decision here is somewhere
// else: what a diff is `lib/worktreeDiff.ts`, how a patch line is classified
// `lib/runModel.ts`'s `diffView`, what a refusal says `lib/worktreePlan.ts`.
//
// **Read when asked, never polled.** A `git diff` over a real worktree is
// several subprocesses; running that every two seconds because a tab is open
// would put a permanent load on the machine to answer a question nobody asked
// twice. The panel reads when it opens, when the base changes, and when the
// owner presses Read again.
//
// **What is missing is on screen, not in a comment.** A binary file, a patch
// cut at the backend's line or byte cap, files past the file cap: each says so
// where it would otherwise read as "nothing changed here" (`fileNote`,
// `diffSummary`). The numbers come from the answer, so they are the caps that
// were actually applied.

import * as React from "react";

import { nextFileIndex, resolveDiffKey } from "@/features/runs/lib/diffKeys";
import type { Worktree } from "@/features/runs/lib/projects";
import { diffView } from "@/features/runs/lib/runModel";
import type { DiffLineKind } from "@/features/runs/lib/runModel";
import { gitWorktreeDiff } from "@/features/runs/lib/worktreeClient";
import {
  changeLabel,
  changeMark,
  defaultDiffBase,
  diffSummary,
  fileLabel,
  fileNote,
  type WorktreeDiff,
} from "@/features/runs/lib/worktreeDiff";
import { explainWorktreeError } from "@/features/runs/lib/worktreePlan";

const DIFF_LINE_CLASS: Record<DiffLineKind, string> = {
  add: "text-emerald-600 dark:text-emerald-400",
  ctx: "text-foreground",
  del: "text-destructive",
  hunk: "font-bold text-muted-foreground",
  meta: "text-muted-foreground",
};

const CHANGE_CLASS: Record<string, string> = {
  A: "text-emerald-600 dark:text-emerald-400",
  D: "text-destructive",
  U: "text-amber-600 dark:text-amber-400",
};

interface Props {
  /** The worktree's own directory, or `null` before the desktop shell has
   * resolved one — git cannot be asked about a place this app cannot name. */
  cwd: string | null;
  worktree: Worktree;
}

/** True when the caret is somewhere a letter is a letter. */
function inField(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  return (
    active.tagName === "INPUT" ||
    active.tagName === "TEXTAREA" ||
    active.isContentEditable
  );
}

export function WorktreeDiffPanel({ cwd, worktree }: Props) {
  const suggested = defaultDiffBase(worktree);
  const [draft, setDraft] = React.useState(suggested);
  // One read, named. The nonce is what makes pressing Read with the same ref
  // in the box a *different* request: the ref has not changed, the worktree
  // on disk has, and that is the only reason the button exists.
  //
  // A different worktree needs none of this reset by hand — `WorkSurface`
  // keys this component by binding id, so it is a different component.
  const [request, setRequest] = React.useState({ base: suggested, nonce: 0 });
  const [diff, setDiff] = React.useState<WorktreeDiff | null>(null);
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const [reading, setReading] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);
  const [open, setOpen] = React.useState(0);

  React.useEffect(() => {
    if (cwd === null) return;
    let cancelled = false;
    setReading(true);
    void (async () => {
      const result = await gitWorktreeDiff(cwd, request.base);
      if (cancelled) return;
      setReading(false);
      if (result.ok) {
        setDiff(result.value);
        setRefusal(null);
        setCursor(0);
        setOpen(0);
      } else {
        // The previous file list stays out of the way: it described a
        // question that was answered, and this one was not.
        setDiff(null);
        setRefusal(explainWorktreeError(result.error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, request]);

  const files = diff?.files ?? [];
  const count = files.length;

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const action = resolveDiffKey({
        altKey: event.altKey,
        inField: inField(),
        key: event.key,
        primaryModifier: event.metaKey || event.ctrlKey,
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action === null) return;
      if (action.type === "step-file") {
        if (count === 0) return;
        event.preventDefault();
        setCursor((at) => nextFileIndex(at, count, action.dir));
        return;
      }
      event.preventDefault();
      setOpen(cursor);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [count, cursor]);

  // `j` past the bottom of a 200-file list has to bring the cursor with it,
  // or the keys move a highlight nobody can see.
  const cursorRow = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    if (cursor < 0) return;
    cursorRow.current?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const shown = files[open] ?? null;
  const summary = diff === null ? null : diffSummary(diff);
  const note =
    shown === null || diff === null ? null : fileNote(shown, diff.limits);
  const patch = shown === null ? null : diffView(shown.patch);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="work-surface-diff-tab"
    >
      <form
        className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          setRequest((prev) => ({
            // An empty box is not a request to diff against nothing; it keeps
            // the ref that is already being read.
            base: draft.trim() === "" ? prev.base : draft.trim(),
            nonce: prev.nonce + 1,
          }));
        }}
      >
        <label
          className="text-2xs uppercase tracking-[0.14em] text-muted-foreground"
          htmlFor="worktree-diff-base"
        >
          against
        </label>
        <input
          className="w-40 rounded-md border border-border/60 bg-transparent px-2 py-1 font-mono text-xs"
          data-testid="worktree-diff-base"
          id="worktree-diff-base"
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          value={draft}
        />
        <button
          className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
          data-testid="worktree-diff-read"
          disabled={reading || cwd === null}
          type="submit"
        >
          {reading ? "reading…" : "Read"}
        </button>
        {summary === null ? null : (
          <span className="truncate text-xs text-muted-foreground">
            {summary.headline}
          </span>
        )}
      </form>

      {summary?.omission == null ? null : (
        <p
          className="shrink-0 border-b border-border/60 bg-amber-500/10 px-4 py-1.5 text-2xs text-amber-700 dark:text-amber-400"
          data-testid="worktree-diff-omission"
        >
          {summary.omission}
        </p>
      )}

      {cwd === null ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          this worktree has no directory on this machine yet, so there is
          nothing to read.
        </p>
      ) : refusal !== null ? (
        <p
          className="px-4 py-3 text-sm text-destructive"
          data-testid="worktree-diff-refusal"
        >
          {refusal}
        </p>
      ) : diff === null ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {reading ? "reading the worktree…" : "not read yet."}
        </p>
      ) : count === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          nothing has changed against {diff.base} — no edits, no new files.
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <ul
            aria-label="changed files"
            className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border/60 py-1"
            data-testid="worktree-diff-files"
          >
            {files.map((file, index) => (
              <li key={`${file.change}:${file.path}`}>
                <button
                  className={`flex w-full items-baseline gap-2 px-3 py-1 text-left transition-colors ${
                    index === open
                      ? "bg-muted text-foreground"
                      : index === cursor
                        ? "bg-muted/40 text-foreground"
                        : "text-muted-foreground hover:bg-muted/60"
                  }`}
                  data-testid={`worktree-diff-file-${index}`}
                  onClick={() => {
                    setCursor(index);
                    setOpen(index);
                  }}
                  ref={index === cursor ? cursorRow : null}
                  type="button"
                >
                  <span
                    className={`shrink-0 font-mono text-2xs ${CHANGE_CLASS[changeMark(file.change)] ?? "text-muted-foreground"}`}
                    title={changeLabel(file.change)}
                  >
                    {changeMark(file.change)}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-xs"
                    title={fileLabel(file)}
                  >
                    {fileLabel(file)}
                  </span>
                  <span className="shrink-0 font-mono text-3xs text-muted-foreground/80">
                    {file.binary
                      ? "bin"
                      : `+${file.additions} −${file.deletions}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-baseline gap-2 border-b border-border/60 px-4 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {shown === null ? "" : fileLabel(shown)}
              </span>
              <span className="shrink-0 text-3xs uppercase tracking-[0.14em] text-muted-foreground">
                j / k move · enter opens
              </span>
            </div>
            {note === null ? null : (
              <p
                className="shrink-0 border-b border-border/60 bg-muted/40 px-4 py-1.5 text-2xs text-muted-foreground"
                data-testid="worktree-diff-file-note"
              >
                {note}
              </p>
            )}
            <div className="min-h-0 flex-1 overflow-auto px-4 py-2">
              <div className="flex w-max min-w-full flex-col font-mono text-xs">
                {(patch?.lines ?? []).map((line, i) => (
                  <span
                    className={`whitespace-pre ${DIFF_LINE_CLASS[line.kind]}`}
                    // biome-ignore lint/suspicious/noArrayIndexKey: patch lines are positional content, never reordered
                    key={i}
                  >
                    {line.text === "" ? " " : line.text}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
