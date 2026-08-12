//! One directory level of a worktree.
//!
//! **Lazy, and it has to be.** Expanding a node is another call to this
//! command; nothing here recurses and nothing here is cached. A recursive walk
//! of the owner's monorepo would be tens of thousands of `stat` calls before the
//! first row was drawn, on a pane he opened *because* he did not want to leave
//! the app — and a cache would have to be invalidated every time an agent wrote
//! into the worktree the pane is showing, which is every few seconds.
//!
//! **git decides what is in the listing, not this module.** The rows come from
//!
//! ```text
//! git -C <worktree> ls-files --cached --others --exclude-standard -z -- <dir>
//! ```
//!
//! `--cached` is what git tracks, `--others` is what it does not, and
//! `--exclude-standard` is what makes the second one respect the ignore rules.
//! Those rules are not one file: per-directory `.gitignore`s, `.git/info/exclude`,
//! `core.excludesFile` and the global excludesfile, with precedence and
//! negation. git implements them, the Diff pane already asks git the same
//! question (`vingilot_worktree/diff.rs` uses the same two flags for untracked
//! files), and Task 2's `git grep` will answer from the same rules — so all
//! three surfaces agree about what is in this checkout. A matcher written here
//! would be a second opinion about the owner's repository.
//!
//! **`ls-files` is recursive, so one level is derived rather than asked for.**
//! Each printed path has its first component after `<dir>` taken; a component
//! with anything after it is a directory. That is a string pass over an index
//! scan — the index is sorted and memory-mapped, so it is not N `stat` calls —
//! and the pathspec is what bounds it: listing `desktop/src/features/runs/`
//! enumerates that subtree only. The root listing is the one call whose cost is
//! the whole index, which is the cheapest expensive thing git can be asked.
//!
//! **What that costs, and the pane says both out loud.** A directory holding
//! only ignored files is absent (`node_modules/` is not in the tree), and an
//! empty directory is absent because git does not track them. Both are right
//! for a pane whose purpose is opening files he wants to read, and both are
//! differences from `ls` that he would otherwise have to discover.
//!
//! `.git/` never appears, and not because anything here excludes it: git does
//! not list it.

use serde::Serialize;

use super::{describe, ensure_repo, inside, off_thread, run, FilesError};

/// Rows returned for one directory. 2,000 is far past the point a human reads a
/// directory listing and far below the point the DOM struggles; a directory
/// with forty thousand generated files in it is a thing to *notice*, which is
/// what `truncated` is for.
const MAX_ENTRIES: usize = 2_000;

/// What a row is. Two kinds and no third: a symlink is reported as whatever it
/// resolves to, because what he is choosing between is "can I open this" and
/// "can I go into this", and a third word here would not change either answer.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EntryKind {
    File,
    Directory,
}

/// One row of a directory.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    /// The entry's own name, not a path. The pane knows the directory it asked
    /// about; repeating it on every row would be bytes across the IPC to say
    /// something the caller already said.
    pub name: String,
    pub kind: EntryKind,
    /// The file's size on disk, or `None` for a directory and for a file this
    /// app could not `stat`. **`None` is "no answer", never zero** — a build
    /// artefact behind a permission and an empty file are different things, and
    /// a zero here would render as the second.
    pub size: Option<u64>,
}

/// One directory's answer, with the cap it was produced under so the pane
/// states the real numbers rather than a second copy of them that can drift.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeListing {
    /// The directory this is a listing of, as given. `""` is the worktree root.
    pub dir: String,
    pub entries: Vec<TreeEntry>,
    /// There were more than `limit` entries here and the rest were not read.
    pub truncated: bool,
    pub limit: usize,
}

/// `ls-files`' argument vector, built in one place so a test can assert what is
/// — and is not — in it.
///
/// The pathspec carries git's `:(literal)` magic. Without it a directory whose
/// name contains `*`, `?` or `[` would be read as a glob, and a directory
/// called `[draft]` would list the whole repository instead of itself. `--`
/// keeps the pathspec from being read as a ref.
///
/// Nothing here is conditional except the pathspec itself: there is no branch
/// of this function that drops `--exclude-standard`, which is the flag the
/// ignore rules hang off.
fn list_args(spec: &str) -> Vec<&str> {
    let mut args = vec![
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
    ];
    if !spec.is_empty() {
        args.push(spec);
    }
    args
}

/// The pathspec for a directory: `:(literal)<dir>/`, or empty for the root.
fn pathspec(dir: &str) -> String {
    if dir.is_empty() {
        return String::new();
    }
    let trimmed = dir.trim_end_matches('/');
    format!(":(literal){trimmed}/")
}

