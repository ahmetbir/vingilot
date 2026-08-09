# The assistant

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Branch:** `vingilot/assistant` off `vingilot/dashboards`.

**Goal:** The owner asked on 2026-08-09 for a global assistant: *"beni tanıyan, kendi başına
her türlü toolu olan, öğrenen, her şeyi gören... The Machine, Jarvis tadında"* — with access
to *"hem buzz'daki her şeye, hem de talimat verilirse bilgisayarda her yere"*, and on identity:
*"en iyi kimlik nasıl olursa öyle yapalım."*

## The identity decision (survey-backed, 2026-08-09)

**The assistant is a managed agent, deployed locally, conversed with over an owner-only DM.**
Not a new runtime, not the ask path grown a memory. The survey
(`vingilot/docs/plans/` sibling work, findings verified in-repo) established that upstream
already runs the thing we would otherwise build:

- A deployed managed agent is **alive**: `buzz-acp` (bundled sidecar) holds a NIP-42-authed
  WebSocket to the relay *as the agent's own pubkey*, keeps per-channel ACP sessions open
  across turns (`crates/buzz-acp/src/pool.rs:82-106`), and drives a real LLM subprocess with
  real tools. The fork's ask path is one-shot and amnesiac **by design**
  (`vingilot_agent/client.rs:481-492`, `buzz-agent/README.md:338`) — wrong substrate.
- **Memory exists and closes the loop**: NIP-AE engrams, kind 30174, NIP-44-encrypted
  agent→owner with blinded d-tags (`crates/buzz-core/src/engram.rs`). The agent writes with
  `buzz mem set/patch`, the harness reads core memory into every new session
  (`crates/buzz-acp/src/engram_fetch.rs`) — and is careful to never mistake a relay outage
  for "no memory". *"Öğrenen"* is this, already built.
- **The DM is hardened for exactly this shape**: inside a DM only the owner and verified
  same-owner siblings are admitted — respond-to-anyone modes do not apply, unknown channel
  types fail closed (`crates/buzz-acp/src/lib.rs:224-282`). An agent can open the DM itself:
  `buzz dms open --pubkey <owner>` (`crates/buzz-cli/src/commands/dms.rs:51-93`).
- Words in the channel are signed by the agent's key — the identity argument from the
  team-thread plan holds with no forged authorship.

**Two honest caveats, carried into the UI, not hidden:**
1. **DM bodies are plaintext on the relay** — protection is relay ACL, not E2E
   (`commands/messages.rs` has zero nip44/encrypt hits; gift-wrap kind 1059 is accepted by
   the relay but nothing produces it). The owner operates his own relay, so this is a
   *disclosed* trade, and the gift-wrap producer is named v2 work, not silently skipped.
2. **The harness lives and dies with the desktop app** (SIGTERM on exit, lazy respawn on
   relaunch, no supervisor for a mid-run crash). Jarvis is home when the house is — v1 says
   so on the surface rather than pretending otherwise.

## The two rings (trust boundary — this is Task 1's ADR)

The owner's own formulation, made structural:

- **Buzz ring, always on:** the relay conversation, its engram memory, the `buzz` CLI, and
  read access to the workspace's observable state (Task 4). This is "her şeyi gören".
- **Machine ring, instruction-gated:** the ACP subprocess has real tools and the worktree
  rule already says the cwd is "a starting directory, not a jail" (ADR-003). For a persistent
  assistant this is a different proposition than a one-shot ask, and the plan does not bluff
  about it: **instructions are policy, not enforcement.** v1 draws the line with (a) a
  dedicated home directory as cwd — never a repo checkout, (b) ring rules written into the
  system prompt and the persona ("act outside your home only on explicit instruction in the
  conversation; repo rules — no rm -rf, nothing destructive unasked — bind you everywhere"),
  and (c) the grant trail surfaced, since every ACP permission grant is already written into
  the trace. Real sandboxing is future work and the ADR says so in one honest sentence.

---

## Task 1 — ADR-004: the assistant's identity and trust boundary

- [ ] Write `vingilot/docs/adr/ADR-004-the-assistant.md`: the identity decision above (managed
      agent + owner DM), the two rings, the two caveats, and the rejected alternatives with
      one-line reasons (ask-path-grown-a-memory: amnesiac by design, wrong lifecycle;
      new bespoke runtime: rebuilding `buzz-acp` worse; relay-less local chat: loses signed
      authorship, memory, and the DM hardening for free).
- [ ] The ADR names what is deliberately NOT promised in v1: E2E DM encryption, crash
      supervision, enforcement-grade sandboxing.

## Task 2 — The assistant exists: creation, once

- [ ] **Read first, report before building:** the exact create+deploy flow upstream already
      has (agents screen, `commands/agents.rs` create → deploy with `spawn_after_create`,
      `Local` backend), and the runtime discovery order (`managed_agents/discovery.rs:696-757`).
      If creating + deploying an agent needs zero island code, the deliverable is a documented
      flow plus whatever seeding below requires — do not rebuild upstream UI.
- [ ] **Runtime choice:** probe what discovery finds on this machine. `buzz-agent` ships with
      the app (zero install) and is the v1 default. If `claude-agent-acp` is what the owner
      wants (better model, his Claude auth), its install is **outside the repo — report it as
      an owner decision, never install it yourself.**
- [ ] **The persona:** an "Assistant" persona seeded with: role, the two rings verbatim, the
      owner's non-negotiables (no `rm -rf` anywhere, nothing destructive unasked, secrets are
      never read into output), and memory discipline — write what you learn about the owner
      to engrams (`buzz mem set`), core memory is who he is, not a log. **No personal facts
      in the repo:** the persona teaches the assistant to *build* its knowledge of the owner
      in encrypted engrams; it does not hardcode any.
