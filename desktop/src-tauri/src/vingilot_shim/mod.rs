//! The escape hatch, inward: a `vingilot` command that shows a file in the
//! running workspace (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md,
//! Task 1; VelaTerm's shim model, `vingilot/docs/research/2026-08-12-velaterm-notes.md`
//! §2).
//!
//! > *"Its mirror is `vingilot .` in a terminal opening the Deck — the door
//! > swings both ways."* — ADR-005, rung 3.
//!
//! # How the shim reaches the app, and what was rejected
//!
//! **It sends a `buzz://open?arg=…&cwd=…` deep link, through `/usr/bin/open`.**
//! That is the option with the least new surface *by a wide margin*, because it
//! adds no surface at all: the `buzz://` scheme is already registered by this
//! app's bundle, `deep_link.rs` already parses and dispatches those URLs, and
//! macOS already routes them to the running instance (launching it first when
//! it is not up, which is the behaviour the owner wants from a terminal
//! anyway). This module contributes one parse function and one arm; the
//! transport is somebody else's, already shipped and already tested.
//!
//! Rejected, and why — recorded because "why not a socket" is the question this
//! choice will be asked again in six months:
//!
//! - **A 127.0.0.1 HTTP listener** (the media proxy already binds one, so the
//!   pattern exists). It needs a *new inbound socket*, a port the shim can
//!   discover (a port file under `~/.vingilot`, with its own staleness
//!   problem), and a token — because a port on loopback is reachable by every
//!   process on the machine, so "show this file" becomes an unauthenticated
//!   local RPC unless it is defended. That is three new mechanisms and a trust
//!   boundary, for a message the OS will carry for free.
//! - **A new `vingilot://` scheme.** A second registration in `Info.plist` and
//!   `tauri.conf.json`, a second scheme for macOS to arbitrate between two
//!   installed builds of the same app, and — the real cost — a rename of the
//!   scheme the moment the fork's rebrand lands, done twice. `buzz://open`
//!   costs none of that and moves with whatever the scheme becomes.
//! - **A unix socket / a drop file under `~/.vingilot`.** Same discovery and
//!   staleness problems as the port, plus a lifecycle (who removes the socket
//!   after a crash) and a watcher in the app. It also cannot start the app,
//!   which `open` does.
//!
//! The one thing the deep link cannot do is *answer*: `open` returns as soon as
//! the URL is handed over, so the shim cannot print "that file is not in a
//! project you have added". That is why [`resolve_open`] refuses in the app and
//! the app says so on screen — the sentence has a surface to appear on, which a
//! backgrounded terminal command largely does not.
//!
//! # Where the shim lives, and where it does not
//!
//! **`~/.vingilot/bin`, prepended to the PATH of OUR terminals only**
//! (`vingilot_pty`'s spawn env). Every terminal this app opens can run
//! `vingilot` with nothing installed and nothing asked. That is the whole of
//! the automatic behaviour, and it is deliberately the whole of it: writing
//! into `/usr/local/bin` at startup is writing outside the app's own dirs
//! without being asked, which this repo's trust boundary (ADR-003) does not
//! permit.
//!
//! **For terminals that are not ours there is an explicit action** — ⌘K
//! *"Install vingilot command…"* — and it makes a *symlink*, so the shim it
//! points at is the one this app rewrites on upgrade. When the directory will
//! not take it, [`link_into`] hands back the exact `ln -s` line for the owner
//! to run himself. Nothing here runs `sudo`, prompts for a password, or edits a
//! shell profile.

use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::Serialize;

/// The state directory `vingilot_projects` and `vingilot_scratch` already own.
const STATE_DIR: &str = ".vingilot";

/// The app-owned bin directory. A directory rather than a bare file so a second
/// shim (VelaTerm has three) needs no new decision about where shims go.
const BIN_DIR: &str = "bin";

/// The command's name.
///
/// **Not `vin`.** VelaTerm's note is right that a shim must not shadow a real
/// command, and `vin` is three letters away from `vim` in a way that will cost
/// somebody a confusing minute at 2am. `vingilot` is unambiguous, it is what
/// the owner would guess, and it is what the palette row says it installs.
const SHIM_NAME: &str = "vingilot";

/// Where `/usr/local/bin` is. Named rather than inlined because it appears in a
/// sentence the owner is asked to run.
const LINK_DIR: &str = "/usr/local/bin";

