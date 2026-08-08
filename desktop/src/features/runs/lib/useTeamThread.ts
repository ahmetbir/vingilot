// Everything the team-thread pane needs from the rest of the app, in one hook
// (vingilot/docs/plans/2026-08-08-scratch-and-team-thread.md, Task 2).
//
// **Nothing here is new machinery.** The pane hosts upstream's surfaces rather
// than reimplementing them, which is what the plan asked for once the survey
// found that talking to a team already has a path: a channel, one managed agent
// per persona deployed into it (`features/agents/channelAgents.ts`, the same
// call `AddTeamToChannelDialog` makes), and upstream's own read/subscribe/send
// for the messages. This file is the wiring and the ordering; every relay
// operation in it is an import.
//
// **Why this is a hook and not a component.** The pane is a rendering of what
// is below; keeping the questions here means the component is a function of an
// answer, and the answer's shape is `teamThread.ts`'s, which is pure and
// tested. It also keeps the component under its cap.
//
// One thing to know about mounting it: `useChannelSubscription` tells the relay
// client which channel is visible, which upstream's channel screen also does.
// They never run together — the workspace is a route of its own and the channel
// screen is not mounted under it — but a future surface that embedded both
// would have two claims on one global, and this is where that would start.

import * as React from "react";

import { createChannelManagedAgents } from "@/features/agents/channelAgents";
import type { CreateChannelManagedAgentInput } from "@/features/agents/channelAgents";
import {
  useAvailableAcpRuntimes,
  usePersonasQuery,
} from "@/features/agents/hooks";
import {
  getDefaultPersonaRuntime,
  resolvePersonaRuntime,
} from "@/features/agents/lib/resolvePersonaRuntime";
import {
  emptyResolvedTeamPersonas,
  resolveTeamPersonas,
} from "@/features/agents/lib/teamPersonas";
import { useTeamsQuery } from "@/features/agents/teamHooks";
import { useGlobalAgentConfig } from "@/features/agents/useGlobalAgentConfig";
import {
  useChannelMembersQuery,
  useChannelsQuery,
  useCreateChannelMutation,
} from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import {
  useChannelMessagesQuery,
  useChannelSubscription,
  useSendMessageMutation,
} from "@/features/messages/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import type {
  AcpRuntime,
  AgentPersona,
  AgentTeam,
  Channel,
  RelayEvent,
} from "@/shared/api/types";
import { useRelayConnection } from "@/shared/api/useRelayConnection";
import {
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
} from "@/shared/constants/kinds";

import {
  composeTeamMessage,
  findThreadChannel,
  readTeamThread,
  relayReach,
  type TeamCount,
  type TeamThreadReading,
  threadChannelDescription,
  threadChannelName,
} from "./teamThread.ts";
import {
  draftFor,
  readTeamDrafts,
  type TeamDrafts,
  withDraft,
  writeTeamDrafts,
} from "./teamDraftStore.ts";
import {
  bindingFor,
  readTeamThreadBindings,
  type TeamThreadBindings,
  withChosenTeam,
  withNoTeam,
  withThreadChannel,
  writeTeamThreadBindings,
} from "./teamThreadStore.ts";

/** One row of the conversation, as this pane draws it. Deliberately thin:
 * upstream's timeline is a virtualised surface with threads, reactions and
 * media, and none of that is what a worktree thread is for. */
export interface TeamThreadRow {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
  /** True for the owner's own messages — the only ones this app signed. */
  mine: boolean;
}

/** What the pane could not do, said in the words of whatever refused. */
export interface TeamThreadTrouble {
  /** The step that failed, so the sentence can name it rather than saying
   * "something went wrong". */
  step: "open" | "send";
  message: string;
}

