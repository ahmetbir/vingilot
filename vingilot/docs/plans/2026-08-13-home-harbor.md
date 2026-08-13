# Home harbor — Vingilot on one machine, no host to join

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Owner's ask, verbatim:** *"bu vingilot solo makinede çalışabilsin… 'join a community'
> kısmında local'e kur diye bir seçenek olsa, otomatik docker'a kursa, sonra localhost'la
> devam etse."*
> **Queue position:** after v0.2.2.

**What exists and what is missing.** The workspace half already stands alone (projects are
local, the coordinator is optional — the coordinator-optional plan delivered that). What still
demands a host is the *community*: chat, crew, team threads all live on a relay, and the
`WelcomeSetup` screen's only doors are "join" ones. The relay itself is in this repo
(`buzz-relay`) and its stack is known — Postgres 17 + Redis 7 + migrations that self-apply —
which is exactly a compose file. The owner runs docker already and named it as the acceptable
mechanism.

## Task 1 — A relay image with our name on it

- [ ] The fork publishes no relay image, and the inherited `Docker image` workflow fails on
      every push to main — first read WHY it fails (it fires for upstream's ECR; it was on the
      "disable inherited workflows?" list). Replace it with a fork-owned workflow that builds
      `buzz-relay` and pushes `ghcr.io/ahmetbir/vingilot-relay:<tag>` on `vingilot-v*` tags —
      GHCR, because the dmg consumer has no ECR. Reuse upstream's relay Dockerfile if one
      exists; write the smallest one if not.
- [ ] Pin by digest in the compose bundle below; a floating `latest` is how a working install
      changes under someone overnight.

## Task 2 — The harbor bundle

- [ ] A compose file the app ships in its resources (`harbor-compose.yml`): `vingilot-relay`
      (the GHCR image), `postgres:17-alpine`, `redis:7-alpine`, one named volume each,
      loopback-only port bindings (`127.0.0.1:PORT:…` — a home harbor is not a LAN service),
      healthchecks, and a distinct project name (`vingilot-harbor`) so `docker compose ls`
      says whose it is. Ports chosen away from his landscape (5432 is n8n's, 3000 AdGuard's —
      the memory file `user_project_locations` has the map; pick e.g. 7447 for the relay).
- [ ] Secrets: generate the Postgres password on first install, store beside the app's own
      state (`~/.vingilot/harbor.env`), never a default password. Nothing binds beyond
      loopback either way.

## Task 3 — "Run locally" on the welcome screen

- [ ] `WelcomeSetup` gains a third door: **"Run Vingilot locally on this Mac"**. Behind it, a
      Rust command sequence (island module, `vingilot_harbor`):
      1. probe docker (`docker info`, arg vector, honest sentence when absent — with the
         Docker Desktop link, not a silent failure);
      2. write the compose + env into `~/.vingilot/harbor/`;
      3. `docker compose -p vingilot-harbor up -d --wait` (the `--wait` flag is what makes
         "continue" honest — it returns when healthchecks pass);
      4. hand the frontend `ws://127.0.0.1:<port>` and continue through the EXISTING join
         path — the local relay is joined like any community, no parallel onboarding.
- [ ] Progress is stated in steps ("checking Docker… starting the harbor… waiting for it to
      answer…"), each failure its own sentence with the command it ran. No spinner over an
      unbounded wait: `--wait` has a timeout, and hitting it names the container that never
      went healthy.
- [ ] **Lifecycle**: a Settings card ("Home harbor") showing running/stopped, with Stop and
      Start — thin wrappers over compose. Uninstall prints the two commands (compose down,
      volume removal) rather than deleting data itself: the harbor's data is his messages, and
      nothing in this app deletes a database silently.
- [ ] App start with a configured-but-stopped harbor: offer to start it (one click), never
      auto-start docker without being asked once and remembered.

## Task 4 — Honesty about what "local" means

- [ ] The door's copy says it plainly: everything stays on this Mac; the relay listens on
      loopback only; agents and messages never leave the machine. This is the work-machine
      stance as a *feature*, and it must be checkable: the compose file itself is the proof
      (loopback bindings), and the sentence points at it.
- [ ] Standalone limits stated where they bite: no phone pairing to a loopback relay, no
      second machine — each gets one sentence at the surface that would otherwise mislead.

## Global Constraints

The standing set: rm -rf forbidden; never launch the app or docker during agent work (probe
logic is arg-vector `docker info` in tests via a recorder, the vingilot_shim pattern); island +
seams; rem tokens; 1000-line ratchet (lib.rs at 999 — the new module's command registration
needs the split first); empty read is no answer; red proofs; gates to real exit codes;
loopback-only by construction.

## Self-Review

**Riskiest:** the wait-for-healthy step. Docker pulls a relay image on first run — minutes on
slow networks — and a "continue" that fires early lands the app on a socket that refuses. The
`--wait` flag plus stated step progress is the mitigation; the spec must fake both the slow
path and the never-healthy path.

**Most likely to be got wrong quietly:** a second onboarding path. The local relay must be
*joined through the existing community machinery* once it answers — a parallel "local mode"
codepath is how every future community feature forks in two.
