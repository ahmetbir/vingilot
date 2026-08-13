import {
  buildInstanceInputForDefinition,
  resolveStartRuntimeForDefinition,
} from "@/features/agents/lib/instanceInputForDefinition";
import {
  addChannelMembers,
  createManagedAgent,
  discoverAcpRuntimes,
  getChannelMembers,
  listManagedAgents,
  updateManagedAgent,
} from "@/shared/api/tauri";
import { getAgentAccessOwnerOnly } from "@/shared/api/tauriAgentAccess";
import { getGlobalAgentConfig } from "@/shared/api/tauriGlobalAgentConfig";
import { listPersonas, setPersonaActive } from "@/shared/api/tauriPersonas";
import type {
  AcpRuntime,
  AgentPersona,
  CreateManagedAgentInput,
  ManagedAgent,
  UpdateManagedAgentInput,
} from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

export const WELCOME_GUIDE_AGENT_NAME = "Navigator";
export const WELCOME_GUIDE_PERSONA_ID = "builtin:navigator";
export const WELCOME_TEAM_ID = "builtin-team:crew";
export const WELCOME_GUIDE_INTRO_MARKER = "buzz-welcome-intro.v1";
const LEGACY_WELCOME_GUIDE_AGENT_NAME = "Kit";
/**
 * Fizz was the built-in guide before the crew. Its instances are still out
 * there on existing installs, and the channel-reuse checks below have to keep
 * recognising them — otherwise an upgrade greets a Welcome channel that already
 * has a guide in it with a second one.
 */
const LEGACY_WELCOME_GUIDE_PERSONA_ID = "builtin:fizz";
export const LEGACY_WELCOME_GUIDE_SYSTEM_PROMPT =
  "You are Kit, Sprout's friendly welcome guide. Help new users understand the community, channels, messages, and agents. Keep introductions concise, practical, and warm.";
export const WELCOME_GUIDE_INTRO_MESSAGE =
  "Hi, I'm Navigator. Welcome aboard Vingilot.\n\nYou're the Captain here. I plot the course — tell me what you want built and I'll turn it into a plan with the risks named.\n\nBosun keeps the build running, Lookout reviews what's about to land, and Scribe writes the log. Ask me what else this ship can do, or just talk through what you're working on.";

export type WelcomeTeamRole = "lead" | "teammate";

export type WelcomeTeamStarterDefinition = Readonly<{
  name: string;
  personaId: string;
  role: WelcomeTeamRole;
}>;

/**
 * Stable identities used to provision the Rust-seeded crew team
 * (`builtin-team:crew`, seeded by `managed_agents::teams`). The order is the
 * provisioning order and the first entry is the lead — it speaks the opener and
 * the others are allowlisted to it.
 *
 * **Mate is deliberately absent.** The First Mate is an owner-only DM per the
 * assistant plan's identity decision, so it is never a channel member; the
 * Rust seed excludes it too (`vingilot_crew::WELCOME_TEAM_PERSONA_IDS`), and
 * both exclusions are asserted by tests rather than left to comments.
 */
export const WELCOME_TEAM_STARTERS = [
  { name: "Navigator", personaId: "builtin:navigator", role: "lead" },
  { name: "Bosun", personaId: "builtin:bosun", role: "teammate" },
  { name: "Lookout", personaId: "builtin:lookout", role: "teammate" },
  { name: "Scribe", personaId: "builtin:scribe", role: "teammate" },
] as const satisfies readonly WelcomeTeamStarterDefinition[];

/**
 * The provisioned crew, in `WELCOME_TEAM_STARTERS` order: `[0]` is the lead,
 * the rest are its teammates. Deliberately not a fixed-arity tuple — the roster
 * is a list in one place, and changing its size must not require retyping the
 * kickoff. `assertWelcomeTeamAgents` is what makes the arity a runtime fact.
 */
export type WelcomeTeamAgents = readonly ManagedAgent[];

/**
 * Every starter came back, or the caller gets an error instead of a short list
 * it would silently treat as a complete team.
 */