export interface TeamThread {
  reading: TeamThreadReading;
  teams: AgentTeam[];
  team: AgentTeam | null;
  /** The team's personas, resolved against My Agents. */
  members: { id: string; name: string }[];
  /** Personas the team names that are no longer in My Agents. A deploy with any
   * of these is a team with a hole in it, and the pane says so rather than
   * quietly deploying the rest. */
  missingMembers: number;
  /** True when this machine has no ACP runtime to run a member on — upstream's
   * own precondition for deploying a team (`AddTeamToChannelDialog`). */
  noRuntime: boolean;
  channel: Channel | null;
  /** True when a thread was opened here once and its channel is not in this
   * relay's list any more — archived, deleted, or a different community. Not
   * folded into `channel === null`: one is "no thread yet" and the other is
   * "your thread is not where you left it". */
  lostChannel: boolean;
  /** A thread this worktree already has with the chosen team, found in the
   * relay's own channel list rather than in the pointer. Non-null means there is
   * something to *reopen*, and that deploying a team would be deploying a second
   * one into a second channel. */
  existingThread: Channel | null;
  /** Adopt `existingThread` as this worktree's thread. Writes the pointer and
   * nothing else: no channel is created, no agent is minted, no process starts. */
  adoptThread: () => void;
  /** True while this worktree has a stored channel pointer — the thing
   * `forgetTeam` would drop. `false` means forgetting costs nothing but the
   * choice, which is why the pane only asks for confirmation when this is true. */
  hasThreadPointer: boolean;
  messages: TeamThreadRow[];
  /** Display names for the pubkeys in `messages`, as far as they are known. */
  nameOf: (pubkey: string) => string | null;
  chooseTeam: (teamId: string) => void;
  /** Put the choice back. Drops this worktree's pointer and nothing else — the
   * channel and everything said in it stay on the relay. */
  forgetTeam: () => void;
  openThread: () => void;
  opening: boolean;
  /** Members that could not be deployed, by name and reason. A partial deploy
   * is reported as one: the thread exists and is short of an agent. */
  deployFailures: { name: string; error: string }[];
  /** What is typed and not yet sent. Owned here rather than by the composer,
   * because a `useState` in the composer is lost to the community remount a
   * relay reconnect performs, and because a failed send must not take it. */
  draft: string;
  setDraft: (text: string) => void;
  /** Sends `draft`. Takes no argument on purpose: the text that goes and the
   * text on screen are one value, so there is no arrangement in which the
   * composer is cleared of something other than what left. */
  send: () => void;
  sending: boolean;
  trouble: TeamThreadTrouble | null;
}

const NO_TEAMS: AgentTeam[] = [];
const NO_MESSAGES: RelayEvent[] = [];

/** Which kinds are a person (or an agent) saying something. Everything else a
 * channel carries — joins, edits, summaries — is machinery, and a worktree
 * thread that printed it would read as noise. */
const SAID_KINDS = new Set([KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2]);

