//! Asking the harness to send, when this shell was handed no key.
//!
//! # Why this exists
//!
//! An agent replies by shelling out to `buzz messages send`, and this CLI reads
//! its identity from `BUZZ_PRIVATE_KEY`. That works only for harnesses whose
//! shell tool hands its environment to the child process. Several — Hermes and
//! Kimi among them — run tool commands in a sanitised environment, where
//! `BUZZ_PRIVATE_KEY`, `BUZZ_RELAY_URL` and `BUZZ_AUTH_TAG` all arrive empty.
//! Nothing set outside such a harness survives it, so every reply died with
//! `auth_error` and the agent read that as *I have no credentials*.
//!
//! The harness process already holds the key and is already talking to the
//! relay, so when this shell has nothing, the CLI asks the harness to send for
//! it over a unix socket (`buzz_acp::broker`). **No secret has to reach this
//! process for a reply to land.**
//!
//! # The order, which is the part that must not drift
//!
//! Identity is resolved as: an explicit `--private-key`, then
//! `BUZZ_PRIVATE_KEY`, and only when neither holds a value, the broker. Clap
//! resolves the first two into one `Option` (the flag wins over the env var);
//! [`resolve`] decides the last step and nothing else does.
//!
//! "Holds a value" rather than "exists", because the shells this exists for
//! blank variables as readily as they unset them, and clap passes a blank env
//! value through as `Some("")`.
//!
//! # Two ways to name the socket, and why that is not a double standard
//!
//! The broker is named by `--broker-socket` or by `BUZZ_BROKER_SOCKET`, the
//! same flag-beats-env pair as the key, and for a reason the key does not
//! share: a harness that strips `BUZZ_PRIVATE_KEY` from its shell will strip
//! `BUZZ_BROKER_SOCKET` too — one sanitiser, no exceptions for variables it has
//! never heard of. If the environment were the only channel, the fix would be
//! inert in exactly the case it was written for.
//!
//! A flag is the answer here and never for the key, because **a socket path is
//! not a secret and a key is.** `ps` reading `--broker-socket /tmp/bz-1234/s`
//! learns a path whose protection is the 0700 directory holding it, and learns
//! nothing it could use; `ps` reading `--private-key` learns the identity
//! itself. The rule is about what the argument is worth to a reader, not about
//! symmetry between two variables that happen to sit next to each other.
//!
//! What this does not do is *find* the socket. Nothing here scans for one. A
//! scan would have to choose between candidates, and choosing wrong means
//! publishing the reply as another agent — a guess this code refuses to make.
//! Something has to tell the agent the path; the harness logs it at startup and
//! passes it in the environment for the shells that keep one.
//!
//! Consulting the broker any earlier would change every setup that works today:
//! an agent that *does* have a key would silently stop using it, and would send
//! as whatever identity the harness happens to hold instead. The broker only
//! ever replaces a failure — never a working key.
//!
//! # What may be brokered, and what must still fail
//!
//! Only `messages send`, because sending a channel message is the only thing
//! the harness broker does. Every other subcommand that needs a key and has
//! none fails exactly as it did before this module existed: `CliError::Auth`,
//! exit 3. Half-serving them — reading without auth, or sending some other
//! event shape through a socket that does not offer one — would trade a clear
//! failure for a confusing one.
//!
//! Even `messages send` is only brokered for what the broker covers: a plain
//! kind-9 channel message with optional explicit mentions. Attachments and
//! forum kinds are refused by name rather than silently dropped.
//!
//! # What the error may never say
//!
//! It may never suggest `--private-key`. The message this replaces did, and an
//! agent followed it literally and put a key-shaped value on a command line,
//! where `ps` and every transcript can read it. A shell with no key is not a
//! shell that should be handed one; it is a shell whose harness should be
//! sending on its behalf. Every message here says the key was not found, says
//! why the broker could not stand in, and closes the door rather than pointing
//! at it.

use std::path::{Path, PathBuf};
// Gated with the timeout constants it exists for (see their comment below):
// their only reader is the #[cfg(unix)] send path, so on Windows this import
// is unused and upstream's -D warnings build refuses it.
#[cfg(unix)]
use std::time::Duration;

use serde_json::{json, Value};

use crate::error::CliError;
use crate::validate::{parse_uuid, read_or_stdin, validate_content_size, validate_hex64};

/// Environment variable naming the harness broker's socket.
///
/// Not a secret: its protection is the mode of the socket and of the directory
/// holding it, both set by the harness. See `buzz_acp::broker` for the other
/// end of this contract.
pub const BROKER_SOCKET_ENV: &str = "BUZZ_BROKER_SOCKET";

/// The flag that names the same socket for a shell where the variable above did
/// not survive. Quoted in failure messages so an operator is told the channel
/// that does not depend on the environment.
pub const BROKER_SOCKET_FLAG: &str = "--broker-socket";

/// The one op the harness broker serves. Mirrors
/// `buzz_acp::broker::OP_SEND_MESSAGE`: the two crates share a wire format, not
/// a type, so that neither has to depend on the other.
const OP_SEND_MESSAGE: &str = "send_message";

