//! One file, with hard bounds — and a refusal for each bound that is its own
//! sentence.
//!
//! Task 3's last checkbox: *"Large files, binary files and unreadable files each
//! get their own sentence."* Three bounds, three variants of [`FilesError`],
//! three different next actions for the owner — open it in the terminal, accept
//! that it is not text, fix a permission. A single "could not show this file"
//! covering all three would be a sentence he can do nothing with.
//!
//! **The size is checked before the file is opened.** `metadata` first, then
//! the open, so a 4 GB file costs one `stat` and not 4 GB of reads. That is the
//! lesson `vingilot_worktree/diff.rs` paid for with an agent's 191 MB `run.log`,
//! and it is why the cap is not a `truncate` after a `read_to_string`.
//!
//! **And the read itself is capped too, at one byte past the cap.** A file can
//! grow between the `stat` and the open — an agent two panes over is writing
//! into this worktree while the pane is drawn — so the size check is a fast
//! refusal and not the guarantee. `take(CAP + 1)` is the guarantee: a read that
//! reaches that length is over the cap by construction, and is refused with the
//! size the `stat` reported.

use std::io::Read;

use serde::Serialize;

use super::{inside, off_thread, FilesError};

/// The largest file this pane will put on screen, in bytes.
///
/// **512 KiB**, chosen from both ends: it is comfortably past every source file
/// in this repository (the largest is a few tens of KiB), and comfortably below
/// the point at which handing a string across the Tauri IPC, through JSON, into
/// a React tree and then into a highlighter is felt as a stall in the terminal
/// beside it. A file past it is not a file he reads in a pane — it is one he
/// opens in the terminal that is one keystroke away.
pub const CAP_BYTES: u64 = 512 * 1024;

/// How much of the file decides whether it is text.
///
/// **8 KiB**, which is what `git diff` itself sniffs, so a file this pane calls
/// binary is a file the Diff pane also refuses to render a patch for. Agreeing
/// with git here is worth more than any cleverer rule: the two surfaces are one
/// pane apart and disagreeing about the same file would look like a bug in
/// whichever one he read second.
pub const SNIFF_BYTES: usize = 8 * 1024;

/// A file's text, with what it cost to say so.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileText {
    /// The path as asked for, worktree-relative. Echoed back because the answer
    /// arrives asynchronously and the pane may have moved on: a viewer that
    /// rendered whichever read landed last would show the wrong file for the
    /// selected row, and this is what lets it drop a stale one.
    pub path: String,
    pub text: String,
    /// Bytes read. Not `text.len()` — that is the length after a lossy decode,
    /// which differs for any file that was not valid UTF-8, and the number he
    /// is shown should be the file's.
    pub bytes: usize,
    pub lines: usize,
}

/// Whether the first `SNIFF_BYTES` contain a NUL.
///
/// A heuristic, and the refusal says so: UTF-16 is full of NULs and is
/// correctly refused, but 9 KiB of ASCII in front of a blob is not caught, and
/// claiming otherwise would be claiming more than this check supports.
fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(SNIFF_BYTES).any(|byte| *byte == 0)
}

/// Lines as a reader counts them: a trailing newline ends the last line rather
/// than starting an empty one, and an empty file has no lines at all. Written
/// out because `split('\n').count()` answers 1 for an empty file and one too
/// many for every file that ends the way files end.
fn count_lines(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    text.lines().count()
}

/// The result of a bounded read: the whole thing, or the news that there was
/// more.
///
/// `Over` carries no size on purpose. All this read knows is that there was at
/// least one byte past the cap; the caller re-`stat`s for the real number,
/// because a size he is shown has to be the file's rather than the cap plus
/// one.
#[derive(Debug, Eq, PartialEq)]
enum Bounded {
    Whole(Vec<u8>),
    Over,
}

