//! The hook endpoint: a Claude Code the owner launched himself becomes visible
//! (vingilot/docs/plans/2026-08-12-hooks-and-the-dots.md, Task 1; VelaTerm's
//! `agent/inject.rs`, read as source in
//! vingilot/docs/research/2026-08-12-velaterm-notes.md §1).
//!
//! The signals plan's oldest open finding is that **no per-session terminal
//! liveness exists**: an agent working in a worktree terminal is invisible to
//! the attention dots, and the row says "quiet" while it is mid-refactor or
//! stopped at a permission prompt the owner cannot see. Claude Code's hooks
//! already carry everything needed to fix that — every payload has a
//! `session_id` and a `cwd`, and a `cwd` maps onto the sidebar's own key.
//!
//! This module is the ear. Three files sit under it and each owns one
//! decision: [`event`] holds the event vocabulary and the race rule,
//! [`binding`] holds cwd → binding id, [`state`] holds what is live and what
//! has decayed. This file holds the socket, the token and the one command the
//! frontend reads.
//!
//! # What it binds, and what was reused
//!
//! **An axum router on an ephemeral `127.0.0.1` port**, served on the app's
//! own tokio runtime — the same machinery `media_proxy.rs` already brings up
//! for the media stream, down to `TcpListener::bind("127.0.0.1:0")` and a
//! `tokio::spawn`ed `axum::serve`. It fits without adjustment: this endpoint
//! needs exactly what that one needs (a loopback listener, a router, an
//! OS-assigned port) and nothing it does not, so no dependency is added and
//! there is one HTTP server pattern in this app rather than two.
//!
//! `vingilot_shim`'s header rejected a loopback listener for *its* job, and
//! that reasoning is not contradicted here — it is the reason this one is
//! shaped the way it is. What it rejected was the cost of **discovery**: a
//! shim run from an arbitrary terminal would need a port file under
//! `~/.vingilot` with its own staleness problem, and a token to go with it.
//! A hook has neither problem, because the URL is *handed to the agent at
//! launch* by the app that owns the port. Nothing has to find anything.
//!
//! # Why the URL carries everything
//!
//! `POST /hook/<scope>?t=<token>&e=<event>` is VelaTerm's pattern, kept: the
//! token and the event are in the URL, so the token can be checked before a
//! byte of the body is parsed and a request that has no business here costs
//! one string compare. `<scope>` is the binding id of the terminal the agent
//! was launched in — a *hint*, used only when the body's `cwd` names no
//! checkout ([`binding::attribute`] argues that order).
//!
//! # The trust boundary, stated
//!
//! - **Loopback only, by construction.** The listener binds `127.0.0.1`, which
//!   the kernel will not route off the machine. Nothing in this module opens
//!   an outbound connection, and there is no code path from a hook body to a
//!   socket, a file or a log line.
//! - **One token per app run**, 32 bytes of OS entropy. It is never logged and
//!   never passed as a command-line argument — process arguments are
//!   world-readable on this machine (`ps -ax -o args=` prints another user's
//!   `systemstats --daemon` today), which is exactly the machine the threat is
//!   on. It reaches an agent in an **environment variable**,
//!   `VINGILOT_HOOK_ENDPOINT`, which the pty spawn sets and which holds the
//!   whole URL ([`endpoint_url`]); the `claude` wrapper that reads it writes
//!   the settings JSON under `~/.vingilot/run` at mode 0600 rather than
//!   passing it as an argument, so the only two places this token ever exists
//!   are an environment and a file only the owner can read. It lives and dies
//!   with the app run.
//! - **A wrong token is a 403 and nothing else**: no state change, no entry
//!   created, no clock touched. A local port is reachable by every process on
//!   the machine, so this is the whole of the defence and it is tested as
//!   such.
//! - **The body is read for five fields and no more.** The payload also
//!   carries the owner's prompt, a transcript path and the full input and
//!   output of every tool; [`event::HookBody`] names what is kept and serde
//!   drops the rest, so none of it is ever held in this app's memory.

