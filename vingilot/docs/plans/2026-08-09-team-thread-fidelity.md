# The team thread should be the real thing

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Branch:** `vingilot/team-thread-fidelity` off `vingilot/keys-and-type`.

**Goal:** The owner used the team thread for real on 2026-08-09 and it failed him three ways:

> *"the team chat window should straight from the normal buzz thread. like exact. rn neither
> it is nor the mentions working. ayrıca channel adı da tam olmamış — wt-main nedir?"*

Screenshot facts: a pane rendering a bare message list ("you / Hello"), an `@fizz` being
typed with no autocomplete and no effect, and `#wt-main-welcome-team-kbz5pz` sitting in his
channel list.

**The root, named plainly:** the original plan (2026-08-08, Task 2) said *"if talking to a
team already has a surface, this pane hosts it rather than reimplementing it."* The
implementation reimplemented it — a custom list and composer beside upstream's real channel
surface. Every one of the three failures follows from that one deviation:

- No upstream composer → no mention autocomplete, no mention `p`-tags on send.
- No mention tags → **agents never reply**: `buzz-acp` dispatches on a mention filter
  (`crates/buzz-acp/src/lib.rs:1442-1454`) — an unmentioned message is one the harness
  deliberately ignores. "Mentions not working" is really "the team cannot hear you."
- A custom surface also re-renders messages its own way, so the pane looks nothing like the
  chat he lives in.

## What a survey established, 2026-08-10 (read this before planning your own approach)

A read-only survey answered the "read upstream first" step. Verify the citations as you go —
they are a head start, not a substitute for reading:

- **The mount costs zero upstream lines.** `ChannelRouteScreen`
  (`desktop/src/app/routes/ChannelRouteScreen.tsx:97`) is exported and already takes
  `channelId` as a prop; the route param is read exactly once *above* it
  (`app/routes/channels.$channelId.tsx:58`). Every other prop is nullable
  (`ChannelRouteScreen.tsx:17-24`). `ChannelPane` is smaller but unusable standalone — its
  ~70 props are all computed by `ChannelScreen`.
- **Every provider it needs is already above the pane.** AppShell's `<Outlet />`
  (`app/AppShell.tsx:931`) sits inside QueryClient, Router, AppShellProvider and
  MainInsetProvider, and `/workspace` renders `RunsScreen` under it.
- **Four couplings are per-app, not per-pane** — this is the real work:
  1. Aux-panel state is URL state — `useChannelPanelHistoryState`
     (`ChannelScreen.tsx:135`) writes `?thread=`, `?profile=`, `?agentSession=` onto the
     hosting route. On `/workspace` that is shared by every pane; two team panes would
     share one thread panel.
  2. `useMeasuredCssVariable` writes `--channel-content-top-padding` onto the AppShell main
     inset (`ChannelScreen.tsx:719-724`) — already gated by an `enabled` argument.
  3. `setContextParentResolver` on the single ReadStateManager (`ChannelScreen.tsx:216-227`)
     — last mount wins.
  4. `setVisibleChannel` inside `useChannelSubscription` (`features/messages/hooks.ts:334-340`)
     — genuinely global; the island already flagged it at `useTeamThread.ts:16-21`.
- **Mentions are channel-id driven with no route involvement**, and the team's agents *would*
  appear as candidates: the island's own creation path adds them as channel members with
  `role: "bot"` (`useTeamThread.ts:520` → `channelAgents.ts:107-118`) and they are managed
  agents, so both source (1) and source (3) of `useMentions.ts:241-444` yield them.
- **Today's send attaches no mention tags at all:** `useTeamThread.ts:418-442` calls
  `sendMessage.mutate` without `mentionPubkeys`, so `messageMentionPubkeys`
  (`lib/messageMentionPubkeys.ts:17-24`) contributes none. That is the whole of "the team
  cannot hear you".
- **Rename is reachable with a plain import:** `useUpdateChannelMutation`
  (`features/channels/hooks.ts:340`) → `updateChannel` → kind 9002. The island already
  imports four hooks from that module.
- **The pointer store is the authority for finding a thread**
  (`teamThreadStore.ts`, key `vingilot-team-thread.v1`); the name-matching
  `findThreadChannel` runs **only** when the pointer is missing
  (`useTeamThread.ts:231-234`) and matches on `wt-` + the six-char discriminator.

## Task 1 — Host the real channel surface, exactly

- [ ] The pane becomes a thin host of `ChannelRouteScreen`, scoped to the thread's channel
      id. Delete the custom list and composer (`TeamThreadPane.tsx:356-465`); keep only the
      pane chrome: team picker, the scope sentence, availability states. The scope sentence
      lives in chrome above the hosted surface, not in the message stream.
- [ ] **Make it pane-safe rather than shipping the leaks.** Address the four couplings above,
      in that priority order, each as the smallest change that makes the behaviour
      per-instance: a local-state twin for the aux-panel state (`useChannelPanelHistoryState`
      already returns a plain values+setters object, so a `mode` wrapper is a drop-in), and
      an `enabled`-style gate for the CSS variable and the read-state resolver. For
      `setVisibleChannel`, decide *and state* whether the pane competes for it — do not
      leave it undecided.
- [ ] Anything you change outside `features/runs/**` needs a `vingilot/seams.yaml` entry with
      a real reason; that trade is pre-approved by the original plan's "stop and report with
      the smallest seam you can see". **Do not fork-copy the component into the island** — a
      copy is the reimplementation with extra steps.
