//! The send broker: an agent sends a message as itself without ever holding
//! the key.
//!
//! # Why this exists
//!
//! An agent replies by shelling out to `buzz messages send`, and the CLI reads
//! its key from `BUZZ_PRIVATE_KEY`. That works only for harnesses whose shell
//! tool hands its environment to child processes. Several — Hermes and Kimi
//! among them — run tool commands in a sanitised environment: with the agent
//! running, its own shell reported `BUZZ_PRIVATE_KEY`, `BUZZ_RELAY_URL` and
//! `BUZZ_AUTH_TAG` all empty. Nothing set outside such a harness survives it,
//! so every reply died with `auth_error` (exit 3) and the agent read that as
//! *I have no credentials* rather than *I used the wrong shell*.
//!
//! The broker stops requiring the secret to survive the agent's shell. The
//! harness already holds the key and is already talking to the relay, so the
//! agent asks the harness to send for it over a local socket. **The key never
//! leaves this process.** An agent's shell may strip whatever it likes;
//! nothing secret has to get through.
//!
//! # What it does, and the much longer list of what it does not
//!
//! It exists so an agent can send a message as itself, and nothing more. One
//! op, [`OP_SEND_MESSAGE`], which builds a kind-9 channel message, signs it
//! with the harness's keys, and submits it. Its only output is the id of the
//! message it just sent.
//!
//! It does not hand out the key. It does not sign caller-supplied bytes or
//! caller-supplied events. It does not proxy the relay — it has no read
//! surface an agent can aim anywhere. Those refusals are answered by name in
//! [`refusal`] rather than falling through to "unknown op", because a broker
//! that quietly ignores what it will not do teaches nobody where the line is.
//!
//! This narrowness is the entire reason the broker was chosen over a key file
//! under `~/.buzz` that the agent could read. A general broker — "sign this",
//! "publish that" — is a key-equivalent with extra steps, and would throw that
//! reason away.
//!
//! # What protects it
//!
//! A unix domain socket, never a TCP port: a localhost port is reachable by
//! every process on the machine, while a socket file is subject to filesystem
//! permissions. The socket is mode 0600 inside a directory created mode 0700,
//! so only the owner can traverse to it.
//!
//! **The socket path is not a secret and must not be treated as one.** It is
//! passed to the agent in [`BROKER_SOCKET_ENV`], where any process that can
//! read the agent's environment can see it. Its protection is the filesystem
//! permissions above, so nothing may relax them for convenience — not the
//! directory mode, not the socket mode.
//!
//! That is an honest boundary, not a perfect one: any process running as the
//! owner can send messages as this agent while the harness runs. What it
//! cannot do is take the identity with it. The key stays in this process's
//! memory, so there is nothing to copy off the machine, put on a command line,
//! or leave behind in a transcript.
//!
//! # Stale sockets
//!
//! The socket lives in a directory whose name is unique to this harness
//! process, so a socket left behind by a crashed harness can never collide
//! with a new one's bind — the new harness picks a fresh directory and
//! [`Broker::bind`] refuses to adopt a directory it did not create. A stale
//! socket file is inert: nothing is listening, so `connect()` fails
//! immediately with `ECONNREFUSED` rather than hanging, and the CLI reports
//! the broker as unreachable.
//!
//! [`Broker`]'s `Drop` removes exactly the socket and the directory it
//! created — never a recursive delete, never a path it adopted. A harness
//! killed with `SIGKILL` skips `Drop` and leaves both behind; they are dead
//! files in the temp directory, and deleting another process's socket is not
//! something this code may do, because it cannot tell a crashed harness's
//! leftovers from a live sibling's endpoint.

use std::future::Future;
use std::pin::Pin;

use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

/// Environment variable naming the broker socket for the spawned agent.
///
/// Not a secret (see the module docs) — the socket's protection is filesystem
/// permissions, not the obscurity of its path. Defined in lib.rs rather than
/// here because two of its readers must compile on Windows, where this whole
/// module is configured out.
pub use crate::BROKER_SOCKET_ENV;

/// The only op the broker serves.
pub const OP_SEND_MESSAGE: &str = "send_message";

/// Content cap enforced by `buzz_sdk::build_message`, checked here first so an
/// oversized message is refused with a broker error code rather than an SDK
/// string the caller cannot match on.
const MAX_CONTENT_BYTES: usize = 64 * 1024;

/// Longest request line accepted. Sized just above the content cap so a
/// maximal legitimate message fits and a rogue client cannot make the harness
/// buffer without bound.
const MAX_REQUEST_BYTES: usize = 96 * 1024;

