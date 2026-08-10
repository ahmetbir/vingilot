# An agent can reply whatever its shell does to the environment

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Branch:** `vingilot/agent-credentials` off `vingilot/ship-it`.

**Goal:** The owner's Hermes and Kimi agents cannot answer him. Every reply dies the same way:

```
buzz messages send --channel … --content "…"
{"error":"auth_error","message":"auth error: BUZZ_PRIVATE_KEY is required"}   exit 3
```

**The cause, established from his logs and this codebase — not guessed:**

- An agent replies by shelling out to `buzz messages send`; that is what the harness's base
  prompt instructs (`crates/buzz-acp/src/base_prompt.md`), and the CLI reads its key from the
  environment.
- The harness *does* put `BUZZ_PRIVATE_KEY` in the agent process's environment
  (`desktop/src-tauri/src/managed_agents/runtime.rs:580`, inherited by the agent it spawns).
- **Claude Code and Goose work because their shell tools pass that environment to the child.**
  Neither has an MCP server (`mcp_command: None` for both) — MCP was never the discriminator.
- **Hermes and Kimi run tool commands in a sanitised environment.** His log proves it: with the
  agent running, its own shell reported `BUZZ_PRIVATE_KEY`, `BUZZ_RELAY_URL` and
  `BUZZ_AUTH_TAG` all empty. That is a sandbox feature of those harnesses, and nothing set
  outside them survives it — he set the variables and restarted, and it changed nothing.
- Hermes also has **no MCP tools at all** and looks for MCP servers in its own
  `~/.hermes/config.yaml`, not in `session/new` — so the session-MCP path added in `fbbb41a58`
  cannot reach it either.

Buzz already hit this wall once, with Codex, and answered it with a special case: Codex alone
is handed `buzz-dev-mcp` with the key injected into the MCP server's own environment. The
special case was never generalised, so every later harness with a sandboxed shell inherits the
same dead end.

**The decision, made 2026-08-10:** stop requiring the secret to survive the agent's shell.
The harness already holds the key and is already connected to the relay, so a CLI that finds
no key asks the harness to act for it over a local socket. **The key never leaves the harness
process.** An agent's shell may strip whatever it likes; nothing secret has to get through.

Rejected, and why, so nobody re-proposes them:

- **A key file under `~/.buzz`** (mode 0600) would work today and is how ssh keys live. It is
  declined because it undoes a decision this system deliberately made: the key is kept out of
  the agent's reach, and a file the agent can read hands it back. The owner chose the broker
  over this after being told both.
- **Putting `buzz-dev-mcp` in Hermes' own config** would mean writing the key into a plaintext
  config file, and would fix one harness rather than the class.
- **Telling agents to use `--private-key`** is what the error message currently suggests, and
  it is how a key ends up in `ps` output and in a transcript. One of his agents already did
  exactly that, with a public key, because the system nudged it there.

**Scope warning, stated up front:** this touches `crates/`, which the fork has never modified —
`crates/`, `migrations/`, `web/` and `mobile/` are at zero diff against upstream today. After
this branch the fork carries upstream crate changes, with the merge cost that implies. It is
the right place for the fix and it is not a free choice.

---

## Task 1 — The broker, on the harness side

- [ ] **Read first, report before building:** how `buzz-acp` already sends a message on the
      agent's behalf (it holds the key, authenticates NIP-42, and publishes), and what the
      `buzz messages send` path does end to end. The broker must reuse that, not reimplement
      signing.
- [ ] A local endpoint the harness serves for the agent it spawned: a unix domain socket, its
      path passed to the agent in an env var. **A socket, not a port** — a TCP port on
      localhost is reachable by every process on the machine and by anything the owner is
      running; a socket file is subject to filesystem permissions.
- [ ] 0600, in a directory only the owner can traverse, removed when the harness exits. Say
      what happens to a stale socket file from a crashed harness.
- [ ] The narrowest possible surface. It exists so an agent can send a message as itself: it
      does not hand out the key, does not sign arbitrary bytes, and does not proxy the relay.
      Anything it will not do must be refused explicitly rather than by omission.
- [ ] **The socket path is not a secret and must not be treated as one.** Its protection is
      filesystem permissions, so nothing may relax them "for convenience".
- [ ] Tests, red-proved: what it accepts, what it refuses, and that it never returns key
      material on any path.

## Task 2 — The CLI asks, when it has nothing else

- [ ] `buzz` resolves its identity in this order: an explicit `--private-key`, then
      `BUZZ_PRIVATE_KEY`, then the broker. Existing behaviour is unchanged when a key is
      present — this only replaces the failure.
- [ ] Only `messages send` (and whatever else the broker genuinely covers) can be brokered.
      Every other subcommand that needs a key and has none must fail exactly as it does now,
      with the same exit code, rather than half-working.
- [ ] **The error message must stop teaching the wrong lesson.** Today it says
      *"BUZZ_PRIVATE_KEY is required (use --private-key or set env var)"* — an instruction to
      put a secret on a command line, which is where `ps` and every transcript can read it.
      Rewrite it: say the key was not found, say the broker was not reachable either, and do
      not suggest `--private-key`.
- [ ] Tests, red-proved, including the order of resolution and the case where the broker is
      absent.

## Task 3 — The agent is told, and the docs stop lying

- [ ] `base_prompt.md` currently says *"Auth env vars: BUZZ_RELAY_URL, BUZZ_PRIVATE_KEY…"*,
      which is what makes an agent read `auth_error` as *I have no credentials* and stop.
      It must describe what is now true: replying works, and the agent does not handle a key.
- [ ] The `[Tools]` note added in `fbbb41a58` names an MCP shell for agents that were given
      one. Reconcile the two paths so an agent is told one coherent thing, not two competing
      ones — and say which you kept.
- [ ] `workbench.md`: what holds the key, what never does, and why a sandboxed shell is now a
      non-event.

## Task 4 — Proof

- [ ] The case that actually failed, as a test: an agent whose shell carries **no** Buzz
      environment sends a message and it lands. Proved red first.
- [ ] Say plainly what still cannot be verified here — the real proof is Hermes replying on
      his machine — and what he should look for.

---

## Global Constraints

- **`rm -rf` forbidden**, any path, including test teardown.
- **Never launch the app or any GUI**; **do not run a release build** — the owner asks for a
  `.dmg` when he wants one.
- **The private key is the subject of this task and must never be its casualty:** never write
  it to a file, a log, a command line, an error message, or a test fixture that could be
  mistaken for real. Never print it, even truncated.
- **The owner is using this app for real work on two machines.** Never touch the default tmux
  socket, never kill a process you did not start, **nothing outside this repo.**
- Never `git add -A`; never amend, rebase, or force-push. Trailers `Signed-off-by` then
  `Co-authored-by`; `git commit -F`, never `-s`.
- `crates/**` needs `vingilot/seams.yaml` entries — this is the fork's first crate change, so
  the reason must say what it covers and what it does not.
- **An empty read is "no answer", never "nothing there."**
- **A test must be able to fail** — prove each new test red by breaking what it guards.

## Self-Review

**Riskiest:** the broker's surface. It is a local endpoint that acts with the agent's identity,
so every capability it grows is a capability anything running as the owner inherits. The
temptation will be to make it general — "sign this", "publish that" — because that is less code
than a narrow send. A general broker is a key-equivalent with extra steps, and the whole point
of choosing it over a key file was that it is *not* one.

**Most likely to be got wrong quietly:** the resolution order in Task 2. If the broker is
consulted before the environment, an agent that *does* have a key stops using it, and every
existing working setup silently changes its behaviour — including the ones that work today.
