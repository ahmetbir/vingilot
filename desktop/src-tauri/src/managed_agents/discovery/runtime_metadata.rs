/// Static capabilities and installation metadata for a known ACP runtime.
pub(crate) struct KnownAcpRuntime {
    pub id: &'static str,
    pub label: &'static str,
    pub commands: &'static [&'static str],
    pub aliases: &'static [&'static str],
    pub avatar_url: &'static str,
    /// MCP server this runtime is given at `session/new`, or `None` when it needs
    /// none.
    ///
    /// `None` is a claim about the harness, not an absence of one: it says this
    /// harness runs the `buzz` CLI in a shell that carries the harness's own
    /// environment, so the CLI finds `BUZZ_PRIVATE_KEY` there. Goose and Claude
    /// Code do. Codex sandboxes its subprocesses and does not, which is why it
    /// carries `buzz-dev-mcp` — that server is spawned by the harness with the
    /// credentials injected into *its* env, so its `shell` tool can authenticate
    /// where the agent's own shell cannot. See [`effective_mcp_command`] for what
    /// an unclassified command gets.
    pub mcp_command: Option<&'static str>,
    /// Whether to enable MCP hook tools (`_Stop`, `_PostCompact`) for this agent.
    pub mcp_hooks: bool,
    /// CLI binary that indicates partial install (e.g. `"claude"` when `claude-agent-acp` is missing).
    pub underlying_cli: Option<&'static str>,
    /// Shell commands to install the runtime CLI itself (run sequentially).
    pub cli_install_commands: &'static [&'static str],
    /// Windows-specific CLI install commands (e.g. PowerShell installers).
    /// When non-empty on Windows, these are used instead of `cli_install_commands`.
    #[allow(dead_code)] // read only on Windows via cli_install_commands_for_os()
    pub cli_install_commands_windows: &'static [&'static str],
    /// Shell commands to install the ACP adapter (run sequentially, after CLI).
    pub adapter_install_commands: &'static [&'static str],
    /// Official CLI installation documentation.
    pub cli_install_instructions_url: &'static str,
    /// ACP adapter installation documentation.
    pub adapter_install_instructions_url: &'static str,
    /// Human-readable hint about installing the CLI binary.
    pub cli_install_hint: &'static str,
    /// Human-readable hint about installing the ACP adapter.
    pub adapter_install_hint: &'static str,
    /// Harness-specific skill discovery directory (e.g. `.goose/skills`).
    /// `Some(dir)` → Buzz creates a symlink at `<nest>/<dir>/buzz-cli`
    /// pointing to the canonical `.agents/skills/buzz-cli`. `None` → this
    /// runtime reads the canonical path directly or has no skill support.
    pub skill_dir: Option<&'static str>,
    /// Whether this runtime handles model switching via ACP protocol natively.
    /// Currently unused — env var injection runs unconditionally regardless of
    /// this value. Retained as scaffolding for when ACP model switching matures.
    #[allow(dead_code)]
    pub supports_acp_model_switching: bool,
    pub model_env_var: Option<&'static str>,
    pub provider_env_var: Option<&'static str>,
    pub provider_locked: bool,
    pub default_env: &'static [(&'static str, &'static str)],
    pub config_file_path: Option<&'static str>,
    #[allow(dead_code)] // reserved for format-based dispatch when readers are unified
    pub config_file_format: Option<&'static str>,
    pub supports_acp_native_config: bool, // tier 1a: config/read+write
    pub thinking_env_var: Option<&'static str>,
    /// Env var for normalizing `max_output_tokens`. `None` when the harness
    /// does not have a first-class env var for this field (config-file only).
    pub max_tokens_env_var: Option<&'static str>,
    /// Env var for normalizing `context_limit`. `None` when not applicable.
    pub context_limit_env_var: Option<&'static str>,
    /// Env var for normalizing `max_rounds`. `None` when not applicable.
    pub max_rounds_env_var: Option<&'static str>,
    /// Normalized field keys that must be set for this harness to function.
    /// Used by the config bridge to mark fields as required in the UI.
    /// Keys match the camelCase names used in `NormalizedConfig` (e.g. "model", "provider").
    pub required_normalized_fields: &'static [&'static str],
    /// Human-readable hint shown in Doctor when the runtime is available but not
    /// authenticated. `None` for runtimes that have no login step (goose, buzz-agent).
    pub login_hint: Option<&'static str>,
    /// CLI args for probing authentication status. `args[0]` is the binary name;
    /// the remainder are the subcommand. `None` for runtimes with no login step.
    pub auth_probe_args: Option<&'static [&'static str]>,
}

