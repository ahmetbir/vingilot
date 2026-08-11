// Suspense fallback for the /workspace route. Shaped like RunsScreen's first
// paint — WorkspaceNav-shaped aside + DeckPane-shaped main pane +
// ProjectStatusBar-shaped footer, because `selectedRepoId` starts null and
// the landing view is the Deck —
// rather than reusing ViewLoadingFallback's "agents" kind, which renders the
// Agents-list skeleton (library + teams sections) — a shape that belongs
// to that screen, not this one. Kept island-local (no new kind added to
// the shared ViewLoadingFallback) so this stays inside the already-declared
// desktop/src/features/runs/* seam instead of opening a new touch-point on
// a shared upstream file.

import { Skeleton } from "@/shared/ui/skeleton";

function ProjectRowSkeleton({ rowKey }: { rowKey: string }) {
  return (
    <div className="px-2 py-1.5" key={rowKey}>
      <Skeleton className="h-4 w-24 max-w-full" />
    </div>
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
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-border/60 px-2 py-3">
          <div className="px-2 py-1.5">
            <Skeleton className="h-4 w-10" />
          </div>
          <div className="mt-2 px-2">
            <Skeleton className="h-3 w-14" />
          </div>
          <div className="mt-1 flex flex-col gap-0.5">
            {["project-a", "project-b"].map((rowKey) => (
              <ProjectRowSkeleton key={rowKey} rowKey={rowKey} />
            ))}
          </div>
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

      <div className="flex shrink-0 items-center gap-2 border-t border-border/60 px-4 py-1.5">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="ml-auto h-3 w-16" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
    </div>
  );
}
