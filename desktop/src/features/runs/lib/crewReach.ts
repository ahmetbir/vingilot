// **The crew, where the work is** — the ⌘K rows that put the Captain in front
// of a crew member with the worktree already named
// (vingilot/docs/plans/2026-08-12-the-crew.md, Task 3).
//
// **This is wiring, and this file is the part of it that has no wires.** There
// is exactly one way to talk to a crew member in this app already: a message in
// a channel — the worktree's team thread for the four who live there, an
// owner-only DM for Mate — composed in upstream's own composer, with upstream's
// own mentions. So a row here produces a *destination and a draft*, and
// `useCrewReach.ts` hands both to the transports that already carry them
// (`useDrafts`' `persistDraftEntry`, `useOpenDmMutation`, `goChannel`). Nothing
// in this island sends anything.
//
// **A row is pre-addressed, never pre-sent.** The draft lands in the composer
// with the cursor after it and the Captain presses Enter — or does not. That is
// the difference between a palette row and an agent that starts talking because
// a key was pressed, and it is why every `message` below ends in a space rather
// than a question mark.
//
// **Rows appear only when the crew member exists.** Not blocked-with-a-sentence
// like a pane that cannot open: a crew member that was never minted is not a
// thing this workspace has, in the same way a project that was never added is
// not a row in the project list. What *is* blocked-with-a-sentence is a minted
// member with nowhere to be reached — Lookout with no thread open — because
// there the agent exists and the door is what is missing, which is a fact worth
// a sentence.
//
// Pure: no React, no Tauri, no storage.

import type { CrewBerth } from "./crewRoster.ts";

/** A crew member this workspace actually has: the record's own name (which is
 * whatever the Captain renamed it to at mint time), its pubkey, and the berth
 * that decides which door the row opens. */
export interface MintedCrewMember {
  personaId: string;
  name: string;
  pubkey: string;
  berth: CrewBerth;
}

/** What each crew member is asked for, by persona id. The verb is the row's
 * whole value: "Ask Navigator for a plan" is findable by *plan*, which is what
 * he is actually looking for when he opens ⌘K in the middle of something.
 *
 * Written as a table rather than one generic "Ask X…" row for the same reason
 * the roster's names are one word each: a row that says what it will do is a
 * row he can pick without reading the second line. */
interface CrewErrand {
  /** The label, with `{name}` where the member's own name goes — his name, not
   * the persona's, because a renamed Bosun is called what he called it. */
  label: string;
  /** The line under it. */
  detail: string;
  /** The draft, with `{where}` replaced by the worktree clause. */
  message: string;
}

const ERRANDS: Record<string, CrewErrand> = {
  "builtin:bosun": {
    detail: "the build, the toolchain, the thing that will not compile",
    label: "Ask {name} about this build",
    message: "@{name} {where} — ",
  },
  "builtin:lookout": {
    detail: "an adversarial read of what is about to land here",
    label: "Have {name} review this worktree",
    message:
      "@{name} review what is in {where}. Name what is wrong; say CONFIRMED only for what you can evidence. ",
  },
  "builtin:mate": {
    detail: "the First Mate, in a direct message only you can read",
    label: "Ask {name}…",
    message: "{where} — ",
  },
  "builtin:navigator": {
    detail: "a task-by-task plan with the risks named",
    label: "Ask {name} for a plan",
    message: "@{name} I want a plan for {where}. ",
  },
  "builtin:scribe": {
    detail: "a summary of what happened here, written small",
    label: "Have {name} write this up",
    message: "@{name} write up what has happened in {where}. ",
  },
};

/** One ⌘K row for one crew member. */
export interface CrewReachRow {
  personaId: string;
  pubkey: string;
  berth: CrewBerth;
  /** The crew member's own name — what the Captain renamed it to, and **the
   * only string the `@` in `message` is written with**. Carried separately from
   * `label` because the label is a sentence that happens to contain the name:
   * a mention reference keyed on "Have Watch review this worktree" matches
   * nothing in the draft, so the composer would not highlight it, the send path
   * would not resolve it, and the next persist would drop it. */
  name: string;
  label: string;
  detail: string;
  /** Why this cannot be reached right now, or `null`. */
  blocked: string | null;
  /** The draft that lands in the composer. Ends in a space: the Captain writes
   * the rest. */
  message: string;
  /** Where the draft goes for a `thread` member — the worktree's team-thread
   * channel. `null` for Mate, whose DM is opened on demand rather than looked
   * up, and `null` on a blocked thread row for the reason it is blocked. */
  channelId: string | null;
}

export interface CrewReachContext {
  /** The crew this workspace has. An empty list is an empty list of rows —
   * see this file's header on why absence is not a blocked row. */
  crew: readonly MintedCrewMember[];
  /** The selected worktree's branch label, or `null` on the landing view. */
  worktreeLabel: string | null;
  /** The selected checkout's directory, or `null`. */
  worktreeCwd: string | null;
  /** The team-thread channel this worktree has, or `null` when none has been
   * opened yet (`teamThreadStore.ts`'s pointer, read by the caller). */
  threadChannelId: string | null;
}

const NO_THREAD =
  "this worktree has no team thread yet — open one in the Team pane, and the crew is in it.";

/** The clause naming where the Captain is, for the draft. The branch and the
 * directory both, because a branch name is ambiguous across two checkouts of
 * one project and a path alone is unreadable in a sentence. */
function whereClause(label: string | null, cwd: string | null): string {
  if (label === null && cwd === null) return "this workspace";
  if (cwd === null) return `the ${label} worktree`;
  if (label === null) return cwd;
  return `the ${label} worktree (${cwd})`;
}

function fill(template: string, name: string, where: string): string {
  return template.replaceAll("{name}", name).replaceAll("{where}", where);
}

/** The rows, in the order the crew was handed over. */
export function crewReachRows(ctx: CrewReachContext): readonly CrewReachRow[] {
  const where = whereClause(ctx.worktreeLabel, ctx.worktreeCwd);
  return ctx.crew.flatMap((member) => {
    const errand = ERRANDS[member.personaId];
    if (errand === undefined) return [];
    const onThread = member.berth === "thread";
    const blocked = onThread && ctx.threadChannelId === null ? NO_THREAD : null;
    return [
      {
        berth: member.berth,
        blocked,
        channelId: onThread ? ctx.threadChannelId : null,
        detail: errand.detail,
        label: fill(errand.label, member.name, where),
        message: fill(errand.message, member.name, where),
        name: member.name,
        personaId: member.personaId,
        pubkey: member.pubkey,
      },
    ];
  });
}

/** The row for one persona id, or `null` — what the command handler asks with
 * the id a row carried, so that the same rules that drew the row decide again
 * whether it can run. Read twice rather than trusted once, for
 * `usePaletteCommands.ts`'s reason: the row was drawn from a snapshot and Enter
 * happens later. */
export function crewReachRow(
  ctx: CrewReachContext,
  personaId: string,
): CrewReachRow | null {
  return crewReachRows(ctx).find((row) => row.personaId === personaId) ?? null;
}