export function useTeamThread(input: {
  bindingId: string | null;
  cwd: string | null;
  worktreeLabel: string;
}): TeamThread {
  const { bindingId, cwd, worktreeLabel } = input;

  const [bindings, setBindings] = React.useState<TeamThreadBindings>(() =>
    readTeamThreadBindings(),
  );
  // Seeded from storage on every mount, which is what makes it survive the
  // remount `<AppReady key={communityKey}>` performs on a relay reinit.
  const [drafts, setDrafts] = React.useState<TeamDrafts>(() =>
    readTeamDrafts(),
  );
  // The authority between renders, so a keystroke can be mirrored to storage
  // *outside* the state updater. An updater is not guaranteed to run — React
  // drops it for a fiber that has unmounted — and "the write only happens if
  // the component is still there" is precisely the bug being fixed.
  const draftsRef = React.useRef(drafts);
  const [opening, setOpening] = React.useState(false);
  const [trouble, setTrouble] = React.useState<TeamThreadTrouble | null>(null);
  const [deployFailures, setDeployFailures] = React.useState<
    { name: string; error: string }[]
  >([]);

  const { activeCommunity } = useCommunities();
  const connection = useRelayConnection();
  const identityQuery = useIdentityQuery();
  const teamsQuery = useTeamsQuery();
  const personasQuery = usePersonasQuery();
  const runtimesQuery = useAvailableAcpRuntimes();
  const channelsQuery = useChannelsQuery();
  const { globalConfig } = useGlobalAgentConfig();
  const createChannel = useCreateChannelMutation();

  const teams = teamsQuery.data ?? NO_TEAMS;
  const binding = bindingFor(bindings, bindingId);
  const team = teams.find((entry) => entry.id === binding?.teamId) ?? null;

  const channel =
    binding?.channelId == null
      ? null
      : ((channelsQuery.data ?? []).find(
          (entry) => entry.id === binding.channelId,
        ) ?? null);
  // "Not in the list" only means lost once the list has actually arrived.
  const lostChannel =
    binding?.channelId != null && channel === null && channelsQuery.isSuccess;

  // Only asked while there is no thread in hand: once the pointer resolves,
  // the pointer is the answer and a name match is a worse one.
  const existingThread =
    channel !== null || bindingId === null || team === null
      ? null
      : findThreadChannel(channelsQuery.data ?? [], bindingId, team.id);

  useChannelSubscription(channel);
  const messagesQuery = useChannelMessagesQuery(channel);
  const membersQuery = useChannelMembersQuery(channel?.id ?? null);
  const sendMessage = useSendMessageMutation(channel, identityQuery.data);

  const reading = readTeamThread({
    community: activeCommunity != null,
    relay: relayReach(connection),
    teams: teamCount(teamsQuery),
  });

  const resolved = React.useMemo(
    () =>
      team === null
        ? emptyResolvedTeamPersonas()
        : resolveTeamPersonas(team, personasQuery.data ?? []),
    [personasQuery.data, team],
  );

  const runtimes = runtimesQuery.data ?? [];
  const defaultRuntime = getDefaultPersonaRuntime(
    runtimes,
    globalConfig.preferred_runtime,
  );

  const ownPubkey = identityQuery.data?.pubkey ?? null;
  const messages = React.useMemo(
    () => rowsOf(messagesQuery.data ?? NO_MESSAGES, ownPubkey),
    [messagesQuery.data, ownPubkey],
  );

  const names = React.useMemo(() => {
    const lookup = new Map<string, string>();
    for (const member of membersQuery.data ?? []) {
      if (member.displayName !== null) {
        lookup.set(member.pubkey, member.displayName);
      }
    }
    return lookup;
  }, [membersQuery.data]);

  const commit = React.useCallback((next: TeamThreadBindings) => {
    setBindings((current) => {
      if (next === current) return current;
      writeTeamThreadBindings(next);
      return next;
    });
  }, []);

  const chooseTeam = React.useCallback(
    (teamId: string) => {
      if (bindingId === null) return;
      setTrouble(null);
      setDeployFailures([]);
      commit(withChosenTeam(bindings, bindingId, teamId));
    },
    [bindingId, bindings, commit],
  );

  const forgetTeam = React.useCallback(() => {
    if (bindingId === null) return;
    setTrouble(null);
    setDeployFailures([]);
    commit(withNoTeam(bindings, bindingId));
  }, [bindingId, bindings, commit]);

  /** Record which channel a worktree's thread is, **to storage first**.
   *
   * Every caller of this runs after an `await`, and by then a relay reinit may
   * have remounted the community subtree and taken this component with it.
   * React is free not to run the updater of a `setState` on an unmounted fiber,
   * so a write made *inside* one is a write that may never happen — and what
   * would not have been written is where a channel with live managed agents in
   * it went. Storage is read fresh for the same reason: this closure's copy of
   * `bindings` is a render old and possibly from a tree that no longer exists.
   */
  const rememberChannel = React.useCallback(
    (owner: string, teamId: string, channelId: string) => {
      const next = withThreadChannel(
        readTeamThreadBindings(),
        owner,
        teamId,
        channelId,
      );
      writeTeamThreadBindings(next);
      setBindings(next);
    },
    [],
  );

  const adoptThread = React.useCallback(() => {
    if (bindingId === null || team === null || existingThread === null) return;
    setTrouble(null);
    setDeployFailures([]);
    rememberChannel(bindingId, team.id, existingThread.id);
  }, [bindingId, existingThread, rememberChannel, team]);

  const openThread = React.useCallback(() => {
    if (bindingId === null || team === null || cwd === null) return;
    if (defaultRuntime === null) return;
    if (opening) return;
    setOpening(true);
    setTrouble(null);
    setDeployFailures([]);
    const teamId = team.id;
    void (async () => {
      try {
        const opened = await createChannel.mutateAsync({
          channelType: "stream",
          description: threadChannelDescription(team.name, cwd),
          name: threadChannelName(bindingId, teamId, team.name, worktreeLabel),
          // Private: the thread names a directory on this machine, and the
          // owner did not ask for that to be readable by the whole community.
          visibility: "private",
        });
        // **The moment the channel exists, it is written down** — before the
        // members are deployed, not after. A reinit landing between the two
        // used to leave a channel on the relay that this worktree could never
        // find again, and the next open would make a second one with a second
        // set of agent processes. A thread that is short of its members is
        // recoverable; a thread nobody can name is not. `withThreadChannel`
        // still refuses if the owner chose another team while this was in
        // flight.
        rememberChannel(bindingId, teamId, opened.id);
        const result = await createChannelManagedAgents(
          opened.id,
          resolved.resolvedPersonas.map((persona) =>
            deployInput(persona, runtimes, defaultRuntime, teamId),
          ),
        );
        setDeployFailures(
          result.failures.map((failure) => ({
            error: failure.error,
            name: failure.name,
          })),
        );
      } catch (error) {
        setTrouble({ message: reasonOf(error), step: "open" });
      } finally {
        setOpening(false);
      }
    })();
  }, [
    bindingId,
    createChannel,
    cwd,
    defaultRuntime,
    opening,
    rememberChannel,
    resolved,
    runtimes,
    team,
    worktreeLabel,
  ]);

  const setDraft = React.useCallback(
    (text: string) => {
      if (bindingId === null) return;
      const next = withDraft(draftsRef.current, bindingId, text);
      if (next === draftsRef.current) return;
      draftsRef.current = next;
      // Written on the keystroke, not on a debounce. A debounce is a window in
      // which what is on screen is not what is stored, and a reconnect landing
      // inside that window is the loss this store exists to prevent.
      writeTeamDrafts(next);
      setDrafts(next);
    },
    [bindingId],
  );

  const draft = draftFor(drafts, bindingId);

  const send = React.useCallback(() => {
    if (bindingId === null || channel === null || cwd === null) return;
    const said = draftsRef.current[bindingId] ?? "";
    const content = composeTeamMessage(cwd, said);
    if (content === null) return;
    setTrouble(null);
    sendMessage.mutate(
      { channelId: channel.id, content, targetChannel: channel },
      {
        // **The composer is cleared by the relay accepting it, and by nothing
        // else.** A send that fails leaves every character where it was, with
        // the sentence below saying it did not go, so the retry is a second
        // click rather than typing the paragraph again.
        onError: (error) =>
          setTrouble({ message: reasonOf(error), step: "send" }),
        // And only the text that actually left: an owner who kept typing while
        // the send was in flight must not have those keystrokes cleared by an
        // acknowledgement of the ones before them.
        onSuccess: () => {
          if ((draftsRef.current[bindingId] ?? "") !== said) return;
          setDraft("");
        },
      },
    );
  }, [bindingId, channel, cwd, sendMessage, setDraft]);

  return {
    adoptThread,
    channel,
    chooseTeam,
    deployFailures,
    draft,
    existingThread,
    forgetTeam,
    hasThreadPointer: binding?.channelId != null,
    lostChannel,
    members: resolved.resolvedPersonas.map((persona) => ({
      id: persona.id,
      name: persona.displayName,
    })),
    messages,
    missingMembers: resolved.missingPersonaCount,
    nameOf: (pubkey) => names.get(pubkey) ?? null,
    // "Not while we are still looking" is not "none": a runtime list in flight
    // must not read as a machine with no harness on it.
    noRuntime: !runtimesQuery.isLoading && defaultRuntime === null,
    openThread,
    opening,
    reading,
    send,
    sending: sendMessage.isPending,
    setDraft,
    team,
    teams,
    trouble,
  };
}

