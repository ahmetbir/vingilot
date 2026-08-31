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
//
// **The list beside the patch is not entitled to its width.** On the owner's
// 16-inch laptop this pane is 243px and the list was a fixed, non-shrinking
// 288px, which left the patch 32px — the defect that sent him back to VS Code.
// `lib/diffLayout.ts` carries the decision and the measurements; what this file
// does is measure its own box and obey it, including the case where the list
// stops standing beside the patch and becomes a drawer over it.
//
// **A narrow pane is answered twice, because two halves were unreadable.** The
// patch got the pane and was still under its own column floor, so below that
// floor it wraps rather than scrolling sideways (`patchWrapsAt`) — a line the
// owner can finish reading is worth more than a grid he cannot. And the rows
// of the list, at the width where the list is a drawer, were three identical
// truncations of one directory: paths are laid out as directory-plus-name and
// only the directory is elided (`PathLabel`), so the name is always on screen.

import * as React from "react";

import {
  activatesOnEnter,
  type FocusedElement,
  isTypingTarget,
  nextFileIndex,
  resolveDiffKey,
} from "@/features/runs/lib/diffKeys";
import {
  diffListPlacement,
  LIST_PREFERRED_PX,
  patchWrapsAt,
  SPLIT_MIN_PX,
  splitFitsAt,
} from "@/features/runs/lib/diffLayout";
import { effectiveDiffMode } from "@/features/runs/lib/diffMode";
import { useDiffMode } from "@/features/runs/lib/useDiffMode";
import { DiffModeToggle } from "@/features/runs/ui/DiffModeToggle";
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
import { OpenInEditor } from "@/features/runs/ui/OpenInEditor";
import { PatchView } from "@/features/runs/ui/PatchView";
import { gitWorktreeDiff } from "@/features/runs/lib/worktreeClient";
import {
  changeLabel,
  changeMark,
  changeMarkClass,
  defaultDiffBase,
  diffSummary,
  fileLabel,
  fileNote,
  firstHunkLine,
  labelParts,
  type WorktreeDiff,
} from "@/features/runs/lib/worktreeDiff";
import { explainWorktreeError } from "@/features/runs/lib/worktreePlan";

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
  /** Show the whole of the file whose patch is open, in the Files pane.
   *
   * **The first caller of the viewer's outside route**
   * (vingilot/docs/plans/2026-08-12-files-pane-design.md, §6), and it is here
   * because a patch is a reading of a few lines and the question it most often
   * raises is about the rest of them — what the function this hunk is inside
   * actually does. Until now the answer to that was VS Code, which is the
   * sentence the whole plan is named after.
   *
   * `line` is where the open patch starts in the file as it is now, or `null`
   * when the patch names no line. It is passed because the question is about
   * the lines *around* the hunk: landing at line 1 of a 2,000-line file answers
   * a different one, and it is the half of the route Task 2's search results
   * depend on — a hit that named a line and then opened the top of the file
   * would be a door onto the wrong side of the room.
   *
   * Optional, so a Diff pane rendered anywhere without a host to ask keeps
   * working and simply does not offer it. */
  onShowFile?: (path: string, line: number | null) => void;
  /** Read this diff on the whole stage instead — as a view tab beside the
   * shells (redesign P4.1, item 3).
   *
   * **This is P3.1's geometry ruling with a door.** A dock card is 300-540px
   * and a patch is not; the panel yields to the layout it is in rather than
   * fighting it, and offers the way to a surface where the same read has room.
   * It hands back the base it is CURRENTLY reading against, not the one in the
   * box: the tab must be the diff on screen, and the box may hold a ref the
   * owner has typed and not yet pressed Read on.
   *
   * Optional, and absent exactly where it would be a loop: the copy of this
   * panel that IS the tab does not offer to open a tab. */
  onOpenInTab?: (base: string) => void;
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

