// Review — the status bar's declared exception (redesign P4, mockup
// `.revpop`: Vingilot.html:415-425). Every other quick action types into
// tmux; Review never does (the phase's standing order). It dispatches
// instead, through the same door `crewReach.ts` already proved is the only
// real one this app has: a message in a channel an agent watches — the
// worktree's team thread for a thread-berth reviewer (Lookout, Bosun, …), an
// owner-only DM for a dm-berth one (Mate).
//
// Unlike `crewReach.ts`'s palette rows — pre-addressed, never pre-sent, by
// design — Start Review is a deliberate one-shot act: pressing it really
// sends, through `useReviewDispatch.ts`'s `useSendMessageMutation` /
// `useOpenDmMutation`, the same doors the rest of this app sends through.
// This file holds only the pure decision underneath that: who can review,
// what the message says, and where it goes.
//
// Pure: no React, no Tauri, no storage.

import { crewMember, type CrewBerth } from "./crewRoster.ts";

export interface ReviewReviewer {
  personaId: string;
  /** The record's own name — whatever the Captain renamed it to at mint
   * time, the same rule `crewReach.ts`'s `MintedCrewMember` keeps. */
  name: string;
  pubkey: string;
  berth: CrewBerth;
}

/** The minimal shape this module needs from a managed-agent record — kept
 * narrow so this file takes no dependency on `shared/api/types`. */
export interface ReviewAgentRecord {
  pubkey: string;
  name: string;
  personaId: string | null;
}

/** The reviewers this workspace actually has: real, minted crew, in
 * `crewRoster.ts`'s own order. Mirrors `useCrewReach.ts`'s crew memo exactly
 * (a second reduction rather than a shared import — that one is a React
 * `useMemo` over a query result; this is the pure step underneath it, usable
 * from a hook that has nothing to do with the palette). */
export function reviewersFromAgents(
  agents: readonly ReviewAgentRecord[],
): ReviewReviewer[] {
  const found = new Map<string, ReviewReviewer>();
  for (const agent of agents) {
    const member = crewMember(agent.personaId);
    if (member === null || found.has(member.personaId)) continue;
    found.set(member.personaId, {
      berth: member.berth,
      name: agent.name,
      personaId: member.personaId,
      pubkey: agent.pubkey,
    });
  }
  return [...found.values()];
}

/** The reviewer job is Lookout's own ("sees trouble first — reviews diffs
 * and names risks, and never edits" — `crewRoster.ts`), so it is the default
 * pick when this workspace has it; otherwise the first reviewer this
 * workspace actually has. `null` for an empty roster — an agent that was
 * never minted is not a thing this workspace has (`crewReach.ts`'s rule),
 * and a picker with nothing to pick chooses nothing rather than a phantom. */
export function defaultReviewer(
  roster: readonly ReviewReviewer[],
): ReviewReviewer | null {
  return (
    roster.find((candidate) => candidate.personaId === "builtin:lookout") ??
    roster[0] ??
    null
  );
}

/** The stored reviewer, if this workspace still has it. A persona id from a
 * community this workspace no longer has, or one never minted, falls back to
 * `defaultReviewer` rather than pointing the picker at nobody. */
export function resolveStoredReviewer(
  roster: readonly ReviewReviewer[],
  storedPersonaId: string | null,
): ReviewReviewer | null {
  if (storedPersonaId !== null) {
    const found = roster.find(
      (candidate) => candidate.personaId === storedPersonaId,
    );
    if (found !== undefined) return found;
  }
  return defaultReviewer(roster);
}

/** The instruction textarea's default, and what "Reset to default" restores.
 * Generic on purpose — unlike the mockup's own placeholder text (which names
 * an invented `PaymentStub`), this is said about no project in particular,
 * since the app has no way to know what any given worktree's real risk is. */
export const DEFAULT_REVIEW_INSTRUCTION =
  "Review the diff against HEAD on this worktree. Name what is wrong; say CONFIRMED only for what you can evidence. Leave findings here.";

const NO_THREAD =
  "this worktree has no team thread yet — open one in the Team pane, and the crew is in it.";

export type ReviewDestination =
  | { kind: "thread"; channelId: string }
  | { kind: "dm" }
  | { kind: "blocked"; reason: string };

/** Where Start Review's message goes for this reviewer —
 * `crewReach.ts`'s own blocked rule, unchanged: a thread-berth reviewer with
 * no thread open yet cannot be reached, and Mate's DM is never blocked on a
 * thread it is deliberately not in. */
export function reviewDestination(
  reviewer: ReviewReviewer,
  threadChannelId: string | null,
): ReviewDestination {
  if (reviewer.berth === "dm") return { kind: "dm" };
  if (threadChannelId === null) return { kind: "blocked", reason: NO_THREAD };
  return { kind: "thread", channelId: threadChannelId };
}

/** The message Start Review sends. A thread carries other members, so the
 * reviewer is addressed by name the same way `crewReach.ts`'s errand table
 * addresses the crew (`@{name}`) — the harness's own mention convention,
 * which is how an agent in a shared thread knows a message is its to answer.
 * A DM has one other party; naming them is noise, exactly `crewReach.ts`'s
 * Mate rule. */
export function reviewMessage(
  reviewer: ReviewReviewer,
  instruction: string,
): string {
  const trimmed = instruction.trim();
  return reviewer.berth === "dm" ? trimmed : `@${reviewer.name} ${trimmed}`;
}
