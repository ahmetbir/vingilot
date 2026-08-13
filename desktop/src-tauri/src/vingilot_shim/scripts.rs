//! The bytes this app ships into its own `bin`, and nothing about installing
//! them.
//!
//! Two shell scripts, each a string constant, and each with an argument in its
//! doc comment that is longer than the script. That is the right ratio: a
//! constant with a typo in it compiles, installs, and fails on the owner's
//! machine at the moment he first trusts it — so the reasoning has to live
//! beside the bytes, and the bytes have to be *executed* by a test
//! (`recorder_tests.rs`, `claude_recorder_tests.rs`) rather than inspected.
//!
//! They are in their own file because `mod.rs` is about a different subject —
//! where the shims are installed, how they are linked, and what
//! `vingilot <arg>` resolves to — and because that file reached the
//! repository's 1000-line ratchet when the second script landed. The house
//! rule is split, never raise; this is the split, and the seam it follows is
//! the one that was already there.

/// The command's name.
///
/// **Not `vin`.** VelaTerm's note is right that a shim must not shadow a real
/// command, and `vin` is three letters away from `vim` in a way that will cost
/// somebody a confusing minute at 2am. `vingilot` is unambiguous, it is what
/// the owner would guess, and it is what the palette row says it installs.
pub(crate) const SHIM_NAME: &str = "vingilot";

/// The shim itself.
///
/// **Five working lines, and the fifth is the only one that does anything** —
/// VelaTerm's `#!/bin/sh` one-liner with the encoding it needs to be correct.
///
/// **Every byte is percent-encoded, through `od`.** A path is bytes, not
/// characters: a hand-written `case` loop over `${s#?}` gets the codepoint in
/// bash and the first byte in dash, so a Turkish filename encodes differently
/// depending on which `/bin/sh` this is. `od -An -tx1 -v` is a byte dump, and
/// over-encoding an unreserved byte is legal in a query value — so `%73%72%63`
/// is `src` to every URL parser and the ampersand, the space and the `#` that
/// would otherwise end the query are simply never characters.
///
/// **`VINGILOT_OPEN` is a test seam, said out loud.** The recorder test runs
/// this exact script with that variable pointing at a script that writes its
/// argv to a file — which is the only way to exercise the shim without opening
/// a window on the owner's machine. Its default is the absolute
/// `/usr/bin/open`, so the shim does not depend on the PATH it is found on.
pub(crate) const SHIM_SCRIPT: &str = r#"#!/bin/sh
# vingilot — show a file, or this directory, in the running Vingilot workspace.
#
#   vingilot                    this directory
#   vingilot .                  the same
#   vingilot src/main.rs        that file, in the Files viewer
#   vingilot src/main.rs:412    that file, at line 412
#
# Installed by Vingilot into ~/.vingilot/bin, which the app's own terminals get
# on their PATH. Nothing outside that directory is written unless you ask for
# it: the app's palette has "Install vingilot command…" for /usr/local/bin.
#
# Every byte of the argument is percent-encoded through od(1): a path is bytes,
# and a per-character encoder disagrees with itself across shells.
set -u
enc() { printf '%s' "$1" | od -An -tx1 -v | tr -d ' \n' | sed 's/../%&/g'; }
exec "${VINGILOT_OPEN:-/usr/bin/open}" "buzz://open?arg=$(enc "${1:-.}")&cwd=$(enc "$PWD")"
"#;

/// The second shim's name. It **does** shadow a real command — that is the
/// whole mechanism — which is why every line of [`CLAUDE_SHIM_SCRIPT`] is about
/// getting out of the way again.
pub(crate) const CLAUDE_SHIM_NAME: &str = "claude";

/// Where the wrapper posts: the loopback URL `vingilot_hooks::endpoint_url`
/// built for this session, token and binding scope included.
///
/// **This name is written down three times and only defined once.**
/// `vingilot_pty::terminal_env` sets it, [`CLAUDE_SHIM_SCRIPT`] reads it, and
/// the recorder tests stage it — and the third copy is unavoidable, because a
/// shell script is text and cannot import a Rust constant. So the two Rust
/// copies are this constant, and the shell one is joined to it by
/// [`the_wrapper_reads_exactly_the_two_variables_the_pty_writes`], which asserts
/// the script's own `${…:-}` spelling. Without that join a rename on either
/// side leaves every test in this island green while no `claude` in any
/// Vingilot terminal ever posts a hook again — silence is this feature's
/// success case *and* its total failure, which is why it needs an assertion
/// rather than a look.
pub(crate) const HOOK_ENDPOINT_VAR: &str = "VINGILOT_HOOK_ENDPOINT";

