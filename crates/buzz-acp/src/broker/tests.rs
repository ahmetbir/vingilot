//! Broker tests.
//!
//! Three things have to hold, and the third is the reason the broker exists at
//! all: it accepts the one request it serves, it refuses everything else *by
//! name*, and no path through it ever returns key material.

use std::sync::{Arc, Mutex};

use super::*;

const CHANNEL: &str = "0c9dcb6b-6a20-4e4a-9dbd-1c2c3f5a7b8e";
const EVENT_ID: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const OTHER_EVENT_ID: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const PUBKEY: &str = "3333333333333333333333333333333333333333333333333333333333333333";

/// A sink that records what reached it and answers with a fixed event id.
///
/// It holds a real keypair for the same reason the harness does — so a test can
/// assert that nothing it holds comes back out of a response.
struct FakeSink {
    keys: nostr::Keys,
    seen: Mutex<Vec<SendMessage>>,
    outcome: Mutex<Result<String, String>>,
    unavailable: bool,
}

impl FakeSink {
    fn new() -> Self {
        Self {
            keys: nostr::Keys::generate(),
            seen: Mutex::new(Vec::new()),
            outcome: Mutex::new(Ok(EVENT_ID.to_string())),
            unavailable: false,
        }
    }

    fn failing(message: &str, unavailable: bool) -> Self {
        Self {
            outcome: Mutex::new(Err(message.to_string())),
            unavailable,
            ..Self::new()
        }
    }

    fn seen(&self) -> Vec<SendMessage> {
        self.seen
            .lock()
            .map(|seen| seen.clone())
            .unwrap_or_default()
    }

    /// The secret this sink holds, as a string, so tests can assert no response
    /// contains it. Never logged, never written anywhere, never in an assertion
    /// message.
    fn secret(&self) -> String {
        self.keys.secret_key().display_secret().to_string()
    }
}

impl MessageSink for FakeSink {
    fn send_message<'a>(&'a self, request: SendMessage) -> SendFuture<'a> {
        Box::pin(async move {
            if let Ok(mut seen) = self.seen.lock() {
                seen.push(request);
            }
            let outcome = self
                .outcome
                .lock()
                .map(|outcome| outcome.clone())
                .unwrap_or_else(|_| Ok(EVENT_ID.to_string()));
            match outcome {
                Ok(event_id) => Ok(event_id),
                Err(message) if self.unavailable => Err(SinkError::Unavailable(message)),
                Err(message) => Err(SinkError::Rejected(message)),
            }
        })
    }
}

fn send_line(extra: serde_json::Value) -> String {
    let mut object = serde_json::Map::new();
    object.insert("op".into(), json!(OP_SEND_MESSAGE));
    object.insert("channel".into(), json!(CHANNEL));
    object.insert("content".into(), json!("it landed"));
    if let Some(extra) = extra.as_object() {
        for (key, value) in extra {
            object.insert(key.clone(), value.clone());
        }
    }
    Value::Object(object).to_string()
}

fn error_code(response: &Value) -> String {
    response
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or("<no error field>")
        .to_string()
}

// ── What it accepts ─────────────────────────────────────────────────────────

#[test]
fn a_channel_and_content_are_the_whole_of_a_minimal_request() {
    let request = parse_request(&send_line(json!({}))).expect("a minimal send is accepted");
    assert_eq!(request.channel.to_string(), CHANNEL);
    assert_eq!(request.content, "it landed");
    assert_eq!(request.reply_to, None);
    assert!(request.mentions.is_empty());
    assert!(!request.broadcast);
}

#[test]
fn a_reply_carries_its_parent_its_mentions_and_its_broadcast_flag() {
    let request = parse_request(&send_line(json!({
        "reply_to": EVENT_ID,
        "mentions": [PUBKEY],
        "broadcast": true,
    })))
    .expect("a threaded send with mentions is accepted");
    assert_eq!(request.reply_to.as_deref(), Some(EVENT_ID));
    assert_eq!(request.mentions, vec![PUBKEY.to_string()]);
    assert!(request.broadcast);
}

// ── What it refuses, by name ────────────────────────────────────────────────

