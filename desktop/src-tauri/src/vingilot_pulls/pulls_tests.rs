//! What this island promises, proved without a network.
//!
//! **Nothing here reaches GitHub.** The payload fixtures are real `gh --json`
//! output, captured once from `block/buzz` and `cli/cli` and pasted in, so the
//! parse is tested against the shape `gh` actually prints — including the two
//! parts of it that are surprising (`author.is_bot` is snake_case in an
//! otherwise camelCase object, and `reviewDecision` is `""` rather than absent
//! when no review has been requested). A test that invented its own JSON would
//! have agreed with a parser that got both wrong.
//!
//! **The three things that only a real process can prove get one.** The
//! deadline, the launch failure, and the exit-code reading all go through the
//! real [`super::run`] against a `/bin/sh` script written into the test's own
//! temp directory — `vingilot_harbor/recorder_tests.rs`'s pattern, and for its
//! reason: a timeout that works in Rust and not across `fork` would pass every
//! pure test in this file. `gh` is never installed, never spawned, and never
//! asked anything.
//!
//! **The repository-resolution tests use real git repositories.** They are made
//! with `vingilot_worktree::testrepo`, in temp directories that remove
//! themselves, and no remote in any of them is ever contacted — `git remote add`
//! writes a line in a config file and talks to nobody.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tempfile::TempDir;

use super::payload::{auth_args, list_args, parse_list, parse_view, view_args, Pull};
use super::remote::{choose, github_slug, parse_remotes, Remote, RepoSlug};
use super::{
    apply_cap, binary_with, capped_body, child_path, describe, first_lines, resolve, run,
    PullDetail, PullList, PullsAnswer, RunFailure, BODY_CAP, PULL_CAP,
};
use crate::vingilot_worktree::testrepo::{temp_dir, worktree_path, Repo};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/// Two real rows from `gh pr list --repo block/buzz --json …`, verbatim.
const REAL_LIST: &str = r#"[{"additions":338,"author":{"id":"U_kgDODVZk8A","is_bot":false,"login":"Trevongit","name":""},"baseRefName":"main","changedFiles":8,"createdAt":"2026-09-01T04:16:12Z","deletions":63,"headRefName":"fix/inbox-unread-hydrate-flash","isDraft":false,"labels":[],"mergeable":"MERGEABLE","number":7159,"reviewDecision":"REVIEW_REQUIRED","state":"OPEN","title":"fix(desktop): don't flash Inbox unread during NIP-RS hydrate","updatedAt":"2026-09-01T04:19:31Z","url":"https://github.com/block/buzz/pull/7159"},{"additions":171,"author":{"id":"MDQ6VXNlcjIzODMzMQ==","is_bot":false,"login":"brow","name":"Tom Brow"},"baseRefName":"main","changedFiles":10,"createdAt":"2026-09-01T02:59:57Z","deletions":79,"headRefName":"push-chart-release/0.2.0","isDraft":true,"labels":[],"mergeable":"MERGEABLE","number":7158,"reviewDecision":"REVIEW_REQUIRED","state":"OPEN","title":"Release push gateway chart 0.2.0 with Datadog metrics","updatedAt":"2026-09-01T03:56:43Z","url":"https://github.com/block/buzz/pull/7158"}]"#;

/// A real labelled row from `gh pr list --repo cli/cli --json …`. Dependabot,
/// so it is also the `is_bot` fixture — the field `gh` spells in snake_case.
const REAL_LABELLED: &str = r#"[{"additions":3,"author":{"id":"MDM6Qm90NDk2OTk5MzM=","is_bot":true,"login":"app/dependabot","name":""},"baseRefName":"trunk","changedFiles":2,"createdAt":"2026-08-30T05:31:12Z","deletions":3,"headRefName":"dependabot/go_modules/x","isDraft":false,"labels":[{"color":"0366d6","description":"Pull requests that update a dependency file","id":"LA_kwDODKw3uc8AAAABYP6ixA","name":"dependencies"},{"color":"000000","description":"Pull requests that update GitHub Actions code","id":"LA_kwDODKw3uc8AAAABYP6iyg","name":"github_actions"}],"mergeable":"MERGEABLE","number":14301,"reviewDecision":"REVIEW_REQUIRED","state":"OPEN","title":"build(deps): bump golang.org/x/text","updatedAt":"2026-08-30T05:31:20Z","url":"https://github.com/cli/cli/pull/14301"}]"#;

