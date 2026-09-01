//! One file as its bytes — the picture half of the viewer.
//!
//! Owner ask: *"html gosterme, dizayn gosterme, artifact gosterme vs hepsi
//! olsun"*. A `.png` in a worktree is a thing to look at, and [`read`] one
//! module over refuses it — correctly, because it is the read that decides a
//! file is not text and a viewer that drew a JPEG's bytes as characters is the
//! failure that refusal exists to prevent. So the picture is a second command
//! rather than a flag on the first: they are asked different questions, they
//! bound different things, and each says its own number when it is bounded.
//!
//! **Everything [`read`] is careful about, this is careful about too**, for the
//! same reasons and with the same shapes: the path goes through [`inside`]
//! before anything is opened, the size is checked with a `metadata` before the
//! file is read so a 4 GB file costs one `stat`, and the read itself is capped
//! one byte past the cap so a file that grows between the `stat` and the open is
//! caught by the read rather than by a number that is already stale.
//!
//! **What it deliberately does NOT do is sniff for NULs.** This is the command
//! asked precisely about the files that have them. There is no "is it really an
//! image" check either, and that is not an omission: what a browser will decode
//! is a browser's question, the answer arrives as a picture or as nothing, and
//! the pane has its own sentence for nothing (`filePreview.ts`'s
//! `pictureRefusal`). A magic-number table here would be a second opinion about
//! WebKit's decoders — wrong in both directions and impossible to keep in step.

use std::io::Read;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;

use super::{inside, off_thread, FilesError};

/// The largest picture this pane will put on screen, in bytes.
///
/// **4 MiB, eight times [`read::CAP_BYTES`], and the difference is the point.**
/// The 512 KiB text cap is set by what a *string* costs after it crosses the
/// IPC — JSON, a React tree, a highlighter that is superlinear in line length —
/// and none of that happens to a picture: these bytes are base64'd once, become
/// the tail of a `data:` URL, and are decoded by the same image pipeline that
/// draws every avatar in this app. What bounds them instead is the base64 itself
/// (a third larger than the file) and the copy across the bridge, and 4 MiB of
/// that is a fraction of a frame. Above it a picture is a file for Preview.app,
/// which is one keystroke away.
///
/// It is echoed in every answer and in the refusal, so nothing downstream keeps
/// a second copy of this number that could drift from it.
///
/// [`read::CAP_BYTES`]: super::read::CAP_BYTES
pub const CAP_BYTES: u64 = 4 * 1024 * 1024;

/// A file's bytes, base64'd, with the bound they were read under.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileBytes {
    /// The path as asked for, worktree-relative. Echoed for the reason
    /// [`FileText`] echoes it: the answer arrives asynchronously and the pane
    /// may have moved on to another file.
    ///
    /// [`FileText`]: super::read::FileText
    pub path: String,
    /// Standard base64, no line breaks — ready to be the tail of a `data:` URL.
    pub base64: String,
    /// Bytes on disk, before the encoding. Not the length of `base64`, which is
    /// a third larger and is not a fact about the file.
    pub bytes: usize,
    /// [`CAP_BYTES`], carried so the pane can state the ceiling it was answered
    /// under without holding its own copy.
    pub cap: u64,
}

