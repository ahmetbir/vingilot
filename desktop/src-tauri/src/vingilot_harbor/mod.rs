//! The home harbor: a whole community running on this one machine
//! (vingilot/docs/plans/2026-08-13-home-harbor.md, Tasks 2 and 3).
//!
//! > *"bu vingilot solo makinede çalışabilsin… 'join a community' kısmında
//! > local'e kur diye bir seçenek olsa, otomatik docker'a kursa, sonra
//! > localhost'la devam etse."*
//!
//! The workspace half of this app already stands alone. The *community* half
//! does not: chat, the crew and team threads all live on a relay, and the
//! welcome screen's only doors are doors onto somebody else's host. This island
//! is the door onto a relay of his own — three containers, one loopback port,
//! and then the ordinary join path.
//!
//! **It joins through the existing community machinery and adds no second
//! onboarding.** Everything on this side ends with one string,
//! `ws://127.0.0.1:7447`, handed to the same `communityOnboarding.start(…)`
//! that a hosted community or an invite code goes through. The plan names a
//! parallel "local mode" codepath as the thing most likely to be got wrong
//! quietly, and this module's whole contract is that it produces a relay URL and
//! then gets out of the way.
//!
//! **Nothing here launches anything but `docker`, and never through a shell.**
//! `vingilot_editor`'s rule, and the arg vectors live in [`compose`] where a
//! test can read them: the paths passed to compose are absolute paths under the
//! owner's home directory, and a home directory with a space in it is not an
//! exotic machine. There is no `sh -c` in this island.
//!
//! **The three answers "no Docker", "Docker is not running" and "ready" are
//! kept apart**, because they are three different next actions: install it (with
//! the link), open it, and go. Collapsing them into "docker failed" is how a
//! working machine with a whale that has not finished starting reads as a broken
//! one. [`classify_probe`] is the pure function that draws those lines, and the
//! probe predicate it depends on is injected so all three are tested on a
//! machine that may have Docker or may not.
//!
//! **Install is a sequence of named steps, not a spinner.** [`HarborStep`] is
//! emitted as each one starts and finishes, so "checking Docker", "writing the
//! bundle", "starting the harbor" (which is where an image pull spends its
//! minutes) and "waiting for it to answer" are four things the owner can see
//! rather than one indeterminate wait. The waiting step is `up --wait` with a
//! timeout, and hitting that timeout names the container that never went
//! healthy.
//!
//! **Uninstall is not a command in this module and must not become one.** The
//! harbor's volumes are the owner's messages. The two commands that remove them
//! are built by [`compose::uninstall_commands`] and printed for him to run —
//! see that function for the argument.

pub(crate) mod bundle;
pub(crate) mod compose;

#[cfg(test)]
#[path = "harbor_tests.rs"]
mod harbor_tests;

// Runs the real arg vectors through a real `exec`, against a script that records
// them. Out of line for `vingilot_shim/recorder_tests.rs`'s reason: it is a
// different class of test from the pure ones above it, and its header says so.
#[cfg(test)]
#[path = "recorder_tests.rs"]
mod recorder_tests;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use serde::Serialize;
use tauri::Emitter;

use bundle::{HarborPaths, RELAY_URL};
use compose::{
    derive_state, info_args, parse_ps, ps_args, stop_args, up_args, wait_args,
    wait_timeout_sentence, HarborService, HarborState, HarborUninstall,
};

/// The event each install step is emitted on.
///
/// A webview listener rather than a return value *as well as* the return value:
/// `up --detach` can spend minutes pulling an image, and a command that only
/// answers at the end leaves the surface with nothing true to draw in the
/// meantime. The final [`HarborStartReport`] carries every step again, so a
/// listener that attached late still renders the whole sequence.
pub(crate) const HARBOR_STEP_EVENT: &str = "vingilot://harbor-step";

