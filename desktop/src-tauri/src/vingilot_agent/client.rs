//! One agent subprocess, one session, one turn, over ACP on stdio.
//!
//! This is the same protocol `crates/buzz-acp` speaks — JSON-RPC 2.0 as
//! newline-delimited JSON over the agent's stdin/stdout: `initialize`, then
//! `session/new` carrying the directory to work in, then `session/prompt`,
//! with `session/update` notifications and `session/request_permission`
//! requests arriving from the agent while a turn is in flight. It is written
//! here rather than reused because `buzz-acp` is a relay harness: its client
//! is wired to a Nostr identity, a channel queue, an observer and a usage
//! tracker, none of which exist inside the desktop app, and none of which a
//! worktree's turn wants.
//!
//! **Blocking, on purpose.** `buzz-acp` is tokio all the way down. Here the
//! caller is a Tauri command, and the module it lives beside already has the
//! answer for that: run it on `spawn_blocking` and keep the webview's thread
//! free (`vingilot_worktree::off_thread`). So this uses `std::process` and one
//! reader thread per stream, and the only asynchrony is
//! `Receiver::recv_timeout`, which is what bounds a silent agent.
//!
//! **Every wait is bounded.** A handshake that never answers, an agent that
//! goes quiet mid-turn, and an agent that streams forever each have their own
//! deadline. Without them a wedged adapter would hold a blocking thread for
//! the life of the app, and the owner's only recovery would be quitting it.
//!
//! **What this does not claim.** The agent is spawned as an ordinary child
//! process of this app, with this app's environment, this app's credentials,
//! and the worktree as its working directory. The worktree is where its edits
//! are *expected* to land — it is a collision boundary, so two agents do not
//! overwrite each other, and nothing more (ADR-003). Nothing here confines the
//! agent to it, and no copy in this feature may say otherwise.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use crate::vingilot_agent::config::AgentCommand;
use crate::vingilot_agent::trace::{
    absorb, summarise_update, TraceEntry, TraceKind, MAX_TRACE_CHARS, MAX_TRACE_ENTRIES,
};

/// The longest single NDJSON line this client will assemble from an agent.
/// Same order as `crates/buzz-acp`'s `MAX_LINE_SIZE`, and for the same reason:
/// an agent that writes without newlines must not be able to exhaust memory.
const MAX_LINE_BYTES: usize = 10_000_000;

/// How much of the agent's own stderr travels back with an outcome. Enough to
/// carry a stack trace or an auth error, bounded so a chatty adapter cannot
/// turn one turn into a megabyte of IPC.
const MAX_STDERR_BYTES: usize = 16_384;

/// Lines held between the reader thread and the turn. Bounded, so an agent
/// that outruns this client is slowed by its own full pipe rather than by
/// this process growing without limit.
const LINE_QUEUE: usize = 64;

/// The three waits a turn can be stuck in.
///
/// Defaults: a handshake is two round trips against a process that has just
/// started, so a minute is already generous. `idle` is silence *during* a
/// turn, which is the one that catches a wedged agent — an adapter streams
/// `session/update` while it thinks, so five minutes of nothing at all means
/// nothing is coming. `turn` is the absolute cap for an agent that stays
/// talkative but never finishes.
#[derive(Clone, Copy, Debug)]
pub struct Deadlines {
    pub handshake: Duration,
    pub idle: Duration,
    pub turn: Duration,
}

impl Default for Deadlines {
    fn default() -> Self {
        Self {
            handshake: Duration::from_secs(60),
            idle: Duration::from_secs(300),
            turn: Duration::from_secs(1800),
        }
    }
}

/// The two clocks one request runs under: silence since the last line, and an
/// absolute end. Carried together so no call site can bound one and forget the
/// other — an idle-only bound lets a chatty agent run forever, and a hard-only
/// bound makes a wedged one hold a thread for the whole budget.
#[derive(Clone, Copy, Debug)]
struct Wait {
    phase: &'static str,
    idle: Duration,
    hard: Instant,
    /// What `hard` was built from, so a timeout can say how long it waited.
    budget: Duration,
}

impl Wait {
    fn new(phase: &'static str, idle: Duration, budget: Duration) -> Self {
        Self {
            budget,
            hard: Instant::now() + budget,
            idle: idle.min(budget),
            phase,
        }
    }
}