/// The empty answer, exactly as `gh` prints it for `ahmetbir/vingilot` today.
const REAL_EMPTY: &str = "[]\n";

/// A real `gh pr view --json …` object, body shortened.
const REAL_VIEW: &str = r###"{"additions":338,"author":{"id":"U_kgDODVZk8A","is_bot":false,"login":"Trevongit","name":""},"baseRefName":"main","body":"## Summary\n\n`null` read marker currently means **unread**.","changedFiles":8,"createdAt":"2026-09-01T04:16:12Z","deletions":63,"headRefName":"fix/inbox-unread-hydrate-flash","isDraft":false,"labels":[],"mergeable":"MERGEABLE","number":7159,"reviewDecision":"REVIEW_REQUIRED","state":"OPEN","title":"fix(desktop): don't flash Inbox unread during NIP-RS hydrate","updatedAt":"2026-09-01T04:19:31Z","url":"https://github.com/block/buzz/pull/7159"}"###;

fn remote(name: &str, url: &str) -> Remote {
    Remote {
        name: name.to_owned(),
        url: url.to_owned(),
    }
}

fn slug(owner: &str, name: &str) -> RepoSlug {
    RepoSlug {
        owner: owner.to_owned(),
        name: name.to_owned(),
    }
}

/// A `/bin/sh` stand-in for a child process: it sleeps `sleep` seconds, prints
/// `stdout`, and exits with `code`.
fn fake_child(dir: &Path, name: &str, sleep: &str, stdout: &str, code: i32) -> PathBuf {
    let path = dir.join(name);
    let script = format!(
        "#!/bin/sh\nsleep {sleep}\nprintf '%s' '{stdout}'\nprintf 'said so\\n' >&2\nexit {code}\n"
    );
    if let Err(error) = fs::write(&path, script) {
        panic!("could not write the fake child: {error}");
    }
    if let Err(error) = fs::set_permissions(
        &path,
        <fs::Permissions as std::os::unix::fs::PermissionsExt>::from_mode(0o755),
    ) {
        panic!("could not make the fake child executable: {error}");
    }
    path
}

fn tempdir() -> TempDir {
    match TempDir::new() {
        Ok(dir) => dir,
        Err(error) => panic!("could not create a temp dir: {error}"),
    }
}

// ---------------------------------------------------------------------------
// Finding gh: the PATH lesson
// ---------------------------------------------------------------------------

#[test]
fn the_bare_name_is_tried_first_so_a_path_gh_wins() {
    // PATH first is what makes an owner's own gh — a version manager's, a
    // MacPorts one, whatever `which gh` says — the one that answers.
    let seen = std::cell::RefCell::new(Vec::new());
    let found = binary_with(&|candidate: &str| {
        seen.borrow_mut().push(candidate.to_owned());
        true
    });
    assert_eq!(found, Some("gh"));
    assert_eq!(seen.borrow().as_slice(), ["gh"]);
}

#[test]
fn a_finder_launched_app_still_finds_homebrews_gh_when_path_has_none() {
    // The whole PATH trap in one test: nothing on PATH answers, and the island
    // must not conclude the machine has no gh.
    let found = binary_with(&|candidate: &str| candidate == "/opt/homebrew/bin/gh");
    assert_eq!(found, Some("/opt/homebrew/bin/gh"));
}

#[test]
fn a_machine_with_no_gh_anywhere_is_answered_and_not_guessed() {
    assert_eq!(binary_with(&|_: &str| false), None);
}

#[test]
fn the_child_path_carries_the_binarys_own_directory_first() {
    // gh runs git, and git's credential helper, through PATH. A Finder launch
    // has neither, so the directory gh itself came out of leads the list.
    let path = child_path("/opt/homebrew/bin/gh", Some("/usr/bin"));
    let segments: Vec<&str> = path.split(':').collect();
    assert_eq!(segments.first(), Some(&"/usr/bin"));
    assert_eq!(segments.get(1), Some(&"/opt/homebrew/bin"));
}

#[test]
fn the_child_path_of_a_stripped_launch_is_still_usable() {
    let path = child_path("/opt/homebrew/bin/gh", None);
    assert!(path.starts_with("/opt/homebrew/bin"));
    for expected in ["/usr/local/bin", "/opt/local/bin", "/usr/bin", "/bin"] {
        assert!(path.split(':').any(|segment| segment == expected));
    }
}