/// Where to get Docker, for the sentence a machine without it reads.
const DOCKER_DESKTOP_URL: &str = "https://www.docker.com/products/docker-desktop/";

// ---------------------------------------------------------------------------
// Finding docker, and running it
// ---------------------------------------------------------------------------

/// Where `docker` is looked for, in order.
///
/// **PATH first, then the places Docker Desktop actually installs it** —
/// `vingilot_pty::tmux`'s rule and here for that module's exact reason: *a
/// desktop app launched from Finder does not inherit a login shell's `PATH`*. A
/// PATH-only probe on a Dock-launched build tells somebody who has had Docker
/// Desktop running for a year that he has no Docker. `~/.docker/bin` is in the
/// list because current Docker Desktop offers a per-user install that writes
/// only there and touches nothing in `/usr/local/bin`.
pub(crate) fn candidates(home: Option<&Path>) -> Vec<String> {
    let mut found = vec![
        "docker".to_owned(),
        "/usr/local/bin/docker".to_owned(),
        "/opt/homebrew/bin/docker".to_owned(),
    ];
    if let Some(home) = home {
        found.push(
            home.join(".docker")
                .join("bin")
                .join("docker")
                .to_string_lossy()
                .into_owned(),
        );
    }
    found.push("/Applications/Docker.app/Contents/Resources/bin/docker".to_owned());
    found
}

/// Whether a candidate is a `docker` that runs.
///
/// `--version` and not `info`: `--version` answers with the daemon stopped,
/// which is the whole point — it is what separates "no Docker on this machine"
/// from "Docker is here and its engine is asleep".
fn responds_to_version(candidate: &str) -> bool {
    matches!(
        Command::new(candidate)
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status(),
        Ok(status) if status.success()
    )
}

/// The first candidate `usable` accepts.
///
/// Takes the predicate so the ordering rule is tested without Docker installed
/// on the machine running `cargo test`, and so the absent case is tested on one
/// that has it.
pub(crate) fn binary_with(home: Option<&Path>, usable: &impl Fn(&str) -> bool) -> Option<String> {
    candidates(home)
        .into_iter()
        .find(|candidate| usable(candidate))
}

/// The probe, once per app run: up to five `fork`+`exec`s, and the answer does
/// not change while the app is open in any way that matters.
fn binary() -> Option<&'static String> {
    static FOUND: OnceLock<Option<String>> = OnceLock::new();
    FOUND
        .get_or_init(|| binary_with(dirs::home_dir().as_deref(), &responds_to_version))
        .as_ref()
}

/// Why a `docker` invocation produced no output.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum DockerError {
    /// There is no `docker` on this machine.
    Absent,
    /// `docker` is here but could not be launched — a permission, or an
    /// Applications directory mid-upgrade.
    Launch(String),
    /// `docker` ran and refused. `stderr` is docker's own words.
    Refused { code: Option<i32>, stderr: String },
}

/// The `PATH` a docker child process gets.
///
/// Finding the `docker` binary by absolute path is not enough: docker itself
/// then invokes its credential helper (`docker-credential-desktop`, named by
/// `credsStore` in `~/.docker/config.json`) **via `PATH`**, for every pull —
/// public images included. A Finder-launched app's PATH has none of Docker
/// Desktop's directories in it, so the first real install died with
/// `exec: "docker-credential-desktop": executable file not found in $PATH`
/// before the registry was ever asked anything. The child therefore gets the
/// app's PATH plus every directory `candidates` knows, the resolved binary's
/// own directory first — the helper is installed beside the binary.
pub(crate) fn child_path(binary: &str, current: Option<&str>, home: Option<&Path>) -> String {
    let mut path = current.unwrap_or_default().to_owned();
    let mut extras: Vec<String> = Vec::new();
    if let Some(parent) = Path::new(binary).parent() {
        if !parent.as_os_str().is_empty() {
            extras.push(parent.to_string_lossy().into_owned());
        }
    }
    extras.push("/usr/local/bin".to_owned());
    extras.push("/opt/homebrew/bin".to_owned());
    if let Some(home) = home {
        extras.push(
            home.join(".docker")
                .join("bin")
                .to_string_lossy()
                .into_owned(),
        );
    }
    extras.push("/Applications/Docker.app/Contents/Resources/bin".to_owned());
    for extra in extras {
        if path.split(':').any(|segment| segment == extra) {
            continue;
        }
        if !path.is_empty() {
            path.push(':');
        }
        path.push_str(&extra);
    }
    path
}

