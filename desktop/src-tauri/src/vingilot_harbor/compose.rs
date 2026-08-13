//! What this module is willing to say to `docker`, and how it reads the answer
//! (vingilot/docs/plans/2026-08-13-home-harbor.md, Task 3).
//!
//! **An arg vector, never a shell string** — `vingilot_editor`'s rule, and here
//! for a sharper version of its reason: two of the arguments below are absolute
//! paths under the owner's home directory, which on macOS routinely contains
//! spaces. There is no `sh -c` in this island and there must not be one. Every
//! vector starts from [`compose_args`], so the project name, the compose file
//! and the env file cannot be forgotten on one call and present on another —
//! and forgetting the env file is not a cosmetic slip: the compose file
//! declares its four secrets with `${VAR:?…}`, so a call without `--env-file`
//! fails on *every* subcommand, `ps` included.
//!
//! **Long flags throughout.** `--project-name` rather than `-p`, `--file`
//! rather than `-f`. The vectors are read in two places by people rather than by
//! docker — a test asserting them, and a failure sentence quoting the command
//! that ran — and `-p` is not something the owner can paste into a terminal and
//! understand.
//!
//! **Reading `ps` is parsing, not grepping.** `docker compose ps --format json`
//! emits one JSON object per line in current versions and a single JSON array in
//! older ones, so [`parse_ps`] accepts both. The alternative — matching on the
//! word "healthy" in a table — is a status display that lies the first time a
//! container is named something containing that word.

use serde::Serialize;

use super::bundle::HarborPaths;

/// The compose project name. `docker compose ls` on this machine says whose the
/// containers are because of this one string.
pub(crate) const PROJECT_NAME: &str = "vingilot-harbor";

/// Every service `harbor-compose.yml` declares, which is what "the harbor is
/// running" is measured against. One list, so the compose file and the status
/// derivation cannot disagree about how many containers a harbor has.
pub(crate) const SERVICES: [&str; 3] = ["vingilot-relay", "postgres", "redis"];

/// The named volumes, unprefixed. Compose prefixes each with the project name,
/// which is why the uninstall sentence has to build the real names rather than
/// print these.
const VOLUMES: [&str; 3] = ["postgres-data", "redis-data", "git-data"];

/// How long `up --wait` is given before it is a failure with a name attached.
///
/// **Ten minutes, because the first install pulls an image.** The relay image is
/// a few hundred megabytes and the plan's own self-review names this as the
/// riskiest step: a "continue" that fires early lands the app on a socket that
/// refuses. Ten minutes is long enough for a slow café connection and short
/// enough that a wedged pull is reported rather than spun on forever.
pub(crate) const WAIT_TIMEOUT_SECONDS: u32 = 600;

/// `docker compose` with this harbor's three coordinates, then `tail`.
pub(crate) fn compose_args(paths: &HarborPaths, tail: &[&str]) -> Vec<String> {
    let mut args = vec![
        "compose".to_owned(),
        "--project-name".to_owned(),
        PROJECT_NAME.to_owned(),
        "--file".to_owned(),
        paths.compose.to_string_lossy().into_owned(),
        "--env-file".to_owned(),
        paths.env.to_string_lossy().into_owned(),
    ];
    args.extend(tail.iter().map(|arg| (*arg).to_owned()));
    args
}

/// The probe: does a docker engine answer at all.
///
/// `--format` because the answer this module needs is the exit status, and the
/// unformatted `docker info` prints eighty lines of the owner's machine into a
/// pipe nothing reads.
pub(crate) fn info_args() -> Vec<String> {
    vec![
        "info".to_owned(),
        "--format".to_owned(),
        "{{.ServerVersion}}".to_owned(),
    ]
}

/// Create and start the containers, pulling the image if it is not here yet.
///
/// **No `--wait` on this one.** It is the step that can take minutes, and the
/// two halves are separated so the owner is told which one he is waiting on:
/// "starting the harbor" while the image comes down, and only then "waiting for
/// it to answer". A single combined call would have shown one indeterminate
/// wait covering both, which is the spinner the plan forbids.
pub(crate) fn up_args(paths: &HarborPaths) -> Vec<String> {
    compose_args(paths, &["up", "--detach"])
}

