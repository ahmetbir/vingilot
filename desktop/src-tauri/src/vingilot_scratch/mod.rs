//! The scratch markdown buffer's bytes on disk
//! (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 4).
//!
//! One file, one path, `~/.vingilot/scratch.md`, beside the project list
//! (`vingilot_projects`) and the worktree root the executor already uses. It is
//! the sibling of the scratch *shell*: one gesture away, for the thing he is
//! holding in his head right now.
//!
//! **It never leaves this machine, and that is a decision rather than an
//! omission.** This app is a relay client — it has a websocket, an event kind
//! registry and a media uploader — so "the scratch buffer is local" has to be
//! said out loud or the next person to want it on his phone will wire it to the
//! relay and be right to think that was the shape of the thing. It is not. A
//! scratch buffer on a work machine is where a password gets pasted while it is
//! being moved, where a customer's name is written down for ten minutes, where
//! half a postmortem lives before anyone has decided whether it is shareable.
//! Nothing in this module opens a socket, and nothing above it may publish this
//! text: `features/runs/lib/scratchClient.ts` calls exactly these two commands
//! and no relay module imports it.
//!
//! **A file, and not `localStorage`**, for `vingilot_projects`' reason: a
//! webview data reset clears that store without saying so, and the owner cannot
//! open it, copy it, or put it in a backup. He can do all three with this — it
//! is markdown in his own home directory, and his own editor can have it.
//!
//! **The path is not a parameter, in either direction.** `scratch_read` takes no
//! arguments and `scratch_write` takes only the text. That is the whole of the
//! path safety here: there is no caller-supplied path to canonicalise, no `..`
//! to refuse, and no symlink check to get wrong, because the webview cannot
//! name a file at all. `vingilot_files::inside` exists precisely because that
//! module's callers do name one; this one closes the route rather than guarding
//! it.
//!
//! **Bounds, and `vingilot_files/read.rs` is the model for them.** The size is
//! checked with `metadata` before the file is opened, so a buffer somebody grew
//! to a gigabyte costs one `stat` rather than a gigabyte of reads; and the read
//! itself stops one byte past the ceiling, because a `stat` is out of date the
//! moment it answers. The write is bounded too, and refuses rather than
//! truncates — truncating is losing the work this whole feature exists to keep.
//!
//! **Every refusal is a whole sentence**, and they are sentences rather than
//! variants because there is nothing here for a frontend to re-word: the
//! variants in `FilesError` earn their keep by being three different next
//! actions for the owner over a file *he chose*, and are given their words in
//! `filesModel.ts`. This module's refusals are all about one file he did not
//! choose and cannot rename, so the sentence and the reason are the same thing,
//! and `vingilot_projects` — the neighbour that owns this directory — already
//! answers `Result<_, String>` for exactly that reason.
//!
//! **"Not there" and "could not be read" are different answers**, the
//! load-bearing distinction this module shares with `vingilot_projects`. A
//! missing file is a machine that has not scratched anything yet, and the caller
//! may write to it. Anything else is a file whose contents are unknown, and the
//! caller must not autosave over it — which is why `Ok(None)` is returned for
//! `NotFound` alone.

use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};

/// The directory the workspace keeps its own state in, under the owner's home.
/// Shared with `vingilot_projects` and with the executor's worktree root by
/// convention, not by code — the frontend spells the same prefix in
/// `projects.ts`'s `DEFAULT_WORKTREE_ROOT_SUFFIX`.
const STATE_DIR: &str = ".vingilot";

/// The one file this module reads and the only file it writes. Not a parameter,
/// not derived from anything a caller said, and named `.md` because that is what
/// it holds and what the owner's own editor will want to open it as.
const SCRATCH_FILE: &str = "scratch.md";

/// The file a write lands under before it is renamed. A partial write is never a
/// partial buffer under the real name: the rename publishes it, and a rename
/// over an existing file is atomic on the volume both paths share — which they
/// do, being siblings. `vingilot_projects` writes `projects.json` the same way,
/// and here it matters more often, because this file is rewritten every few
/// seconds while he types rather than when he adds a project.
const SCRATCH_TEMP_FILE: &str = "scratch.md.writing";