mod binding;
mod event;
mod state;

use std::sync::{Arc, OnceLock};

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use serde::Deserialize;
use tokio::net::TcpListener;

use binding::{attribute, plausible_binding_id, worktree_root_of};
use event::parse_event;
pub use state::HookLiveness;
use state::{Moment, Sessions};

/// The store, behind this module's own API rather than in Tauri's managed
/// state.
///
/// It is a singleton because there is exactly one of it — one app run, one
/// port, one token, one set of live sessions — and because reaching it from
/// both the server task and a Tauri command through `.manage()` would cost
/// `lib.rs` a line to say something this module already knows. The global data
/// rule is met the way `vingilot_shim` and `vingilot_pty/tmux.rs` meet it: the
/// static is private, and everything outside goes through [`start`] and
/// [`hook_liveness`].
static SESSIONS: OnceLock<Arc<Sessions>> = OnceLock::new();

fn sessions() -> &'static Arc<Sessions> {
    SESSIONS.get_or_init(|| Arc::new(Sessions::default()))
}

/// Where this app run's endpoint is, and the word that opens it. Set once by
/// [`start`] and read only by [`endpoint_url`] — the token is never handed out
/// on its own, so there is no accessor that could put it in a log line.
static ADDRESS: OnceLock<(u16, String)> = OnceLock::new();

/// The URL a `claude` launched in one of our terminals posts its hooks to, or
/// `None` when the endpoint did not come up (no entropy, no loopback) — in
/// which case the terminal opens exactly as it did yesterday and its agents are
/// invisible, which is the honest outcome and not an error the owner is
/// interrupted with.
///
/// `scope` is the terminal's own binding id, and it goes in the **path** rather
/// than the query for [`binding::attribute`]'s reason: it is a hint the cwd
/// outranks. A scope that is not one of the two shapes this app mints is
/// dropped here rather than sent — the unscoped route exists for exactly that,
/// and a hint the endpoint would refuse anyway is noise in a URL.
pub(crate) fn endpoint_url(scope: &str) -> Option<String> {
    let (port, token) = ADDRESS.get()?;
    Some(hook_url(*port, token, scope))
}

/// The URL's shape, pure so a test can read it without a socket.
fn hook_url(port: u16, token: &str, scope: &str) -> String {
    if plausible_binding_id(scope) {
        format!("http://127.0.0.1:{port}/hook/{scope}?t={token}")
    } else {
        format!("http://127.0.0.1:{port}/hook?t={token}")
    }
}

/// What the router needs: the store to write into, and the token to check.
#[derive(Clone)]
struct Endpoint {
    sessions: Arc<Sessions>,
    token: Arc<String>,
}

#[derive(Deserialize)]
struct HookQuery {
    /// The per-run token.
    t: Option<String>,
    /// The event label. Optional so a hand-written hook that posts the body
    /// alone still works — `hook_event_name` is in it either way.
    e: Option<String>,
}

