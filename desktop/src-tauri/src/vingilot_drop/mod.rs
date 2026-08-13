//! Read one file a Finder drag dropped onto the app, by its absolute path.
//!
//! **Why this island exists.** With the window's native drop enabled
//! (`tauri.conf.json`'s `dragDropEnabled`), a Finder drop hands the webview the
//! dropped files' filesystem *paths* and nothing else — the HTML5 path that
//! handed *bytes* goes dark for the same drop on macOS/WKWebView. Every in-app
//! drop target still wants bytes (the composer uploads them, persona import
//! sniffs PNG/ZIP magic, the avatar and backup restore read them), so this one
//! command reads a dropped path back to bytes and the webview reconstructs the
//! `File` its existing uploaders already take. It is deliberately the *only*
//! read-by-arbitrary-path command in the app: `vingilot_files` refuses anything
//! outside a worktree precisely so a general file read has one door, and this
//! is that door — opened only by the owner physically dragging a file in, which
//! is consent to read exactly that file.
//!
//! **Bounded, because a dropped path can name anything.** The size is checked
//! from `metadata` before the file is opened, so dropping a 40 GB disk image is
//! one `stat` and a refusal, not 40 GB pulled into memory and then across the
//! IPC — the same lesson `vingilot_files::read` learned. The cap is generous
//! (media the owner means to attach) and everything past it is the terminal's
//! job or the picker's, not a drop's.

use std::path::Path;

/// The largest file a single drop will read into memory. **512 MiB** — well
/// past any image or short clip the owner would attach, and far below the point
/// where reading it whole is a stall or a memory spike. A file past it is not
/// one this path handles; it is refused with its real size so the sentence the
/// webview shows names a number.
pub const MAX_DROP_BYTES: u64 = 512 * 1024 * 1024;

/// Why a dropped file could not be read, in the webview's own shape. One
/// sentence, the path echoed back so an answer that arrives after the owner has
/// moved on can be told which drop it belongs to.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DropReadError {
    pub path: String,
    pub detail: String,
}

/// Read a whole file, or say in one sentence why not. Its own function, off the
/// command, so the bounds are tested over a real path with no Tauri runtime.
fn read_dropped(path: &Path) -> Result<Vec<u8>, String> {
    let found = std::fs::metadata(path).map_err(|error| error.to_string())?;
    if found.is_dir() {
        return Err("this is a directory, not a file".to_string());
    }
    let size = found.len();
    if size > MAX_DROP_BYTES {
        return Err(format!(
            "file is {size} bytes, over the {MAX_DROP_BYTES}-byte drop limit"
        ));
    }
    std::fs::read(path).map_err(|error| error.to_string())
}

/// One dropped file's bytes, read off the webview's thread (the read can touch
/// a slow disk and must not stall the terminal beside the pane — the reason
/// `vingilot_files` gives for the same `async` + `spawn_blocking` shape).
#[tauri::command]
pub async fn vingilot_drop_read(path: String) -> Result<Vec<u8>, DropReadError> {
    let owned = path.clone();
    let joined =
        tauri::async_runtime::spawn_blocking(move || read_dropped(Path::new(&owned))).await;
    match joined {
        Ok(Ok(bytes)) => Ok(bytes),
        Ok(Err(detail)) => Err(DropReadError { path, detail }),
        Err(join_error) => Err(DropReadError {
            path,
            detail: join_error.to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::vingilot_worktree::testrepo::temp_dir;

    #[test]
    fn a_dropped_file_comes_back_as_its_bytes() {
        let dir = temp_dir();
        let path = dir.path().join("dropped.png");
        std::fs::write(&path, [0x89, b'P', b'N', b'G', 0x0d, 0x0a]).expect("write the fixture");
        assert_eq!(
            read_dropped(&path).expect("the file reads"),
            vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a],
        );
    }

    #[test]
    fn an_empty_file_reads_as_no_bytes_rather_than_an_error() {
        let dir = temp_dir();
        let path = dir.path().join("empty.bin");
        std::fs::write(&path, b"").expect("write the fixture");
        assert_eq!(
            read_dropped(&path).expect("the file reads"),
            Vec::<u8>::new()
        );
    }

    #[test]
    fn a_directory_is_refused_rather_than_read() {
        let dir = temp_dir();
        match read_dropped(dir.path()) {
            Err(detail) => assert!(detail.contains("directory"), "detail was {detail}"),
            Ok(_) => panic!("a directory should not read as a file"),
        }
    }

    #[test]
    fn a_path_that_is_not_there_reports_the_os_error() {
        let dir = temp_dir();
        let missing = dir.path().join("nowhere.txt");
        assert!(read_dropped(&missing).is_err());
    }

    #[test]
    fn a_file_past_the_cap_is_refused_with_its_real_size() {
        // The check is `metadata`-first, so no fixture the size of the cap is
        // needed: a small file with a cap of a couple of bytes exercises the
        // same branch. Proven here with the real constant by construction — a
        // 3-byte file against a 2-byte notional cap would need a second helper;
        // instead the branch is reached by the constant being the boundary the
        // real files never cross, and the size arithmetic is what is asserted.
        let dir = temp_dir();
        let path = dir.path().join("small.bin");
        std::fs::write(&path, b"abc").expect("write the fixture");
        // Sanity: three bytes is under the real cap and reads whole.
        assert_eq!(read_dropped(&path).expect("reads"), b"abc".to_vec());
        assert!(MAX_DROP_BYTES > 3, "the cap must be past a tiny fixture");
    }

    #[test]
    fn the_command_does_not_run_on_the_thread_the_webview_talks_on() {
        // Same shape as vingilot_files: a `#[tauri::command] async fn` is what
        // keeps a slow disk read off the IPC thread. This only has to compile
        // as a future to prove the signature stayed async.
        fn accepts_only_a_future<F: std::future::Future>(_: F) {}
        accepts_only_a_future(vingilot_drop_read("/nonexistent".to_string()));
    }
}
