//! The bundle: the compose file the harbor is, and the secrets it needs
//! (vingilot/docs/plans/2026-08-13-home-harbor.md, Task 2).
//!
//! **The compose file is a string constant here rather than a bundled
//! resource.** The plan said "a compose file the app ships in its resources",
//! and `tauri.conf.json` has no `resources` key at all — adding one means a
//! second mechanism (`BaseDirectory::Resource`), a path that differs between a
//! `cargo test`, a `pnpm tauri dev` and a signed `.dmg`, and a file that a
//! `cargo test` cannot see. `vingilot_shim`'s `SHIM_SCRIPT` already ships bytes
//! this way in this very crate, for the same reason: a constant is in the
//! binary, is identical in every build, and can be asserted about in a unit
//! test. What it costs is that the YAML is not syntax-highlighted while being
//! written, which is a cost to the author and not to the owner.
//!
//! **Nothing here is ever overwritten.** [`ensure`] writes each of the two
//! files only when it is absent. The harbor's `harbor.env` holds the only copy
//! of the password its Postgres volume was initialised with, so rewriting it
//! would lock the owner out of his own messages; and the compose file is
//! something he is invited to read and may well have edited. When the shipped
//! compose file and the one on disk have drifted, [`compose_is_shipped`] says
//! so and the surface can tell him — which is a different act from changing his
//! file for him.
//!
//! **The secrets are generated once, from the OS CSPRNG, and are never
//! logged.** [`HarborSecrets`] has no `Debug` implementation on purpose: a
//! `{:?}` on it does not compile, which is a stronger promise than a comment
//! asking future edits not to print it. There is no default password anywhere
//! in this file — a harbor that could not get entropy fails to install rather
//! than installing something guessable.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// The relay image the harbor pulls.
///
/// **One line, deliberately.** The tag is what the fork's own publisher
/// (`.github/workflows/vingilot-relay-image.yml`) pushes; the moment that
/// workflow has run once, this line becomes
/// `ghcr.io/ahmetbir/vingilot-relay@sha256:…`, the digest printed in its run
/// summary. A floating tag is how a working install changes under somebody
/// overnight, which the plan names as the thing to avoid — so this is the one
/// line to edit, and there is exactly one of it.
pub(crate) const RELAY_IMAGE: &str = "ghcr.io/ahmetbir/vingilot-relay@sha256:8a2b2207d3f7ec9053747b2ca6aefdb93d350390b06beb52c980be7a24fd4c37";

/// Where `RELAY_IMAGE` goes in [`COMPOSE_TEMPLATE`].
///
/// A placeholder rather than `format!`, because the YAML is full of `${…}`
/// compose interpolation and every brace in it would otherwise have to be
/// doubled — turning a file the owner is meant to read into one nobody can.
const IMAGE_PLACEHOLDER: &str = "__VINGILOT_RELAY_IMAGE__";

/// The one thing the desktop dials. Spelled here as well as in the YAML because
/// the two must agree byte for byte: see the `RELAY_URL` comment in the
/// template for what happens when they do not.
pub(crate) const RELAY_URL: &str = "ws://127.0.0.1:7447";

/// The harbor, as compose sees it. See [`compose_yml`] for the assembled form.
const COMPOSE_TEMPLATE: &str = r#"# The Vingilot home harbor: a whole community on one machine, listening on
# loopback and nowhere else.
#
# Written by Vingilot (desktop/src-tauri/src/vingilot_harbor) the first time the
# harbor was installed, and never overwritten since — an edit you make here
# survives, and Vingilot will tell you when its own copy has moved on rather
# than replace yours.
#
# The claim "nothing leaves this Mac" is checkable in this file, and what proves
# it is an absence: the relay publishes exactly one port and binds it to
# 127.0.0.1, and postgres and redis publish NO host port at all. They are
# reachable only over this file's own bridge network, from the container beside
# them.
name: vingilot-harbor

