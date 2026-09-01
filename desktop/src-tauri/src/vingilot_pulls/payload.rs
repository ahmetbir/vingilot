//! What this island asks `gh` for, and what it makes of the answer.
//!
//! **An explicit `--json` field set, never a scrape.** `gh pr list` with no
//! `--json` prints a table for a human — coloured, width-dependent, and free to
//! change between releases. Every vector below names its fields, so the failure
//! mode of a `gh` upgrade is a missing key that [`serde`] reports, not a column
//! that silently shifts by one.
//!
//! **Every vector is a read.** [`list_args`], [`view_args`] and [`auth_args`]
//! are the complete set of things this island is willing to hand `gh`, and
//! `pulls_tests.rs` asserts that none of them contains a verb that writes. There
//! is no create, no merge, no close, and no `--token` anywhere in this module:
//! authentication is `gh`'s own keyring and this app never sees it.
//!
//! **The wire types are separate from the answer types on purpose.** [`GhPull`]
//! mirrors what `gh` prints, including the parts that are ugly — `reviewDecision`
//! is an empty string rather than absent when no review has been asked for, and
//! `author.is_bot` is snake_case in the middle of an otherwise camelCase payload.
//! [`Pull`] is what the surface reads, with those normalised once, here, instead
//! of in every component that draws a badge.

use serde::{Deserialize, Serialize};

/// The fields `gh pr list` is asked for.
///
/// Enough to draw a row without a second round trip — who, which branch, how
/// big, and where review stands. `body` is deliberately absent: fifty bodies is
/// a megabyte of IPC for text no list row shows.
const LIST_FIELDS: &str = concat!(
    "number,title,url,state,isDraft,author,headRefName,baseRefName,",
    "createdAt,updatedAt,additions,deletions,changedFiles,reviewDecision,",
    "mergeable,labels",
);

/// The fields `gh pr view` is asked for: the list's, plus the body — which is
/// the only reason to open one pull request rather than read the row.
const VIEW_FIELDS: &str = concat!(
    "number,title,url,state,isDraft,author,headRefName,baseRefName,",
    "createdAt,updatedAt,additions,deletions,changedFiles,reviewDecision,",
    "mergeable,labels,body",
);

/// `gh pr list`'s argument vector.
///
/// `--repo` is always passed, so `gh` resolves nothing from a working
/// directory: which repository is being asked about is decided by
/// [`super::remote`] from git's own config, where it can be reported honestly,
/// rather than by `gh`'s own remote guessing, whose failure is a sentence in
/// stderr this side would have to pattern-match.
pub fn list_args(slug: &str, limit: usize) -> Vec<String> {
    vec![
        "pr".to_owned(),
        "list".to_owned(),
        "--repo".to_owned(),
        slug.to_owned(),
        "--state".to_owned(),
        "open".to_owned(),
        "--limit".to_owned(),
        limit.to_string(),
        "--json".to_owned(),
        LIST_FIELDS.to_owned(),
    ]
}

/// `gh pr view`'s argument vector.
pub fn view_args(slug: &str, number: u64) -> Vec<String> {
    vec![
        "pr".to_owned(),
        "view".to_owned(),
        number.to_string(),
        "--repo".to_owned(),
        slug.to_owned(),
        "--json".to_owned(),
        VIEW_FIELDS.to_owned(),
    ]
}

/// `gh auth status`'s argument vector — run for its exit code alone.
///
/// **Its output is never read.** `gh auth status` prints the account and, with
/// `--show-token` (never passed here), the token itself; this island discards
/// both streams and keeps only whether it succeeded. That exit code is the
/// whole mechanism behind
/// [`super::PullsAnswer::GhUnauthenticated`] — a typed answer derived from a
/// number, not from matching words in somebody's stderr.
pub fn auth_args(host: &str) -> Vec<String> {
    vec![
        "auth".to_owned(),
        "status".to_owned(),
        "--hostname".to_owned(),
        host.to_owned(),
    ]
}

// ---------------------------------------------------------------------------
// What gh prints
// ---------------------------------------------------------------------------