/// The largest this buffer may be, in bytes.
///
/// **256 KiB, derived rather than picked.** The editing surface caps a document
/// at 40 000 characters (`features/runs/lib/documents.ts`'s
/// `MAX_DOCUMENT_CHARS`, enforced on the textarea so a keystroke past it never
/// arrives), and a character is at most four bytes of UTF-8 — 160 000 bytes in
/// the worst case that is all astral-plane text. 256 KiB is comfortably past
/// that, so **no buffer the app can produce is ever refused by this ceiling**;
/// what it refuses is a file that got large some other way, which on a path in
/// the owner's own home directory is a thing that can happen. It is also half
/// `vingilot_files`' 512 KiB view cap, which is the right relation: that one is
/// what a pane will *show*, this one is what an autosave will rewrite every few
/// seconds.
pub const CAP_BYTES: u64 = 256 * 1024;

fn scratch_path(home: &Path) -> PathBuf {
    home.join(STATE_DIR).join(SCRATCH_FILE)
}

/// The result of a bounded read: the whole thing, or the news that there was
/// more. `Over` carries no size, for `vingilot_files/read.rs`'s reason — all the
/// read knows is that there was at least one byte past the ceiling, and the size
/// in a sentence has to be the file's.
#[derive(Debug, Eq, PartialEq)]
enum Bounded {
    Whole(Vec<u8>),
    Over,
}

/// Read at most `cap` bytes, and say so when there were more.
///
/// Its own function so the guarantee is the part that gets tested: every
/// cap test that goes through a real file is stopped by the `metadata` check in
/// `load_from`, which is the fast refusal and not the guarantee. Over a `Cursor`
/// this is one line and deterministic on every platform.
fn bounded(reader: impl Read, cap: u64) -> std::io::Result<Bounded> {
    let mut bytes = Vec::new();
    // One past the ceiling, so a file that grew since the `stat` is caught by
    // the read rather than by trusting a number that is already stale.
    reader.take(cap + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > cap {
        return Ok(Bounded::Over);
    }
    Ok(Bounded::Whole(bytes))
}

/// The refusal for a file past the ceiling. The size is in it because "too
/// large" without a number is a sentence he can do nothing with: with it he
/// knows whether this is a buffer he grew by accident or a file something else
/// wrote there.
fn too_large(path: &Path, size: u64) -> String {
    format!(
        "{} is {size} bytes, past the {CAP_BYTES}-byte ceiling this buffer is kept under. Nothing was read and nothing will be written over it — open it in an editor instead.",
        path.display()
    )
}

/// The refusal for a file that is not UTF-8.
///
/// **This is a refusal here and deliberately is not one in
/// `vingilot_files/read.rs`**, which shows a Latin-1 changelog with replacement
/// characters and is right to: that pane is a reader, and a lossy decode costs
/// the owner nothing he had. This is an editor whose autosave rewrites the whole
/// file every few seconds, so a lossy decode would replace his bytes with
/// question marks the first time he typed a letter. Refusing is the only way to
/// leave the file alone.
fn not_text(path: &Path) -> String {
    format!(
        "{} is not UTF-8 text. This buffer rewrites the whole file as you type, so opening it would replace those bytes with something else — it is left exactly as it is instead.",
        path.display()
    )
}

/// The buffer's text, or `None` when there is no file yet. See the module header
/// for why those are not the same answer as a file that could not be read.
pub(crate) fn load_from(home: &Path) -> Result<Option<String>, String> {
    let path = scratch_path(home);
    let found = match std::fs::metadata(&path) {
        Ok(found) => found,
        // The one `Ok(None)`: nothing has been scratched on this machine yet.
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("could not read {}: {error}", path.display())),
    };
    if found.is_dir() {
        return Err(format!(
            "{} is a directory, not a file. This buffer will not write over it.",
            path.display()
        ));
    }
    // Before the open, so a file somebody grew costs one `stat`.
    if found.len() > CAP_BYTES {
        return Err(too_large(&path, found.len()));
    }

    let file = std::fs::File::open(&path)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;
    let bytes = match bounded(file, CAP_BYTES)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?
    {
        Bounded::Whole(bytes) => bytes,
        // The file grew between the `stat` and the open. What it is *now*, not
        // what it was when this call started; and when that second `stat` fails
        // too the number is the least this read proved — understated rather than
        // invented.
        Bounded::Over => {
            let size = std::fs::metadata(&path)
                .map(|again| again.len())
                .unwrap_or(CAP_BYTES + 1);
            return Err(too_large(&path, size));
        }
    };

    match String::from_utf8(bytes) {
        Ok(text) => Ok(Some(text)),
        Err(_) => Err(not_text(&path)),
    }
}