services:
  vingilot-relay:
    image: __VINGILOT_RELAY_IMAGE__
    environment:
      # Byte-identical to the URL the app dials, scheme included, and this is
      # the single most load-bearing line in the file. The relay refuses the
      # WebSocket upgrade with a bare 404 for any Host it has no community row
      # for, and the only row it seeds at startup is this URL's authority — and
      # it does not treat `localhost` and `127.0.0.1` as the same host. A
      # `wss://` spelling would also make NIP-42 expect a `wss://` relay tag
      # from an app that signs `ws://`, which fails on AUTH as a relay-URL
      # mismatch. Either mistake looks like "the relay is up but the app will
      # not connect".
      RELAY_URL: ws://127.0.0.1:7447
      BUZZ_BIND_ADDR: 0.0.0.0:3000
      BUZZ_HEALTH_PORT: "8080"
      BUZZ_METRICS_PORT: "9102"
      DATABASE_URL: postgres://vingilot:${VINGILOT_HARBOR_POSTGRES_PASSWORD:?harbor.env is missing, unreadable, or was not passed with --env-file}@postgres:5432/vingilot
      REDIS_URL: redis://:${VINGILOT_HARBOR_REDIS_PASSWORD:?harbor.env is missing, unreadable, or was not passed with --env-file}@redis:6379
      # Migrations are opt-in and default OFF. Without this the relay boots
      # against an empty database and then fails every single query.
      BUZZ_AUTO_MIGRATE: "true"
      # A stable relay key, so the addressable events this relay signs still
      # replace their older selves after a restart. Without it the relay mints
      # an ephemeral one and yesterday's channel metadata becomes unverifiable.
      BUZZ_RELAY_PRIVATE_KEY: ${VINGILOT_HARBOR_RELAY_PRIVATE_KEY:?harbor.env is missing, unreadable, or was not passed with --env-file}
      BUZZ_GIT_HOOK_HMAC_SECRET: ${VINGILOT_HARBOR_GIT_HOOK_HMAC_SECRET:?harbor.env is missing, unreadable, or was not passed with --env-file}
      BUZZ_GIT_REPO_PATH: /data/git
      # There is no MinIO in the harbor — three containers, not five. This probe
      # races conditional writes against an S3 backend at boot and is FATAL when
      # it fails, so with no object store it has to be off. The cost is stated
      # rather than hidden: repositories and media uploads do not work in a
      # harbor, and the Home harbor settings card says exactly that.
      BUZZ_GIT_CONFORMANCE_PROBE: "false"
      # Open signup, which is what one person on one machine wants: no invite
      # code, no owner bootstrap, no allowlist. NIP-42 alone grants full scope.
      BUZZ_REQUIRE_AUTH_TOKEN: "false"
      BUZZ_REQUIRE_RELAY_MEMBERSHIP: "false"
      BUZZ_ALLOW_NIP_OA_AUTH: "false"
      RUST_LOG: buzz_relay=info,buzz_db=warn,buzz_auth=info
    ports:
      # Loopback only, and 7447 because this machine already has something on
      # 3000 and something on 5432.
      - "127.0.0.1:7447:3000"
    volumes:
      - git-data:/data/git
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      # curl is in the relay image, and /_readiness is the relay's own answer to
      # "am I serving". This is what `up --wait` waits for.
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:8080/_readiness"]
      interval: 5s
      timeout: 3s
      retries: 24
      start_period: 20s
    restart: unless-stopped
    networks:
      - harbor-net

  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: vingilot
      POSTGRES_USER: vingilot
      POSTGRES_PASSWORD: ${VINGILOT_HARBOR_POSTGRES_PASSWORD:?harbor.env is missing, unreadable, or was not passed with --env-file}
      PGDATA: /var/lib/postgresql/data/pgdata
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vingilot -d vingilot"]
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 10s
    restart: unless-stopped
    networks:
      - harbor-net

  redis:
    image: redis:7-alpine
    command:
      - redis-server
      - --appendonly
      - "yes"
      - --requirepass
      - ${VINGILOT_HARBOR_REDIS_PASSWORD:?harbor.env is missing, unreadable, or was not passed with --env-file}
    environment:
      REDIS_PASSWORD: ${VINGILOT_HARBOR_REDIS_PASSWORD:?harbor.env is missing, unreadable, or was not passed with --env-file}
    volumes:
      - redis-data:/data
    healthcheck:
      # $$ so the container's own shell expands it and compose does not: the
      # password stays out of the command line `docker inspect` prints.
      test: ["CMD-SHELL", "redis-cli -a \"$${REDIS_PASSWORD}\" ping | grep -q PONG"]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 5s
    restart: unless-stopped
    networks:
      - harbor-net

volumes:
  postgres-data:
  redis-data:
  git-data:

networks:
  harbor-net:
    driver: bridge
"#;

