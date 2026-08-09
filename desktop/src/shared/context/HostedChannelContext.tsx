import * as React from "react";

/**
 * Whether the channel surface below this point is *hosted* — mounted somewhere
 * other than the `/channels/$channelId` route, e.g. inside a workspace pane.
 *
 * The channel screen is channel-id driven and needs nothing from the router to
 * render, but four of the things it does are **per-app** rather than
 * per-surface, and each of them is a single slot:
 *
 * 1. the auxiliary-panel state (`thread`, `profile`, `agentSession`) lives in
 *    the hosting route's URL, so two hosted surfaces would share one panel;
 * 2. the measured channel-header CSS variable is written onto the app's main
 *    inset — a host supplies its own inset instead (`MainInsetProvider`), so
 *    that one needs nothing here;
 * 3. `setContextParentResolver` is one function on the one read-state manager;
 * 4. `setVisibleChannel` is one slot on the relay client.
 *
 * On the route there is exactly one channel screen and every one of those is
 * unambiguous. In a pane there can be several at once and none of them is *the*
 * channel the app is showing, so a second claimant would silently take the
 * first one's. A hosted surface therefore keeps its panel state to itself and
 * leaves the app-wide slots to the route.
 *
 * Read by `useChannelPanelHistoryState`, `ChannelScreen`,
 * `useChannelSubscription` and `FocusThreadDrawer`.
 */
const HostedChannelContext = React.createContext(false);

/** Marks everything below it as a channel surface hosted outside the channel
 * route. There is no way to turn it back off: a channel route is never nested
 * inside a host. */
export function HostedChannelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <HostedChannelContext.Provider value={true}>
      {children}
    </HostedChannelContext.Provider>
  );
}

/** True inside a hosted channel surface; false on the channel route. */
export function useIsHostedChannel(): boolean {
  return React.useContext(HostedChannelContext);
}