#[test]
fn the_child_path_never_repeats_a_directory() {
    let path = child_path("/usr/local/bin/gh", Some("/usr/local/bin:/usr/bin"));
    let mut segments: Vec<&str> = path.split(':').collect();
    let before = segments.len();
    segments.sort_unstable();
    segments.dedup();
    assert_eq!(segments.len(), before, "duplicate segment in {path}");
}

#[test]
fn a_bare_binary_name_contributes_no_empty_segment() {
    // `Path::new("gh").parent()` is Some(""), and an empty PATH segment means
    // the current directory — which is not somewhere to look for a tool.
    let path = child_path("gh", Some("/usr/bin"));
    assert!(!path.split(':').any(str::is_empty), "{path}");
}

// ---------------------------------------------------------------------------
// Which repository, from which remote
// ---------------------------------------------------------------------------

#[test]
fn every_spelling_of_a_github_remote_resolves_to_the_same_repository() {
    for url in [
        "https://github.com/block/buzz.git",
        "https://github.com/block/buzz",
        "https://github.com/block/buzz/",
        "http://github.com/block/buzz.git",
        "https://www.github.com/block/buzz.git",
        "https://github.com:443/block/buzz.git",
        "git@github.com:block/buzz.git",
        "git@github.com:block/buzz",
        "ssh://git@github.com/block/buzz.git",
        "git://github.com/block/buzz.git",
        "  https://github.com/block/buzz.git  ",
    ] {
        assert_eq!(github_slug(url), Some(slug("block", "buzz")), "{url}");
    }
}

#[test]
fn a_credential_in_a_remote_url_is_dropped_at_the_parse() {
    // The reason the answer is a slug and a remote NAME: this URL is what
    // `gh auth setup-git` and a CI checkout leave in a real .git/config, and
    // nothing downstream may ever be in a position to print it.
    let url = "https://x-access-token:ghp_notarealtokenatall@github.com/block/buzz.git";
    assert_eq!(github_slug(url), Some(slug("block", "buzz")));
    let resolved = choose(&[remote("origin", url)]);
    let chosen = resolved.unwrap_or_else(|| panic!("origin should have resolved"));
    assert_eq!(chosen.remote, "origin");
    assert_eq!(chosen.repo.slug(), "block/buzz");
}

#[test]
fn a_remote_that_is_not_github_is_not_a_github_remote() {
    for url in [
        "git@gitlab.com:block/buzz.git",
        "https://gitlab.com/block/buzz.git",
        "https://github.enterprise.example.com/block/buzz.git",
        "https://notgithub.com/block/buzz.git",
        "https://github.com.evil.example/block/buzz.git",
        "/Users/o/local/repo",
        "../sibling-checkout",
        "file:///Users/o/local/repo",
        "",
    ] {
        assert_eq!(github_slug(url), None, "{url}");
    }
}

#[test]
fn a_path_that_is_not_exactly_owner_and_name_is_refused() {
    // Two segments, each a name GitHub could have issued. `-x` would be a flag
    // if it ever reached a positional slot; `..` would be a traversal.
    for url in [
        "https://github.com/block",
        "https://github.com/block/buzz/tree/main",
        "https://github.com/block//buzz",
        "https://github.com/-flag/buzz.git",
        "https://github.com/block/-flag.git",
        "https://github.com/../buzz.git",
        "https://github.com/block/bu zz.git",
    ] {
        assert_eq!(github_slug(url), None, "{url}");
    }
}

#[test]
fn a_windows_path_is_not_a_host_called_c() {
    assert_eq!(github_slug(r"C:\repos\buzz"), None);
}

#[test]
fn the_config_dump_is_read_as_nul_separated_entries() {
    let raw = "remote.upstream.url\nhttps://github.com/block/buzz.git\0\
               remote.origin.url\nhttps://github.com/ahmetbir/vingilot.git\0";
    assert_eq!(
        parse_remotes(raw),
        vec![
            remote("upstream", "https://github.com/block/buzz.git"),
            remote("origin", "https://github.com/ahmetbir/vingilot.git"),
        ]
    );
}

#[test]
fn a_remote_name_may_contain_dots() {
    // `remote.my.fork.url` is legal git. Splitting on dots would call this
    // remote "my".
    let raw = "remote.my.fork.url\nhttps://github.com/block/buzz.git\0";
    assert_eq!(
        parse_remotes(raw),
        vec![remote("my.fork", "https://github.com/block/buzz.git")]
    );
}

