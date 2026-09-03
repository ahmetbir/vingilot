import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { RunsLoadingFallback } from "@/features/runs/ui/RunsLoadingFallback";

const RunsScreen = React.lazy(async () => {
  const module = await import("@/features/runs/ui/RunsScreen");
  return { default: module.RunsScreen };
});

export const Route = createFileRoute("/workspace")({
  component: WorkspaceRouteComponent,
  // `?wt=<binding id>`: the selected worktree, so the app's own back/forward
  // walks worktrees (features/runs/lib/useWorktreeUrlSync.ts). Anything else
  // in the search is dropped rather than carried.
  validateSearch: (search: Record<string, unknown>): { wt?: string } =>
    typeof search.wt === "string" && search.wt !== "" ? { wt: search.wt } : {},
});

function WorkspaceRouteComponent() {
  return (
    <React.Suspense fallback={<RunsLoadingFallback />}>
      <RunsScreen />
    </React.Suspense>
  );
}
