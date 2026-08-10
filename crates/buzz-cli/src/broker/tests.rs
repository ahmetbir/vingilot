//! What this module has to keep true: the order identity is resolved in, the
//! narrowness of what may be brokered, and the fact that no failure here ever
//! teaches an agent to put a key on a command line.
//!
//! The fake broker below is a plain unix listener that records the request line
//! it was given. Several tests assert it was *not* connected to at all — that
//! is how "refused rather than half-sent" is proved: not by the error alone,
//! but by nothing having reached the wire.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::sync::mpsc;
use std::thread::JoinHandle;

use serde_json::{json, Value};

use super::*;
use crate::error::exit_code;
use crate::{Cmd, MessagesCmd};

/// A 64-char hex id, the shape the relay and the broker both use.
fn hex64(fill: char) -> String {
    fill.to_string().repeat(64)
}

/// A listener that answers one request with `answer` and reports what it was
/// asked. Lives in a `tempfile::TempDir`, so its socket is removed with the
/// directory when the test ends — no recursive delete, no shared path.
struct FakeBroker {
    _dir: tempfile::TempDir,
    socket: PathBuf,
    asked: mpsc::Receiver<String>,
    server: Option<JoinHandle<()>>,
}

impl FakeBroker {
    fn answering(answer: Value) -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let socket = dir.path().join("s");
        let listener = UnixListener::bind(&socket).expect("bind");
        let (tx, asked) = mpsc::channel();
        let server = std::thread::spawn(move || {
            let Ok((stream, _)) = listener.accept() else {
                return;
            };
            let mut line = String::new();
            let mut reader = BufReader::new(&stream);
            if reader.read_line(&mut line).is_err() {
                return;
            }
            let _ = tx.send(line);
            let mut body = serde_json::to_vec(&answer).expect("encode answer");
            body.push(b'\n');
            let mut writer = &stream;
            let _ = writer.write_all(&body);
            let _ = writer.flush();
        });
        Self {
            _dir: dir,
            socket,
            asked,
            server: Some(server),
        }
    }

    /// The request the broker was handed, or `None` if it was never connected
    /// to. `try_recv` after the send call has returned, so a request that was
    /// going to arrive has arrived.
    fn request(&self) -> Option<Value> {
        self.asked
            .try_recv()
            .ok()
            .map(|line| serde_json::from_str(line.trim()).expect("request is JSON"))
    }
}

impl Drop for FakeBroker {
    fn drop(&mut self) {
        // Unblock a server still waiting on accept(), then join it so no thread
        // outlives the temp directory it reads from.
        if self.server.is_some() {
            let _ = std::os::unix::net::UnixStream::connect(&self.socket);
        }
        if let Some(server) = self.server.take() {
            let _ = server.join();
        }
    }
}

/// A `messages send` with only the fields a plain reply carries.
fn send_command(channel: &str, content: &str) -> Cmd {
    Cmd::Messages(MessagesCmd::Send {
        channel: channel.to_string(),
        content: content.to_string(),
        kind: None,
        reply_to: None,
        broadcast: false,
        files: Vec::new(),
        mentions: Vec::new(),
    })
}

const CHANNEL: &str = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

// ── The resolution order ────────────────────────────────────────────────────

#[test]
fn a_key_wins_over_a_broker_that_is_also_offered() {
    // The case the whole ordering exists for: an agent that has a key AND a
    // harness broker must keep signing with its own key. Consulting the broker
    // first would silently re-identify every setup that works today.
    let identity = resolve(
        Some("nsec-shaped-value".to_string()),
        Some("/tmp/does-not-matter".to_string()),
    );
    match identity {
        Identity::Key(key) => assert_eq!(key, "nsec-shaped-value"),
        _ => panic!("a present key must win over an offered broker"),
    }
}

#[test]
fn a_key_alone_never_reaches_for_a_broker() {
    assert!(matches!(
        resolve(Some("nsec-shaped-value".to_string()), None),
        Identity::Key(_)
    ));
}

#[test]
fn a_blanked_key_is_no_key_and_the_broker_still_stands_in() {
    // The shells this whole module exists for blank variables as readily as
    // they unset them, and clap passes a blank env value through as `Some("")`.
    // Read as a key it short-circuits before the socket is looked at, and the
    // harness that could have sent the reply is never asked — the agent gets
    // "invalid BUZZ_PRIVATE_KEY" and reads it as *I have no credentials*, which
    // is the exact outcome this module replaces.
    for blank in ["", "   ", "\n", "\t"] {
        match resolve(Some(blank.to_string()), Some("/run/bz/s".to_string())) {
            Identity::Broker(socket) => assert_eq!(socket, PathBuf::from("/run/bz/s")),
            _ => panic!("a blanked key must not short-circuit the broker: {blank:?}"),
        }
        assert!(
            matches!(resolve(Some(blank.to_string()), None), Identity::Neither),
            "a blanked key with no broker is the keyless case, not a bad key: {blank:?}"
        );
    }
}