/// Replace the buffer's contents. Creates `~/.vingilot` if it is not there yet.
///
/// Nothing is removed and nothing is emptied first: the new contents are written
/// under a sibling name and renamed over the old ones, so an interrupted save
/// leaves the previous buffer intact rather than a truncated one.
pub(crate) fn save_to(home: &Path, text: &str) -> Result<(), String> {
    // Refused, never truncated: a ceiling applied by cutting is losing the work
    // this feature exists to keep, and the editing surface's own cap means no
    // buffer the app can produce reaches this at all (see `CAP_BYTES`).
    if text.len() as u64 > CAP_BYTES {
        return Err(format!(
            "this buffer is {} bytes, past the {CAP_BYTES}-byte ceiling. Nothing was written and nothing was cut — what is on screen is still all of it.",
            text.len()
        ));
    }

    let dir = home.join(STATE_DIR);
    if let Err(error) = std::fs::create_dir_all(&dir) {
        return Err(format!("could not create {}: {error}", dir.display()));
    }

    let temp = dir.join(SCRATCH_TEMP_FILE);
    if let Err(error) = std::fs::write(&temp, text) {
        return Err(format!("could not write {}: {error}", temp.display()));
    }

    let path = scratch_path(home);
    if let Err(error) = std::fs::rename(&temp, &path) {
        return Err(format!("could not save {}: {error}", path.display()));
    }
    Ok(())
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| {
        "this machine has no home directory, so there is nowhere to keep a scratch buffer."
            .to_owned()
    })
}

/// Run one of this module's two file operations off the thread the webview talks
/// on.
///
/// **Both commands are `async` for this one reason**, the same one
/// `vingilot_files::off_thread` documents: a `#[tauri::command]` declared `fn` is
/// generated with `ExecutionContext::Blocking`, which inlines the call into the
/// IPC scheme handler — on macOS/WKWebView, the main thread. `vingilot_projects`
/// takes that cost because a project list is written when a project is added;
/// this file is written **every few hundred milliseconds while he types**, and a
/// synchronous write on the main thread at that cadence is a stutter in the
/// terminal beside the buffer. The terminal staying responsive is the product.
async fn off_thread<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(work).await {
        Ok(answer) => answer,
        Err(error) => Err(format!(
            "the scratch buffer's own worker did not run: {error}"
        )),
    }
}

/// The scratch buffer's text. `None` means there is no file yet — a machine
/// nothing has been scratched on, which is not an error and must not be reported
/// as one.
#[tauri::command]
pub async fn scratch_read() -> Result<Option<String>, String> {
    off_thread(|| load_from(&home()?)).await
}

