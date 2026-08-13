//! The harbor's decisions, tested without a Docker on the machine.
//!
//! **Nothing in this file spawns anything.** Every function under test here
//! takes either a path, a string docker already printed, or an injected runner,
//! so the whole of the island's judgement — which arg vector, which of three
//! Docker states, which container is stuck, what lands in `harbor.env` — is
//! asserted on a machine with no Docker installed and with none started. The one
//! test that does run a real `exec` lives in `recorder_tests.rs`, and it runs a
//! shell script rather than docker.
//!
//! **The env-file assertions never print a secret.** They assert on shape:
//! length, alphabet, that two generations differ, that the four keys the compose
//! file interpolates are the four keys the file declares, and that the mode is
//! 0600. A test that dumped a generated password into the test log would be the
//! exact leak the module refuses to have a `Debug` for.

use std::fs;

use tempfile::TempDir;

use super::bundle::{
    compose_is_shipped, compose_yml, ensure, env_file_body, generate_secrets, installed, paths_in,
    random_password, HarborPaths, Wrote, ENV_KEYS, RELAY_IMAGE, RELAY_URL,
};
use super::compose::{
    compose_args, derive_state, info_args, logs_command, not_healthy, parse_ps, ps_args, stop_args,
    uninstall_commands, up_args, wait_args, wait_timeout_sentence, HarborService, HarborState,
    PROJECT_NAME, SERVICES, WAIT_TIMEOUT_SECONDS,
};
use super::{
    binary_with, candidates, classify_probe, install_and_start, start_with, status_with, stop_with,
    DockerError, HarborDocker, HarborStepId, HarborStepState,
};

fn tempdir() -> TempDir {
    match TempDir::new() {
        Ok(dir) => dir,
        Err(error) => panic!("could not create a temp dir: {error}"),
    }
}

fn harbor(home: &TempDir) -> HarborPaths {
    paths_in(home.path())
}

/// A file's contents, or a panic naming the path — `io::Error` is not
/// `PartialEq`, so a `Result` comparison cannot be written directly.
fn read(path: &std::path::Path) -> String {
    match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) => panic!("could not read {}: {error}", path.display()),
    }
}

/// A runner that records every arg vector it is handed and answers from a script
/// of replies, in order. The last reply repeats, so a test that only cares about
/// the vectors writes one.
struct Script {
    calls: std::cell::RefCell<Vec<Vec<String>>>,
    replies: Vec<Result<String, DockerError>>,
}

impl Script {
    fn new(replies: Vec<Result<String, DockerError>>) -> Self {
        Self {
            calls: std::cell::RefCell::new(Vec::new()),
            replies,
        }
    }

    fn ok() -> Self {
        Self::new(vec![Ok(String::new())])
    }

    fn run(&self, args: &[String]) -> Result<String, DockerError> {
        let index = self.calls.borrow().len();
        self.calls.borrow_mut().push(args.to_vec());
        let reply = self
            .replies
            .get(index)
            .or_else(|| self.replies.last())
            .cloned();
        match reply {
            Some(reply) => reply,
            None => Ok(String::new()),
        }
    }

    fn calls(&self) -> Vec<Vec<String>> {
        self.calls.borrow().clone()
    }
}

// ---------------------------------------------------------------------------
// The compose file
// ---------------------------------------------------------------------------

#[test]
fn the_image_line_is_filled_in_and_there_is_exactly_one_of_it() {
    // The plan asks for one greppable line for the image so a digest can replace
    // a tag without hunting. A leftover placeholder would be a compose file that
    // refuses to parse, and two image lines would be a pin that only half
    // applied.
    let yaml = compose_yml();
    assert!(
        !yaml.contains("__VINGILOT_RELAY_IMAGE__"),
        "the placeholder survived into the compose file"
    );
    assert_eq!(yaml.matches(RELAY_IMAGE).count(), 1);
    assert!(yaml.contains(&format!("image: {RELAY_IMAGE}")));
}