- [ ] The scope-context line prepended to outgoing messages (`composeTeamMessage`,
      `teamThread.ts:244-248`) must survive the move — say where it goes now. Honest options:
      keep prepending via a send wrapper (and say so), or move the path wholly into the
      channel description and stop prepending (and say *that*). Pick one, state it in the UI,
      and test that the sentence matches what is actually sent.
- [ ] Escape belongs to whatever is on top: `FocusThreadDrawer.tsx:155` binds a capturing
      window keydown. Confirm a pane-hosted drawer does not swallow Escape for the workspace,
      or scope it.

## Task 2 — Mentions work end to end

- [ ] Typing `@` in the hosted composer offers the channel's members — the deployed team
      agents by their names — exactly as it does in a normal channel. The survey says this
      should follow from Task 1 for free (members are added with `role: "bot"`, and the
      agents are managed): **verify it rather than assume it**, and if the candidate list is
      empty, find out which of the two sources broke rather than seeding a third.
- [ ] A sent mention carries the real mention tags (compare the event against one sent from
      a normal channel — byte-equal tag structure), so `buzz-acp`'s mention filter fires.
      Today's path passes no `mentionPubkeys` at all (`useTeamThread.ts:418-442`); whatever
      send path survives Task 1 must carry them through to `["p", pk]`
      (`features/messages/hooks.ts:514-518`).
- [ ] Playwright over the stubbed relay: the autocomplete opens on `@`, selecting inserts
      the mention, the sent event carries the `p` tag — proved red by breaking the member
      wiring. The real reply round-trip (agent answers in the pane) is the **owner's
      checklist** — it needs a live deployed agent.

## Task 3 — A channel name a human would give it

- [ ] Replace `threadChannelName`'s `wt-<worktree>-<team>-<hash>` with a name that reads in
      a channel list beside hand-made ones: team first, then project, then branch —
      e.g. `welcome-team-talon-main` — with **no hash suffix by default**. The hash was
      collision insurance; buy that honestly instead: check the existing channel list at
      creation and only then append a short discriminator.
- [ ] **Recovery must survive the rename, and today it would not.** `isThreadChannelName`
      matches on `wt-` plus the discriminator (`teamThread.ts:325-334`), so a human name
      silently disables lost-pointer recovery — a failure nothing would notice until the
      pointer is already gone. Move the recovery marker off the name: the discriminator (or
      the binding/team ids outright) belongs in the channel's **description**, which already
      carries the worktree path, or in a tag. Confirm first that the description is present
      on the channel objects `findThreadChannel` reads — **if it is not, say so and keep a
      name-shaped marker rather than shipping a recovery path that cannot work.**
- [ ] **Rename the one that exists.** The owner already has `wt-main-welcome-team-kbz5pz`
      on his relay. Use `useUpdateChannelMutation` (`features/channels/hooks.ts:340` — a
      plain import, no upstream edit) on next open of that thread, and prove the pointer
      still resolves after the rename. Undetermined by the survey and worth checking before
      you rely on it: whether the relay enforces name uniqueness within a community after
      canonicalisation (`src-tauri/src/events.rs:201`) — if it does, a collision must be an
      answered error, not a silent no-op.
- [ ] The worktree path stays in the channel **description** (it is already there); the
      name carries no paths, no `wt-`, no hash unless collision forced it.

## Task 4 — Proof and docs

- [x] Playwright over a real bundle: the pane renders upstream's timeline (assert on an
      upstream-owned testid, not an island one), the composer mentions flow, the naming and
      rename flows — each proved red first. Extended with the two the verifier named and
      nothing guarded: the hosted auxiliary panel never reaching the shared workspace URL,
      and Escape inside a hosted drawer leaving the workspace's own surfaces their keystroke.
- [x] `workbench.md`: the hosting decision (the pane owns chrome, upstream owns the
      conversation) with each per-app coupling and what it cost, the naming scheme and where
      the recovery marker lives now, and the corrected statement of why mentions matter
      (the harness's mention filter).
- [ ] Owner checklist: open the thread, `@`-mention a deployed agent, watch it reply in the
      pane; confirm the channel's new name in the sidebar; confirm the old ugly name is gone.

---

## Global Constraints

- **`rm -rf` forbidden**, any path, including generated scripts and test teardown.
- **Resource budget:** `df -h /System/Volumes/Data` before any build; **stop below 20 GiB**;
  never a release build; never two heavy builds at once; reclaim only with `cargo clean`.
- **Never launch the app or any GUI** — proof is tests and pinned sources; live round-trips
  go on the owner checklist.
- **The owner's tmux sessions live on the default socket** — never touch it. Never kill a
  process you did not start. **Nothing outside this repo.** His relay data is real: never
  delete or hide his channels; the rename in Task 3 is the only sanctioned mutation.
- Never `git add -A`; never amend or rebase. Trailers `Signed-off-by` then
  `Co-authored-by`; `git commit -F`, never `-s`.
- Island-first; any other path needs a `vingilot/seams.yaml` entry with a real reason.
  Task 1's component export is the expected seam on this branch.
- **An empty read is "no answer", never "nothing there."**
- **A test must be able to fail** — prove each new test red by breaking what it guards.
- **Run the suites your change touches**, Playwright included.

## Self-Review

**Riskiest:** Task 1's hosting. Upstream's channel view almost certainly assumes route
context and providers the pane does not have. The failure mode is quietly copying the
component into the island "just to make it work" — which recreates today's defect with more
code. The seam is the honest move; the plan pre-authorises it.

**Most likely to be got wrong quietly:** Task 3's rename. A rename that breaks the pointer,
or a "collision check" that silently reintroduces the hash for every channel, would either
lose him the thread or change nothing he can see. Prove the pointer survives the rename, and
prove a hashless name is what actually gets created in the common case.