/// Wait for every container's healthcheck to pass.
///
/// The same `up --detach` with `--wait` added, which is a no-op for containers
/// that are already up and is the honest form of "continue": it returns when the
/// healthchecks pass, and it has a timeout, so hitting the timeout is an event
/// with a name rather than a wait with no end.
pub(crate) fn wait_args(paths: &HarborPaths) -> Vec<String> {
    compose_args(
        paths,
        &[
            "up",
            "--detach",
            "--wait",
            "--wait-timeout",
            // A const formatted at build time would need a macro; the number is
            // asserted against WAIT_TIMEOUT_SECONDS in this module's tests.
            "600",
        ],
    )
}

/// Stop the containers, keeping them and their volumes.
///
/// `stop`, never `down`: `down` removes the containers, and the harbor's data is
/// the owner's messages. Removal is his to run, and the two commands to do it
/// are in [`uninstall_commands`].
pub(crate) fn stop_args(paths: &HarborPaths) -> Vec<String> {
    compose_args(paths, &["stop"])
}

/// Every container of the project, running or not.
pub(crate) fn ps_args(paths: &HarborPaths) -> Vec<String> {
    compose_args(paths, &["ps", "--all", "--format", "json"])
}

/// The logs of one service, for the sentence a failed wait ends with.
pub(crate) fn logs_command(paths: &HarborPaths, service: &str) -> String {
    format!(
        "docker {}",
        compose_args(paths, &["logs", "--tail", "50", service]).join(" ")
    )
}

/// One container, as `docker compose ps` describes it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarborService {
    /// The compose service name — one of [`SERVICES`].
    pub service: String,
    /// `running`, `exited`, `created`, …: docker's own word, passed through.
    pub state: String,
    /// `healthy`, `unhealthy`, `starting`, or `None` for a container with no
    /// healthcheck. Kept as an option rather than flattened to a string so
    /// "no healthcheck" and "not healthy" cannot be confused.
    pub health: Option<String>,
}

/// What `docker compose ps --format json` said.
///
/// Accepts the NDJSON of current compose and the single array of older
/// versions, and ignores blank lines either way. An unparseable line is an
/// error: a status derived from half the containers would read as "stopped".
pub(crate) fn parse_ps(raw: &str) -> Result<Vec<HarborService>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<serde_json::Value> = if trimmed.starts_with('[') {
        serde_json::from_str(trimmed)
            .map_err(|error| format!("could not read docker compose ps: {error}"))?
    } else {
        let mut rows = Vec::new();
        for line in trimmed.lines() {
            if line.trim().is_empty() {
                continue;
            }
            rows.push(
                serde_json::from_str(line)
                    .map_err(|error| format!("could not read docker compose ps: {error}"))?,
            );
        }
        rows
    };

    let mut services = Vec::with_capacity(rows.len());
    for row in rows {
        let Some(service) = row.get("Service").and_then(|value| value.as_str()) else {
            return Err("docker compose ps returned a row with no Service field".to_owned());
        };
        let health = row
            .get("Health")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        services.push(HarborService {
            service: service.to_owned(),
            state: row
                .get("State")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_owned(),
            health,
        });
    }
    Ok(services)
}

/// What the harbor is, in one word.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HarborState {
    /// No bundle on this machine — the door has never been used.
    NotInstalled,
    /// The bundle is here and no container of it is running.
    Stopped,
    /// Containers are up but not every healthcheck has passed yet.
    Starting,
    /// Every service is up and healthy. This, and only this, is a relay the app
    /// may be pointed at.
    Running,
    /// Something is up and reporting itself unhealthy — a state that must not
    /// be drawn as "running", because a relay whose Postgres is unhealthy
    /// accepts a socket and then fails every query.
    Unhealthy,
    /// The bundle is on this machine and Docker could not be asked about it.
    ///
    /// **Not folded into `Stopped`.** "Stopped" invites a Start button that
    /// cannot possibly work and hides the only thing the owner has to fix; this
    /// state arrives with the sentence that names it.
    Unknown,
}