#[test]
fn every_way_of_asking_for_the_identity_is_refused_by_name() {
    for op in [
        "get_key",
        "export_key",
        "private_key",
        "secret_key",
        "identity",
        "keys",
        "whoami",
        "pubkey",
    ] {
        let (code, message) = parse_request(&json!({ "op": op }).to_string())
            .expect_err("asking for the identity must never be served");
        assert_eq!(
            code, "refused_identity_disclosure",
            "op {op:?} must be refused as identity disclosure, not fall through"
        );
        assert!(
            message.contains("discloses no identity material"),
            "op {op:?} must be told why, not just told no"
        );
    }
}

#[test]
fn every_way_of_asking_for_a_signature_is_refused_by_name() {
    for op in [
        "sign",
        "sign_event",
        "sign_bytes",
        "publish",
        "publish_event",
        "submit_event",
        "event",
    ] {
        let (code, message) = parse_request(&json!({ "op": op }).to_string())
            .expect_err("arbitrary signing is what makes a broker a key-equivalent");
        assert_eq!(
            code, "refused_arbitrary_signing",
            "op {op:?} must be refused as arbitrary signing"
        );
        assert!(
            message.contains("never signs caller-supplied"),
            "op {op:?} must be told the boundary is permanent"
        );
    }
}

#[test]
fn every_way_of_asking_it_to_read_the_relay_is_refused_by_name() {
    for op in [
        "query",
        "req",
        "relay",
        "relay_request",
        "fetch",
        "subscribe",
        "get",
    ] {
        let (code, message) = parse_request(&json!({ "op": op }).to_string())
            .expect_err("the broker has no read surface to offer");
        assert_eq!(
            code, "refused_relay_proxy",
            "op {op:?} must be refused as relay proxying"
        );
        assert!(
            message.contains("not a relay proxy"),
            "op {op:?} must be told what the broker is not"
        );
    }
}

#[test]
fn an_unknown_op_is_unsupported_rather_than_refused() {
    // The distinction matters to a caller: "unsupported" is a version skew it
    // might work around, "refused" is a boundary it never will.
    let (code, message) = parse_request(&json!({ "op": "dance" }).to_string())
        .expect_err("an op the broker does not have is an error");
    assert_eq!(code, "unsupported_op");
    assert!(
        message.contains(OP_SEND_MESSAGE),
        "an unsupported op must name the one op that works: {message}"
    );
}

#[test]
fn a_field_the_broker_does_not_serve_is_rejected_not_ignored() {
    // A caller asking for a different kind, or naming an author, must be told
    // no — silently dropping the field would send something else entirely.
    for extra in [
        json!({ "kind": 45001 }),
        json!({ "author": PUBKEY }),
        json!({ "private_key": "not-a-key" }),
        json!({ "files": ["/etc/passwd"] }),
    ] {
        let (code, _) = parse_request(&send_line(extra.clone()))
            .expect_err("an unserved field must not be dropped silently");
        assert_eq!(code, "bad_request", "extra field {extra} must be rejected");
    }
}

#[test]
fn malformed_requests_are_named_one_by_one() {
    let cases: Vec<(&str, String)> = vec![
        ("not JSON at all", "{".to_string()),
        ("a JSON array", json!([{"op": OP_SEND_MESSAGE}]).to_string()),
        ("a bare scalar", json!("send_message").to_string()),
        ("no op", json!({ "channel": CHANNEL }).to_string()),
        (
            "a channel that is not a UUID",
            json!({ "op": OP_SEND_MESSAGE, "channel": "general", "content": "x" }).to_string(),
        ),
        ("empty content", send_line(json!({ "content": "   " }))),
        (
            "content past the cap",
            send_line(json!({ "content": "a".repeat(MAX_CONTENT_BYTES + 1) })),
        ),
        (
            "a reply target that is not an event id",
            send_line(json!({ "reply_to": "abc" })),
        ),
        (
            "a mention that is not a pubkey",
            send_line(json!({ "mentions": ["@someone"] })),
        ),
    ];
    for (name, line) in cases {
        match parse_request(&line) {
            Ok(_) => panic!("{name} must be rejected, not served"),
            Err((code, _)) => assert_eq!(code, "bad_request", "{name} must be a bad_request"),
        }
    }
}

// ── What comes back ─────────────────────────────────────────────────────────

