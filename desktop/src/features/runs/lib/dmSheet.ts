// **The DM sheet's three states, and the one sentence under its name** —
// redesign P6 (`vingilot/docs/plans/2026-08-29-redesign.md`), the mockup's
// `#dmsheet` / `#dmpill` (Vingilot.html:496-510, `vingilot.js:31-34`).
//
// The mockup keeps this in the DOM: `.on` on the sheet, `.on` on the pill, and
// four `data-act`s that add and remove those classes. Two classes is three
// states — open, minimized, closed — and a fourth combination (both on) the
// mockup can reach only by accident. So the state is a value here instead, and
// the component renders it, which is also why "minimize is not close" is a fact
// a unit test can hold rather than a claim about a class list.
//
// **The conversation outlives the minimize.** `channelId` survives `minimize`
// and is dropped only by `close`, because the pill has to keep the name and the
// avatar of the conversation it stands for — and because the sheet stays
// MOUNTED while minimized (`DmSheet.tsx` hides it rather than unmounting), so
// what was typed is still in the composer when it comes back. Losing the id
// here would remount the surface on restore and take the draft with it.

import type { ConnectionState } from "@/shared/api/relayClientShared";
import { isRelayConnectionDegraded } from "@/shared/api/relayClientShared";
import type { PresenceStatus } from "@/shared/api/types";

/** Which conversation the sheet is on, and whether it is the pill right now. */
export type DmSheetState = {
  /** The DM channel the sheet is bound to; `null` when nothing is open. */
  channelId: string | null;
  /** True while the pill stands in for the sheet. */
  minimized: boolean;
};

export const closedDmSheet: DmSheetState = {
  channelId: null,
  minimized: false,
};

/** Open a conversation. Opening the one already minimized restores it rather
 * than leaving the pill up beside its own sheet. */
export function openDmSheet(
  state: DmSheetState,
  channelId: string,
): DmSheetState {
  if (state.channelId === channelId && !state.minimized) return state;
  return { channelId, minimized: false };
}

/** Put the sheet away without ending the conversation. A no-op when nothing is
 * open — there is no pill for a conversation that was never chosen. */
export function minimizeDmSheet(state: DmSheetState): DmSheetState {
  if (state.channelId === null || state.minimized) return state;
  return { ...state, minimized: true };
}

/** Bring the pill back up as the sheet. */
export function restoreDmSheet(state: DmSheetState): DmSheetState {
  if (state.channelId === null || !state.minimized) return state;
  return { ...state, minimized: false };
}

/** Dismiss both. A separate act from minimizing, and the only one that forgets
 * which conversation this was. */
export function closeDmSheet(state: DmSheetState): DmSheetState {
  if (state.channelId === null) return state;
  return closedDmSheet;
}

/** True when the sheet itself should be on screen. */
export function isDmSheetShowing(state: DmSheetState): boolean {
  return state.channelId !== null && !state.minimized;
}

/** True when the pill should be on screen. Never at the same time as the
 * sheet — the mockup's two classes cannot say that, this can. */
export function isDmPillShowing(state: DmSheetState): boolean {
  return state.channelId !== null && state.minimized;
}

/** The mockup's `#dmpres` line, told truthfully.
 *
 * The mockup writes "first mate · only you can read this" under a persona this
 * app does not have, and it says that while nothing is connected to anything.
 * Presence is a **relay** reading: with the socket down the app does not know
 * whether the other side is there, and printing the last-known word under a
 * dead connection is the exact lie this line is here to avoid — an empty
 * thread beneath it would then read as "no messages" rather than "not
 * connected". So a degraded socket takes the slot. */
export function dmPresenceSentence({
  connection,
  presence,
}: {
  connection: ConnectionState;
  presence: PresenceStatus | undefined;
}): { text: string; connected: boolean } {
  if (isRelayConnectionDegraded(connection)) {
    return {
      connected: false,
      text: "not connected — this may be out of date",
    };
  }
  if (connection === "connecting" || connection === "idle") {
    return { connected: false, text: "connecting…" };
  }
  if (presence === undefined) {
    return { connected: true, text: "direct message" };
  }
  return { connected: true, text: `${presence} · direct message` };
}
