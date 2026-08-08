# A scratch terminal, and a thread with the team

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Branch:** `vingilot/team-thread` off `vingilot/palette`.

**Goal:** Two things the owner asked for on 2026-08-08, after living in the workspace for a
day: *"btw tarzı temp terminal filan nerde, var mı öyle bi şey?"* and *"sağ tarafa ben Buzz
agent takımları ile konuşabileceğim bir worktree threadi de isterim."*

**Neither exists today, and the first is a real gap.** `⌘K → new terminal tab` opens a
*persistent* tab: bound to a worktree, backed by a tmux session, written into the saved layout.
Ask-mode (`⌘K → ?`) puts a *question* to an agent, not a shell. There is nothing that opens,
runs one thing, and leaves nothing behind.

---

## The identity argument, which decides where the thread lives

Ask-mode deliberately did **not** use upstream's chat, and the reason is worth restating
because it is exactly what makes this task different. Buzz's chat is a relay: every message is
a Nostr event signed with a key and published to a community. The local ACP adapter **has no
key**, so landing its answers in a channel would mean signing an agent's words with the
owner's identity — a forged author in a signed, hash-chained log.

**A Buzz agent team does have its own identity.** Upstream's agents post under their own
pubkeys for precisely this reason. So a conversation with a team is the case the relay was
built for, and this pane should use it rather than growing a third local store.

That the two agent surfaces persist differently is therefore **a consequence of who is
speaking**, not an inconsistency. Say so in the code and in `workbench.md`, so the next person
to notice two stores finds the reason instead of "tidying" them together.

---

## Task 1 — The scratch terminal

- [ ] A shell that opens over the work surface, runs, and leaves nothing behind: **no tmux
      session, no tab in the saved layout, no entry in the worktree's strip.** Closing it ends
      it. That is the whole point — a persistent scratch terminal is just a tab.
- [ ] Reachable from `⌘K` and from a chord. **Check every claimant first** (the whole app plus
      Tauri's default macOS menu via `muda`); an earlier task lost ⌘W that way and only found
      out in review. Report what you checked.
- [ ] It starts in the selected worktree's directory, and **says which** — a scratch shell whose
      cwd you have to guess is worse than no scratch shell.
- [ ] It must not disturb the persistent terminals: no resize of their ptys, no focus theft on
      close, no reuse of a session id. The fit guard and the replay both still hold.
- [ ] What happens to a scratch terminal when the app quits is **nothing** — and the UI must not
      imply otherwise. The status bar's persistence sentence is about the worktree's terminals;
      make sure it cannot be read as covering this one.
- [ ] Tests: the pure model (opening, closing, cwd resolution, id namespacing) plus a live PTY
      test that a scratch shell leaves no tmux session behind.

## Task 2 — The team thread pane

- [ ] **Read upstream first** and report what you find: `features/agents/teamHooks.ts`,
      `TeamDialog.tsx`, how a team is addressed, whether teams post to a channel and under
      which pubkey, and how `features/messages` sends. **Do not invent a messaging path** — if
      talking to a team already has a surface, this pane hosts it rather than reimplementing it.
- [ ] A pane on the registry: a conversation with a chosen agent team, **scoped to the
      selected worktree**. Choosing which team is part of the pane, not a global setting.
- [ ] It goes in the relay, per the identity argument above — the team signs its own messages.
      **If that turns out not to be reachable from the island without editing upstream, stop and
      report** with the smallest seam you can see, rather than building a fourth local store.
- [ ] **Say what the team is told about the worktree.** Same rule ask-mode follows: the UI
      states the context that is actually sent, and enumerates what is not. If all that goes is
      a path, it says that.
- [ ] Availability answered honestly: no teams configured, no community joined, relay
      unreachable — each is its own sentence, and "could not ask" is never rendered as "no".
- [ ] Tests: the pure model, plus a Playwright spec proving the scope sentence matches what is
      sent — mutate it and confirm red.

## Task 3 — Proof and docs
- [ ] Playwright over a real bundle for both, each spec proved red first.
- [ ] `workbench.md`: the scratch terminal and its honest boundary; the team thread; and **the
      identity argument for why there are two agent surfaces**.

---

## Global Constraints

- **`rm -rf` forbidden**, any path, including generated scripts and test teardown.
- **Resource budget:** never a release build; never two heavy builds at once; `df` before a
  build and **stop below 20 GiB free**; reclaim only with `cargo clean`.
- **The owner uses this app for real work while it is built.** Live tmux sessions on the default
  socket: never `kill-server`, never a tmux command without `-L <throwaway>`, never quit or
  relaunch his app.
- **Nothing outside this repo.**
- Never `git add -A`; never amend or rebase; never kill a process you did not start.
- Trailers `Signed-off-by` then `Co-authored-by`; `git commit -F`, never `-s`.
- Island-first; anything else needs a `seams.yaml` entry with a real reason.
- **An empty read is "no answer", never "nothing there."**
- **A test must be able to fail** — prove each new test red by breaking what it guards.

## Self-Review

**Riskiest:** Task 2's messaging path. The temptation is to build a local thread because it is
easy and the relay is fiddly — which would be a fourth store, contradict the identity argument
that justifies the pane, and quietly make the team's words the owner's. If the relay path is
not reachable, the honest outcome is a report, not a substitute.

**Most likely to be got wrong quietly:** Task 1's "leaves nothing behind". A scratch terminal
that accidentally takes a tmux session, or an id that collides with a real tab's, is
indistinguishable from working until a restart brings back a shell that was supposed to be
gone — or worse, until a close ends the wrong one.
