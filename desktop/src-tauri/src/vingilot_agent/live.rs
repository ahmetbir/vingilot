//! An agent, a worktree, and a diff — driven end to end against real git.
//!
//! Every test here runs the code that ships: `vingilot_agent::run` for the
//! turn, `vingilot_worktree::add`/`remove` for the checkout, and
//! `vingilot_worktree::diff` for what changed. Nothing is re-implemented for
//! the test, so a regression in any of the three fails here.
//!
//! **The agent is a stub, and that is stated everywhere it matters.** No ACP
//! harness was installed on the machine this was written on — no
//! `claude-agent-acp`, no `codex-acp`, no `goose`, and the installed
//! `codex` CLI (0.142.3) has no ACP mode — and nothing was installed to make
//! one appear. So the agent below is forty lines of `/bin/sh` that speaks
//! ACP correctly and decides nothing. That is enough to prove the *wiring* —
//! the handshake, the session's cwd, permission handling, the transcript, the
//! edit landing in the worktree, and the diff surface reading it back — and it
//! is not evidence about any real agent's judgement. The two claims are kept
//! apart deliberately; see `vingilot/docs/workbench.md`.
//!
//! **`VINGILOT_AGENT_SCRATCH_REPO`** points these at a repository that already
//! exists instead of a fresh temp one. That is how the owner's "izole" proof
//! was run — against a throwaway repo under the scratchpad, never a real
//! checkout — while still executing exactly this code. Unset, which is how CI
//! runs, each test builds its own repository and takes it away again.
//!
//! Teardown is git's: `git worktree remove`, which refuses a dirty tree, so
//! the agent's own edit is reverted through git first. Nothing here removes a
//! directory by hand.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use tempfile::TempDir;

use super::client::AgentError;
use super::trace::TraceKind;
use super::{run, Deadlines};
use crate::vingilot_worktree::diff::{diff as read_diff, FileChange};
use crate::vingilot_worktree::testrepo::{git_at, temp_dir, worktree_path, Repo};
use crate::vingilot_worktree::{add, remove, WorktreeError};

/// The variable the app resolves an agent from. Set per test, removed after.
const COMMAND_VAR: &str = "VINGILOT_ACP_AGENT_COMMAND";
const ARGS_VAR: &str = "VINGILOT_ACP_AGENT_ARGS";
/// Read by `crates/buzz-acp` too, so a machine set up for the harness needs no
/// second setting — which also means a test must clear it, or the owner's own
/// harness configuration would decide what these tests run.
const BUZZ_COMMAND_VAR: &str = "BUZZ_ACP_AGENT_COMMAND";
const BUZZ_ARGS_VAR: &str = "BUZZ_ACP_AGENT_ARGS";

/// Where the stub writes what it saw, so the test can assert on the agent's
/// own view rather than on this side's belief about it.
const CWD_REPORT: &str = "VINGILOT_STUB_CWD_REPORT";
const VERDICT_REPORT: &str = "VINGILOT_STUB_VERDICT_REPORT";

/// An ACP agent in `/bin/sh`: handshake, session, one permission request, one
/// edit, a short transcript, `end_turn`.
///
/// The edit is written to a **relative** path on purpose. A file that changes
/// at `greeter.py` proves the process was started in the worktree; a stub that
/// wrote to an absolute path would prove only that this test can join two
/// strings.
const STUB_AGENT: &str = r#"#!/bin/sh
set -u
request_id() { printf '%s' "$1" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p'; }
while IFS= read -r line; do
  id=$(request_id "$line")
  case "$line" in
    *'"method":"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":2,"agentCapabilities":{}}}\n' "$id"
      ;;
    *'"method":"session/new"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"stub-session"}}\n' "$id"
      ;;
    *'"method":"session/prompt"'*)
      pwd -P > "$VINGILOT_STUB_CWD_REPORT"
      printf '{"jsonrpc":"2.0","id":9001,"method":"session/request_permission","params":{"sessionId":"stub-session","options":[{"kind":"reject_once","optionId":"stub-no","name":"Leave it"},{"kind":"allow_once","optionId":"stub-allow-7f","name":"Edit greeter.py"}]}}\n'
      IFS= read -r verdict
      printf '%s\n' "$verdict" > "$VINGILOT_STUB_VERDICT_REPORT"
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"stub-session","update":{"sessionUpdate":"tool_call","title":"edit greeter.py","status":"in_progress"}}}\n'
      printf 'def farewell(name):\n    return f"goodbye {name}"\n' >> greeter.py
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"stub-session","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"added "}}}}\n'
      printf '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"stub-session","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"farewell()"}}}}\n'
      printf '{"jsonrpc":"2.0","id":%s,"result":{"stopReason":"end_turn"}}\n' "$id"
      ;;
  esac
