//! The `claude` wrapper, run for real, against a fake `claude` that records
//! what it was handed.
//!
//! **This is the only test that proves the shipped bytes are harmless.**
//! `CLAUDE_SHIM_SCRIPT` is a string constant that shadows the name of the tool
//! the owner lives in; a typo in its PATH walk, its `--settings` scan or its
//! here-doc compiles, installs, and is discovered the next time he types
//! `claude`. So it is executed here by the same `/bin/sh` that will run it,
//! with a recorder standing in for the real binary — a script that writes its
//! argv and the two variables it cares about to files and exits 0. Nothing
//! outside the test's own temp directories is read or written, no app is
//! launched, and no network is touched: the settings JSON is *inspected*, never
//! posted to.
//!
//! The assertions go through `serde_json` rather than through string
//! comparison, for `recorder_tests.rs`'s reason turned to JSON: what has to be
//! true is that Claude Code reads back five events pointing at this app's
//! endpoint, and it reads them with a JSON parser. A test pinning the exact
//! whitespace would fail the day the here-doc was reformatted and would say
//! nothing about whether the hooks work.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tempfile::TempDir;

use super::scripts::{CLAUDE_SETTINGS_VAR, CLAUDE_SHIM_NAME, HOOK_ENDPOINT_VAR};
use super::{claude_settings_path, install_into};

/// The events Claude Code accepts an `http` handler on.
///
/// **The rest take `command` handlers only** — `Notification`, `PreCompact`,
/// `SessionStart`, `SessionEnd`, `ConfigChange`, `Setup` — and this list is
/// here because an `http` entry on one of them is invisible to every other
/// assertion in this file. They all check the JSON *we write*, and that JSON is
/// perfectly well-formed while the hook it describes never fires on a real
/// machine; `asking` reaching nothing is exactly what that looks like.
const HTTP_CAPABLE: [&str; 8] = [
    "PermissionRequest",
    "PostToolUse",
    "PostToolUseFailure",
    "PreToolUse",
    "Stop",
    "SubagentStop",
    "TaskCompleted",
    "UserPromptSubmit",
];

/// A loopback endpoint URL of the shape `vingilot_hooks::endpoint_url` builds.
/// Nothing listens on it — the wrapper only ever writes it into a file.
const ENDPOINT: &str = "http://127.0.0.1:51234/hook/local:2f772f61?t=deadbeef";

fn tempdir() -> TempDir {
    match TempDir::new() {
        Ok(dir) => dir,
        Err(error) => panic!("could not create a temp dir: {error}"),
    }
}

fn executable(path: &Path, body: &str) {
    if let Err(error) = fs::write(path, body) {
        panic!("could not write {}: {error}", path.display());
    }
    if let Err(error) = fs::set_permissions(
        path,
        <fs::Permissions as std::os::unix::fs::PermissionsExt>::from_mode(0o755),
    ) {
        panic!("could not make {} executable: {error}", path.display());
    }
}

/// What the fake `claude` saw.
#[derive(Debug)]
struct Seen {
    /// One argument per line, in order — the wrapper's whole contract with
    /// every flag it does not understand.
    argv: Vec<String>,
    status: i32,
    stderr: String,
}

impl Seen {
    /// The value of `--settings`, whichever way it was spelled. `None` when the
    /// wrapper added none, which is the deferral case.
    fn settings(&self) -> Option<&str> {
        let mut args = self.argv.iter();
        while let Some(arg) = args.next() {
            if let Some(value) = arg.strip_prefix("--settings=") {
                return Some(value);
            }
            if arg == "--settings" {
                return args.next().map(String::as_str);
            }
        }
        None
    }
}

/// A whole world: a bin dir holding the installed wrappers, a `real` dir after
/// it on the PATH holding the recorder, and a home to write settings under.
struct World {
    home: TempDir,
    real: TempDir,
    /// The recorder's report file. Read after every run.
    record: PathBuf,
}