/// Where the wrapper writes the settings JSON it builds from
/// [`HOOK_ENDPOINT_VAR`]. Same three-copy problem, same join.
pub(crate) const CLAUDE_SETTINGS_VAR: &str = "VINGILOT_CLAUDE_SETTINGS";

/// The `claude` wrapper: ring 1 of the hook injection
/// (vingilot/docs/plans/2026-08-12-hooks-and-the-dots.md, Task 2).
///
/// # What it is for
///
/// The owner types `claude` himself, so there is no launch flag this app can
/// add — but it owns the PATH of the terminals it opens ([`prepend_path`]), and
/// a file called `claude` in that directory is found first. This one hands the
/// session a `--settings` file whose hooks POST to the loopback endpoint
/// (`vingilot_hooks`), which is what lets a worktree row say "an agent here is
/// waiting for approval: Bash" instead of "quiet".
///
/// # Every line of it is about being harmless
///
/// This wrapper stands between the owner and the tool he lives in, which the
/// plan's self-review names as the riskiest thing in it. So:
///
/// - **Arguments are never interpreted, only scanned.** `"$@"` is forwarded
///   verbatim in the order it was typed, on every path out of the script.
///   `claude --version`, `claude -p …`, `claude mcp add …` behave exactly as
///   they did.
/// - **`--settings` from the owner wins, and the wrapper adds nothing.** A
///   settings file he named is a decision; this one is a convenience, and a
///   convenience does not get to be second in a list with last-wins semantics
///   nobody wants to reason about at 2am.
/// - **No endpoint, no wrapper.** Outside our terminals `VINGILOT_HOOK_ENDPOINT`
///   is unset and this is a two-line passthrough.
/// - **Nothing is written to `~/.claude`**, and the one file it does write is
///   under `~/.vingilot/run` at mode 0600 — it carries the app run's hook
///   token, and the *path* to it is what goes in the command line, never the
///   token itself (`vingilot_hooks`'s trust boundary: process arguments are
///   world-readable on this machine and an environment is not).
/// - **Every failure falls through to the real binary.** A directory that will
///   not take the file, a `HOME` that is not there: `exec "$real" "$@"`, and the
///   dots stay quiet. The wrapper has no way to end in an error the owner has
///   to read.
/// - **A missing real `claude` is the shell's own answer**, word for word and
///   exit 127, so `command -v`-shaped scripts and `|| brew install` fallbacks
///   still work.
///
/// # Which events, and why `asking` is not on `Notification`
///
/// Claude Code does not accept an `http` handler on every event. `PreToolUse`,
/// `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Stop`,
/// `SubagentStop`, `TaskCompleted` and `UserPromptSubmit` take all four handler
/// types; **`Notification`, `PreCompact`, `SessionStart`, `SessionEnd`,
/// `ConfigChange` and `Setup` take `command` handlers only.** That matters more
/// here than anywhere else, because `asking` — the one state this whole feature
/// exists for — is the state a `Notification` of `permission_prompt` would have
/// carried. An `http` entry there is not a degraded hook, it is a dead one: at
/// best nothing ever posts, at worst the settings file is rejected and the
/// wrapper misbehaves in every terminal the app opens.
///
/// So the ask arrives on **`PermissionRequest`**, which takes `http`, matches on
/// `tool_name`, and fires exactly when the dialog would be shown. Two documented
/// limits, stated rather than discovered:
///
/// - **`PermissionRequest` does not fire under `claude -p` / `--print`.** A
///   non-interactive run has nobody to ask, so it has no `asking` state to
///   report and the dots stay on `working`/`waiting` — correct, and worth
///   knowing before somebody reads a `-p` session's silence as a bug.
/// - **`Notification` is not registered at all.** The only liveness it carried
///   beyond the ask was `idle_prompt`, which says `waiting` — where `Stop`
///   already lands. Registering it as a `command` handler to keep it would mean
///   a `curl` with the endpoint in its argv, and this app run's hook token is in
///   that URL: process arguments are world-readable on this machine
///   (`vingilot_hooks`'s trust boundary). One free `waiting` is not worth
///   handing the token to every process on the machine.
///
/// `vingilot_hooks::parse_event` still reads `Notification` bodies, because ring
/// 2 — a hook the owner installed himself — may legitimately send one.
///
/// # Finding the real one
///
/// The next `claude` on `PATH` after **this file's own directory**, skipping
/// three ways of being ourselves: the same literal path, the same resolved
/// directory, and — the one that catches a copy or a symlink somebody made into
/// `/usr/local/bin` — any candidate whose second line carries the marker
/// comment below. Without that third check a link to this script is an `exec`
/// loop with no bottom.
///
/// **The whole search is shell builtins**: `${0%/*}`, `cd`/`pwd`, `read`, `[`
/// and `case`, and not one `dirname`, `head` or `grep`. That is not
/// minimalism — a PATH without `/usr/bin` on it is exactly the arrangement in
/// which those commands are missing, the marker check silently answers "not me"
/// for every candidate, and the wrapper `exec`s *itself* forever. The guard
/// against an infinite loop cannot be the thing that needs the PATH to be
/// well-formed.
///
/// `VINGILOT_CLAUDE_SETTINGS` (where to write) and `VINGILOT_HOOK_ENDPOINT`
/// (what to write) both come from the pty spawn, so this script holds no
/// address, no token and no path of its own.
pub(crate) const CLAUDE_SHIM_SCRIPT: &str = r#"#!/bin/sh
# vingilot-claude-wrapper — the real claude, plus hooks that tell Vingilot what
# this session is doing. Installed into ~/.vingilot/bin, which is on the PATH of
# terminals the app opens and nowhere else.
#
#   * every flag you type is passed through untouched, in order;
#   * if YOU pass --settings, this wrapper defers entirely — yours wins and
#     nothing is added;
#   * outside a Vingilot terminal it is a passthrough and does nothing;
#   * nothing is ever written to ~/.claude. The one file written is the settings
#     JSON named by VINGILOT_CLAUDE_SETTINGS, mode 0600, under ~/.vingilot/run;
#   * the hooks it registers are http hooks, so only on events that accept one:
#     Notification takes command handlers only, and the permission prompt is
#     read from PermissionRequest instead (which does not fire under -p);
#   * anything that goes wrong runs the real claude anyway.
set -u