/// The shim itself.
///
/// **Five working lines, and the fifth is the only one that does anything** —
/// VelaTerm's `#!/bin/sh` one-liner with the encoding it needs to be correct.
///
/// **Every byte is percent-encoded, through `od`.** A path is bytes, not
/// characters: a hand-written `case` loop over `${s#?}` gets the codepoint in
/// bash and the first byte in dash, so a Turkish filename encodes differently
/// depending on which `/bin/sh` this is. `od -An -tx1 -v` is a byte dump, and
/// over-encoding an unreserved byte is legal in a query value — so `%73%72%63`
/// is `src` to every URL parser and the ampersand, the space and the `#` that
/// would otherwise end the query are simply never characters.
///
/// **`VINGILOT_OPEN` is a test seam, said out loud.** The recorder test runs
/// this exact script with that variable pointing at a script that writes its
/// argv to a file — which is the only way to exercise the shim without opening
/// a window on the owner's machine. Its default is the absolute
/// `/usr/bin/open`, so the shim does not depend on the PATH it is found on.
pub(crate) const SHIM_SCRIPT: &str = r#"#!/bin/sh
# vingilot — show a file, or this directory, in the running Vingilot workspace.
#
#   vingilot                    this directory
#   vingilot .                  the same
#   vingilot src/main.rs        that file, in the Files viewer
#   vingilot src/main.rs:412    that file, at line 412
#
# Installed by Vingilot into ~/.vingilot/bin, which the app's own terminals get
# on their PATH. Nothing outside that directory is written unless you ask for
# it: the app's palette has "Install vingilot command…" for /usr/local/bin.
#
# Every byte of the argument is percent-encoded through od(1): a path is bytes,
# and a per-character encoder disagrees with itself across shells.
set -u
enc() { printf '%s' "$1" | od -An -tx1 -v | tr -d ' \n' | sed 's/../%&/g'; }
exec "${VINGILOT_OPEN:-/usr/bin/open}" "buzz://open?arg=$(enc "${1:-.}")&cwd=$(enc "$PWD")"
"#;

/// `rwxr-xr-x`. Executable, and writable by nobody but the owner — this file is
/// on the PATH of every shell the app opens.
const SHIM_MODE: u32 = 0o755;

pub(crate) fn bin_dir(home: &Path) -> PathBuf {
    home.join(STATE_DIR).join(BIN_DIR)
}

pub(crate) fn shim_path(home: &Path) -> PathBuf {
    bin_dir(home).join(SHIM_NAME)
}

/// Write the shim, and make it executable. Idempotent.
///
/// **Rewritten whenever the bytes differ**, so an upgrade that changes the
/// script reaches a machine that installed the old one — and *not* rewritten
/// when they match, so the common path is one read rather than a write into a
/// directory the owner may have open in a terminal. The mode is set on every
/// call regardless: a file that lost its executable bit (a restore from a
/// backup, a `cp` from another machine) is the failure that looks like the
/// feature was never there.
pub(crate) fn install_into(home: &Path) -> Result<PathBuf, String> {
    let dir = bin_dir(home);
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("could not create {}: {error}", dir.display()))?;
    let path = shim_path(home);

    let current = std::fs::read(&path).ok();
    if current.as_deref() != Some(SHIM_SCRIPT.as_bytes()) {
        // Truncating write to a fixed path we own: unlike the scratch buffer
        // there is nothing here to lose, because the only thing that ever
        // writes this file is this constant.
        let mut file = std::fs::File::create(&path)
            .map_err(|error| format!("could not write {}: {error}", path.display()))?;
        file.write_all(SHIM_SCRIPT.as_bytes())
            .map_err(|error| format!("could not write {}: {error}", path.display()))?;
    }
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(SHIM_MODE))
        .map_err(|error| format!("could not make {} executable: {error}", path.display()))?;
    Ok(path)
}

