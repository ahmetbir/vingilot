// **The mockup's `#pr-detail`, cut down to what was actually fetched**
// (`vingilot/design/mockup/Vingilot.html`, `vingilot.css` `.prdet`…`.tlb`).
//
// The mockup's detail is a timeline: the author's comment, a Commits card
// listing three subjects and their shas, a review card with a "requested
// changes" chip, and a Checks card with three green rows. `pulls_view` fetches
// **none** of that — `PullDetail` is `repo`, `remote`, `pull`, `body` and
// `bodyTruncated`, and `payload.rs` is where that list is decided.
//
// So the timeline is one card, the description, and the cards behind commits,
// reviews and checks are **absent rather than empty**. An empty "Checks" card
// would say this pull request has no checks, which is a claim about CI nobody
// here has made a request about; a skeleton one would say the same thing while
// pretending to still be loading. What survives from the mockup is its shape —
// the back row, the 17px head with a muted `#num`, the state pill, the "wants
// to merge into … from …" line in branch chips, and one `.tlcard`.
//
// **`bodyTruncated` is the island telling on itself and it is drawn.** `gh`
// bodies are capped at a fixed size before they cross the IPC (`capped_body`);
// when that cap bit, the card says so, because a description that just stops
// mid-sentence with no explanation reads as a broken renderer.

import type { PullDetail } from "@/features/pulls/lib/pullsAnswer";
import {
  agoText,
  conflictLabel,
  reviewLabel,
  stateLabel,
} from "@/features/pulls/lib/pullsCopy";
import {
  BranchChip,
  DiffStat,
  LabelChips,
} from "@/features/pulls/ui/pullsChips";
import { PullStateIcon } from "@/features/pulls/ui/pullsGlyphs";

/** "Bosun wants to merge into main from feature/surface-cards", with the two
 * refs as chips — and without the mockup's "3 commits", which is not fetched. */
function MergeLine({ detail }: { detail: PullDetail }) {
  const { pull } = detail;
  const who = pull.author === null ? null : pull.author;
  return (
    <p
      className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground"
      data-testid="pull-detail-merge"
    >
      {who === null ? null : (
        <span className="font-medium text-foreground/75">{who}</span>
      )}
      <span>{who === null ? "Merging into" : "wants to merge into"}</span>
      <BranchChip name={pull.baseRef} />
      <span>from</span>
      <BranchChip name={pull.headRef} />
    </p>
  );
}

export function PullDetailView({
  detail,
  onBack,
}: {
  detail: PullDetail;
  onBack: () => void;
}) {
  const { pull } = detail;
  const review = reviewLabel(pull);
  const conflict = conflictLabel(pull);
  const opened = agoText(pull.createdAt);
  const updated = agoText(pull.updatedAt);
  return (
    <div className="flex flex-col gap-2" data-testid="pull-detail">
      {/* The mockup's `.prback[data-act="pr-back"]`. */}
      <button
        className="-ml-1.5 inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-2xs text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
        data-act="pr-back"
        data-testid="pull-detail-back"
        onClick={onBack}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        All pull requests
      </button>

      <h3
        className="text-pretty px-1 text-sm font-semibold leading-snug text-foreground"
        data-testid="pull-detail-title"
      >
        {pull.title}{" "}
        <span className="font-normal text-muted-foreground">
          #{pull.number}
        </span>
      </h3>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
        {/* The mockup's `.prstate` pill. */}
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.07] px-2 py-0.5 text-badge font-semibold text-foreground/80"
          data-testid="pull-detail-state"
        >
          <PullStateIcon className="size-3" pull={pull} />
          {stateLabel(pull)}
        </span>
        <DiffStat
          additions={pull.additions}
          changedFiles={pull.changedFiles}
          deletions={pull.deletions}
        />
        {review === null ? null : (
          <span
            className="text-2xs text-muted-foreground"
            data-testid="pull-detail-review"
          >
            {review}
          </span>
        )}
        {conflict === null ? null : (
          <span
            className="text-2xs text-rose-600 dark:text-rose-400"
            data-testid="pull-detail-conflict"
          >
            {conflict}
          </span>
        )}
      </div>

      <div className="px-1">
        <MergeLine detail={detail} />
      </div>

      {pull.labels.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          <LabelChips labels={pull.labels} />
        </div>
      )}

      {/* One `.tlcard`: the description. The mockup's commits, review and
       * checks cards have no source and are not drawn — see this file's
       * header. */}
      <section className="overflow-hidden rounded-[10px] border border-border/70 bg-foreground/[0.02]">
        <header className="flex items-center gap-2 border-b border-border/70 bg-foreground/[0.03] px-2.5 py-1.5 text-2xs text-foreground/70">
          <b className="font-semibold text-foreground">Description</b>
          {opened === null ? null : (
            <span data-testid="pull-detail-opened">opened {opened}</span>
          )}
          {updated === null ? null : (
            <span className="ml-auto" data-testid="pull-detail-updated">
              updated {updated}
            </span>
          )}
        </header>
        <div className="px-2.5 py-2">
          {detail.body === "" ? (
            <p
              className="text-2xs italic text-muted-foreground"
              data-testid="pull-detail-no-body"
            >
              This pull request was opened without a description.
            </p>
          ) : (
            <p
              className="whitespace-pre-wrap text-pretty break-words text-2xs leading-relaxed text-foreground/80"
              data-testid="pull-detail-body"
            >
              {detail.body}
            </p>
          )}
          {detail.bodyTruncated ? (
            <p
              className="mt-2 text-badge text-muted-foreground"
              data-testid="pull-detail-truncated"
            >
              This description is longer than Vingilot reads; the rest is on
              GitHub.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