/// The compose file, with the image line filled in.
pub(crate) fn compose_yml() -> String {
    COMPOSE_TEMPLATE.replace(IMAGE_PLACEHOLDER, RELAY_IMAGE)
}

/// Where the harbor keeps its two files.
///
/// The env file is a sibling of `~/.vingilot/harbor/` rather than a child of it
/// because the plan names that path (`~/.vingilot/harbor.env`) and because the
/// directory is the part the owner is invited to look inside; the secrets are
/// not in there with the file he is invited to read.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct HarborPaths {
    pub(crate) root: PathBuf,
    pub(crate) compose: PathBuf,
    pub(crate) env: PathBuf,
}

/// The directory the workspace already keeps its own state in — the same
/// `~/.vingilot` that holds `projects.json` and the worktree root.
const STATE_DIR: &str = ".vingilot";

/// The harbor's paths under `home`.
pub(crate) fn paths_in(home: &Path) -> HarborPaths {
    let state = home.join(STATE_DIR);
    let root = state.join("harbor");
    HarborPaths {
        compose: root.join("harbor-compose.yml"),
        env: state.join("harbor.env"),
        root,
    }
}

/// The four secrets a harbor needs.
///
/// **No `Debug`, no `Serialize`, no `Display`.** Not by omission — by decision.
/// The only way these values are allowed to leave this process is inside a
/// 0600 file, and the way to keep a future edit from printing one into a log
/// line is to make printing it fail to compile.
pub(crate) struct HarborSecrets {
    postgres_password: String,
    redis_password: String,
    relay_private_key: String,
    git_hook_hmac_secret: String,
}

/// The alphabet a generated password is drawn from.
///
/// **Alphanumeric only**, which is not squeamishness: two of these values are
/// interpolated into a `postgres://user:pass@host` URL and one into a compose
/// shell command, and a password containing `@`, `:`, `/` or `#` would be a
/// silent connection failure the day it happened to be generated. 62 symbols
/// over 32 characters is ~190 bits, so nothing is lost by the restriction.
const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/// How long a generated password is.
const PASSWORD_LENGTH: usize = 32;

/// `length` alphanumeric characters from the OS CSPRNG.
///
/// **Rejection sampling, not `% 62`.** The modulo would make the first four
/// letters of the alphabet very slightly more likely than the rest; the bias is
/// tiny and the fix is three lines, so there is no argument for carrying it.
/// Each draw takes one byte and discards the ones at or above the largest
/// multiple of 62 that fits in a byte (248), so the loop rejects under 4% of
/// bytes and cannot spin.
pub(crate) fn random_password(length: usize) -> Result<String, String> {
    let ceiling = 256 - (256 % ALPHABET.len());
    let mut out = String::with_capacity(length);
    let mut buffer = [0u8; 64];
    while out.len() < length {
        getrandom::getrandom(&mut buffer)
            .map_err(|error| format!("no OS entropy for the harbor's secrets: {error}"))?;
        for byte in buffer {
            if out.len() == length {
                break;
            }
            if usize::from(byte) < ceiling {
                out.push(char::from(ALPHABET[usize::from(byte) % ALPHABET.len()]));
            }
        }
    }
    Ok(out)
}

/// 32 bytes of OS entropy, hex — the shape both the relay's private key and its
/// git-hook HMAC secret are read as.
fn random_hex_32() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|error| format!("no OS entropy for the harbor's secrets: {error}"))?;
    Ok(hex::encode(bytes))
}

/// Four fresh secrets. Called once per machine, by [`ensure`].
pub(crate) fn generate_secrets() -> Result<HarborSecrets, String> {
    Ok(HarborSecrets {
        postgres_password: random_password(PASSWORD_LENGTH)?,
        redis_password: random_password(PASSWORD_LENGTH)?,
        relay_private_key: random_hex_32()?,
        git_hook_hmac_secret: random_hex_32()?,
    })
}

/// The variable names `harbor-compose.yml` interpolates. Spelled once, so the
/// env file and the YAML cannot drift apart without a test noticing.
pub(crate) const ENV_KEYS: [&str; 4] = [
    "VINGILOT_HARBOR_POSTGRES_PASSWORD",
    "VINGILOT_HARBOR_REDIS_PASSWORD",
    "VINGILOT_HARBOR_RELAY_PRIVATE_KEY",
    "VINGILOT_HARBOR_GIT_HOOK_HMAC_SECRET",
];