/// Replace the scratch buffer. There is no path parameter and there will not be
/// one — see the module header.
#[tauri::command]
pub async fn scratch_write(text: String) -> Result<(), String> {
    off_thread(move || save_to(&home()?, &text)).await
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
    fn a_machine_with_no_buffer_yet_reads_as_no_file_rather_than_as_an_error() {
        // The distinction the whole module is built around: this answer is what
        // permits the first write, and an Err here would refuse it forever.
        let home = tempdir();
        assert_eq!(load_from(home.path()), Ok(None));
    }

    #[test]
    fn what_was_written_is_what_is_read_back() {
        let home = tempdir();
        let text = "# tomorrow\n\n- [ ] the divider still eats the wheel\n";
        assert_eq!(save_to(home.path(), text), Ok(()));
        assert_eq!(load_from(home.path()), Ok(Some(text.to_owned())));
    }

    #[test]
    fn the_buffer_lands_at_the_one_path_this_module_will_ever_write() {
        // The path is a promise the UI makes in words
        // (`scratchMarkdown.ts`'s SCRATCH_MARKDOWN_PATH), and it is the whole of
        // this module's path safety — there is no argument that could move it.
        // So it is asserted rather than assumed.
        let home = tempdir();
        assert_eq!(save_to(home.path(), "x"), Ok(()));
        assert!(home.path().join(".vingilot").join("scratch.md").is_file());
        assert_eq!(
            scratch_path(home.path()),
            home.path().join(".vingilot").join("scratch.md")
        );
    }

    #[test]
    fn a_second_write_replaces_the_first_and_leaves_nothing_beside_it() {
        let home = tempdir();
        assert_eq!(save_to(home.path(), "first"), Ok(()));
        assert_eq!(save_to(home.path(), "second"), Ok(()));
        assert_eq!(load_from(home.path()), Ok(Some("second".to_owned())));
        // The write-then-rename must not leave its scratch file behind: a stray
        // scratch.md.writing in a directory the owner is told he can open is a
        // second buffer he has no way to tell from the real one.
        assert!(!home
            .path()
            .join(".vingilot")
            .join("scratch.md.writing")
            .exists());
    }

    #[test]
    fn a_buffer_at_the_ceiling_is_written_and_one_past_it_is_refused() {
        // The boundary in both directions. Refusing a buffer the ceiling says is
        // fine would lose a keystroke nothing else would notice; accepting one
        // past it would mean the number in the sentence is not the number in the
        // code.
        let home = tempdir();
        let exact = "y".repeat(CAP_BYTES as usize);
        assert_eq!(save_to(home.path(), &exact), Ok(()));
        assert_eq!(load_from(home.path()), Ok(Some(exact)));

        let over = "z".repeat((CAP_BYTES + 1) as usize);
        let refused = save_to(home.path(), &over);
        match refused {
            Err(sentence) => {
                assert!(
                    sentence.contains(&(CAP_BYTES + 1).to_string()),
                    "the refusal has to say how big it was: {sentence}"
                );
                assert!(
                    sentence.contains("nothing was cut"),
                    "a ceiling that truncated would be losing his work: {sentence}"
                );
            }
            other => panic!("expected a refusal, got {other:?}"),
        }
        // And the previous buffer is still there, whole. A refused write that
        // had already replaced the file would be the worst of both.
        assert_eq!(
            load_from(home.path()),
            Ok(Some("y".repeat(CAP_BYTES as usize)))
        );
    }

    #[test]
    fn a_file_past_the_ceiling_is_refused_with_its_real_size() {
        // "Too large" without a number is a sentence he can do nothing with.
        // This is the fast refusal — the `metadata` check before the open, which
        // is what keeps a gigabyte file from costing a gigabyte of reads.
        let home = tempdir();
        let dir = home.path().join(".vingilot");
        if let Err(error) = fs::create_dir_all(&dir) {
            panic!("could not create {}: {error}", dir.display());
        }
        let size = CAP_BYTES + 1024;
        if let Err(error) = fs::write(dir.join("scratch.md"), "x".repeat(size as usize)) {
            panic!("could not write the oversized buffer: {error}");
        }
        match load_from(home.path()) {
            Err(sentence) => {
                assert!(
                    sentence.contains(&size.to_string()),
                    "the refusal has to carry the file's own size: {sentence}"
                );
                assert!(
                    sentence.contains(&CAP_BYTES.to_string()),
                    "and the ceiling it is past: {sentence}"
                );
                assert!(
                    sentence.contains("nothing will be written over it"),
                    "the promise that matters most here: {sentence}"
                );
            }
            other => panic!("expected a too-large refusal, got {other:?}"),
        }
    }

    #[test]
    fn the_read_itself_stops_one_byte_past_the_ceiling() {
        // **The guarantee, not the fast refusal.** The `metadata` check stops
        // every cap test that goes through a real file, so without this the
        // bound the header calls the guarantee is reached by nothing: deleting
        // `take(cap + 1)` leaves every other test in this module green. Over a
        // `Cursor` there is no race to arrange and no filesystem to depend on.
        let over = vec![b'x'; (CAP_BYTES + 2) as usize];
        assert_eq!(
            bounded(std::io::Cursor::new(over), CAP_BYTES).expect("the read succeeds"),
            Bounded::Over
        );
        let just_over = vec![b'x'; (CAP_BYTES + 1) as usize];
        assert_eq!(
            bounded(std::io::Cursor::new(just_over), CAP_BYTES).expect("the read succeeds"),
            Bounded::Over
        );
    }

    #[test]
    fn a_reader_exactly_at_the_ceiling_comes_back_whole() {
        // The other side of the same off-by-one, after the `metadata` check has
        // already let the content through. An empty file too: a buffer he
        // cleared reads as the empty string, never as a refusal.
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
        // The documented case at a size the test can afford: the file grew
        // between the `stat` and the open, because his own editor was saving it
        // while the app opened the buffer. A ceiling of 4 stands in; the
        // arithmetic is the same.
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
    fn a_buffer_that_is_not_utf8_is_refused_rather_than_rewritten() {
        // The one place this module deliberately disagrees with
        // vingilot_files/read.rs, and the reason is in `not_text`: a reader can
        // afford a lossy decode, an autosave cannot.
        let home = tempdir();
        let dir = home.path().join(".vingilot");
        if let Err(error) = fs::create_dir_all(&dir) {
            panic!("could not create {}: {error}", dir.display());
        }
        let path = dir.join("scratch.md");
        // "caf\xe9\n" — Latin-1, no NUL, and not valid UTF-8.
        if let Err(error) = fs::write(&path, [0x63, 0x61, 0x66, 0xe9, 0x0a]) {
            panic!("could not write the latin-1 buffer: {error}");
        }
        match load_from(home.path()) {
            Err(sentence) => assert!(
                sentence.contains("not UTF-8 text"),
                "the refusal has to say what is wrong with it: {sentence}"
            ),
            other => panic!("expected a not-text refusal, got {other:?}"),
        }
        // And the bytes are exactly as they were. The refusal is only worth
        // anything if nothing touched the file.
        assert_eq!(
            fs::read(&path).expect("the file is still there"),
            vec![0x63, 0x61, 0x66, 0xe9, 0x0a]
        );
    }

    #[test]
    fn a_buffer_that_cannot_be_read_is_an_error_and_never_an_empty_one() {
        // A directory where the file should be: readable metadata, unreadable
        // contents. If this answered Ok(None) the frontend would take it for a
        // fresh machine and autosave over it.
        let home = tempdir();
        let path = home.path().join(".vingilot").join("scratch.md");
        if let Err(error) = fs::create_dir_all(&path) {
            panic!("could not create {}: {error}", path.display());
        }
        let read = load_from(home.path());
        assert!(read.is_err(), "expected an error, got {read:?}");
        assert!(
            read.unwrap_err().contains("directory"),
            "the sentence has to say what is in the way"
        );
    }

    #[test]
    fn a_write_that_cannot_land_reports_it_rather_than_losing_the_old_buffer() {
        let home = tempdir();
        assert_eq!(save_to(home.path(), "the real buffer"), Ok(()));

        // The temp path taken by a directory: the write fails, and the rename
        // never happens.
        let temp = home.path().join(".vingilot").join("scratch.md.writing");
        if let Err(error) = fs::create_dir_all(&temp) {
            panic!("could not create {}: {error}", temp.display());
        }

        assert!(save_to(home.path(), "clobbered").is_err());
        assert_eq!(
            load_from(home.path()),
            Ok(Some("the real buffer".to_owned()))
        );
    }

    #[test]
    fn the_commands_do_not_run_on_the_thread_the_webview_talks_on() {
        // The cadence argument in `off_thread`'s docs, as a compile-time fact:
        // a blocking command would not be a future at all.
        fn accepts_only_a_future<F: std::future::Future>(_: F) {}
        accepts_only_a_future(scratch_read());
        accepts_only_a_future(scratch_write(String::new()));
    }
}
