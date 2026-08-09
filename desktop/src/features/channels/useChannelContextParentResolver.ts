import * as React from "react";

import { useAppShell } from "@/app/AppShellContext";
import {
  MSG_PREFIX,
  THREAD_PREFIX,
} from "@/features/channels/readState/readStateFormat";
import { useIsHostedChannel } from "@/shared/context/HostedChannelContext";

/**
 * Tells the read-state manager which channel a thread or message context id
 * belongs to, for as long as that channel is the one on screen.
 *
 * **One resolver, one manager.** Whoever sets it answers for the whole app and
 * the last mount wins, so a channel surface hosted outside the channel route
 * (`useIsHostedChannel`) does not claim it: a workspace can show several
 * channels at once and none of them is the app's answer. The cost, stated: a
 * thread opened in a hosted surface has its read state roll up only while the
 * channel route is also mounted.
 *
 * Split out of `ChannelScreen` when that file reached its size cap — it is one
 * effect with one reason, which makes it the right thing to lift out first.
 */
export function useChannelContextParentResolver(
  activeChannelId: string | null,
) {
  const { setContextParentResolver } = useAppShell();
  const isHostedChannel = useIsHostedChannel();

  React.useEffect(() => {
    if (isHostedChannel) return;
    if (!activeChannelId) {
      setContextParentResolver(null);
      return;
    }
    setContextParentResolver((contextId) =>
      contextId.startsWith(THREAD_PREFIX) || contextId.startsWith(MSG_PREFIX)
        ? activeChannelId
        : null,
    );
    return () => setContextParentResolver(null);
  }, [activeChannelId, isHostedChannel, setContextParentResolver]);
}
