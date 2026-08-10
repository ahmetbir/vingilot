//! The case that actually failed: an agent whose shell carries **no** Buzz
//! environment sends a message, and it lands.
//!
//! Every other test of this path drives `run_without_key` in-process, where the
//! environment is whatever the test runner inherited. That is not the failure.
//! The failure is a harness — Hermes, Kimi — that runs each tool command in a
//! sanitised environment, so `BUZZ_PRIVATE_KEY`, `BUZZ_RELAY_URL` and
//! `BUZZ_AUTH_TAG` all arrive empty and nothing set outside the harness reaches
//! inside it. Every reply died there with `auth_error`, exit 3.
//!
//! So this runs the real `buzz` binary with [`Command::env_clear`]: not a
//! cleared `BUZZ_*` prefix, the whole environment, which is stricter than any
//! sanitiser the owner has hit. The only thing the invocation carries is the
//! socket path on its command line, which is what the `[Tools]` section of the
//! agent's prompt now tells it to do (`buzz_acp::pool::broker_note`).
//!
//! The listener here stands in for the harness. It is not the harness's broker
//! — the two crates share a wire format and not a type, deliberately, so that
//! neither depends on the other — so [`WIRE_REQUEST`] pins the line that
//! crosses between them. The same literal is parsed by the real broker in
//! `crates/buzz-acp/src/broker/tests.rs`, which is what keeps one end from
//! drifting away from the other while both stay green.

#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::process::Command;
use std::sync::mpsc;

use serde_json::Value;

/// The channel the reply goes to, and the words in it. Fixed, because they are
/// half of the wire line pinned below.
const CHANNEL: &str = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const CONTENT: &str = "@Ahmet the run finished; PR is up.";

/// The event id the stand-in harness reports back. A message that landed has
/// an id; that is the whole difference between a reply and a silence.
const EVENT_ID: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

/// Exactly what the CLI writes to the socket for the send above.
///
/// **Copied verbatim into `crates/buzz-acp/src/broker/tests.rs`**, where the
/// real broker parses it. Compared as parsed JSON rather than as bytes, so key
/// order is not part of the contract — every field name and value is.
const WIRE_REQUEST: &str = r#"{
  "op": "send_message",
  "channel": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "content": "@Ahmet the run finished; PR is up.",
  "reply_to": null,
  "mentions": [],
  "broadcast": false
}"#;

/// A stand-in harness: answers one request, and reports what it was asked.
struct StandInHarness {
    _dir: tempfile::TempDir,
    socket: PathBuf,
    asked: mpsc::Receiver<String>,
    server: Option<std::thread::JoinHandle<()>>,
}

impl StandInHarness {
    fn listening() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let socket = dir.path().join("s");
        let listener = UnixListener::bind(&socket).expect("bind");
        let (tx, asked) = mpsc::channel();
        let server = std::thread::spawn(move || {
            let Ok((stream, _)) = listener.accept() else {
                return;
            };
            let mut line = String::new();
            if BufReader::new(&stream).read_line(&mut line).is_err() {
                return;
            }
            let _ = tx.send(line);
            let mut writer = &stream;
            let _ = writeln!(writer, r#"{{"ok":true,"event_id":"{EVENT_ID}"}}"#);
            let _ = writer.flush();
        });
        Self {
            _dir: dir,
            socket,
            asked,
            server: Some(server),
        }
    }

    /// What the harness was handed, or `None` if it was never connected to.
    fn asked(&self) -> Option<Value> {
        self.asked
            .try_recv()
            .ok()
            .map(|line| serde_json::from_str(line.trim()).expect("the request is one JSON line"))
    }
}

impl Drop for StandInHarness {
    fn drop(&mut self) {
        // Unblock a server still waiting on accept(), then join it, so no
        // thread outlives the temp directory holding the socket it reads.
        if self.server.is_some() {
            let _ = std::os::unix::net::UnixStream::connect(&self.socket);
        }
        if let Some(server) = self.server.take() {
            let _ = server.join();
        }
    }
}

/// Run the real binary with **nothing** in its environment.
///
/// `env_clear` and no `env` call after it: no `PATH`, no `HOME`, no `BUZZ_*`.
/// A sanitising harness leaves more than this, so anything that passes here
/// passes there.
fn buzz_in_a_stripped_shell(args: &[&str]) -> std::process::Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_buzz"));
    command.env_clear().args(args);
    command.output().expect("the buzz binary runs")
}

#[test]
fn a_shell_with_no_buzz_environment_still_gets_the_reply_out() {
    let harness = StandInHarness::listening();

    // `--broker-socket` is a global flag, so it precedes the subcommand — the
    // same order the agent's [Tools] note gives, and a usage error in any other.
    let output = buzz_in_a_stripped_shell(&[
        "--broker-socket",
        harness.socket.to_str().expect("utf-8 socket path"),
        "messages",
        "send",
        "--channel",
        CHANNEL,
        "--content",
        CONTENT,
    ]);

    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success(),
        "the reply must land in a shell that carries nothing: exit {:?}, stderr: {stderr}",
        output.status.code()
    );

    let printed: Value = serde_json::from_slice(&output.stdout).expect("stdout is one JSON object");
    assert_eq!(
        printed["event_id"], EVENT_ID,
        "the caller is told the id of what was sent, as on the keyed path"
    );
    assert_eq!(printed["accepted"], Value::Bool(true));

    let asked = harness
        .asked()
        .expect("the harness must have been asked to send");
    assert_eq!(
        asked,
        serde_json::from_str::<Value>(WIRE_REQUEST).expect("the pinned line is JSON"),
        "the line the CLI writes is the contract the harness broker parses"
    );
}

#[test]
fn the_same_shell_without_a_socket_fails_without_teaching_the_wrong_lesson() {
    // The other half of the case: nothing named, nothing to ask. It must fail
    // as it always did — exit 3 — and it must not send the agent looking for a
    // key, which is how a key-shaped value reached a command line once already.
    let output = buzz_in_a_stripped_shell(&[
        "messages",
        "send",
        "--channel",
        CHANNEL,
        "--content",
        CONTENT,
    ]);

    assert_eq!(
        output.status.code(),
        Some(3),
        "an unbrokered keyless send is still an auth failure, with the exit code it always had"
    );
    let said = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        !said.contains("--private-key"),
        "no failure may suggest putting a key on a command line: {said}"
    );
    assert!(
        said.contains("BUZZ_BROKER_SOCKET") && said.contains("--broker-socket"),
        "it must say the broker was not offered either, and by both its names: {said}"
    );
}
