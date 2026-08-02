# Local development — the Vingilot checkout

This checkout runs a **fully isolated** dev stack so it never collides with
anything else on the machine. Two neighbours matter: the old buzz checkout
(`~/self-hosted/buzz`) whose docker stack may be running, and unrelated
services that own default ports (a Postgres on 5432, an ad-blocker on 3000).

`.env` is gitignored, so the *mechanism* is recorded here; the *values* live
only in your `.env`.

## Port map

| Service | Vingilot | Why not the default |
|---|---|---|
| Postgres | **5435** | 5432 = unrelated Postgres, 5434 = buzz checkout |
| Redis | **6380** | 6379 = buzz checkout |
| Relay (`BUZZ_BIND_ADDR`, `RELAY_URL`) | **3002** | 3000 = other service, 3001 = buzz checkout |
| Relay health (`BUZZ_HEALTH_PORT`) | **8085** | 8080 was taken, 8081 = buzz checkout |
| Relay metrics (`BUZZ_METRICS_PORT`) | **9103** | 9102 is the compiled default — both checkouts would fight over it |
| MinIO (`BUZZ_S3_ENDPOINT`) | **9002/9003** | 9000/9001 = buzz checkout |
| Adminer | 8084 | 8082 = buzz checkout |
| Keycloak | 8181 | 8180 = buzz checkout |
| Prometheus | 9091 | 9090 default |

## Docker isolation

Upstream's `docker-compose.yml` hardcodes `name: buzz`, `container_name:
buzz-*`, and the volume names — so two checkouts sharing it would fight over
one stack. We do not edit that file (ADR-001 §6). Instead the justfile runs
bare `docker compose`, which honours these `.env` variables:

```
COMPOSE_PROJECT_NAME=vingilot
COMPOSE_FILE=docker-compose.yml:vingilot/compose.local.yml
COMPOSE_PATH_SEPARATOR=:
```

[`vingilot/compose.local.yml`](../compose.local.yml) overrides container
names, published ports (`!override` — compose *merges* port lists by default,
which would publish both old and new), and redirects the volume **names**
under upstream's existing volume keys, so this checkout writes to
`vingilot-postgres-data` / `vingilot-minio-data` and the buzz checkout's data
is never touched.

Result: `docker compose config` renders project `vingilot`, containers
`vingilot-*`, and the remapped ports, with zero upstream diff.

## Keychain (macOS): stop the per-rebuild password prompt

Two separate problems, two fixes:

1. **Both checkouts shared one dev identity.** Debug builds default to the
   keyring service `buzz-desktop-dev`. Set in `.env`:

   ```
   BUZZ_DEV_KEYRING_SERVICE=buzz-desktop-dev.vingilot
   ```

   This is upstream's own escape hatch (`app_state_keyring.rs`) for scoped dev
   services — Vingilot gets its own keychain namespace.

2. **macOS re-prompts after every rebuild.** Debug binaries are ad-hoc signed;
   every compile produces a new signature, keychain ACLs bind to the
   signature, so each rebuild looks like a new app and "Always Allow" only
   lasts until the next build. After creating your identity in the app, run
   **once**:

   ```bash
   ./vingilot/scripts/dev-keychain-allow.sh
   ```

   It re-creates the dev items with the any-application ACL. Trade-off, stated
   plainly: any local app can then read that **dev** key. Acceptable for a
   local identity on a local relay; the script refuses to touch the production
   service (`buzz-desktop`).

## Daily flow

```bash
just relay   # relay on ws://localhost:3002
just dev     # relay + desktop app
```

The Rust binaries load `.env` themselves — no manual sourcing. If `just dev`
refuses with "relay port 3002 is already in use", something else already runs
the relay (often a leftover terminal); kill it rather than working around the
check.
