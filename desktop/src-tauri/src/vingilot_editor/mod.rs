//! The escape hatch, outward: the owner's editor, opened at file:line
//! (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 1; decided in
//! `vingilot/docs/adr/ADR-005-what-kind-of-ide.md`, rung 3).
//!
//! > *"Sending the owner to VS Code deliberately beats losing him to it."*
//!
//! **The webview never names a binary.** `editor_open` takes an editor *id* —
//! one of three words this module knows — and a worktree-relative path, and
//! derives the executable itself. That is the `vingilot_scratch` closed-route
//! model applied to an exec rather than to a file: there is no caller-supplied
//! program string to validate, no `PATH` entry to sanitise and no shell to
//! quote for, because the frontend cannot say what runs. The one thing it
//! *can* say — which file — goes through [`crate::vingilot_files::inside`], the
//! same gate the viewer's own reads pass, so the route from an arbitrary string
//! to an arbitrary exec is closed on both halves.
//!
//! **An arg vector, never a shell string.** [`launch_args`] builds a `Vec<String>`
//! and [`spawn`] hands it to `Command::args`. A path with a space, a quote or a
//! `;` in it is then one argument and stays one argument; there is no `sh -c`
//! anywhere in this file and there must not be one, because the argument being
//! passed is a filename out of the owner's own repository and filenames are not
//! a vocabulary anybody controls.
//!
//! **`open -a` is not a fallback, and its absence is the feature.** macOS's
//! `open -a "Visual Studio Code" <file>` will show the file — and will show it
//! at the top, because there is no way to carry a line number through it. The
//! whole point of this rung is *file:line*: the owner is looking at line 412 of
//! a diff and wants to be at line 412 in his editor. An `open -a` fallback would
//! turn "no editor CLI installed" into "the button works but silently forgets
//! where you were", which is worse than the honest sentence — so when nothing is
//! found, [`no_editor`] is what he reads, and it names the three CLIs and where
//! to get them.
//!
//! **PATH first, then the well-known install locations**, which is
//! [`crate::vingilot_pty::tmux`]'s rule and is here for that module's exact
//! reason: *a desktop app launched from Finder does not inherit a login shell's
//! `PATH`*. A PATH-only probe on a Dock-launched build reports "no editor" to
//! somebody who has had Cursor installed for a year. The candidate lists below
//! therefore end with the paths each editor's own "install `code` in PATH"
//! command writes to, plus the CLI inside the .app bundle, which is there
//! whether or not he ever ran that command.
//!
//! **Probed once per app run**, `tmux::path`'s argument again: this probe costs
//! three process spawns and it sits between a click and an editor window. The
//! answer is cached, so the second click pays nothing.

use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::vingilot_files::{inside, FilesError};

/// The editors this fork knows how to open a file:line in, in the order they
/// are probed and offered.
///
/// **Three, and the order is the owner's own stack.** He works in Cursor daily
/// (ADR-005's Context quotes him), so Cursor is first; `code` is second because
/// it is the one every other tool assumes; Zed is third and is here because it
/// is the editor a Rust-and-Tauri owner is most likely to have added recently.
/// The list is closed on purpose — each entry needs a candidate list and an arg
/// vector that were checked against the real CLI, and an editor added without
/// those would be a button that fails at the moment it is trusted.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EditorId {
    Cursor,
    Vscode,
    Zed,
}

/// Every id, in probe order. One list, so the order the probe walks and the
/// order the picker draws cannot drift apart.
pub(crate) const EDITORS: [EditorId; 3] = [EditorId::Cursor, EditorId::Vscode, EditorId::Zed];

impl EditorId {
    /// The wire word. Also what a stored preference holds, which is why it is
    /// spelled out rather than derived from the variant name: renaming a Rust
    /// variant must not silently invalidate a choice the owner made months ago.
    pub(crate) fn wire(self) -> &'static str {
        match self {
            EditorId::Cursor => "cursor",
            EditorId::Vscode => "vscode",
            EditorId::Zed => "zed",
        }
    }

    /// What the owner calls it. Lives here rather than in the frontend so the
    /// refusal sentences below can name an editor in his words.
    pub(crate) fn label(self) -> &'static str {
        match self {
            EditorId::Cursor => "Cursor",
            EditorId::Vscode => "VS Code",
            EditorId::Zed => "Zed",
        }
    }

    /// Where to look, in order: the bare name for a PATH that has one, then the
    /// locations each editor's own installer writes, then the CLI inside the
    /// .app bundle — which exists on a machine where "install the shell command"
    /// was never run at all.
    pub(crate) fn candidates(self) -> &'static [&'static str] {
        match self {
            EditorId::Cursor => &[
                "cursor",
                "/opt/homebrew/bin/cursor",
                "/usr/local/bin/cursor",
                "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
            ],
            EditorId::Vscode => &[
                "code",
                "/opt/homebrew/bin/code",
                "/usr/local/bin/code",
                "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
            ],
            EditorId::Zed => &[
                "zed",
                "/opt/homebrew/bin/zed",
                "/usr/local/bin/zed",
                "/Applications/Zed.app/Contents/MacOS/cli",
            ],
        }
    }
}

