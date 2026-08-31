// The mockup's working-agents segment (`.sg`:
// `<span class="spin"></span><b>2 agents</b><span>Bosun · Lookout</span>`,
// Vingilot.html:329) — the crew members with an active ACP turn in THIS
// worktree's team thread right now. Real, not the mockup's invented "2
// agents · Bosun · Lookout": the working set comes from
// `activeAgentTurnsStore` (via `useChannelWorkingAgentPubkeys`, scoped to the
// worktree's own thread channel — the same scope the dock's Crew tab
// renders), cross-referenced against the managed-agent records that carry a
// name for each pubkey. Renders nothing when nobody is working — the app's
// "absence is not a claim" rule (`ProjectStatusBar`'s own `live-agent`
// segment keeps it one file over): a "0 agents" plate would be a fact about
// idle nobody asked for.
//
// **Distinct from the bar's OTHER agent segment** (`data-testid="live-agent"`
// in `ProjectStatusBar`): that one reads `vingilot_hooks`' terminal
// liveness — a coding agent running INSIDE a shell (Claude Code hooked into
// this worktree's pty). This one reads the buzz-relay crew's ACP turns
// (Bosun, Lookout, the very personas the mockup names). The mockup draws one
// segment; this app has two real signals behind it, and both render rather
// than one masquerading as both.

import { useChannelWorkingAgentPubkeys } from "@/features/agents/agentWorkingSignal";
import type { ManagedAgent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

export function StatusBarWorkingAgents({
  agents,
  threadChannelId,
}: {
  /** Every managed agent this workspace has — read once by the caller
   * (`ProjectStatusBar`) and handed down, so this segment and Review's
   * roster read the same query result rather than two independent fetches
   * of one fact. */
  agents: readonly ManagedAgent[];
  /** The selected worktree's team-thread channel, or `null` when it has
   * none open yet — the same pointer `teamThreadStore.ts` gives Review. */
  threadChannelId: string | null;
}) {
  const workingPubkeys = useChannelWorkingAgentPubkeys(threadChannelId);
  const working = new Set(workingPubkeys.map(normalizePubkey));
  const names = agents
    .filter((agent) => working.has(normalizePubkey(agent.pubkey)))
    .map((agent) => agent.name);

  // Named, not merely counted: a pubkey with no matching managed-agent
  // record (an agent this client cannot yet name) is dropped from BOTH the
  // count and the list, so the two numbers on screen never disagree.
  if (names.length === 0) return null;

  return (
    <span
      className="flex h-4 items-center gap-1.5 whitespace-nowrap border-l border-foreground/[.08] px-3.5 text-2xs"
      data-testid="statusbar-working-agents"
    >
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-foreground/15 border-t-[var(--vingilot-accent)]"
      />
      <b className="font-semibold text-foreground/85">
        {names.length} agent{names.length === 1 ? "" : "s"}
      </b>
      <span className="text-foreground/60">{names.join(" · ")}</span>
    </span>
  );
}