#[test]
fn a_repository_with_no_remotes_parses_to_no_remotes() {
    assert_eq!(parse_remotes(""), Vec::new());
    assert_eq!(parse_remotes("\0"), Vec::new());
}

#[test]
fn origin_is_the_repository_a_worktree_is_a_checkout_of() {
    // This fork exactly: origin is the fork, upstream has the hundreds of pull
    // requests. Answering with upstream's would be answering a question nobody
    // asked.
    let chosen = choose(&[
        remote("upstream", "https://github.com/block/buzz.git"),
        remote("origin", "https://github.com/ahmetbir/vingilot.git"),
    ]);
    let chosen = chosen.unwrap_or_else(|| panic!("origin should have won"));
    assert_eq!(chosen.remote, "origin");
    assert_eq!(chosen.repo, slug("ahmetbir", "vingilot"));
}

#[test]
fn without_an_origin_the_choice_is_stable_rather_than_whatever_git_printed() {
    let first = choose(&[
        remote("zeta", "https://github.com/o/z.git"),
        remote("alpha", "https://github.com/o/a.git"),
    ]);
    let second = choose(&[
        remote("alpha", "https://github.com/o/a.git"),
        remote("zeta", "https://github.com/o/z.git"),
    ]);
    assert_eq!(first, second);
    assert_eq!(first.map(|chosen| chosen.remote), Some("alpha".to_owned()));
}

#[test]
fn an_origin_that_is_not_on_github_does_not_win_over_one_that_is() {
    let chosen = choose(&[
        remote("origin", "git@gitlab.com:o/n.git"),
        remote("github", "https://github.com/o/n.git"),
    ]);
    assert_eq!(
        chosen.map(|chosen| chosen.remote),
        Some("github".to_owned())
    );
}

#[test]
fn a_repository_with_only_non_github_remotes_chooses_nothing() {
    assert_eq!(choose(&[remote("origin", "git@gitlab.com:o/n.git")]), None);
    assert_eq!(choose(&[]), None);
}

// ---------------------------------------------------------------------------
// The refusals, resolved from real directories
// ---------------------------------------------------------------------------

/// `resolve` is generic in the answer's payload; the tests pin it to a list.
fn resolve_list(path: &str) -> Result<super::remote::Chosen, PullsAnswer<PullList>> {
    resolve(path)
}

#[test]
fn a_plain_directory_is_refused_without_starting_a_process() {
    let dir = tempdir();
    let path = dir.path().to_string_lossy().into_owned();
    match resolve_list(&path) {
        Err(PullsAnswer::NotARepo { path: named, .. }) => assert_eq!(named, path),
        other => panic!("expected NotARepo, got {other:?}"),
    }
}

#[test]
fn a_subdirectory_of_a_checkout_names_the_checkout_to_open_instead() {
    let repo = Repo::new();
    let nested = Path::new(&repo.path()).join("desktop").join("src");
    if let Err(error) = fs::create_dir_all(&nested) {
        panic!("could not create the nested directory: {error}");
    }
    match resolve_list(&nested.to_string_lossy()) {
        Err(PullsAnswer::NotARepo { enclosing, .. }) => {
            assert_eq!(enclosing, Some(repo.path()));
        }
        other => panic!("expected NotARepo with a hint, got {other:?}"),
    }
}

#[test]
fn a_repository_with_no_remotes_at_all_is_told_apart_from_a_broken_one() {
    // `git config --get-regexp` exits 1 here. That is an answer — a local-only
    // checkout — and must not read as git having failed.
    let repo = Repo::new();
    match resolve_list(&repo.path()) {
        Err(PullsAnswer::NoGitHubRemote { path, remotes }) => {
            assert_eq!(path, repo.path());
            assert_eq!(remotes, Vec::<String>::new());
        }
        other => panic!("expected NoGitHubRemote, got {other:?}"),
    }
}

#[test]
fn a_repository_whose_remotes_are_elsewhere_names_them_without_their_urls() {
    let repo = Repo::new();
    repo.git(&["remote", "add", "origin", "git@gitlab.com:o/n.git"]);
    repo.git(&[
        "remote",
        "add",
        "backup",
        "https://user:secret@bitbucket.org/o/n.git",
    ]);
    match resolve_list(&repo.path()) {
        Err(PullsAnswer::NoGitHubRemote { remotes, .. }) => {
            let mut named = remotes;
            named.sort();
            assert_eq!(named, vec!["backup".to_owned(), "origin".to_owned()]);
        }
        other => panic!("expected NoGitHubRemote, got {other:?}"),
    }
}