/// The wire word back to an id, or `None`.
///
/// **This is the whole of the trust boundary on the exec side.** Anything the
/// webview sends that is not one of three words resolves to nothing, and
/// [`editor_open`] refuses before a `Command` is constructed — so there is no
/// path from an IPC string to a program name at all.
pub(crate) fn parse_editor_id(wire: &str) -> Option<EditorId> {
    EDITORS.into_iter().find(|editor| editor.wire() == wire)
}

/// The argument vector that opens `path` at `line`.
///
/// **Two grammars, both taken from the CLIs themselves.** Cursor is a VS Code
/// fork and takes VS Code's `--goto <file>:<line>`; Zed takes `<file>:<line>`
/// positionally and has no `--goto`. With no line there is no `--goto` on
/// either: `code --goto <file>` is accepted but means "column 1 of line 1",
/// which would put a cursor on a row the owner did not ask about — the same
/// distinction `filesTarget.ts` draws when it says `null` is not "line 1
/// emphasised".
pub(crate) fn launch_args(editor: EditorId, path: &Path, line: Option<u32>) -> Vec<String> {
    let path = path.to_string_lossy().into_owned();
    match (editor, line) {
        (_, None) => vec![path],
        (EditorId::Cursor | EditorId::Vscode, Some(line)) => {
            vec!["--goto".to_owned(), format!("{path}:{line}")]
        }
        (EditorId::Zed, Some(line)) => vec![format!("{path}:{line}")],
    }
}

/// Whether a candidate is an editor CLI that runs.
///
/// `--version` rather than a stat, for `tmux::responds_to_version`'s reason: it
/// proves the binary is executable and answers, which a file check cannot — and
/// the bare-name candidate is not a path at all, so there is nothing to stat.
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

/// The first candidate `usable` accepts for this editor.
///
/// Takes the predicate so the ordering rule — PATH before the bundle — is
/// tested without three real editors installed on the machine running `cargo
/// test`. That ordering is the part that is easy to get wrong and impossible to
/// notice: a bundle path that won a race with a PATH entry would ignore the
/// `code` the owner deliberately put on his PATH pointing at an Insiders build.
pub(crate) fn binary_for(editor: EditorId, usable: &impl Fn(&str) -> bool) -> Option<&'static str> {
    editor
        .candidates()
        .iter()
        .copied()
        .find(|candidate| usable(candidate))
}

/// Which editors this machine has, in [`EDITORS`] order.
pub(crate) fn installed_with(usable: &impl Fn(&str) -> bool) -> Vec<EditorId> {
    EDITORS
        .into_iter()
        .filter(|editor| binary_for(*editor, usable).is_some())
        .collect()
}

/// The probe, once per app run. See the module header.
fn installed() -> &'static Vec<EditorId> {
    static FOUND: OnceLock<Vec<EditorId>> = OnceLock::new();
    FOUND.get_or_init(|| installed_with(&responds_to_version))
}

/// The sentence for a machine with none of the three.
///
/// **A whole sentence, and it names the way out.** "No editor found" alone is a
/// dead end; what the owner needs to know is that these three are what is
/// looked for and that each of them installs its own shell command from inside
/// the app. The `open -a` non-fallback is argued in the module header — this is
/// where its absence becomes words he can act on.
pub(crate) fn no_editor() -> String {
    "no editor command was found. Vingilot looks for cursor, code and zed — on PATH and in the usual install locations. Each of those editors installs its shell command from its own command palette (\"Shell Command: Install 'code' command in PATH\", and the same row in Cursor and Zed); run that once and this button will find it."
        .to_owned()
}

/// The sentence for an editor that is not on this machine.
fn not_installed(editor: EditorId) -> String {
    format!(
        "{} is not on this machine — none of {} answered. Pick another editor, or install {}'s shell command from its own command palette.",
        editor.label(),
        editor.candidates().join(", "),
        editor.label()
    )
}