/// Run `docker <args>` and give back its stdout.
///
/// `output()` rather than `status()`: every refusal in this island quotes
/// docker's own stderr back to the owner, and an inherited stderr would put it
/// in a log file he has no way to open.
pub(crate) fn run(binary: &str, args: &[String]) -> Result<String, DockerError> {
    match Command::new(binary)
        .args(args)
        .env(
            "PATH",
            child_path(
                binary,
                std::env::var("PATH").ok().as_deref(),
                dirs::home_dir().as_deref(),
            ),
        )
        .stdin(Stdio::null())
        .output()
    {
        Err(error) => Err(DockerError::Launch(format!(
            "{binary} did not start: {error}"
        ))),
        Ok(output) if output.status.success() => {
            Ok(String::from_utf8_lossy(&output.stdout).into_owned())
        }
        Ok(output) => Err(DockerError::Refused {
            code: output.status.code(),
            stderr: first_lines(&String::from_utf8_lossy(&output.stderr), 3),
        }),
    }
}

/// The first `count` non-blank lines, joined — what a refusal quotes.
///
/// Bounded because compose is capable of answering with a screenful, and a
/// sentence in a settings card is not a log viewer.
fn first_lines(raw: &str, count: usize) -> String {
    raw.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(count)
        .collect::<Vec<&str>>()
        .join(" ")
}

/// A runner bound to this machine's `docker`, or `None` when there is none.
fn runner() -> Option<impl Fn(&[String]) -> Result<String, DockerError>> {
    let binary = binary()?;
    Some(move |args: &[String]| run(binary, args))
}

/// The runner every call goes through, with "no docker at all" folded into the
/// error type so a caller has one thing to match on.
fn docker(args: &[String]) -> Result<String, DockerError> {
    match runner() {
        Some(run) => run(args),
        None => Err(DockerError::Absent),
    }
}

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

/// Whether this machine can run a harbor.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HarborDocker {
    /// No `docker` anywhere this app looks.
    Absent,
    /// `docker` is installed and its engine is not answering.
    NotRunning,
    /// An engine answered.
    Ready,
}

/// The probe's answer.
///
/// **The refusal carries its own sentence**, `vingilot_editor::EditorProbe`'s
/// rule: what the owner needs is not the word "absent" but which way out
/// applies to him, and the way out for a missing Docker is a URL. Keeping the
/// words here rather than in the webview is what stops the frontend from
/// holding a second, drifting copy of them.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarborProbe {
    pub docker: HarborDocker,
    /// What went wrong and what to do about it, or `None` when nothing did.
    pub refusal: Option<String>,
    /// Where to get Docker. Set only for [`HarborDocker::Absent`], so a surface
    /// cannot offer an install link to somebody who already has it installed.
    pub install_url: Option<String>,
    /// The engine version, when one answered — proof for the owner that this is
    /// his Docker and not a guess.
    pub engine: Option<String>,
}

/// The sentence for a machine with no Docker.
pub(crate) fn no_docker() -> String {
    format!(
        "Docker is not on this machine. The home harbor runs the relay, Postgres and Redis as three containers, so it needs Docker Desktop: install it from {DOCKER_DESKTOP_URL}, open it once so its engine starts, then try this again."
    )
}