impl World {
    fn new() -> Self {
        let home = tempdir();
        install_into(home.path()).expect("the wrappers install");
        let real = tempdir();
        let record = real.path().join("argv");
        executable(
            &real.path().join(CLAUDE_SHIM_NAME),
            // `printf '%s\n'` with no arguments prints one empty line, so an
            // invocation with no arguments is recorded as an empty file rather
            // than as a blank argument.
            "#!/bin/sh\n: >\"$VINGILOT_TEST_RECORD\"\nfor a in \"$@\"; do printf '%s\\n' \"$a\" >>\"$VINGILOT_TEST_RECORD\"; done\nexit 0\n",
        );
        Self { home, real, record }
    }

    /// Run the installed wrapper with `args`, with the hook environment set
    /// unless `hooked` is false.
    fn run(&self, args: &[&str], hooked: bool) -> Seen {
        let wrapper = super::bin_dir(self.home.path()).join(CLAUDE_SHIM_NAME);
        let mut command = Command::new(&wrapper);
        command
            .args(args)
            // Our bin dir first, the recorder's second, the system's after
            // that: exactly the arrangement `terminal_env`'s PATH prepend
            // produces on a real machine. The recorder is ahead of `/usr/bin`
            // so a `claude` that happens to be installed on this machine
            // cannot be what answers.
            .env("PATH", self.path())
            .env("HOME", self.home.path())
            .env("VINGILOT_TEST_RECORD", &self.record);
        if hooked {
            // The wrapper's own constants, not string literals: `terminal_env`
            // writes these same two names on a real machine, and a test that
            // spelled them itself would pass through a rename that killed ring
            // 1 (`vingilot_shim::scripts`).
            command
                .env(HOOK_ENDPOINT_VAR, ENDPOINT)
                .env(CLAUDE_SETTINGS_VAR, self.settings_path());
        }
        let output = match command.output() {
            Ok(output) => output,
            Err(error) => panic!("the wrapper did not run: {error}"),
        };
        let argv = fs::read_to_string(&self.record)
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect();
        Seen {
            argv,
            status: output.status.code().unwrap_or(-1),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        }
    }

    fn settings_path(&self) -> PathBuf {
        claude_settings_path(self.home.path(), "local:2f772f61")
    }

    fn path(&self) -> String {
        format!(
            "{}:{}:/usr/bin:/bin",
            super::bin_dir(self.home.path()).display(),
            self.real.path().display()
        )
    }
}

/// The settings file, parsed. Answers `event -> url` so the assertions read as
/// the claim they are.
fn hooks_in(path: &Path) -> BTreeMap<String, String> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) => panic!(
            "the wrapper wrote no settings at {}: {error}",
            path.display()
        ),
    };
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(parsed) => parsed,
        Err(error) => panic!("the wrapper produced {raw:?}, which is not JSON: {error}"),
    };
    let hooks = parsed["hooks"]
        .as_object()
        .unwrap_or_else(|| panic!("no hooks object in {raw}"));
    hooks
        .iter()
        .map(|(event, groups)| {
            let handler = &groups[0]["hooks"][0];
            assert_eq!(
                handler["type"].as_str(),
                Some("http"),
                "{event} must be an http hook — a command hook would put the token in an argv"
            );
            assert!(
                HTTP_CAPABLE.contains(&event.as_str()),
                "{event} does not accept an http handler, so this hook can never fire"
            );
            (
                event.clone(),
                handler["url"]
                    .as_str()
                    .unwrap_or_else(|| panic!("{event} has no url"))
                    .to_owned(),
            )
        })
        .collect()
}

#[test]
fn the_wrapper_execs_the_real_claude_with_the_owners_flags_untouched() {
    // The contract every other test here rests on: the wrapper is a pipe. The
    // arguments below are chosen to be the ones a naive rewrite would eat — a
    // repeated flag, an empty string, one with a space in it, and `--` after
    // which nothing may be interpreted at all.
    let world = World::new();
    let args = [
        "-p",
        "summarise this",
        "--model",
        "opus",
        "",
        "--",
        "--settings-but-not-really",
    ];
    let seen = world.run(&args, true);
    assert_eq!(seen.status, 0, "{}", seen.stderr);
    assert_eq!(
        seen.argv[2..],
        args.iter().map(|a| (*a).to_owned()).collect::<Vec<_>>()[..],
        "the owner's arguments must arrive in order, after the two the wrapper adds"
    );
    assert_eq!(
        &seen.argv[..2],
        ["--settings", world.settings_path().to_str().unwrap()]
    );
}