#[test]
fn the_relay_url_the_module_hands_out_is_the_one_the_compose_file_seeds() {
    // The single most load-bearing agreement in the feature: the relay refuses
    // the WebSocket upgrade for any Host it has no community row for, and the
    // only row it seeds is RELAY_URL's authority. If these two ever drift, every
    // socket 404s and the app looks broken rather than misconfigured.
    assert_eq!(RELAY_URL, "ws://127.0.0.1:7447");
    assert!(compose_yml().contains(&format!("RELAY_URL: {RELAY_URL}")));
    // And the published port has to be the one that URL names, bound to
    // loopback.
    assert!(compose_yml().contains("\"127.0.0.1:7447:3000\""));
}

#[test]
fn the_scheme_is_ws_and_never_wss() {
    // A wss:// spelling makes NIP-42 expect a wss:// relay tag from an app that
    // signs ws://, which fails on AUTH as a relay-URL mismatch — a failure that
    // looks nothing like its cause.
    assert!(RELAY_URL.starts_with("ws://"));
    assert!(!compose_yml().contains("RELAY_URL: wss://"));
}

#[test]
fn only_the_relay_publishes_a_port_and_only_on_loopback() {
    // Task 4's honesty claim is meant to be checkable in the compose file, and
    // what proves it is an absence: postgres and redis have no `ports:` key at
    // all, and the relay's one binding starts with 127.0.0.1.
    let yaml = compose_yml();
    let published: Vec<&str> = yaml
        .lines()
        .map(str::trim)
        .filter(|line| {
            line.starts_with("- \"") && line.contains(":3000\"")
                || line.contains(":5432\"")
                || line.contains(":6379\"")
        })
        .collect();
    assert_eq!(published, vec!["- \"127.0.0.1:7447:3000\""]);
    assert_eq!(yaml.matches("ports:").count(), 1);
}

#[test]
fn migrations_are_on_and_the_fatal_s3_probe_is_off() {
    // Two defaults that are exactly backwards for a harbor. BUZZ_AUTO_MIGRATE
    // defaults OFF, so a fresh volume without it is a relay that boots and then
    // fails every query; BUZZ_GIT_CONFORMANCE_PROBE defaults ON and is fatal,
    // and the harbor has no object store for it to race against.
    let yaml = compose_yml();
    assert!(yaml.contains("BUZZ_AUTO_MIGRATE: \"true\""));
    assert!(yaml.contains("BUZZ_GIT_CONFORMANCE_PROBE: \"false\""));
}

#[test]
fn every_variable_the_compose_file_interpolates_is_one_the_env_file_declares() {
    // The drift this catches is silent in the worst way: compose's `${VAR:?…}`
    // form fails the whole command, on every subcommand, including `ps`.
    let yaml = compose_yml();
    for key in ENV_KEYS {
        assert!(
            yaml.contains(&format!("${{{key}:?")),
            "{key} is declared in harbor.env and never used by the compose file"
        );
    }
    let interpolations = yaml.matches("${VINGILOT_HARBOR_").count();
    // Seven references over four names: the postgres password is named twice
    // (the relay's URL and the service's own env) and the redis password three
    // times (the relay's URL, redis's --requirepass, and the service's env).
    assert_eq!(interpolations, 7, "an interpolation with no key behind it");
}

#[test]
fn the_project_name_is_in_the_file_as_well_as_on_the_command_line() {
    // `docker compose ls` reads the file's own `name:`, which is what makes the
    // containers on his machine identifiable without this app running.
    assert!(compose_yml().starts_with("# The Vingilot home harbor"));
    assert!(compose_yml().contains(&format!("\nname: {PROJECT_NAME}\n")));
}

#[test]
fn every_service_the_status_measures_is_a_service_the_file_declares() {
    let yaml = compose_yml();
    for service in SERVICES {
        assert!(
            yaml.contains(&format!("\n  {service}:\n")),
            "{service} is measured by derive_state and is not in the compose file"
        );
    }
}

// ---------------------------------------------------------------------------
// Secrets and the env file
// ---------------------------------------------------------------------------

#[test]
fn a_generated_password_is_alphanumeric_and_long() {
    let password = match random_password(32) {
        Ok(password) => password,
        Err(error) => panic!("no entropy: {error}"),
    };
    assert_eq!(password.chars().count(), 32);
    assert!(
        password.chars().all(|c| c.is_ascii_alphanumeric()),
        "a password with a URL-significant character in it"
    );
}

