// The mockup's `.rvw` — the local review agent's note, drawn INSIDE the diff
// under the line it is about (DIFF-TAB-BRIEF §5).
//
// > "buradaki change request filan localdeki review agenti ile olan ama ona
// > dikkat. upstreamle alakasi yok. orasi pull requests kisminda olacak"
//
// **Whose note this is, and whose it is not.** It is the crew member the status
// bar's Review popover dispatched (`useReviewDispatch`), answering in this
// worktree's team thread about the owner's own work in this checkout. It is
// not a GitHub pull request review: nothing here is fetched with `gh`, no
// field carries a PR number, and — this is the part that takes discipline — the
// **vocabulary is not a PR's either**. The mockup writes "Lookout requested
// changes on line 42" with a `changes requested` pill; both of those are pull
// request review STATES, they have no source in this build, and the owner's
// clarification is explicit that the two vocabularies must not merge. So the
// sentence says what this app actually knows — who wrote it and which line it
// is about — and the pill says the one state that is real here: whether the
// owner has marked it resolved on this machine
// (`lib/reviewResolvedStore.ts` argues why that state can only be local).
//
// **Apply suggestion is offered only when there is somebody to hand it to.**
// The brief's "Apply hands it back to the agent that wrote the patch" needs a
// patch author this app can address, and the only one it ever has is a
// commit's git author when that name is also on this workspace's crew roster
// (`patchAuthorInCrew`). A worktree diff has no author; a commit the owner
// wrote has no agent behind it. In both cases the button is absent rather than
// sending a message nobody receives.

import * as React from "react";

import type { ReviewNote } from "@/features/runs/lib/reviewThread";
import { noteHeadline, replyMessage } from "@/features/runs/lib/reviewThread";
import { authorHue } from "@/features/runs/ui/DockHistoryPanel";

export interface ThreadActions {
  /** Send a reply into the thread, or `null` when this worktree has no thread
   * bound — the note can still be read and resolved, it simply cannot be
   * answered from here. */
  reply: ((content: string) => void) | null;
  /** Hand this note to the agent that wrote the code, or `null` when there is
   * no such agent to name. */
  apply: ((note: ReviewNote) => void) | null;
  resolved: boolean;
  setResolved: (value: boolean) => void;
}

export function DiffReviewThread({
  actions,
  note,
}: {
  actions: ThreadActions;
  note: ReviewNote;
}) {
  const [replying, setReplying] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const hue = authorHue(note.author);

  return (
    // The mockup's own indent: the thread starts where the code does, so it
    // reads as belonging to the line above rather than to the file.
    <div
      className="border-y border-border/60 bg-foreground/[.03] py-3 pl-[14ch] pr-4"
      data-review-note={note.id}
    >
      <div className="flex items-center gap-2 text-xs text-foreground/75">
        <span
          aria-hidden="true"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold text-white"
          style={{
            background: `linear-gradient(140deg, hsl(${hue} 45% 42%), hsl(${hue} 45% 22%))`,
          }}
        >
          {note.author.slice(0, 1).toUpperCase()}
        </span>
        <span className="font-semibold text-foreground">{note.author}</span>
        <span>{noteHeadline(note)}</span>
        <span
          className={`ml-auto shrink-0 rounded-[9px] px-2 text-badge font-semibold ${
            actions.resolved
              ? "bg-foreground/10 text-foreground/70"
              : "bg-status-modified/20 text-status-modified"
          }`}
          data-review-state={actions.resolved ? "resolved" : "unresolved"}
        >
          {actions.resolved ? "resolved" : "unresolved"}
        </span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-foreground/75">
        {note.body}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {actions.apply === null ? null : (
          <button
            className="rounded-md bg-foreground px-3 py-1 text-2xs font-semibold text-background transition-opacity hover:opacity-90"
            data-testid={`review-note-apply-${note.id}`}
            onClick={() => actions.apply?.(note)}
            type="button"
          >
            Apply suggestion
          </button>
        )}
        {actions.reply === null ? null : (
          <button
            className="rounded-md border border-border/60 px-3 py-1 text-2xs font-medium text-foreground/80 transition-colors hover:bg-foreground/10 hover:text-foreground"
            data-testid={`review-note-reply-${note.id}`}
            onClick={() => setReplying((was) => !was)}
            type="button"
          >
            Reply
          </button>
        )}
        <button
          className="rounded-md border border-border/60 px-3 py-1 text-2xs font-medium text-foreground/80 transition-colors hover:bg-foreground/10 hover:text-foreground"
          data-testid={`review-note-resolve-${note.id}`}
          onClick={() => actions.setResolved(!actions.resolved)}
          type="button"
        >
          {actions.resolved ? "Reopen" : "Resolve"}
        </button>
      </div>
      {replying && actions.reply !== null ? (
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim() === "") return;
            actions.reply?.(replyMessage(note, draft, "thread"));
            setDraft("");
            setReplying(false);
          }}
        >
          <textarea
            className="min-h-16 w-full resize-y rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-ring"
            data-testid={`review-note-draft-${note.id}`}
            onChange={(event) => setDraft(event.target.value)}
            value={draft}
          />
          <button
            className="self-start rounded-md bg-foreground px-3 py-1 text-2xs font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            data-testid={`review-note-send-${note.id}`}
            disabled={draft.trim() === ""}
            type="submit"
          >
            Send to the thread
          </button>
        </form>
      ) : null}
    </div>
  );
}
