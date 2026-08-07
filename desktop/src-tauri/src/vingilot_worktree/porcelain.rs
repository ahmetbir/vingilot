//! Reading `git worktree list --porcelain` — the one place this island
//! learns what worktrees a repository has.
//!
//! **Why the porcelain format and not the human one.** `git worktree list`
//! without `--porcelain` right-pads paths into columns and abbreviates the
//! HEAD, so a path containing a space is unparseable and a path containing
//! two is ambiguous. The porcelain format is one `key value` per line with a
//! blank line between records, is documented as stable, and is what the rest
//! of this module can therefore be exact about.
//!
//! **The first record is the main working tree.** git documents that
//! ordering, and it is the only signal here that a worktree is the repository
//! itself rather than one of its linked checkouts — which is what makes it
//! un-removable (`git worktree remove` refuses it, and so does this island,
//! before git is ever asked).

use serde::Serialize;

/// One record of `git worktree list --porcelain`, as
/// `features/runs/lib/worktreeGit.ts` reads it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktree {
    /// Absolute, and canonical as far as git is concerned — on macOS that
    /// means `/private/var/...` where the caller may have said `/var/...`.
    /// Every path comparison in this island canonicalises both sides for
    /// exactly that reason.
    pub path: String,
    /// Short branch name (`refs/heads/` stripped), or `None` when the
    /// worktree is detached or bare.
    pub branch: Option<String>,
    pub head: Option<String>,
    /// The repository's own working tree. Never removable.
    pub is_main: bool,
    pub detached: bool,
    /// Locked by `git worktree lock`. Reported rather than acted on: a lock
    /// is somebody saying "not this one", and overriding it is the owner's
    /// call to make in a shell, not this app's to make for them.
    pub locked: bool,
    /// git considers this worktree removable-by-prune (its directory is
    /// gone, or the repository it points at is).
    pub prunable: bool,
}

fn short_branch(reference: &str) -> String {
    reference
        .strip_prefix("refs/heads/")
        .unwrap_or(reference)
        .to_string()
}

/// Parse the whole listing. Unknown keys are ignored rather than rejected —
/// git has added attribute lines to this format before (`prunable` arrived in
/// 2.29) and will again, and a listing this build cannot fully describe is
/// still a listing whose paths and branches are right.
pub(crate) fn parse_worktree_list(text: &str) -> Vec<GitWorktree> {
    let mut records: Vec<GitWorktree> = Vec::new();
    let mut current: Option<GitWorktree> = None;

    for line in text.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(record) = current.take() {
                records.push(record);
            }
            current = Some(GitWorktree {
                branch: None,
                detached: false,
                head: None,
                is_main: records.is_empty(),
                locked: false,
                path: path.to_string(),
                prunable: false,
            });
            continue;
        }

        // Every other key belongs to the record opened above; a stray one
        // before the first `worktree` line describes nothing.
        let Some(record) = current.as_mut() else {
            continue;
        };
        if let Some(head) = line.strip_prefix("HEAD ") {
            record.head = Some(head.to_string());
        } else if let Some(branch) = line.strip_prefix("branch ") {
            record.branch = Some(short_branch(branch));
        } else if line == "detached" {
            record.detached = true;
        } else if line == "locked" || line.starts_with("locked ") {
            record.locked = true;
        } else if line == "prunable" || line.starts_with("prunable ") {
            record.prunable = true;
        }
    }

    if let Some(record) = current.take() {
        records.push(record);
    }
    records
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_record_is_the_main_working_tree() {
        let listing = concat!(
            "worktree /Users/o/repo\n",
            "HEAD 1111111111111111111111111111111111111111\n",
            "branch refs/heads/main\n",
            "\n",
            "worktree /Users/o/.vingilot/worktrees/repo/fix\n",
            "HEAD 2222222222222222222222222222222222222222\n",
            "branch refs/heads/fix\n",
            "\n",
        );
        let parsed = parse_worktree_list(listing);
        assert_eq!(parsed.len(), 2);
        assert!(parsed[0].is_main);
        assert!(!parsed[1].is_main);
        assert_eq!(parsed[1].branch.as_deref(), Some("fix"));
        assert_eq!(parsed[1].path, "/Users/o/.vingilot/worktrees/repo/fix");
    }

    #[test]
    fn a_path_with_spaces_survives_intact() {
        // The reason this reads the porcelain format at all.
        let parsed = parse_worktree_list("worktree /Users/o/my repo/tree\nHEAD abc\ndetached\n");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].path, "/Users/o/my repo/tree");
        assert!(parsed[0].detached);
        assert_eq!(parsed[0].branch, None);
    }

    #[test]
    fn lock_and_prune_reasons_do_not_hide_the_flag() {
        let parsed = parse_worktree_list(concat!(
            "worktree /a\n",
            "\n",
            "worktree /b\n",
            "locked keeping this for the release\n",
            "prunable gitdir file points to non-existent location\n",
        ));
        assert_eq!(parsed.len(), 2);
        assert!(!parsed[0].locked);
        assert!(parsed[1].locked);
        assert!(parsed[1].prunable);
    }

    #[test]
    fn an_unknown_attribute_line_is_ignored_rather_than_fatal() {
        let parsed = parse_worktree_list("worktree /a\nsomething-git-added-later value\n");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].path, "/a");
    }

    #[test]
    fn an_empty_listing_is_no_worktrees_not_an_error() {
        assert_eq!(parse_worktree_list(""), Vec::new());
    }

    #[test]
    fn the_record_shape_serialises_to_what_the_ui_reads() {
        let record = GitWorktree {
            branch: Some("fix".to_string()),
            detached: false,
            head: Some("abc".to_string()),
            is_main: true,
            locked: false,
            path: "/a".to_string(),
            prunable: false,
        };
        let json = serde_json::to_string(&record).ok();
        assert_eq!(
            json.as_deref(),
            Some(
                r#"{"path":"/a","branch":"fix","head":"abc","isMain":true,"detached":false,"locked":false,"prunable":false}"#
            )
        );
    }
}