/// Why a turn did not produce an answer. Every variant is a sentence the panel
/// can show without a second lookup; `features/runs/lib/agentTurn.ts` owns the
/// wording.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum AgentError {
    /// The prompt was blank. Refused before anything is spawned.
    EmptyPrompt,
    /// No agent command is configured (see `config::Availability`).
    NotConfigured { variables: Vec<String> },
    /// A command is configured and nothing executable answers to it.
    Missing { program: String },
    /// The directory the turn was asked to run in is not there. Checked before
    /// the spawn: a missing cwd surfaces from `Command::spawn` as a bare
    /// "No such file or directory" that names the *program*, which sends the
    /// reader looking for the wrong problem.
    NoSuchDirectory { path: String },
    /// The process could not be started at all.
    Spawn { program: String, message: String },
    /// The agent said something this client cannot read as ACP.
    Protocol { message: String },
    /// The agent answered with a JSON-RPC error. Its own code and words.
    Refused { code: i64, message: String },
    /// Nothing arrived for `seconds`. `phase` is which wait it was, because
    /// silence during a handshake and silence mid-turn mean different things.
    Silent { phase: String, seconds: u64 },
    /// The turn ran past its absolute cap.
    TooLong { seconds: u64 },
    /// The agent's stdout closed before the turn finished. `message` carries
    /// what it wrote to stderr on the way out, which is usually the reason.
    Exited { message: String },
    /// The turn never ran: the blocking pool it was handed to could not run
    /// it, or dropped it. Distinct from every failure above, all of which are
    /// the agent's — this one is ours.
    Interrupted { message: String },
}

/// What a finished turn amounts to. The diff is deliberately not in here:
/// what the agent changed is read from git by `worktree_diff`, the same way
/// the owner's own changes are, so there is one answer about a worktree's
/// contents rather than two that can disagree.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurn {
    /// The id the agent gave its session. Reported so a transcript can be
    /// matched to the adapter's own logs.
    pub session_id: String,
    /// The agent's own `stopReason`, verbatim. Not mapped to an enum here:
    /// this client's job is to report what the agent said, and an unrecognised
    /// reason is information, not a parse failure.
    pub stop_reason: String,
    pub trace: Vec<TraceEntry>,
    /// How many entries were dropped for exceeding the trace cap.
    pub dropped: usize,
    /// The tail of what the agent wrote to stderr.
    pub stderr: String,
}

/// A running agent. Dropping it kills the process.
pub struct AcpAgent {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<Framed>,
    stderr: Arc<Mutex<String>>,
    next_id: u64,
    trace: Vec<TraceEntry>,
    dropped: usize,
}

/// What the reader thread hands over: one line, or the reason there are no
/// more.
#[derive(Clone, Debug, Eq, PartialEq)]
enum Framed {
    Line(String),
    /// A line longer than `MAX_LINE_BYTES`; `usize` is how much was discarded.
    TooLong(usize),
    /// The stream ended, or could not be read.
    End(Option<String>),
}

impl AcpAgent {
    /// Spawn the agent with `cwd` as its working directory.
    ///
    /// `cwd` is set on the process *and* sent in `session/new`. ACP carries
    /// the directory in the protocol, and adapters honour it — but an agent's
    /// tools resolve relative paths against the process it runs in, so a
    /// process started somewhere else is one `git status` away from reporting
    /// on the wrong repository.
    pub fn spawn(command: &AgentCommand, cwd: &Path) -> Result<Self, AgentError> {
        if !cwd.is_dir() {
            return Err(AgentError::NoSuchDirectory {
                path: cwd.to_string_lossy().into_owned(),
            });
        }
        let mut child = Command::new(&command.program)
            .args(&command.args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| AgentError::Spawn {
                message: error.to_string(),
                program: command.program.clone(),
            })?;

        // Both pipes are taken before anything is written: an agent that logs
        // to stderr during startup fills that pipe and blocks on it, and a
        // client that has not started draining would then deadlock waiting for
        // an `initialize` response the agent cannot get to.
        let missing = |stream: &str| AgentError::Spawn {
            message: format!("the agent was started without a {stream} pipe"),
            program: command.program.clone(),
        };
        let stdout = child.stdout.take().ok_or_else(|| missing("stdout"))?;
        let stderr_pipe = child.stderr.take().ok_or_else(|| missing("stderr"))?;
        let stdin = child.stdin.take().ok_or_else(|| missing("stdin"))?;

        let (sender, lines) = sync_channel(LINE_QUEUE);
        thread::spawn(move || read_lines(BufReader::new(stdout), &sender));

        let stderr = Arc::new(Mutex::new(String::new()));
        let sink = Arc::clone(&stderr);
        thread::spawn(move || drain_stderr(stderr_pipe, &sink));

        Ok(Self {
            child,
            dropped: 0,
            lines,
            next_id: 0,
            stderr,
            stdin,
            trace: Vec::new(),
        })
    }

