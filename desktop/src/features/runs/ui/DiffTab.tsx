// The diff tab — the mockup's `.dv`, whole (redesign P4.6,
// vingilot/design/mockup/DIFF-TAB-BRIEF.md).
//
// > *"verify'a gecti ama hala iyi degil be" · "hala cok terminal gibi"*
//
// P4.4 answered the ROW: git's wire format went, the numbers got columns, the
// sign stopped shifting the code and Shiki coloured it. What it did not answer
// is the SURFACE the row sits on, which is what the brief is about — a commit
// header with an author and a change-ratio bar, a toolbar, one elevated card
// per file, a footer that tallies what is on screen, and the review agent's
// note sitting inside the code it is about. A diff that reads as terminal
// output is not only a matter of typography; it is a patch box with nothing
// around it.
//
// **One surface, two subjects.** A commit and a worktree's changes are the same
// reading with different provenance, so they are the same component — the
// header simply says less about a worktree diff, because there is less that is
// true about one. **Every value here comes from git or from the relay, and a
// value with no source is left out rather than invented**: a worktree diff has
// no author, no sha and no commit time, so it draws none of them. That rule is
// this island's oldest (`worktreeDiff.ts`: "nothing is rounded up into a
// reassuring shape") and it is the reason the mockup's own `Bosun · 18m ago ·
// e8d628e` does not appear over a diff that has no commit behind it.
//
// **Nothing here is a second renderer.** The rows are `PatchView`'s, which is
// the component every patch in this app has been drawn by since Task 4; the
// file icons are P4.1's; the split/unified flag is the app's one
// `diffMode.ts`; the reviewer popover is P4's `StatusBarReviewPopover` with
// P4's `useReviewDispatch` behind it, opened from a second trigger rather than
// rebuilt. What is new is the arrangement, and the arithmetic behind it is
// `lib/diffTab.ts`.

import * as React from "react";

import {
  isTypingTarget,
  type FocusedElement,
} from "@/features/runs/lib/diffKeys";
import {
  SPLIT_REFUSAL_DETAIL,
  splitRefusal,
} from "@/features/runs/lib/diffLayout";
import { setDiffMode } from "@/features/runs/lib/diffMode";
import {
  changeAnchors,
  fileTally,
  hiddenNote,
  ratioBlocks,
  withoutWhitespaceChanges,
  wordMarkup,
} from "@/features/runs/lib/diffTab";
import {
  getDiffTabPrefs,
  serverDiffTabPrefs,
  setDiffTabPref,
  subscribeDiffTabPrefs,
} from "@/features/runs/lib/diffTabPrefs";
import { commitAge } from "@/features/runs/ui/DockHistoryPanel";
import { useDiffMode } from "@/features/runs/lib/useDiffMode";
import { useReviewDispatch } from "@/features/runs/lib/useReviewDispatch";
import { useReviewNotes } from "@/features/runs/lib/useReviewNotes";
import {
  notesByLine,
  patchAuthorInCrew,
  type ReviewNote,
} from "@/features/runs/lib/reviewThread";
import { unifiedRows } from "@/features/runs/lib/unifiedDiff";
import type { DiffFile, WorktreeDiff } from "@/features/runs/lib/worktreeDiff";
import { DiffFileCard } from "@/features/runs/ui/DiffFileCard";
import { DiffReviewThread } from "@/features/runs/ui/DiffReviewThread";
import { RatioBar } from "@/features/runs/ui/RatioBar";
import { StatusBarReviewPopover } from "@/features/runs/ui/StatusBarReviewPopover";
import { authorHue } from "@/features/runs/ui/DockHistoryPanel";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

/** What the header can say about where this diff came from. Every field is
 * nullable and every `null` means "this diff has no such thing", never "we did
 * not look" — a worktree diff genuinely has no author. */
export interface DiffProvenance {
  /** The commit's subject, or the sentence a worktree diff is. Always
   * present: a reading with no title is a card with a hole in it. */
  subject: string;
  author: string | null;
  /** ISO-8601 with the author's own offset (`%aI`). */
  date: string | null;
  sha: string | null;
  /** The branch this is on — a worktree's own `branch`, or the refs git
   * reported for a commit. */
  branch: string | null;
  /** The merge sentence, the first-commit sentence, or a diff answer's
   * omission line. Said out loud, above the cards. */
  note: string | null;
}

const GHOST =
  "flex shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-2xs font-medium text-foreground/70 transition-colors hover:bg-foreground/[.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** Past this many lines a file card opens folded. **A commit is not a file**,
 * and a twelve-file commit where one is a 900-line regenerated lockfile is a
 * commit nobody scrolls to the end of. Sixty lines is about two screens; under
 * it a fold costs more than it saves. P4.4's number, unchanged — the fold moved
 * onto a card, the rule did not. */
