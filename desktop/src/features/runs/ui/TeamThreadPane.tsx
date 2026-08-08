// A conversation with a Buzz agent team, about the selected worktree
// (vingilot/docs/plans/2026-08-08-scratch-and-team-thread.md, Task 2).
//
// **Where the conversation lives: the relay, in an ordinary private channel.**
// `lib/teamThread.ts` carries the argument; the short version is that the
// members of a team each hold their own key and sign their own messages, so
// nothing here forges an author the way landing the local ACP adapter's answers
// in a channel would. `lib/teamThreadStore.ts` keeps two ids per worktree and
// no message, ever.
//
// **What it draws, and what it deliberately does not.** Upstream's timeline is
// virtualised and carries threads, reactions, edits, media and mentions; a
// worktree thread wants none of that, and hosting `ChannelPane` would mean
// hosting `ChannelScreen`'s whole orchestration inside a pane. So the messages
// are read with upstream's own hooks (`useChannelMessagesQuery`,
// `useChannelSubscription`) and drawn here in the island's plain text chrome —
// the same relay events the rest of the app shows, rendered smaller. The thread
// is a normal channel: everything this pane cannot do, the channel screen can.
//
// **Choosing the team is part of the pane**, per the plan — one team per
// worktree, stored beside that worktree's tabs and panes, not a global setting.

import * as React from "react";

import {
  canSend,
  scopeSentence,
  splitScope,
} from "@/features/runs/lib/teamThread";
import type { TeamThread } from "@/features/runs/lib/useTeamThread";
import { useTeamThread } from "@/features/runs/lib/useTeamThread";
import { worktreeSummary } from "@/features/runs/lib/projects";
import type { PaneProps } from "@/features/runs/ui/paneRegistry";
import { truncatePubkey } from "@/shared/lib/pubkey";

export function TeamThreadPane({ cwd, worktree }: PaneProps) {
  const thread = useTeamThread({
    bindingId: worktree?.binding_id ?? null,
    cwd,
    worktreeLabel: worktree === null ? "" : worktreeSummary(worktree).label,
  });

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="pane-team"
    >
      <Verdict thread={thread} />
      {canSend(thread.reading) ? <Body cwd={cwd} thread={thread} /> : null}
    </div>
  );
}

/** The four sentences, each its own — and never each other's.
 *
 * `unsure` renders as a note the pane keeps working under, because "could not
 * ask" is not "no": a build that never put the question has not been refused,
 * and shutting the pane on it would turn a missing answer into a negative one. */
function Verdict({ thread }: { thread: TeamThread }) {
  const reading = thread.reading;
  if (reading.status === "ready") return null;
  if (reading.status === "blocked") {
    return (
      <p
        className="px-4 py-3 text-sm text-muted-foreground"
        data-testid="team-blocked"
      >
        {reading.reason}
      </p>
    );
  }
  if (reading.status === "waiting") {
    return (
      <p
        className="px-4 py-3 text-sm text-muted-foreground"
        data-testid="team-waiting"
      >
        {reading.note}
      </p>
    );
  }
  return (
    <p
      className="border-b border-border/60 px-4 py-2 text-xs text-muted-foreground"
      data-testid="team-unsure"
    >
      {reading.note}
    </p>
  );
}

function Body({ cwd, thread }: { cwd: string | null; thread: TeamThread }) {
  if (cwd === null) return null;
  if (thread.team === null) return <TeamChoice thread={thread} />;
  if (thread.channel === null) return <Preflight cwd={cwd} thread={thread} />;
  return <Conversation cwd={cwd} thread={thread} />;
}

/** Which team, chosen here rather than in settings — a worktree is a piece of
 * work and the team that suits it is a property of the work. */