#[test]
fn a_real_checkout_resolves_to_the_repository_its_origin_names() {
    let repo = Repo::new();
    repo.git(&[
        "remote",
        "add",
        "upstream",
        "https://github.com/block/buzz.git",
    ]);
    repo.git(&[
        "remote",
        "add",
        "origin",
        "https://github.com/ahmetbir/vingilot.git",
    ]);
    match resolve_list(&repo.path()) {
        Ok(chosen) => {
            assert_eq!(chosen.remote, "origin");
            assert_eq!(chosen.repo.slug(), "ahmetbir/vingilot");
        }
        other => panic!("expected a resolved repository, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// The vectors: only reads, and never a token
// ---------------------------------------------------------------------------

#[test]
fn nothing_this_island_hands_gh_can_change_anything() {
    let vectors = [
        list_args("block/buzz", 51),
        view_args("block/buzz", 7159),
        auth_args("github.com"),
    ];
    for verb in [
        "create",
        "merge",
        "close",
        "reopen",
        "edit",
        "comment",
        "review",
        "ready",
        "checkout",
        "login",
        "logout",
        "refresh",
        "setup-git",
        "delete",
        "api",
    ] {
        for vector in &vectors {
            assert!(
                !vector.iter().any(|arg| arg == verb),
                "{verb} appears in {vector:?}"
            );
        }
    }
}

#[test]
fn no_vector_carries_a_token_or_asks_gh_to_print_one() {
    let vectors = [
        list_args("block/buzz", 51),
        view_args("block/buzz", 7159),
        auth_args("github.com"),
    ];
    for vector in &vectors {
        for arg in vector {
            let lowered = arg.to_ascii_lowercase();
            assert!(!lowered.contains("token"), "{arg} in {vector:?}");
            assert!(!lowered.contains("--show"), "{arg} in {vector:?}");
        }
    }
}

#[test]
fn the_list_vector_names_its_fields_rather_than_scraping_a_table() {
    let args = list_args("block/buzz", 51);
    assert!(args.iter().any(|arg| arg == "--json"));
    let fields = args
        .iter()
        .position(|arg| arg == "--json")
        .and_then(|index| args.get(index + 1))
        .unwrap_or_else(|| panic!("--json takes a value: {args:?}"));
    for field in ["number", "title", "isDraft", "author", "reviewDecision"] {
        assert!(fields.split(',').any(|name| name == field), "{field}");
    }
}

#[test]
fn the_repository_is_always_named_so_gh_guesses_nothing_from_a_directory() {
    for args in [list_args("block/buzz", 51), view_args("block/buzz", 7159)] {
        let index = args
            .iter()
            .position(|arg| arg == "--repo")
            .unwrap_or_else(|| panic!("--repo missing from {args:?}"));
        assert_eq!(args.get(index + 1).map(String::as_str), Some("block/buzz"));
    }
}

#[test]
fn the_list_asks_for_one_more_than_the_cap() {
    let args = list_args("block/buzz", PULL_CAP + 1);
    let index = args
        .iter()
        .position(|arg| arg == "--limit")
        .unwrap_or_else(|| panic!("--limit missing from {args:?}"));
    assert_eq!(
        args.get(index + 1).map(String::as_str),
        Some("51"),
        "the cap is proved by a fifty-first row, not assumed from a full page"
    );
}

#[test]
fn only_open_pull_requests_are_listed() {
    let args = list_args("block/buzz", 51);
    let index = args
        .iter()
        .position(|arg| arg == "--state")
        .unwrap_or_else(|| panic!("--state missing from {args:?}"));
    assert_eq!(args.get(index + 1).map(String::as_str), Some("open"));
}

// ---------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------

#[test]
fn a_real_gh_list_payload_parses_into_rows_the_surface_can_draw() {
    let pulls = parse_list(REAL_LIST).unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(pulls.len(), 2);
    let first = &pulls[0];
    assert_eq!(first.number, 7159);
    assert_eq!(first.author.as_deref(), Some("Trevongit"));
    assert!(!first.author_is_bot);
    assert!(!first.draft);
    assert_eq!(first.head_ref, "fix/inbox-unread-hydrate-flash");
    assert_eq!(first.base_ref, "main");
    assert_eq!(first.additions, 338);
    assert_eq!(first.deletions, 63);
    assert_eq!(first.changed_files, 8);
    assert_eq!(first.state, "OPEN");
    assert_eq!(first.review_decision.as_deref(), Some("REVIEW_REQUIRED"));
    assert_eq!(first.mergeable.as_deref(), Some("MERGEABLE"));
    assert_eq!(first.url, "https://github.com/block/buzz/pull/7159");
    assert!(pulls[1].draft, "the second row really is a draft");
}

#[test]
fn ghs_snake_case_is_bot_is_read_rather_than_silently_missed() {
    // The one field in an otherwise camelCase payload that gh spells with an
    // underscore. A blanket rename would call every bot a person, and the test
    // that caught it had to be against real output.
    let pulls = parse_list(REAL_LABELLED).unwrap_or_else(|error| panic!("{error}"));
    let first = &pulls[0];
    assert!(first.author_is_bot);
    assert_eq!(first.author.as_deref(), Some("app/dependabot"));
    assert_eq!(first.labels, vec!["dependencies", "github_actions"]);
}

#[test]
fn an_empty_repository_answers_with_an_empty_list_and_not_an_error() {
    let pulls = parse_list(REAL_EMPTY).unwrap_or_else(|error| panic!("{error}"));
    assert!(pulls.is_empty());
}

#[test]
fn ghs_empty_string_for_no_review_becomes_an_absence() {
    let raw = r#"[{"number":1,"reviewDecision":"","mergeable":"","state":"OPEN"}]"#;
    let pulls = parse_list(raw).unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(pulls[0].review_decision, None);
    assert_eq!(pulls[0].mergeable, None);
}

#[test]
fn a_pull_request_by_a_deleted_account_has_no_author_rather_than_an_empty_one() {
    let raw = r#"[{"number":1,"author":{"id":"","is_bot":false,"login":"","name":""}}]"#;
    let pulls = parse_list(raw).unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(pulls[0].author, None);
    assert!(!pulls[0].author_is_bot);
}

#[test]
fn an_answer_that_is_not_the_shape_gh_promises_is_reported_and_not_guessed_at() {
    for raw in ["", "not json", "{\"number\":1}", "[{\"number\":\"one\"}]"] {
        assert!(parse_list(raw).is_err(), "{raw}");
    }
}

#[test]
fn a_real_gh_view_payload_carries_the_body_separately() {
    let (pull, body) = parse_view(REAL_VIEW).unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(pull.number, 7159);
    assert!(body.starts_with("## Summary"));
    assert!(body.contains("read marker"));
}

// ---------------------------------------------------------------------------
// The bounds
// ---------------------------------------------------------------------------

fn numbered(count: usize) -> Vec<Pull> {
    (0..count)
        .map(|index| Pull {
            number: index as u64 + 1,
            ..Pull::default()
        })
        .collect()
}

#[test]
fn a_fifty_first_row_is_what_proves_there_are_more() {
    let mut pulls = numbered(PULL_CAP + 1);
    assert!(apply_cap(&mut pulls));
    assert_eq!(pulls.len(), PULL_CAP);
    assert_eq!(pulls.last().map(|pull| pull.number), Some(50));
}

#[test]
fn a_repository_with_exactly_the_cap_is_not_reported_as_having_more() {
    let mut pulls = numbered(PULL_CAP);
    assert!(!apply_cap(&mut pulls));
    assert_eq!(pulls.len(), PULL_CAP);
}

#[test]
fn an_empty_list_is_under_the_cap_like_any_other() {
    let mut pulls = numbered(0);
    assert!(!apply_cap(&mut pulls));
    assert!(pulls.is_empty());
}

#[test]
fn a_body_under_the_cap_is_untouched() {
    let (body, truncated) = capped_body("## Summary".to_owned());
    assert_eq!(body, "## Summary");
    assert!(!truncated);
}

#[test]
fn a_long_body_is_cut_and_says_so() {
    let (body, truncated) = capped_body("x".repeat(BODY_CAP + 10));
    assert_eq!(body.len(), BODY_CAP);
    assert!(truncated);
}

#[test]
fn a_body_is_never_cut_through_the_middle_of_a_character() {
    // A pull request body is markdown somebody wrote; the byte at the cap can
    // land inside a multi-byte character, and slicing there would panic.
    let (body, truncated) = capped_body("é".repeat(BODY_CAP));
    assert!(truncated);
    assert!(body.len() <= BODY_CAP);
    assert!(body.chars().all(|character| character == 'é'));
}

// ---------------------------------------------------------------------------
// The child: the deadline, and reading an exit code across a fork
// ---------------------------------------------------------------------------

#[test]
fn a_child_that_answers_is_read_whole() {
    let dir = tempdir();
    let child = fake_child(dir.path(), "quick", "0", "[]", 0);
    match run(&child.to_string_lossy(), &[], Duration::from_secs(5)) {
        Ok(ran) => {
            assert!(ran.ok);
            assert_eq!(ran.code, Some(0));
            assert_eq!(ran.stdout, "[]");
            assert!(!ran.capped);
        }
        Err(_) => panic!("a child that exits immediately should not have failed"),
    }
}

#[test]
fn a_childs_exit_code_survives_the_fork() {
    // The whole of `NoGitHubRemote` versus `GitFailed` turns on telling git's
    // exit 1 from its 128, so the code has to arrive intact.
    let dir = tempdir();
    let child = fake_child(dir.path(), "refuses", "0", "", 128);
    match run(&child.to_string_lossy(), &[], Duration::from_secs(5)) {
        Ok(ran) => {
            assert!(!ran.ok);
            assert_eq!(ran.code, Some(128));
            assert!(ran.stderr.contains("said so"));
        }
        Err(_) => panic!("a child that exits 128 still answered"),
    }
}

#[test]
fn a_child_that_hangs_is_killed_at_the_deadline_instead_of_hanging_the_app() {
    // The case this exists for: a gh wedged on a proxy that accepts the
    // connection and never answers. Nothing on screen can explain a wait that
    // never ends, so the wait ends.
    let dir = tempdir();
    let child = fake_child(dir.path(), "hangs", "5", "never", 0);
    let started = std::time::Instant::now();
    let outcome = run(&child.to_string_lossy(), &[], Duration::from_millis(300));
    let waited = started.elapsed();
    assert!(
        matches!(outcome, Err(RunFailure::TimedOut)),
        "a sleeping child should have timed out"
    );
    // Tight on purpose: without the deadline this returns in five seconds and a
    // generous bound would call that a pass.
    assert!(
        waited < Duration::from_secs(3),
        "the deadline was not enforced: waited {waited:?}"
    );
}

#[test]
fn a_binary_that_is_not_there_is_a_launch_failure_and_not_a_panic() {
    let dir = tempdir();
    let missing = dir.path().join("no-such-gh");
    match run(&missing.to_string_lossy(), &[], Duration::from_secs(5)) {
        Err(RunFailure::Launch(detail)) => assert!(detail.contains("did not start"), "{detail}"),
        _ => panic!("a missing binary should be a launch failure"),
    }
}

#[test]
fn a_timed_out_call_is_named_by_its_binary_and_not_its_whole_path() {
    let described = describe("/opt/homebrew/bin/gh", &list_args("block/buzz", 51));
    assert!(
        described.starts_with("gh pr list --repo block/buzz"),
        "{described}"
    );
}

#[test]
fn a_refusal_quotes_a_few_lines_and_not_a_log() {
    let noisy = (0..50)
        .map(|index| format!("line {index}"))
        .collect::<Vec<String>>()
        .join("\n");
    let kept = first_lines(&noisy, 3);
    assert_eq!(kept, "line 0 line 1 line 2");
}

// ---------------------------------------------------------------------------
// What the surface switches on
// ---------------------------------------------------------------------------

fn kind_of<T: serde::Serialize>(answer: &PullsAnswer<T>) -> String {
    let json = serde_json::to_value(answer).unwrap_or_else(|error| panic!("{error}"));
    json.get("kind")
        .and_then(|kind| kind.as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| panic!("every answer carries a kind: {json}"))
}

#[test]
fn every_refusal_is_a_distinct_kind_the_surface_can_draw_a_sentence_for() {
    let refusals: Vec<PullsAnswer<PullList>> = vec![
        PullsAnswer::NotARepo {
            path: "/tmp/x".to_owned(),
            enclosing: None,
        },
        PullsAnswer::GitMissing,
        PullsAnswer::GitFailed {
            detail: "bad config".to_owned(),
        },
        PullsAnswer::NoGitHubRemote {
            path: "/tmp/x".to_owned(),
            remotes: vec!["origin".to_owned()],
        },
        PullsAnswer::GhMissing,
        PullsAnswer::GhUnauthenticated {
            host: "github.com".to_owned(),
        },
        PullsAnswer::RequestFailed {
            repo: "o/n".to_owned(),
            detail: "no network".to_owned(),
        },
        PullsAnswer::TimedOut {
            command: "gh pr list".to_owned(),
            seconds: 20,
        },
    ];
    let mut kinds: Vec<String> = refusals.iter().map(kind_of).collect();
    assert_eq!(
        kinds,
        [
            "not-a-repo",
            "git-missing",
            "git-failed",
            "no-github-remote",
            "gh-missing",
            "gh-unauthenticated",
            "request-failed",
            "timed-out",
        ]
    );
    let before = kinds.len();
    kinds.sort();
    kinds.dedup();
    assert_eq!(kinds.len(), before, "two refusals would draw the same way");
}

#[test]
fn a_refusal_is_told_from_an_answer_without_reading_a_word_of_english() {
    let empty: PullsAnswer<PullList> = PullsAnswer::Answer(PullList {
        repo: slug("ahmetbir", "vingilot"),
        remote: "origin".to_owned(),
        pulls: Vec::new(),
        cap: PULL_CAP,
        more: false,
    });
    assert_eq!(kind_of(&empty), "answer");
    let json = serde_json::to_value(&empty).unwrap_or_else(|error| panic!("{error}"));
    // The payload is flattened beside the tag, so one discriminant serves both
    // commands and the surface reads the fields directly.
    assert_eq!(
        json.get("repo").and_then(|repo| repo.get("owner")),
        Some(&serde_json::Value::String("ahmetbir".to_owned()))
    );
    assert_eq!(
        json.get("cap").and_then(serde_json::Value::as_u64),
        Some(50)
    );
    assert_eq!(
        json.get("pulls").and_then(serde_json::Value::as_array),
        Some(&Vec::new())
    );
}

#[test]
fn the_detail_answer_carries_the_same_tag_as_the_list() {
    let detail: PullsAnswer<PullDetail> = PullsAnswer::Answer(PullDetail {
        repo: slug("block", "buzz"),
        remote: "upstream".to_owned(),
        pull: Pull::default(),
        body: "## Summary".to_owned(),
        body_truncated: false,
    });
    assert_eq!(kind_of(&detail), "answer");
    let json = serde_json::to_value(&detail).unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(
        json.get("bodyTruncated"),
        Some(&serde_json::Value::Bool(false))
    );
}

#[test]
fn a_pull_row_serialises_to_the_camel_case_the_webview_reads() {
    let pulls = parse_list(REAL_LIST).unwrap_or_else(|error| panic!("{error}"));
    let json = serde_json::to_value(&pulls[0]).unwrap_or_else(|error| panic!("{error}"));
    for key in [
        "number",
        "title",
        "url",
        "state",
        "draft",
        "author",
        "authorIsBot",
        "headRef",
        "baseRef",
        "createdAt",
        "updatedAt",
        "additions",
        "deletions",
        "changedFiles",
        "reviewDecision",
        "mergeable",
        "labels",
    ] {
        assert!(json.get(key).is_some(), "{key} missing from {json}");
    }
}

/// A repository the tests can hang directories off without a `Repo`.
#[test]
fn a_linked_worktree_is_a_working_tree_like_any_other() {
    // The island is asked about worktrees, and a worktree's `.git` is a file.
    // vingilot_repo already tells them apart; this proves the pulls island
    // accepts one rather than refusing it as "not a repository".
    let repo = Repo::new();
    repo.write("a.txt", "a\n");
    repo.git(&["add", "a.txt"]);
    repo.git(&["commit", "-m", "one"]);
    repo.git(&[
        "remote",
        "add",
        "origin",
        "https://github.com/ahmetbir/vingilot.git",
    ]);
    let outside = temp_dir();
    let linked = worktree_path(&outside, "feature");
    repo.git(&["worktree", "add", "-b", "feature", &linked, "HEAD"]);
    match resolve_list(&linked) {
        Ok(chosen) => assert_eq!(chosen.repo.slug(), "ahmetbir/vingilot"),
        other => panic!("a linked worktree should resolve, got {other:?}"),
    }
}
