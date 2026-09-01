// **A refusal, drawn as a refusal** (redesign plan P5; `lib/pullsCopy.ts`).
//
// Nine ways the read ends without a list, and this component is where each one
// becomes something the owner reads. It holds no words of its own: every
// sentence comes from `refusalCopy`, which is where the copy is reviewed and
// where the rule that a hint is `null` rather than invented is enforced.
//
// **It is never an empty box and never a spinner.** The one failure mode this
// whole feature is written against is a refusal that renders as "no pull
// requests" — a false statement about the owner's repository. So the notice
// draws the headline as ordinary readable text at the pane's own size, keeps
// the hint under it, and offers the one action that can change the answer:
// asking again. Nothing here retries by itself; a `gh` that is not installed
// will not become installed while the pane polls it.

import type { PullsRefusal } from "@/features/pulls/lib/pullsAnswer";
import { refusalCopy } from "@/features/pulls/lib/pullsCopy";

export function PullsRefusalNotice({
  onRetry,
  refusal,
}: {
  onRetry: () => void;
  refusal: PullsRefusal;
}) {
  const copy = refusalCopy(refusal);
  return (
    <div
      className="flex flex-col gap-1.5 rounded-[10px] border border-border/70 bg-foreground/[0.02] px-3 py-2.5"
      data-refusal={refusal.kind}
      data-testid="pulls-refusal"
    >
      <p
        className="text-pretty text-2xs font-medium text-foreground/85"
        data-testid="pulls-refusal-headline"
      >
        {copy.headline}
      </p>
      {copy.hint === null ? null : (
        <p
          className="text-pretty text-2xs leading-relaxed text-muted-foreground"
          data-testid="pulls-refusal-hint"
        >
          {copy.hint}
        </p>
      )}
      <button
        className="self-start rounded-md px-1.5 py-0.5 text-badge text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
        data-testid="pulls-retry"
        onClick={onRetry}
        type="button"
      >
        Try again
      </button>
    </div>
  );
}