    /// The handshake, the session, and one turn — the whole of what this
    /// client does with an agent.
    pub fn run_turn(
        &mut self,
        cwd: &Path,
        prompt: &str,
        deadlines: Deadlines,
    ) -> Result<AgentTurn, AgentError> {
        let handshake = Wait::new("handshake", deadlines.handshake, deadlines.handshake);
        self.request("initialize", initialize_params(), handshake)?;
        let session = self.request(
            "session/new",
            json!({ "cwd": cwd.to_string_lossy(), "mcpServers": [] }),
            Wait::new("handshake", deadlines.handshake, deadlines.handshake),
        )?;
        let session_id = session
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| AgentError::Protocol {
                message: "session/new answered without a sessionId".to_string(),
            })?
            .to_string();

        let answered = self.request(
            "session/prompt",
            json!({
                "sessionId": session_id,
                "prompt": [{ "type": "text", "text": prompt }],
            }),
            Wait::new("turn", deadlines.idle, deadlines.turn),
        )?;
        let stop_reason = answered
            .get("stopReason")
            .and_then(Value::as_str)
            .ok_or_else(|| AgentError::Protocol {
                message: "session/prompt answered without a stopReason".to_string(),
            })?
            .to_string();

        Ok(AgentTurn {
            dropped: self.dropped,
            session_id,
            stderr: self.stderr_tail(),
            stop_reason,
            trace: std::mem::take(&mut self.trace),
        })
    }

    /// Send one request and read until its answer, handling everything the
    /// agent says on the way.
    fn request(&mut self, method: &str, params: Value, wait: Wait) -> Result<Value, AgentError> {
        self.next_id += 1;
        let id = self.next_id;
        self.send(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))?;

        loop {
            let remaining = wait.hard.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(AgentError::TooLong {
                    seconds: wait.budget.as_secs(),
                });
            }
            let message = match self.lines.recv_timeout(wait.idle.min(remaining)) {
                Ok(Framed::Line(line)) => line,
                Ok(Framed::TooLong(bytes)) => {
                    return Err(AgentError::Protocol {
                        message: format!(
                            "the agent wrote a line longer than {MAX_LINE_BYTES} bytes ({bytes} discarded)"
                        ),
                    })
                }
                Ok(Framed::End(reason)) => return Err(self.exited(reason)),
                // The reader thread is gone without having said why — the same
                // situation, with less to say about it.
                Err(RecvTimeoutError::Disconnected) => return Err(self.exited(None)),
                Err(RecvTimeoutError::Timeout) => {
                    return Err(AgentError::Silent {
                        phase: wait.phase.to_string(),
                        seconds: wait.idle.as_secs(),
                    })
                }
            };
            // A line that is not JSON is an adapter logging to the wrong
            // stream. It is not this client's to fix, and it is not a reason
            // to abandon a turn that is otherwise going fine.
            let Ok(value) = serde_json::from_str::<Value>(&message) else {
                continue;
            };
            if let Some(answer) = self.dispatch(&value, id)? {
                return Ok(answer);
            }
        }
    }

    /// Read one message. `Ok(Some(_))` is the answer being waited for;
    /// `Ok(None)` means it was something else and was handled.
    fn dispatch(&mut self, value: &Value, expected: u64) -> Result<Option<Value>, AgentError> {
        // A `method` means the agent is asking, not answering — even when the
        // id happens to collide with the one being waited for.
        let method = value.get("method").and_then(Value::as_str);
        if method.is_none() && value.get("id") == Some(&json!(expected)) {
            if let Some(error) = value.get("error") {
                return Err(AgentError::Refused {
                    code: error.get("code").and_then(Value::as_i64).unwrap_or(-32000),
                    message: match error.get("message").and_then(Value::as_str) {
                        Some(message) => message.to_string(),
                        None => error.to_string(),
                    },
                });
            }
            return Ok(Some(value.get("result").cloned().unwrap_or(Value::Null)));
        }
        let Some(method) = method else {
            // An answer to a request this client is no longer waiting for.
            return Ok(None);
        };
        match method {
            "session/update" => {
                if let Some(entry) = summarise_update(value) {
                    self.record(entry);
                }
            }
            "session/request_permission" => self.grant(value)?,
            _ => {
                // Silence would hang an agent waiting for a reply. Same
                // -32601 `crates/buzz-acp` answers with.
                if let Some(id) = value.get("id") {
                    self.send(&json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32601, "message": format!("Method not found: {method}") },
                    }))?;
                }
            }
        }
        Ok(None)
    }

    /// Approve a permission request with its `allow_once` option.
    ///
    /// **This is a decision, not a safety property.** The owner asked for an
    /// agent to work in this worktree; stopping at every tool call to ask
    /// again would make that impossible, and there is no UI here to ask in.
    /// So it is granted — and every grant is written into the trace, which is
    /// the part that matters: the transcript shows what was allowed, in order,
    /// rather than the run being quietly permissive. The worktree does not
    /// bound what an approved tool can reach (ADR-003).
    ///
    /// The option id is looked up by `kind`, never hardcoded: adapters mint
    /// their own ids, and guessing one grants nothing.
    fn grant(&mut self, value: &Value) -> Result<(), AgentError> {
        let Some(id) = value.get("id").cloned() else {
            return Err(AgentError::Protocol {
                message: "a permission request arrived without an id".to_string(),
            });
        };
        let options = value.pointer("/params/options").and_then(Value::as_array);
        let Some(chosen) = options.and_then(|options| pick_permission(options)) else {
            return Err(AgentError::Protocol {
                message: "a permission request offered no option this client could take"
                    .to_string(),
            });
        };
        self.record(TraceEntry {
            kind: TraceKind::Permission,
            text: format!("granted {}", chosen.label),
        });
        self.send(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "outcome": { "outcome": "selected", "optionId": chosen.option_id } },
        }))
    }

    fn record(&mut self, entry: TraceEntry) {
        if !absorb(&mut self.trace, entry, MAX_TRACE_ENTRIES, MAX_TRACE_CHARS) {
            self.dropped += 1;
        }
    }

    fn send(&mut self, value: &Value) -> Result<(), AgentError> {
        let line = serde_json::to_string(value).map_err(|error| AgentError::Protocol {
            message: error.to_string(),
        })?;
        let written = self
            .stdin
            .write_all(line.as_bytes())
            .and_then(|()| self.stdin.write_all(b"\n"))
            .and_then(|()| self.stdin.flush());
        // A closed stdin means the agent is gone; its stderr says why, and
        // that is a better answer than "broken pipe".
        match written {
            Ok(()) => Ok(()),
            Err(_) => Err(self.exited(None)),
        }
    }

    /// The agent is not there any more, said as well as it can be said.
    fn exited(&mut self, reason: Option<String>) -> AgentError {
        let tail = self.stderr_tail();
        let status = match self.child.try_wait() {
            Ok(Some(status)) => format!("the agent exited ({status})"),
            _ => "the agent stopped answering".to_string(),
        };
        let detail = [reason.unwrap_or_default(), tail]
            .into_iter()
            .filter(|part| !part.trim().is_empty())
            .collect::<Vec<_>>()
            .join(" — ");
        AgentError::Exited {
            message: if detail.is_empty() {
                status
            } else {
                format!("{status}: {detail}")
            },
        }
    }

    fn stderr_tail(&self) -> String {
        match self.stderr.lock() {
            Ok(text) => text.clone(),
            // A poisoned lock means the draining thread panicked. The turn's
            // own outcome is still worth reporting; its stderr is not.
            Err(_) => String::new(),
        }
    }
}

