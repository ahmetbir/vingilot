import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { RunsLoadingFallback } from "@/features/runs/ui/RunsLoadingFallback";

const RunsScreen = React.lazy(async () => {
  const module = await import("@/features/runs/ui/RunsScreen");
  return { default: module.RunsScreen };
});

export const Route = createFileRoute("/workspace")({
  component: WorkspaceRouteComponent,
});

function WorkspaceRouteComponent() {
  return (
    <React.Suspense fallback={<RunsLoadingFallback />}>
      <RunsScreen />
    </React.Suspense>
  );
}
