//! Which ACP agent this app would run, and whether it is actually there.
//!
//! **No default agent.** `crates/buzz-acp` defaults its agent command to
//! `goose`, which is right for a harness whose only job is to run one. It is
//! wrong here: a workspace that silently picked an agent would be claiming the
//! owner has one, and the first thing he would see is a spawn failure for a
//! binary he never asked for. With nothing configured the answer is
//! `not-configured`, and the panel says which variable to set.
//!
//! **Why `BUZZ_ACP_AGENT_COMMAND` is read at all.** It is the variable this
//! repo already documents (`crates/buzz-acp/README.md`) and the one the
//! desktop's managed agents already export, so a machine that can run an ACP
//! agent for Buzz can run one here without a second setting. `VINGILOT_`
//! wins when both are set, and the args come from the *same* namespace as the
//! command that won — mixing a command from one with arguments meant for
//! another is how you spawn `codex-acp acp`.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// Read first. Set this to run a different agent here than the ACP harness
/// runs, or to run one at all when `BUZZ_ACP_AGENT_COMMAND` is unset.
const VINGILOT_COMMAND: &str = "VINGILOT_ACP_AGENT_COMMAND";
const VINGILOT_ARGS: &str = "VINGILOT_ACP_AGENT_ARGS";
/// Read second — `crates/buzz-acp`'s own variable, so one setting serves both.
const BUZZ_COMMAND: &str = "BUZZ_ACP_AGENT_COMMAND";
const BUZZ_ARGS: &str = "BUZZ_ACP_AGENT_ARGS";

/// Where to look for an agent that was named without a path, after `PATH`.
///
/// Same reason `vingilot_pty/tmux.rs` and `vingilot_worktree/mod.rs` carry
/// such a list: an app launched from Finder does not inherit a login shell's
/// `PATH`, so a `PATH`-only lookup reports "not installed" for an adapter the
/// owner installed months ago. These two are where the install routes the ACP
/// adapters document — Homebrew, and an `npm -g` prefix — put a binary.
const EXTRA_DIRS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin"];

/// The program to spawn and the arguments to spawn it with.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct AgentCommand {
    pub program: String,
    pub args: Vec<String>,
}

/// Whether there is an agent to run, and if not, what is missing. Rendered by
/// `features/runs/lib/agentTurn.ts`, which owns the copy.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Availability {
    /// Neither variable is set. `variables` is what to set, in the order this
    /// module reads them, so the panel can name them without repeating them.
    NotConfigured { variables: Vec<String> },
    /// A command is configured and nothing executable answers to that name.
    /// Reported rather than deferred to a spawn failure: "you have not set
    /// this up" and "what you set up is not installed" are different
    /// sentences, and only one of them is worth showing before a prompt is
    /// typed.
    Missing { program: String },
    /// An executable was found. `resolved` is the absolute path it was found
    /// at, which is the only thing here that survives a `PATH` argument.
    Ready {
        command: AgentCommand,
        resolved: String,
    },
}

/// The command the environment names, or `None` when it names none.
///
/// Pure in its inputs so the precedence rule is testable without touching the
/// process environment — which is global mutable state, and which several
/// tests would otherwise have to take turns over.
pub fn resolve(
    vingilot_command: Option<&str>,
    vingilot_args: Option<&str>,
    buzz_command: Option<&str>,
    buzz_args: Option<&str>,
) -> Option<AgentCommand> {
    let (program, args) = match trimmed(vingilot_command) {
        Some(program) => (program, vingilot_args),
        None => (trimmed(buzz_command)?, buzz_args),
    };
    Some(AgentCommand {
        args: normalize_args(&program, args),
        program,
    })
}

