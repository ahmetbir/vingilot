// Everything the team-thread pane needs from the rest of the app, in one hook
// (vingilot/docs/plans/2026-08-08-scratch-and-team-thread.md, Task 2).
//
// **Nothing here is new machinery.** The pane hosts upstream's surfaces rather
// than reimplementing them, which is what the plan asked for once the survey
// found that talking to a team already has a path: a channel, and one managed
// agent per persona deployed into it (`features/agents/channelAgents.ts`, the
// same call `AddTeamToChannelDialog` makes). This file is the wiring and the
// ordering; every relay operation in it is an import.
//
// **What this hook stopped doing, 2026-08-10.** It used to read the channel's
// messages and hold a draft, because the pane drew its own list and composer.
// It does not any more: the pane mounts `ChannelRouteScreen` on the thread's
// channel id, so reading, subscribing, drafting and sending are upstream's —
// with upstream's mention autocomplete and upstream's mention tags, which is
// the whole reason the team can now hear him
// (vingilot/docs/plans/2026-08-09-team-thread-fidelity.md). What is left here is
// what the *pane* owns: which team, which channel, and opening one.
//
// **And one thing hosting alone did not buy.** Upstream's composer asks four
// queries who can be mentioned, and this hook's deploy changes the answer to
// three of them without going through any of the mutations that say so — see
// `refreshDeployedTeam`, which is that sentence and nothing else. Until it ran,
// the team was deployed and invisible: the autocomplete offered the *personas*
// they were minted from, which mention nobody.
//
// **Why this is a hook and not a component.** The pane is a rendering of what
// is below; keeping the questions here means the component is a function of an
// answer, and the answer's shape is `teamThread.ts`'s, which is pure and
// tested. It also keeps the component under its cap.

import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { createChannelManagedAgents } from "@/features/agents/channelAgents";
import type { CreateChannelManagedAgentInput } from "@/features/agents/channelAgents";
import {
  managedAgentsQueryKey,
  relayAgentsQueryKey,
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
  invalidateChannelState,
  useChannelsQuery,
  useCreateChannelMutation,
} from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import type {
  AcpRuntime,
  AgentPersona,
  AgentTeam,
  Channel,
} from "@/shared/api/types";
import { useRelayConnection } from "@/shared/api/useRelayConnection";

import {
  findThreadChannel,
  readTeamThread,
  relayReach,
  type TeamCount,
  type TeamThreadReading,
  type TeamThreadStep,
  threadChannelDescription,
  threadChannelName,
} from "./teamThread.ts";
import {
  bindingFor,
  readTeamThreadBindings,
  type TeamThreadBindings,
  withChosenTeam,
  withNoTeam,
  withThreadChannel,
  writeTeamThreadBindings,
} from "./teamThreadStore.ts";

/** What the pane could not do, said in the words of whatever refused. */
export interface TeamThreadTrouble {
  /** The step that failed, so the sentence can name it rather than saying
   * "something went wrong" — and, between `open` and `deploy`, so that it does
   * not say the opposite of what is on screen (`troubleSentence`). */
  step: TeamThreadStep;
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
  chooseTeam: (teamId: string) => void;
  /** Put the choice back. Drops this worktree's pointer and nothing else — the
   * channel and everything said in it stay on the relay. */
  forgetTeam: () => void;
  openThread: () => void;
  opening: boolean;
  /** Members that could not be deployed, by name and reason. A partial deploy
   * is reported as one: the thread exists and is short of an agent. */
  deployFailures: { name: string; error: string }[];
  trouble: TeamThreadTrouble | null;
}

const NO_TEAMS: AgentTeam[] = [];

