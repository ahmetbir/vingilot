//! Which repository on GitHub a worktree is a checkout of.
//!
//! Everything here is a pure function over strings git already printed, so the
//! whole of "which repo, from which remote" is testable without a network, a
//! `gh`, or a repository on disk.
//!
//! **The remote URL never leaves this file.** A git remote URL is allowed to
//! carry credentials in its userinfo — `https://x-access-token:ghp_…@github.com/
//! owner/name.git` is what a `gh auth setup-git` or a CI checkout writes, and it
//! is sitting in plenty of real `.git/config` files. So the userinfo is stripped
//! at the parse and nothing downstream is ever handed a URL: the answer this
//! module gives is a [`RepoSlug`] plus the remote's *name*, and
//! [`super::PullsAnswer::NoGitHubRemote`] lists names too, for exactly this
//! reason. A refusal that helpfully printed "none of https://…@github.com/… is
//! a GitHub remote" would put a token on screen, in a screenshot, and in a bug
//! report.

use serde::Serialize;

/// The hosts this island recognises as GitHub.
///
/// `github.com` and the `www.` spelling of it, and nothing else. A GitHub
/// Enterprise host is a real thing `gh` can talk to (`GH_HOST`), and it is
/// deliberately *not* here: the fork has no Enterprise host to test against,
/// and silently pointing `gh pr list --repo` at one would be a guess dressed up
/// as an answer. An Enterprise checkout gets the honest
/// [`super::PullsAnswer::NoGitHubRemote`] instead of a wrong list.
const GITHUB_HOSTS: &[&str] = &["github.com", "www.github.com"];

/// The remote preferred when a repository has several GitHub remotes.
///
/// A worktree is a checkout *of* its origin. This fork is the case that decides
/// it: `origin` is `ahmetbir/vingilot` and `upstream` is `block/buzz`, and the
/// pull requests of the repository the owner's worktrees belong to are the
/// first, not the second — even though the second has hundreds and the first
/// may have none. An empty list is a true answer; upstream's list is not.
const PREFERRED_REMOTE: &str = "origin";

/// A repository on github.com, spelled the way `gh --repo` takes it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct RepoSlug {
    pub owner: String,
    pub name: String,
}

impl RepoSlug {
    /// `owner/name` — one argv element, never a shell string.
    pub fn slug(&self) -> String {
        format!("{}/{}", self.owner, self.name)
    }
}

/// One `remote.<name>.url` pair, as git printed it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Remote {
    pub name: String,
    pub url: String,
}

/// The remote this island will ask about, and the repository it names.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Chosen {
    pub remote: String,
    pub repo: RepoSlug,
}

/// Parse `git config --null --get-regexp ^remote\..*\.url$`.
///
/// `-z` rather than the line-oriented form because the value is a URL out of
/// the owner's config file and this side gets to make no assumptions about it:
/// with NUL separators an entry is exactly `key\nvalue`, and a URL containing a
/// newline (which git itself will store) cannot be read as two remotes.
///
/// A remote's *name* may contain dots (`remote.my.fork.url` is legal), so the
/// name is whatever sits between the fixed prefix and the fixed suffix rather
/// than the second dot-separated field.
pub fn parse_remotes(raw: &str) -> Vec<Remote> {
    raw.split('\0')
        .filter_map(|entry| entry.split_once('\n'))
        .filter_map(|(key, url)| {
            let name = key.strip_prefix("remote.")?.strip_suffix(".url")?;
            if name.is_empty() || url.is_empty() {
                return None;
            }
            Some(Remote {
                name: name.to_owned(),
                url: url.to_owned(),
            })
        })
        .collect()
}

/// The GitHub remote to ask about: `origin` when it is one, otherwise the
/// first by name.
///
/// Sorted rather than "whatever git printed first" so that a repository with
/// two GitHub remotes and no `origin` answers the same way twice — a list that
/// changed identity between two openings of the same worktree would be a bug
/// nobody could reproduce.
pub fn choose(remotes: &[Remote]) -> Option<Chosen> {
    let mut github: Vec<Chosen> = remotes
        .iter()
        .filter_map(|remote| {
            github_slug(&remote.url).map(|repo| Chosen {
                remote: remote.name.clone(),
                repo,
            })
        })
        .collect();
    github.sort_by(|a, b| a.remote.cmp(&b.remote));
    if let Some(index) = github
        .iter()
        .position(|chosen| chosen.remote == PREFERRED_REMOTE)
    {
        return Some(github.swap_remove(index));
    }
    github.into_iter().next()
}

/// The `owner/name` a git remote URL points at on GitHub, or `None` for any
/// URL that does not.
///
/// Handles the four spellings git accepts and people actually have:
/// `https://github.com/o/n(.git)`, `ssh://git@github.com/o/n.git`,
/// `git://github.com/o/n.git`, and the scp-like `git@github.com:o/n.git`.
pub fn github_slug(url: &str) -> Option<RepoSlug> {
    let (host, path) = split_host_and_path(url.trim())?;
    if !GITHUB_HOSTS
        .iter()
        .any(|known| host.eq_ignore_ascii_case(known))
    {
        return None;
    }
    slug_from_path(path)
}

/// Split a remote URL into its host and its path, dropping userinfo and port.
///
/// Userinfo is dropped and not returned: see this module's header.
fn split_host_and_path(url: &str) -> Option<(&str, &str)> {
    let (authority, path) = match url.split_once("://") {
        // scheme://[user@]host[:port]/path
        Some((_scheme, rest)) => rest.split_once('/')?,
        // The scp-like form: [user@]host:path, and *only* when the colon comes
        // before any slash. `github.com/o/n` with no scheme is not a remote git
        // would accept, and a Windows path (`C:\repos\x`) must not read as a
        // host called `C`.
        None => {
            let colon = url.find(':')?;
            if url[..colon].contains('/') || url[..colon].len() < 2 {
                return None;
            }
            (&url[..colon], &url[colon + 1..])
        }
    };
    let host = match authority.rsplit_once('@') {
        Some((_userinfo, host)) => host,
        None => authority,
    };
    let host = match host.split_once(':') {
        Some((host, _port)) => host,
        None => host,
    };
    if host.is_empty() {
        return None;
    }
    Some((host, path))
}

/// `owner/name` from a URL path, with the `.git` suffix and any wrapping
/// slashes taken off.
///
/// **Exactly two segments, each of them a name GitHub could have issued.** Not
/// pickiness for its own sake: the two segments end up in `gh pr list --repo
/// <slug>`'s argv, and a segment beginning with `-` would be a flag rather than
/// a value if anything downstream ever moved it to a positional slot. Refusing
/// them here means the only strings that reach `gh` are the shape GitHub itself
/// hands out, and a config with something else in it gets the honest "no GitHub
/// remote" instead.
fn slug_from_path(path: &str) -> Option<RepoSlug> {
    let trimmed = path.trim_matches('/');
    let trimmed = trimmed.strip_suffix(".git").unwrap_or(trimmed);
    let (owner, name) = trimmed.split_once('/')?;
    if !is_github_name(owner) || !is_github_name(name) {
        return None;
    }
    Some(RepoSlug {
        owner: owner.to_owned(),
        name: name.to_owned(),
    })
}

/// Whether a segment could be a GitHub owner or repository name: ASCII
/// alphanumerics, `-`, `_` and `.`, not empty, and not starting with `-` or
/// `.`. Rules out `..`, an empty segment, and anything that reads as a flag.
fn is_github_name(segment: &str) -> bool {
    !segment.is_empty()
        && !segment.starts_with('-')
        && !segment.starts_with('.')
        && segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}