function TeamChoice({ thread }: { thread: TeamThread }) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3"
      data-testid="team-choice"
    >
      <p className="text-sm text-muted-foreground">
        Which team is this worktree's conversation with?
      </p>
      {thread.teams.map((team) => (
        <button
          className="rounded-lg border border-border/60 px-3 py-2 text-left hover:bg-muted/40"
          data-testid={`team-choice-${team.id}`}
          key={team.id}
          onClick={() => thread.chooseTeam(team.id)}
          type="button"
        >
          <span className="block text-sm font-medium">{team.name}</span>
          <span className="block text-xs text-muted-foreground">
            {team.personaIds.length}{" "}
            {team.personaIds.length === 1 ? "member" : "members"}
            {team.description === null || team.description === ""
              ? ""
              : ` · ${team.description}`}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Everything that is about to happen, before it does: who gets deployed, what
 * they will be told, and what stands in the way. A team deploy mints agents and
 * starts processes on this machine — it is not a thing to do on a click with no
 * sentence in front of it. */
function Preflight({ cwd, thread }: { cwd: string; thread: TeamThread }) {
  const blocked =
    thread.missingMembers > 0 ||
    thread.noRuntime ||
    thread.members.length === 0;
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
      data-testid="team-preflight"
    >
      <ChosenTeam thread={thread} />
      <Scope cwd={cwd} />
      {thread.lostChannel ? (
        <p className="text-xs text-muted-foreground" data-testid="team-lost">
          A thread was opened here before and its channel is not in this
          community's list any more. Opening one now makes a new channel; the
          old one, if it still exists, is wherever it was.
        </p>
      ) : null}
      {thread.missingMembers > 0 ? (
        <p className="text-xs text-destructive" data-testid="team-missing">
          This team names {thread.missingMembers} agent
          {thread.missingMembers === 1 ? "" : "s"} that{" "}
          {thread.missingMembers === 1 ? "is" : "are"} no longer in My Agents.
          Deploying the rest would be a team with a hole in it, so nothing is
          deployed until the team is edited or they are added back.
        </p>
      ) : null}
      {thread.noRuntime ? (
        <p className="text-xs text-destructive" data-testid="team-no-runtime">
          No ACP runtime is available on this machine, so there is nothing to
          run a team member on.
        </p>
      ) : null}
      <button
        className="self-start rounded-lg border border-border/60 px-3 py-1.5 text-sm hover:bg-muted/40 disabled:opacity-50"
        data-testid="team-open"
        disabled={blocked || thread.opening}
        onClick={() => thread.openThread()}
        type="button"
      >
        {thread.opening
          ? "opening…"
          : `Open a thread with ${thread.team?.name ?? "this team"}`}
      </button>
      <button
        className="self-start text-xs text-muted-foreground underline"
        data-testid="team-change"
        onClick={() => thread.forgetTeam()}
        type="button"
      >
        choose a different team
      </button>
      <Trouble thread={thread} />
    </div>
  );
}

function ChosenTeam({ thread }: { thread: TeamThread }) {
  return (
    <div className="flex flex-col gap-1" data-testid="team-members">
      <p className="text-sm font-medium">{thread.team?.name}</p>
      <p className="text-xs text-muted-foreground">
        {thread.members.length === 0
          ? "no members this app can resolve"
          : `one agent per member, each with its own key: ${thread.members
              .map((member) => member.name)
              .join(", ")}`}
      </p>
    </div>
  );
}

/** The scope, stated in the words of the line that will actually be sent. */
function Scope({ cwd }: { cwd: string }) {
  return (
    <p className="text-xs text-muted-foreground" data-testid="team-scope">
      {scopeSentence(cwd)}
    </p>
  );
}

function Conversation({ cwd, thread }: { cwd: string; thread: TeamThread }) {
  const [draft, setDraft] = React.useState("");

  function submit() {
    if (draft.trim() === "") return;
    thread.send(draft);
    setDraft("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3"
        data-testid="team-thread"
      >
        {thread.deployFailures.length > 0 ? (
          <p className="text-xs text-destructive" data-testid="team-partial">
            {thread.deployFailures.length} member
            {thread.deployFailures.length === 1 ? "" : "s"} could not be
            deployed, so this thread is short of{" "}
            {thread.deployFailures.length === 1 ? "one" : "them"}:{" "}
            {thread.deployFailures
              .map((failure) => `${failure.name} (${failure.error})`)
              .join("; ")}
          </p>
        ) : null}
        {thread.messages.length === 0 ? (
          // Not "no messages": nothing has *arrived*. A thread opened a second
          // ago and a relay that has not answered look the same from here.
          <p className="text-sm text-muted-foreground">
            nothing in this thread yet
          </p>
        ) : (
          thread.messages.map((row) => (
            <div className="flex flex-col gap-0.5" key={row.id}>
              <span className="text-2xs text-muted-foreground">
                {row.mine
                  ? "you"
                  : (thread.nameOf(row.pubkey) ?? truncatePubkey(row.pubkey))}
              </span>
              <span className="whitespace-pre-wrap break-words text-sm">
                {splitScope(row.content).body}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="shrink-0 border-t border-border/60 px-4 py-2">
        <Scope cwd={cwd} />
        <textarea
          className="mt-2 h-16 w-full resize-none rounded-lg border border-border/60 bg-transparent px-2 py-1 text-sm"
          data-testid="team-composer"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // ⌘/Ctrl+Enter, not bare Enter: a message here carries a path and
            // goes to a server, and a newline is the more likely keystroke.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={`Ask ${thread.team?.name ?? "the team"} about this worktree…`}
          value={draft}
        />
        <div className="flex items-center gap-2">
          <button
            className="rounded-lg border border-border/60 px-3 py-1 text-xs hover:bg-muted/40 disabled:opacity-50"
            data-testid="team-send"
            disabled={thread.sending || draft.trim() === ""}
            onClick={submit}
            type="button"
          >
            {thread.sending ? "sending…" : "Send ⌘↵"}
          </button>
          <button
            className="text-xs text-muted-foreground underline"
            data-testid="team-change"
            onClick={() => thread.forgetTeam()}
            type="button"
          >
            choose a different team
          </button>
        </div>
        <Trouble thread={thread} />
      </div>
    </div>
  );
}

/** What refused, in the words of whatever refused it. Named by step, so a
 * failed deploy and a failed send are not one sentence about "an error". */
function Trouble({ thread }: { thread: TeamThread }) {
  if (thread.trouble === null) return null;
  return (
    <p className="pt-2 text-xs text-destructive" data-testid="team-trouble">
      {thread.trouble.step === "open"
        ? "the thread could not be opened: "
        : "this message did not go: "}
      {thread.trouble.message}
    </p>
  );
}