/// The harbor's state from what `ps` said.
///
/// **"Running" requires all three, healthy.** Anything less is `Starting` or
/// `Unhealthy`, never `Running`: this is the value the door reads before it
/// hands the frontend a relay URL, and an optimistic reading of it is exactly
/// the "continue that lands on a socket which refuses" the plan warns about.
pub(crate) fn derive_state(services: &[HarborService]) -> HarborState {
    let running: Vec<&HarborService> = services
        .iter()
        .filter(|service| service.state == "running")
        .collect();
    if running.is_empty() {
        return HarborState::Stopped;
    }
    if running
        .iter()
        .any(|service| service.health.as_deref() == Some("unhealthy"))
    {
        return HarborState::Unhealthy;
    }
    let all_up = SERVICES
        .iter()
        .all(|name| running.iter().any(|service| service.service == *name));
    let all_healthy = running
        .iter()
        .all(|service| matches!(service.health.as_deref(), Some("healthy") | None));
    if all_up && all_healthy {
        HarborState::Running
    } else {
        HarborState::Starting
    }
}

/// The services that are not healthy, in [`SERVICES`] order — the names a
/// timed-out wait has to say out loud.
///
/// A service missing from `ps` entirely counts: "never started" is exactly the
/// case a wait timeout is reporting, and leaving it out would produce the
/// sentence "the harbor did not become healthy: nothing".
pub(crate) fn not_healthy(services: &[HarborService]) -> Vec<String> {
    SERVICES
        .iter()
        .filter_map(
            |name| match services.iter().find(|service| service.service == *name) {
                None => Some(format!("{name} (no container was created)")),
                Some(service) if service.state != "running" => {
                    Some(format!("{name} ({})", service.state))
                }
                Some(service) => match service.health.as_deref() {
                    Some("healthy") | None => None,
                    Some(health) => Some(format!("{name} ({health})")),
                },
            },
        )
        .collect()
}

/// The sentence for a wait that ran out of time.
///
/// **It names the container.** "Timed out waiting for the harbor" is a dead end;
/// what the owner can act on is which of the three never answered and the exact
/// command that shows him why. When `ps` itself could not be read, that is said
/// too rather than papered over with a guess.
pub(crate) fn wait_timeout_sentence(
    paths: &HarborPaths,
    ps: Result<Vec<HarborService>, String>,
) -> String {
    let opening =
        format!("the harbor did not report itself healthy within {WAIT_TIMEOUT_SECONDS} seconds");
    match ps {
        Err(error) => format!(
            "{opening}, and `docker compose ps` could not say which container is stuck: {error}"
        ),
        Ok(services) => {
            let stuck = not_healthy(&services);
            if stuck.is_empty() {
                format!(
                    "{opening}, though every container now reports healthy — try the Start button again. If it keeps happening, {}",
                    logs_command(paths, SERVICES[0])
                )
            } else {
                format!(
                    "{opening}. Still not healthy: {}. To see why, run: {}",
                    stuck.join(", "),
                    logs_command(paths, SERVICES[0])
                )
            }
        }
    }
}

/// The two commands that remove a harbor, spelled with this machine's real
/// paths.
///
/// **Printed, never run.** Nothing in this app removes the harbor: `down` and a
/// volume removal together delete the owner's messages, and a database this app
/// deletes on his behalf is a database he did not agree to lose. So the words
/// live here, next to the thing they are about, with the real project name and
/// the real file paths in them — a settings card that spelled them itself would
/// go stale the first time either changed.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarborUninstall {
    /// Removes the containers and the network. Volumes survive it.
    pub down: String,
    /// Removes the three volumes — the messages, the database, the git store.
    /// This is the irreversible one, and it is separate for that reason.
    pub volumes: String,
}

/// The uninstall words for `paths`.
pub(crate) fn uninstall_commands(paths: &HarborPaths) -> HarborUninstall {
    HarborUninstall {
        down: format!("docker {}", compose_args(paths, &["down"]).join(" ")),
        volumes: format!(
            "docker volume rm {}",
            VOLUMES
                .iter()
                .map(|volume| format!("{PROJECT_NAME}_{volume}"))
                .collect::<Vec<String>>()
                .join(" ")
        ),
    }
}
