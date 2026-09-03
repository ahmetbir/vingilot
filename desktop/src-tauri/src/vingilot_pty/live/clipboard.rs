//! 8. the clipboard: what tmux announces when something inside it copies.
//!
//! A submodule of `live` on the same terms as `wheel.rs`: the parent's
//! isolated socket, its one-at-a-time `live_lock`, and its harness driving the
//! app's own `pty_open`. Everything private there is in scope through
//! `use super::*`.
//!
//! **What is proved.** The owner reported ⌘C copying nothing. The diagnosis
//! (`osc52.ts`) is that tmux carries every copy — its own drag-end and any
//! program's — to the terminal as an OSC 52 sequence, and the app's xterm had
//! no handler for it. The half that is tmux's is asserted here: the bytes the
//! app's client actually receives contain the sequence, with the copied text
//! inside it. The half that is xterm's is `tests/e2e/terminal-clipboard.spec.ts`.
//!
//! Two doors, because they are different tmux options. A program printing
//! OSC 52 itself is passed through under the default `set-clipboard external`.
//! tmux's OWN copy — the drag-end the owner performs — is only announced under
//! `set-clipboard on`, which is a server option this app must not set (the
//! server is shared with his own sessions; `tmux.rs`'s guard). His ~/.tmux.conf
//! sets it, and the second test sets it on the isolated socket for the same
//! effect. Stated so that a machine without that line is understood, not
//! debugged: on it, the first door works and the second does not.

use super::*;

/// "Hello" — small enough to spot in a stream, and what `osc52.test.mjs`
/// decodes on the other side.
const HELLO_B64: &str = "SGVsbG8=";

/// The introducer tmux uses. It may finish with BEL or ST, so only the head
/// and the payload are asserted, never the terminator.
const OSC52_HEAD: &str = "\x1b]52;";

/// Everything the client has heard after `from` bytes of it.
fn heard_since(harness: &Harness, id: &str, from: usize) -> String {
    let all = harness.stream(id);
    all.char_indices()
        .find(|(at, _)| *at >= from)
        .map_or(String::new(), |(at, _)| all[at..].to_string())
}

fn osc52_arrived_within(
    harness: &Harness,
    id: &str,
    from: usize,
    payload: &str,
    limit: Duration,
) -> bool {
    let deadline = Instant::now() + limit;
    loop {
        let since = heard_since(harness, id, from);
        if let Some(at) = since.find(OSC52_HEAD) {
            if since[at..].contains(payload) {
                return true;
            }
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(POLL);
    }
}

#[test]
fn a_program_that_copies_is_heard_by_the_client_as_osc_52() {
    let _live = live_lock();
    isolated_tmux_socket();

    if tmux::path().is_none() {
        eprintln!(
            "SKIPPED a_program_that_copies_is_heard_by_the_client_as_osc_52: \
             no tmux on this machine, so there is nothing to carry the sequence."
        );
        return;
    }

    let mut repo = LiveRepo::new();
    let worktree = repo.worktree("clipboard");
    let harness = Harness::new();
    let id = live_id("clipboard");

    harness.open(&id, &worktree);
    harness.settle(&id);
    let from = harness.stream(&id).len();

    // A program inside the pane copying "Hello", followed by a marker so the
    // wait has a printable thing to look for.
    let marker = format!("VINGILOT-OSC52-{}", std::process::id());
    harness.ask(
        &id,
        &format!("printf '\\033]52;c;{HELLO_B64}\\a'; echo {marker}\n"),
        &marker,
    );

    assert!(
        osc52_arrived_within(&harness, &id, from, HELLO_B64, Duration::from_secs(3)),
        "tmux did not pass the program's OSC 52 out to the client. Heard since the \
         prompt: {}",
        tail(&heard_since(&harness, &id, from)).escape_debug()
    );

    harness.close(&id);
}

#[test]
fn tmuxs_own_copy_is_announced_when_set_clipboard_is_on() {
    let _live = live_lock();
    isolated_tmux_socket();

    if tmux::path().is_none() {
        eprintln!("SKIPPED tmuxs_own_copy_is_announced_when_set_clipboard_is_on: no tmux.");
        return;
    }

    let mut repo = LiveRepo::new();
    let worktree = repo.worktree("clipboard-on");
    let harness = Harness::new();
    let id = live_id("clipboard-on");

    harness.open(&id, &worktree);
    // `open` returns before the spawned tmux has a server to talk to;
    // `settle` waits for the pane to answer, and only then is the socket
    // there to set an option on.
    harness.settle(&id);
    // The owner's line, on the ISOLATED socket only — `tmux_says` addresses
    // the test server by path, so this reaches none of his sessions.
    tmux_says(&["set-option", "-s", "set-clipboard", "on"]);
    assert_eq!(
        tmux_says(&["show-options", "-s", "-v", "set-clipboard"]),
        "on",
        "the test server did not take the option"
    );

    // Something on screen to select.
    let marker = format!("VINGILOT-COPY-{}", std::process::id());
    harness.ask(&id, &format!("echo {marker}\n"), &marker);
    let from = harness.stream(&id).len();

    // What a drag does, spelled out: copy-mode, a selection, and the drag-end's
    // own binding. Targets are anchored exactly as `mouse_on_args` anchors.
    let target = format!("={}:", tmux::session_name(&id));
    tmux_says(&["copy-mode", "-t", &target]);
    // Up one line from the prompt onto the echoed marker, select it, copy.
    tmux_says(&["send-keys", "-t", &target, "-X", "cursor-up"]);
    tmux_says(&["send-keys", "-t", &target, "-X", "select-line"]);
    tmux_says(&[
        "send-keys",
        "-t",
        &target,
        "-X",
        "copy-selection-and-cancel",
    ]);

    // The payload is base64 of whatever line was selected; the marker is in
    // it, so its base64 is a substring only if alignment cooperates. Decode
    // instead: find the sequence, decode its payload, look for the marker.
    let deadline = Instant::now() + Duration::from_secs(3);
    let copied = loop {
        let since = heard_since(&harness, &id, from);
        if let Some(at) = since.find(OSC52_HEAD) {
            let body = &since[at + OSC52_HEAD.len()..];
            let payload: String = body
                .split(';')
                .nth(1)
                .unwrap_or("")
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '+' || *c == '/' || *c == '=')
                .collect();
            if let Ok(bytes) = base64_decode(&payload) {
                let text = String::from_utf8_lossy(&bytes).to_string();
                if text.contains(&marker) {
                    break Some(text);
                }
            }
        }
        if Instant::now() >= deadline {
            break None;
        }
        std::thread::sleep(POLL);
    };
    assert!(
        copied.is_some(),
        "tmux copied a selection but announced nothing the client could put on \
         the pasteboard. Heard since the marker: {}",
        tail(&heard_since(&harness, &id, from)).escape_debug()
    );

    harness.close(&id);
}

/// Standard base64, no padding tolerance games: what tmux emits is padded.
fn base64_decode(s: &str) -> Result<Vec<u8>, ()> {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut buf = 0u32;
    let mut bits = 0;
    for c in s.bytes() {
        if c == b'=' {
            break;
        }
        let v = T.iter().position(|t| *t == c).ok_or(())? as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}
