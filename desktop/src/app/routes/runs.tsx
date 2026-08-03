import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const RunsScreen = React.lazy(async () => {
  const module = await import("@/features/runs/ui/RunsScreen");
  return { default: module.RunsScreen };
});

export const Route = createFileRoute("/runs")({
  component: RunsRouteComponent,
});

function RunsRouteComponent() {
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="agents" />}>
      <RunsScreen />
    </React.Suspense>
  );
}