/// The sentence for a Docker whose engine is asleep.
pub(crate) fn docker_not_running(stderr: &str) -> String {
    let quoted = if stderr.is_empty() {
        String::new()
    } else {
        format!(" It said: {stderr}")
    };
    format!(
        "Docker is installed but its engine is not answering, so nothing was started.{quoted} Open Docker Desktop, wait until it reports itself running, then try this again."
    )
}

/// Read `docker info`'s answer as one of three states.
pub(crate) fn classify_probe(answer: Result<String, DockerError>) -> HarborProbe {
    match answer {
        Ok(version) => HarborProbe {
            docker: HarborDocker::Ready,
            refusal: None,
            install_url: None,
            engine: Some(version.trim().to_owned()).filter(|value| !value.is_empty()),
        },
        Err(DockerError::Absent) => HarborProbe {
            docker: HarborDocker::Absent,
            refusal: Some(no_docker()),
            install_url: Some(DOCKER_DESKTOP_URL.to_owned()),
            engine: None,
        },
        // A `docker` that is present and will not launch is the owner's Docker
        // being broken, not missing: the way out is the same as for a stopped
        // engine (open it, let it repair itself), and offering the download page
        // to somebody who already has the app is the one answer that wastes his
        // time.
        Err(DockerError::Launch(detail)) => HarborProbe {
            docker: HarborDocker::NotRunning,
            refusal: Some(docker_not_running(&detail)),
            install_url: None,
            engine: None,
        },
        Err(DockerError::Refused { stderr, .. }) => HarborProbe {
            docker: HarborDocker::NotRunning,
            refusal: Some(docker_not_running(&stderr)),
            install_url: None,
            engine: None,
        },
    }
}

// ---------------------------------------------------------------------------
// Install and start, step by step
// ---------------------------------------------------------------------------

/// The four things installing a harbor does, in order.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HarborStepId {
    CheckingDocker,
    WritingBundle,
    Starting,
    WaitingForHealth,
}

impl HarborStepId {
    /// What the owner reads while it is happening. Present tense, his words.
    fn running_sentence(self) -> &'static str {
        match self {
            HarborStepId::CheckingDocker => "checking Docker…",
            HarborStepId::WritingBundle => "writing the harbor's compose file…",
            HarborStepId::Starting => {
                "starting the harbor — the first run downloads the relay image, which takes a few minutes…"
            }
            HarborStepId::WaitingForHealth => "waiting for the harbor to answer…",
        }
    }
}

/// Where one step got to.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HarborStepState {
    Running,
    Done,
    Failed,
}

/// One step, as the surface draws it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarborStep {
    pub step: HarborStepId,
    pub state: HarborStepState,
    /// One sentence. For a failure it names the command that ran, because a
    /// failure the owner cannot reproduce in his own terminal is one he cannot
    /// do anything about.
    pub detail: String,
}

/// Every step, and the relay URL if there is one.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarborStartReport {
    pub steps: Vec<HarborStep>,
    /// `ws://127.0.0.1:7447`, and only when all four steps are done. `None` is
    /// what stops a surface from continuing into a socket that is not there.
    pub relay_url: Option<String>,
    /// The one sentence to show when something went wrong.
    pub failure: Option<String>,
}

/// Turn an arg vector back into the command line the owner could paste.
fn as_command(args: &[String]) -> String {
    format!("docker {}", args.join(" "))
}

/// The sentence for a compose call that refused.
fn compose_refusal(args: &[String], error: &DockerError) -> String {
    match error {
        DockerError::Absent => no_docker(),
        DockerError::Launch(detail) => docker_not_running(detail),
        DockerError::Refused { code, stderr } => {
            let status = match code {
                Some(code) => format!("exited {code}"),
                None => "was killed".to_owned(),
            };
            let quoted = if stderr.is_empty() {
                String::new()
            } else {
                format!(" It said: {stderr}")
            };
            format!("`{}` {status}.{quoted}", as_command(args))
        }
    }
}