export function assertWelcomeTeamAgents(
  agents: readonly (ManagedAgent | undefined)[],
): WelcomeTeamAgents {
  if (
    agents.length !== WELCOME_TEAM_STARTERS.length ||
    agents.some((agent) => !agent)
  ) {
    throw new Error("Crew provisioning did not return every starter.");
  }
  return agents as WelcomeTeamAgents;
}

const welcomeTeamPromises = new Map<string, Promise<WelcomeTeamAgents>>();

function normalizeRelayUrl(relayUrl: string | null | undefined) {
  return relayUrl?.trim().replace(/\/+$/, "") ?? null;
}

function isAgentScopedToRelay(agent: ManagedAgent, relayUrl?: string | null) {
  const targetRelayUrl = normalizeRelayUrl(relayUrl);
  if (!targetRelayUrl) {
    return true;
  }
  return normalizeRelayUrl(agent.relayUrl) === targetRelayUrl;
}

function isBuiltInWelcomeGuideAgent(agent: ManagedAgent) {
  return (
    agent.personaId === WELCOME_GUIDE_PERSONA_ID ||
    agent.personaId === LEGACY_WELCOME_GUIDE_PERSONA_ID
  );
}

function isLegacyKitWelcomeGuideAgent(agent: ManagedAgent) {
  return (
    agent.name.trim().toLowerCase() ===
      LEGACY_WELCOME_GUIDE_AGENT_NAME.toLowerCase() &&
    agent.systemPrompt?.trim() === LEGACY_WELCOME_GUIDE_SYSTEM_PROMPT
  );
}

function isWelcomeGuideAgent(agent: ManagedAgent) {
  return (
    isBuiltInWelcomeGuideAgent(agent) || isLegacyKitWelcomeGuideAgent(agent)
  );
}

function pickAgentByStatus(agents: ManagedAgent[]) {
  return (
    agents.find((agent) => agent.status === "running") ??
    agents.find((agent) => agent.status === "deployed") ??
    agents[0] ??
    null
  );
}

export function pickWelcomeGuideAgent(agents: ManagedAgent[]) {
  return pickAgentByStatus(agents.filter(isWelcomeGuideAgent));
}

export function pickWelcomeGuideAgentForRelay(
  agents: ManagedAgent[],
  relayUrl?: string | null,
) {
  return pickAgentByStatus(
    agents.filter(
      (agent) =>
        isWelcomeGuideAgent(agent) && isAgentScopedToRelay(agent, relayUrl),
    ),
  );
}

/** Find the preferred managed instance for one starter persona and relay. */
export function pickWelcomeTeamStarterAgentForRelay(
  agents: ManagedAgent[],
  starter: WelcomeTeamStarterDefinition,
  relayUrl?: string | null,
) {
  return pickAgentByStatus(
    agents.filter(
      (agent) =>
        agent.teamId === WELCOME_TEAM_ID &&
        agent.personaId === starter.personaId &&
        isAgentScopedToRelay(agent, relayUrl),
    ),
  );
}

/** Pubkeys belonging to any managed Welcome Team persona on this relay. */
export async function getWelcomeTeamAgentPubkeys(relayUrl?: string | null) {
  const personaIds = new Set<string>(
    WELCOME_TEAM_STARTERS.map(({ personaId }) => personaId),
  );
  return (await listManagedAgents())
    .filter(
      (agent) =>
        agent.teamId === WELCOME_TEAM_ID &&
        agent.personaId !== null &&
        personaIds.has(agent.personaId) &&
        isAgentScopedToRelay(agent, relayUrl),
    )
    .map((agent) => agent.pubkey);
}

/** Legacy Fizz/Kit lookup retained for existing channel reuse checks. */
export async function getWelcomeGuideAgentPubkeys(relayUrl?: string | null) {
  return (await listManagedAgents())
    .filter(
      (agent) =>
        isWelcomeGuideAgent(agent) && isAgentScopedToRelay(agent, relayUrl),
    )
    .map((agent) => agent.pubkey);
}

export async function activateWelcomeTeamPersonasSequentially(
  inactivePersonaIds: readonly string[],
  activate: (personaId: string) => Promise<unknown>,
) {
  for (const personaId of inactivePersonaIds) {
    await activate(personaId);
  }
}