#[test]
fn no_key_and_a_socket_asks_the_broker() {
    match resolve(None, Some("/run/bz/s".to_string())) {
        Identity::Broker(socket) => assert_eq!(socket, PathBuf::from("/run/bz/s")),
        _ => panic!("a socket with no key is the broker's case"),
    }
}

#[test]
fn no_key_and_no_socket_is_neither() {
    assert!(matches!(resolve(None, None), Identity::Neither));
    // A sanitising shell may blank a variable rather than unset it; a blank
    // value names no socket.
    assert!(matches!(
        resolve(None, Some(String::new())),
        Identity::Neither
    ));
    assert!(matches!(
        resolve(None, Some("   ".to_string())),
        Identity::Neither
    ));
}

// ── The message that replaced the one that taught the wrong lesson ──────────

#[test]
fn no_keyless_failure_ever_suggests_putting_a_key_on_the_command_line() {
    let failures = [
        no_key_no_broker(),
        no_key_broker_silent(Path::new("/tmp/bz/s"), "Connection refused"),
        no_key_not_brokerable("sends channel messages and nothing else", "Use a key."),
    ];
    for failure in failures {
        let message = failure.to_string();
        assert!(
            !message.contains("--private-key"),
            "a keyless failure must not name the flag that puts a key in ps output: {message}"
        );
        assert!(
            !message.contains("is required"),
            "the replaced message read as an instruction to supply one: {message}"
        );
        assert!(
            message.starts_with("auth error: this shell has no BUZZ_PRIVATE_KEY"),
            "every keyless failure says the key was not found: {message}"
        );
        // Same category and same exit code as before this module existed —
        // only the sentence changed.
        assert_eq!(exit_code(&failure), 3, "keyless failure stays exit 3");
    }
}

#[test]
fn an_absent_broker_is_named_as_absent() {
    let message = no_key_no_broker().to_string();
    assert!(
        message.contains("no harness broker was offered") && message.contains(BROKER_SOCKET_ENV),
        "the message must say the broker was not there either: {message}"
    );
}

#[test]
fn an_unreachable_broker_names_the_socket_and_the_cause() {
    let message = no_key_broker_silent(Path::new("/tmp/bz-4321/s"), "Connection refused");
    let message = message.to_string();
    // The socket path is not a secret, and it is the first thing an operator
    // debugging a mute agent needs.
    assert!(message.contains("/tmp/bz-4321/s"), "{message}");
    assert!(message.contains("Connection refused"), "{message}");
    assert!(message.contains("did not answer"), "{message}");
}

// ── Only what the broker covers ─────────────────────────────────────────────

#[test]
fn a_command_that_is_not_messages_send_fails_without_touching_the_broker() {
    let broker = FakeBroker::answering(json!({ "ok": true, "event_id": hex64('a') }));
    let not_a_send = Cmd::Messages(MessagesCmd::Edit {
        event: hex64('b'),
        content: "rewritten".to_string(),
    });
    let error = run_without_key(not_a_send, Some(broker.socket.clone()))
        .expect_err("only messages send is brokered");
    assert_eq!(exit_code(&error), 3, "same exit code as before: {error}");
    assert!(
        error
            .to_string()
            .contains("sends channel messages and nothing else"),
        "{error}"
    );
    assert!(
        broker.request().is_none(),
        "nothing may reach the broker for a command it does not serve"
    );
}

#[test]
fn attachments_and_foreign_kinds_are_refused_rather_than_half_sent() {
    for (label, command) in [
        (
            "--file",
            Cmd::Messages(MessagesCmd::Send {
                channel: CHANNEL.to_string(),
                content: "look at this".to_string(),
                kind: None,
                reply_to: None,
                broadcast: false,
                files: vec!["/tmp/screenshot.png".to_string()],
                mentions: Vec::new(),
            }),
        ),
        (
            "--kind",
            Cmd::Messages(MessagesCmd::Send {
                channel: CHANNEL.to_string(),
                content: "a forum post".to_string(),
                kind: Some(45001),
                reply_to: None,
                broadcast: false,
                files: Vec::new(),
                mentions: Vec::new(),
            }),
        ),
    ] {
        let broker = FakeBroker::answering(json!({ "ok": true, "event_id": hex64('a') }));
        let error = run_without_key(command, Some(broker.socket.clone()))
            .expect_err("outside what the broker covers");
        assert_eq!(exit_code(&error), 3, "{label}: {error}");
        assert!(
            error.to_string().contains(label),
            "{label}: the refusal names what it cannot do: {error}"
        );
        assert!(
            broker.request().is_none(),
            "{label}: a message the broker cannot send in full must not be sent at all"
        );
    }
}