/// Install the bundle if it is not there and bring the harbor up, reporting each
/// step as it happens.
///
/// The docker runner and the step sink are both parameters: the runner so every
/// path through here is driven in tests against a recorder rather than against
/// an engine, and the sink so the emitting is somebody else's job — this
/// function has no opinion about webviews.
pub(crate) fn install_and_start(
    paths: &HarborPaths,
    docker: &dyn Fn(&[String]) -> Result<String, DockerError>,
    sink: &dyn Fn(&HarborStep),
) -> HarborStartReport {
    let mut steps: Vec<HarborStep> = Vec::with_capacity(4);

    let begin = |id: HarborStepId| {
        sink(&HarborStep {
            step: id,
            state: HarborStepState::Running,
            detail: id.running_sentence().to_owned(),
        });
    };

    // 1. Docker.
    begin(HarborStepId::CheckingDocker);
    match docker(&info_args()) {
        Ok(version) => {
            let version = version.trim();
            let detail = if version.is_empty() {
                "a Docker engine answered".to_owned()
            } else {
                format!("Docker engine {version} answered")
            };
            steps.push(finish(sink, HarborStepId::CheckingDocker, detail));
        }
        Err(error) => {
            let detail = classify_probe(Err(error))
                .refusal
                .unwrap_or_else(|| "Docker could not be reached".to_owned());
            return failed(sink, steps, HarborStepId::CheckingDocker, detail);
        }
    }

    // 2. The bundle.
    begin(HarborStepId::WritingBundle);
    match bundle::ensure(paths) {
        Ok(write) => {
            let detail = write.sentence(paths);
            steps.push(finish(sink, HarborStepId::WritingBundle, detail));
        }
        Err(error) => return failed(sink, steps, HarborStepId::WritingBundle, error),
    }

    // 3. Up, which is where an image pull spends its minutes.
    begin(HarborStepId::Starting);
    let up = up_args(paths);
    if let Err(error) = docker(&up) {
        let detail = compose_refusal(&up, &error);
        return failed(sink, steps, HarborStepId::Starting, detail);
    }
    steps.push(finish(
        sink,
        HarborStepId::Starting,
        format!("`{}` created the three containers", as_command(&up)),
    ));

    // 4. Healthy, or the name of whatever is not.
    begin(HarborStepId::WaitingForHealth);
    let wait = wait_args(paths);
    if let Err(error) = docker(&wait) {
        let detail = match error {
            // Docker is gone mid-install: say that, not "not healthy".
            DockerError::Absent | DockerError::Launch(_) => compose_refusal(&wait, &error),
            DockerError::Refused { .. } => wait_timeout_sentence(paths, read_ps(paths, docker)),
        };
        return failed(sink, steps, HarborStepId::WaitingForHealth, detail);
    }
    steps.push(finish(
        sink,
        HarborStepId::WaitingForHealth,
        format!("every container reports healthy; the relay is answering on {RELAY_URL}"),
    ));

    HarborStartReport {
        steps,
        relay_url: Some(RELAY_URL.to_owned()),
        failure: None,
    }
}

/// Record a step as done and emit it.
fn finish(sink: &dyn Fn(&HarborStep), id: HarborStepId, detail: String) -> HarborStep {
    let step = HarborStep {
        step: id,
        state: HarborStepState::Done,
        detail,
    };
    sink(&step);
    step
}

/// Record a step as failed, emit it, and stop.
///
/// The report keeps every step that already succeeded: "Docker answered, the
/// bundle was written, and then the pull failed" is a different problem from
/// "Docker never answered", and a report that showed only the failure would make
/// them look the same.
fn failed(
    sink: &dyn Fn(&HarborStep),
    mut steps: Vec<HarborStep>,
    id: HarborStepId,
    detail: String,
) -> HarborStartReport {
    let step = HarborStep {
        step: id,
        state: HarborStepState::Failed,
        detail: detail.clone(),
    };
    sink(&step);
    steps.push(step);
    HarborStartReport {
        steps,
        relay_url: None,
        failure: Some(detail),
    }
}