const COLLAPSE_OVER_LINES = 60;

/** The mockup's `.kbd`. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border/60 bg-foreground/[.06] px-1 font-mono text-badge text-foreground/80">
      {children}
    </kbd>
  );
}

function focusedElement(): FocusedElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  return {
    contentEditable: active.isContentEditable,
    role: active.getAttribute("role"),
    tagName: active.tagName,
  };
}

export function DiffTab({
  bindingId,
  cwd,
  diff,
  paneWidth,
  provenance,
  testid,
  wraps,
}: {
  /** The worktree whose team thread the review agent answers in, or `null`. */
  bindingId: string | null;
  cwd: string | null;
  diff: WorktreeDiff;
  /** The measured width of the surface, for the one question that is in
   * pixels: whether two columns fit (`splitFitsAt`). */
  paneWidth: number;
  provenance: DiffProvenance;
  testid: string;
  /** The floor `patchWrapsAt` sets. The toolbar's Wrap toggle can turn wrapping
   * ON above it; nothing can turn it off below it, because below it there is no
   * grid left to protect (`diffLayout.ts`). */
  wraps: boolean;
}) {
  const prefs = React.useSyncExternalStore(
    subscribeDiffTabPrefs,
    getDiffTabPrefs,
    serverDiffTabPrefs,
  );
  const choice = useDiffMode();
  const refusal = splitRefusal(paneWidth);
  const fits = refusal === null;
  const mode = choice === "split" && fits ? "split" : "unified";
  const wrapping = wraps || prefs.wrap;

  const files = diff.files;
  const paths = React.useMemo(() => files.map((file) => file.path), [files]);

  // Every file's rows, its word-level markup and its change anchors, computed
  // once for the whole tab: the rows are what the cards draw, what `J`/`K` walk
  // and what "ignore whitespace" filters, and three copies of the same walk is
  // how the keyboard and the screen end up disagreeing about which row is
  // which.
  const model = React.useMemo(
    () => files.map((file) => readFile(file, prefs.ignoreWhitespace)),
    [files, prefs.ignoreWhitespace],
  );
  const hidden = model.reduce((sum, entry) => sum + entry.hidden, 0);

  const [closed, setClosed] = React.useState<ReadonlySet<string>>(() => {
    const folded = new Set<string>();
    for (const file of files) {
      if (file.patch.split("\n").length > COLLAPSE_OVER_LINES) {
        folded.add(file.path);
      }
    }
    return folded;
  });
  const [focus, setFocus] = React.useState<{
    path: string;
    row: number;
  } | null>(null);
  const [commenting, setCommenting] = React.useState<{
    path: string;
    row: number;
  } | null>(null);

  const review = useReviewDispatch(bindingId);
  const notes = useReviewNotes({ bindingId, paths });
  const [reviewOpen, setReviewOpen] = React.useState(false);

  // The scroller's own numbers, for the windowing (`diffTab.ts`'s `rowWindow`).
  // rAF-throttled, because a scroll event fires far faster than a frame and
  // each one that reached React would re-render every card on screen.
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [scroll, setScroll] = React.useState({ scrollTop: 0, viewport: 0 });
  React.useLayoutEffect(() => {
    const box = scrollRef.current;
    if (box === null) return;
    let queued = false;
    const read = () => {
      queued = false;
      setScroll({ scrollTop: box.scrollTop, viewport: box.clientHeight });
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(read);
    };
    read();
    box.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(read);
    observer.observe(box);
    return () => {
      box.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);

  // `J` / `K` walk the changed hunks of every OPEN card, in file order. A
  // folded card is not on screen, and a keyboard that jumped into one would
  // move a highlight nobody can see — the same rule the Diff pane's cursor
  // keeps about a list it has scrolled past.
  const anchors = React.useMemo(() => {
    const flat: { path: string; row: number }[] = [];
    model.forEach((entry, at) => {
      const path = files[at].path;
      if (closed.has(path)) return;
      for (const row of entry.anchors) flat.push({ path, row });
    });
    return flat;
  }, [closed, files, model]);

  const step = React.useCallback(
    (dir: -1 | 1) => {
      setFocus((was) => {
        if (anchors.length === 0) return null;
        const at =
          was === null
            ? -1
            : anchors.findIndex(
                (anchor) => anchor.path === was.path && anchor.row === was.row,
              );
        if (at === -1)
          return dir === 1 ? anchors[0] : anchors[anchors.length - 1];
        return anchors[Math.min(Math.max(at + dir, 0), anchors.length - 1)];
      });
    },
    [anchors],
  );

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(focusedElement())) return;
      if (event.metaKey || event.ctrlKey) return;
      if (event.altKey && event.key === "Enter") {
        event.preventDefault();
        setCommenting(focus);
        return;
      }
      if (event.altKey) return;
      if (event.key === "j" || event.key === "J") {
        event.preventDefault();
        step(1);
        return;
      }
      if (event.key === "k" || event.key === "K") {
        event.preventDefault();
        step(-1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focus, step]);

  // `J` past the bottom of the viewport has to bring the scroller with it, or
  // the key moves a ring nobody can see.
  React.useEffect(() => {
    if (focus === null) return;
    scrollRef.current
      ?.querySelector('[data-diff-focused="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  const author = provenance.author;
  const patchAuthor = patchAuthorInCrew(author, notes.roster);
  const unresolved = notes.notes.filter(
    (note) => !notes.resolved.has(note.id),
  ).length;

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#141417]"
      data-testid={testid}
    >
      <Header author={author} diff={diff} provenance={provenance} />
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/60 px-5 py-2">
        {/* The mockup's `.dvseg`. It writes the app's ONE diff-mode flag
            (`diffMode.ts`), the same one the Diff pane's toggle writes, so
            choosing split here is choosing it everywhere — which is that
            module's stated design and not this surface's opinion. */}
        <div
          className="flex gap-0.5 rounded-[7px] bg-foreground/5 p-0.5"
          data-testid="diff-tab-mode"
        >
          {(["unified", "split"] as const).map((name) => (
            <button
              aria-pressed={choice === name}
              className={`rounded-[5px] px-3 py-1 text-2xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                choice === name
                  ? "bg-foreground/[.12] text-foreground"
                  : "text-foreground/70 hover:text-foreground"
              } ${name === "split" && !fits ? "opacity-50" : ""}`}
              data-testid={`diff-tab-mode-${name}`}
              disabled={name === "split" && !fits}
              key={name}
              onClick={() => setDiffMode(name)}
              title={name === "split" ? (refusal ?? "") : ""}
              type="button"
            >
              {name === "unified" ? "Unified" : "Split"}
            </button>
          ))}
        </div>
        {/* **The refusal is said, not hidden** — Task 2's rule, kept whole:
            "below it, the toggle says why it is disabled rather than
            disappearing". A control that vanishes at some widths teaches the
            owner nothing except that the app is inconsistent; one that is
            visibly unavailable and states its own precondition teaches him the
            precondition. `basis-full` so it drops onto its own line rather
            than pushing the ghost buttons off the row. */}
        {refusal === null ? null : (
          <span
            className="order-last basis-full text-2xs text-foreground/70"
            data-testid="diff-tab-split-why"
            title={SPLIT_REFUSAL_DETAIL}
          >
            {refusal}
          </span>
        )}
        <button
          aria-pressed={prefs.ignoreWhitespace}
          className={`${GHOST} ${prefs.ignoreWhitespace ? "text-[var(--vingilot-accent-text)]" : ""}`}
          data-testid="diff-tab-ignore-whitespace"
          onClick={() =>
            setDiffTabPref("ignoreWhitespace", !prefs.ignoreWhitespace)
          }
          title="Hide changes whose only difference is whitespace. The counts above stay git's own."
          type="button"
        >
          Ignore whitespace
        </button>
        <button
          aria-pressed={wrapping}
          className={`${GHOST} ${prefs.wrap ? "text-[var(--vingilot-accent-text)]" : ""}`}
          data-testid="diff-tab-wrap"
          disabled={wraps}
          onClick={() => setDiffTabPref("wrap", !prefs.wrap)}
          title={
            wraps
              ? "this surface is under the patch's own column floor, so it wraps whatever this says"
              : "Soft-wrap long lines instead of scrolling sideways"
          }
          type="button"
        >
          Wrap
        </button>
        <button
          className={GHOST}
          data-testid="diff-tab-expand-all"
          onClick={() => setClosed(new Set())}
          type="button"
        >
          Expand all
        </button>
        <button
          className={`${GHOST} ml-auto`}
          data-testid="diff-tab-next-change"
          disabled={anchors.length === 0}
          onClick={() => step(1)}
          type="button"
        >
          Next change <Key>J</Key>
        </button>
        {/* **P4's popover, opened from a second trigger.** Not a second
            reviewer picker: the roster, the persisted instruction, the blocked
            sentence and the real send are all `useReviewDispatch`'s, and the
            body is the same `StatusBarReviewPopover` the status bar renders. */}
        <Popover onOpenChange={setReviewOpen} open={reviewOpen}>
          <PopoverTrigger asChild>
            <button
              className={GHOST}
              data-testid="diff-tab-review"
              type="button"
            >
              Review…
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[360px]" side="bottom">
            <StatusBarReviewPopover
              onStarted={() => setReviewOpen(false)}
              review={review}
            />
          </PopoverContent>
        </Popover>
      </div>

      {provenance.note === null ? null : (
        <p
          className="shrink-0 border-b border-border/60 bg-muted/40 px-5 py-1.5 text-2xs text-foreground/80"
          data-testid="diff-tab-note"
        >
          {provenance.note}
        </p>
      )}

      {files.length === 0 ? (
        <p
          className="flex flex-1 items-center justify-center px-6 py-4 text-center text-sm text-foreground/70"
          data-testid="diff-tab-empty"
        >
          nothing has changed against {diff.base} — no edits, no new files.
        </p>
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-6 pt-3.5"
          data-testid="diff-tab-scroll"
          ref={scrollRef}
        >
          {files.map((file, at) => {
            const entry = model[at];
            const open = !closed.has(file.path);
            const lines = notesByLine(notes.notes, file.path);
            return (
              <DiffFileCard
                cwd={cwd}
                file={file}
                focused={focus?.path === file.path ? focus.row : null}
                key={file.path}
                limits={diff.limits}
                markup={entry.markup}
                mode={mode}
                onComment={(row) => {
                  setFocus({ path: file.path, row });
                  setCommenting({ path: file.path, row });
                }}
                onToggle={() =>
                  setClosed((was) => {
                    const next = new Set(was);
                    if (next.has(file.path)) next.delete(file.path);
                    else next.add(file.path);
                    return next;
                  })
                }
                open={open}
                renderAfter={(row, index) => (
                  <>
                    {(row.after === null
                      ? []
                      : (lines.get(row.after) ?? [])
                    ).map((note) => (
                      <DiffReviewThread
                        actions={threadActions(notes, note, patchAuthor?.name)}
                        key={note.id}
                        note={note}
                      />
                    ))}
                    {commenting?.path === file.path &&
                    commenting.row === index ? (
                      <Composer
                        line={row.after ?? row.before}
                        onClose={() => setCommenting(null)}
                        path={file.path}
                        reviewer={review.reviewer?.name ?? null}
                        send={notes.send}
                      />
                    ) : null}
                  </>
                )}
                rows={entry.rows}
                scroll={{
                  el: scrollRef.current,
                  scrollTop: scroll.scrollTop,
                  viewport: scroll.viewport,
                }}
                wraps={wrapping}
              />
            );
          })}
        </div>
      )}

      <div
        className="flex shrink-0 flex-wrap items-center gap-2.5 border-t border-border/60 px-5 py-2.5 text-2xs text-foreground/70"
        data-testid="diff-tab-foot"
      >
        <span>
          {fileTally(files.length)} ·{" "}
          <span className="font-mono text-status-added">+{diff.additions}</span>{" "}
          <span className="font-mono text-status-deleted">
            −{diff.deletions}
          </span>
        </span>
        {hiddenNote(hidden) === null ? null : (
          <span data-testid="diff-tab-hidden">· {hiddenNote(hidden)}</span>
        )}
        <span data-testid="diff-tab-unresolved">
          ·{" "}
          {`${unresolved} unresolved review comment${unresolved === 1 ? "" : "s"}`}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Key>J</Key> / <Key>K</Key> next change · <Key>⌥⏎</Key> comment
        </span>
      </div>
    </div>
  );
}

/** One file's rows, markup and anchors — the walk every consumer shares. */
function readFile(file: DiffFile, ignoreWhitespace: boolean) {
  const all = unifiedRows(file.patch);
  const filtered = ignoreWhitespace
    ? withoutWhitespaceChanges(all)
    : { hidden: 0, rows: all };
  return {
    anchors: changeAnchors(filtered.rows),
    hidden: filtered.hidden,
    markup: wordMarkup(filtered.rows),
    rows: filtered.rows,
  };
}

function threadActions(
  notes: ReturnType<typeof useReviewNotes>,
  note: ReviewNote,
  patchAuthor: string | undefined,
) {
  return {
    apply:
      patchAuthor === undefined || notes.handBack === null
        ? null
        : (target: ReviewNote) => notes.handBack?.(target, patchAuthor),
    reply: notes.send,
    resolved: notes.resolved.has(note.id),
    setResolved: (value: boolean) => notes.setResolved(note.id, value),
  };
}

/** The mockup's `.dvh`.
 *
 * The meta row is built out of whatever this diff really has: an author only
 * when git named one, a sha only when there is a commit, a branch only when
 * something says which. A worktree diff draws the subject, the branch and the
 * file count and stops — which is the honest shape of what is known about it. */
function Header({
  author,
  diff,
  provenance,
}: {
  author: string | null;
  diff: WorktreeDiff;
  provenance: DiffProvenance;
}) {
  const now = Date.now();
  return (
    <div className="flex shrink-0 items-start gap-3 border-b border-border/60 px-5 pb-3.5 pt-4">
      <div className="min-w-0 flex-1">
        <h2
          className="text-sm font-semibold tracking-[-0.01em] text-foreground"
          data-testid="diff-tab-subject"
        >
          {provenance.subject}
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs text-foreground/70">
          {author === null ? null : (
            <>
              <span
                aria-hidden="true"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold text-white"
                style={{
                  background: `linear-gradient(140deg, hsl(${authorHue(author)} 45% 42%), hsl(${authorHue(author)} 45% 22%))`,
                }}
              >
                {author.slice(0, 1).toUpperCase()}
              </span>
              <b className="font-medium text-foreground/85">{author}</b>
            </>
          )}
          {provenance.date === null ? null : (
            <span title={provenance.date}>
              committed {commitAge(provenance.date, now)} ago
            </span>
          )}
          {provenance.sha === null ? null : (
            <span
              className="rounded-[5px] border border-border/60 bg-foreground/[.07] px-1.5 py-px font-mono text-badge text-foreground/80"
              data-testid="diff-tab-sha"
            >
              {provenance.sha}
            </span>
          )}
          {provenance.branch === null ? null : (
            <>
              <span>on</span>
              <span
                className="rounded-[5px] bg-[rgba(127,178,201,.16)] px-1.5 py-px font-mono text-badge text-[#b6d5e2]"
                data-testid="diff-tab-branch"
              >
                {provenance.branch}
              </span>
            </>
          )}
          <span>·</span>
          <span>{fileTally(diff.files.length)} changed</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5 font-mono text-2xs tabular-nums">
        <span className="text-status-added">+{diff.additions}</span>
        <span className="text-status-deleted">−{diff.deletions}</span>
        <RatioBar
          blocks={ratioBlocks(diff.additions, diff.deletions)}
          title={`${diff.additions} added, ${diff.deletions} removed`}
        />
      </div>
    </div>
  );
}

/** The comment `⌥⏎` (or the row's `+`) opens.
 *
 * **It sends into the same thread the reviewer answers in**, addressed to the
 * reviewer by name and anchored `path:line` — which is exactly the form
 * `reviewThread.ts` reads back, so a comment the owner leaves here is a comment
 * that lands under this line when the thread is read again. With no thread
 * bound there is nowhere to send, and the box says so rather than pretending to
 * post. */
function Composer({
  line,
  onClose,
  path,
  reviewer,
  send,
}: {
  line: number | null;
  onClose: () => void;
  path: string;
  reviewer: string | null;
  send: ((content: string) => void) | null;
}) {
  const [draft, setDraft] = React.useState("");
  const ref = React.useRef<HTMLTextAreaElement | null>(null);
  React.useEffect(() => {
    ref.current?.focus();
  }, []);
  const anchor = line === null ? path : `${path}:${line}`;
  return (
    <form
      className="border-y border-border/60 bg-foreground/[.03] px-4 py-3"
      data-testid="diff-tab-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (send === null || draft.trim() === "") return;
        send(
          `${reviewer === null ? "" : `@${reviewer} `}${anchor} — ${draft.trim()}`,
        );
        onClose();
      }}
    >
      <p className="mb-1.5 font-mono text-badge text-foreground/70">{anchor}</p>
      {send === null ? (
        <p className="text-xs text-foreground/70">
          this worktree has no team thread yet — open one in the Team pane, and
          a comment here goes to the crew in it.
        </p>
      ) : (
        <>
          <textarea
            className="min-h-16 w-full resize-y rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-ring"
            data-testid="diff-tab-composer-text"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
            }}
            ref={ref}
            value={draft}
          />
          <div className="mt-2 flex gap-2">
            <button
              className="rounded-md bg-foreground px-3 py-1 text-2xs font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              data-testid="diff-tab-composer-send"
              disabled={draft.trim() === ""}
              type="submit"
            >
              Comment
            </button>
            <button
              className="rounded-md border border-border/60 px-3 py-1 text-2xs font-medium text-foreground/80 transition-colors hover:bg-foreground/10"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </form>
  );
}