#[test]
fn a_send_with_no_broker_at_all_reports_the_broker_not_the_flag() {
    let error = run_without_key(send_command(CHANNEL, "hello"), None)
        .expect_err("no key and no broker cannot send");
    assert_eq!(exit_code(&error), 3);
    let message = error.to_string();
    assert!(
        message.contains("no harness broker was offered"),
        "{message}"
    );
    assert!(!message.contains("--private-key"), "{message}");
}

#[test]
fn a_socket_with_nothing_listening_is_unreachable_not_silent_success() {
    let dir = tempfile::tempdir().expect("tempdir");
    // A path where a crashed harness's socket would be: nothing is listening,
    // so connect() fails at once rather than hanging.
    let stale = dir.path().join("s");
    let error = run_without_key(send_command(CHANNEL, "hello"), Some(stale.clone()))
        .expect_err("an unreachable broker cannot send");
    assert_eq!(exit_code(&error), 3);
    let message = error.to_string();
    assert!(message.contains(&stale.display().to_string()), "{message}");
    assert!(message.contains("did not answer"), "{message}");
}

// ── The wire ────────────────────────────────────────────────────────────────

#[test]
fn a_brokered_send_asks_for_exactly_one_message_and_reports_its_id() {
    let broker = FakeBroker::answering(json!({ "ok": true, "event_id": hex64('c') }));
    let command = Cmd::Messages(MessagesCmd::Send {
        channel: CHANNEL.to_string(),
        content: "on it".to_string(),
        kind: Some(9),
        reply_to: Some(hex64('d')),
        broadcast: false,
        files: Vec::new(),
        mentions: vec![hex64('e')],
    });
    run_without_key(command, Some(broker.socket.clone())).expect("the broker sends it");

    let asked = broker.request().expect("the broker was asked");
    assert_eq!(asked["op"], OP_SEND_MESSAGE);
    assert_eq!(asked["channel"], CHANNEL);
    assert_eq!(asked["content"], "on it");
    assert_eq!(asked["reply_to"], hex64('d'));
    assert_eq!(asked["mentions"], json!([hex64('e')]));
    assert_eq!(asked["broadcast"], false);
    // Nothing else: the broker rejects unknown fields, and a request carrying
    // an author or a kind would be asking it to be something it is not.
    assert_eq!(
        asked.as_object().expect("object").len(),
        6,
        "the request carries the op and five fields, nothing more: {asked}"
    );
}

#[test]
fn a_refusal_is_never_read_as_a_send() {
    let answer = json!({
        "ok": false,
        "error": "refused_arbitrary_signing",
        "message": "the broker never signs caller-supplied bytes or events",
    });
    let error = interpret(&answer).expect_err("a refusal is a failure");
    assert_eq!(exit_code(&error), 4, "{error}");
    assert!(
        error.to_string().contains("refused_arbitrary_signing"),
        "the agent is told which boundary it hit: {error}"
    );
}

#[test]
fn a_rejected_request_is_the_callers_error_not_the_relays() {
    let answer =
        json!({ "ok": false, "error": "bad_request", "message": "content must not be empty" });
    let error = interpret(&answer).expect_err("a rejection is a failure");
    assert_eq!(
        exit_code(&error),
        1,
        "a malformed request is exit 1, as everywhere else in this CLI: {error}"
    );
}

#[test]
fn success_without_an_id_is_not_success() {
    for answer in [
        json!({ "ok": true }),
        json!({ "ok": true, "event_id": "" }),
        json!({ "ok": true, "event_id": "   " }),
    ] {
        let error =
            interpret(&answer).expect_err("a send with no id has not been shown to have happened");
        assert_eq!(exit_code(&error), 4, "{error}");
    }
}

#[test]
fn an_id_comes_back_whole() {
    let id = hex64('f');
    assert_eq!(
        interpret(&json!({ "ok": true, "event_id": id })).expect("a send"),
        id
    );
}