#[test]
fn two_generations_are_not_the_same_password() {
    // The one property a default password fails. Two 32-character draws from a
    // CSPRNG colliding is not a thing that happens, so equality here means the
    // entropy is not entropy.
    let first = random_password(32);
    let second = random_password(32);
    assert!(first.is_ok() && second.is_ok());
    assert_ne!(first, second);
}

#[test]
fn the_env_file_declares_the_four_keys_and_nothing_looks_like_a_default() {
    let secrets = match generate_secrets() {
        Ok(secrets) => secrets,
        Err(error) => panic!("no entropy: {error}"),
    };
    let body = env_file_body(&secrets);
    for key in ENV_KEYS {
        assert!(body.contains(&format!("\n{key}=")), "{key} is missing");
    }
    // No value is empty, and none is one of the words a default would be.
    for line in body.lines().filter(|line| !line.starts_with('#')) {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        assert!(!value.is_empty(), "{key} has no value");
        assert!(
            !["changeme", "vingilot", "postgres", "password", "buzz_dev"]
                .contains(&value.to_ascii_lowercase().as_str()),
            "{key} looks like a default"
        );
    }
}

#[test]
fn install_writes_both_files_and_the_env_file_is_readable_only_by_its_owner() {
    let home = tempdir();
    let paths = harbor(&home);
    assert!(!installed(&paths));
    assert_eq!(
        ensure(&paths),
        Ok(super::bundle::BundleWrite {
            compose: Wrote::Created,
            env: Wrote::Created
        })
    );
    assert!(installed(&paths));
    assert!(paths.compose.is_file() && paths.env.is_file());

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = match fs::metadata(&paths.env) {
            Ok(metadata) => metadata.permissions().mode() & 0o777,
            Err(error) => panic!("could not stat the env file: {error}"),
        };
        assert_eq!(mode, 0o600, "harbor.env is readable by somebody else");
    }
}

#[test]
fn a_second_install_never_rewrites_the_secrets() {
    // The load-bearing one. harbor.env holds the only copy of the password the
    // Postgres volume was initialised with; rewriting it locks the owner out of
    // his own messages, and it would happen on the second click of a button he
    // is invited to press twice.
    let home = tempdir();
    let paths = harbor(&home);
    assert!(ensure(&paths).is_ok());
    let first = read(&paths.env);
    assert_eq!(
        ensure(&paths),
        Ok(super::bundle::BundleWrite {
            compose: Wrote::Kept,
            env: Wrote::Kept
        })
    );
    // Compared, never printed: an assert_eq! here would put both generated
    // passwords in the test log, which is the leak this module refuses to have a
    // Debug for.
    assert!(
        read(&paths.env) == first,
        "a second install rewrote harbor.env"
    );
}

#[test]
fn an_edited_compose_file_is_kept_and_reported_rather_than_replaced() {
    let home = tempdir();
    let paths = harbor(&home);
    assert!(ensure(&paths).is_ok());
    assert_eq!(compose_is_shipped(&paths), Ok(true));

    let edited = format!("{}\n# my own note\n", compose_yml());
    if let Err(error) = fs::write(&paths.compose, &edited) {
        panic!("could not edit the compose file: {error}");
    }
    assert_eq!(ensure(&paths).map(|write| write.compose), Ok(Wrote::Kept));
    assert_eq!(read(&paths.compose), edited);
    assert_eq!(compose_is_shipped(&paths), Ok(false));
}

#[test]
fn the_bundle_lands_where_the_owner_was_told_it_would() {
    let home = tempdir();
    let paths = harbor(&home);
    assert_eq!(
        paths.compose,
        home.path().join(".vingilot/harbor/harbor-compose.yml")
    );
    assert_eq!(paths.env, home.path().join(".vingilot/harbor.env"));
}

// ---------------------------------------------------------------------------
// Arg vectors
// ---------------------------------------------------------------------------

