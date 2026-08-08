// Reading a worktree's changes without leaving the workspace
// (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 7) — the last window
// this app had to replace, and the one the owner keeps VS Code open for.
//
// Changed files on the left, that file's patch on the right, `j`/`k` to move
// and `Enter` to open (`lib/diffKeys.ts`). Every decision here is somewhere
// else: what a diff is `lib/worktreeDiff.ts`, how a patch line is classified
// `lib/runModel.ts`'s `diffView`, what a refusal says `lib/worktreePlan.ts`.
//
// **It keeps up with the work.** The owner watches an agent edit files in the
// terminal beside this pane, and a diff frozen at the moment it was opened is
// worse than no diff: it looks current. So it re-reads on a cadence, when the
// window comes back, and whenever the owner asks — and it *says* when it last
// read (`Freshness`), because the whole complaint was a view that was stale
// without looking it.
//
// **On a cadence the read pays for itself.** A `worktree_diff` is one git
// subprocess per changed file and costs real time (measured numbers in
// `lib/diffRefresh.ts`), so the gap between reads is derived from what the
// last one cost rather than picked: git gets a fixed *share* of one core, and
// a worktree with two hundred changed files slows the pane down instead of
// pinning the machine. Every scheduling decision is in `diffRefresh.ts`; this
// file only supplies the clock and the answers.
//
// **A refresh must not move the owner.** The file he has open is followed by
// path across a re-read, the list does not blank while one is in flight, and a
// re-read that git refused leaves the last good answer on screen with a line
// saying it could not be renewed. A refresh that scrolled him back to the top
// of a 400-file list would have replaced one annoyance with a worse one.
//
// **What is missing is on screen, not in a comment.** A binary file, a patch
// cut at the backend's line or byte cap, files past the file cap: each says so
// where it would otherwise read as "nothing changed here" (`fileNote`,
// `diffSummary`). The numbers come from the answer, so they are the caps that
// were actually applied.

import * as React from "react";

import {
  activatesOnEnter,
  type FocusedElement,
  isTypingTarget,
  nextFileIndex,
  resolveDiffKey,
} from "@/features/runs/lib/diffKeys";
import {
  began,
  ended,
  freshnessLabel,
  indexAfterRefresh,
  type RefreshState,
  type RefreshTrigger,
  shouldRead,
  UNREAD,
} from "@/features/runs/lib/diffRefresh";
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

/** How often the pane *wonders* whether it is due, which is not how often it
 * reads — `shouldRead` answers that against a gap derived from the last read's
 * cost. A pump this cheap (one subtraction, no render) can be regular where
 * the read cannot, so a gap of any length is honoured to within a second
 * without a timer being rescheduled every time something else triggers a
 * read. */
const PUMP_MS = 1_000;

/** How often the "read 12s ago" line re-counts. Its own component, so this is
 * one `<span>` re-rendering per second and never the patch beside it — a
 * 2000-line diff re-rendered on a clock would cost more than the git it is
 * reporting on. */
const FRESHNESS_TICK_MS = 1_000;

/** Is this window on screen at all? Visibility, not focus: the app sitting on
 * a second monitor while the owner types elsewhere is being watched, and that
 * is exactly the case this pane was built for. Minimised, occluded or on
 * another Space is not.
 *
 * Outside a browser (a unit runner) there is no document and no pane; the
 * answer there is that nobody is looking. */
function onScreen(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState !== "hidden"
  );
}

interface Props {
  /** The worktree's own directory, or `null` before the desktop shell has
   * resolved one — git cannot be asked about a place this app cannot name. */
  cwd: string | null;
  worktree: Worktree;
}

/** What has focus right now, in the terms `diffKeys.ts` decides on. The
 * listener below is on `window`, so this is the whole app's focus, not the
 * panel's. */