function teamCount(query: {
  data: AgentTeam[] | undefined;
  isError: boolean;
}): TeamCount {
  // The order matters: an errored query with stale data in hand is still an
  // answer, and one with neither is no answer at all.
  if (query.data !== undefined) return query.data.length;
  return query.isError ? "unknown" : "asking";
}

function rowsOf(
  events: RelayEvent[],
  ownPubkey: string | null,
): TeamThreadRow[] {
  return events
    .filter((event) => SAID_KINDS.has(event.kind))
    .map((event) => ({
      content: event.content,
      createdAt: event.created_at,
      id: event.id,
      mine: ownPubkey !== null && event.pubkey === ownPubkey,
      pubkey: event.pubkey,
    }));
}

function deployInput(
  persona: AgentPersona,
  runtimes: readonly AcpRuntime[],
  fallback: AcpRuntime,
  teamId: string,
): CreateChannelManagedAgentInput {
  const { runtime } = resolvePersonaRuntime(
    persona.runtime,
    runtimes,
    fallback,
  );
  const chosen = runtime ?? fallback;
  return {
    avatarUrl: persona.avatarUrl ?? undefined,
    // One persona can be deployed under several teams with different
    // instructions — upstream's reason, and it holds here for a second one:
    // two worktrees are two conversations and must not share an agent.
    forceNewInstance: true,
    model: persona.model ?? undefined,
    name: persona.displayName,
    personaId: persona.id,
    role: "bot",
    runtime: {
      command: chosen.command,
      defaultArgs: chosen.defaultArgs,
      id: chosen.id,
      label: chosen.label,
      mcpCommand: chosen.mcpCommand,
    },
    systemPrompt: persona.systemPrompt,
    teamId,
  };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