#[test]
fn every_compose_call_carries_the_project_the_file_and_the_env_file() {
    // Forgetting --env-file is not cosmetic: the compose file declares its
    // secrets with ${VAR:?…}, so a call without it fails on every subcommand,
    // `ps` included — which would make a running harbor read as unknown.
    let home = tempdir();
    let paths = harbor(&home);
    let compose = paths.compose.to_string_lossy().into_owned();
    let env = paths.env.to_string_lossy().into_owned();
    for args in [
        up_args(&paths),
        wait_args(&paths),
        stop_args(&paths),
        ps_args(&paths),
    ] {
        assert_eq!(args[0], "compose");
        assert_eq!(args[1], "--project-name");
        assert_eq!(args[2], PROJECT_NAME);
        assert_eq!(args[3], "--file");
        assert_eq!(args[4], compose);
        assert_eq!(args[5], "--env-file");
        assert_eq!(args[6], env);
    }
}

#[test]
fn a_home_directory_with_a_space_in_it_stays_one_argument() {
    // The reason this island builds vectors and never a shell string. macOS home
    // directories with spaces are ordinary, and a `sh -c` would split this into
    // two paths that both do not exist.
    let outer = tempdir();
    let home = outer.path().join("Ahmet's Mac & co");
    if let Err(error) = fs::create_dir(&home) {
        panic!("could not create {}: {error}", home.display());
    }
    let paths = paths_in(&home);
    let args = up_args(&paths);
    assert!(args[4].contains("Ahmet's Mac & co"));
    assert_eq!(args.iter().filter(|arg| arg.contains(" ")).count(), 2);
}

#[test]
fn the_two_up_calls_differ_only_in_the_wait() {
    // "starting" and "waiting" are two steps so the owner knows which one he is
    // waiting on; they are the same command because `up` is idempotent, and if
    // they ever stopped being the same command the second one would recreate
    // containers the first one just made.
    let home = tempdir();
    let paths = harbor(&home);
    let up = up_args(&paths);
    let wait = wait_args(&paths);
    assert_eq!(&wait[..up.len()], &up[..]);
    assert_eq!(
        &wait[up.len()..],
        &[
            "--wait".to_owned(),
            "--wait-timeout".to_owned(),
            WAIT_TIMEOUT_SECONDS.to_string()
        ]
    );
}

#[test]
fn stopping_never_reaches_for_down() {
    // `down` removes the containers; the harbor's volumes are the owner's
    // messages, and removal is a command he runs himself.
    let home = tempdir();
    let paths = harbor(&home);
    let args = stop_args(&paths);
    assert_eq!(args.last().map(String::as_str), Some("stop"));
    assert!(!args.iter().any(|arg| arg == "down"));
    assert!(!args.iter().any(|arg| arg == "--volumes"));
}

#[test]
fn the_probe_asks_docker_info_for_one_field() {
    assert_eq!(info_args()[0], "info");
    assert!(info_args().contains(&"{{.ServerVersion}}".to_owned()));
}

#[test]
fn the_uninstall_words_name_this_machines_real_paths_and_volumes() {
    let home = tempdir();
    let paths = harbor(&home);
    let words = uninstall_commands(&paths);
    assert!(words
        .down
        .starts_with("docker compose --project-name vingilot-harbor"));
    assert!(words.down.ends_with(" down"));
    assert!(words
        .down
        .contains(&paths.compose.to_string_lossy().into_owned()));
    assert_eq!(
        words.volumes,
        "docker volume rm vingilot-harbor_postgres-data vingilot-harbor_redis-data vingilot-harbor_git-data"
    );
}

// ---------------------------------------------------------------------------
// Reading docker's answers
// ---------------------------------------------------------------------------

#[test]
fn docker_absent_and_docker_asleep_are_two_different_answers() {
    let absent = classify_probe(Err(DockerError::Absent));
    assert_eq!(absent.docker, HarborDocker::Absent);
    assert!(absent.install_url.is_some(), "no way out was offered");
    assert!(absent
        .refusal
        .unwrap_or_default()
        .contains("docker.com/products/docker-desktop"));

    let asleep = classify_probe(Err(DockerError::Refused {
        code: Some(1),
        stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock.".to_owned(),
    }));
    assert_eq!(asleep.docker, HarborDocker::NotRunning);
    // An install link here would send somebody who has Docker to download it
    // again — the one answer that wastes his time.
    assert_eq!(asleep.install_url, None);
    assert!(asleep
        .refusal
        .unwrap_or_default()
        .contains("Cannot connect to the Docker daemon"));

    let ready = classify_probe(Ok("27.4.0\n".to_owned()));
    assert_eq!(ready.docker, HarborDocker::Ready);
    assert_eq!(ready.refusal, None);
    assert_eq!(ready.engine, Some("27.4.0".to_owned()));
}