# Where this file is. Builtins only — see below.
case $0 in
*/*) self=$(CDPATH= cd -- "${0%/*}" 2>/dev/null && pwd) || self=${0%/*} ;;
*) self= ;;
esac

# The real claude: the next one on PATH that is not this script. Three checks,
# all of them shell builtins, because a PATH with no /usr/bin on it is exactly
# where an external `grep` would be missing and this search would find ITSELF
# and exec forever.
real=$(
  IFS=:
  for dir in $PATH; do
    [ -n "$dir" ] && [ -x "$dir/claude" ] || continue
    [ "$dir/claude" = "$0" ] && continue
    here=$(CDPATH= cd -- "$dir" 2>/dev/null && pwd) || here=$dir
    [ "$here" = "$self" ] && continue
    if [ -r "$dir/claude" ]; then
      line1= line2=
      { read -r line1; read -r line2; } <"$dir/claude" 2>/dev/null
      # The leading ( is required, not style: this case is inside $( ), and
      # bash 3.2 — the /bin/sh this ships against — reads the pattern's
      # unbalanced ) as the end of the substitution.
      case $line2 in (*vingilot-claude-wrapper*) continue ;; esac
    fi
    printf '%s' "$dir/claude"
    break
  done
)
if [ -z "$real" ]; then
  echo "claude: command not found" >&2
  exit 127
fi

# His own --settings is a decision; ours is a convenience. Defer entirely.
for arg in "$@"; do
  case $arg in
  --settings | --settings=*) exec "$real" "$@" ;;
  esac
done

settings=${VINGILOT_CLAUDE_SETTINGS:-}
endpoint=${VINGILOT_HOOK_ENDPOINT:-}
[ -n "$settings" ] && [ -n "$endpoint" ] || exec "$real" "$@"
hook() { printf '{"type":"http","url":"%s&e=%s","timeout":5}' "$endpoint" "$1"; }
(umask 077 && mkdir -p "${settings%/*}") 2>/dev/null || exec "$real" "$@"
umask 077
{
  printf '{"hooks":{'
  printf '"UserPromptSubmit":[{"hooks":[%s]}],' "$(hook prompt-submit)"
  printf '"PreToolUse":[{"matcher":"*","hooks":[%s]}],' "$(hook pre-tool)"
  printf '"PostToolUse":[{"matcher":"*","hooks":[%s]}],' "$(hook post-tool)"
  # The ask. NOT Notification: that event takes command handlers only, so an
  # http hook on it never fires — see this script's Rust doc comment.
  printf '"PermissionRequest":[{"matcher":"*","hooks":[%s]}],' "$(hook permission-request)"
  printf '"Stop":[{"hooks":[%s]}]' "$(hook stop)"
  printf '}}\n'
} >"$settings" || exec "$real" "$@"
exec "$real" --settings "$settings" "$@"
"#;

/// `rwxr-xr-x`. Executable, and writable by nobody but the owner — this file is
/// on the PATH of every shell the app opens.
pub(crate) const SHIM_MODE: u32 = 0o755;

/// Everything this app puts in its own `bin`, as one list so that installing,
/// upgrading and testing all walk the same set.
pub(crate) const SHIMS: [(&str, &str); 2] = [
    (SHIM_NAME, SHIM_SCRIPT),
    (CLAUDE_SHIM_NAME, CLAUDE_SHIM_SCRIPT),
];

#[cfg(test)]
mod tests {
    use super::*;

    /// The wrapper skips any candidate whose FIRST TWO LINES carry this marker,
    /// which is what stops a copy or a symlink of it into another directory on
    /// the PATH becoming an exec loop. The marker is a comment on line 2 and the
    /// `case` that reads it is far below — a build that moved either would pass
    /// every other test in this island and hang the owner's shell.
    #[test]
    fn the_wrappers_marker_is_where_its_own_self_check_reads_it() {
        let head: Vec<&str> = CLAUDE_SHIM_SCRIPT.lines().take(2).collect();
        assert_eq!(head[0], "#!/bin/sh");
        assert!(
            head[1].contains("vingilot-claude-wrapper"),
            "line 2 is what the self-check reads: {:?}",
            head[1]
        );
        let check = CLAUDE_SHIM_SCRIPT
            .lines()
            .position(|line| line.contains("*vingilot-claude-wrapper*"))
            .expect("the self-check is in the script");
        assert!(check > 1, "the check must not read itself");
    }

    /// The third copy of the two names, joined to the one definition.
    ///
    /// `terminal_env` writes them and this script reads them, and a shell
    /// script cannot import a constant — so the only thing that can keep the
    /// two sides spelling one name is an assertion over the shipped text.
    /// Without it, renaming the variable on either side alone leaves this whole
    /// island green while ring 1 is dead: the wrapper reads an unset variable,
    /// takes its passthrough branch, and every terminal goes quiet in exactly
    /// the way a terminal with no agent in it does.
    #[test]
    fn the_wrapper_reads_exactly_the_two_variables_the_pty_writes() {
        for name in [HOOK_ENDPOINT_VAR, CLAUDE_SETTINGS_VAR] {
            assert!(
                CLAUDE_SHIM_SCRIPT.contains(&format!("${{{name}:-}}")),
                "the wrapper does not read ${name}, so `terminal_env` setting it says nothing"
            );
        }
    }

    /// The cheapest test in this island and the one that would have saved the
    /// most time: `case … in *pat*)` inside a `$( )` is a syntax error in bash
    /// 3.2, the `/bin/sh` these ship against, and the way that failure presented
    /// was the wrapper exiting 2 on every invocation — which in the terminal
    /// reads as "claude is broken", not as "this script has a typo". `sh -n`
    /// parses without running a line of it.
    #[test]
    fn every_shipped_script_parses_in_the_shell_that_will_run_it() {
        for (name, script) in SHIMS {
            let dir = match tempfile::TempDir::new() {
                Ok(dir) => dir,
                Err(error) => panic!("could not create a temp dir: {error}"),
            };
            let path = dir.path().join(name);
            std::fs::write(&path, script).expect("the script is written");
            let checked = std::process::Command::new("/bin/sh")
                .arg("-n")
                .arg(&path)
                .output()
                .expect("/bin/sh runs");
            assert!(
                checked.status.success(),
                "{name} does not parse: {}",
                String::from_utf8_lossy(&checked.stderr)
            );
        }
    }
}