/// `docker compose ps`, parsed — as a `Result` of borrowed forms, which is the
/// shape [`wait_timeout_sentence`] takes so it can say "and ps could not answer
/// either" instead of guessing.
fn read_ps(
    paths: &HarborPaths,
    docker: &dyn Fn(&[String]) -> Result<String, DockerError>,
) -> Result<Vec<HarborService>, String> {
    let args = ps_args(paths);
    match docker(&args) {
        Ok(raw) => parse_ps(&raw),
        Err(error) => Err(compose_refusal(&args, &error)),
    }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/// Everything the Home harbor settings card draws.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarborStatus {
    pub state: HarborState,
    pub docker: HarborDocker,
    pub services: Vec<HarborService>,
    /// The relay this harbor is, whatever state it is in — so the card can show
    /// the owner the URL before he starts it as well as after.
    pub relay_url: String,
    pub compose_path: String,
    pub env_path: String,
    /// Whether the compose file on disk is the one this build ships. `None` when
    /// there is no harbor, or when the file could not be read.
    pub compose_is_shipped: Option<bool>,
    /// The two commands that remove a harbor, for the card to print. Nothing in
    /// this app runs them.
    pub uninstall: HarborUninstall,
    /// A sentence when there is one to say — Docker missing, or a `ps` that
    /// could not be read. `None` is the ordinary case.
    pub message: Option<String>,
}

/// The harbor's state, with the docker runner injected.
pub(crate) fn status_with(
    paths: &HarborPaths,
    docker: &dyn Fn(&[String]) -> Result<String, DockerError>,
) -> HarborStatus {
    let base = |state: HarborState,
                docker_state: HarborDocker,
                services: Vec<HarborService>,
                compose_is_shipped: Option<bool>,
                message: Option<String>| HarborStatus {
        state,
        docker: docker_state,
        services,
        relay_url: RELAY_URL.to_owned(),
        compose_path: paths.compose.display().to_string(),
        env_path: paths.env.display().to_string(),
        compose_is_shipped,
        uninstall: compose::uninstall_commands(paths),
        message,
    };

    if !bundle::installed(paths) {
        return base(
            HarborState::NotInstalled,
            HarborDocker::Ready,
            Vec::new(),
            None,
            None,
        );
    }
    let shipped = bundle::compose_is_shipped(paths).ok();

    match read_ps(paths, docker) {
        Ok(services) => {
            let state = derive_state(&services);
            base(state, HarborDocker::Ready, services, shipped, None)
        }
        Err(message) => {
            // The bundle is here and Docker could not be asked, so the honest
            // answer is not "stopped" — "stopped" would invite a Start button
            // that cannot work, and hide the one thing the owner has to fix.
            let probe = classify_probe(Err(DockerError::Absent));
            let docker_state = match binary() {
                None => probe.docker,
                Some(_) => HarborDocker::NotRunning,
            };
            base(
                HarborState::Unknown,
                docker_state,
                Vec::new(),
                shipped,
                Some(message),
            )
        }
    }
}

/// Bring an installed harbor up and wait for it, or say why not.
pub(crate) fn start_with(
    paths: &HarborPaths,
    docker: &dyn Fn(&[String]) -> Result<String, DockerError>,
) -> Result<(), String> {
    if !bundle::installed(paths) {
        return Err(not_installed(paths));
    }
    let wait = wait_args(paths);
    match docker(&wait) {
        Ok(_) => Ok(()),
        Err(DockerError::Refused { code, stderr }) => Err(format!(
            "{} ({})",
            wait_timeout_sentence(paths, read_ps(paths, docker)),
            compose_refusal(&wait, &DockerError::Refused { code, stderr })
        )),
        Err(error) => Err(compose_refusal(&wait, &error)),
    }
}