async function ensureWelcomeTeamPersonasActive() {
  const personas = await listPersonas();
  const personasById = new Map(
    personas.map((persona) => [persona.id, persona]),
  );

  for (const starter of WELCOME_TEAM_STARTERS) {
    if (!personasById.has(starter.personaId)) {
      throw new Error(`${starter.name} agent not found.`);
    }
  }

  // Persona activation is a read-modify-write operation over one shared file.
  // Run these sequentially so concurrent writes cannot lose a teammate's
  // activation and leave Welcome provisioning permanently partial.
  await activateWelcomeTeamPersonasSequentially(
    WELCOME_TEAM_STARTERS.filter(
      ({ personaId }) => !personasById.get(personaId)?.isActive,
    ).map(({ personaId }) => personaId),
    (personaId) => setPersonaActive(personaId, true),
  );
}

async function ensureWelcomeTeamMembership(
  channelId: string,
  agents: WelcomeTeamAgents,
) {
  const members = await getChannelMembers(channelId).catch(() => []);
  const memberPubkeys = new Set(
    members.map((member) => normalizePubkey(member.pubkey)),
  );
  const missingAgents = agents.filter(
    (agent) => !memberPubkeys.has(normalizePubkey(agent.pubkey)),
  );
  if (missingAgents.length === 0) {
    return;
  }

  const result = await addChannelMembers({
    channelId,
    pubkeys: missingAgents.map((agent) => agent.pubkey),
    role: "bot",
  });
  const unexpectedError = result.errors.find(
    ({ error }) => !error.toLowerCase().includes("already"),
  );
  if (unexpectedError) {
    throw new Error(unexpectedError.error);
  }
}

export async function buildWelcomeStarterCreateInput(
  starter: WelcomeTeamStarterDefinition,
  persona: AgentPersona,
  runtimes: readonly AcpRuntime[],
  preferredRuntimeId: string | null,
  relayUrl?: string | null,
): Promise<CreateManagedAgentInput> {
  const { runtime } = resolveStartRuntimeForDefinition(
    persona,
    runtimes,
    preferredRuntimeId,
  );
  return {
    ...(await buildInstanceInputForDefinition(persona, runtime)),
    name: starter.name,
    teamId: WELCOME_TEAM_ID,
    relayUrl: relayUrl ?? undefined,
    spawnAfterCreate: false,
    startOnAppLaunch: false,
    respondTo: "owner-only",
  };
}

export function welcomeStarterRuntimeUpdate(
  existing: ManagedAgent,
  desired: CreateManagedAgentInput,
) {
  if (!desired.agentCommand) return null;

  const desiredArgs = desired.agentArgs ?? [];
  const desiredModel = desired.model ?? null;
  const desiredProvider = desired.provider ?? null;
  const desiredMcpCommand = desired.mcpCommand ?? "";
  if (
    existing.agentCommand === desired.agentCommand &&
    existing.agentArgs.join(",") === desiredArgs.join(",") &&
    existing.model === desiredModel &&
    existing.provider === desiredProvider &&
    existing.mcpCommand === desiredMcpCommand
  ) {
    return null;
  }

  return {
    pubkey: existing.pubkey,
    agentCommand: desired.agentCommand,
    harnessOverride: true,
    agentArgs: desiredArgs,
    mcpCommand: desiredMcpCommand,
    model: desiredModel,
    provider: desiredProvider,
  };
}

export function welcomeTeammateHasExpectedAccess(
  teammate: ManagedAgent,
  leadPubkey: string,
  agentAccessOwnerOnly: boolean,
) {
  if (agentAccessOwnerOnly) {
    // Welcome teammates are created owner-only, and the lead remains authorized
    // as a NIP-OA-verified sibling because every Welcome agent shares one owner.
    return (
      teammate.respondTo === "owner-only" &&
      teammate.respondToAllowlist.length === 0
    );
  }
  return (
    teammate.respondTo === "allowlist" &&
    teammate.respondToAllowlist.some(
      (pubkey) => normalizePubkey(pubkey) === normalizePubkey(leadPubkey),
    )
  );
}

/**
 * The access write that moves a Welcome teammate to the state this build
 * expects, or null when it is already there. The remediation target must track
 * {@link welcomeTeammateHasExpectedAccess}: writing `allowlist:[lead]` in an
 * owner-only build would fail the predicate again on the next provisioning
 * pass, so an upgraded install with pre-existing allowlisted teammates would
 * rewrite the same rejected state forever and keep restarting them.
 */
