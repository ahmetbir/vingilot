// The mockup's Review popover body (`.revpop`, Vingilot.html:415-425) — the
// reviewer picker, the persisted instruction, Reset to default, and Start
// review. Rendered inside the app's own `PopoverContent` (Radix: portal,
// click-outside, Escape, focus trap all for free) rather than a hand-rolled
// absolutely-positioned box — `StatusBarQuickActions.tsx` is the trigger.
//
// **The declared exception, enforced by construction**: nothing in this file
// imports `ptyClient`/`terminalType`, and `onStart` is `useReviewDispatch`'s
// `start`, which sends a real channel message — Review never types into
// tmux.

import type { ReviewDispatch } from "@/features/runs/lib/useReviewDispatch";

export function StatusBarReviewPopover({
  onStarted,
  review,
}: {
  /** Called after `review.start()` fires, so the trigger can close the
   * popover — kept out of this component's own state since the popover's
   * open/closed-ness belongs to whoever renders the `Popover` around it. */
  onStarted: () => void;
  review: ReviewDispatch;
}) {
  return (
    <div data-testid="review-popover">
      <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        Reviewer
      </p>
      {review.roster.length === 0 ? (
        <p className="text-sm text-foreground/70" data-testid="review-no-crew">
          No reviewer is minted for this workspace yet.
        </p>
      ) : (
        <fieldset className="flex flex-wrap gap-1.5 border-0 p-0">
          <legend className="sr-only">Reviewer</legend>
          {review.roster.map((candidate) => {
            const active = review.reviewer?.personaId === candidate.personaId;
            return (
              <button
                aria-pressed={active}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/60"
                    : "bg-foreground/5 text-foreground/65 hover:bg-foreground/10"
                }`}
                data-testid={`review-reviewer-${candidate.personaId}`}
                key={candidate.personaId}
                onClick={() => review.selectReviewer(candidate.personaId)}
                type="button"
              >
                {candidate.name}
              </button>
            );
          })}
        </fieldset>
      )}
      <p className="mb-2 mt-3.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        Instruction
      </p>
      <textarea
        className="min-h-24 w-full resize-y rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
        data-testid="review-instruction"
        onChange={(event) => review.setInstruction(event.target.value)}
        value={review.instruction}
      />
      {review.blocked !== null ? (
        <p
          className="mt-2 text-xs text-amber-600 dark:text-amber-400"
          data-testid="review-blocked"
        >
          {review.blocked}
        </p>
      ) : null}
      <div className="mt-3 flex items-center">
        <button
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          data-testid="review-reset"
          onClick={review.resetInstruction}
          type="button"
        >
          Reset to default
        </button>
        <button
          className="ml-auto rounded-lg bg-foreground px-4 py-1.5 text-xs font-semibold text-background transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
          data-testid="review-start"
          disabled={
            review.reviewer === null ||
            review.blocked !== null ||
            review.pending
          }
          onClick={() => {
            review.start();
            onStarted();
          }}
          type="button"
        >
          Start review
        </button>
      </div>
    </div>
  );
}