/// Bring the endpoint up. Answers the port, which is the only half of the
/// address that may be spoken aloud.
///
/// Fails closed: if the OS will not give us entropy there is no token, and
/// without a token this would be an unauthenticated local RPC that writes into
/// the app's state. No endpoint at all is the correct outcome — the dots go
/// back to saying nothing about terminals, which is what they said yesterday.
pub(crate) async fn start() -> Result<u16, String> {
    let token = mint_token()?;
    let endpoint = Endpoint {
        sessions: Arc::clone(sessions()),
        token: Arc::new(token),
    };

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("the hook endpoint could not bind loopback: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("the hook endpoint has no address: {error}"))?
        .port();

    // Remembered before the server task is spawned, so a terminal opened in the
    // same millisecond finds an address rather than a hole. `set` refusing means
    // `start` ran twice, which the app never does; the first address is the live
    // one either way.
    let _ = ADDRESS.set((port, endpoint.token.as_ref().clone()));
    tokio::spawn(async move {
        axum::serve(listener, router(endpoint)).await.ok();
    });
    Ok(port)
}

/// Bring the endpoint up and say so, or say why not. The port is logged and
/// the token is not — a log file is a file, and this one would be a key.
pub(crate) async fn start_and_report() {
    match start().await {
        Ok(port) => eprintln!("vingilot: hook endpoint listening on 127.0.0.1:{port}"),
        Err(error) => eprintln!("vingilot: {error}"),
    }
}

fn router(endpoint: Endpoint) -> Router {
    Router::new()
        .route("/hook/{scope}", post(handle))
        // A scope is what our own terminals carry; a hand-installed hook may
        // have nothing to put there, and losing those sessions to a 404 would
        // mean losing exactly the ones the unattributed bucket exists for.
        .route("/hook", post(handle_unscoped))
        .with_state(endpoint)
}

async fn handle_unscoped(state: State<Endpoint>, query: Query<HookQuery>, body: Bytes) -> Response {
    handle(state, Path(String::new()), query, body).await
}

async fn handle(
    State(endpoint): State<Endpoint>,
    Path(scope): Path<String>,
    Query(query): Query<HookQuery>,
    body: Bytes,
) -> Response {
    // First, and before the body is looked at: a request that cannot prove it
    // is ours must not reach the parser, let alone the store.
    if !token_matches(&endpoint.token, query.t.as_deref().unwrap_or("")) {
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }

    let payload = serde_json::from_slice::<event::HookBody>(&body).unwrap_or_default();
    let Some(event) = parse_event(query.e.as_deref(), &payload) else {
        // An event this build does not map. The sender did nothing wrong, and
        // a non-2xx would put a hook error in the owner's terminal for a state
        // this app simply has no opinion about.
        return (StatusCode::OK, "ignored").into_response();
    };
    let Some(session_id) = payload.session_id.as_deref().filter(|id| !id.is_empty()) else {
        // Without a session id there is nothing to key state by, and inventing
        // one per request would make every hook its own immortal session.
        return (StatusCode::BAD_REQUEST, "no session_id").into_response();
    };

    let attribution = attribute(
        payload.cwd.as_deref(),
        Some(scope.as_str()),
        &worktree_root_of,
    );
    endpoint.sessions.apply(
        session_id,
        &attribution,
        event,
        payload.tool_name.as_deref(),
        Moment::now(),
    );
    (StatusCode::OK, "ok").into_response()
}

/// 32 bytes of OS entropy, hex. Long enough that guessing it is not a strategy
/// even for a process that can try the port a million times a second.
fn mint_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|error| format!("no OS entropy for the hook token: {error}"))?;
    Ok(hex::encode(bytes))
}

/// Compare in constant time.
///
/// The comparison runs against a process on the owner's own machine, which can
/// time it as precisely as it likes; `==` on a `String` stops at the first
/// differing byte and would hand a patient caller the token one byte at a
/// time. This costs a loop over 64 bytes per request.
fn token_matches(expected: &str, given: &str) -> bool {
    let (expected, given) = (expected.as_bytes(), given.as_bytes());
    let mut difference = expected.len() ^ given.len();
    for (index, byte) in expected.iter().enumerate() {
        difference |= usize::from(byte ^ given.get(index).copied().unwrap_or(0));
    }
    difference == 0
}