impl KnownAcpRuntime {
    /// Return the CLI install commands for the current platform.
    ///
    /// On Windows, returns `cli_install_commands_windows` when non-empty,
    /// falling back to the default `cli_install_commands`. On other platforms
    /// always returns `cli_install_commands`.
    pub fn cli_install_commands_for_os(&self) -> &[&str] {
        #[cfg(windows)]
        {
            if !self.cli_install_commands_windows.is_empty() {
                return self.cli_install_commands_windows;
            }
        }
        self.cli_install_commands
    }
}

/// The MCP server given to a command that `KNOWN_ACP_RUNTIMES` does not classify.
pub(crate) const UNCLASSIFIED_MCP_COMMAND: &str = "buzz-dev-mcp";

/// The MCP server binary an agent on `runtime` should be spawned with.
///
/// A classified runtime answers for itself, including when the answer is "none".
/// An unclassified command — every tier-2 preset, every custom harness — resolves
/// to `buzz-dev-mcp`, because the honest reading of "this command is not in the
/// table" is *we do not know whether this harness's shell carries the
/// environment*, and the failure mode of guessing wrong is silent: the agent's
/// `buzz messages send` exits 3 with `auth_error` and it has no other way to
/// reply. The reverse mistake costs one idle stdio subprocess per agent.
pub(crate) fn effective_mcp_command(runtime: Option<&KnownAcpRuntime>) -> &'static str {
    match runtime {
        Some(runtime) => runtime.mcp_command.unwrap_or(""),
        None => UNCLASSIFIED_MCP_COMMAND,
    }
}

/// Resolve the MCP server binary an agent on `command` should be spawned with.
///
/// `None` means the harness gets no MCP server — either because its runtime
/// declares it needs none, or because the binary could not be found. Those two
/// look identical to the harness but not to the operator, so the second is
/// logged against `agent_label`: for a harness whose shell sanitises the
/// environment, losing this path means losing every reply.
///
/// Resolution goes through `resolve_command`, which finds a bundled sidecar
/// beside the running executable (`Vingilot.app/Contents/MacOS/buzz-dev-mcp`)
/// as well as a source checkout's `target/{debug,release}`.
pub(crate) fn resolve_mcp_command(command: &str, agent_label: &str) -> Option<std::path::PathBuf> {
    let mcp_command = effective_mcp_command(super::known_acp_runtime(command));
    if mcp_command.is_empty() {
        return None;
    }
    let resolved = super::resolve_command(mcp_command);
    if resolved.is_none() {
        eprintln!(
            "buzz-desktop: {agent_label}: mcp_command {mcp_command:?} not found; replies now \
             depend on the harness's own shell carrying BUZZ_PRIVATE_KEY"
        );
    }
    resolved
}

#[cfg(test)]
mod tests {
    use super::super::{known_acp_runtime, known_acp_runtime_exact};
    use super::effective_mcp_command;

    #[test]
    fn unclassified_commands_get_the_credentialed_mcp_shell() {
        // Every tier-2 preset command, plus a custom harness that is in no
        // table at all. None of these is in KNOWN_ACP_RUNTIMES, so none of them
        // was ever asked whether its shell carries BUZZ_PRIVATE_KEY.
        for command in [
            "kimi",
            "hermes-acp",
            "cursor-agent",
            "omp",
            "grok",
            "opencode",
            "amp-acp",
            "openclaw",
            "devin",
            "some-harness-nobody-has-heard-of",
        ] {
            assert!(
                known_acp_runtime(command).is_none(),
                "{command} is expected to be unclassified"
            );
            assert_eq!(
                effective_mcp_command(known_acp_runtime(command)),
                "buzz-dev-mcp",
                "{command} must be given the credentialed MCP shell"
            );
        }
    }

