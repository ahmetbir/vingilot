// **The mockup's `#pr-list`, in a 196–340px column instead of the stage**
// (`vingilot/design/mockup/Vingilot.html`, `vingilot.css` `.prlist`/`.prrow`).
//
// The mockup's row is one line: glyph, title, then a meta line, then a right
// rail of CI/comments/reviewers pushed out by `margin-left:auto`. In the
// sidebar there is no room for a rail and no data behind it (see
// `pullsChips.tsx`), so the row keeps the mockup's shape — bordered card,
// 10px radius, glyph flush left, title in 600 weight, meta under it — and
// wraps the meta rather than reserving a right column.
//
// **What each clause draws is what the island sent, or nothing.** A deleted
// author drops the name instead of writing "unknown"; a repository with no
// labels draws no label chips; `reviewDecision: null` says nothing at all,
// because "no reviews" would be a claim about GitHub that this field does not
// make. All of that is decided in `pullsCopy.ts` and this file only places it.
//
// **An empty list is drawn empty, in words.** `pulls: []` is a true answer —
// this fork's own `ahmetbir/vingilot` really answers it — so it gets a sentence
// naming the repository it is about, never a spinner and never a placeholder
// row.

import type { Pull, PullList } from "@/features/pulls/lib/pullsAnswer";
import {
  conflictLabel,
  metaText,
  reviewLabel,
  slugText,
  stateLabel,
} from "@/features/pulls/lib/pullsCopy";
import {
  BranchChip,
  DiffStat,
  LabelChips,
} from "@/features/pulls/ui/pullsChips";
import { PullStateIcon } from "@/features/pulls/ui/pullsGlyphs";

function PullRow({ onOpen, pull }: { onOpen: () => void; pull: Pull }) {
  const review = reviewLabel(pull);
  const conflict = conflictLabel(pull);
  return (
    <button
      className="flex w-full items-start gap-2 rounded-[10px] border border-border/70 bg-foreground/[0.02] px-2.5 py-2 text-left hover:border-border hover:bg-foreground/[0.05]"
      data-pr={pull.number}
      data-testid="pull-row"
      onClick={onOpen}
      type="button"
    >
      <PullStateIcon className="mt-0.5 size-4 shrink-0" pull={pull} />
      <span className="flex min-w-0 flex-col gap-1">
        <span
          className="text-pretty text-sm font-semibold leading-snug text-foreground"
          data-testid="pull-row-title"
        >
          {pull.title}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
          <span data-testid="pull-row-meta">{metaText(pull)}</span>
          <BranchChip name={pull.headRef} />
          {pull.headRef === "" || pull.baseRef === "" ? null : (
            <span aria-hidden="true">→</span>
          )}
          <BranchChip name={pull.baseRef} />
          <LabelChips labels={pull.labels} />
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
          <span data-testid="pull-row-state">{stateLabel(pull)}</span>
          <DiffStat
            additions={pull.additions}
            changedFiles={pull.changedFiles}
            deletions={pull.deletions}
          />
          {review === null ? null : (
            <span data-testid="pull-row-review">{review}</span>
          )}
          {conflict === null ? null : (
            <span
              className="text-rose-600 dark:text-rose-400"
              data-testid="pull-row-conflict"
            >
              {conflict}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

export function PullsList({
  list,
  onOpen,
}: {
  list: PullList;
  onOpen: (number: number) => void;
}) {
  if (list.pulls.length === 0) {
    return (
      <p
        className="text-pretty px-1 py-1 text-2xs leading-relaxed text-muted-foreground"
        data-testid="pulls-empty"
      >
        {slugText(list.repo)} has no open pull requests.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid="pulls-list">
      {list.pulls.map((pull) => (
        <PullRow
          key={pull.number}
          onOpen={() => onOpen(pull.number)}
          pull={pull}
        />
      ))}
      {/* The cap is the island's, read off the answer, so this line can never
       * disagree with the list above it (`PullList.cap`). */}
      {list.more ? (
        <p
          className="px-1 pt-0.5 text-badge text-muted-foreground"
          data-testid="pulls-more"
        >
          The first {list.cap}. {slugText(list.repo)} has more open than fit
          here.
        </p>
      ) : null}
    </div>
  );
}