/// Take the one-level names out of `ls-files`' recursive answer.
///
/// Returns them in git's own order — sorting is [`sort_entries`]' job, and
/// keeping the two apart is what lets the derivation be tested against a
/// literal `-z` payload with no filesystem anywhere near it.
///
/// A path that does not start with `prefix` is skipped rather than guessed at:
/// git was asked about one directory, and anything else in the answer is
/// something this function does not understand.
fn one_level(stdout: &[u8], prefix: &str) -> Vec<(String, bool)> {
    let mut seen: Vec<(String, bool)> = Vec::new();
    // A set beside the vector rather than a scan of it. The vector keeps git's
    // order (which the tests read); the set keeps the dedupe linear, and it has
    // to be: a generated directory with forty thousand siblings is exactly the
    // case `MAX_ENTRIES` exists for, and a quadratic scan would spend a billion
    // comparisons deciding to truncate it.
    let mut names: std::collections::HashSet<String> = std::collections::HashSet::new();
    for record in stdout.split(|byte| *byte == 0) {
        if record.is_empty() {
            continue;
        }
        // Decoded per record, not for the whole payload: a filename that is not
        // UTF-8 is legal on every platform this ships to, and decoding the
        // whole answer at once would let one such name make every row after it
        // wrong.
        let path = String::from_utf8_lossy(record);
        let Some(rest) = path.strip_prefix(prefix) else {
            continue;
        };
        let (name, is_dir) = match rest.find('/') {
            Some(cut) => (&rest[..cut], true),
            None => (rest, false),
        };
        if name.is_empty() {
            continue;
        }
        if !names.insert(name.to_string()) {
            continue;
        }
        seen.push((name.to_string(), is_dir));
    }
    seen
}

/// Keep at most `limit` names, and say whether anything was dropped.
///
/// **Its own function so the truncation can be proved rather than assumed.**
/// The value of `truncated` is entirely in it being *true* when it should be,
/// and the only fixture that reaches that through `listing` is a directory with
/// two thousand and one files in it — which is not a temp repo anybody should
/// build, and so was not built: replacing this with `false` left every other
/// test in this module green. Three names and a limit of two say the same
/// thing. The same split `one_level` and `sort_entries` already use.
fn capped(names: Vec<(String, bool)>, limit: usize) -> (Vec<(String, bool)>, bool) {
    let truncated = names.len() > limit;
    (names.into_iter().take(limit).collect(), truncated)
}

/// Directories first, then case-insensitively by name, then by name.
///
/// Stated because the alternative is invisible: `ls-files` answers in git's byte
/// order, which puts every capitalised name above every lowercase one, and a
/// tree that did that would look broken rather than sorted. The final
/// case-sensitive tie-break keeps `README` and `readme` in a fixed order rather
/// than whichever the sort happened to leave first.
fn sort_entries(entries: &mut [TreeEntry]) {
    entries.sort_by(|left, right| {
        let kind = matches!(left.kind, EntryKind::File).cmp(&matches!(right.kind, EntryKind::File));
        kind.then_with(|| {
            left.name
                .to_lowercase()
                .cmp(&right.name.to_lowercase())
                .then_with(|| left.name.cmp(&right.name))
        })
    });
}

fn listing(worktree: &str, dir: &str) -> Result<TreeListing, FilesError> {
    ensure_repo(worktree)?;
    // Resolved before git is asked, so a path that leaves the checkout is
    // refused without a subprocess — and so that a directory that is not there
    // says `not-found` rather than coming back as an empty listing. An empty
    // read is "no answer", never "nothing there".
    let resolved = inside(worktree, dir)?;
    if !resolved.is_dir() {
        return Err(FilesError::NotFound {
            path: dir.to_string(),
        });
    }

    let spec = pathspec(dir);
    let args = list_args(&spec);
    let ran = run(worktree, &args)?;
    if !ran.ok {
        return Err(FilesError::GitFailed {
            command: describe(&args),
            stderr: ran.stderr,
        });
    }

    let prefix = if dir.is_empty() {
        String::new()
    } else {
        format!("{}/", dir.trim_end_matches('/'))
    };
    let (names, truncated) = capped(one_level(&ran.stdout, &prefix), MAX_ENTRIES);

    let mut entries: Vec<TreeEntry> = names
        .into_iter()
        .map(|(name, is_dir)| {
            // One `stat` per file in this directory and no deeper — bounded by
            // MAX_ENTRIES, which is what makes a size column affordable at all.
            // git cannot answer this: it knows a tracked blob's hash, not the
            // working tree's size, and asking it would mean hashing the file.
            let size = if is_dir {
                None
            } else {
                std::fs::metadata(resolved.join(&name))
                    .ok()
                    .map(|found| found.len())
            };
            TreeEntry {
                kind: if is_dir {
                    EntryKind::Directory
                } else {
                    EntryKind::File
                },
                name,
                size,
            }
        })
        .collect();
    sort_entries(&mut entries);

    Ok(TreeListing {
        dir: dir.to_string(),
        entries,
        limit: MAX_ENTRIES,
        truncated,
    })
}