/// A request the broker is willing to serve: send this message, as this agent.
///
/// `deny_unknown_fields` is load-bearing. A caller that asks for something the
/// broker does not do — attachments, a different event kind, a signing hint —
/// must be told so, not quietly served a message with the extra field dropped.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SendMessage {
    /// Target channel.
    pub channel: Uuid,
    /// Message text.
    pub content: String,
    /// Event id of the message being replied to, if any. The thread root is
    /// resolved from it by the sink; the caller cannot set the root directly,
    /// because a caller that could set both is choosing where a message lands
    /// rather than replying to something.
    #[serde(default)]
    pub reply_to: Option<String>,
    /// Pubkeys to `p`-tag, as 64-char hex. Names are not resolved here — the
    /// broker does no lookups on the caller's behalf.
    #[serde(default)]
    pub mentions: Vec<String>,
    /// NIP-29 broadcast flag.
    #[serde(default)]
    pub broadcast: bool,
}

/// Why a send did not happen.
#[derive(Debug)]
pub enum SinkError {
    /// The request could not become a message — content too long, reply target
    /// not an event id. The caller's fault, and fixable by the caller.
    Rejected(String),
    /// The message was well-formed but could not be delivered. Not the
    /// caller's fault and not fixable by rewording the request.
    Unavailable(String),
}

impl std::fmt::Display for SinkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Rejected(message) | Self::Unavailable(message) => f.write_str(message),
        }
    }
}

/// Future returned by [`MessageSink::send_message`].
pub type SendFuture<'a> = Pin<Box<dyn Future<Output = Result<String, SinkError>> + Send + 'a>>;

/// What actually sends the message, once the broker has decided it will.
///
/// The protocol half of this module never sees a key: everything that can sign
/// lives behind this trait, so no parsing or refusal path has key material in
/// scope to leak even by accident.
pub trait MessageSink: Send + Sync {
    /// Send `request` as the harness's identity, resolving `Ok` to the hex id
    /// of the published event.
    fn send_message<'a>(&'a self, request: SendMessage) -> SendFuture<'a>;
}

/// Requests the broker will never serve, refused by name.
///
/// These are the shapes a general broker would grow into, and each one would
/// make it a key-equivalent. Answering them explicitly means a caller learns
/// where the boundary is instead of guessing that it mistyped an op name.
///
/// Returns `(error code, message)`.
fn refusal(op: &str) -> Option<(&'static str, &'static str)> {
    match op {
        "get_key" | "export_key" | "private_key" | "secret_key" | "identity" | "keys"
        | "whoami" | "pubkey" => Some((
            "refused_identity_disclosure",
            "the broker discloses no identity material, secret or public: it sends messages as this agent, it does not tell you who this agent is",
        )),
        "sign" | "sign_event" | "sign_bytes" | "publish" | "publish_event" | "submit_event"
        | "event" => Some((
            "refused_arbitrary_signing",
            "the broker never signs caller-supplied bytes or events: the only thing it signs is a channel message it built itself from a send_message request",
        )),
        "query" | "req" | "relay" | "relay_request" | "fetch" | "subscribe" | "get" => Some((
            "refused_relay_proxy",
            "the broker is not a relay proxy: it has no read surface, and its only output is the id of a message it just sent",
        )),
        _ => None,
    }
}