/// The PATH our terminals get.
///
/// **Prepended, and the absence of a PATH is not an empty one.** A GUI launch
/// carries a `PATH`; a test, and a stripped launcher, may not — and
/// `format!("{bin}:")` would put an empty entry in it, which POSIX reads as the
/// current directory. That is a working directory on the PATH of every shell
/// this app opens, which is exactly the thing nobody wants.
///
/// **What this cannot promise, said here rather than discovered later:** the
/// login shell re-derives its own PATH. macOS's `path_helper` (run from
/// `/etc/zprofile`) reorders it, keeping our entry; a `~/.zshrc` that *assigns*
/// `path=(…)` rather than prepending would drop it. And a tmux-backed terminal
/// attaching to a session that already existed gets that session's environment,
/// not this one — so on a machine where tmux has been running since before this
/// feature, the first new terminal is the one that has it. `vingilot` being an
/// unusual name is what makes the reordering harmless; the other two cases are
/// what the ⌘K install action is for.
pub(crate) fn prepend_path(bin: &str, existing: Option<&str>) -> String {
    match existing.filter(|value| !value.is_empty()) {
        Some(existing) => format!("{bin}:{existing}"),
        None => bin.to_owned(),
    }
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| {
        "this machine has no home directory, so there is nowhere to keep the vingilot command."
            .to_owned()
    })
}

/// The bin directory, installed on first use and remembered.
///
/// Once per app run, `tmux::path`'s argument: this sits on the path between a
/// click and a visible terminal, and a write plus a `stat` on every terminal
/// open would be a cost paid forever for a file that changes on upgrade. `None`
/// is an honest answer — the terminal still opens, it just has no `vingilot` on
/// its PATH — and it is never an error the owner is interrupted with, because
/// he did not ask for anything.
pub(crate) fn installed_bin_dir() -> Option<&'static str> {
    static DIR: OnceLock<Option<String>> = OnceLock::new();
    DIR.get_or_init(|| match home().and_then(|home| install_into(&home)) {
        Ok(_) => home()
            .ok()
            .map(|home| bin_dir(&home).to_string_lossy().into_owned()),
        Err(error) => {
            eprintln!("vingilot: the vingilot command was not installed: {error}");
            None
        }
    })
    .as_deref()
}

// ---------------------------------------------------------------------------
// What `vingilot <arg>` means
// ---------------------------------------------------------------------------

/// What the filesystem says about a candidate path: where it really is, and
/// whether it is a directory.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct Found {
    /// Canonical, so the frontend can compare it against the project paths it
    /// holds without either side guessing about symlinks or `..`.
    pub path: String,
    pub directory: bool,
}

/// One resolved `vingilot` invocation.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    pub path: String,
    /// 1-based, or absent — `filesTarget.ts`'s `null`, and the same meaning:
    /// the top of the file, not line 1 emphasised.
    pub line: Option<u32>,
    pub directory: bool,
}

/// Split a trailing `:<digits>` off a path.
///
/// Returns `None` when there is nothing that looks like a line suffix, so the
/// caller can tell "no line was asked for" from "line 0", which
/// `vingilot_editor` refuses by name.
fn split_line_suffix(arg: &str) -> Option<(&str, u32)> {
    let (head, tail) = arg.rsplit_once(':')?;
    if head.is_empty() || tail.is_empty() {
        return None;
    }
    let line: u32 = tail.parse().ok()?;
    Some((head, line))
}

/// Make `arg` absolute against `cwd`. `.` is the directory itself.
fn absolutise(arg: &str, cwd: &str) -> String {
    if arg.starts_with('/') {
        return arg.to_owned();
    }
    if arg == "." {
        return cwd.to_owned();
    }
    Path::new(cwd).join(arg).to_string_lossy().into_owned()
}

/// What `vingilot <arg>` from `cwd` is asking for.
///
/// **The whole argument is tried before the line suffix is believed**, and the
/// order is the decision. `git grep` output is `path:line`, so the suffix form
/// is the common case — but a file genuinely called `notes:2024` exists on
/// somebody's disk, and a resolver that split first would open `notes` at line
/// 2024 and never mention the file he named. Trying the literal string first
/// means the suffix is only ever read when nothing is at the literal path,
/// which is precisely when it is a suffix.
///
/// Pure over an injected `probe`, so every branch — including the two failures
/// — is tested without a filesystem, and so the same function serves the deep
/// link and any later door.
pub(crate) fn resolve_open(
    arg: &str,
    cwd: &str,
    probe: &impl Fn(&str) -> Option<Found>,
) -> Result<OpenRequest, String> {
    let whole = absolutise(arg, cwd);
    if let Some(found) = probe(&whole) {
        return Ok(OpenRequest {
            directory: found.directory,
            line: None,
            path: found.path,
        });
    }
    if let Some((head, line)) = split_line_suffix(&whole) {
        if let Some(found) = probe(head) {
            if found.directory {
                // A directory with a number after it is not a thing to land on:
                // there is no line in a directory, and silently dropping the
                // number would be the app deciding he meant something else.
                return Err(format!(
                    "{head} is a directory, so there is no line {line} in it. Name a file, or drop the :{line}."
                ));
            }
            return Ok(OpenRequest {
                directory: false,
                line: Some(line),
                path: found.path,
            });
        }
    }
    Err(format!(
        "there is nothing at {whole}. Nothing was opened — vingilot resolves a relative path against the directory you ran it in."
    ))
}