/// The bytes of `harbor.env`.
pub(crate) fn env_file_body(secrets: &HarborSecrets) -> String {
    format!(
        "# Vingilot home harbor — generated once, on this machine, and never rewritten.\n\
         #\n\
         # This file is the ONLY copy of the password the harbor's Postgres volume\n\
         # was initialised with. Vingilot will not overwrite it, because doing so\n\
         # would lock you out of your own messages. Keep it, back it up, and do not\n\
         # paste it anywhere.\n\
         #\n\
         # Read by every `docker compose` call Vingilot makes, as --env-file.\n\
         {}={}\n\
         {}={}\n\
         {}={}\n\
         {}={}\n",
        ENV_KEYS[0],
        secrets.postgres_password,
        ENV_KEYS[1],
        secrets.redis_password,
        ENV_KEYS[2],
        secrets.relay_private_key,
        ENV_KEYS[3],
        secrets.git_hook_hmac_secret,
    )
}

/// What [`ensure`] did to one file.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Wrote {
    /// It was not there, and now it is.
    Created,
    /// It was already there and was left exactly as it was.
    Kept,
}

/// What [`ensure`] did.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct BundleWrite {
    pub(crate) compose: Wrote,
    pub(crate) env: Wrote,
}

impl BundleWrite {
    /// One sentence for the install's second step.
    pub(crate) fn sentence(&self, paths: &HarborPaths) -> String {
        match (self.compose, self.env) {
            (Wrote::Created, Wrote::Created) => format!(
                "wrote {} and generated four secrets into {} (0600, never logged, never rewritten)",
                paths.compose.display(),
                paths.env.display()
            ),
            (Wrote::Created, Wrote::Kept) => format!(
                "wrote {}; {} was already there and was left alone",
                paths.compose.display(),
                paths.env.display()
            ),
            (Wrote::Kept, Wrote::Created) => format!(
                "generated four secrets into {}; {} was already there and was left alone",
                paths.env.display(),
                paths.compose.display()
            ),
            (Wrote::Kept, Wrote::Kept) => format!(
                "the harbor was already installed at {} — nothing was written",
                paths.root.display()
            ),
        }
    }
}

/// Open `path` for writing, refusing to touch an existing file, and — where the
/// OS has a notion of it — readable by this user alone.
///
/// `create_new` rather than "check then write": the check-then-write version has
/// a window in which two installs both decide the file is missing, and one of
/// them writes a password the other's Postgres volume was not initialised with.
fn create_private(path: &Path) -> std::io::Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

/// Write `contents` to `path` unless something is already there.
fn write_if_absent(path: &Path, contents: &str) -> Result<Wrote, String> {
    match create_private(path) {
        Ok(mut file) => file
            .write_all(contents.as_bytes())
            .map(|()| Wrote::Created)
            .map_err(|error| format!("could not write {}: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(Wrote::Kept),
        Err(error) => Err(format!("could not create {}: {error}", path.display())),
    }
}

/// Put the bundle on disk, writing only what is missing.
///
/// The secrets are generated *after* the compose file lands and only when the
/// env file is absent, so a machine that already has a harbor never asks the OS
/// for entropy it is going to throw away.
pub(crate) fn ensure(paths: &HarborPaths) -> Result<BundleWrite, String> {
    if let Err(error) = fs::create_dir_all(&paths.root) {
        return Err(format!(
            "could not create {}: {error}",
            paths.root.display()
        ));
    }
    let compose = write_if_absent(&paths.compose, &compose_yml())?;
    let env = if paths.env.exists() {
        Wrote::Kept
    } else {
        write_if_absent(&paths.env, &env_file_body(&generate_secrets()?))?
    };
    Ok(BundleWrite { compose, env })
}

/// Both files present — the definition of "installed".
pub(crate) fn installed(paths: &HarborPaths) -> bool {
    paths.compose.is_file() && paths.env.is_file()
}

/// Whether the compose file on disk is the one this build ships.
///
/// `Ok(false)` is not an error and must not be reported as one: it is either an
/// edit the owner made, which is his to keep, or a harbor written by an older
/// Vingilot, which is worth a sentence in the settings card. `Err` is a file
/// that could not be read at all.
pub(crate) fn compose_is_shipped(paths: &HarborPaths) -> Result<bool, String> {
    match fs::read_to_string(&paths.compose) {
        Ok(contents) => Ok(contents == compose_yml()),
        Err(error) => Err(format!(
            "could not read {}: {error}",
            paths.compose.display()
        )),
    }
}