impl Drop for AcpAgent {
    /// The agent does not outlive the turn it was spawned for.
    ///
    /// `kill` reaches this child and no further: an adapter that started MCP
    /// servers of its own is on its own to end them. Reaching further means
    /// signalling a process group, and the only way to do that from Rust is an
    /// `unsafe` libc call, which this codebase does not permit.
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The `initialize` parameters. `fs` is declared false in both directions
/// because this client serves no file operations — an adapter that reads that
/// uses its own tools, which is what makes the edits land in the worktree the
/// process is running in.
fn initialize_params() -> Value {
    json!({
        "protocolVersion": 2,
        "clientCapabilities": {
            "fs": { "readTextFile": false, "writeTextFile": false },
            "terminal": false,
        },
        "clientInfo": { "name": "vingilot-workspace", "version": env!("CARGO_PKG_VERSION") },
    })
}

/// The permission option this client will take, and what to call it in the
/// transcript.
struct Permission {
    option_id: String,
    label: String,
}

/// Prefer `allow_once`. Fall back to `reject_once` rather than inventing an
/// answer: an agent waiting on a permission it was never given a verdict on
/// hangs until the idle deadline, and a refusal it can act on is better than
/// five minutes of nothing.
fn pick_permission(options: &[Value]) -> Option<Permission> {
    let by_kind = |wanted: &str| {
        options
            .iter()
            .find(|option| option.get("kind").and_then(Value::as_str) == Some(wanted))
    };
    let chosen = by_kind("allow_once").or_else(|| by_kind("reject_once"))?;
    let option_id = chosen.get("optionId").and_then(Value::as_str)?.to_string();
    let name = chosen
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(&option_id)
        .to_string();
    Some(Permission {
        label: name,
        option_id,
    })
}

/// Feed every line of the agent's stdout to the turn, then say why they
/// stopped. Ends when the receiver is dropped, so a turn that gives up does
/// not leave a thread reading forever.
fn read_lines<R: BufRead>(mut reader: R, sender: &SyncSender<Framed>) {
    loop {
        let framed = read_line_capped(&mut reader, MAX_LINE_BYTES);
        let last = !matches!(framed, Framed::Line(_));
        if sender.send(framed).is_err() || last {
            return;
        }
    }
}

/// One line, or the reason there is not one, without ever holding more than
/// `cap` bytes of it.
///
/// `read_line` would allocate whatever an agent sends before this could
/// object, which is the whole thing being defended against. So the buffer is
/// consumed a chunk at a time and stops growing at the cap while the rest of
/// the line is read and discarded — discarded, because the alternative is
/// treating the remainder as the next message, and a truncated line is not
/// JSON this client should try to make sense of.
fn read_line_capped<R: BufRead>(reader: &mut R, cap: usize) -> Framed {
    let mut line: Vec<u8> = Vec::new();
    let mut discarded = 0usize;
    loop {
        let chunk = match reader.fill_buf() {
            Ok(chunk) => chunk,
            Err(error) => return Framed::End(Some(error.to_string())),
        };
        if chunk.is_empty() {
            return match (line.is_empty(), discarded) {
                (true, 0) => Framed::End(None),
                (_, 0) => Framed::Line(String::from_utf8_lossy(&line).into_owned()),
                _ => Framed::TooLong(discarded),
            };
        }
        let (taken, done) = match chunk.iter().position(|byte| *byte == b'\n') {
            Some(at) => (at + 1, true),
            None => (chunk.len(), false),
        };
        let body = &chunk[..if done { taken - 1 } else { taken }];
        let room = cap.saturating_sub(line.len());
        line.extend_from_slice(&body[..room.min(body.len())]);
        discarded += body.len().saturating_sub(room);
        reader.consume(taken);
        if done {
            return if discarded > 0 {
                Framed::TooLong(discarded)
            } else {
                Framed::Line(String::from_utf8_lossy(&line).into_owned())
            };
        }
    }
}

/// Keep the tail of the agent's stderr. The tail rather than the head: the
/// reason an adapter failed is the last thing it says, not the first.
fn drain_stderr<R: Read>(stream: R, sink: &Mutex<String>) {
    let mut reader = BufReader::new(stream);
    let mut buffer = [0u8; 4096];
    loop {
        let read = match reader.read(&mut buffer) {
            Ok(0) | Err(_) => return,
            Ok(read) => read,
        };
        let Ok(mut held) = sink.lock() else { return };
        held.push_str(&String::from_utf8_lossy(&buffer[..read]));
        if held.len() > MAX_STDERR_BYTES {
            let keep = held
                .char_indices()
                .nth(held.chars().count().saturating_sub(MAX_STDERR_BYTES / 2))
                .map(|(at, _)| at)
                .unwrap_or(0);
            *held = held[keep..].to_string();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_is_read_up_to_its_newline() {
        let mut reader = &b"{\"a\":1}\n{\"b\":2}\n"[..];
        assert_eq!(
            read_line_capped(&mut reader, 100),
            Framed::Line("{\"a\":1}".to_string())
        );
        assert_eq!(
            read_line_capped(&mut reader, 100),
            Framed::Line("{\"b\":2}".to_string())
        );
        assert_eq!(read_line_capped(&mut reader, 100), Framed::End(None));
    }

    #[test]
    fn a_last_line_without_a_newline_is_still_a_line() {
        let mut reader = &b"tail"[..];
        assert_eq!(
            read_line_capped(&mut reader, 100),
            Framed::Line("tail".to_string())
        );
        assert_eq!(read_line_capped(&mut reader, 100), Framed::End(None));
    }

    #[test]
    fn an_empty_line_is_a_line_and_not_the_end_of_the_stream() {
        // The difference matters: treating a blank line as EOF would abandon
        // a turn over an adapter's stray newline.
        let mut reader = &b"\n{}\n"[..];
        assert_eq!(
            read_line_capped(&mut reader, 100),
            Framed::Line(String::new())
        );
        assert_eq!(
            read_line_capped(&mut reader, 100),
            Framed::Line("{}".to_string())
        );
    }

    #[test]
    fn a_line_past_the_cap_is_refused_rather_than_held() {
        let mut reader = &b"aaaaaaaaaa\nok\n"[..];
        assert_eq!(read_line_capped(&mut reader, 4), Framed::TooLong(6));
        // The line after an over-long one is still read: the cap drops one
        // message, not the rest of the conversation.
        assert_eq!(
            read_line_capped(&mut reader, 4),
            Framed::Line("ok".to_string())
        );
    }

    #[test]
    fn an_unterminated_line_past_the_cap_is_refused_at_the_end_too() {
        let mut reader = &b"aaaaaaaaaa"[..];
        assert_eq!(read_line_capped(&mut reader, 4), Framed::TooLong(6));
    }
    #[test]
    fn the_permission_taken_is_the_one_that_allows() {
        let options = vec![
            json!({ "kind": "reject_once", "optionId": "n", "name": "No" }),
            json!({ "kind": "allow_once", "optionId": "y", "name": "Allow once" }),
        ];
        let picked = pick_permission(&options);
        assert_eq!(picked.as_ref().map(|p| p.option_id.as_str()), Some("y"));
        assert_eq!(picked.map(|p| p.label), Some("Allow once".to_string()));
    }

    #[test]
    fn an_option_id_is_never_guessed() {
        // Adapters mint their own ids; "allow_once" is the *kind*, and
        // answering with it as the id grants nothing and hangs the agent.
        let options = vec![json!({ "kind": "allow_once", "optionId": "opt-91" })];
        assert_eq!(
            pick_permission(&options).map(|p| p.option_id),
            Some("opt-91".to_string())
        );
    }

    #[test]
    fn a_request_offering_only_a_refusal_is_refused_rather_than_ignored() {
        let options = vec![json!({ "kind": "reject_once", "optionId": "n" })];
        assert_eq!(
            pick_permission(&options).map(|p| p.option_id),
            Some("n".to_string())
        );
    }

    #[test]
    fn a_request_offering_nothing_this_client_understands_is_not_answered() {
        let options = vec![json!({ "kind": "allow_always" })];
        assert!(pick_permission(&options).is_none());
        assert!(pick_permission(&[]).is_none());
    }

    #[test]
    fn the_handshake_asks_for_the_protocol_the_harness_asks_for() {
        let params = initialize_params();
        assert_eq!(params["protocolVersion"].as_u64(), Some(2));
        assert_eq!(
            params["clientCapabilities"]["fs"]["writeTextFile"].as_bool(),
            Some(false)
        );
    }

    #[test]
    fn a_failure_serialises_as_the_kind_the_panel_switches_on() {
        let json = serde_json::to_string(&AgentError::Silent {
            phase: "turn".to_string(),
            seconds: 300,
        })
        .unwrap_or_default();
        assert_eq!(json, r#"{"kind":"silent","phase":"turn","seconds":300}"#);
    }

    #[test]
    fn stderr_is_kept_to_its_tail() {
        let sink = Mutex::new(String::new());
        let noise = "x".repeat(MAX_STDERR_BYTES * 2);
        let stream = format!("{noise}the reason");
        drain_stderr(stream.as_bytes(), &sink);
        let held = sink.lock().map(|held| held.clone()).unwrap_or_default();
        assert!(held.len() <= MAX_STDERR_BYTES);
        assert!(held.ends_with("the reason"));
    }
}