#[test]
fn a_version_check_still_answers_and_the_wrapper_is_invisible_in_it() {
    // `claude --version` is what a script, a doctor command and a nervous owner
    // all run first. It must reach the real binary and it must not be turned
    // into a session that writes files.
    let world = World::new();
    let seen = world.run(&["--version"], false);
    assert_eq!(seen.status, 0, "{}", seen.stderr);
    assert_eq!(seen.argv, ["--version"]);
    assert!(
        !world.settings_path().exists(),
        "a terminal with no endpoint must write nothing at all"
    );
}

#[test]
fn a_settings_the_owner_passed_himself_wins_and_the_wrapper_adds_nothing() {
    // Both spellings, because `--settings x` and `--settings=x` are one flag to
    // the tool and two shapes to a `case`.
    for own in [
        vec!["--settings", "/tmp/mine.json"],
        vec!["--settings=/tmp/mine.json"],
    ] {
        let world = World::new();
        let seen = world.run(&own, true);
        assert_eq!(seen.status, 0, "{}", seen.stderr);
        assert_eq!(
            seen.argv,
            own.iter().map(|a| (*a).to_owned()).collect::<Vec<_>>(),
            "his own settings must arrive alone"
        );
        assert_eq!(seen.settings(), Some("/tmp/mine.json"));
        assert!(
            !world.settings_path().exists(),
            "deferring means writing nothing, not writing a file nobody reads"
        );
    }
}

#[test]
fn the_settings_it_writes_point_five_events_at_this_apps_endpoint() {
    let world = World::new();
    let seen = world.run(&[], true);
    assert_eq!(seen.status, 0, "{}", seen.stderr);

    let hooks = hooks_in(&world.settings_path());
    assert_eq!(
        hooks.keys().collect::<Vec<_>>(),
        vec![
            "PermissionRequest",
            "PostToolUse",
            "PreToolUse",
            "Stop",
            "UserPromptSubmit"
        ],
        "the five events vingilot_hooks::parse_event maps and Claude Code accepts http on"
    );
    // Each URL is the endpoint it was handed plus this event's label — the
    // labels `event.rs` parses, spelled its way.
    for (event, label) in [
        ("UserPromptSubmit", "prompt-submit"),
        ("PreToolUse", "pre-tool"),
        ("PostToolUse", "post-tool"),
        ("Stop", "stop"),
        ("PermissionRequest", "permission-request"),
    ] {
        assert_eq!(hooks[event], format!("{ENDPOINT}&e={label}"), "{event}");
    }
}

#[test]
fn the_settings_file_is_readable_by_nobody_but_the_owner() {
    // It holds this app run's hook token, which is the whole of the endpoint's
    // defence. A world-readable file here would hand it to every process on
    // the machine — the thing putting it in an argv would have done, and the
    // reason it is in a file at all.
    let world = World::new();
    world.run(&[], true);
    let mode = fs::metadata(world.settings_path())
        .expect("the settings file is there")
        .permissions();
    let bits = <fs::Permissions as std::os::unix::fs::PermissionsExt>::mode(&mode) & 0o777;
    assert_eq!(bits, 0o600, "mode {bits:o}");
}

#[test]
fn nothing_is_written_under_dot_claude() {
    // The plan's ephemerality promise, asserted rather than described: the
    // injection lives and dies with the app run and leaves the owner's own
    // Claude Code configuration exactly as it found it.
    let world = World::new();
    world.run(&[], true);
    assert!(
        !world.home.path().join(".claude").exists(),
        "the wrapper must never touch ~/.claude"
    );
}