export function WorktreeDiffPanel({
  cwd,
  onOpenInTab,
  onShowFile,
  worktree,
}: Props) {
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
  // Whether the drawer is showing, in the layout where the list is a drawer.
  // Closed to begin with: the pane opens on a file already (`open` starts at
  // 0), so a drawer that opened itself would cover the very patch this layout
  // exists to give back. It is not closed for him again either — the gesture
  // that opened it is the one that puts it away, and a list that shut on the
  // first Enter would fight `j`/`k` walking a forty-file worktree.
  const [listOpen, setListOpen] = React.useState(false);

  // This pane's own width, because who yields to whom is decided in pixels
  // (`diffLayout.ts`) and no class name can express it. A layout effect so the
  // first paint is already the right layout rather than a 288px list flashing
  // through a 243px pane. 0 until measured, which `diffListPlacement` reads as
  // "not measured" and never as "narrow".
  const paneRef = React.useRef<HTMLDivElement | null>(null);
  const [paneWidth, setPaneWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const pane = paneRef.current;
    if (pane === null) return;
    setPaneWidth(pane.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined) setPaneWidth(measured);
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);
  // One column or two, and the width is the precondition rather than a hope
  // (`diffLayout.ts`'s `SPLIT_MIN_PX`). The choice is the app's one flag, not
  // this pane's state and not this file's — the History pane reads the same one.
  const choice = useDiffMode();
  const mode = effectiveDiffMode(choice, splitFitsAt(paneWidth));
  // **A split patch needs more, so the list yields more.** That is not a new
  // decision, it is the one `diffLayout.ts` already states — "the list never
  // takes width the patch needs" — handed the floor the patch actually has.
  const placement = diffListPlacement(
    paneWidth,
    mode === "split" ? SPLIT_MIN_PX : undefined,
  );
  const wraps = patchWrapsAt(paneWidth);

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

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="pane-diff"
      ref={paneRef}
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
          className="text-3xs uppercase tracking-[0.14em] text-muted-foreground"
          htmlFor="worktree-diff-base"
        >
          against
        </label>
        <input
          className="min-w-0 max-w-40 flex-1 rounded-md border border-border/60 bg-transparent px-2 py-1 font-mono text-sm"
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
        {onOpenInTab === undefined ? null : (
          <button
            className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            data-testid="worktree-diff-open-tab"
            onClick={() => onOpenInTab(request.base)}
            title="Read this diff on the whole stage, as a tab beside the shells"
            type="button"
          >
            Open in tab
          </button>
        )}
        {summary === null ? null : (
          <span className="min-w-0 basis-full truncate text-2xs text-muted-foreground">
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
          className="shrink-0 border-b border-border/60 bg-destructive/10 px-4 py-1.5 text-sm text-destructive"
          data-testid="worktree-diff-stale"
        >
          could not re-read — {refusal}
        </p>
      )}

      {summary?.omission == null ? null : (
        <p
          className="shrink-0 border-b border-border/60 bg-amber-500/10 px-4 py-1.5 text-sm text-amber-700 dark:text-amber-400"
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
          {placement.where === "beside" ? (
            <FileList
              cursor={cursor}
              cursorRow={cursorRow}
              cwd={cwd}
              files={files}
              onPick={(index) => {
                setCursor(index);
                setOpen(index);
              }}
              open={open}
              style={{ width: placement.listPx }}
            />
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* `flex-wrap` for the one line that may not fit beside the path:
                the split toggle's refusal sentence, which takes `basis-full`
                and drops under the row at the width where it is needed. Nothing
                else in this header ever wraps — the path is `flex-1` and the two
                controls are `shrink-0`. */}
            <div className="flex shrink-0 flex-wrap items-baseline gap-2 border-b border-border/60 px-4 py-1.5">
              {placement.where === "over" ? (
                // The drawer's only door, and the only place the file count is
                // said at all in this layout — a list that is not on screen
                // must still be countable, or "no changes" and "changes you
                // cannot see" read the same.
                <button
                  aria-expanded={listOpen}
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  data-testid="worktree-diff-list-toggle"
                  onClick={() => setListOpen((was) => !was)}
                  type="button"
                >
                  {listOpen ? "▾" : "▸"} {count} file{count === 1 ? "" : "s"}
                </button>
              ) : null}
              <PathLabel
                className="flex-1 font-mono text-sm"
                label={shown === null ? "" : fileLabel(shown)}
                // Named so a spec can ask which file is open without reading
                // an index out of the list beside it — which is the whole
                // point when what is under test is that the index moved and
                // the file did not.
                //
                // In the drawer layout this header is the *only* place the open
                // file is named, so it is also the place a tail truncation hurt
                // most: at 243px it read "desktop/src/feat…".
                testid="worktree-diff-open"
              />
              {/* The door out of the patch and into the file. `shrink-0` and a
                  glyph rather than a label because this header is 243px wide on
                  his laptop and `PathLabel` beside it is the thing that must
                  keep its room — the same constraint the hint below is dropped
                  for at that width. A deleted file has nothing left to show, so
                  it is not offered one. */}
              {onShowFile === undefined ||
              shown === null ||
              shown.change === "deleted" ? null : (
                <button
                  aria-label={`show the whole of ${shown.path}`}
                  className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  data-testid="worktree-diff-show-file"
                  onClick={() =>
                    onShowFile(shown.path, firstHunkLine(shown.patch))
                  }
                  title="Show the whole file"
                  type="button"
                >
                  ⌸
                </button>
              )}
              {placement.where === "beside" ? (
                <span className="shrink-0 text-2xs text-muted-foreground">
                  j / k move · enter opens
                </span>
              ) : null}
              {/* Last, so the sentence it may bring with it is the last thing
                  in the header and lands on a line of its own rather than
                  pushing the keyboard hint down there with it. */}
              <DiffModeToggle
                paneWidth={paneWidth}
                testid="worktree-diff-split"
              />
            </div>
            {/* `relative` so the drawer covers the patch and *not* the header
                above it: the button that opens the list is in that header, and
                a drawer laid over the whole pane would be a drawer with no way
                out. Measured — Playwright reported the toggle intercepted by
                the list's own rows. */}
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              {note === null ? null : (
                <p
                  className="shrink-0 border-b border-border/60 bg-muted/40 px-4 py-1.5 text-2xs text-muted-foreground"
                  data-testid="worktree-diff-file-note"
                >
                  {note}
                </p>
              )}
              {/* Named because the width of *this* box is the defect: it is
                  what "the diff does not fit" was measured on (32px of client
                  against 704px of content), and a spec cannot ask about it
                  through the pane, which fits fine.

                  The drawing moved to `PatchView` so the History pane renders a
                  commit's patch with this renderer rather than a second copy of
                  it (Task 4); what it draws did not change. */}
              <PatchView
                mode={mode}
                patch={shown === null ? "" : shown.patch}
                testid="worktree-diff-patch"
                wraps={wraps}
              />
              {placement.where === "over" && listOpen ? (
                <FileList
                  cursor={cursor}
                  cursorRow={cursorRow}
                  cwd={cwd}
                  files={files}
                  onPick={(index) => {
                    setCursor(index);
                    setOpen(index);
                  }}
                  open={open}
                  // Over the patch, not beside it: the pane cannot seat both,
                  // and this is the half that yields.
                  over
                  style={{ maxWidth: LIST_PREFERRED_PX }}
                />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A path with the file's own name always on screen.
 *
 * One `truncate` over the whole label elides its tail, and the tail is the half
 * that says which file this is. Measured in the built bundle at 1728×1117, in
 * the layout where the list is a drawer: the rows give the path 163px, and
 * three files under `desktop/src/features/runs/` all rendered as
 * `desktop/src/features/ru…` — the same twenty-three characters three times.
 * The patch header, the only place the open file is named in that layout, read
 * `desktop/src/feat…`. Both are "the text is there" and neither is legible.
 *
 * So the label is laid out in two boxes and only the directory is allowed to
 * give way: the name is `shrink-0`, and `max-w-full` is what keeps *it* from
 * pushing the row wider than the row — a name longer than the whole column is
 * the one case where there is nothing better to elide than the name.
 *
 * `title` carries the whole label for a hover, but a tooltip is not a fix: the
 * owner is scanning a list, not interviewing it. */
function PathLabel({
  className,
  label,
  testid,
}: {
  className: string;
  label: string;
  testid?: string;
}) {
  const { lead, name } = labelParts(label);
  return (
    <span
      className={`flex min-w-0 items-baseline ${className}`}
      data-testid={testid}
      title={label}
    >
      {lead === "" ? null : (
        <span
          className="min-w-0 truncate text-muted-foreground"
          data-path-lead="true"
        >
          {lead}
        </span>
      )}
      {/* Bright whatever the row's rest state is: the basename is the half
          that identifies the file, and it is now the rule everywhere a path
          is drawn (polish plan, vocabulary — truncation). */}
      <span
        className="max-w-full shrink-0 truncate text-foreground"
        data-path-name="true"
      >
        {name}
      </span>
    </span>
  );
}

/** The changed files, in one component because there are two places to put
 * them and only one list.
 *
 * `over` is the whole difference: beside the patch it is a column of the row
 * with a width the caller decided; over the patch it is a sheet inside the
 * patch's own box, capped at what the list is worth and never wider than the
 * pane. Same rows, same testids, same keys — a spec asking about the list
 * should not have to know which layout it is in. */
function FileList({
  cursor,
  cursorRow,
  files,
  onPick,
  cwd,
  open,
  over = false,
  style,
}: {
  cursor: number;
  cursorRow: React.RefObject<HTMLButtonElement | null>;
  /** The checkout these paths are relative to, or `null` before it resolves.
   * `null` is "no answer" and draws no escape hatch — a button that opened a
   * path against a worktree nobody has named yet is the wrong-checkout landing
   * `filesTarget.shouldLand` refuses for the same reason. */
  cwd: string | null;
  files: WorktreeDiff["files"];
  onPick: (index: number) => void;
  open: number;
  over?: boolean;
  style: React.CSSProperties;
}) {
  return (
    <ul
      aria-label="changed files"
      className={
        over
          ? "absolute inset-y-0 left-0 z-10 flex w-full flex-col overflow-y-auto border-r border-border/60 bg-popover py-1 shadow-xl"
          : "flex shrink-0 flex-col overflow-y-auto border-r border-border/60 py-1"
      }
      data-testid="worktree-diff-files"
      style={style}
    >
      {files.map((file, index) => (
        // `group` so the escape hatch beside it fades in with the row, the way
        // `WorktreeRow`'s × does. A flex row rather than an overlay: the row is
        // a button and a button may not contain one, and an absolutely
        // positioned control would need a background of its own to stay
        // legible over the numstat — which the vocabulary's "no gradients"
        // rule leaves no honest way to draw.
        <li
          className="group flex items-baseline pr-1"
          key={`${file.change}:${file.path}`}
        >
          <button
            className={`flex min-w-0 flex-1 items-baseline gap-2 px-3 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
              index === open
                ? "bg-muted text-foreground"
                : index === cursor
                  ? "bg-muted/40 text-foreground"
                  : "text-muted-foreground hover:bg-muted/60"
            }`}
            data-testid={`worktree-diff-file-${index}`}
            onClick={() => onPick(index)}
            ref={index === cursor ? cursorRow : null}
            type="button"
          >
            <span
              className={`shrink-0 font-mono text-2xs ${changeMarkClass(file.change)}`}
              title={changeLabel(file.change)}
            >
              {changeMark(file.change)}
            </span>
            <PathLabel className="flex-1 text-sm" label={fileLabel(file)} />
            {/* The numstat speaks the theme's own diff hues, as upstream's
                activity rows already do — the same green and red the patch it
                opens will use. */}
            <span className="shrink-0 font-mono text-2xs">
              {file.binary ? (
                <span className="text-muted-foreground/80">bin</span>
              ) : (
                <>
                  <span className="text-status-added">+{file.additions}</span>{" "}
                  <span className="text-status-deleted">−{file.deletions}</span>
                </>
              )}
            </span>
          </button>
          {cwd === null ? null : (
            // **The source-control row's escape hatch.** No line: a changed
            // file has no one interesting line, and `null` is the word for that
            // (`FileTarget.line`) — the patch beside it is where the lines are.
            <OpenInEditor
              line={null}
              path={file.path}
              reveal
              testid={`worktree-diff-open-in-editor-${index}`}
              worktree={cwd}
            />
          )}
        </li>
      ))}
    </ul>
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