/// Stop an installed harbor's containers, keeping every volume.
pub(crate) fn stop_with(
    paths: &HarborPaths,
    docker: &dyn Fn(&[String]) -> Result<String, DockerError>,
) -> Result<(), String> {
    if !bundle::installed(paths) {
        return Err(not_installed(paths));
    }
    let args = stop_args(paths);
    docker(&args)
        .map(|_| ())
        .map_err(|error| compose_refusal(&args, &error))
}

/// The refusal for a machine with no harbor on it.
pub(crate) fn not_installed(paths: &HarborPaths) -> String {
    format!(
        "there is no harbor on this machine yet — {} does not exist. Use \"Run Vingilot on this Mac\" on the welcome screen to install one.",
        paths.compose.display()
    )
}

// ---------------------------------------------------------------------------
// The commands
// ---------------------------------------------------------------------------

/// This machine's home directory, or the one sentence that says why there is
/// none.
fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "this machine has no home directory".to_owned())
}

/// The harbor's paths under this machine's home.
fn paths() -> Result<HarborPaths, String> {
    Ok(bundle::paths_in(&home()?))
}

/// Whether this machine can run a harbor: no Docker, a stopped engine, or ready.
///
/// Never an `Err`: "you have no Docker" is an answer the surface draws, not a
/// failure it apologises for.
#[tauri::command]
pub async fn harbor_probe() -> HarborProbe {
    // Off the webview's thread: on macOS a blocking `Command` on the main
    // thread is a frozen window, and this one is up to five spawns cold.
    tauri::async_runtime::spawn_blocking(|| classify_probe(docker(&info_args())))
        .await
        .unwrap_or_else(|error| HarborProbe {
            docker: HarborDocker::NotRunning,
            refusal: Some(format!("the harbor's own worker did not run: {error}")),
            install_url: None,
            engine: None,
        })
}

/// Write the bundle if it is missing, start the harbor, and wait for it to
/// answer.
///
/// Each step is also emitted on [`HARBOR_STEP_EVENT`] as it starts and finishes,
/// because this call can take minutes and a surface with nothing to draw draws a
/// spinner.
#[tauri::command]
pub async fn harbor_install_and_start(app: tauri::AppHandle) -> Result<HarborStartReport, String> {
    let paths = paths()?;
    tauri::async_runtime::spawn_blocking(move || {
        install_and_start(&paths, &docker, &|step| {
            // A dropped event is not worth failing an install over: the report
            // returned at the end carries every step again.
            let _ = app.emit(HARBOR_STEP_EVENT, step);
        })
    })
    .await
    .map_err(|error| format!("the harbor's own worker did not run: {error}"))
}

/// What the harbor is right now: not installed, stopped, starting, running,
/// unhealthy, or unknown because Docker could not be asked.
#[tauri::command]
pub async fn harbor_status() -> Result<HarborStatus, String> {
    let paths = paths()?;
    tauri::async_runtime::spawn_blocking(move || status_with(&paths, &docker))
        .await
        .map_err(|error| format!("the harbor's own worker did not run: {error}"))
}

/// Start a harbor that is already installed, returning when it is healthy.
#[tauri::command]
pub async fn harbor_start() -> Result<(), String> {
    let paths = paths()?;
    tauri::async_runtime::spawn_blocking(move || start_with(&paths, &docker))
        .await
        .unwrap_or_else(|error| Err(format!("the harbor's own worker did not run: {error}")))
}

/// Stop the harbor's containers. Every volume survives — see
/// [`compose::uninstall_commands`] for why removal is not a command here.
#[tauri::command]
pub async fn harbor_stop() -> Result<(), String> {
    let paths = paths()?;
    tauri::async_runtime::spawn_blocking(move || stop_with(&paths, &docker))
        .await
        .unwrap_or_else(|error| Err(format!("the harbor's own worker did not run: {error}")))
}