done
"#;

/// Answers the handshake, then says nothing at all for the whole turn.
const MUTE_AGENT: &str = r#"#!/bin/sh
set -u
request_id() { printf '%s' "$1" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p'; }
while IFS= read -r line; do
  id=$(request_id "$line")
  case "$line" in
    *'"method":"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":2,"agentCapabilities":{}}}\n' "$id"
      ;;
    *'"method":"session/new"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"sessionId":"stub-session"}}\n' "$id"
      ;;
    *'"method":"session/prompt"'*)
      sleep 30
      ;;
  esac
done
"#;

/// Dies on the first thing it is asked, with a reason on stderr — an
/// unauthenticated adapter's shape of failure.
const DYING_AGENT: &str = r#"#!/bin/sh
echo "no credentials for this provider" >&2
exit 3
"#;

/// Serialises the tests: they configure the agent through the process
/// environment, which every thread shares.
fn env_lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    match LOCK.get_or_init(|| Mutex::new(())).lock() {
        Ok(guard) => guard,
        // A test that panicked while holding it poisoned it. The next test
        // still needs an environment it controls, and it is about to overwrite
        // every variable it reads, so the poison carries no state worth
        // respecting.
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// An agent this process is configured to run, for as long as this value
/// lives. Dropping it puts the environment back.
struct Configured {
    _guard: MutexGuard<'static, ()>,
    /// Holds the script on disk. Named for what it is rather than dropped,
    /// because dropping it early would delete the agent mid-turn.
    _home: TempDir,
    reports: PathBuf,
}

impl Configured {
    /// Write `script` somewhere executable and point the app at it.
    fn agent(script: &str) -> Self {
        let configured = Self::nothing();
        let path = configured._home.path().join("stub-acp-agent");
        if let Err(error) = fs::write(&path, script) {
            panic!("could not write the stub agent: {error}");
        }
        if let Err(error) = fs::set_permissions(&path, fs::Permissions::from_mode(0o755)) {
            panic!("could not make the stub agent executable: {error}");
        }
        std::env::set_var(COMMAND_VAR, &path);
        configured
    }

    /// No agent configured, and none inherited from the owner's own harness
    /// settings either.
    fn nothing() -> Self {
        let guard = env_lock();
        for variable in [COMMAND_VAR, ARGS_VAR, BUZZ_COMMAND_VAR, BUZZ_ARGS_VAR] {
            std::env::remove_var(variable);
        }
        let home = temp_dir();
        let reports = home.path().to_path_buf();
        std::env::set_var(CWD_REPORT, reports.join("cwd"));
        std::env::set_var(VERDICT_REPORT, reports.join("verdict"));
        Self {
            _guard: guard,
            _home: home,
            reports,
        }
    }

    /// What the stub wrote to one of its report files.
    fn report(&self, name: &str) -> String {
        fs::read_to_string(self.reports.join(name))
            .unwrap_or_default()
            .trim()
            .to_string()
    }
}

impl Drop for Configured {
    fn drop(&mut self) {
        for variable in [
            COMMAND_VAR,
            ARGS_VAR,
            BUZZ_COMMAND_VAR,
            BUZZ_ARGS_VAR,
            CWD_REPORT,
            VERDICT_REPORT,
        ] {
            std::env::remove_var(variable);
        }
    }
}

/// The repository under test: a fresh one, or the throwaway the owner's proof
/// pointed these at.
enum Under {
    Temp(Repo),
    Named(String),
}

impl Under {
    fn path(&self) -> String {
        match self {
            Under::Temp(repo) => repo.path(),
            Under::Named(path) => path.clone(),
        }
    }
}

/// A repository with `greeter.py` committed in it, because the claim under
/// test is that an agent's **edit to an existing file** reaches the diff
/// surface. A brand-new file would show up there too, and would prove less:
/// an untracked file is the one case git reports without any comparison.
fn under_test() -> Under {
    let path = std::env::var("VINGILOT_AGENT_SCRATCH_REPO").unwrap_or_default();
    if !path.trim().is_empty() {
        let path = path.trim().to_string();
        assert!(
            Path::new(&path).join("greeter.py").is_file(),
            "the repository at {path} has no greeter.py to edit"
        );
        return Under::Named(path);
    }
    let repo = Repo::new();
    repo.write(
        "greeter.py",
        "def greet(name):\n    return f\"hello {name}\"\n",
    );
    repo.git(&["add", "greeter.py"]);
    repo.git(&["commit", "-m", "greeter"]);
    Under::Temp(repo)
}

/// Short deadlines, so a test that would otherwise hang fails in seconds.
fn quick() -> Deadlines {
    Deadlines {
        handshake: Duration::from_secs(20),
        idle: Duration::from_secs(20),
        turn: Duration::from_secs(60),
    }
}

/// A worktree of `repo`, on a branch named for the test that asked for one.
fn worktree(repo: &str, branch: &str, root: &TempDir) -> String {
    let path = worktree_path(root, branch);
    match add(repo, branch, "HEAD", &path) {
        Ok(created) => created.path,
        Err(error) => panic!("could not open a worktree to work in: {error:?}"),
    }
}

/// Put the worktree back the way git made it and close it. Reverting first is
/// not a workaround for the dirty refusal — it is the owner's own choice made
/// explicit: this is a throwaway branch whose only content is the stub's edit.
fn close(repo: &str, path: &str) {
    let git = git_at(path, &["checkout", "--", "."]);
    assert!(git, "could not revert the stub's edit at {path}");
    if let Err(error) = remove(repo, path) {
        panic!("could not close the worktree: {error:?}");
    }
}

// ---------------------------------------------------------------------------

#[test]
fn an_agent_edits_a_file_in_its_worktree_and_the_diff_surface_shows_the_change() {
    let configured = Configured::agent(STUB_AGENT);
    let under = under_test();
    let repo = under.path();
    let root = temp_dir();
    let tree = worktree(&repo, "agent-edit", &root);

    let turn = match run(Path::new(&tree), "add a farewell to greeter.py", quick()) {
        Ok(turn) => turn,
        Err(error) => panic!("the turn did not finish: {error:?}"),
    };

    assert_eq!(turn.stop_reason, "end_turn");
    assert_eq!(turn.session_id, "stub-session");
    assert_eq!(turn.dropped, 0);

    // The transcript reads as sentences, not as the chunks it arrived in.
    let said: Vec<&str> = turn
        .trace
        .iter()
        .filter(|entry| entry.kind == TraceKind::Message)
        .map(|entry| entry.text.as_str())
        .collect();
    assert_eq!(said, vec!["added farewell()"]);
    assert!(turn
        .trace
        .iter()
        .any(|entry| entry.kind == TraceKind::ToolCall
            && entry.text == "edit greeter.py [in_progress]"));
    assert!(turn.trace.iter().any(
        |entry| entry.kind == TraceKind::Permission && entry.text == "granted Edit greeter.py"
    ));

    // The file on disk, in the worktree, not anywhere else.
    let edited = fs::read_to_string(Path::new(&tree).join("greeter.py")).unwrap_or_default();
    assert!(
        edited.contains("def farewell(name):"),
        "the agent's edit is not in the worktree: {edited}"
    );

    // The diff surface — the same command the Diff tab calls, against the same
    // worktree, with no knowledge that an agent was involved.
    let shown = match read_diff(&tree, "HEAD") {
        Ok(shown) => shown,
        Err(error) => panic!("the diff could not be read: {error:?}"),
    };
    let changed: Vec<&str> = shown.files.iter().map(|file| file.path.as_str()).collect();
    assert_eq!(changed, vec!["greeter.py"]);
    // A modification of a file that was already committed — not a new file,
    // which git would report without comparing anything.
    assert_eq!(shown.files[0].change, FileChange::Modified);
    assert_eq!(shown.additions, 2);
    assert_eq!(shown.deletions, 0);
    let patch = &shown.files[0].patch;
    assert!(
        patch.contains("+def farewell(name):"),
        "the patch does not carry the agent's line: {patch}"
    );

    // Evidence, printed rather than asserted: this is what the owner reads
    // when the suite is run against his scratch repo with --nocapture.
    println!("--- vingilot agent proof ---");
    println!("repository: {repo}");
    println!("worktree:   {tree}");
    println!("stop:       {}", turn.stop_reason);
    println!("diff:       +{} -{}", shown.additions, shown.deletions);
    println!("{patch}");

    // The agent's edit does not make the worktree disposable: `remove` still
    // refuses it, exactly as it refuses the owner's own uncommitted work.
    match remove(&repo, &tree) {
        Err(WorktreeError::Dirty { entries, .. }) => {
            assert!(entries.iter().any(|entry| entry.contains("greeter.py")));
        }
        other => panic!("an agent's edit was not treated as dirty: {other:?}"),
    }

    close(&repo, &tree);
    drop(configured);
}

#[test]
fn the_agent_works_in_the_worktree_and_the_projects_own_checkout_is_untouched() {
    let configured = Configured::agent(STUB_AGENT);
    let under = under_test();
    let repo = under.path();
    let root = temp_dir();
    let tree = worktree(&repo, "agent-cwd", &root);

    if let Err(error) = run(Path::new(&tree), "work here", quick()) {
        panic!("the turn did not finish: {error:?}");
    }

    // The agent's own answer about where it was, canonicalised on both sides
    // because macOS prints /private/var for /var.
    let expected = Path::new(&tree)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(&tree));
    assert_eq!(
        PathBuf::from(configured.report("cwd")),
        expected,
        "the agent was started somewhere other than its worktree"
    );

    // The collision boundary, as a measurement rather than a claim: the
    // project's own checkout has nothing in it after the agent ran.
    let main_tree = match read_diff(&repo, "HEAD") {
        Ok(shown) => shown,
        Err(error) => panic!("the project's own diff could not be read: {error:?}"),
    };
    assert!(
        main_tree.files.is_empty(),
        "the agent changed the project's own checkout: {:?}",
        main_tree.files
    );

    close(&repo, &tree);
    drop(configured);
}