/// The production probe: canonicalise, and say whether it is a directory.
fn probe_filesystem(candidate: &str) -> Option<Found> {
    let resolved = std::fs::canonicalize(candidate).ok()?;
    let directory = resolved.is_dir();
    Some(Found {
        directory,
        path: resolved.to_string_lossy().into_owned(),
    })
}

/// Resolve one `buzz://open` deep link's parameters. Called from
/// `deep_link.rs`'s arm — the parsing and the payload live here so that the
/// upstream seam is the dispatch and nothing else (ADR-001: host, don't
/// rewrite).
pub(crate) fn open_request(arg: &str, cwd: &str) -> Result<OpenRequest, String> {
    resolve_open(arg, cwd, &probe_filesystem)
}

// ---------------------------------------------------------------------------
// The install action
// ---------------------------------------------------------------------------

/// What the ⌘K row reports back. A sentence either way: this action's whole
/// job is to end with the owner knowing what is true, including when the answer
/// is "do this yourself".
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkOutcome {
    /// True when `/usr/local/bin/vingilot` now points at the shim.
    pub linked: bool,
    pub sentence: String,
}

/// The line the owner runs when the directory will not take the link.
///
/// **The command is printed, never run under `sudo`.** A GUI app that asks for
/// an administrator password to write into `/usr/local/bin` is a GUI app
/// teaching the habit that gets people owned; and the owner of this machine has
/// a terminal open two panes away. Printing it is also the honest shape: he can
/// read it before it runs.
fn link_command(shim: &Path) -> String {
    format!("sudo ln -sf {} {LINK_DIR}/{SHIM_NAME}", shim.display())
}

/// Symlink the shim into `link_dir`, or say what to do instead.
///
/// `link_dir` is a parameter so the whole decision — already-linked, pointing
/// somewhere else, not writable — is tested against a temp directory rather
/// than against the real `/usr/local/bin`, which a test must not touch.
pub(crate) fn link_into(home: &Path, link_dir: &Path) -> Result<LinkOutcome, String> {
    let shim = install_into(home)?;
    let link = link_dir.join(SHIM_NAME);

    match std::fs::read_link(&link) {
        Ok(target) if target == shim => {
            return Ok(LinkOutcome {
                linked: true,
                sentence: format!(
                    "{} already points at this app's shim. Nothing was changed.",
                    link.display()
                ),
            })
        }
        // A link somewhere else, or a real file: another install of this app, or
        // something the owner put there. Replacing it silently would be this app
        // taking a name on his PATH that it was not given.
        Ok(target) => {
            return Ok(LinkOutcome {
                linked: false,
                sentence: format!(
                    "{} already exists and points at {}. Nothing was changed — remove it first, or run: {}",
                    link.display(),
                    target.display(),
                    link_command(&shim)
                ),
            })
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) if link.exists() => {
            return Ok(LinkOutcome {
                linked: false,
                sentence: format!(
                    "{} already exists and is not a link. Nothing was changed — move it aside first, or run: {}",
                    link.display(),
                    link_command(&shim)
                ),
            })
        }
        Err(error) => {
            return Ok(LinkOutcome {
                linked: false,
                sentence: format!(
                    "{} could not be read: {error}. Nothing was changed — you can run: {}",
                    link.display(),
                    link_command(&shim)
                ),
            })
        }
    }

    match std::os::unix::fs::symlink(&shim, &link) {
        Ok(()) => Ok(LinkOutcome {
            linked: true,
            sentence: format!(
                "{} now points at this app's shim. `vingilot <file>` works in any terminal on this machine.",
                link.display()
            ),
        }),
        // The ordinary case on a stock macOS: /usr/local/bin is root-owned, or
        // does not exist at all. Not an error — a next step.
        Err(error) => Ok(LinkOutcome {
            linked: false,
            sentence: format!(
                "{} would not take the link ({error}). Run this in a terminal and it is done: {}",
                link_dir.display(),
                link_command(&shim)
            ),
        }),
    }
}