export function welcomeTeammateAccessUpdate(
  teammate: ManagedAgent,
  leadPubkey: string,
  agentAccessOwnerOnly: boolean,
): UpdateManagedAgentInput | null {
  if (
    welcomeTeammateHasExpectedAccess(teammate, leadPubkey, agentAccessOwnerOnly)
  ) {
    return null;
  }
  return agentAccessOwnerOnly
    ? {
        pubkey: teammate.pubkey,
        respondTo: "owner-only",
        respondToAllowlist: [],
      }
    : {
        pubkey: teammate.pubkey,
        respondTo: "allowlist",
        respondToAllowlist: [leadPubkey],
      };
}

/**
 * Ensure the complete built-in crew team is ready for kickoff.
 * The team itself is Rust-seeded; this only activates personas, creates any
 * missing relay-scoped instances, and adds every starter to Welcome as a bot.
 */
async function provisionWelcomeTeam(
  channelId: string,
  relayUrl?: string | null,
): Promise<WelcomeTeamAgents> {
  const existingAgents = await listManagedAgents();
  await ensureWelcomeTeamPersonasActive();
  const [personas, runtimeCatalog, globalConfig, agentAccessOwnerOnly] =
    await Promise.all([
      listPersonas(),
      discoverAcpRuntimes(),
      getGlobalAgentConfig(),
      getAgentAccessOwnerOnly(),
    ]);
  const personasById = new Map(
    personas.map((persona) => [persona.id, persona]),
  );
  const runtimes = runtimeCatalog.filter(
    (runtime): runtime is AcpRuntime => runtime.availability === "available",
  );

  const agents: ManagedAgent[] = [];
  for (const starter of WELCOME_TEAM_STARTERS) {
    const persona = personasById.get(starter.personaId);
    if (!persona) {
      throw new Error(`${starter.name} agent not found.`);
    }
    const desired = await buildWelcomeStarterCreateInput(
      starter,
      persona,
      runtimes,
      globalConfig.preferred_runtime,
      relayUrl,
    );
    const existing = pickWelcomeTeamStarterAgentForRelay(
      existingAgents,
      starter,
      relayUrl,
    );
    if (existing) {
      const runtimeUpdate = welcomeStarterRuntimeUpdate(existing, desired);
      agents.push(
        runtimeUpdate
          ? (await updateManagedAgent(runtimeUpdate)).agent
          : existing,
      );
      continue;
    }

    const created = await createManagedAgent(desired);
    agents.push(created.agent);
  }
  const provisioned = assertWelcomeTeamAgents(agents);
  const lead = provisioned[0] as ManagedAgent;
  const leadPubkey = lead.pubkey;
  // Every teammate answers the lead, whatever the roster's size (the crew is
  // four starters, not the bees' fixed three) — indices are derived from the
  // starter list rather than written out. Access is settled through upstream's
  // welcomeTeammateAccessUpdate so owner-only respects the same rule.
  const welcomeAgents = [...provisioned];
  for (let index = 1; index < welcomeAgents.length; index += 1) {
    const teammate = welcomeAgents[index] as ManagedAgent;
    const accessUpdate = welcomeTeammateAccessUpdate(
      teammate,
      leadPubkey,
      agentAccessOwnerOnly,
    );
    if (accessUpdate) {
      const updated = await updateManagedAgent(accessUpdate);
      welcomeAgents[index] = updated.agent;
    }
  }
  await ensureWelcomeTeamMembership(channelId, welcomeAgents);
  return welcomeAgents;
}

export function ensureWelcomeTeam(
  channelId: string,
  relayUrl?: string | null,
): Promise<WelcomeTeamAgents> {
  const key = `${normalizeRelayUrl(relayUrl) ?? ""}:${channelId}`;
  const current = welcomeTeamPromises.get(key);
  if (current) return current;

  const promise = provisionWelcomeTeam(channelId, relayUrl).finally(() =>
    welcomeTeamPromises.delete(key),
  );
  welcomeTeamPromises.set(key, promise);
  return promise;
}