/// A variable that is set to whitespace is set to nothing.
fn trimmed(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

/// Split an args variable the way `crates/buzz-acp/src/config.rs` does —
/// on commas, dropping empties — and fall back to the same per-runtime
/// defaults it uses (`default_agent_args` there). goose needs the `acp`
/// subcommand; the dedicated adapters take none. A command this does not
/// recognise gets exactly what it was given, including nothing.
fn normalize_args(program: &str, raw: Option<&str>) -> Vec<String> {
    let given: Vec<String> = raw
        .unwrap_or_default()
        .split(',')
        .map(|arg| arg.trim().to_string())
        .filter(|arg| !arg.is_empty())
        .collect();
    if !given.is_empty() {
        return given;
    }
    match identity(program).as_str() {
        "goose" => vec!["acp".to_string()],
        _ => Vec::new(),
    }
}

/// The runtime a command names, ignoring where it lives and what the platform
/// suffixes it with. `/opt/homebrew/bin/goose` and `goose.cmd` are one agent.
fn identity(program: &str) -> String {
    let stem = Path::new(program)
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    [".exe", ".cmd", ".bat"]
        .iter()
        .find_map(|extension| stem.strip_suffix(extension))
        .unwrap_or(&stem)
        .replace(['_', ' '], "-")
}

/// The absolute path a command name resolves to, or `None` if nothing
/// executable answers to it.
///
/// `exists` is injected so the search order can be tested without installing
/// anything, and without a test's answer depending on what the machine
/// running it happens to have.
pub fn locate(program: &str, dirs: &[PathBuf], exists: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    let named = Path::new(program);
    // A command with a separator in it is a path, not a name to search for.
    // Searching `PATH` for `./bin/agent` would be answering a different
    // question than the one asked.
    if named.components().count() > 1 {
        return exists(named).then(|| named.to_path_buf());
    }
    dirs.iter()
        .map(|dir| dir.join(program))
        .find(|candidate| exists(candidate))
}

/// `PATH` first, then the well-known install directories that are not on it.
pub fn search_dirs(path_var: Option<&str>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = path_var
        .unwrap_or_default()
        .split(':')
        .filter(|entry| !entry.is_empty())
        .map(PathBuf::from)
        .collect();
    for extra in EXTRA_DIRS {
        let extra = PathBuf::from(extra);
        if !dirs.contains(&extra) {
            dirs.push(extra);
        }
    }
    dirs
}

/// Whether a path is a file this process could execute. The mode bit, not
/// mere existence: a directory named `goose` on `PATH` is not an agent.
fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        match std::fs::metadata(path) {
            Ok(meta) => meta.is_file() && meta.permissions().mode() & 0o111 != 0,
            Err(_) => false,
        }
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

/// What the environment this process was started with amounts to.
pub fn availability() -> Availability {
    let vingilot_command = std::env::var(VINGILOT_COMMAND).ok();
    let vingilot_args = std::env::var(VINGILOT_ARGS).ok();
    let buzz_command = std::env::var(BUZZ_COMMAND).ok();
    let buzz_args = std::env::var(BUZZ_ARGS).ok();
    let resolved = resolve(
        vingilot_command.as_deref(),
        vingilot_args.as_deref(),
        buzz_command.as_deref(),
        buzz_args.as_deref(),
    );
    let Some(command) = resolved else {
        return Availability::NotConfigured {
            variables: vec![VINGILOT_COMMAND.to_string(), BUZZ_COMMAND.to_string()],
        };
    };
    let dirs = search_dirs(std::env::var("PATH").ok().as_deref());
    match locate(&command.program, &dirs, &is_executable) {
        Some(path) => Availability::Ready {
            command,
            resolved: path.to_string_lossy().into_owned(),
        },
        None => Availability::Missing {
            program: command.program,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_configured_names_no_agent() {
        assert_eq!(resolve(None, None, None, None), None);
    }

    #[test]
    fn a_variable_set_to_whitespace_is_set_to_nothing() {
        assert_eq!(resolve(Some("   "), None, Some("  \t "), None), None);
    }

    #[test]
    fn the_forks_own_variable_wins_over_the_harnesss() {
        let resolved = resolve(Some("codex-acp"), None, Some("goose"), Some("acp"));
        assert_eq!(
            resolved,
            Some(AgentCommand {
                args: Vec::new(),
                program: "codex-acp".to_string(),
            })
        );
    }

    #[test]
    fn args_never_cross_from_one_namespace_to_the_other() {
        // The failure this rule exists for: the harness is configured for
        // goose (which needs `acp`), the workspace for an adapter that takes
        // no subcommand. Reading the args from the losing namespace spawns
        // `codex-acp acp`, which is not a command codex-acp has.
        let resolved = resolve(Some("codex-acp"), None, Some("goose"), Some("acp"));
        assert_eq!(resolved.map(|command| command.args), Some(Vec::new()));
    }

    #[test]
    fn the_harnesss_variables_are_read_when_the_forks_are_unset() {
        let resolved = resolve(None, None, Some("goose"), None);
        assert_eq!(
            resolved,
            Some(AgentCommand {
                args: vec!["acp".to_string()],
                program: "goose".to_string(),
            })
        );
    }

    #[test]
    fn goose_gets_the_subcommand_that_makes_it_speak_acp() {
        assert_eq!(normalize_args("goose", None), vec!["acp".to_string()]);
        assert_eq!(
            normalize_args("/opt/homebrew/bin/goose", Some("")),
            vec!["acp".to_string()]
        );
    }

    #[test]
    fn an_adapter_that_takes_no_subcommand_is_given_none() {
        assert!(normalize_args("claude-agent-acp", None).is_empty());
        assert!(normalize_args("codex-acp", Some("  ")).is_empty());
    }

    #[test]
    fn explicit_args_are_passed_through_in_order() {
        assert_eq!(
            normalize_args("goose", Some("acp,-c,model=\"x\"")),
            vec!["acp", "-c", "model=\"x\""]
        );
    }

    #[test]
    fn an_unknown_command_is_given_exactly_what_it_was_given() {
        assert!(normalize_args("my-agent", None).is_empty());
        assert_eq!(normalize_args("my-agent", Some("serve")), vec!["serve"]);
    }

    #[test]
    fn a_runtime_is_the_same_runtime_wherever_it_lives() {
        assert_eq!(identity("/usr/local/bin/goose"), "goose");
        assert_eq!(identity("GOOSE.CMD"), "goose");
        assert_eq!(identity("claude_agent_acp"), "claude-agent-acp");
    }

    #[test]
    fn a_bare_name_is_looked_for_in_each_directory_in_order() {
        let dirs = vec![PathBuf::from("/a"), PathBuf::from("/b")];
        let found = locate("agent", &dirs, &|path| path == Path::new("/b/agent"));
        assert_eq!(found, Some(PathBuf::from("/b/agent")));
    }

    #[test]
    fn a_name_nothing_answers_to_resolves_to_nothing() {
        let dirs = vec![PathBuf::from("/a")];
        assert_eq!(locate("agent", &dirs, &|_| false), None);
    }

    #[test]
    fn a_command_with_a_path_in_it_is_not_searched_for_by_name() {
        // `/a/agent` exists; the request was for `./bin/agent`. Searching the
        // directories anyway would run a different program than the one named.
        let dirs = vec![PathBuf::from("/a")];
        let found = locate("./bin/agent", &dirs, &|path| path == Path::new("/a/agent"));
        assert_eq!(found, None);
    }

    #[test]
    fn a_command_given_as_a_path_is_taken_at_that_path() {
        let dirs = vec![PathBuf::from("/a")];
        let found = locate("/opt/x/agent", &dirs, &|path| {
            path == Path::new("/opt/x/agent")
        });
        assert_eq!(found, Some(PathBuf::from("/opt/x/agent")));
    }

    #[test]
    fn the_install_locations_a_finder_launch_loses_are_searched_after_path() {
        let dirs = search_dirs(Some("/usr/bin:/bin"));
        assert_eq!(dirs[0], PathBuf::from("/usr/bin"));
        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert!(dirs.contains(&PathBuf::from("/usr/local/bin")));
    }

    #[test]
    fn a_directory_already_on_path_is_not_searched_twice() {
        let dirs = search_dirs(Some("/opt/homebrew/bin"));
        let homebrew = dirs
            .iter()
            .filter(|dir| *dir == &PathBuf::from("/opt/homebrew/bin"))
            .count();
        assert_eq!(homebrew, 1);
    }

    #[test]
    fn an_empty_path_still_searches_the_known_locations() {
        assert_eq!(search_dirs(None).len(), EXTRA_DIRS.len());
        assert_eq!(search_dirs(Some("")).len(), EXTRA_DIRS.len());
    }

    #[test]
    fn what_is_not_configured_serialises_with_the_names_to_set() {
        let json = serde_json::to_string(&Availability::NotConfigured {
            variables: vec!["A".to_string()],
        })
        .unwrap_or_default();
        assert_eq!(json, r#"{"kind":"not-configured","variables":["A"]}"#);
    }

    #[test]
    fn what_is_missing_serialises_with_the_name_that_answered_to_nothing() {
        let json = serde_json::to_string(&Availability::Missing {
            program: "goose".to_string(),
        })
        .unwrap_or_default();
        assert_eq!(json, r#"{"kind":"missing","program":"goose"}"#);
    }
}