export function useTeamThread(input: {
  bindingId: string | null;
  cwd: string | null;
  worktreeLabel: string;
}): TeamThread {
  const { bindingId, cwd, worktreeLabel } = input;

  const [bindings, setBindings] = React.useState<TeamThreadBindings>(() =>
    readTeamThreadBindings(),
  );
  const [opening, setOpening] = React.useState(false);
  const [trouble, setTrouble] = React.useState<TeamThreadTrouble | null>(null);
  const [deployFailures, setDeployFailures] = React.useState<
    { name: string; error: string }[]
  >([]);

  const { activeCommunity } = useCommunities();
  const connection = useRelayConnection();
  const teamsQuery = useTeamsQuery();
  const personasQuery = usePersonasQuery();
  const runtimesQuery = useAvailableAcpRuntimes();
  const channelsQuery = useChannelsQuery();
  const { globalConfig } = useGlobalAgentConfig();
  const createChannel = useCreateChannelMutation();
  const queryClient = useQueryClient();

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
      // The channel, once there is one. Which half of the open a failure lands
      // in is read off it in the `catch`, where the only other evidence would
      // be the shape of an error message; the `finally` needs the id itself.
      let opened: string | null = null;
      try {
        const channel = await createChannel.mutateAsync({
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
        rememberChannel(bindingId, teamId, channel.id);
        opened = channel.id;
        const result = await createChannelManagedAgents(
          channel.id,
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
        // The batch deploy reports a member that failed in its own `failures`,
        // so what reaches here after the channel exists is a step in front of
        // them — listing this app's agents, reading the channel's members —
        // failing wholesale. The thread is still open, and saying otherwise
        // beside a working composer is the sentence this distinction removes.
        const step: TeamThreadStep = opened === null ? "open" : "deploy";
        setTrouble({ message: reasonOf(error), step });
      } finally {
        // Also on the way out of a throw: a batch that failed part-way still
        // minted and enrolled the members it got to.
        if (opened !== null) void refreshDeployedTeam(queryClient, opened);
        setOpening(false);
      }
    })();
  }, [
    bindingId,
    createChannel,
    cwd,
    defaultRuntime,
    opening,
    queryClient,
    rememberChannel,
    resolved,
    runtimes,
    team,
    worktreeLabel,
  ]);

  return {
    adoptThread,
    channel,
    chooseTeam,
    deployFailures,
    existingThread,
    forgetTeam,
    hasThreadPointer: binding?.channelId != null,
    lostChannel,
    members: resolved.resolvedPersonas.map((persona) => ({
      id: persona.id,
      name: persona.displayName,
    })),
    missingMembers: resolved.missingPersonaCount,
    // "Not while we are still looking" is not "none": a runtime list in flight
    // must not read as a machine with no harness on it.
    noRuntime: !runtimesQuery.isLoading && defaultRuntime === null,
    openThread,
    opening,
    reading,
    team,
    teams,
    trouble,
  };
}

/** Everything that has to be re-read once a team has been deployed into a
 * channel — upstream's own set for the same act (`invalidateAgentQueries`,
 * private to `features/agents/hooks.ts`, run on settle by every mutation that
 * wraps this deploy). This hook cannot borrow those mutations: they take the
 * channel id a render before the channel exists, and it does not exist until
 * inside `openThread`'s callback.
 *
 * Why each, and why none of them heals on its own inside the half-minute in
 * which he types his first message:
 *
 * - **the managed-agent list** is what *every* agent mention candidate is
 *   gated on (`isAgentIdentityInManagedList`). Stale, the team's own agents
 *   are not offered at all — what the autocomplete shows in their place is the
 *   personas they were deployed from, which look the part and mention nobody.
 *   Its poll only runs while an agent is already known to be running, which is
 *   the state this deploy is what creates;
 * - **the channel's members** decide whether those agents read as members or
 *   as strangers to add before sending. That query has no poll and no event
 *   path at all;
 * - **the relay directory** carries their answer policy.
 */
async function refreshDeployedTeam(
  queryClient: QueryClient,
  channelId: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: managedAgentsQueryKey }),
    queryClient.invalidateQueries({ queryKey: relayAgentsQueryKey }),
    invalidateChannelState(queryClient, channelId),
  ]);
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