/// One directory level of a worktree, as git sees it.
#[tauri::command]
pub async fn worktree_tree(worktree: String, dir: String) -> Result<TreeListing, FilesError> {
    off_thread("worktree tree", move || listing(&worktree, &dir)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::vingilot_worktree::testrepo::Repo;

    fn names(listing: &TreeListing) -> Vec<&str> {
        listing
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect()
    }

    #[test]
    fn the_pathspec_is_literal_so_a_bracket_is_a_directory_name() {
        // A directory called `[draft]` is a legal directory. Read as a glob it
        // is a character class, and the listing would come back as the whole
        // repository — every row wrong, no error anywhere.
        assert_eq!(pathspec("[draft]"), ":(literal)[draft]/");
        assert_eq!(pathspec("src/"), ":(literal)src/");
        assert_eq!(pathspec(""), "");
    }

    #[test]
    fn the_listing_command_always_excludes_ignored_files() {
        // The flag the whole ignore promise hangs off. A refactor that dropped
        // it would put `node_modules` in the tree with nothing failing.
        let args = list_args(":(literal)src/");
        assert!(args.contains(&"--exclude-standard"));
        assert!(args.contains(&"--cached"));
        assert!(args.contains(&"--others"));
        assert!(args.contains(&"-z"));
        assert_eq!(args.last(), Some(&":(literal)src/"));
    }

    #[test]
    fn the_listing_command_never_carries_a_write_flag() {
        // This module reads. A future edit reaching for the index fails here.
        for arg in list_args("") {
            assert_ne!(arg, "--cached-only-modify");
            assert_ne!(arg, "-N");
            assert_ne!(arg, "--intent-to-add");
        }
    }

    #[test]
    fn one_level_takes_the_first_component_and_says_which_are_directories() {
        // git's answer is recursive; the tree is not. Two files under `src/a/`
        // must collapse to one directory row.
        let payload = b"src/a/one.rs\0src/a/two.rs\0src/top.rs\0".as_slice();
        assert_eq!(
            one_level(payload, "src/"),
            vec![("a".to_string(), true), ("top.rs".to_string(), false)]
        );
    }

    #[test]
    fn one_level_at_the_root_takes_the_whole_index() {
        let payload = b"README.md\0src/a.rs\0src/b.rs\0".as_slice();
        assert_eq!(
            one_level(payload, ""),
            vec![("README.md".to_string(), false), ("src".to_string(), true)]
        );
    }

    #[test]
    fn one_level_skips_a_path_it_was_not_asking_about() {
        // Never guessed at: git was asked about one directory, and anything
        // else in the answer is something this function does not understand.
        let payload = b"other/x.rs\0src/a.rs\0".as_slice();
        assert_eq!(
            one_level(payload, "src/"),
            vec![("a.rs".to_string(), false)]
        );
    }

    #[test]
    fn directories_sort_above_files_and_case_does_not_split_the_list() {
        // git answers in byte order, which puts every capitalised name above
        // every lowercase one. A tree that did that looks broken.
        let mut entries = vec![
            TreeEntry {
                kind: EntryKind::File,
                name: "README.md".to_string(),
                size: Some(1),
            },
            TreeEntry {
                kind: EntryKind::File,
                name: "apple.rs".to_string(),
                size: Some(1),
            },
            TreeEntry {
                kind: EntryKind::Directory,
                name: "zebra".to_string(),
                size: None,
            },
        ];
        sort_entries(&mut entries);
        let sorted: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(sorted, vec!["zebra", "apple.rs", "README.md"]);
    }

    #[test]
    fn a_worktree_lists_its_own_root_and_nothing_deeper() {
        let repo = Repo::new();
        repo.write("top.txt", "one\n");
        std::fs::create_dir_all(std::path::Path::new(&repo.path()).join("nest/deeper"))
            .expect("the nested directories are made");
        repo.write("nest/inner.txt", "two\n");
        repo.write("nest/deeper/deepest.txt", "three\n");

        let root = listing(&repo.path(), "").expect("the root lists");
        assert_eq!(names(&root), vec!["nest", "README.md", "top.txt"]);
        // The proof that it is one level: `inner.txt` is real and is not here.
        assert!(!names(&root).contains(&"inner.txt"));

        let nest = listing(&repo.path(), "nest").expect("the subdirectory lists");
        assert_eq!(names(&nest), vec!["deeper", "inner.txt"]);
        assert!(!names(&nest).contains(&"deepest.txt"));
    }

    #[test]
    fn an_ignored_file_and_an_ignored_directory_are_not_listed() {
        // The whole point of asking git rather than reading the directory.
        let repo = Repo::new();
        repo.write(".gitignore", "ignored.txt\nbuilt/\n");
        repo.write("ignored.txt", "noise\n");
        repo.write("kept.txt", "signal\n");
        std::fs::create_dir_all(std::path::Path::new(&repo.path()).join("built"))
            .expect("the ignored directory is made");
        repo.write("built/artifact.bin", "x\n");

        let root = listing(&repo.path(), "").expect("the root lists");
        assert!(names(&root).contains(&"kept.txt"));
        assert!(!names(&root).contains(&"ignored.txt"));
        // A directory holding only ignored files is absent too — the design
        // note says so and the pane's footer says so, because it is a real
        // difference from `ls`.
        assert!(!names(&root).contains(&"built"));
    }

    #[test]
    fn an_untracked_file_is_listed_because_it_is_the_interesting_one() {
        // `--others`. A file an agent has just created is the single most
        // interesting thing in a worktree, and `--cached` alone would not
        // mention that it exists.
        let repo = Repo::new();
        repo.write("just-written.rs", "fn main() {}\n");
        let root = listing(&repo.path(), "").expect("the root lists");
        assert!(names(&root).contains(&"just-written.rs"));
    }

    #[test]
    fn the_git_directory_is_never_listed() {
        let repo = Repo::new();
        let root = listing(&repo.path(), "").expect("the root lists");
        assert!(!names(&root).contains(&".git"));
    }

    #[test]
    fn a_file_carries_its_size_and_a_directory_carries_none() {
        let repo = Repo::new();
        repo.write("sized.txt", "0123456789");
        std::fs::create_dir_all(std::path::Path::new(&repo.path()).join("dir"))
            .expect("the directory is made");
        repo.write("dir/inner.txt", "x\n");

        let root = listing(&repo.path(), "").expect("the root lists");
        let sized = root
            .entries
            .iter()
            .find(|entry| entry.name == "sized.txt")
            .expect("the file is listed");
        assert_eq!(sized.size, Some(10));
        let dir = root
            .entries
            .iter()
            .find(|entry| entry.name == "dir")
            .expect("the directory is listed");
        assert_eq!(dir.size, None);
        assert_eq!(dir.kind, EntryKind::Directory);
    }

    #[test]
    fn a_directory_that_is_not_there_is_not_found_rather_than_empty() {
        // An empty read is "no answer", never "nothing there": `ls-files` with
        // a pathspec matching nothing exits 0 with no output, so without this
        // check a typo would render as a directory that exists and is empty.
        let repo = Repo::new();
        assert_eq!(
            listing(&repo.path(), "nowhere"),
            Err(FilesError::NotFound {
                path: "nowhere".to_string()
            })
        );
    }

    #[test]
    fn a_directory_outside_the_worktree_is_refused() {
        let repo = Repo::new();
        assert_eq!(
            listing(&repo.path(), "../.."),
            Err(FilesError::OutsidePath {
                path: "../..".to_string()
            })
        );
    }

    #[test]
    fn the_cap_drops_the_rest_and_says_that_it_did() {
        // "A cap applied silently is a reader that lies about what is in the
        // repository" — this module's own rule, and the half of it that had no
        // test. A directory of forty thousand generated files is the case
        // `MAX_ENTRIES` cites; three names and a limit of two are the same
        // claim without the fixture.
        let three = vec![
            ("alpha".to_string(), false),
            ("beta".to_string(), true),
            ("gamma".to_string(), false),
        ];

        let (kept, truncated) = capped(three.clone(), 2);
        assert!(truncated, "three names past a limit of two is truncated");
        assert_eq!(
            kept,
            vec![("alpha".to_string(), false), ("beta".to_string(), true)]
        );

        // Exactly the limit is not truncated — the boundary in the direction
        // that would otherwise put a false warning under every full listing.
        let (all, truncated) = capped(three, 3);
        assert!(!truncated);
        assert_eq!(all.len(), 3);

        let (none, truncated) = capped(Vec::new(), 2);
        assert!(!truncated);
        assert!(none.is_empty());
    }

    #[test]
    fn the_cap_is_reported_with_the_answer() {
        let repo = Repo::new();
        let root = listing(&repo.path(), "").expect("the root lists");
        assert_eq!(root.limit, MAX_ENTRIES);
        assert!(!root.truncated);
        assert_eq!(root.dir, "");
    }

    #[test]
    fn the_command_does_not_run_on_the_thread_the_webview_talks_on() {
        // See `off_thread`: only an `async fn` gets `respond_async_serialized`.
        // The thread is not observable from here; the shape that decides it is.
        fn accepts_only_a_future<F: std::future::Future>(_: F) {}
        accepts_only_a_future(worktree_tree("/nonexistent".to_string(), String::new()));
    }
}