// Gated with the socket they bound: the only reader of these three is the
// `#[cfg(unix)]` send path below, and a unix socket is the whole mechanism.
// Left ungated they are dead code on Windows, which upstream's `-D warnings`
// build caught after every gate this fork runs on a Mac had passed them.
#[cfg(unix)]
/// How long to wait for the harness's answer. Generous, because the harness
/// does a relay round trip inside it, and bounded because a wedged harness must
/// not leave an agent's reply hanging forever.
const READ_TIMEOUT: Duration = Duration::from_secs(90);

#[cfg(unix)]
/// How long to wait to hand over the request itself.
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);

#[cfg(unix)]
/// Longest answer read from the socket. The broker's answer is an id and a
/// short string; anything larger is not one, and is not worth buffering.
const MAX_RESPONSE_BYTES: u64 = 64 * 1024;

/// Where this invocation's identity comes from.
pub(crate) enum Identity {
    /// A non-blank key was supplied — by `--private-key`, or by
    /// `BUZZ_PRIVATE_KEY`, which clap has already resolved into one value with
    /// the flag winning. The broker is not consulted at all in this case.
    Key(String),
    /// No key here, but a harness offered a broker to ask.
    Broker(PathBuf),
    /// No key and no broker.
    Neither,
}

/// Decide where the identity comes from — the whole resolution order, in one
/// place, evaluated in one direction.
///
/// Both arguments arrive already collapsed by clap, flag over env var.
///
/// A present key short-circuits before `broker_socket` is even looked at. That
/// is deliberate and load-bearing: a harness may offer a broker to an agent
/// that also has a key, and that agent must keep signing with its own.
pub(crate) fn resolve(private_key: Option<String>, broker_socket: Option<String>) -> Identity {
    // Both variables are blank-checked, and for the same reason: a sanitising
    // shell may blank a variable rather than unset it, and clap hands a blank
    // env value straight through as `Some("")`. A blank key is no key. Taken as
    // one it would short-circuit here and die with "invalid BUZZ_PRIVATE_KEY"
    // without the broker ever being consulted — the harness that could have
    // sent the reply would never be asked, and the agent would read the same
    // *I have no credentials* this module exists to stop it reading.
    if let Some(key) = private_key.filter(|key| !key.trim().is_empty()) {
        return Identity::Key(key);
    }
    match broker_socket {
        // Same reasoning on this side: a blank value names no socket, so it is
        // no broker.
        Some(path) if !path.trim().is_empty() => Identity::Broker(PathBuf::from(path)),
        _ => Identity::Neither,
    }
}

// ── The refusals ────────────────────────────────────────────────────────────

/// Opening clause shared by every keyless failure. States what is missing
/// without telling anyone to supply it here.
const NO_KEY: &str = "this shell has no BUZZ_PRIVATE_KEY";

/// Closing clause for the cases where nothing about the invocation can help.
const NOT_YOURS_TO_SUPPLY: &str =
    "the key lives in the harness, not in this shell, and nothing passed to this command stands in for one";

/// No key, and no harness offered to send on this shell's behalf.
///
/// Both ways of naming the socket are listed, because the likeliest reason to
/// be reading this message is a shell that dropped the variable — and the flag
/// is the way round that. Naming a socket path costs nothing to say out loud;
/// see the module docs for why that is not true of the key.
fn no_key_no_broker() -> CliError {
    CliError::Auth(format!(
        "{NO_KEY}, and no harness broker was offered either ({BROKER_SOCKET_ENV} is unset and no {BROKER_SOCKET_FLAG} was given), so nothing here can send as you: {NOT_YOURS_TO_SUPPLY}"
    ))
}

/// No key, and the harness broker that should have covered for it did not
/// answer. The socket path is named because it is not a secret and because it
/// is the first thing an operator debugging a mute agent needs.
fn no_key_broker_silent(socket: &Path, cause: &str) -> CliError {
    CliError::Auth(format!(
        "{NO_KEY}, and the harness broker at {} did not answer ({cause}), so nothing here can send as you: {NOT_YOURS_TO_SUPPLY}",
        socket.display()
    ))
}

/// No key, and this is not something a broker that only sends messages can do.
///
/// `limit` completes "the harness broker …", and `remedy` is the one sentence
/// that follows. Neither may point at a flag that carries a secret.
fn no_key_not_brokerable(limit: &str, remedy: &str) -> CliError {
    CliError::Auth(format!(
        "{NO_KEY}, and the harness broker {limit}. {remedy}"
    ))
}

// ── The request ─────────────────────────────────────────────────────────────

