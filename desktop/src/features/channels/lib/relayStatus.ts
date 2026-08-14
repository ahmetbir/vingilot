// The chat status bar's reading of the relay connection — the same contract
// `reachability.ts`'s `controlPlaneStatus` keeps for the control plane: one
// short word per state, and "not answering" means the same thing on both bars
// (a service that was there and stopped replying).
//
// Every reading is a function of `useRelayConnection`'s `ConnectionState` —
// push-driven, already debounced there. Nothing here polls or guesses.
//
// `canReconnect` is the bar's honest-click rule: a word is a button exactly
// when clicking it would do something. `connecting`/`reconnecting` are
// already in flight — offering a second reconnect there is a lie about what
// the click adds — and `connected` is a fact, not a control.

import type { ConnectionState } from "@/shared/api/relayClientShared";

export interface RelayStatus {
  /** The bar's glance word. */
  word: string;
  /** The full sentence, for the title/tooltip. */
  detail: string;
  /** Whether clicking the word may fire a reconnect. */
  canReconnect: boolean;
}

const READINGS: Record<ConnectionState, RelayStatus> = {
  connected: {
    canReconnect: false,
    detail: "Connected to the relay — messages flow live.",
    word: "connected",
  },
  connecting: {
    canReconnect: false,
    detail: "Connecting to the relay.",
    word: "connecting",
  },
  disconnected: {
    canReconnect: true,
    detail: "Disconnected from the relay. Click to reconnect.",
    word: "disconnected",
  },
  idle: {
    canReconnect: true,
    detail: "Not connected to the relay. Click to connect.",
    word: "not connected",
  },
  reconnecting: {
    canReconnect: false,
    detail: "Reconnecting to the relay.",
    word: "reconnecting",
  },
  stalled: {
    canReconnect: true,
    detail: "The relay is not responding. Click to reconnect.",
    word: "not answering",
  },
};

export function relayStatus(state: ConnectionState): RelayStatus {
  return READINGS[state];
}