/// A rejected request: a machine-readable code and a sentence for the agent.
type RequestError = (&'static str, String);

/// Parse one request line into the one request shape the broker serves.
///
/// Every rejection carries a code the CLI can branch on. No rejection carries
/// anything the broker knows and the caller does not.
pub fn parse_request(line: &str) -> Result<SendMessage, RequestError> {
    let value: Value = serde_json::from_str(line.trim()).map_err(|e| {
        (
            "bad_request",
            format!("request must be one JSON object: {e}"),
        )
    })?;

    let object = value.as_object().ok_or((
        "bad_request",
        "request must be a JSON object, not an array or a scalar".to_string(),
    ))?;

    let op = object
        .get("op")
        .and_then(Value::as_str)
        .ok_or((
            "bad_request",
            format!("request must name an op; the broker serves only {OP_SEND_MESSAGE:?}"),
        ))?
        .to_string();

    if let Some((code, message)) = refusal(&op) {
        return Err((code, message.to_string()));
    }

    if op != OP_SEND_MESSAGE {
        return Err((
            "unsupported_op",
            format!("unsupported op {op:?}; the broker serves only {OP_SEND_MESSAGE:?}"),
        ));
    }

    let mut fields = object.clone();
    fields.remove("op");
    let request: SendMessage = serde_json::from_value(Value::Object(fields)).map_err(|e| {
        (
            "bad_request",
            format!("invalid {OP_SEND_MESSAGE} request: {e}"),
        )
    })?;

    validate(&request)?;
    Ok(request)
}

/// Reject requests that would only fail deeper in, where the error is an SDK
/// or relay string rather than something the caller can act on.
fn validate(request: &SendMessage) -> Result<(), RequestError> {
    if request.content.trim().is_empty() {
        return Err(("bad_request", "content must not be empty".to_string()));
    }
    if request.content.len() > MAX_CONTENT_BYTES {
        return Err((
            "bad_request",
            format!(
                "content is {} bytes; the limit is {MAX_CONTENT_BYTES}",
                request.content.len()
            ),
        ));
    }
    if let Some(reply_to) = &request.reply_to {
        if !is_event_id(reply_to) {
            return Err((
                "bad_request",
                "reply_to must be a 64-character hex event id".to_string(),
            ));
        }
    }
    for mention in &request.mentions {
        if !is_event_id(mention) {
            return Err((
                "bad_request",
                "every mention must be a 64-character hex pubkey".to_string(),
            ));
        }
    }
    Ok(())
}

/// 64 hex characters — the shape of both an event id and a pubkey.
fn is_event_id(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit())
}

/// The success response: the id of what was sent, and nothing else.
fn ok_response(event_id: &str) -> Value {
    json!({ "ok": true, "event_id": event_id })
}

/// The failure response. `code` is for the CLI, `message` is for the agent.
fn error_response(code: &str, message: &str) -> Value {
    json!({ "ok": false, "error": code, "message": message })
}

/// Handle one request line and produce the response to write back.
///
/// This is the whole protocol: parse, refuse, or send. Responses are built
/// from the event id and fixed strings only — nothing reaches back into the
/// sink for detail, which is what keeps key material out of every path.
pub async fn handle_request(line: &str, sink: &dyn MessageSink) -> Value {
    let request = match parse_request(line) {
        Ok(request) => request,
        Err((code, message)) => return error_response(code, &message),
    };
    match sink.send_message(request).await {
        Ok(event_id) => ok_response(&event_id),
        // Sink errors are relayed to the agent, so a sink must never put a
        // credential in one. The relay sink below builds them from transport
        // and SDK errors, neither of which carries the key.
        Err(SinkError::Rejected(message)) => error_response("bad_request", &message),
        Err(SinkError::Unavailable(message)) => error_response("send_failed", &message),
    }
}

// ── The relay-backed sink ───────────────────────────────────────────────────

/// Sends via the same path the harness already uses on the agent's behalf:
/// `buzz_sdk::build_message`, `sign_with_keys`, `RestClient::submit_event` —
/// the sequence in `pool::post_failure_notice`. Nothing about signing is
/// reimplemented here.
pub struct RelayMessageSink {
    rest: crate::relay::RestClient,
}

impl RelayMessageSink {
    /// Wrap the harness's REST client. It carries the keys and the NIP-OA auth
    /// tag, so a brokered message is indistinguishable from one the harness
    /// sent itself — which it is.
    pub fn new(rest: crate::relay::RestClient) -> Self {
        Self { rest }
    }

    /// Resolve the NIP-10 thread ref for a reply to `parent_hex`.
    ///
    /// This is the one place the broker reads from the relay, and it is not a
    /// read surface: the caller chooses no filter and sees no result. It
    /// fetches the parent solely to learn the thread root that the message
    /// being sent has to carry, mirroring `resolve_thread_ref` in
    /// `buzz-cli`'s `messages send`.
    ///
    /// A parent the relay cannot return falls back to `root == parent`, which
    /// is correct for a top-level parent and is the only option for any other:
    /// the reply lands either way, which is the point of the whole change.
    async fn thread_ref(&self, parent_hex: &str) -> Result<buzz_sdk::ThreadRef, SinkError> {
        let parent_event_id = nostr::EventId::from_hex(parent_hex)
            .map_err(|e| SinkError::Rejected(format!("reply_to is not an event id: {e}")))?;
        let filter = nostr::Filter::new().id(parent_event_id).limit(1);
        let response =
            self.rest.query(&[filter]).await.map_err(|e| {
                SinkError::Unavailable(format!("could not read the reply target: {e}"))
            })?;
        let root_event_id = response
            .as_array()
            .and_then(|events| events.first())
            .and_then(|event| event.get("tags"))
            .and_then(thread_root_from_tags)
            .filter(|root| root != parent_hex)
            .and_then(|root| nostr::EventId::from_hex(&root).ok())
            .unwrap_or(parent_event_id);
        Ok(buzz_sdk::ThreadRef {
            root_event_id,
            parent_event_id,
        })
    }
}