- [ ] **The home:** a dedicated assistant working directory (under app data, not a repo).
      Created on deploy, stated in the persona, used as cwd.
- [ ] Deployed against the relay the app is connected to; the DM opened owner↔assistant
      (reuse upstream's open_dm; the agent-initiated `buzz dms open` path is the fallback).

## Task 3 — The surface: the assistant from anywhere

- [ ] A global chord + palette action ("assistant") that opens the conversation from any
      screen — and a pane on the registry so it can sit beside work in the split, like the
      team thread does. **Read `useTeamThread.ts` first** — this pane is its sibling with two
      differences: DM instead of channel, global instead of worktree-scoped. Reuse upstream's
      DM send/subscribe hooks; do not invent a messaging path.
- [ ] Unread state visible wherever the chord works (the pane knows; the status bar or nav
      shows a quiet mark). No notification spam — the dashboards branch owns OS notifications;
      this branch exposes the signal it can derive.
- [ ] Availability answered honestly, each its own sentence: not created yet (offer the
      create flow), created but not running (say the app just restarted it lazily — first
      message wakes it), relay unreachable, runtime binary missing (name the discovery
      result). "Could not reach" is never rendered as "no".
- [ ] The surface carries the two caveats in its empty/first-run state, one line each:
      plaintext-on-relay, lives-with-the-app.

## Task 4 — Eyes: what the assistant can see of the workspace

The conversation lives on the relay, so the assistant already sees Buzz. The island's state
(worktrees, diffs, attention) is local — it becomes visible the same way everything else
reaches these agents: **as a tool, not as injected context.**

- [ ] A skill teaching the assistant to read the workspace: the coordinator's read API at
      `127.0.0.1:7117` (runs, worktrees, revisions) and `git` against paths the conversation
      names. Delivered the way skills already are (the `nest.rs` convention — extend that
      seam; it already writes the buzz-cli skill to the shared skills dir, version-gated).
- [ ] **Say what is sent, enumerate what is not** — the ask-mode honesty rule, applied here:
      opening the assistant beside a worktree sends, at most, one line naming the worktree
      path — and the surface states exactly that. The assistant reads what it opens itself.
- [ ] The skill states the rings again from the tool side: coordinator and named paths are
      the Buzz ring; anything else on the machine is instruction-gated.

## Task 5 — Proof and docs

- [ ] Tests: the pure surface model (availability states, unread derivation, what-is-sent
      sentence) proved red-first; a live test that creating the persona seeds exactly the
      documented instruction blocks; Playwright over a real bundle for the pane and palette
      action with a stubbed relay.
- [ ] `workbench.md`: the assistant's place among the agent surfaces — ask (one-shot,
      keyless, worktree), team thread (channel, per-worktree), assistant (DM, global,
      persistent, own key + memory) — so the *three* stores/paths read as designed, not grown.
- [ ] Owner checklist: the real conversation — deploy, first DM, an instruction that touches
      the machine ring, an app restart followed by "what do you remember?" — is his to run;
      list the exact steps.

---

## Global Constraints

- **`rm -rf` forbidden**, any path, including generated scripts and test teardown.
- **Resource budget:** `df -h /System/Volumes/Data` before any build; **stop below 20 GiB**;
  never a release build; never two heavy builds at once; reclaim only with `cargo clean`.
- **Never launch the app or any GUI**; proof is tests and pinned sources; the real
  conversation is the owner's checklist item.
- **The owner's tmux sessions live on the default socket** — never touch it. Never kill a
  process you did not start. **Nothing outside this repo without the owner's explicit OK** —
  that includes installing ACP runtimes and creating the assistant's home directory (app-data
  paths are created by the app at runtime, not by you at build time).
- Never `git add -A`; never amend or rebase. Trailers `Signed-off-by` then `Co-authored-by`;
  `git commit -F`, never `-s`.
- Island-first; any other path needs a `vingilot/seams.yaml` entry with a real reason. The
  expected seams on this branch: `nest.rs` (skill delivery) and whatever DM hook reuse needs.
- **An empty read is "no answer", never "nothing there."**
- **A test must be able to fail** — prove each new test red by breaking what it guards.
- **Run the suites your change touches**, Playwright included.

## Self-Review

**Riskiest:** the machine ring. A persistent agent with shell tools and auto-approved
permission requests is a real capability on the owner's real machine. The plan's answer is
honesty plus structure (dedicated home, rings in the prompt, grant trail surfaced) — not a
claim of enforcement that the code cannot back. If an implementer finds themselves writing
"the assistant cannot..." about something instructions merely discourage, that sentence is a
lie; write "the assistant is told not to" and keep the trail visible.

**Most likely to be got wrong quietly:** Task 2 rebuilding upstream. The create/deploy/DM
machinery exists end to end; the value here is the persona, the home, the surface, and the
skill. An implementer who ships a second agent-creation UI has built the wrong thing —
the read-first step exists to make that visible before code is written.
