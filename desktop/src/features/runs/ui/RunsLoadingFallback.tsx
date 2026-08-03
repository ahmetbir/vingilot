// Suspense fallback for the /runs route. Shaped like RunsScreen itself
// (header + RunList-shaped aside + DeckPane-shaped main pane) rather than
// reusing ViewLoadingFallback's "agents" kind, which renders the
// Agents-list skeleton (library + teams sections) — a shape that belongs
// to that screen, not this one. Kept island-local (no new kind added to
// the shared ViewLoadingFallback) so this stays inside the already-declared
// desktop/src/features/runs/* seam instead of opening a new touch-point on
// a shared upstream file.

import { Skeleton } from "@/shared/ui/skeleton";

function RailRowSkeleton({ rowKey }: { rowKey: string }) {
  return (
    <div className="pl-6 pr-2" key={rowKey}>
      <div className="flex items-center gap-2 py-1.5">
        <Skeleton className="h-2 w-2 shrink-0 rounded-full" />
        <Skeleton className="h-4 w-32 max-w-full" />
      </div>
    </div>
  );
}

function RailGroupSkeleton({
  rowKeys,
  titleWidth,
}: {
  rowKeys: readonly string[];
  titleWidth: string;
}) {
  return (
    <section className="mt-2">
      <div className="px-2">
        <Skeleton className={`h-3 ${titleWidth}`} />
      </div>
      <div className="mt-1 flex flex-col gap-0.5">
        {rowKeys.map((rowKey) => (
          <RailRowSkeleton key={rowKey} rowKey={rowKey} />
        ))}
      </div>
    </section>
  );
}

function DeckCardSkeleton({ cardKey }: { cardKey: string }) {
  return (
    <div
      className="rounded-2xl border border-border/70 bg-card/80 p-3"
      key={cardKey}
    >
      <div className="flex items-center gap-2">
        <Skeleton className="h-2 w-2 shrink-0 rounded-full" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Skeleton className="h-4 w-10 rounded-full" />
        <Skeleton className="h-3 w-14" />
      </div>
    </div>
  );
}

function DeckLaneSkeleton({
  cardKeys,
  titleWidth,
}: {
  cardKeys: readonly string[];
  titleWidth: string;
}) {
  return (
    <section>
      <Skeleton className={`h-3 ${titleWidth}`} />
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {cardKeys.map((cardKey) => (
          <DeckCardSkeleton cardKey={cardKey} key={cardKey} />
        ))}
      </div>
    </section>
  );
}

export function RunsLoadingFallback() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-border/60 px-2 py-3">
          <div className="px-2 py-1.5">
            <Skeleton className="h-4 w-20" />
          </div>
          <RailGroupSkeleton
            rowKeys={["needs-you-a", "needs-you-b"]}
            titleWidth="w-16"
          />
          <RailGroupSkeleton rowKeys={["live-a"]} titleWidth="w-10" />
        </aside>

        <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-5">
          <Skeleton className="h-14 w-full rounded-2xl" />
          <DeckLaneSkeleton
            cardKeys={["needs-you-card-a", "needs-you-card-b"]}
            titleWidth="w-20"
          />
          <DeckLaneSkeleton
            cardKeys={["recent-card-a", "recent-card-b", "recent-card-c"]}
            titleWidth="w-14"
          />
        </main>
      </div>
    </div>
  );
}