/// Thread root from an event's NIP-10 `e` tags.
///
/// A `root` marker wins. Failing that, a `reply` marker is the root, because a
/// direct reply's parent is itself the root. No markers means the parent is
/// top-level and is its own root, reported here as `None`. Malformed marker
/// values are ignored rather than propagated, so a bad tag on the parent
/// cannot block the reply.
fn thread_root_from_tags(tags: &Value) -> Option<String> {
    let mut root = None;
    let mut reply = None;
    for tag in tags.as_array()? {
        let Some(parts) = tag.as_array() else {
            continue;
        };
        if parts.len() < 4 || parts[0].as_str() != Some("e") {
            continue;
        }
        let id = parts[1].as_str().filter(|id| is_event_id(id));
        match (parts[3].as_str(), id) {
            (Some("root"), Some(id)) => root = Some(id.to_string()),
            (Some("reply"), Some(id)) => reply = Some(id.to_string()),
            _ => {}
        }
    }
    root.or(reply)
}

impl MessageSink for RelayMessageSink {
    fn send_message<'a>(&'a self, request: SendMessage) -> SendFuture<'a> {
        Box::pin(async move {
            let thread_ref = match request.reply_to.as_deref() {
                Some(parent) => Some(self.thread_ref(parent).await?),
                None => None,
            };
            let mentions: Vec<&str> = request.mentions.iter().map(String::as_str).collect();
            let builder = buzz_sdk::build_message(
                request.channel,
                &request.content,
                thread_ref.as_ref(),
                &mentions,
                request.broadcast,
                &[],
            )
            .map_err(|e| SinkError::Rejected(format!("message rejected: {e}")))?;
            let event = builder
                .sign_with_keys(&self.rest.keys)
                .map_err(|e| SinkError::Unavailable(format!("could not sign the message: {e}")))?;
            let event_id = event.id.to_hex();
            self.rest
                .submit_event(&event)
                .await
                .map_err(|e| SinkError::Unavailable(format!("relay did not accept it: {e}")))?;
            Ok(event_id)
        })
    }
}

// ── The socket ──────────────────────────────────────────────────────────────

#[cfg(unix)]
pub use unix::Broker;

#[cfg(unix)]
mod unix {
    use std::io;
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::time::Duration;

    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    use tokio::net::{UnixListener, UnixStream};
    use tokio::sync::Semaphore;

    use super::{
        error_response, handle_request, MessageSink, BROKER_SOCKET_ENV, MAX_REQUEST_BYTES,
    };

    /// How long a connected client has to deliver its request line.
    const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

    /// Requests served at once. A generous ceiling for one agent, and a low
    /// enough one that a client opening connections in a loop cannot exhaust
    /// the harness's file descriptors or its runtime.
    const MAX_CONCURRENT_REQUESTS: usize = 8;

    /// Attempts to find an unused directory name before giving up.
    const BIND_ATTEMPTS: usize = 5;

    /// A bound broker socket. Dropping it stops serving and removes the socket
    /// and its directory.
    pub struct Broker {
        socket_path: PathBuf,
        directory: PathBuf,
        accept: tokio::task::JoinHandle<()>,
    }

    impl Broker {
        /// Bind a fresh socket and start serving `sink` on it.
        ///
        /// Must be called from within a Tokio runtime.
        ///
        /// The directory is created with [`std::fs::DirBuilder`] at mode 0700,
        /// which fails if it already exists: the broker never adopts a
        /// directory it did not create, so nothing can pre-place a
        /// world-readable directory at a name the harness is about to use. The
        /// socket is chmodded to 0600 immediately after `bind`, because the
        /// process umask decides the mode `bind` leaves behind; the 0700
        /// directory is what closes the window between the two.
        pub fn bind(sink: Arc<dyn MessageSink>) -> io::Result<Self> {
            let (directory, listener, socket_path) = Self::bind_listener()?;
            let accept = tokio::spawn(serve(listener, sink));
            Ok(Self {
                socket_path,
                directory,
                accept,
            })
        }