/// The refusal for a caller that counted lines from zero.
///
/// **Refused rather than quietly read as "the top".** A zero here is a bug in
/// whichever surface produced it, and the fix for it is to see it; normalising
/// would hide a whole class of off-by-one in every door that opens this one —
/// and `filesTarget.ts` already has a word for the top of a file, and it is
/// `null`, not `0`.
fn no_line_zero() -> String {
    "line 0 does not exist — lines are counted from 1, and the top of a file is asked for by naming no line at all.".to_owned()
}

/// What `editor_open` reports back to the surface that asked.
///
/// The `inside` refusals are re-worded here rather than passed through
/// `FilesError`: those three variants are the *viewer's* next actions ("too
/// large", "looks binary"), and none of them applies to handing a path to
/// another program. What matters here is only whether this is a file of this
/// worktree, so it is one sentence.
fn outside_refusal(worktree: &str, path: &str, error: &FilesError) -> String {
    match error {
        FilesError::NotFound { .. } => format!(
            "{path} is not in {worktree} any more. Nothing was opened — the file may have been moved or removed since this row was drawn."
        ),
        _ => format!(
            "{path} does not resolve to a file inside {worktree}, so nothing was opened."
        ),
    }
}

/// Start the editor and do not wait for it.
///
/// **Spawned and detached, with the three standard streams closed.** An editor
/// launched from a GUI app is a session that outlives the click by hours; a
/// `status()` here would block this thread for exactly that long, and an
/// inherited stdout would keep a pipe open onto a process this app has no
/// reader for. What is reported is whether the *launch* succeeded, which is the
/// only thing this side can honestly know.
fn spawn(binary: &str, args: &[String]) -> Result<(), String> {
    Command::new(binary)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_child| ())
        .map_err(|error| format!("{binary} did not start: {error}"))
}

/// What the probe answers.
///
/// **The empty case carries its own sentence**, which is why this is a struct
/// and not a bare list. "No editor found" is not a state the frontend should be
/// left to word: what the owner needs is the names of the three CLIs that were
/// looked for and the one command inside each editor that installs it — facts
/// this module holds and the webview would otherwise keep a second, drifting
/// copy of. Same rule as `filesRefusal`: the words live next to the thing they
/// are about.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorProbe {
    pub editors: Vec<EditorId>,
    /// Why there is nothing to offer, or `None` when there is.
    pub refusal: Option<String>,
}

/// Which editors are installed. An empty list is an answer — "none of the
/// three" — and it arrives with the sentence to show instead of a button that
/// cannot work.
#[tauri::command]
pub async fn editor_probe() -> EditorProbe {
    // Off the webview's thread for `vingilot_files::off_thread`'s reason: this
    // is up to three `fork`+`exec`s the first time it is called, and on macOS a
    // blocking command runs on the main thread.
    let editors = tauri::async_runtime::spawn_blocking(|| installed().clone())
        .await
        .unwrap_or_default();
    EditorProbe {
        refusal: editors.is_empty().then(no_editor),
        editors,
    }
}

/// Open `path` of `worktree` in `editor`, at `line`.
#[tauri::command]
pub async fn editor_open(
    editor: String,
    worktree: String,
    path: String,
    line: Option<u32>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        open_in(&editor, &worktree, &path, line, &responds_to_version)
    })
    .await
    .unwrap_or_else(|error| {
        Err(format!(
            "the editor launcher's own worker did not run: {error}"
        ))
    })
}