/// Serve `messages send` through the harness broker, or explain why this
/// invocation cannot be.
///
/// Synchronous on purpose: one connection, one line out, one line back. The
/// relay work happens in the harness, so there is nothing here to overlap.
pub(crate) fn run_without_key(
    command: crate::Cmd,
    socket: Option<PathBuf>,
) -> Result<(), CliError> {
    let crate::Cmd::Messages(crate::MessagesCmd::Send {
        channel,
        content,
        kind,
        reply_to,
        broadcast,
        files,
        mentions,
    }) = command
    else {
        return Err(no_key_not_brokerable(
            "sends channel messages and nothing else",
            "This command signs something else, so it needs a key of its own.",
        ));
    };

    let Some(socket) = socket else {
        return Err(no_key_no_broker());
    };

    // Refused before anything is sent, not after: a message that lands without
    // its attachments, or as the wrong kind, is worse than one that does not
    // land at all, because only the second is visible to whoever asked for it.
    if !files.is_empty() {
        return Err(no_key_not_brokerable(
            "sends text and cannot upload the file an attachment needs",
            "Retry without --file.",
        ));
    }
    if !matches!(kind, None | Some(9)) {
        return Err(no_key_not_brokerable(
            "sends kind-9 channel messages and nothing else",
            "Retry without --kind.",
        ));
    }

    let channel = parse_uuid(&channel)?;
    let content = read_or_stdin(&content)?;
    validate_content_size(&content)?;
    if let Some(ref parent) = reply_to {
        validate_hex64(parent)?;
    }
    // Explicit `--mention` pubkeys only. A bare `@Name` in the text stays text:
    // resolving a name means reading the channel's members, which needs the key
    // this shell does not have. The message lands either way, and the reply
    // landing is the whole point; what it cannot do is quietly notify someone
    // the caller never named.
    let mentions = crate::commands::messages::normalize_explicit_mentions(&mentions)?;

    let request = json!({
        "op": OP_SEND_MESSAGE,
        "channel": channel,
        "content": content,
        "reply_to": reply_to,
        "mentions": mentions,
        "broadcast": broadcast,
    });

    let event_id = interpret(&ask_broker(&socket, &request)?)?;
    // Same shape as the keyed path's write response, so nothing downstream has
    // to know which path sent the message.
    println!(
        "{}",
        json!({
            "event_id": event_id,
            "accepted": true,
            "message": "sent by the harness broker",
            "mention_pubkeys": mentions,
        })
    );
    Ok(())
}

/// One connection, one request line, one answer line.
#[cfg(unix)]
fn ask_broker(socket: &Path, request: &Value) -> Result<Value, CliError> {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::os::unix::net::UnixStream;

    let unreachable = |e: std::io::Error| no_key_broker_silent(socket, &e.to_string());

    // A socket left behind by a crashed harness has nothing listening, so this
    // fails immediately with ECONNREFUSED rather than hanging.
    let stream = UnixStream::connect(socket).map_err(unreachable)?;
    stream
        .set_write_timeout(Some(WRITE_TIMEOUT))
        .map_err(unreachable)?;
    stream
        .set_read_timeout(Some(READ_TIMEOUT))
        .map_err(unreachable)?;

    let mut line = serde_json::to_vec(request)
        .map_err(|e| CliError::Other(format!("could not encode the broker request: {e}")))?;
    // The broker reads a line; without the newline it would wait for one until
    // its own timeout expired.
    line.push(b'\n');
    (&stream).write_all(&line).map_err(unreachable)?;
    (&stream).flush().map_err(unreachable)?;

    let mut answer = String::new();
    BufReader::new((&stream).take(MAX_RESPONSE_BYTES))
        .read_line(&mut answer)
        .map_err(unreachable)?;
    if answer.trim().is_empty() {
        return Err(no_key_broker_silent(
            socket,
            "it closed the connection without answering",
        ));
    }
    serde_json::from_str(answer.trim())
        .map_err(|e| CliError::Other(format!("the harness broker's answer was not JSON: {e}")))
}

/// No unix sockets, no broker. Nothing else in this module changes shape, so a
/// non-unix build fails the same way a unix build with no harness does.
#[cfg(not(unix))]
fn ask_broker(socket: &Path, _request: &Value) -> Result<Value, CliError> {
    Err(no_key_broker_silent(
        socket,
        "this platform has no unix domain sockets",
    ))
}

/// Turn the broker's answer into the id of what it sent, or into the error the
/// agent should read.
///
/// Success is only success with an id: a broker that reports `ok` without
/// naming what it sent has not told us a message landed, and printing an empty
/// `event_id` would look exactly like one that did.
fn interpret(answer: &Value) -> Result<String, CliError> {
    if answer.get("ok").and_then(Value::as_bool) == Some(true) {
        return match answer.get("event_id").and_then(Value::as_str) {
            Some(id) if !id.trim().is_empty() => Ok(id.to_string()),
            _ => Err(CliError::Other(
                "the harness broker reported success without the id of what it sent".into(),
            )),
        };
    }
    let code = answer
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let message = answer
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("the harness broker gave no reason");
    match code {
        // The request itself was wrong — the caller's fault and the caller's to
        // fix, which is exit 1 on every other path in this CLI.
        "bad_request" => Err(CliError::Usage(format!(
            "the harness broker refused the message: {message}"
        ))),
        // Everything else — a refusal, a send failure, a version skew. Not a
        // relay error of this process's making, so it is not dressed up as one:
        // inventing an HTTP status here would put a number in the output that
        // no relay ever returned.
        _ => Err(CliError::Other(format!(
            "the harness broker did not send it ({code}): {message}"
        ))),
    }
}

#[cfg(test)]
mod tests;
