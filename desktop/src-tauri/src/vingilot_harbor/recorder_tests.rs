//! The arg vectors, run through a real `exec`, against a recorder rather than
//! against Docker.
//!
//! **This is the only test that proves an argument survives the trip.**
//! `harbor_tests.rs` asserts what [`super::compose`] *builds*; nothing in it
//! executes, so a vector that is correct in Rust and mangled by the process
//! boundary would pass every test in that file. Here the same vectors go through
//! [`super::run`] — the real `Command`, the real `fork`+`exec` — into a two-line
//! `/bin/sh` script that appends each argument it was handed to a file and
//! exits. Docker is never installed, never started, and never spawned; nothing
//! outside the test's own temp directory is touched.
//!
//! **The recorder has its record path baked in rather than passed in an
//! environment variable.** `vingilot_shim/recorder_tests.rs` uses
//! `VINGILOT_RECORD` because the thing it is testing is a shipped shell script
//! with that seam in it. Here there is no such seam, and reaching for
//! `std::env::set_var` would put shared mutable state under a test binary that
//! runs its tests in parallel — one test's recorder writing into another's file.
//! A generated script with an absolute path in it has no such problem.
//!
//! **The assertion is on the parsed argument list, never on the raw text.** What
//! has to be true is that a home directory containing a space and an ampersand
//! arrives at the far side as ONE argument, and that is a claim about the vector,
//! not about a spelling.

use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use super::bundle::{ensure, paths_in, HarborPaths};
use super::compose::{info_args, up_args, wait_args};
use super::{install_and_start, run, DockerError};

fn tempdir() -> TempDir {
    match TempDir::new() {
        Ok(dir) => dir,
        Err(error) => panic!("could not create a temp dir: {error}"),
    }
}

/// A stand-in for `docker` that appends every argument it was handed to
/// `record`, prints a version, and exits with `code`.
fn recorder(dir: &Path, record: &Path, code: i32, stderr: &str) -> PathBuf {
    let path = dir.join("record-docker");
    let script = format!(
        "#!/bin/sh\n\
         {{ printf 'call\\n'; for a in \"$@\"; do printf 'arg %s\\n' \"$a\"; done; }} >> '{record}'\n\
         printf '27.4.0\\n'\n\
         printf '%s' '{stderr}' >&2\n\
         exit {code}\n",
        record = record.display(),
    );
    if let Err(error) = fs::write(&path, script) {
        panic!("could not write the recorder: {error}");
    }
    if let Err(error) = fs::set_permissions(
        &path,
        <fs::Permissions as std::os::unix::fs::PermissionsExt>::from_mode(0o755),
    ) {
        panic!("could not make the recorder executable: {error}");
    }
    path
}

/// Every argument vector the recorder was handed, in order.
fn recorded(record: &Path) -> Vec<Vec<String>> {
    let raw = match fs::read_to_string(record) {
        Ok(raw) => raw,
        Err(error) => panic!("the recorder wrote nothing: {error}"),
    };
    let mut calls: Vec<Vec<String>> = Vec::new();
    for line in raw.lines() {
        if line == "call" {
            calls.push(Vec::new());
        } else if let Some(arg) = line.strip_prefix("arg ") {
            match calls.last_mut() {
                Some(call) => call.push(arg.to_owned()),
                None => panic!("the recorder wrote an argument before any call"),
            }
        } else {
            panic!("the recorder wrote a line this test cannot read: {line:?}");
        }
    }
    calls
}

/// A home directory whose name is the kind a shell string would break on.
fn awkward_home(outer: &TempDir) -> PathBuf {
    let home = outer.path().join("Ahmet's Mac & co");
    if let Err(error) = fs::create_dir(&home) {
        panic!("could not create {}: {error}", home.display());
    }
    home
}

#[test]
fn the_install_sequence_hands_exec_the_three_vectors_it_built() {
    let outer = tempdir();
    let home = awkward_home(&outer);
    let paths = paths_in(&home);
    let record = outer.path().join("recorded-args");
    let docker = recorder(outer.path(), &record, 0, "");

    let report = install_and_start(
        &paths,
        &|args| run(&docker.to_string_lossy(), args),
        &|_| {},
    );
    assert_eq!(report.failure, None);
    assert_eq!(report.relay_url.as_deref(), Some("ws://127.0.0.1:7447"));

    // Byte for byte, through a real exec — including the two arguments that
    // contain a space, an apostrophe and an ampersand.
    assert_eq!(
        recorded(&record),
        vec![info_args(), up_args(&paths), wait_args(&paths)]
    );
}