    /// The classification has to survive resolution: an unclassified harness
    /// must come out of `resolve_mcp_command` holding a real path, and a runtime
    /// that declared it needs none must come out empty-handed even when the
    /// binary is sitting right there on PATH.
    #[cfg(unix)]
    #[test]
    fn unclassified_harness_resolves_the_mcp_binary_a_classified_one_declines() {
        use std::os::unix::fs::PermissionsExt;

        let _guard = crate::managed_agents::lock_path_mutex();
        let temp = tempfile::tempdir().expect("tempdir");
        let planted = temp.path().join("buzz-dev-mcp");
        std::fs::write(&planted, "#!/bin/sh\n").expect("write planted binary");
        std::fs::set_permissions(&planted, std::fs::Permissions::from_mode(0o755))
            .expect("chmod planted binary");

        let old_path = std::env::var_os("PATH").unwrap_or_default();
        let new_path = std::env::join_paths(
            std::iter::once(temp.path().to_path_buf()).chain(std::env::split_paths(&old_path)),
        )
        .expect("join PATH");
        std::env::set_var("PATH", new_path);
        super::super::clear_resolve_cache();

        let kimi = super::resolve_mcp_command("kimi", "test agent");
        let goose = super::resolve_mcp_command("goose", "test agent");

        std::env::set_var("PATH", &old_path);
        super::super::clear_resolve_cache();

        assert!(
            kimi.is_some_and(|path| path.ends_with("buzz-dev-mcp")),
            "an unclassified harness must resolve the credentialed MCP binary"
        );
        assert!(
            goose.is_none(),
            "a runtime that declares it needs no MCP server must not be given one"
        );
    }

    #[test]
    fn classified_runtimes_keep_their_own_answer() {
        // A runtime in the table has been asked and has answered; the default
        // must not override either answer.
        for (id, expected) in [
            ("goose", ""),
            ("claude", ""),
            ("codex", "buzz-dev-mcp"),
            ("buzz-agent", "buzz-dev-mcp"),
        ] {
            assert_eq!(
                effective_mcp_command(known_acp_runtime_exact(id)),
                expected,
                "{id} must keep its declared mcp_command"
            );
        }
    }

    #[test]
    fn vendor_metadata_distinguishes_cli_and_adapter_guidance() {
        let goose = known_acp_runtime_exact("goose").unwrap();
        assert_eq!(
            goose.cli_install_instructions_url,
            "https://goose-docs.ai/docs/getting-started/installation/"
        );
        assert!(goose.adapter_install_instructions_url.is_empty());
        assert!(goose.cli_install_hint.contains("Goose CLI"));
        assert!(goose
            .cli_install_commands_windows
            .iter()
            .any(|command| command.contains("raw.githubusercontent.com/aaif-goose/goose/main")));
        assert!(goose
            .cli_install_commands_windows
            .iter()
            .any(|command| command.contains("$env:CONFIGURE='false'")));

        let claude = known_acp_runtime_exact("claude").unwrap();
        assert_eq!(
            claude.cli_install_instructions_url,
            "https://code.claude.com/docs/en/getting-started"
        );
        assert!(claude
            .adapter_install_instructions_url
            .contains("claude-agent-acp"));
        assert!(claude.cli_install_hint.contains("Claude Code CLI"));

        let codex = known_acp_runtime_exact("codex").unwrap();
        assert_eq!(
            codex.cli_install_instructions_url,
            "https://developers.openai.com/codex/cli/"
        );
        assert!(codex.adapter_install_instructions_url.contains("codex-acp"));
        assert!(codex.cli_install_hint.contains("Codex CLI"));
    }
}