/// Read at most `cap` bytes, and say so when there were more.
///
/// **Its own function so that the guarantee this module's header names is the
/// part that gets tested.** Every cap test that goes through a file is stopped
/// by the `metadata` check above — which is the fast refusal and *not* the
/// guarantee — so a bound reached only when a file grows between the `stat` and
/// the open is a bound no fixture reaches without arranging a race. Over a
/// `Cursor` it is one line, deterministic, on every platform. The same split
/// `one_level` and `sort_entries` use in `tree.rs`, and for the same reason.
fn bounded(reader: impl Read, cap: u64) -> std::io::Result<Bounded> {
    let mut bytes = Vec::new();
    // One past the cap, so a file that grew since the `stat` is caught by the
    // read rather than by trusting a number that is already out of date.
    reader.take(cap + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > cap {
        return Ok(Bounded::Over);
    }
    Ok(Bounded::Whole(bytes))
}

/// The refusal for a read that ran past the cap, with the size it is allowed to
/// claim.
///
/// **Its own function for the same reason `bounded` is: the branch that decides
/// the number is the branch no fixture reaches.** [`Bounded::Over`] is only
/// produced when a file grows between the `stat` and the open, so the arm that
/// re-`stat`s — and the fallback for when that second `stat` fails too, because
/// the file it names may be gone by now — is arranged only by a race. Passing
/// the lookup in makes both sides one call each, and the size in the sentence is
/// the part he acts on: it is what tells him whether to reach for `less` or for
/// `head`.
///
/// The fallback is `CAP_BYTES + 1` and not a guess: it is the least this read
/// *proved*, which is understated rather than invented.
fn too_large(path: &str, size_now: impl FnOnce() -> std::io::Result<u64>) -> FilesError {
    FilesError::TooLarge {
        cap: CAP_BYTES,
        path: path.to_string(),
        size: size_now().unwrap_or(CAP_BYTES + 1),
    }
}

fn read(worktree: &str, path: &str) -> Result<FileText, FilesError> {
    let resolved = inside(worktree, path)?;

    let found = std::fs::metadata(&resolved).map_err(|error| FilesError::Unreadable {
        detail: error.to_string(),
        path: path.to_string(),
    })?;
    if found.is_dir() {
        return Err(FilesError::Unreadable {
            detail: "this is a directory".to_string(),
            path: path.to_string(),
        });
    }
    let size = found.len();
    if size > CAP_BYTES {
        return Err(FilesError::TooLarge {
            cap: CAP_BYTES,
            path: path.to_string(),
            size,
        });
    }

    let file = std::fs::File::open(&resolved).map_err(|error| FilesError::Unreadable {
        detail: error.to_string(),
        path: path.to_string(),
    })?;
    let bytes = match bounded(file, CAP_BYTES).map_err(|error| FilesError::Unreadable {
        detail: error.to_string(),
        path: path.to_string(),
    })? {
        Bounded::Whole(bytes) => bytes,
        // What the file is now, not what it was when this call started — and
        // the decision about that number is `too_large`'s, where both of its
        // branches have a test.
        Bounded::Over => {
            return Err(too_large(path, || {
                std::fs::metadata(&resolved).map(|again| again.len())
            }));
        }
    };

    if looks_binary(&bytes) {
        return Err(FilesError::Binary {
            path: path.to_string(),
        });
    }

    // Invalid UTF-8 *without* a NUL is not a fourth refusal. A Latin-1
    // changelog is a file he can read, and a sentence about encodings is a
    // sentence about an edge he does not have — the bytes that will not decode
    // become replacement characters and everything around them is still the
    // file.
    let text = String::from_utf8_lossy(&bytes).into_owned();
    Ok(FileText {
        bytes: bytes.len(),
        lines: count_lines(&text),
        path: path.to_string(),
        text,
    })
}

/// One file of a worktree, or the sentence saying why not.
#[tauri::command]
pub async fn file_read(worktree: String, path: String) -> Result<FileText, FilesError> {
    off_thread("file read", move || read(&worktree, &path)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::vingilot_worktree::testrepo::Repo;

    #[test]
    fn a_text_file_comes_back_with_its_bytes_and_its_lines() {
        let repo = Repo::new();
        repo.write("hello.rs", "fn main() {}\nfn other() {}\n");
        let read = read(&repo.path(), "hello.rs").expect("the file reads");
        assert_eq!(read.path, "hello.rs");
        assert_eq!(read.text, "fn main() {}\nfn other() {}\n");
        assert_eq!(read.bytes, "fn main() {}\nfn other() {}\n".len());
        // Two lines, not three: a trailing newline ends the last line.
        assert_eq!(read.lines, 2);
    }

    #[test]
    fn an_empty_file_has_no_lines() {
        let repo = Repo::new();
        repo.write("empty.txt", "");
        let read = read(&repo.path(), "empty.txt").expect("the file reads");
        assert_eq!(read.bytes, 0);
        assert_eq!(read.lines, 0);
        assert_eq!(read.text, "");
    }

    #[test]
    fn a_file_past_the_cap_is_refused_with_its_real_size() {
        // "Too large" without a number is a sentence he can do nothing with.
        let repo = Repo::new();
        let big = "x".repeat((CAP_BYTES + 1024) as usize);
        repo.write("huge.log", &big);
        match read(&repo.path(), "huge.log") {
            Err(FilesError::TooLarge { path, size, cap }) => {
                assert_eq!(path, "huge.log");
                assert_eq!(size, CAP_BYTES + 1024);
                assert_eq!(cap, CAP_BYTES);
            }
            other => panic!("expected a too-large refusal, got {other:?}"),
        }
    }

    #[test]
    fn a_file_exactly_at_the_cap_is_read() {
        // The boundary in the direction that matters: an off-by-one here would
        // refuse a file the cap says is fine, and nothing else would notice.
        let repo = Repo::new();
        repo.write("exact.txt", &"y".repeat(CAP_BYTES as usize));
        let read = read(&repo.path(), "exact.txt").expect("a file at the cap reads");
        assert_eq!(read.bytes, CAP_BYTES as usize);
    }

    #[test]
    fn the_read_itself_stops_one_byte_past_the_cap() {
        // **The guarantee, not the fast refusal.** The `metadata` check above
        // stops every cap test that goes through a file, so without this the
        // bound the module header calls "the guarantee" is reached by nothing:
        // deleting `take(CAP + 1)` and the length check left all of the other
        // tests green. Over a `Cursor` there is no race to arrange and no
        // filesystem to depend on.
        let over = vec![b'x'; (CAP_BYTES + 2) as usize];
        assert_eq!(
            bounded(std::io::Cursor::new(over), CAP_BYTES).expect("the read succeeds"),
            Bounded::Over
        );

        // One past is over too — that is the whole point of reading `cap + 1`.
        let just_over = vec![b'x'; (CAP_BYTES + 1) as usize];
        assert_eq!(
            bounded(std::io::Cursor::new(just_over), CAP_BYTES).expect("the read succeeds"),
            Bounded::Over
        );
    }

    #[test]
    fn a_reader_exactly_at_the_cap_comes_back_whole() {
        // The boundary in the direction that matters: an off-by-one here would
        // refuse content the cap says is fine, and would do it *after* the
        // `metadata` check had already let it through.
        let exact = vec![b'y'; CAP_BYTES as usize];
        assert_eq!(
            bounded(std::io::Cursor::new(exact.clone()), CAP_BYTES).expect("the read succeeds"),
            Bounded::Whole(exact)
        );
        assert_eq!(
            bounded(std::io::Cursor::new(Vec::new()), CAP_BYTES).expect("the read succeeds"),
            Bounded::Whole(Vec::new())
        );
    }

    #[test]
    fn the_bound_holds_when_the_size_check_was_told_a_lie() {
        // The documented case, at the size the code actually runs at: a file
        // whose `stat` said one thing and whose contents are another — an agent
        // two panes over writing into this worktree between the `stat` and the
        // open. A cap of 4 stands in for CAP_BYTES; the arithmetic is the same
        // and the test costs nothing.
        assert_eq!(
            bounded(std::io::Cursor::new(b"12345".to_vec()), 4).expect("the read succeeds"),
            Bounded::Over
        );
        assert_eq!(
            bounded(std::io::Cursor::new(b"1234".to_vec()), 4).expect("the read succeeds"),
            Bounded::Whole(b"1234".to_vec())
        );
    }

    #[test]
    fn a_read_that_ran_past_the_cap_says_what_the_file_is_now() {
        // **The sentence he is actually shown when the size check was told a
        // lie.** `bounded` proves the bound holds; this proves the number that
        // comes out of it is the file's rather than the cap plus one. Nothing
        // reaches this through a fixture — it needs a file that grew between the
        // `stat` and the open — so without this test the arm could report any
        // size at all, and the module's own comment about why `Over` carries no
        // size would be describing code that no longer did it.
        assert_eq!(
            too_large("grew.log", || Ok(CAP_BYTES * 4)),
            FilesError::TooLarge {
                cap: CAP_BYTES,
                path: "grew.log".to_string(),
                size: CAP_BYTES * 4,
            }
        );
    }

    #[test]
    fn a_size_that_cannot_be_read_again_is_understated_rather_than_invented() {
        // The other half: the file that grew has since been deleted, or the
        // directory holding it went away with the worktree. The refusal still
        // has to carry a number, and the only honest one is what this read
        // proved — one byte past the cap. Not zero, which would read as an
        // empty file being refused for being too large.
        assert_eq!(
            too_large("gone.log", || Err(std::io::Error::from(
                std::io::ErrorKind::NotFound
            ))),
            FilesError::TooLarge {
                cap: CAP_BYTES,
                path: "gone.log".to_string(),
                size: CAP_BYTES + 1,
            }
        );
    }

    #[test]
    fn a_nul_in_the_first_eight_kib_is_binary() {
        let repo = Repo::new();
        repo.write_bytes("blob.bin", &[0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0x02]);
        assert_eq!(
            read(&repo.path(), "blob.bin"),
            Err(FilesError::Binary {
                path: "blob.bin".to_string()
            })
        );
    }

    #[test]
    fn the_sniff_window_is_the_first_eight_kib_and_not_the_whole_file() {
        // The heuristic, stated as a fact rather than as an aspiration: a NUL
        // past the window is not seen, which is what "looks binary" means.
        let mut late = vec![b'a'; SNIFF_BYTES];
        late.push(0);
        assert!(!looks_binary(&late));
        let mut early = vec![b'a'; SNIFF_BYTES - 1];
        early.push(0);
        assert!(looks_binary(&early));
    }

    #[test]
    fn invalid_utf8_without_a_nul_is_shown_rather_than_refused() {
        // A Latin-1 changelog is a file he can read. There is no fourth
        // refusal here and there should not be one.
        let repo = Repo::new();
        repo.write_bytes("latin.txt", &[0x63, 0x61, 0x66, 0xe9, 0x0a]);
        let read = read(&repo.path(), "latin.txt").expect("it is still text");
        assert_eq!(read.bytes, 5);
        assert!(read.text.starts_with("caf"));
    }

    #[test]
    fn a_file_that_is_not_there_is_not_found() {
        let repo = Repo::new();
        assert_eq!(
            read(&repo.path(), "nowhere.rs"),
            Err(FilesError::NotFound {
                path: "nowhere.rs".to_string()
            })
        );
    }

    #[test]
    fn a_directory_is_refused_in_its_own_words() {
        let repo = Repo::new();
        std::fs::create_dir_all(std::path::Path::new(&repo.path()).join("src"))
            .expect("the directory is made");
        match read(&repo.path(), "src") {
            Err(FilesError::Unreadable { path, detail }) => {
                assert_eq!(path, "src");
                assert_eq!(detail, "this is a directory");
            }
            other => panic!("expected an unreadable refusal, got {other:?}"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_file_the_owner_cannot_read_reports_the_os_error() {
        use std::os::unix::fs::PermissionsExt;

        let repo = Repo::new();
        repo.write("locked.txt", "secret\n");
        let path = std::path::Path::new(&repo.path()).join("locked.txt");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000))
            .expect("the permissions are set");

        let refused = read(&repo.path(), "locked.txt");
        // Running as root defeats the mode, and CI sometimes does. The claim
        // under test is that a refusal carries the OS's own words, so a run
        // where the OS did not refuse proves nothing and says so rather than
        // failing for a reason unrelated to this module.
        if let Err(FilesError::Unreadable { path, detail }) = refused {
            assert_eq!(path, "locked.txt");
            assert!(!detail.is_empty());
        } else {
            assert!(
                refused.is_ok(),
                "expected either a read or an unreadable refusal, got {refused:?}"
            );
        }

        // Put it back so `TempDir`'s Drop can remove it. Nothing in this island
        // removes a directory by hand.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644))
            .expect("the permissions are restored");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_worktree_is_refused_rather_than_read() {
        // The reason `inside` canonicalises. Nothing about the string "escape"
        // says it leaves the checkout, and reading through it would hand the
        // webview whatever the link points at.
        let repo = Repo::new();
        let elsewhere = crate::vingilot_worktree::testrepo::temp_dir();
        let secret = elsewhere.path().join("id_rsa");
        std::fs::write(&secret, "PRIVATE KEY\n").expect("the target is written");
        std::os::unix::fs::symlink(&secret, std::path::Path::new(&repo.path()).join("escape"))
            .expect("the symlink is made");

        assert_eq!(
            read(&repo.path(), "escape"),
            Err(FilesError::OutsidePath {
                path: "escape".to_string()
            })
        );
    }

    #[test]
    fn the_command_does_not_run_on_the_thread_the_webview_talks_on() {
        fn accepts_only_a_future<F: std::future::Future>(_: F) {}
        accepts_only_a_future(file_read("/nonexistent".to_string(), "a.txt".to_string()));
    }
}