#[test]
fn the_binary_is_looked_for_on_path_before_the_app_bundle() {
    // A Dock-launched build does not inherit a login shell's PATH, which is why
    // the bundle paths are in the list at all; a bundle path that won a race
    // with PATH would ignore a `docker` the owner deliberately put there.
    let home = tempdir();
    let all = candidates(Some(home.path()));
    assert_eq!(all.first().map(String::as_str), Some("docker"));
    assert_eq!(
        all.last().map(String::as_str),
        Some("/Applications/Docker.app/Contents/Resources/bin/docker")
    );
    assert!(all
        .iter()
        .any(|candidate| candidate.ends_with(".docker/bin/docker")));

    // With a predicate that accepts everything, the first candidate wins.
    assert_eq!(
        binary_with(Some(home.path()), &|_| true),
        Some("docker".to_owned())
    );
    // With one that accepts nothing, there is no Docker and no panic.
    assert_eq!(binary_with(Some(home.path()), &|_| false), None);
    // And PATH losing does not stop the bundle from being found.
    assert_eq!(
        binary_with(Some(home.path()), &|candidate| candidate.starts_with('/')),
        Some("/usr/local/bin/docker".to_owned())
    );
}

#[test]
fn compose_ps_is_parsed_as_json_in_both_shapes_docker_emits() {
    let ndjson = "{\"Service\":\"postgres\",\"State\":\"running\",\"Health\":\"healthy\"}\n{\"Service\":\"redis\",\"State\":\"running\",\"Health\":\"healthy\"}\n";
    let array = "[{\"Service\":\"postgres\",\"State\":\"running\",\"Health\":\"healthy\"},{\"Service\":\"redis\",\"State\":\"running\",\"Health\":\"healthy\"}]";
    let expected = vec![
        HarborService {
            service: "postgres".to_owned(),
            state: "running".to_owned(),
            health: Some("healthy".to_owned()),
        },
        HarborService {
            service: "redis".to_owned(),
            state: "running".to_owned(),
            health: Some("healthy".to_owned()),
        },
    ];
    assert_eq!(parse_ps(ndjson), Ok(expected.clone()));
    assert_eq!(parse_ps(array), Ok(expected));
    // No containers at all is an answer, not an error.
    assert_eq!(parse_ps("   \n"), Ok(Vec::new()));
    // A container with no healthcheck reports no health, which is not the same
    // as being unhealthy.
    assert_eq!(
        parse_ps("{\"Service\":\"redis\",\"State\":\"running\",\"Health\":\"\"}"),
        Ok(vec![HarborService {
            service: "redis".to_owned(),
            state: "running".to_owned(),
            health: None
        }])
    );
    // Half an answer is an error: derived from half the containers, a running
    // harbor reads as stopped.
    assert!(parse_ps("not json").is_err());
    assert!(parse_ps("{\"State\":\"running\"}").is_err());
}

fn service(name: &str, state: &str, health: Option<&str>) -> HarborService {
    HarborService {
        service: name.to_owned(),
        state: state.to_owned(),
        health: health.map(str::to_owned),
    }
}