/// `editor_open`'s whole body, with the probe injected so every refusal has a
/// test that does not depend on which editors this machine happens to have.
pub(crate) fn open_in(
    editor: &str,
    worktree: &str,
    path: &str,
    line: Option<u32>,
    usable: &impl Fn(&str) -> bool,
) -> Result<(), String> {
    let Some(editor) = parse_editor_id(editor) else {
        return Err(format!(
            "{editor:?} is not an editor this app knows. Nothing was run."
        ));
    };
    if line == Some(0) {
        return Err(no_line_zero());
    }
    let resolved =
        inside(worktree, path).map_err(|error| outside_refusal(worktree, path, &error))?;
    let Some(binary) = binary_for(editor, usable) else {
        return Err(not_installed(editor));
    };
    spawn(binary, &launch_args(editor, &resolved, line))
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use std::path::PathBuf;

    use tempfile::TempDir;

    fn worktree_with(name: &str) -> (TempDir, PathBuf) {
        let dir = match TempDir::new() {
            Ok(dir) => dir,
            Err(error) => panic!("could not create a temp dir: {error}"),
        };
        let file = dir.path().join(name);
        if let Err(error) = fs::write(&file, "one\ntwo\n") {
            panic!("could not write {}: {error}", file.display());
        }
        (dir, file)
    }

    /// Nothing is usable. The predicate every refusal test that must not reach
    /// a real editor is driven with.
    fn nothing(_candidate: &str) -> bool {
        false
    }

    #[test]
    fn only_the_three_known_words_are_editors() {
        assert_eq!(parse_editor_id("cursor"), Some(EditorId::Cursor));
        assert_eq!(parse_editor_id("vscode"), Some(EditorId::Vscode));
        assert_eq!(parse_editor_id("zed"), Some(EditorId::Zed));
        // The trust boundary: everything else is nothing, including the
        // near-misses a frontend refactor would produce and the ones an
        // attacker would try.
        for wire in [
            "code",
            "Cursor",
            "vscode ",
            "",
            "/bin/sh",
            "cursor; rm -rf /",
            "../../bin/sh",
        ] {
            assert_eq!(
                parse_editor_id(wire),
                None,
                "{wire:?} must not be an editor"
            );
        }
    }

    #[test]
    fn an_unknown_editor_id_is_refused_before_anything_runs() {
        let (dir, _) = worktree_with("main.rs");
        let worktree = dir.path().to_string_lossy().into_owned();
        // `nothing` would refuse anyway, so the assertion is on WHICH refusal:
        // the id must be rejected before the probe, or an unknown id on a
        // machine with Cursor installed would get as far as a candidate list.
        let refused = open_in("emacs", &worktree, "main.rs", None, &nothing);
        match refused {
            Err(sentence) => {
                assert!(
                    sentence.contains("not an editor this app knows"),
                    "the id must be what is refused: {sentence}"
                );
                assert!(
                    sentence.contains("Nothing was run"),
                    "and it must say so: {sentence}"
                );
            }
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn a_path_outside_the_worktree_is_refused() {
        let (dir, _) = worktree_with("main.rs");
        let worktree = dir.path().to_string_lossy().into_owned();
        // Absolute, parent-relative, and a name that is simply not there. All
        // three are `inside`'s refusals, re-worded for a launch.
        for path in ["/etc/passwd", "../../../etc/passwd", "nowhere.rs"] {
            let refused = open_in("cursor", &worktree, path, None, &nothing);
            match refused {
                Err(sentence) => assert!(
                    !sentence.contains("is not on this machine"),
                    "the path must be refused before the probe: {sentence}"
                ),
                other => panic!("expected {path} to be refused, got {other:?}"),
            }
        }
    }

    #[test]
    fn line_zero_is_refused_rather_than_read_as_the_top_of_the_file() {
        let (dir, _) = worktree_with("main.rs");
        let worktree = dir.path().to_string_lossy().into_owned();
        match open_in("zed", &worktree, "main.rs", Some(0), &nothing) {
            Err(sentence) => assert!(
                sentence.contains("counted from 1"),
                "the sentence has to say what a line is: {sentence}"
            ),
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn an_editor_that_is_not_installed_is_an_honest_sentence_and_not_a_fallback() {
        // The `open -a` decision, as a test: the refusal names the editor and
        // the way to install its command, and nothing is launched instead.
        let (dir, _) = worktree_with("main.rs");
        let worktree = dir.path().to_string_lossy().into_owned();
        match open_in("vscode", &worktree, "main.rs", Some(12), &nothing) {
            Err(sentence) => {
                assert!(
                    sentence.contains("VS Code is not on this machine"),
                    "it has to name the editor: {sentence}"
                );
                assert!(
                    sentence.contains("/Applications/Visual Studio Code.app"),
                    "and where it looked: {sentence}"
                );
                assert!(
                    !sentence.contains("open -a"),
                    "there is no open -a fallback and the sentence must not imply one: {sentence}"
                );
            }
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn the_probe_prefers_path_over_the_app_bundle() {
        // The ordering rule, and the one nothing else could reach: a machine
        // with both would otherwise silently open the bundle's CLI instead of
        // the `code` the owner put on his PATH on purpose.
        let both = |candidate: &str| candidate == "code" || candidate.starts_with("/Applications/");
        assert_eq!(binary_for(EditorId::Vscode, &both), Some("code"));
        let bundle_only = |candidate: &str| candidate.starts_with("/Applications/");
        assert_eq!(
            binary_for(EditorId::Vscode, &bundle_only),
            Some("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code")
        );
    }

    #[test]
    fn the_installed_list_keeps_the_offer_order_and_is_empty_when_there_is_none() {
        let all = |_: &str| true;
        assert_eq!(
            installed_with(&all),
            vec![EditorId::Cursor, EditorId::Vscode, EditorId::Zed]
        );
        // Zed alone, and it is still Zed rather than a first-of-three guess.
        let zed_only = |candidate: &str| candidate.contains("zed") || candidate.contains("Zed.app");
        assert_eq!(installed_with(&zed_only), vec![EditorId::Zed]);
        // Empty is an answer, not an error: the frontend says `no_editor` for
        // it, which is the whole of the not-a-guess promise.
        assert!(installed_with(&nothing).is_empty());
    }

    #[test]
    fn the_no_editor_sentence_names_all_three_commands_and_no_fallback() {
        // The words the owner reads on a machine with none of them. They are
        // asserted because this sentence *is* the feature in that state: an
        // `open -a` fallback would have been the alternative, and ADR-005's
        // rung 3 is about file:line, which `open -a` cannot carry.
        let sentence = no_editor();
        for command in ["cursor", "code", "zed"] {
            assert!(
                sentence.contains(command),
                "the sentence has to name {command}: {sentence}"
            );
        }
        assert!(
            !sentence.contains("open -a"),
            "there is no fallback to offer: {sentence}"
        );
    }

    #[test]
    fn the_arg_vector_carries_the_line_in_each_editors_own_grammar() {
        let path = Path::new("/w/src/main.rs");
        assert_eq!(
            launch_args(EditorId::Cursor, path, Some(412)),
            vec!["--goto".to_owned(), "/w/src/main.rs:412".to_owned()]
        );
        assert_eq!(
            launch_args(EditorId::Vscode, path, Some(1)),
            vec!["--goto".to_owned(), "/w/src/main.rs:1".to_owned()]
        );
        // Zed has no --goto; the colon form is positional.
        assert_eq!(
            launch_args(EditorId::Zed, path, Some(412)),
            vec!["/w/src/main.rs:412".to_owned()]
        );
    }

    #[test]
    fn with_no_line_the_file_is_the_whole_argument_vector() {
        // No `--goto`, on any of the three: `--goto <file>` means line 1 column
        // 1, and a cursor put on a row he did not ask about is the distinction
        // `filesTarget.ts` calls out by name.
        let path = Path::new("/w/README.md");
        for editor in EDITORS {
            assert_eq!(
                launch_args(editor, path, None),
                vec!["/w/README.md".to_owned()],
                "{editor:?} must pass the bare path"
            );
        }
    }

    #[test]
    fn a_path_with_a_space_or_a_semicolon_stays_one_argument() {
        // The arg-vector promise, asserted rather than assumed: this is what
        // there being no `sh -c` in this file buys, and it is the reason a
        // filename out of the owner's repository is safe to pass at all.
        let path = Path::new("/w/my notes; rm -rf ~/dir/a file.md");
        assert_eq!(
            launch_args(EditorId::Cursor, path, Some(3)),
            vec![
                "--goto".to_owned(),
                "/w/my notes; rm -rf ~/dir/a file.md:3".to_owned()
            ]
        );
        assert_eq!(launch_args(EditorId::Zed, path, None).len(), 1);
    }

    #[test]
    fn a_symlink_that_leaves_the_worktree_is_refused() {
        // The case neither `..` nor an absolute path can express, and the one
        // `inside` exists for. A launch is an exec on the resolved path, so a
        // symlink out is the same escape the viewer refuses.
        let (dir, _) = worktree_with("main.rs");
        let outside = match TempDir::new() {
            Ok(dir) => dir,
            Err(error) => panic!("could not create a temp dir: {error}"),
        };
        let secret = outside.path().join("secret.txt");
        if let Err(error) = fs::write(&secret, "no") {
            panic!("could not write {}: {error}", secret.display());
        }
        let link = dir.path().join("link.txt");
        if let Err(error) = std::os::unix::fs::symlink(&secret, &link) {
            panic!("could not link {}: {error}", link.display());
        }
        let worktree = dir.path().to_string_lossy().into_owned();
        match open_in("cursor", &worktree, "link.txt", None, &nothing) {
            Err(sentence) => assert!(
                sentence.contains("does not resolve to a file inside"),
                "the sentence has to say the file is not this worktree's: {sentence}"
            ),
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn the_commands_do_not_run_on_the_thread_the_webview_talks_on() {
        // `vingilot_scratch`'s compile-time check, for the same reason: a
        // blocking command would put a fork+exec on macOS's main thread.
        fn accepts_only_a_future<F: std::future::Future>(_: F) {}
        accepts_only_a_future(editor_probe());
        accepts_only_a_future(editor_open(
            String::new(),
            String::new(),
            String::new(),
            None,
        ));
    }
}