#[tokio::test]
async fn an_accepted_request_answers_with_the_event_id_and_nothing_else() {
    let sink = FakeSink::new();
    let response = handle_request(&send_line(json!({})), &sink).await;
    assert_eq!(response, json!({ "ok": true, "event_id": EVENT_ID }));
    assert_eq!(sink.seen().len(), 1, "the send must reach the sink");
}

#[tokio::test]
async fn a_refused_request_never_reaches_the_sink() {
    let sink = FakeSink::new();
    for op in ["get_key", "sign_event", "query", "dance"] {
        let response = handle_request(&json!({ "op": op }).to_string(), &sink).await;
        assert_eq!(response["ok"], json!(false), "op {op:?} must not succeed");
    }
    assert!(
        sink.seen().is_empty(),
        "nothing refused may reach the thing that can sign"
    );
}

#[tokio::test]
async fn a_sink_failure_keeps_the_callers_fault_separate_from_the_brokers() {
    let rejected = FakeSink::failing("message rejected: content too long", false);
    let response = handle_request(&send_line(json!({})), &rejected).await;
    assert_eq!(error_code(&response), "bad_request");

    let unavailable = FakeSink::failing("relay did not accept it: timeout", true);
    let response = handle_request(&send_line(json!({})), &unavailable).await;
    assert_eq!(error_code(&response), "send_failed");
}

#[tokio::test]
async fn no_path_through_the_broker_returns_key_material() {
    // The one property that cannot be allowed to regress. Every op the broker
    // recognises, every op it does not, and a request it serves — none of the
    // responses may contain the secret the sink is holding the whole time.
    let sink = FakeSink::new();
    let secret = sink.secret();
    let mut lines: Vec<String> = [
        "get_key",
        "export_key",
        "private_key",
        "secret_key",
        "identity",
        "keys",
        "whoami",
        "pubkey",
        "sign",
        "sign_event",
        "sign_bytes",
        "publish",
        "publish_event",
        "submit_event",
        "event",
        "query",
        "req",
        "relay",
        "relay_request",
        "fetch",
        "subscribe",
        "get",
        "dance",
    ]
    .iter()
    .map(|op| json!({ "op": op }).to_string())
    .collect();
    lines.push(send_line(json!({})));
    lines.push("{".to_string());
    lines.push(send_line(json!({ "private_key": "give it here" })));

    for line in lines {
        let response = handle_request(&line, &sink).await.to_string();
        // Assertion messages name the op only — never the response, which is
        // the thing under suspicion.
        let op = parse_request(&line)
            .map(|_| OP_SEND_MESSAGE.to_string())
            .unwrap_or_else(|(code, _)| code.to_string());
        assert!(
            !response.contains(&secret),
            "a response on the {op} path carried the secret"
        );
        assert!(
            !response.contains("nsec1"),
            "a response on the {op} path carried a bech32 secret"
        );
    }
}

// ── Thread roots ────────────────────────────────────────────────────────────

#[test]
fn a_root_marker_beats_a_reply_marker_and_no_marker_means_no_root() {
    let tags = json!([
        ["e", OTHER_EVENT_ID, "", "reply"],
        ["e", EVENT_ID, "", "root"],
    ]);
    assert_eq!(
        thread_root_from_tags(&tags).as_deref(),
        Some(EVENT_ID),
        "the root marker names the thread root"
    );

    let reply_only = json!([["e", EVENT_ID, "", "reply"]]);
    assert_eq!(
        thread_root_from_tags(&reply_only).as_deref(),
        Some(EVENT_ID),
        "a direct reply's parent is its own root"
    );

    assert_eq!(
        thread_root_from_tags(&json!([["p", PUBKEY]])),
        None,
        "a top-level parent has no root tag and is its own root"
    );
    assert_eq!(
        thread_root_from_tags(&json!([["e", "short", "", "root"]])),
        None,
        "a malformed marker must not become a thread root"
    );
}

// ── The socket ──────────────────────────────────────────────────────────────

#[cfg(unix)]
mod socket {
    use std::os::unix::fs::PermissionsExt;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::UnixStream;

    use super::*;

