// The chat views' statusline — `ProjectStatusBar`'s sibling, deliberately not
// the same component: that bar's whole left half is worktree-shaped (repo,
// branch, diff, wall clock) and none of it exists on a channel, while this
// bar's two facts (community, relay) sit behind hooks the workspace bar never
// reads. One bar covering both would be a prop surface of null-heavy branches
// for facts the current screen cannot have — the coupling `ProjectStatusBar`'s
// own header warns against.
//
// Two facts, both from existing stores — nothing here polls:
// - the community's name (`useCommunities().activeCommunity`, context);
// - the relay connection word (`useRelayConnection`, push-driven and
//   debounced there; the words are `relayStatus.ts`'s contract).
//
// The relay word is a button exactly when clicking it can do something
// (`relayStatus.canReconnect`), and the click is the same act the sidebar's
// relay card fires: `useReconnectRelay`, whose in-flight state is a
// module-level singleton — two surfaces clicking cannot race two reconnects.
//
// Geometry: same footer recipe as ProjectStatusBar (border-t, text-2xs,
// horizontal-only inner padding) so the two bars read as one system, and the
// right-hand word is always present in every state — the bar never changes
// height or jumps when the connection state moves.

import { relayStatus } from "@/features/channels/lib/relayStatus";
import { useCommunities } from "@/features/communities/useCommunities";
import { useReconnectRelay } from "@/shared/api/useReconnectRelay";
import { useRelayConnection } from "@/shared/api/useRelayConnection";

/** The doors' hover ramp — ProjectStatusBar's, verbatim: padding cancelled by
 * the margin at rest so a word that becomes a door does not move. */
const DOOR =
  "-mx-1 rounded-sm px-1 transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

export function ChatStatusBar() {
  const { activeCommunity } = useCommunities();
  const state = useRelayConnection();
  const status = relayStatus(state);
  const { isPending, reconnect } = useReconnectRelay();

  return (
    <footer
      className="flex shrink-0 items-center gap-2 overflow-hidden border-t border-border/60 px-4 py-1.5 text-2xs text-muted-foreground"
      data-testid="chat-status-bar"
    >
      <span className="min-w-0 truncate whitespace-nowrap">
        {/* Absent entirely when no community is configured: a placeholder
         * would be a claim about a thing that is not there, and the bar's
         * height is carried by the relay word either way. */}
        {activeCommunity !== null ? (
          <span
            className="font-medium text-foreground"
            data-testid="statusbar-community"
          >
            {activeCommunity.name}
          </span>
        ) : null}
      </span>
      <span className="ml-auto flex shrink-0 items-center whitespace-nowrap">
        {status.canReconnect ? (
          <button
            className={DOOR}
            data-state={state}
            data-testid="relay-status"
            disabled={isPending}
            onClick={() => void reconnect()}
            title={status.detail}
            type="button"
          >
            {status.word}
          </button>
        ) : (
          <span
            data-state={state}
            data-testid="relay-status"
            title={status.detail}
          >
            {status.word}
          </span>
        )}
      </span>
    </footer>
  );
}