/// Where the shim is and whether it is linked outside the app.
///
/// Read by the ⌘K row (`paletteSources.ts`'s `install-shim`, through
/// `useEscapeHatch`) when the workspace mounts and again after an install, so
/// the label reads `Install vingilot command…` or `vingilot command installed`
/// from the disk rather than promising something it has not checked. Both
/// paths are the same three fields; `link_path` and `shim_path` are what the
/// installed row prints, which is why they are strings here and not a bool.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShimStatus {
    pub shim_path: String,
    pub link_path: String,
    pub linked: bool,
}

pub(crate) fn status_of(home: &Path, link_dir: &Path) -> ShimStatus {
    let shim = shim_path(home);
    let link = link_dir.join(SHIM_NAME);
    ShimStatus {
        linked: std::fs::read_link(&link).is_ok_and(|target| target == shim),
        link_path: link.to_string_lossy().into_owned(),
        shim_path: shim.to_string_lossy().into_owned(),
    }
}

/// Where the `vingilot` command is, and whether it is on the wider PATH.
#[tauri::command]
pub async fn shim_status() -> Result<ShimStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let home = home()?;
        install_into(&home)?;
        Ok(status_of(&home, Path::new(LINK_DIR)))
    })
    .await
    .unwrap_or_else(|error| Err(format!("the shim's own worker did not run: {error}")))
}

/// Put `vingilot` on the PATH of terminals this app did not open. Only ever
/// called from an explicit ⌘K row — see the module header.
#[tauri::command]
pub async fn shim_install_link() -> Result<LinkOutcome, String> {
    tauri::async_runtime::spawn_blocking(|| link_into(&home()?, Path::new(LINK_DIR)))
        .await
        .unwrap_or_else(|error| Err(format!("the shim's own worker did not run: {error}")))
}

