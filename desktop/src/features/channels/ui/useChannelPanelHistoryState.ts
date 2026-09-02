import * as React from "react";

import {
  profilePanelTabFromSearch,
  type ProfilePanelTab,
  profilePanelViewFromSearch,
  type ProfilePanelView,
} from "@/features/profile/ui/UserProfilePanelUtils";
import type { ProfilePanelOpenOptions } from "@/shared/context/ProfilePanelContext";
import { useIsHostedChannel } from "@/shared/context/HostedChannelContext";
import {
  type HistorySearchSetterOptions,
  useHistorySearchState,
} from "@/shared/hooks/useHistorySearchState";
import {
  buildAutoSendClearPatch,
  type ChannelSearchKey,
  CHANNEL_SEARCH_KEYS,
} from "./channelSearchKeys";
export type { ChannelSearchKey } from "./channelSearchKeys";

/**
 * Auxiliary-panel state for the channel routes, backed by URL search params
 * via useHistorySearchState: back/forward restores the panel a given entry
 * was showing, and reloads restore the panel from the URL.
 *
 * Params: `thread` (open thread head id), `profile` (profile panel pubkey),
 * `profileView` (profile panel focused view), `profileTab` (profile summary
 * tab), `agentSession` (agent session panel pubkey), `agentSessionChannel`
 * (optional channel scope for the agent session panel), `channelManagement`
 * (presence flag for the channel-management panel — open/closed only, so it
 * carries a sentinel `"1"` rather than an id), `autoSend` (draft auto-submit
 * trigger — cleared surgically after the auto-submit fires so `thread` and
 * all other panel state are preserved).
 *
 * Inside a hosted channel surface (`useIsHostedChannel`) the same values and
 * setters are backed by component state instead — see `useLocalPanelState`.
 */

export type PanelSetterOptions = HistorySearchSetterOptions;

export type PanelValueSetter = (
  value: string | null,
  options?: PanelSetterOptions,
) => void;

const CHANNEL_MANAGEMENT_OPEN_VALUE = "1";

/** The same `{applyPatch, values}` contract as `useHistorySearchState`, held in
 * component state instead of the URL.
 *
 * For a channel surface hosted outside the channel route (a workspace pane):
 * the panel keys name *one* open thread, *one* open profile, and the hosting
 * route is shared by everything else on screen, so writing them to the URL
 * would make two hosted surfaces fight over one thread panel — and would put a
 * channel's panel state on a route that is not a channel's. `replace` is
 * accepted and ignored: there is no history entry to replace when the state
 * never reaches the URL, which also means back/forward does not close a hosted
 * panel. That is the trade, and it is the smaller one.
 */
function useLocalPanelState<K extends string>(keys: readonly K[]) {
  const [values, setValues] = React.useState<Record<K, string | null>>(() => {
    const initial = {} as Record<K, string | null>;
    for (const key of keys) {
      initial[key] = null;
    }
    return initial;
  });

  const applyPatch = React.useCallback(
    (
      patch: Partial<Record<K, string | null>>,
      _options?: HistorySearchSetterOptions,
    ) => {
      setValues((current) => {
        let next = current;
        for (const key of Object.keys(patch) as K[]) {
          const patched = patch[key];
          if (patched === undefined) continue;
          const value = patched ?? null;
          if (current[key] === value) continue;
          if (next === current) next = { ...current };
          next[key] = value;
        }
        return next;
      });
    },
    [],
  );

  return { applyPatch, values };
}

export function useChannelPanelHistoryState() {
  const isHostedChannel = useIsHostedChannel();
  // Both stores are read on every render — a hook cannot be called
  // conditionally — and only the chosen one is ever written to. Reading the URL
  // in a hosted surface costs nothing: `useSearch` is non-strict, so a route
  // that declares none of these keys simply answers null for all of them.
  const urlState = useHistorySearchState(CHANNEL_SEARCH_KEYS);
  const localState = useLocalPanelState<ChannelSearchKey>(CHANNEL_SEARCH_KEYS);
  const { applyPatch, values } = isHostedChannel ? localState : urlState;

  const setOpenThreadHeadId = React.useCallback<PanelValueSetter>(
    (value, options) => applyPatch({ thread: value }, options),
    [applyPatch],
  );

  // Opening, switching, or closing a profile always resets its sub-view —
  // the carried `profileView` would otherwise leak onto the next profile.
  const setProfilePanelPubkey = React.useCallback<PanelValueSetter>(
    (value, options) =>
      applyPatch(
        { profile: value, profileTab: null, profileView: null },
        options,
      ),
    [applyPatch],
  );

  const openProfilePanel = React.useCallback(
    (pubkey: string, options?: ProfilePanelOpenOptions) =>
      applyPatch({
        profile: pubkey,
        profileTab: options?.tab === "info" ? null : (options?.tab ?? null),
        profileView: null,
      }),
    [applyPatch],
  );

  const setProfilePanelView = React.useCallback(
    (value: ProfilePanelView, options?: PanelSetterOptions) =>
      applyPatch({ profileView: value === "summary" ? null : value }, options),
    [applyPatch],
  );

  const setProfilePanelTab = React.useCallback(
    (value: ProfilePanelTab, options?: PanelSetterOptions) =>
      applyPatch({ profileTab: value === "info" ? null : value }, options),
    [applyPatch],
  );

  const setOpenAgentSessionPubkey = React.useCallback<PanelValueSetter>(
    (value, options) =>
      applyPatch(
        { agentSession: value, agentSessionChannel: value ? undefined : null },
        options,
      ),
    [applyPatch],
  );

  const setOpenAgentSessionChannelId = React.useCallback<PanelValueSetter>(
    (value, options) => applyPatch({ agentSessionChannel: value }, options),
    [applyPatch],
  );

  const setChannelManagementOpen = React.useCallback(
    (open: boolean, options?: PanelSetterOptions) =>
      applyPatch(
        { channelManagement: open ? CHANNEL_MANAGEMENT_OPEN_VALUE : null },
        options,
      ),
    [applyPatch],
  );

  const clearMessageRouteTarget = React.useCallback(
    (options?: PanelSetterOptions) =>
      applyPatch({ messageId: null, threadRootId: null }, options),
    [applyPatch],
  );

  // Clears only the ?autoSend param, preserving `thread` and all other panel
  // search state. Use this instead of a full goChannel() re-navigation so the
  // thread panel does not unmount between the auto-submit trigger clear and the
  // deferred setTimeout(0) send.
  const clearAutoSend = React.useCallback(
    (options?: PanelSetterOptions) =>
      applyPatch(buildAutoSendClearPatch(), { replace: true, ...options }),
    [applyPatch],
  );

  return {
    channelManagementOpen: values.channelManagement != null,
    clearAutoSend,
    clearMessageRouteTarget,
    openAgentSessionChannelId: values.agentSessionChannel,
    openAgentSessionPubkey: values.agentSession,
    openProfilePanel,
    openThreadHeadId: values.thread,
    profilePanelPubkey: values.profile,
    profilePanelTab: profilePanelTabFromSearch(values.profileTab),
    profilePanelView: profilePanelViewFromSearch(values.profileView),
    setChannelManagementOpen,
    setOpenAgentSessionChannelId,
    setOpenAgentSessionPubkey,
    setOpenThreadHeadId,
    setProfilePanelTab,
    setProfilePanelPubkey,
    setProfilePanelView,
  };
}