        fn bind_listener() -> io::Result<(PathBuf, UnixListener, PathBuf)> {
            let mut last_error = None;
            for _ in 0..BIND_ATTEMPTS {
                // Short components on purpose: a unix socket path is capped at
                // ~104 bytes on macOS, and $TMPDIR there is already ~50.
                let unique = super::Uuid::new_v4().simple().to_string();
                let directory = std::env::temp_dir().join(format!(
                    "bz-{}-{}",
                    std::process::id(),
                    &unique[..8]
                ));
                match std::fs::DirBuilder::new().mode(0o700).create(&directory) {
                    Ok(()) => {}
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                        last_error = Some(error);
                        continue;
                    }
                    Err(error) => return Err(error),
                }
                let socket_path = directory.join("s");
                let bound = UnixListener::bind(&socket_path).and_then(|listener| {
                    std::fs::set_permissions(&socket_path, std::fs::Permissions::from_mode(0o600))?;
                    Ok(listener)
                });
                match bound {
                    Ok(listener) => return Ok((directory, listener, socket_path)),
                    Err(error) => {
                        // Remove only what this attempt created.
                        let _ = std::fs::remove_file(&socket_path);
                        let _ = std::fs::remove_dir(&directory);
                        return Err(error);
                    }
                }
            }
            Err(last_error.unwrap_or_else(|| {
                io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "no free broker directory name",
                )
            }))
        }

        /// Path of the bound socket.
        pub fn socket_path(&self) -> &Path {
            &self.socket_path
        }

        /// The environment entry to hand the spawned agent.
        ///
        /// `None` when the socket path is not UTF-8, which no environment
        /// variable could carry faithfully anyway.
        pub fn env_var(&self) -> Option<(String, String)> {
            self.socket_path
                .to_str()
                .map(|path| (BROKER_SOCKET_ENV.to_string(), path.to_string()))
        }
    }

    impl Drop for Broker {
        fn drop(&mut self) {
            self.accept.abort();
            // Narrow removal: the socket this broker created, then the
            // directory it created for it. Never recursive, never a path it
            // adopted. Both are best-effort — a harness that dies without
            // running Drop leaves inert files behind (see the module docs).
            if let Err(error) = std::fs::remove_file(&self.socket_path) {
                tracing::debug!("broker socket not removed: {error}");
            }
            if let Err(error) = std::fs::remove_dir(&self.directory) {
                tracing::debug!("broker directory not removed: {error}");
            }
        }
    }

    async fn serve(listener: UnixListener, sink: Arc<dyn MessageSink>) {
        let permits = Arc::new(Semaphore::new(MAX_CONCURRENT_REQUESTS));
        loop {
            let stream = match listener.accept().await {
                Ok((stream, _)) => stream,
                Err(error) => {
                    // Usually transient (descriptor exhaustion). Pause so a
                    // permanently broken listener cannot spin the runtime.
                    tracing::warn!("broker accept failed: {error}");
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                }
            };
            let Ok(permit) = permits.clone().acquire_owned().await else {
                return;
            };
            let sink = sink.clone();
            tokio::spawn(async move {
                let _permit = permit;
                if let Err(error) = handle_connection(stream, sink.as_ref()).await {
                    tracing::debug!("broker connection ended: {error}");
                }
            });
        }
    }

    /// One request, one response, one connection.
    async fn handle_connection(stream: UnixStream, sink: &dyn MessageSink) -> io::Result<()> {
        let (reader, mut writer) = stream.into_split();
        // `take` caps the read before the buffer grows, so an endless line
        // costs the harness MAX_REQUEST_BYTES and no more.
        let mut reader = BufReader::new(reader.take(MAX_REQUEST_BYTES as u64));
        let mut line = String::new();
        let response = match tokio::time::timeout(REQUEST_TIMEOUT, reader.read_line(&mut line))
            .await
        {
            Err(_) => error_response("timeout", "no request arrived before the broker timed out"),
            Ok(Ok(0)) => return Ok(()),
            Ok(Ok(read)) if read >= MAX_REQUEST_BYTES && !line.ends_with('\n') => error_response(
                "too_large",
                "request exceeds the broker's size limit; send a shorter message",
            ),
            Ok(Ok(_)) => handle_request(&line, sink).await,
            Ok(Err(error)) if error.kind() == io::ErrorKind::InvalidData => {
                error_response("bad_request", "request must be UTF-8 JSON")
            }
            Ok(Err(error)) => return Err(error),
        };

        let mut body = serde_json::to_vec(&response).unwrap_or_else(|_| {
            br#"{"ok":false,"error":"internal","message":"response could not be encoded"}"#.to_vec()
        });
        body.push(b'\n');
        writer.write_all(&body).await?;
        writer.flush().await?;
        writer.shutdown().await
    }
}

#[cfg(test)]
mod tests;
