// The Review popover's live wiring (redesign P4) — the roster from real
// managed agents, the persisted reviewer + instruction, and Start Review's
// real send. The pure decisions (roster, default pick, destination, message)
// are `reviewDispatch.ts`; this hook is the three questions only a running
// app can answer, `useCrewReach.ts`'s own words mirrored: which crew this
// workspace has, which channel this worktree's thread is, and how to open a
// DM.
//
// **Start Review really sends.** Unlike `useCrewReach.ts`'s palette rows —
// pre-addressed, never pre-sent, because a shortcut firing on Enter must not
// start a conversation on its own — pressing "Start review" IS the owner's
// deliberate act, the same standing a click on any other button in this app
// has. So this hook calls `useSendMessageMutation`/`useOpenDmMutation`
// directly: the same real doors the composer sends through, reached without
// the composer.

import * as React from "react";
import { toast } from "sonner";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useOpenDmMutation } from "@/features/channels/hooks";
import { useSendMessageMutation } from "@/features/messages/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  persistVingilotReviewInstruction,
  persistVingilotReviewReviewer,
  readVingilotReviewInstruction,
  readVingilotReviewReviewer,
} from "@/shared/theme/vingilot-review";

import {
  DEFAULT_REVIEW_INSTRUCTION,
  resolveStoredReviewer,
  reviewDestination,
  reviewersFromAgents,
  reviewMessage,
  type ReviewReviewer,
} from "./reviewDispatch.ts";
import { bindingFor, readTeamThreadBindings } from "./teamThreadStore.ts";

export interface ReviewDispatch {
  roster: readonly ReviewReviewer[];
  reviewer: ReviewReviewer | null;
  selectReviewer: (personaId: string) => void;
  instruction: string;
  setInstruction: (text: string) => void;
  resetInstruction: () => void;
  /** Why Start Review cannot run right now, or `null`. */
  blocked: string | null;
  pending: boolean;
  start: () => void;
}

/** `bindingId` is the SELECTED worktree's — `null` on the landing view, where
 * there is no thread to resolve and Start Review has nothing to dispatch
 * for. */
export function useReviewDispatch(bindingId: string | null): ReviewDispatch {
  const agentsQuery = useManagedAgentsQuery();
  const identityQuery = useIdentityQuery();
  const openDm = useOpenDmMutation();
  const sendMessage = useSendMessageMutation(null, identityQuery.data);

  const roster = React.useMemo(
    () => reviewersFromAgents(agentsQuery.data ?? []),
    [agentsQuery.data],
  );

  const [reviewerId, setReviewerId] = React.useState<string | null>(
    readVingilotReviewReviewer,
  );
  const [instruction, setInstructionState] = React.useState<string>(
    readVingilotReviewInstruction,
  );

  const reviewer = resolveStoredReviewer(roster, reviewerId);

  const selectReviewer = React.useCallback((personaId: string) => {
    setReviewerId(personaId);
    persistVingilotReviewReviewer(personaId);
  }, []);

  const setInstruction = React.useCallback((text: string) => {
    setInstructionState(text);
    persistVingilotReviewInstruction(text);
  }, []);

  const resetInstruction = React.useCallback(() => {
    setInstructionState(DEFAULT_REVIEW_INSTRUCTION);
    persistVingilotReviewInstruction(DEFAULT_REVIEW_INSTRUCTION);
  }, []);

  const threadChannelId =
    bindingId === null
      ? null
      : (bindingFor(readTeamThreadBindings(), bindingId)?.channelId ?? null);

  const destination =
    reviewer === null ? null : reviewDestination(reviewer, threadChannelId);
  const blocked =
    reviewer === null
      ? "no reviewer is minted for this workspace yet."
      : destination !== null && destination.kind === "blocked"
        ? destination.reason
        : null;

  const start = React.useCallback(() => {
    if (
      reviewer === null ||
      destination === null ||
      destination.kind === "blocked"
    ) {
      return;
    }
    const content = reviewMessage(reviewer, instruction);
    const reviewerName = reviewer.name;
    void (async () => {
      try {
        if (destination.kind === "thread") {
          await sendMessage.mutateAsync({
            channelId: destination.channelId,
            content,
            mentionPubkeys: [reviewer.pubkey],
          });
        } else {
          const dm = await openDm.mutateAsync({ pubkeys: [reviewer.pubkey] });
          await sendMessage.mutateAsync({ channelId: dm.id, content });
        }
        toast.success(`Asked ${reviewerName} to review`);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : `${reviewerName} could not be reached to start the review.`,
        );
      }
    })();
  }, [reviewer, destination, instruction, sendMessage, openDm]);

  return {
    blocked,
    instruction,
    pending: sendMessage.isPending || openDm.isPending,
    resetInstruction,
    reviewer,
    roster,
    selectReviewer,
    setInstruction,
    start,
  };
}
