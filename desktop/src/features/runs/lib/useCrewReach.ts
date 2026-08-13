// The crew's ⌘K rows, wired to the transports that already carry them
// (vingilot/docs/plans/2026-08-12-the-crew.md, Task 3 — *"this is wiring
// through existing transport"*).
//
// **Three imports and no new message path.** A row lands the Captain in a
// composer with a draft already in it:
//
// - **which composer** is upstream's own — the worktree's team thread for the
//   four who live there (the channel `teamThreadStore.ts` already points at,
//   which is what the Team pane mounts), and for Mate an owner-only DM opened
//   through `useOpenDmMutation`, the same mutation the sidebar, Home and the
//   project screen open a DM with;
// - **the draft** is written with `persistDraftEntry`, upstream's own draft
//   store, under the composer's own key (`MessageComposer`'s
//   `draftKey ?? channelId`). The composer restores a draft on key change,
//   which is precisely the moment a navigation to that channel creates;
// - **getting there** is `goChannel`, where upstream's switcher goes.
//
// **Pre-addressed, never pre-sent.** Nothing here sends a message. The draft
// arrives with the worktree named and the cursor after it, and the Captain
// presses Enter or deletes it — which is the difference between a palette row
// and an app that starts a conversation because a key was pressed.
//
// **What the rows say and when they refuse is `crewReach.ts`**, which is pure
// and tested. This file holds the three questions only a running app can
// answer: which crew this workspace has, which channel this worktree's thread
// is, and how to open a DM.

import * as React from "react";
import { toast } from "sonner";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useOpenDmMutation } from "@/features/channels/hooks";
import { persistDraftEntry } from "@/features/messages/lib/useDrafts";

import {
  type CrewReachContext,
  type CrewReachRow,
  crewReachRow,
  crewReachRows,
  type MintedCrewMember,
} from "./crewReach.ts";
import { crewMember } from "./crewRoster.ts";
import { bindingFor, readTeamThreadBindings } from "./teamThreadStore.ts";

export interface CrewReachInputs {
  /** The selected worktree's binding id, or `null`. The thread pointer is
   * keyed on it. */
  bindingId: string | null;
  /** The selected worktree's branch label, for the draft's "where" clause. */
  worktreeLabel: string | null;
  worktreeCwd: string | null;
}

export interface CrewReach {
  /** The rows, for `PaletteContext.crew`. Empty when this workspace has no
   * crew, which is a palette with no crew rows — see `paletteSources.ts`. */
  rows: readonly CrewReachRow[];
  /** Run one row. Re-asks `crewReach.ts` rather than trusting the row the
   * palette drew: the list was assembled when the palette opened and Enter
   * happens later, which is `usePaletteCommands.ts`'s own rule. */
  reach: (personaId: string) => void;
}

/** How a mention is written into a draft: the text upstream's composer parses
 * and the identity reference beside it (`DraftMentionRef`), so the agent is
 * mentioned as itself rather than as a string that happens to start with `@`.
 *
 * **`displayName` is the crew member's name and nothing else.** Upstream keys
 * the whole mention pipeline on it — `replaceWithDraftMentionRefs` files it in
 * the composer's mention map, and `hasMention` then looks for literally
 * `@${displayName}` in the text. The row's `label` is an errand sentence, so a
 * ref keyed on it would match no text: no highlight, no resolved p-tag except
 * through the channel-member fallback, and the ref silently dropped on the next
 * persist. The name is what the draft actually says. */
function mentionRefs(row: CrewReachRow) {
  return row.message.startsWith("@")
    ? [{ displayName: row.name, isAgent: true, pubkey: row.pubkey }]
    : [];
}

export function useCrewReach({
  bindingId,
  worktreeCwd,
  worktreeLabel,
}: CrewReachInputs): CrewReach {
  const agentsQuery = useManagedAgentsQuery();
  const openDm = useOpenDmMutation();
  const { goChannel } = useAppNavigation();

  const agents = agentsQuery.data;
  const crew: readonly MintedCrewMember[] = React.useMemo(() => {
    const found = new Map<string, MintedCrewMember>();
    for (const agent of agents ?? []) {
      const member = crewMember(agent.personaId);
      if (member === null || found.has(member.personaId)) continue;
      found.set(member.personaId, {
        berth: member.berth,
        // The record's name, which is whatever the Captain renamed it to at
        // mint time. The roster's name is only the default.
        name: agent.name,
        personaId: member.personaId,
        pubkey: agent.pubkey,
      });
    }
    // Roster order, not agent-list order: the palette's own ranking reorders
    // anything he types, and on an empty query the list should read the way
    // the crew is written down.
    return [...found.values()];
  }, [agents]);

  // The thread pointer is storage, read per render rather than subscribed:
  // this hook lives on a screen that already re-renders on a 2s poll, and the
  // only writer is the Team pane on the same screen.
  const threadChannelId =
    bindingId === null
      ? null
      : (bindingFor(readTeamThreadBindings(), bindingId)?.channelId ?? null);

  const context: CrewReachContext = {
    crew,
    threadChannelId,
    worktreeCwd,
    worktreeLabel,
  };

  // Read through a ref so `reach` is stable for the life of the screen —
  // `usePaletteCommands` binds it into a table that is itself bound into a key
  // listener registered once.
  const latest = React.useRef(context);
  latest.current = context;
  const openDmAsync = openDm.mutateAsync;

  const reach = React.useCallback(
    (personaId: string) => {
      const row = crewReachRow(latest.current, personaId);
      // Blocked reads here exactly as it reads in the palette: nothing
      // happens. The sentence saying why is already on the row.
      if (row === null || row.blocked !== null) return;

      if (row.berth === "thread") {
        if (row.channelId === null) return;
        persistDraftEntry(
          row.channelId,
          row.message,
          row.channelId,
          [],
          [],
          mentionRefs(row),
        );
        void goChannel(row.channelId);
        return;
      }

      // Mate: the DM is opened on demand rather than looked up, because
      // upstream's mutation is idempotent — it returns the existing
      // conversation when there is one, which is what every other caller of it
      // relies on.
      //
      // **And opening it is the one call on this row that needs a relay.** On
      // the standalone machine this plan is built for, that call rejects — so a
      // swallowed rejection would be the palette closing and nothing happening,
      // which is exactly the silence `mintSentence` goes to some length to
      // avoid one file over. Every other caller of this mutation says why it
      // could not; so does this one.
      void (async () => {
        try {
          const dm = await openDmAsync({ pubkeys: [row.pubkey] });
          persistDraftEntry(dm.id, row.message, dm.id, [], [], []);
          await goChannel(dm.id);
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : `${row.name} could not be reached: the direct message did not open.`,
          );
        }
      })();
    },
    [goChannel, openDmAsync],
  );

  return { reach, rows: crewReachRows(context) };
}