/// One pull request as `gh --json` prints it.
///
/// Every field defaults: `gh` omits nothing it was asked for, but a field it
/// stops emitting should cost a badge, not the whole list.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhPull {
    pub number: u64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub is_draft: bool,
    #[serde(default)]
    pub author: Option<GhAuthor>,
    #[serde(default)]
    pub head_ref_name: String,
    #[serde(default)]
    pub base_ref_name: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub additions: u64,
    #[serde(default)]
    pub deletions: u64,
    #[serde(default)]
    pub changed_files: u64,
    #[serde(default)]
    pub review_decision: String,
    #[serde(default)]
    pub mergeable: String,
    #[serde(default)]
    pub labels: Vec<GhLabel>,
    #[serde(default)]
    pub body: String,
}

/// **No `rename_all` here, and that is not an oversight.** `gh` prints
/// `{"id":…,"is_bot":false,"login":"…","name":"…"}` — snake_case, inside a
/// payload whose every other key is camelCase. A blanket camelCase rule on this
/// struct would look at `isBot`, find nothing, and quietly call every bot a
/// person.
#[derive(Debug, Default, Deserialize)]
pub struct GhAuthor {
    #[serde(default)]
    pub login: String,
    #[serde(default)]
    pub is_bot: bool,
}

#[derive(Debug, Default, Deserialize)]
pub struct GhLabel {
    #[serde(default)]
    pub name: String,
}

// ---------------------------------------------------------------------------
// What the surface reads
// ---------------------------------------------------------------------------

/// One pull request, normalised.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pull {
    pub number: u64,
    pub title: String,
    pub url: String,
    /// `OPEN`, `CLOSED` or `MERGED`, as GitHub spells it. Always `OPEN` from
    /// the list, which asks only for open ones; a single pull request read by
    /// number may be any of the three.
    pub state: String,
    pub draft: bool,
    /// `None` for a pull request whose author no longer has an account — the
    /// ghost user, which GitHub reports with an empty login rather than by
    /// dropping the field.
    pub author: Option<String>,
    pub author_is_bot: bool,
    pub head_ref: String,
    pub base_ref: String,
    pub created_at: String,
    pub updated_at: String,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    /// `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED` — or `None`, which is
    /// what `gh`'s empty string means: nobody has been asked. Normalised here
    /// so no component has to know that `""` is a state.
    pub review_decision: Option<String>,
    /// `MERGEABLE`, `CONFLICTING`, `UNKNOWN` — `None` on the same rule.
    pub mergeable: Option<String>,
    pub labels: Vec<String>,
}

impl From<GhPull> for Pull {
    fn from(raw: GhPull) -> Self {
        let (author, author_is_bot) = match raw.author {
            Some(author) if !author.login.is_empty() => (Some(author.login), author.is_bot),
            _ => (None, false),
        };
        Pull {
            number: raw.number,
            title: raw.title,
            url: raw.url,
            state: raw.state,
            draft: raw.is_draft,
            author,
            author_is_bot,
            head_ref: raw.head_ref_name,
            base_ref: raw.base_ref_name,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            additions: raw.additions,
            deletions: raw.deletions,
            changed_files: raw.changed_files,
            review_decision: some_unless_empty(raw.review_decision),
            mergeable: some_unless_empty(raw.mergeable),
            labels: raw
                .labels
                .into_iter()
                .map(|label| label.name)
                .filter(|name| !name.is_empty())
                .collect(),
        }
    }
}

fn some_unless_empty(value: String) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

/// Parse `gh pr list --json`'s array.
///
/// The error is serde's own sentence, which names the key and the offset. It
/// travels to the surface inside
/// [`super::PullsAnswer::RequestFailed`] rather than being logged and replaced
/// with something vague: a `gh` that changed a field is a real thing that can
/// happen to a machine, and "the answer did not parse" plus the reason is what
/// makes it fixable.
pub fn parse_list(raw: &str) -> Result<Vec<Pull>, String> {
    serde_json::from_str::<Vec<GhPull>>(raw)
        .map(|pulls| pulls.into_iter().map(Pull::from).collect())
        .map_err(|error| error.to_string())
}

/// Parse `gh pr view --json`'s object, keeping the body separate: it is the
/// one field with no bound of its own, and [`super`] caps it.
pub fn parse_view(raw: &str) -> Result<(Pull, String), String> {
    let mut parsed = serde_json::from_str::<GhPull>(raw).map_err(|error| error.to_string())?;
    // Taken rather than cloned: a body is the one field whose size is a human's
    // writing, and copying it to move it would be the largest allocation in the
    // command for no reason.
    let body = std::mem::take(&mut parsed.body);
    Ok((Pull::from(parsed), body))
}