    async fn ask(path: &std::path::Path, request: &str) -> String {
        let mut stream = UnixStream::connect(path).await.expect("broker accepts");
        stream
            .write_all(request.as_bytes())
            .await
            .expect("request is written");
        stream.shutdown().await.expect("write half closes");
        let mut response = String::new();
        stream
            .read_to_string(&mut response)
            .await
            .expect("response is read");
        response
    }

    #[tokio::test]
    async fn the_socket_is_owner_only_inside_an_owner_only_directory() {
        let sink = Arc::new(FakeSink::new());
        let broker = Broker::bind(sink).expect("the broker binds");
        let socket = broker.socket_path().to_path_buf();
        let directory = socket.parent().expect("the socket has a directory");

        let socket_mode = std::fs::metadata(&socket)
            .expect("the socket exists")
            .permissions()
            .mode()
            & 0o777;
        let directory_mode = std::fs::metadata(directory)
            .expect("the directory exists")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(socket_mode, 0o600, "the socket must not be group/world");
        assert_eq!(
            directory_mode, 0o700,
            "the directory is the real protection and must be owner-only"
        );
    }

    #[tokio::test]
    async fn the_env_var_names_the_socket_that_was_bound() {
        let broker = Broker::bind(Arc::new(FakeSink::new())).expect("the broker binds");
        let (name, value) = broker
            .env_var()
            .expect("a UTF-8 socket path has an env var");
        assert_eq!(name, BROKER_SOCKET_ENV);
        assert_eq!(std::path::Path::new(&value), broker.socket_path());
    }

    #[tokio::test]
    async fn a_send_over_the_socket_reaches_the_sink_and_a_refusal_does_not() {
        let sink = Arc::new(FakeSink::new());
        let broker = Broker::bind(sink.clone()).expect("the broker binds");

        let served = ask(broker.socket_path(), &format!("{}\n", send_line(json!({})))).await;
        let served: Value = serde_json::from_str(served.trim()).expect("the response is JSON");
        assert_eq!(served, json!({ "ok": true, "event_id": EVENT_ID }));

        let refused = ask(broker.socket_path(), "{\"op\":\"get_key\"}\n").await;
        let refused: Value = serde_json::from_str(refused.trim()).expect("the response is JSON");
        assert_eq!(refused["error"], json!("refused_identity_disclosure"));

        assert_eq!(
            sink.seen().len(),
            1,
            "only the send may reach the thing that can sign"
        );
    }

    #[tokio::test]
    async fn a_request_past_the_size_limit_is_refused_without_reaching_the_sink() {
        let sink = Arc::new(FakeSink::new());
        let broker = Broker::bind(sink.clone()).expect("the broker binds");
        // Exactly the cap, with no newline: the reader fills its budget and
        // still has no request, which is the shape a rogue client produces.
        let oversized = "a".repeat(MAX_REQUEST_BYTES);
        let response = ask(broker.socket_path(), &oversized).await;
        let response: Value = serde_json::from_str(response.trim()).expect("the response is JSON");
        assert_eq!(response["error"], json!("too_large"));
        assert!(sink.seen().is_empty(), "an oversized line must not be sent");
    }

    #[tokio::test]
    async fn no_two_brokers_ever_want_the_same_path() {
        // This is why a socket left behind by a crashed harness can never be in
        // a new harness's way: the new one binds somewhere else entirely, and
        // never has to decide whether a path it found is safe to take over.
        let first = Broker::bind(Arc::new(FakeSink::new())).expect("the first broker binds");
        let second = Broker::bind(Arc::new(FakeSink::new())).expect("the second broker binds");
        assert_ne!(
            first.socket_path(),
            second.socket_path(),
            "two brokers must not share a socket path"
        );
        assert_ne!(
            first.socket_path().parent(),
            second.socket_path().parent(),
            "nor the directory that protects it"
        );
    }

    #[tokio::test]
    async fn dropping_the_broker_removes_the_socket_and_the_directory_it_made() {
        let broker = Broker::bind(Arc::new(FakeSink::new())).expect("the broker binds");
        let socket = broker.socket_path().to_path_buf();
        let directory = socket
            .parent()
            .expect("the socket has a directory")
            .to_path_buf();
        assert!(socket.exists(), "the socket exists while the broker runs");

        drop(broker);

        assert!(!socket.exists(), "a clean exit leaves no socket behind");
        assert!(!directory.exists(), "nor the directory it created for it");
    }
}
