//! The project list's bytes on disk
//! (vingilot/docs/plans/2026-08-10-coordinator-optional.md, Task 1).
//!
//! The list used to live only in the coordinator's workspace document, which
//! meant a machine without a coordinator — the owner's work Mac, and every
//! machine the `.dmg` is installed on — could not hold a project at all. It
//! lives here now, in `~/.vingilot/projects.json`, beside the worktree root
//! the executor already uses (`~/.vingilot/worktrees`).
//!
//! **A file rather than WebKit storage**, which is the whole reason this
//! module exists instead of two lines of `localStorage`: a webview data reset
//! clears that store without saying so, and the owner cannot open it, copy it,
//! or put it in a backup. He can do all three with this.
//!
//! **This module holds no opinion about the contents.** It moves a string to
//! and from a path. What the string means — the shape, the seed-once rule, the
//! one-direction push — is `features/runs/lib/localProjects.ts`, where it can
//! be tested without a filesystem. What is here is only what a webview cannot
//! do for itself.
//!
//! **"Not there" and "could not be read" are different answers**, and keeping
//! them apart is the load-bearing part of this file. A missing file is a
//! machine that has not added a project yet, and the caller may write to it. A
//! read that failed for any other reason is a file whose contents are unknown,
//! and writing over it would destroy a list this build merely could not open.
//! So `Ok(None)` is returned for `NotFound` alone; everything else is `Err`.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

/// The directory the workspace keeps its own state in, under the owner's home.
/// Shared with the executor's worktree root by convention, not by code — the
/// frontend spells the same prefix in `projects.ts`'s
/// `DEFAULT_WORKTREE_ROOT_SUFFIX`.
const STATE_DIR: &str = ".vingilot";
const PROJECTS_FILE: &str = "projects.json";

/// The file a save writes before it renames. A partial write under this name
/// is never a partial project list under the real one: the rename is what
/// publishes it, and a rename over an existing file is atomic on the volume
/// both paths share — which they do, being siblings.
const PROJECTS_TEMP_FILE: &str = "projects.json.writing";

fn projects_path(home: &Path) -> PathBuf {
    home.join(STATE_DIR).join(PROJECTS_FILE)
}

/// The file's contents, or `None` when there is no file yet. See the module
/// header for why those are not the same answer as an unreadable file.
pub(crate) fn load_from(home: &Path) -> Result<Option<String>, String> {
    let path = projects_path(home);
    match std::fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not read {}: {error}", path.display())),
    }
}

/// Replace the file's contents. Creates `~/.vingilot` if it is not there yet.
///
/// Nothing is removed and nothing is emptied first: the new contents are
/// written under a sibling name and renamed over the old ones, so an
/// interrupted save leaves the previous list intact rather than a truncated
/// one.
pub(crate) fn save_to(home: &Path, contents: &str) -> Result<(), String> {
    let dir = home.join(STATE_DIR);
    if let Err(error) = std::fs::create_dir_all(&dir) {
        return Err(format!("could not create {}: {error}", dir.display()));
    }

    let temp = dir.join(PROJECTS_TEMP_FILE);
    if let Err(error) = std::fs::write(&temp, contents) {
        return Err(format!("could not write {}: {error}", temp.display()));
    }

    let path = projects_path(home);
    if let Err(error) = std::fs::rename(&temp, &path) {
        return Err(format!("could not save {}: {error}", path.display()));
    }
    Ok(())
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "this machine has no home directory".to_owned())
}

/// Read the local project list. `None` means the file is not there — a
/// machine with no projects yet, which is not an error and must not be
/// reported as one.
#[tauri::command]
pub fn projects_load() -> Result<Option<String>, String> {
    load_from(&home()?)
}

/// Write the local project list.
#[tauri::command]
pub fn projects_save(contents: String) -> Result<(), String> {
    save_to(&home()?, &contents)
}

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

    #[test]
    fn a_machine_with_no_file_yet_reads_as_no_file_rather_than_as_an_error() {
        let home = tempdir();
        assert_eq!(load_from(home.path()), Ok(None));
    }

    #[test]
    fn what_was_saved_is_what_is_read_back() {
        let home = tempdir();
        let contents = "{\n  \"repos\": []\n}\n";
        assert_eq!(save_to(home.path(), contents), Ok(()));
        assert_eq!(load_from(home.path()), Ok(Some(contents.to_owned())));
    }

    #[test]
    fn the_file_lands_where_the_owner_was_told_it_would() {
        // The path is a promise the UI makes in words (`localProjects.ts`'s
        // LOCAL_PROJECTS_DISPLAY_PATH), so it is asserted rather than assumed.
        let home = tempdir();
        assert_eq!(save_to(home.path(), "{}"), Ok(()));
        assert!(home
            .path()
            .join(".vingilot")
            .join("projects.json")
            .is_file());
    }

    #[test]
    fn a_second_save_replaces_the_first_and_leaves_nothing_beside_it() {
        let home = tempdir();
        assert_eq!(save_to(home.path(), "first"), Ok(()));
        assert_eq!(save_to(home.path(), "second"), Ok(()));
        assert_eq!(load_from(home.path()), Ok(Some("second".to_owned())));
        // The write-then-rename must not leave its scratch file behind: a
        // stray projects.json.writing in a directory the owner is told to back
        // up is a second list he has no way to tell apart from the real one.
        assert!(!home
            .path()
            .join(".vingilot")
            .join("projects.json.writing")
            .exists());
    }

    #[test]
    fn a_file_that_cannot_be_read_is_an_error_and_never_an_empty_list() {
        // A directory where the file should be: readable metadata, unreadable
        // contents. If this answered Ok(None) the frontend would take it for a
        // fresh machine and write over it.
        let home = tempdir();
        let path = home.path().join(".vingilot").join("projects.json");
        if let Err(error) = fs::create_dir_all(&path) {
            panic!("could not create {}: {error}", path.display());
        }
        let read = load_from(home.path());
        assert!(read.is_err(), "expected an error, got {read:?}");
    }

    #[test]
    fn a_save_that_cannot_land_reports_it_rather_than_losing_the_old_list() {
        let home = tempdir();
        assert_eq!(save_to(home.path(), "the real list"), Ok(()));

        // The scratch path taken by a directory: the write fails, and the
        // rename never happens.
        let temp = home.path().join(".vingilot").join("projects.json.writing");
        if let Err(error) = fs::create_dir_all(&temp) {
            panic!("could not create {}: {error}", temp.display());
        }

        assert!(save_to(home.path(), "clobbered").is_err());
        assert_eq!(load_from(home.path()), Ok(Some("the real list".to_owned())));
    }
}