#[test]
fn running_means_all_three_healthy_and_nothing_less() {
    let all = |health: Option<&str>| {
        SERVICES
            .iter()
            .map(|name| service(name, "running", health))
            .collect::<Vec<HarborService>>()
    };
    assert_eq!(derive_state(&all(Some("healthy"))), HarborState::Running);
    assert_eq!(derive_state(&all(Some("starting"))), HarborState::Starting);
    assert_eq!(
        derive_state(&all(Some("unhealthy"))),
        HarborState::Unhealthy
    );
    assert_eq!(derive_state(&[]), HarborState::Stopped);
    assert_eq!(
        derive_state(&[service("postgres", "exited", None)]),
        HarborState::Stopped
    );
    // Two of three healthy is NOT running: this is the value the door reads
    // before it hands the frontend a relay URL.
    assert_eq!(
        derive_state(&[
            service("postgres", "running", Some("healthy")),
            service("redis", "running", Some("healthy")),
        ]),
        HarborState::Starting
    );
    // One unhealthy outranks two healthy — a relay whose Postgres is unhealthy
    // accepts a socket and then fails every query.
    assert_eq!(
        derive_state(&[
            service("vingilot-relay", "running", Some("healthy")),
            service("postgres", "running", Some("healthy")),
            service("redis", "running", Some("unhealthy")),
        ]),
        HarborState::Unhealthy
    );
}

#[test]
fn a_timed_out_wait_names_the_container_that_never_went_healthy() {
    let home = tempdir();
    let paths = harbor(&home);
    let sentence = wait_timeout_sentence(
        &paths,
        Ok(vec![
            service("vingilot-relay", "running", Some("starting")),
            service("postgres", "running", Some("healthy")),
        ]),
    );
    assert!(sentence.contains(&WAIT_TIMEOUT_SECONDS.to_string()));
    assert!(sentence.contains("vingilot-relay (starting)"));
    // A service compose never created is named too — "never started" is exactly
    // what a wait timeout is often reporting.
    assert!(sentence.contains("redis (no container was created)"));
    // And it ends in something he can paste.
    assert!(sentence.contains(&logs_command(&paths, "vingilot-relay")));

    // When ps itself could not answer, that is said rather than guessed at.
    let blind = wait_timeout_sentence(&paths, Err("docker went away".to_owned()));
    assert!(blind.contains("docker went away"));

    assert_eq!(
        not_healthy(&[
            service("vingilot-relay", "running", Some("healthy")),
            service("postgres", "running", None),
            service("redis", "running", Some("healthy")),
        ]),
        Vec::<String>::new(),
        "a container with no healthcheck is not a container that is unhealthy"
    );
}

// ---------------------------------------------------------------------------
// The install sequence
// ---------------------------------------------------------------------------

#[test]
fn a_clean_install_runs_four_steps_and_ends_with_the_relay_url() {
    let home = tempdir();
    let paths = harbor(&home);
    let script = Script::ok();
    let seen: std::cell::RefCell<Vec<(HarborStepId, HarborStepState)>> =
        std::cell::RefCell::new(Vec::new());
    let report = install_and_start(&paths, &|args| script.run(args), &|step| {
        seen.borrow_mut().push((step.step, step.state))
    });
    let seen = seen.into_inner();

    assert_eq!(report.failure, None);
    assert_eq!(report.relay_url, Some(RELAY_URL.to_owned()));
    assert_eq!(
        report
            .steps
            .iter()
            .map(|step| (step.step, step.state))
            .collect::<Vec<(HarborStepId, HarborStepState)>>(),
        vec![
            (HarborStepId::CheckingDocker, HarborStepState::Done),
            (HarborStepId::WritingBundle, HarborStepState::Done),
            (HarborStepId::Starting, HarborStepState::Done),
            (HarborStepId::WaitingForHealth, HarborStepState::Done),
        ]
    );
    // Every step was announced before it was finished — the whole reason the
    // sink exists, since `up` can spend minutes pulling an image.
    assert_eq!(seen.len(), 8);
    assert_eq!(
        seen.first(),
        Some(&(HarborStepId::CheckingDocker, HarborStepState::Running))
    );

    // Three docker calls, in order, and no fourth.
    assert_eq!(
        script.calls(),
        vec![info_args(), up_args(&paths), wait_args(&paths)]
    );
    // And the bundle it wrote is on disk.
    assert!(installed(&paths));
}

