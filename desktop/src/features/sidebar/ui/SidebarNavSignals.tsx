// **The primary menu's live badges** (vingilot redesign P1; mockup sidebar
// rows 78-81: Agents carries a working dot, Pull requests an open count).
//
// Fork-owned, beside `AppSidebarPinnedHeader.tsx`, so that upstream file's
// edit stays rows and labels. Both signals are *read* here, never derived:
//
// - **Agents working** — `useWorkingChannels` from the agent working signal,
//   the same store every working indicator in the app renders from. Any
//   channel with agent work in progress lights the dot.
// - **Open pull requests** — `useProjectsWorkItemsQuery` over
//   `useProjectsQuery`'s list, the exact query the Projects screen itself
//   runs (same key, same staleTime — one cache entry, not a second fetch),
//   filtered to `status === "Open"`.

import { useWorkingChannels } from "@/features/agents/agentWorkingSignal";
import {
  useProjectsQuery,
  useProjectsWorkItemsQuery,
} from "@/features/projects/hooks";
import {
  isRelayConnectionDegraded,
  useRelayConnection,
} from "@/shared/api/useRelayConnection";
import { cn } from "@/shared/lib/cn";

/** Count of open pull requests across every project, or 0 while loading. */
export function useOpenPullRequestCount(): number {
  const projectsQuery = useProjectsQuery();
  const workItemsQuery = useProjectsWorkItemsQuery(projectsQuery.data ?? []);
  const items = workItemsQuery.data?.pullRequests.items;
  if (items === undefined) return 0;
  return items.filter((item) => item.pullRequest.status === "Open").length;
}

/** True while any channel has agent work in progress. */
export function useAnyAgentWorking(): boolean {
  return useWorkingChannels().length > 0;
}

/** The me-footer's relay dot (mockup `.me .dot`): green while the relay
 * connection is healthy, amber while degraded, red when it is gone. Reads the
 * shared debounced connection state — the same source the relay card renders
 * from, so the two can never disagree for longer than the debounce. */
export function SidebarConnectionDot() {
  const connection = useRelayConnection();
  const degraded = isRelayConnectionDegraded(connection);
  return (
    <span
      aria-label={`Relay ${connection}`}
      className={cn(
        // `block`: outside a flex parent an inline span collapses to 0×0 and
        // the h-2/w-2 box never paints (measured in the me-footer wrapper).
        "block h-2 w-2 shrink-0 rounded-full",
        connection === "disconnected"
          ? "bg-rose-500"
          : degraded
            ? "bg-amber-400"
            : "bg-emerald-500",
      )}
      data-connection={connection}
      data-testid="sidebar-connection-dot"
      role="status"
      title={`Relay ${connection}`}
    />
  );
}

/** The Agents row's working dot — rendered only while it has something to
 * say, in the accent that means "working" everywhere else (AttentionDot's
 * emerald pulse). */
export function AgentsWorkingDot() {
  const working = useAnyAgentWorking();
  if (!working) return null;
  return (
    <span
      aria-label="Agents are working"
      className="ml-auto h-2 w-2 shrink-0 rounded-full bg-emerald-500 motion-safe:animate-pulse"
      data-testid="sidebar-agents-working-dot"
      role="status"
    />
  );
}
