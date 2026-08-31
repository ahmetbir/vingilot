// The live half of `lib/reviewThread.ts`: the real channel, the real crew, the
// real messages, and the two acts a note offers that really send.
//
// **This reads exactly the door `useReviewDispatch` writes.** Start Review
// puts a message into this worktree's team thread (or into Mate's DM);
// whatever the reviewer says back arrives in the same channel, and this hook
// reads it from upstream's own `useChannelMessagesQuery` — the same query the
// Team pane renders. There is no second transport, no polling of its own, and
// nothing here fetches from GitHub.
//
// **Nothing is rendered that was not said.** With no channel bound, no crew
// minted, or no reply naming a `path:line` in the diff on screen, `notes` is
// empty and the diff draws no threads — which is the true rendering of a
// review nobody has left yet. Seeding one would put a sentence on the owner's
// screen that no agent wrote.

import * as React from "react";
import { toast } from "sonner";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useChannelsQuery } from "@/features/channels/hooks";
import {
  useChannelMessagesQuery,
  useSendMessageMutation,
} from "@/features/messages/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";

import { reviewersFromAgents } from "./reviewDispatch.ts";
import {
  getResolvedNotes,
  serverResolvedNotes,
  setNoteResolved,
  subscribeResolvedNotes,
} from "./reviewResolvedStore.ts";
import {
  applyMessage,
  type ReviewAuthor,
  type ReviewNote,
  reviewNotes,
} from "./reviewThread.ts";
import { bindingFor, readTeamThreadBindings } from "./teamThreadStore.ts";

export interface ReviewNotes {
  /** Every anchored note the reviewer left about a file in this diff, oldest
   * first. Empty is the ordinary case and is not an error. */
  notes: readonly ReviewNote[];
  /** The crew this workspace has, for `patchAuthorInCrew`. */
  roster: readonly ReviewAuthor[];
  resolved: ReadonlySet<string>;
  setResolved: (id: string, value: boolean) => void;
  /** Send a reply into the same thread. `null` when there is no thread to send
   * into — a note can still be read and resolved, it simply cannot be answered
   * from here. */
  send: ((content: string) => void) | null;
  /** Hand a note to the agent that wrote the code, by name. Same `null` rule. */
  handBack: ((note: ReviewNote, patchAuthor: string) => void) | null;
}

const NO_NOTES: readonly ReviewNote[] = [];

/** `bindingId` is the worktree whose thread this is; `paths` are the files the
 * diff on screen lists, and a note about anything else is not this diff's. */
export function useReviewNotes(input: {
  bindingId: string | null;
  paths: readonly string[];
}): ReviewNotes {
  const { bindingId, paths } = input;
  const agentsQuery = useManagedAgentsQuery();
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const sendMessage = useSendMessageMutation(null, identityQuery.data);

  const roster = React.useMemo(
    () => reviewersFromAgents(agentsQuery.data ?? []),
    [agentsQuery.data],
  );

  const channelId =
    bindingId === null
      ? null
      : (bindingFor(readTeamThreadBindings(), bindingId)?.channelId ?? null);
  const channel =
    channelId === null
      ? null
      : ((channelsQuery.data ?? []).find((entry) => entry.id === channelId) ??
        null);
  const messagesQuery = useChannelMessagesQuery(channel);

  // Keyed by the answer's own contents, so a poll that changed nothing does
  // not re-run the anchor scan over a thousand messages.
  const messages = messagesQuery.data;
  const notes = React.useMemo(() => {
    if (messages === undefined || roster.length === 0) return NO_NOTES;
    return reviewNotes({ authors: roster, messages, paths });
  }, [messages, paths, roster]);

  const resolved = React.useSyncExternalStore(
    subscribeResolvedNotes,
    getResolvedNotes,
    serverResolvedNotes,
  );

  const post = React.useCallback(
    (content: string) => {
      if (channel === null) return;
      void (async () => {
        try {
          await sendMessage.mutateAsync({ channelId: channel.id, content });
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : "the thread could not be reached.",
          );
        }
      })();
    },
    [channel, sendMessage],
  );

  return {
    handBack:
      channel === null
        ? null
        : (note, patchAuthor) => post(applyMessage(note, patchAuthor)),
    notes,
    resolved,
    roster,
    send: channel === null ? null : post,
    setResolved: setNoteResolved,
  };
}