/// Read at most `cap` bytes, and say so when there were more.
///
/// The twin of `read.rs`'s `bounded`, and separate rather than shared for the
/// one reason that matters: the two caps are different numbers with different
/// arguments behind them, and a shared helper parameterised by cap would invite
/// exactly the "make them the same, it is simpler" edit that would put a 4 MiB
/// string through the highlighter.
fn bounded(reader: impl Read, cap: u64) -> std::io::Result<Option<Vec<u8>>> {
    let mut bytes = Vec::new();
    // One past the cap, so a file that grew since the `stat` is caught here
    // rather than by trusting a number that is already out of date.
    reader.take(cap + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > cap {
        return Ok(None);
    }
    Ok(Some(bytes))
}

fn unreadable(path: &str, detail: impl ToString) -> FilesError {
    FilesError::Unreadable {
        detail: detail.to_string(),
        path: path.to_string(),
    }
}

fn read_bytes(worktree: &str, path: &str) -> Result<FileBytes, FilesError> {
    let resolved = inside(worktree, path)?;

    let found = std::fs::metadata(&resolved).map_err(|error| unreadable(path, error))?;
    if found.is_dir() {
        return Err(unreadable(path, "this is a directory"));
    }
    let size = found.len();
    if size > CAP_BYTES {
        return Err(FilesError::TooLarge {
            cap: CAP_BYTES,
            path: path.to_string(),
            size,
        });
    }

    let file = std::fs::File::open(&resolved).map_err(|error| unreadable(path, error))?;
    let Some(bytes) = bounded(file, CAP_BYTES).map_err(|error| unreadable(path, error))? else {
        // What the file is now, not what it was when this call started. The
        // fallback is the least this read *proved* rather than a guess — the
        // same understatement `read.rs`'s `too_large` makes.
        return Err(FilesError::TooLarge {
            cap: CAP_BYTES,
            path: path.to_string(),
            size: std::fs::metadata(&resolved)
                .map(|again| again.len())
                .unwrap_or(CAP_BYTES + 1),
        });
    };

    Ok(FileBytes {
        base64: STANDARD.encode(&bytes),
        bytes: bytes.len(),
        cap: CAP_BYTES,
        path: path.to_string(),
    })
}

/// One file of a worktree as bytes, or the sentence saying why not.
#[tauri::command]
pub async fn file_bytes(worktree: String, path: String) -> Result<FileBytes, FilesError> {
    off_thread("file bytes", move || read_bytes(&worktree, &path)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::vingilot_worktree::testrepo::Repo;

    /// The twelve bytes every PNG starts with: the eight-byte signature and the
    /// length field of the IHDR chunk that follows it. The length field is where
    /// the NULs are, which is the whole point — `read.rs`'s sniff sees them and
    /// refuses, and this command must not.
    const PNG_HEAD: &[u8] = &[
        0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ];

    #[test]
    fn a_file_with_nul_bytes_comes_back_where_the_text_read_refuses_it() {
        let repo = Repo::new();
        repo.write_bytes("logo.png", PNG_HEAD);

        // These are exactly the bytes `read.rs` turns away — its NUL sniff sees
        // the 0x00 in the PNG signature — and this command must not. That
        // difference is the reason the two commands exist separately, and it is
        // asserted rather than asserted-about: `read`'s own module tests own the
        // refusal, this one owns the answer.
        let read = read_bytes(&repo.path(), "logo.png").expect("the bytes read");
        assert_eq!(read.path, "logo.png");
        assert_eq!(read.bytes, PNG_HEAD.len());
        assert_eq!(read.cap, CAP_BYTES);
        // Base64 of the PNG signature, and it round-trips to the same bytes.
        assert_eq!(
            STANDARD.decode(&read.base64).expect("valid base64"),
            PNG_HEAD
        );
    }

    #[test]
    fn an_empty_file_is_an_empty_string_rather_than_a_refusal() {
        let repo = Repo::new();
        repo.write_bytes("empty.png", &[]);
        let read = read_bytes(&repo.path(), "empty.png").expect("an empty file reads");
        assert_eq!(read.bytes, 0);
        assert_eq!(read.base64, "");
    }

    #[test]
    fn a_file_past_the_cap_is_refused_with_both_numbers() {
        let repo = Repo::new();
        let big = vec![0u8; (CAP_BYTES + 1) as usize];
        repo.write_bytes("huge.png", &big);
        match read_bytes(&repo.path(), "huge.png") {
            Err(FilesError::TooLarge { cap, path, size }) => {
                assert_eq!(cap, CAP_BYTES);
                assert_eq!(path, "huge.png");
                // The file's own size, not the cap: without it he cannot tell
                // whether this is a screenshot or a video.
                assert_eq!(size, CAP_BYTES + 1);
            }
            other => panic!("expected a too-large refusal, got {other:?}"),
        }
    }

    #[test]
    fn the_read_itself_stops_one_byte_past_the_cap() {
        // The `metadata` check above stops every cap test that goes through a
        // file, so the guarantee this module's header names — the read is
        // bounded even when the file grew since the `stat` — has no fixture. A
        // cursor stands in for the file; the arithmetic is the same one the
        // real call uses.
        assert_eq!(
            bounded(std::io::Cursor::new(vec![1u8; 4]), 4).expect("reads"),
            Some(vec![1u8; 4])
        );
        assert_eq!(
            bounded(std::io::Cursor::new(vec![1u8; 5]), 4).expect("reads"),
            None
        );
    }

    #[test]
    fn a_path_that_climbs_out_of_the_worktree_is_refused_before_anything_opens() {
        // The same guard `read` is behind, asserted here too because this is a
        // second door onto the filesystem and a door is only as good as its own
        // lock.
        let repo = Repo::new();
        assert!(matches!(
            read_bytes(&repo.path(), "../outside.png"),
            Err(FilesError::OutsidePath { .. })
        ));
        assert!(matches!(
            read_bytes(&repo.path(), "/etc/passwd"),
            Err(FilesError::OutsidePath { .. })
        ));
    }

    #[test]
    fn a_directory_is_refused_as_unreadable_rather_than_read() {
        let repo = Repo::new();
        // Made directly rather than as a side effect of writing a file into it:
        // `Repo::write` is a plain `fs::write` and does not create parents, so
        // `write("src/main.rs", …)` fails on the missing `src` instead of
        // producing one. This is the same two lines `read.rs`'s own
        // `a_directory_is_refused_in_its_own_words` uses, for the same reason.
        std::fs::create_dir_all(std::path::Path::new(&repo.path()).join("src"))
            .expect("the directory is made");
        match read_bytes(&repo.path(), "src") {
            Err(FilesError::Unreadable { detail, path }) => {
                assert_eq!(path, "src");
                assert_eq!(detail, "this is a directory");
            }
            other => panic!("expected an unreadable refusal, got {other:?}"),
        }
    }

    #[test]
    fn a_file_that_has_gone_away_says_so_rather_than_reading_as_empty() {
        // `NotFound` and not `Unreadable`: "there is nothing at logo.png in this
        // worktree any more" is a different sentence with a different next
        // action from "the filesystem refused", and the pane shows both.
        let repo = Repo::new();
        match read_bytes(&repo.path(), "gone.png") {
            Err(FilesError::NotFound { path }) => assert_eq!(path, "gone.png"),
            other => panic!("expected a not-found refusal, got {other:?}"),
        }
    }
}