/// The shipped bytes, run by the shell that will run them, against a recorder
/// standing in for `open`. Its own file because it is a different kind of test
/// from the ones below — see its header.
#[cfg(test)]
#[path = "recorder_tests.rs"]
mod recorder_tests;

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;

    use tempfile::TempDir;

    fn tempdir() -> TempDir {
        match TempDir::new() {
            Ok(dir) => dir,
            Err(error) => panic!("could not create a temp dir: {error}"),
        }
    }

    fn file(path: &str) -> Option<Found> {
        Some(Found {
            directory: false,
            path: path.to_owned(),
        })
    }

    fn dir(path: &str) -> Option<Found> {
        Some(Found {
            directory: true,
            path: path.to_owned(),
        })
    }

    #[test]
    fn the_shim_lands_executable_at_the_one_path_the_ui_promises() {
        let home = tempdir();
        let path = match install_into(home.path()) {
            Ok(path) => path,
            Err(error) => panic!("install refused: {error}"),
        };
        assert_eq!(
            path,
            home.path().join(".vingilot").join("bin").join("vingilot")
        );
        let mode = match fs::metadata(&path) {
            Ok(found) => found.permissions().mode() & 0o777,
            Err(error) => panic!("could not stat the shim: {error}"),
        };
        assert_eq!(mode, SHIM_MODE);
        assert_eq!(
            fs::read_to_string(&path).expect("the shim is readable"),
            SHIM_SCRIPT
        );
    }

    #[test]
    fn an_install_over_a_stale_shim_replaces_it_and_restores_the_executable_bit() {
        // Both halves of the idempotence: an upgrade must reach a machine that
        // has the old script, and a file that lost its mode (a restore, a `cp`)
        // is the failure that looks like the feature was never installed.
        let home = tempdir();
        let path = install_into(home.path()).expect("the first install lands");
        fs::write(&path, "#!/bin/sh\nexit 1\n").expect("the stale shim is written");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).expect("the mode is dropped");

        install_into(home.path()).expect("the second install lands");
        assert_eq!(
            fs::read_to_string(&path).expect("the shim is readable"),
            SHIM_SCRIPT
        );
        assert_eq!(
            fs::metadata(&path).expect("stat").permissions().mode() & 0o777,
            SHIM_MODE
        );
    }

    #[test]
    fn an_absent_path_does_not_become_a_path_containing_the_current_directory() {
        // The one that would be a security bug rather than an inconvenience:
        // `format!("{bin}:")` puts an empty entry in PATH, and POSIX reads an
        // empty entry as `.`.
        assert_eq!(
            prepend_path("/home/x/.vingilot/bin", None),
            "/home/x/.vingilot/bin"
        );
        assert_eq!(
            prepend_path("/home/x/.vingilot/bin", Some("")),
            "/home/x/.vingilot/bin"
        );
        assert_eq!(
            prepend_path("/home/x/.vingilot/bin", Some("/usr/bin:/bin")),
            "/home/x/.vingilot/bin:/usr/bin:/bin"
        );
    }

    #[test]
    fn a_bare_vingilot_means_the_directory_you_are_standing_in() {
        let probe = |candidate: &str| {
            if candidate == "/w/repo" {
                dir("/w/repo")
            } else {
                None
            }
        };
        assert_eq!(
            resolve_open(".", "/w/repo", &probe),
            Ok(OpenRequest {
                directory: true,
                line: None,
                path: "/w/repo".to_owned(),
            })
        );
    }

    #[test]
    fn a_relative_path_resolves_against_the_directory_it_was_run_in() {
        let probe = |candidate: &str| {
            if candidate == "/w/repo/src/main.rs" {
                file("/w/repo/src/main.rs")
            } else {
                None
            }
        };
        assert_eq!(
            resolve_open("src/main.rs", "/w/repo", &probe),
            Ok(OpenRequest {
                directory: false,
                line: None,
                path: "/w/repo/src/main.rs".to_owned(),
            })
        );
    }

    #[test]
    fn a_line_suffix_lands_on_the_line() {
        let probe = |candidate: &str| {
            if candidate == "/w/repo/src/main.rs" {
                file("/w/repo/src/main.rs")
            } else {
                None
            }
        };
        assert_eq!(
            resolve_open("src/main.rs:412", "/w/repo", &probe),
            Ok(OpenRequest {
                directory: false,
                line: Some(412),
                path: "/w/repo/src/main.rs".to_owned(),
            })
        );
        // And an absolute one, which is what a pasted `git grep` line is.
        assert_eq!(
            resolve_open("/w/repo/src/main.rs:1", "/elsewhere", &probe).map(|request| request.line),
            Ok(Some(1))
        );
    }

    #[test]
    fn a_file_whose_name_ends_in_a_number_wins_over_the_line_reading() {
        // The order this resolver is built around. Splitting first would open
        // `notes` at line 2024 and never mention the file he actually named.
        let probe = |candidate: &str| {
            if candidate == "/w/notes:2024" {
                file("/w/notes:2024")
            } else {
                None
            }
        };
        assert_eq!(
            resolve_open("notes:2024", "/w", &probe),
            Ok(OpenRequest {
                directory: false,
                line: None,
                path: "/w/notes:2024".to_owned(),
            })
        );
    }

    #[test]
    fn something_that_is_not_a_line_number_is_part_of_the_name() {
        // `:main`, `:` and `:0x10` are not lines, and `:12` with nothing before
        // it names no file. **The probe answers for `/w/file.rs` on purpose**:
        // with a probe that answered nothing, a parser that read any trailing
        // text as line 1 would fall through to the same refusal and this test
        // would agree with it. Here a wrong split lands on a real file, which
        // is the failure — the owner asked for `file.rs:main` and would be
        // shown `file.rs` at line 1 as though he had.
        let probe = |candidate: &str| {
            if candidate == "/w/file.rs" {
                file("/w/file.rs")
            } else {
                None
            }
        };
        for arg in ["file.rs:main", "file.rs:", "file.rs:0x10", ":12"] {
            match resolve_open(arg, "/w", &probe) {
                Err(sentence) => assert!(
                    sentence.contains(arg) || sentence.contains("/w/"),
                    "{arg}: the sentence has to name what was looked for: {sentence}"
                ),
                other => panic!("expected {arg} to resolve to nothing, got {other:?}"),
            }
        }
    }

    #[test]
    fn a_directory_with_a_line_number_is_refused_rather_than_trimmed() {
        let probe = |candidate: &str| {
            if candidate == "/w/src" {
                dir("/w/src")
            } else {
                None
            }
        };
        match resolve_open("src:12", "/w", &probe) {
            Err(sentence) => {
                assert!(
                    sentence.contains("is a directory"),
                    "the sentence has to say what is wrong: {sentence}"
                );
                assert!(
                    sentence.contains("line 12"),
                    "and name the number it will not use: {sentence}"
                );
            }
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn nothing_there_is_a_sentence_that_names_the_path_it_looked_at() {
        let probe = |_: &str| None;
        match resolve_open("src/gone.rs", "/w/repo", &probe) {
            Err(sentence) => {
                assert!(
                    sentence.contains("/w/repo/src/gone.rs"),
                    "the absolute path is the thing he needs to see: {sentence}"
                );
                assert!(
                    sentence.contains("Nothing was opened"),
                    "and what did not happen: {sentence}"
                );
            }
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn linking_reports_what_it_did_and_never_replaces_something_else() {
        let home = tempdir();
        let bin = tempdir();

        let first = link_into(home.path(), bin.path()).expect("the link is attempted");
        assert!(first.linked, "{}", first.sentence);
        assert_eq!(
            fs::read_link(bin.path().join("vingilot")).expect("a link is there"),
            shim_path(home.path())
        );

        // Twice is not an error and is not a second link.
        let again = link_into(home.path(), bin.path()).expect("the link is attempted");
        assert!(again.linked);
        assert!(
            again.sentence.contains("already points at"),
            "{}",
            again.sentence
        );
    }

    #[test]
    fn a_name_that_belongs_to_something_else_is_left_alone_with_the_command_to_fix_it() {
        // The trust rule: this app does not take a name on his PATH it was not
        // given, and what it hands back instead is a line he can read first.
        let home = tempdir();
        let bin = tempdir();
        let other = bin.path().join("vingilot");
        fs::write(&other, "not ours").expect("the impostor is written");

        let outcome = link_into(home.path(), bin.path()).expect("the link is attempted");
        assert!(!outcome.linked);
        assert!(
            outcome.sentence.contains("Nothing was changed"),
            "{}",
            outcome.sentence
        );
        assert!(
            outcome.sentence.contains("ln -sf"),
            "the way forward has to be in it: {}",
            outcome.sentence
        );
        assert_eq!(
            fs::read_to_string(&other).expect("still there"),
            "not ours",
            "the file must be untouched"
        );
    }

    #[test]
    fn a_directory_that_will_not_take_the_link_is_a_next_step_and_not_an_error() {
        let home = tempdir();
        let missing = tempdir().path().join("no-such-dir");
        let outcome = link_into(home.path(), &missing).expect("this is never an Err");
        assert!(!outcome.linked);
        assert!(outcome.sentence.contains("ln -sf"), "{}", outcome.sentence);
    }

    #[test]
    fn status_says_linked_only_when_the_link_is_this_apps_shim() {
        let home = tempdir();
        let bin = tempdir();
        install_into(home.path()).expect("the shim lands");
        assert!(!status_of(home.path(), bin.path()).linked);

        // A link to something else is not this app's command being installed.
        std::os::unix::fs::symlink("/bin/echo", bin.path().join("vingilot"))
            .expect("the decoy link is made");
        assert!(!status_of(home.path(), bin.path()).linked);
    }

    #[test]
    fn a_link_pointing_at_another_install_is_left_alone_too() {
        // The other half of "this app does not take a name it was not given":
        // a symlink to somewhere else takes a different branch from a plain
        // file, and replacing it silently would hijack whatever put it there —
        // most likely a second install of this app.
        let home = tempdir();
        let bin = tempdir();
        let link = bin.path().join("vingilot");
        std::os::unix::fs::symlink("/bin/echo", &link).expect("the decoy link is made");

        let outcome = link_into(home.path(), bin.path()).expect("the link is attempted");
        assert!(!outcome.linked);
        assert!(
            outcome.sentence.contains("Nothing was changed"),
            "{}",
            outcome.sentence
        );
        assert!(
            outcome.sentence.contains("/bin/echo"),
            "it has to say where the existing link goes: {}",
            outcome.sentence
        );
        assert_eq!(
            fs::read_link(&link).expect("still a link"),
            std::path::PathBuf::from("/bin/echo"),
            "the link must be untouched"
        );
    }

    #[test]
    fn the_commands_do_not_run_on_the_thread_the_webview_talks_on() {
        fn accepts_only_a_future<F: std::future::Future>(_: F) {}
        accepts_only_a_future(shim_status());
        accepts_only_a_future(shim_install_link());
    }
}