#[test]
fn no_docker_stops_before_a_single_file_is_written() {
    // The order matters: a machine with no Docker must not be left with a
    // half-installed harbor and a generated password it will never use.
    let home = tempdir();
    let paths = harbor(&home);
    let script = Script::new(vec![Err(DockerError::Absent)]);
    let report = install_and_start(&paths, &|args| script.run(args), &|_| {});

    assert_eq!(report.relay_url, None);
    assert_eq!(report.steps.len(), 1);
    assert_eq!(report.steps[0].state, HarborStepState::Failed);
    assert!(report
        .failure
        .unwrap_or_default()
        .contains("docker-desktop"));
    assert!(!installed(&paths), "a refused install left files behind");
    assert!(!paths.env.exists());
}

#[test]
fn a_failed_pull_is_reported_against_the_command_that_ran() {
    let home = tempdir();
    let paths = harbor(&home);
    let script = Script::new(vec![
        Ok("27.4.0".to_owned()),
        Err(DockerError::Refused {
            code: Some(1),
            stderr: "Error response from daemon: manifest unknown".to_owned(),
        }),
    ]);
    let report = install_and_start(&paths, &|args| script.run(args), &|_| {});

    assert_eq!(report.relay_url, None);
    // Docker answered and the bundle landed; only the third step failed, and the
    // report keeps the first two so those are not confused with this.
    assert_eq!(report.steps.len(), 3);
    assert_eq!(report.steps[2].step, HarborStepId::Starting);
    let failure = report.failure.unwrap_or_default();
    assert!(failure.contains("manifest unknown"));
    assert!(failure.contains("docker compose --project-name vingilot-harbor"));
    assert!(failure.contains("up --detach"));
}

#[test]
fn a_wait_that_never_goes_healthy_names_the_container_and_not_the_exit_code() {
    let home = tempdir();
    let paths = harbor(&home);
    let script = Script::new(vec![
        Ok("27.4.0".to_owned()),
        Ok(String::new()),
        Err(DockerError::Refused {
            code: Some(1),
            stderr: "application not healthy after 600s".to_owned(),
        }),
        Ok("{\"Service\":\"vingilot-relay\",\"State\":\"running\",\"Health\":\"unhealthy\"}\n{\"Service\":\"postgres\",\"State\":\"running\",\"Health\":\"healthy\"}\n{\"Service\":\"redis\",\"State\":\"running\",\"Health\":\"healthy\"}".to_owned()),
    ]);
    let report = install_and_start(&paths, &|args| script.run(args), &|_| {});

    assert_eq!(report.relay_url, None);
    assert_eq!(report.steps.len(), 4);
    assert_eq!(report.steps[3].step, HarborStepId::WaitingForHealth);
    let failure = report.failure.unwrap_or_default();
    assert!(failure.contains("vingilot-relay (unhealthy)"));
    assert!(failure.contains("logs --tail 50 vingilot-relay"));
    // The wait failing is what triggered the ps — four calls, not three.
    assert_eq!(script.calls().len(), 4);
    assert_eq!(script.calls()[3], ps_args(&paths));
}

// ---------------------------------------------------------------------------
// Status, start, stop
// ---------------------------------------------------------------------------

#[test]
fn a_machine_with_no_bundle_is_not_installed_and_docker_is_never_asked() {
    let home = tempdir();
    let paths = harbor(&home);
    let script = Script::ok();
    let status = status_with(&paths, &|args| script.run(args));
    assert_eq!(status.state, HarborState::NotInstalled);
    assert_eq!(status.services, Vec::new());
    assert_eq!(status.relay_url, RELAY_URL);
    assert!(script.calls().is_empty(), "docker was spawned for nothing");
    // The uninstall words are there even with nothing installed, so the card can
    // print them without a second call.
    assert!(status
        .uninstall
        .volumes
        .contains("vingilot-harbor_git-data"));
}

#[test]
fn an_installed_harbor_reports_what_ps_said() {
    let home = tempdir();
    let paths = harbor(&home);
    assert!(ensure(&paths).is_ok());
    let script = Script::new(vec![Ok(
        "{\"Service\":\"vingilot-relay\",\"State\":\"running\",\"Health\":\"healthy\"}\n{\"Service\":\"postgres\",\"State\":\"running\",\"Health\":\"healthy\"}\n{\"Service\":\"redis\",\"State\":\"running\",\"Health\":\"healthy\"}"
            .to_owned(),
    )]);
    let status = status_with(&paths, &|args| script.run(args));
    assert_eq!(status.state, HarborState::Running);
    assert_eq!(status.services.len(), 3);
    assert_eq!(status.compose_is_shipped, Some(true));
    assert_eq!(status.message, None);
    assert_eq!(script.calls(), vec![ps_args(&paths)]);
}

