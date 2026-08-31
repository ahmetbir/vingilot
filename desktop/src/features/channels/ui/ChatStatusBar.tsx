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
// Geometry, since redesign P4: the mockup's `.status` bar is 36px
// (`h-9`, matched here) but its separate floating-card treatment
// (rounded/bordered/shadowed — `VINGILOT_CARD_CLASS`, which
// `ProjectStatusBar` now wears) is deliberately NOT repeated on this bar.
// The workspace route draws its own three sibling cards on the bare
// gradient (stage, dock, status — `AppShellChannelSurface`'s `ownCards`);
// the channel route does not opt into that layout, so a channel screen is
// still ONE card (header + messages + composer + this bar) inside
// `ContentSurface`'s own rounded/shadowed box. Wrapping this bar in a
// SECOND border+shadow+radius nested inside that one would double chrome
// the mockup never draws — it has no channel view at all. So this bar
// keeps the plain border-t footer that already reads as "the bottom strip
// of the one card it lives in," at the mockup's height. A conscious scope
// decision, not an oversight: multi-card channel views are outside P4.
// Otherwise unchanged — text-2xs, horizontal-only inner padding, and the
// right-hand word always present so the bar never jumps when the
// connection state moves.

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
      className="flex h-9 shrink-0 items-center gap-2 overflow-hidden border-t border-border/60 px-4 text-2xs text-muted-foreground"
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