#[test]
fn the_permission_the_agent_offered_is_the_one_it_is_handed_back() {
    let configured = Configured::agent(STUB_AGENT);
    let under = under_test();
    let repo = under.path();
    let root = temp_dir();
    let tree = worktree(&repo, "agent-permission", &root);

    if let Err(error) = run(Path::new(&tree), "ask me first", quick()) {
        panic!("the turn did not finish: {error:?}");
    }

    // The id the stub minted, not the kind and not a guess. An adapter that
    // gets `allow_once` back as an option id grants nothing and hangs.
    let verdict = configured.report("verdict");
    assert!(
        verdict.contains(r#""optionId":"stub-allow-7f""#),
        "the grant did not carry the agent's own option id: {verdict}"
    );
    assert!(
        verdict.contains(r#""outcome":"selected""#),
        "the grant was not a selection: {verdict}"
    );

    close(&repo, &tree);
    drop(configured);
}

#[test]
fn an_agent_that_goes_quiet_is_given_up_on_rather_than_held_onto() {
    let configured = Configured::agent(MUTE_AGENT);
    let under = under_test();
    let repo = under.path();
    let root = temp_dir();
    let tree = worktree(&repo, "agent-mute", &root);

    let deadlines = Deadlines {
        handshake: Duration::from_secs(20),
        idle: Duration::from_secs(1),
        turn: Duration::from_secs(20),
    };
    match run(Path::new(&tree), "say nothing", deadlines) {
        Err(AgentError::Silent { phase, seconds }) => {
            assert_eq!(phase, "turn");
            assert_eq!(seconds, 1);
        }
        other => panic!("a silent agent was not given up on: {other:?}"),
    }

    close(&repo, &tree);
    drop(configured);
}

#[test]
fn an_agent_that_dies_reports_what_it_said_on_the_way_out() {
    let configured = Configured::agent(DYING_AGENT);
    let under = under_test();
    let repo = under.path();
    let root = temp_dir();
    let tree = worktree(&repo, "agent-dies", &root);

    match run(Path::new(&tree), "start up", quick()) {
        Err(AgentError::Exited { message }) => assert!(
            message.contains("no credentials for this provider"),
            "the agent's own reason was lost: {message}"
        ),
        other => panic!("a dead agent was not reported as one: {other:?}"),
    }

    close(&repo, &tree);
    drop(configured);
}

#[test]
fn with_no_agent_configured_the_answer_names_what_to_set() {
    let configured = Configured::nothing();
    let under = under_test();
    let repo = under.path();
    let root = temp_dir();
    let tree = worktree(&repo, "agent-unset", &root);

    match run(Path::new(&tree), "do something", quick()) {
        Err(AgentError::NotConfigured { variables }) => {
            assert!(variables.contains(&COMMAND_VAR.to_string()));
            assert!(variables.contains(&BUZZ_COMMAND_VAR.to_string()));
        }
        other => panic!("an unconfigured workspace claimed an agent: {other:?}"),
    }

    // Nothing ran, so nothing is dirty and the plain removal is enough.
    if let Err(error) = remove(&repo, &tree) {
        panic!("could not close the worktree: {error:?}");
    }
    drop(configured);
}