#[test]
fn a_path_a_shell_would_have_split_arrives_as_one_argument() {
    let outer = tempdir();
    let home = awkward_home(&outer);
    let paths = paths_in(&home);
    let record = outer.path().join("recorded-args");
    let docker = recorder(outer.path(), &record, 0, "");

    if let Err(error) = run(&docker.to_string_lossy(), &up_args(&paths)) {
        panic!("the recorder refused: {error:?}");
    }
    let calls = recorded(&record);
    let call = match calls.first() {
        Some(call) => call,
        None => panic!("the recorder recorded nothing"),
    };
    // Position 4 is --file's value and position 6 is --env-file's. Each is one
    // argument, and each still contains the whole awkward directory name. A
    // `sh -c` would have made four arguments out of these two.
    assert_eq!(call.len(), up_args(&paths).len());
    assert!(call[4].contains("Ahmet's Mac & co"));
    assert!(call[6].contains("Ahmet's Mac & co"));
    assert!(call[4].ends_with("harbor-compose.yml"));
    assert!(call[6].ends_with("harbor.env"));
}

#[test]
fn a_docker_that_exits_nonzero_comes_back_as_its_own_words() {
    let outer = tempdir();
    let record = outer.path().join("recorded-args");
    let docker = recorder(
        outer.path(),
        &record,
        14,
        "Cannot connect to the Docker daemon",
    );
    assert_eq!(
        run(&docker.to_string_lossy(), &info_args()),
        Err(DockerError::Refused {
            code: Some(14),
            stderr: "Cannot connect to the Docker daemon".to_owned()
        })
    );
}

#[test]
fn a_binary_that_is_not_there_is_absent_rather_than_a_panic() {
    let outer = tempdir();
    let missing = outer.path().join("no-docker-here");
    match run(&missing.to_string_lossy(), &info_args()) {
        Err(DockerError::Launch(message)) => {
            assert!(message.contains("did not start"), "{message}");
        }
        other => panic!("expected a launch failure, got {other:?}"),
    }
}

#[test]
fn a_second_install_reruns_docker_and_rewrites_nothing() {
    // The button the owner is invited to press twice. The vectors must be
    // identical the second time, and the bundle must be untouched.
    let outer = tempdir();
    let home = awkward_home(&outer);
    let paths: HarborPaths = paths_in(&home);
    let record = outer.path().join("recorded-args");
    let docker = recorder(outer.path(), &record, 0, "");

    assert!(ensure(&paths).is_ok());
    let before = match fs::read_to_string(&paths.env) {
        Ok(body) => body,
        Err(error) => panic!("could not read the env file: {error}"),
    };

    let report = install_and_start(
        &paths,
        &|args| run(&docker.to_string_lossy(), args),
        &|_| {},
    );
    assert_eq!(report.failure, None);
    match fs::read_to_string(&paths.env) {
        // Compared, never printed — see harbor_tests.rs for why.
        Ok(after) => assert!(after == before, "a second install rewrote harbor.env"),
        Err(error) => panic!("could not read the env file: {error}"),
    }
    assert_eq!(
        recorded(&record),
        vec![info_args(), up_args(&paths), wait_args(&paths)]
    );
}

/// The child's `PATH` carries the resolved binary's own directory.
///
/// This is the credential-helper defect, pinned at the same boundary that
/// caught the argument vectors: docker invokes `docker-credential-desktop`
/// via the `PATH` it inherits, and a Finder-launched app's PATH has none of
/// Docker Desktop's directories in it. The recorder here records `$PATH`
/// instead of its arguments, and the assertion is that the directory the
/// recorder itself lives in — standing in for wherever `docker` was found —
/// arrived inside it.
#[test]
fn the_child_path_carries_the_binaries_own_directory() {
    let dir = tempdir();
    let record = dir.path().join("record");
    let path = dir.path().join("path-docker");
    let script = format!(
        "#!/bin/sh\nprintf '%s' \"$PATH\" > '{record}'\n",
        record = record.display(),
    );
    if let Err(error) = fs::write(&path, script) {
        panic!("could not write the recorder: {error}");
    }
    if let Err(error) = fs::set_permissions(
        &path,
        <fs::Permissions as std::os::unix::fs::PermissionsExt>::from_mode(0o755),
    ) {
        panic!("could not mark the recorder executable: {error}");
    }

    if let Err(error) = run(&path.to_string_lossy(), &[]) {
        panic!("the recorder refused: {error:?}");
    }
    let seen = match fs::read_to_string(&record) {
        Ok(body) => body,
        Err(error) => panic!("could not read the recorded PATH: {error}"),
    };
    let parent = dir.path().to_string_lossy().into_owned();
    assert!(
        seen.split(':').any(|segment| segment == parent),
        "the child's PATH does not carry the binary's directory",
    );
}
