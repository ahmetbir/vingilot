// **Who answers a click on a direct message** — redesign P6.
//
// The mockup's sidebar rows carry `data-dm` (Vingilot.html:99-100) and the
// stage never changes when one is clicked: the conversation arrives as a sheet
// over the work the owner is doing, which is the whole point of the surface.
// This hook is the fork's side of that click, and it is deliberately narrow.
//
// **It only claims the workspace.** Outside `/workspace` a direct message is
// still a route — that is where upstream's whole DM surface lives (threads,
// members, the profile panel), and taking the route away app-wide would trade
// a working chat app for a 360px pane of one. The sheet is what the *workspace*
// does with a DM, and the sheet's own "open full view" control hands the
// conversation back to that route. Everything else — the channel a click
// resolves to, and where a non-DM click goes — is upstream's answer,
// unchanged: `onRoute` is the callback this hook wraps, not one it replaces.

import * as React from "react";

import type { DmSheetState } from "@/features/runs/lib/dmSheet";
import {
  closeDmSheet,
  closedDmSheet,
  minimizeDmSheet,
  openDmSheet,
  restoreDmSheet,
} from "@/features/runs/lib/dmSheet";
import type { Channel } from "@/shared/api/types";

export type DmSheetController = {
  /** The sheet's state; `DmSheet` renders it. */
  state: DmSheetState;
  /** The sidebar's channel click, with the workspace's DM answer folded in. */
  onSelectChannel: (channelId: string) => void;
  minimize: () => void;
  restore: () => void;
  close: () => void;
};

export function useDmSheet({
  channels,
  isWorkspaceView,
  onRoute,
}: {
  /** Every channel the app knows — the same list the sidebar is built from. */
  channels: Channel[];
  /** True on the workspace route, where the stage is the mockup's own. */
  isWorkspaceView: boolean;
  /** Upstream's channel click, taken whenever the sheet does not answer. */
  onRoute: (channelId: string) => void;
}): DmSheetController {
  const [state, setState] = React.useState<DmSheetState>(closedDmSheet);

  // A conversation that left the app (community switch, hidden DM) must not
  // leave a sheet or a pill behind naming it. The channel list is the same one
  // the sidebar reads, so this closes exactly when the row disappears.
  const isKnown =
    state.channelId === null ||
    channels.some((channel) => channel.id === state.channelId);
  React.useEffect(() => {
    if (!isKnown) setState(closedDmSheet);
  }, [isKnown]);

  const onSelectChannel = React.useCallback(
    (channelId: string) => {
      const channel = channels.find((candidate) => candidate.id === channelId);
      if (!isWorkspaceView || channel?.channelType !== "dm") {
        onRoute(channelId);
        return;
      }
      setState((current) => openDmSheet(current, channelId));
    },
    [channels, isWorkspaceView, onRoute],
  );

  const minimize = React.useCallback(
    () => setState((current) => minimizeDmSheet(current)),
    [],
  );
  const restore = React.useCallback(
    () => setState((current) => restoreDmSheet(current)),
    [],
  );
  const close = React.useCallback(
    () => setState((current) => closeDmSheet(current)),
    [],
  );

  return { close, minimize, onSelectChannel, restore, state };
}