#[test]
fn a_machine_with_no_real_claude_gets_the_shells_own_answer() {
    // Not a Vingilot error message: `command not found` and exit 127 are what
    // `|| brew install` and every `if ! claude --version` in a script are
    // written against, and the wrapper being on the PATH must not change them.
    let home = tempdir();
    install_into(home.path()).expect("the wrappers install");
    let empty = tempdir();
    let output = Command::new(super::bin_dir(home.path()).join(CLAUDE_SHIM_NAME))
        .env(
            "PATH",
            format!(
                "{}:{}",
                super::bin_dir(home.path()).display(),
                empty.path().display()
            ),
        )
        .env("HOME", home.path())
        .output()
        .expect("the wrapper runs");
    assert_eq!(output.status.code(), Some(127));
    assert_eq!(
        String::from_utf8_lossy(&output.stderr).trim(),
        "claude: command not found"
    );
}

#[test]
fn a_copy_of_the_wrapper_later_on_the_path_is_not_mistaken_for_the_real_one() {
    // The exec loop with no bottom: somebody symlinks or copies this wrapper
    // into /usr/local/bin, our own directory is skipped by path, and the
    // wrapper finds *itself* and runs forever. The marker check is what stops
    // it; this stages exactly that arrangement and asserts the real binary two
    // directories further along is what runs.
    //
    // **The PATH here deliberately has no `/usr/bin` on it**, which is the
    // second half of the assertion: this is how the check was found to be
    // broken. Written with `head` and `grep` it answered "not me" for every
    // candidate on a PATH where neither command exists, and this test hung
    // instead of failing. Builtins only is what makes it a guard.
    let world = World::new();
    let decoy = tempdir();
    let installed = super::bin_dir(world.home.path()).join(CLAUDE_SHIM_NAME);
    let copy = decoy.path().join(CLAUDE_SHIM_NAME);
    executable(
        &copy,
        &fs::read_to_string(&installed).expect("the wrapper is readable"),
    );

    let output = Command::new(&installed)
        .arg("--version")
        .env(
            "PATH",
            format!(
                "{}:{}:{}",
                super::bin_dir(world.home.path()).display(),
                decoy.path().display(),
                world.real.path().display()
            ),
        )
        .env("HOME", world.home.path())
        .env("VINGILOT_TEST_RECORD", &world.record)
        .output()
        .expect("the wrapper runs");
    assert_eq!(output.status.code(), Some(0));
    assert_eq!(
        fs::read_to_string(&world.record)
            .expect("the recorder ran")
            .trim(),
        "--version",
        "the real binary must be what ran, not the copy of ourselves before it"
    );
}

#[test]
fn a_run_directory_that_cannot_be_written_still_starts_claude() {
    // Every failure inside the wrapper falls through to the real binary. Here
    // the run directory's parent is a FILE, so `mkdir -p` cannot succeed — the
    // shape a hostile HOME takes — and the owner must still get his agent.
    let world = World::new();
    let blocked = world.home.path().join("blocked");
    fs::write(&blocked, "not a directory").expect("the blocker is written");
    let settings = blocked.join("run").join("claude-x.json");

    let output = Command::new(super::bin_dir(world.home.path()).join(CLAUDE_SHIM_NAME))
        .arg("--version")
        // A full PATH on purpose: `mkdir` has to be *present and refuse*, or
        // this would pass on a machine where it was simply missing and prove
        // nothing about the blocked directory.
        .env("PATH", world.path())
        .env("HOME", world.home.path())
        .env("VINGILOT_TEST_RECORD", &world.record)
        .env(HOOK_ENDPOINT_VAR, ENDPOINT)
        .env(CLAUDE_SETTINGS_VAR, &settings)
        .output()
        .expect("the wrapper runs");
    assert_eq!(output.status.code(), Some(0));
    assert_eq!(
        fs::read_to_string(&world.record)
            .expect("the recorder ran")
            .trim(),
        "--version",
        "a wrapper that cannot write its settings must still run claude"
    );
}
