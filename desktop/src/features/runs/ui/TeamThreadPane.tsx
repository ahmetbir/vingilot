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
  troubleSentence,
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
  const [confirmingSecond, setConfirmingSecond] = React.useState(false);
  const blocked =
    thread.missingMembers > 0 ||
    thread.noRuntime ||
    thread.members.length === 0;
  // A thread already on the relay for this (worktree, team) turns the deploy
  // from the obvious action into the unusual one: the first is free, the second
  // costs another agent process per member and leaves the first thread behind.
  const again = thread.existingThread;
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
      data-testid="team-preflight"
    >
      <ChosenTeam thread={thread} />
      <Scope cwd={cwd} />
      {again === null && thread.lostChannel ? (
        <p className="text-xs text-muted-foreground" data-testid="team-lost">
          A thread was opened here before and its channel is not in this
          community's list any more. Opening one now makes a new channel; the
          old one, if it still exists, is wherever it was.
        </p>
      ) : null}
      {again === null ? null : (
        <div className="flex flex-col gap-2" data-testid="team-existing">
          <p className="text-xs text-muted-foreground">
            This worktree already has a thread with {thread.team?.name} on the
            relay: #{again.name}. Reopening it deploys nothing and starts
            nothing — it points this pane back at that channel, with everything
            already said in it.
          </p>
          <button
            className="self-start rounded-lg border border-border/60 px-3 py-1.5 text-sm hover:bg-muted/40"
            data-testid="team-adopt"
            onClick={() => thread.adoptThread()}
            type="button"
          >
            Reopen #{again.name}
          </button>
        </div>
      )}
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
      {again !== null && !confirmingSecond ? (
        <button
          className="self-start text-xs text-muted-foreground underline"
          data-testid="team-open-second"
          disabled={blocked || thread.opening}
          onClick={() => setConfirmingSecond(true)}
          type="button"
        >
          or open a second, separate thread with this team…
        </button>
      ) : null}
      {again === null || confirmingSecond ? (
        <div className="flex flex-col gap-2">
          {again === null ? null : (
            <p className="text-xs text-destructive" data-testid="team-second">
              Open a <em>second</em> thread with {thread.team?.name}? This makes
              another channel and starts a new agent process for each of its{" "}
              {thread.members.length}{" "}
              {thread.members.length === 1 ? "member" : "members"} — the ones in
              #{again.name} keep running and are not reused. That thread and
              everything said in it are untouched, and this pane will point at
              the new one.
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              className="self-start rounded-lg border border-border/60 px-3 py-1.5 text-sm hover:bg-muted/40 disabled:opacity-50"
              data-testid="team-open"
              disabled={blocked || thread.opening}
              onClick={() => thread.openThread()}
              type="button"
            >
              {thread.opening
                ? "opening…"
                : again === null
                  ? `Open a thread with ${thread.team?.name ?? "this team"}`
                  : "Open a second thread"}
            </button>
            {again === null ? null : (
              <button
                className="text-xs text-muted-foreground underline"
                data-testid="team-second-cancel"
                onClick={() => setConfirmingSecond(false)}
                type="button"
              >
                cancel
              </button>
            )}
          </div>
        </div>
      ) : null}
      <ChangeTeam thread={thread} />
      <Trouble thread={thread} />
    </div>
  );
}

/** Putting the team choice back — which, once a thread exists, **drops this
 * worktree's pointer to it**, so it asks first and the question names the
 * channel it is about.
 *
 * Two things made this worth a confirmation. It sat next to Send, where a
 * mis-aimed click is one pixel of travel away; and the state it dropped could
 * not be re-derived by the pane, so the recovery was to open another thread,
 * which mints another agent process per member and leaves the first set
 * running. The second half of that is fixed in `Preflight` — a thread already
 * on the relay is offered for reopening rather than replaced — and this is the
 * first: with a thread in hand, the control is a question, not an action. */
function ChangeTeam({ thread }: { thread: TeamThread }) {
  const [asking, setAsking] = React.useState(false);

  if (!thread.hasThreadPointer) {
    // No thread yet: forgetting costs the choice and nothing else, and a
    // confirmation on a free action is noise that teaches him to click through
    // the one that is not.
    return (
      <button
        className="self-start text-xs text-muted-foreground underline"
        data-testid="team-change"
        onClick={() => thread.forgetTeam()}
        type="button"
      >
        choose a different team
      </button>
    );
  }

  if (!asking) {
    return (
      <button
        className="text-xs text-muted-foreground underline"
        data-testid="team-change"
        onClick={() => setAsking(true)}
        type="button"
      >
        change team…
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="team-change-confirm">
      <p className="text-xs text-muted-foreground">
        Change team? This pane stops pointing at
        {thread.channel === null
          ? " this worktree's thread"
          : ` #${thread.channel.name}`}
        . Nothing is deleted: the channel and everything said in it stay on the
        relay, and the agents already deployed into it keep running. Choosing
        this team again offers to reopen this same thread; opening a thread with
        a different team starts a new agent process for each of that team's
        members.
      </p>
      <div className="flex items-center gap-2">
        <button
          className="rounded-lg border border-border/60 px-3 py-1 text-xs hover:bg-muted/40"
          data-testid="team-change-yes"
          onClick={() => {
            setAsking(false);
            thread.forgetTeam();
          }}
          type="button"
        >
          Change team
        </button>
        <button
          className="text-xs text-muted-foreground underline"
          data-testid="team-change-no"
          onClick={() => setAsking(false)}
          type="button"
        >
          Keep this thread
        </button>
      </div>
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
  // The draft is the hook's, not this component's: a relay reinit remounts the
  // whole community subtree, and a `useState` here would take the half-written
  // paragraph with it. It is also not cleared by clicking Send — only by the
  // relay accepting the message.
  const draft = thread.draft;

  function submit() {
    if (draft.trim() === "") return;
    thread.send();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* The team control lives here, at the top and a pane's width away from
          Send — not beside it, where an unconfirmed click used to cost the
          thread pointer. */}
      <div
        className="flex shrink-0 flex-col gap-1 border-b border-border/60 px-4 py-2"
        data-testid="team-thread-header"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">
            {thread.team?.name}
          </span>
          <ChangeTeam thread={thread} />
        </div>
        {thread.channel === null ? null : (
          <span className="truncate text-2xs text-muted-foreground">
            #{thread.channel.name}
          </span>
        )}
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3"
        data-testid="team-thread"
      >
        {thread.opening ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="team-deploying"
          >
            deploying this team's members into the thread…
          </p>
        ) : null}
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
          onChange={(event) => thread.setDraft(event.target.value)}
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
        </div>
        <Trouble thread={thread} />
      </div>
    </div>
  );
}

/** What refused, in the words of whatever refused it. Named by step, so a
 * thread that could not be made, a thread whose members could not be deployed,
 * and a message that did not go are not one sentence about "an error". The
 * words are `teamThread.ts`'s, where they can be tested against the states this
 * component only renders. */
function Trouble({ thread }: { thread: TeamThread }) {
  if (thread.trouble === null) return null;
  return (
    <p className="pt-2 text-xs text-destructive" data-testid="team-trouble">
      {troubleSentence(thread.trouble.step)}
      {thread.trouble.message}
    </p>
  );
}