#[test]
fn a_harbor_docker_cannot_be_asked_about_is_unknown_and_never_stopped() {
    // "Stopped" would offer a Start button that cannot work and hide the only
    // thing the owner has to fix.
    let home = tempdir();
    let paths = harbor(&home);
    assert!(ensure(&paths).is_ok());
    let script = Script::new(vec![Err(DockerError::Absent)]);
    let status = status_with(&paths, &|args| script.run(args));
    assert_eq!(status.state, HarborState::Unknown);
    assert!(status.message.is_some());
}

#[test]
fn start_and_stop_refuse_on_a_machine_with_no_harbor() {
    let home = tempdir();
    let paths = harbor(&home);
    let script = Script::ok();
    for outcome in [
        start_with(&paths, &|args| script.run(args)),
        stop_with(&paths, &|args| script.run(args)),
    ] {
        let error = outcome.err().unwrap_or_default();
        assert!(error.contains("no harbor on this machine"));
        assert!(error.contains(&paths.compose.to_string_lossy().into_owned()));
    }
    assert!(script.calls().is_empty(), "docker was asked anyway");
}

#[test]
fn start_waits_and_stop_stops() {
    let home = tempdir();
    let paths = harbor(&home);
    assert!(ensure(&paths).is_ok());

    let started = Script::ok();
    assert_eq!(start_with(&paths, &|args| started.run(args)), Ok(()));
    assert_eq!(started.calls(), vec![wait_args(&paths)]);

    let stopped = Script::ok();
    assert_eq!(stop_with(&paths, &|args| stopped.run(args)), Ok(()));
    assert_eq!(stopped.calls(), vec![stop_args(&paths)]);
}

#[test]
fn compose_args_appends_its_tail_and_nothing_else() {
    let home = tempdir();
    let paths = harbor(&home);
    let args = compose_args(&paths, &["ps", "--all"]);
    assert_eq!(args.len(), 9);
    assert_eq!(&args[7..], &["ps".to_owned(), "--all".to_owned()]);
}

/// `child_path` — the PATH a docker child inherits.
///
/// Three claims: the binary's own directory leads the additions (the
/// credential helper lives beside the binary), a directory already present in
/// the app's PATH is not repeated, and a bare `docker` (found via PATH, no
/// parent directory) still gets the well-known install locations.
#[test]
fn the_childs_path_leads_with_the_binaries_own_directory() {
    let path = super::child_path(
        "/Applications/Docker.app/Contents/Resources/bin/docker",
        Some("/usr/bin:/bin"),
        None,
    );
    let segments: Vec<&str> = path.split(':').collect();
    assert_eq!(segments[0], "/usr/bin");
    assert_eq!(segments[1], "/bin");
    assert_eq!(segments[2], "/Applications/Docker.app/Contents/Resources/bin");
    assert!(segments.contains(&"/usr/local/bin"));
    assert!(segments.contains(&"/opt/homebrew/bin"));
}

#[test]
fn a_directory_already_on_the_path_is_not_repeated() {
    let path = super::child_path("/usr/local/bin/docker", Some("/usr/local/bin:/usr/bin"), None);
    let hits = path
        .split(':')
        .filter(|segment| *segment == "/usr/local/bin")
        .count();
    assert_eq!(hits, 1);
}

#[test]
fn a_bare_docker_still_gets_the_wellknown_directories() {
    let home = TempDir::new().expect("tempdir");
    let path = super::child_path("docker", None, Some(home.path()));
    let docker_bin = home
        .path()
        .join(".docker")
        .join("bin")
        .to_string_lossy()
        .into_owned();
    let segments: Vec<&str> = path.split(':').collect();
    assert!(!path.starts_with(':'));
    assert!(segments.contains(&"/usr/local/bin"));
    assert!(segments.contains(&docker_bin.as_str()));
}