function focused(): FocusedElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  return {
    contentEditable: active.isContentEditable,
    role: active.getAttribute("role"),
    tagName: active.tagName,
  };
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
  const [readAt, setReadAt] = React.useState<number | null>(null);
  const [cursor, setCursor] = React.useState(0);
  const [open, setOpen] = React.useState(0);

  // The schedule lives in a ref, not in state: every read would otherwise
  // re-render the patch twice (once to say it started, once to say it
  // stopped) for a number nothing on screen shows. What the owner does see —
  // `reading`, `readAt` — is state, and only that.
  const clock = React.useRef<RefreshState>(UNREAD);
  // What is on screen now, so an answer can be placed against it: the paths in
  // list order, and the base they were read against.
  const shownPaths = React.useRef<string[]>([]);
  const shownBase = React.useRef<string | null>(null);
  // Which read is the current one. An explicit press outranks a read already
  // in flight (a Read button that silently did nothing would be worse), so the
  // superseded answer has to be identifiable and dropped.
  const generation = React.useRef(0);
  // The ref the unprompted reads use, without making them depend on it: the
  // pump and the wake-ups are mounted once and must not be torn down and
  // rebuilt every time the box is typed in.
  const base = React.useRef(request.base);
  base.current = request.base;
  // Only false once this pane is really gone; re-armed on mount for the
  // double-mount a dev build does.
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** The only place git is asked. Reads against `base.current`, decides
   * nothing about *whether* to — `shouldRead` has already said yes. */
  const read = React.useCallback(async () => {
    if (cwd === null) return;
    const asked = base.current;
    // A base the owner changed is a different question, so the answer that is
    // up cannot stand in for it while the new one is fetched. Re-reading the
    // same base is a refresh, and keeps everything.
    const fresh = asked !== shownBase.current;
    const mine = generation.current + 1;
    generation.current = mine;
    clock.current = began(clock.current);
    setReading(true);
    if (fresh) {
      setDiff(null);
      setRefusal(null);
      shownPaths.current = [];
    }

    const startedAt = Date.now();
    const result = await gitWorktreeDiff(cwd, asked);
    const endedAt = Date.now();
    // A superseded read touches neither the screen nor the schedule: its
    // duration would set a gap for a question nobody is asking any more.
    if (generation.current !== mine || !alive.current) return;
    clock.current = ended(clock.current, {
      now: endedAt,
      ok: result.ok,
      tookMs: endedAt - startedAt,
    });
    setReading(false);

    if (!result.ok) {
      setRefusal(explainWorktreeError(result.error).message);
      // A refusal is not an answer about this worktree. On a refresh the last
      // good list stays up with a line saying it could not be renewed; only a
      // question that has never been answered shows nothing.
      return;
    }

    const paths = result.value.files.map((file) => file.path);
    if (fresh) {
      setOpen(0);
      setCursor(0);
    } else {
      // Followed by path, not by position: an agent that creates a file sorts
      // it into the middle of the list and would otherwise slide the patch
      // being read out from under the reader.
      const was = shownPaths.current;
      setOpen((at) => indexAfterRefresh(paths, was[at] ?? null, at));
      setCursor((at) => indexAfterRefresh(paths, was[at] ?? null, at));
    }
    shownPaths.current = paths;
    shownBase.current = asked;
    setDiff(result.value);
    setRefusal(null);
    setReadAt(endedAt);
  }, [cwd]);

  /** Read if the schedule allows it. The single door: the mount, the pump and
   * the wake-ups all come through here, which is what makes "one read in
   * flight" a property of the pane rather than of each caller. */
  const maybeRead = React.useCallback(
    (trigger: RefreshTrigger) => {
      if (
        !shouldRead(clock.current, {
          now: Date.now(),
          onScreen: onScreen(),
          trigger,
        })
      ) {
        return;
      }
      void read();
    },
    [read],
  );

  // Opened, or asked. `request` changes on mount, on a new base and on every
  // press of Read — and this pane is keyed by worktree in the registry, so a
  // worktree switch arrives as a mount rather than as a trigger of its own.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `request.nonce` is what makes pressing Read with an unchanged base a fresh ask; the value is not otherwise read here
  React.useEffect(() => {
    maybeRead(request.nonce === 0 ? "opened" : "asked");
  }, [maybeRead, request.base, request.nonce]);

  // The cadence.
  React.useEffect(() => {
    if (cwd === null) return;
    const handle = setInterval(() => maybeRead("tick"), PUMP_MS);
    return () => clearInterval(handle);
  }, [cwd, maybeRead]);

  // Back from somewhere. Both events, because they are different absences:
  // `visibilitychange` fires for a window that was minimised or on another
  // Space, `focus` for one that was merely behind another — and the second
  // never gates a read, it only prompts one.
  React.useEffect(() => {
    if (cwd === null) return;
    const wake = () => maybeRead("shown");
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [cwd, maybeRead]);

  const files = diff?.files ?? [];
  const count = files.length;

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const focus = focused();
      const action = resolveDiffKey({
        altKey: event.altKey,
        focusActivates: activatesOnEnter(focus),
        inField: isTypingTarget(focus),
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
      data-testid="pane-diff"
    >
      <form
        // Wraps and shrinks because this is a pane now, not a full-width tab:
        // its width is whatever the owner left the divider at.
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2"
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
          className="min-w-0 max-w-40 flex-1 rounded-md border border-border/60 bg-transparent px-2 py-1 font-mono text-xs"
          data-testid="worktree-diff-base"
          id="worktree-diff-base"
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          value={draft}
        />
        <button
          // Not disabled while a read is in flight, and its label does not
          // change: reads now happen every few seconds on their own, and a
          // button that dimmed and renamed itself each time would flicker for
          // the whole session. A press during a read supersedes it — see
          // `generation`. Activity is reported once, next door.
          className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
          data-testid="worktree-diff-read"
          disabled={cwd === null}
          type="submit"
        >
          Read
        </button>
        <Freshness readAt={readAt} reading={reading} />
        {summary === null ? null : (
          <span className="min-w-0 basis-full truncate text-xs text-muted-foreground">
            {summary.headline}
          </span>
        )}
      </form>

      {/* A refresh git refused, over a list that is still the last true
          answer. The full refusal below is for a question that has never been
          answered at all; this one exists so a worktree that vanished mid-read
          does not silently keep showing yesterday's diff as current. */}
      {refusal === null || diff === null ? null : (
        <p
          className="shrink-0 border-b border-border/60 bg-destructive/10 px-4 py-1.5 text-2xs text-destructive"
          data-testid="worktree-diff-stale"
        >
          could not re-read — {refusal}
        </p>
      )}

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
      ) : refusal !== null && diff === null ? (
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
              <span
                className="min-w-0 flex-1 truncate font-mono text-xs"
                // Named so a spec can ask which file is open without reading
                // an index out of the list beside it — which is the whole
                // point when what is under test is that the index moved and
                // the file did not.
                data-testid="worktree-diff-open"
              >
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

/** How old the answer on screen is, counted up once a second.
 *
 * **Its own component on purpose.** The clock has to advance without the patch
 * beside it re-rendering — a diff is up to 2000 `<span>`s, and re-rendering
 * them every second to move one number would cost more than the git this line
 * is reporting on.
 *
 * It counts while a read is in flight rather than replacing itself with a
 * spinner: what the owner needs to know is how old what he is *looking at* is,
 * and that does not stop being true because a newer answer is on its way. The
 * dot is the activity. */
function Freshness({
  readAt,
  reading,
}: {
  readAt: number | null;
  reading: boolean;
}) {
  const [, count] = React.useState(0);
  React.useEffect(() => {
    const handle = setInterval(() => count((n) => n + 1), FRESHNESS_TICK_MS);
    return () => clearInterval(handle);
  }, []);

  return (
    <span
      className="flex shrink-0 items-center gap-1 text-2xs tabular-nums text-muted-foreground"
      data-testid="worktree-diff-freshness"
      title={
        readAt === null
          ? "this worktree has not been read yet"
          : `last read at ${new Date(readAt).toLocaleTimeString()}`
      }
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${reading ? "bg-emerald-500" : "bg-transparent"}`}
        data-reading={reading ? "true" : "false"}
      />
      {freshnessLabel(readAt, Date.now())}
    </span>
  );
}