/// What every worktree's live agents are doing.
///
/// **A polled command rather than an event push, to match how the frontend
/// already reads this kind of thing.** `useWorktreeSignals` gathers run status
/// on the coordinator's 2s tick and git's numstat on its own 5s one
/// (`useWorktreeStats.ts`), keyed by binding id, and treats a missing entry as
/// "nothing is known" rather than as a state. This answer has the same shape
/// and the same reading, so it joins that hook as a third signal without
/// teaching the screen a second way to receive one — and a poll that misses a
/// tick shows a stale sentence, where a dropped push would show a wrong one
/// forever.
///
/// Async so a lock and a map walk never happen on the thread the webview talks
/// on, matching every other command this island registers.
#[tauri::command]
pub async fn hook_liveness() -> HookLiveness {
    sessions().snapshot(Moment::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::vingilot_hooks::binding::local_binding_id;
    use crate::vingilot_hooks::event::Liveness;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    /// A live endpoint on its own loopback port, with its own store — never
    /// the app's singleton, so these tests cannot see each other.
    struct Served {
        port: u16,
        sessions: Arc<Sessions>,
    }

    async fn serve() -> Served {
        let sessions = Arc::new(Sessions::default());
        let endpoint = Endpoint {
            sessions: Arc::clone(&sessions),
            token: Arc::new(TOKEN.to_owned()),
        };
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("loopback is bindable in a test");
        let port = listener
            .local_addr()
            .expect("a bound listener has an address")
            .port();
        tokio::spawn(async move {
            axum::serve(listener, router(endpoint)).await.ok();
        });
        Served { port, sessions }
    }

    async fn post_hook(served: &Served, query: &str, body: serde_json::Value) -> u16 {
        reqwest::Client::new()
            .post(format!(
                "http://127.0.0.1:{}/hook/local:aaaa?{query}",
                served.port
            ))
            .json(&body)
            .send()
            .await
            .expect("the loopback endpoint answers")
            .status()
            .as_u16()
    }

    fn prompt(cwd: &str) -> serde_json::Value {
        serde_json::json!({
            "session_id": "s1",
            "cwd": cwd,
            "hook_event_name": "UserPromptSubmit",
            "prompt": "a secret the store must never keep",
        })
    }

    #[tokio::test]
    async fn a_wrong_token_is_a_403_and_changes_nothing() {
        let served = serve().await;
        for query in [
            String::new(),
            "t=".to_owned(),
            "t=wrong".to_owned(),
            // One byte short, and one byte over: the two neighbours a
            // length-only check would let through.
            format!("t={}", &TOKEN[..TOKEN.len() - 1]),
            format!("t={TOKEN}0"),
        ] {
            assert_eq!(
                post_hook(&served, &format!("{query}&e=prompt-submit"), prompt("/")).await,
                403,
                "{query} must be refused"
            );
            assert_eq!(
                served.sessions.len(),
                0,
                "{query}: a refused request must leave no state behind"
            );
        }

        // And the same request with the real token lands, which is what makes
        // the refusals above mean something.
        assert_eq!(
            post_hook(&served, &format!("t={TOKEN}&e=prompt-submit"), prompt("/")).await,
            200
        );
        assert_eq!(served.sessions.len(), 1);
    }

    #[tokio::test]
    async fn a_hook_from_a_directory_under_no_checkout_lands_on_the_terminals_hint() {
        // `/` is on every machine and is not a checkout, so the cwd maps to
        // nothing and the scope in the URL is all there is.
        let served = serve().await;
        assert_eq!(
            post_hook(&served, &format!("t={TOKEN}&e=prompt-submit"), prompt("/")).await,
            200
        );
        let answer = served.sessions.snapshot(Moment::now());
        assert_eq!(
            answer.by_binding.keys().collect::<Vec<_>>(),
            vec!["local:aaaa"],
            "the URL's scope is the only name this session has"
        );
        assert_eq!(answer.unattributed, None);
    }

    #[tokio::test]
    async fn a_hook_from_a_real_checkout_is_filed_under_that_checkout() {
        let served = serve().await;
        let repo = tempfile::TempDir::new().expect("a temp dir");
        std::fs::create_dir(repo.path().join(".git")).expect("a .git to find");
        let inside = repo.path().join("src");
        std::fs::create_dir(&inside).expect("a directory below the root");

        assert_eq!(
            post_hook(
                &served,
                &format!("t={TOKEN}&e=pre-tool"),
                serde_json::json!({
                    "session_id": "s1",
                    "cwd": inside.to_string_lossy(),
                    "tool_name": "Bash",
                }),
            )
            .await,
            200
        );

        // Canonicalised, because that is the spelling git prints and therefore
        // the spelling the sidebar's own id is built from.
        let root = std::fs::canonicalize(repo.path()).expect("the root canonicalises");
        let expected = local_binding_id(&root.to_string_lossy());
        let answer = served.sessions.snapshot(Moment::now());
        let agent = &answer.by_binding[&expected];
        assert_eq!(agent.state, Liveness::Working);
        assert_eq!(agent.sentence, "working — Bash");
        assert_eq!(agent.path.as_deref(), Some(root.to_string_lossy().as_ref()));
    }

    #[tokio::test]
    async fn a_body_with_no_session_id_is_refused_and_an_unmapped_event_is_not() {
        let served = serve().await;
        assert_eq!(
            post_hook(
                &served,
                &format!("t={TOKEN}&e=prompt-submit"),
                serde_json::json!({ "cwd": "/" }),
            )
            .await,
            400
        );
        assert_eq!(
            post_hook(
                &served,
                &format!("t={TOKEN}&e=SubagentStop"),
                serde_json::json!({ "session_id": "s1", "cwd": "/" }),
            )
            .await,
            200,
            "an event this build has no opinion about is not the sender's error"
        );
        assert_eq!(served.sessions.len(), 0);
    }

    #[test]
    fn the_token_comparison_does_not_stop_at_the_first_difference() {
        assert!(token_matches(TOKEN, TOKEN));
        assert!(!token_matches(TOKEN, ""));
        assert!(!token_matches(TOKEN, &TOKEN[..1]));
        assert!(!token_matches(TOKEN, &format!("{TOKEN}x")));
        assert!(!token_matches(TOKEN, &TOKEN.replace('f', "e")));
    }

    #[test]
    fn a_minted_token_is_thirty_two_bytes_of_hex_and_never_the_same_twice() {
        let first = mint_token().expect("this machine has entropy");
        let second = mint_token().expect("this machine has entropy");
        assert_eq!(first.len(), 64);
        assert!(first.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn the_url_handed_to_a_terminal_carries_the_scope_and_the_token_and_nothing_else() {
        // The whole of what Task 2 needs, and the shape the handler above
        // parses: a loopback address, the binding id as the path's scope, the
        // token as `t`. The wrapper appends `&e=<event>`, so the query must
        // already be open — a URL ending in the path would make that `?e=` and
        // lose the token.
        let url = hook_url(51234, TOKEN, "local:2f772f61");
        assert_eq!(
            url,
            format!("http://127.0.0.1:51234/hook/local:2f772f61?t={TOKEN}")
        );
        assert!(url.starts_with("http://127.0.0.1:"), "loopback only: {url}");
    }

    #[test]
    fn a_terminal_with_no_binding_id_gets_the_unscoped_route_rather_than_a_junk_scope() {
        // A scratch shell's session id is not a binding id (`scratchTerminal.ts`),
        // and `attribute` would refuse it anyway. Sending it would put a string
        // this app cannot key on into a URL for no reason.
        for scope in ["", "scratch-1", "local:", "main:", "../etc"] {
            assert_eq!(
                hook_url(51234, TOKEN, scope),
                format!("http://127.0.0.1:51234/hook?t={TOKEN}"),
                "{scope} is not a binding id"
            );
        }
    }

    #[test]
    fn there_is_no_url_before_the_endpoint_is_up() {
        // `ADDRESS` is only ever set by `start`, which no unit test runs — so
        // this also proves the honest answer for a machine where the listener
        // refused to bind: no URL, no injection, and a terminal that opens
        // exactly as it did yesterday.
        assert_eq!(endpoint_url("local:2f772f61"), None);
    }

    #[test]
    fn the_command_does_not_run_on_the_thread_the_webview_talks_on() {
        fn accepts_only_a_future<F: std::future::Future>(_: F) {}
        accepts_only_a_future(hook_liveness());
    }
}
