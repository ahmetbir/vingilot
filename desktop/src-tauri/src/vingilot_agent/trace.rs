//! A turn's transcript: what the agent said, in the order it said it.
//!
//! Separated from `client.rs` because it is the one part of a turn with no
//! process in it — `summarise_update` reads a notification, `absorb` decides
//! whether a line continues the last one, and neither needs a pipe, a
//! deadline, or a child. That makes the whole of it testable against literal
//! JSON, which is where the shapes an adapter actually sends get pinned.

use serde::Serialize;
use serde_json::Value;

/// How many trace entries one turn reports, and how long one entry may grow.
/// A turn that produced more than this is reported as truncated rather than
/// silently shortened.
pub(crate) const MAX_TRACE_ENTRIES: usize = 200;
pub(crate) const MAX_TRACE_CHARS: usize = 4_000;

/// What one entry of a turn's transcript is. The agent's own words, sorted
/// only enough that the panel can style them apart.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TraceKind {
    /// Text the agent addressed to the reader.
    Message,
    /// Text the agent addressed to itself.
    Thought,
    /// A tool the agent ran, or an update to one it is running.
    ToolCall,
    /// A permission this client granted on the owner's behalf.
    Permission,
    /// The agent's plan for the turn.
    Plan,
}

/// One line of a turn's transcript.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct TraceEntry {
    pub kind: TraceKind,
    pub text: String,
}

/// Read one `session/update` as a transcript entry, or nothing when it carries
/// no text worth showing.
pub fn summarise_update(value: &Value) -> Option<TraceEntry> {
    let update = value.pointer("/params/update")?;
    let kind = update.get("sessionUpdate").and_then(Value::as_str)?;
    let text = |pointer: &str| {
        update
            .pointer(pointer)
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    match kind {
        "agent_message_chunk" => Some(TraceEntry {
            kind: TraceKind::Message,
            text: text("/content/text")?,
        }),
        "agent_thought_chunk" => Some(TraceEntry {
            kind: TraceKind::Thought,
            text: text("/content/text")?,
        }),
        "tool_call" | "tool_call_update" => {
            let title = text("/title")
                .or_else(|| text("/rawInput/command"))
                .or_else(|| text("/toolCallId"))?;
            let status = text("/status").unwrap_or_else(|| "started".to_string());
            Some(TraceEntry {
                kind: TraceKind::ToolCall,
                text: format!("{title} [{status}]"),
            })
        }
        "plan" => Some(TraceEntry {
            kind: TraceKind::Plan,
            text: plan_text(update)?,
        }),
        // A `user_message_chunk` is this client's own prompt echoed back; the
        // panel already shows it, and repeating it reads as a second turn.
        "user_message_chunk" => None,
        _ => None,
    }
}

/// A plan as its entry titles, one per line.
fn plan_text(update: &Value) -> Option<String> {
    let entries = update.get("entries")?.as_array()?;
    let lines: Vec<String> = entries
        .iter()
        .filter_map(|entry| entry.get("content").and_then(Value::as_str))
        .map(str::to_string)
        .collect();
    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

/// Add an entry to a transcript, merging it into the previous one when it
/// continues it. Returns false when the entry did not fit.
///
/// The merge is what makes a transcript readable: an agent streams a sentence
/// as a dozen `agent_message_chunk` updates, and a list with one word per row
/// is not a transcript. Only text kinds merge — two tool calls in a row are
/// two tool calls, however alike they look.
pub fn absorb(
    trace: &mut Vec<TraceEntry>,
    entry: TraceEntry,
    max_entries: usize,
    max_chars: usize,
) -> bool {
    let continues = matches!(entry.kind, TraceKind::Message | TraceKind::Thought);
    if continues {
        if let Some(last) = trace.last_mut() {
            if last.kind == entry.kind {
                if last.text.chars().count() >= max_chars {
                    return false;
                }
                last.text.push_str(&entry.text);
                return true;
            }
        }
    }
    if trace.len() >= max_entries {
        return false;
    }
    trace.push(entry);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    use serde_json::json;

    fn entry(kind: TraceKind, text: &str) -> TraceEntry {
        TraceEntry {
            kind,
            text: text.to_string(),
        }
    }

    #[test]
    fn a_message_chunk_becomes_the_agents_words() {
        let update = json!({
            "method": "session/update",
            "params": { "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": { "type": "text", "text": "hello" },
            }},
        });
        assert_eq!(
            summarise_update(&update),
            Some(entry(TraceKind::Message, "hello"))
        );
    }

    #[test]
    fn a_thought_is_kept_apart_from_a_message() {
        let update = json!({
            "params": { "update": {
                "sessionUpdate": "agent_thought_chunk",
                "content": { "text": "hmm" },
            }},
        });
        assert_eq!(
            summarise_update(&update),
            Some(entry(TraceKind::Thought, "hmm"))
        );
    }

    #[test]
    fn a_tool_call_is_named_and_carries_its_status() {
        let update = json!({
            "params": { "update": {
                "sessionUpdate": "tool_call",
                "title": "write greeter.py",
                "status": "in_progress",
            }},
        });
        assert_eq!(
            summarise_update(&update),
            Some(entry(TraceKind::ToolCall, "write greeter.py [in_progress]"))
        );
    }

    #[test]
    fn a_tool_call_without_a_title_falls_back_to_what_it_ran() {
        let update = json!({
            "params": { "update": {
                "sessionUpdate": "tool_call",
                "rawInput": { "command": "sed -i s/a/b/ x" },
            }},
        });
        assert_eq!(
            summarise_update(&update),
            Some(entry(TraceKind::ToolCall, "sed -i s/a/b/ x [started]"))
        );
    }

    #[test]
    fn a_plan_is_its_entries_one_per_line() {
        let update = json!({
            "params": { "update": {
                "sessionUpdate": "plan",
                "entries": [{ "content": "read it" }, { "content": "change it" }],
            }},
        });
        assert_eq!(
            summarise_update(&update),
            Some(entry(TraceKind::Plan, "read it\nchange it"))
        );
    }

    #[test]
    fn the_prompt_echoed_back_is_not_a_second_turn() {
        let update = json!({
            "params": { "update": {
                "sessionUpdate": "user_message_chunk",
                "content": { "text": "do the thing" },
            }},
        });
        assert_eq!(summarise_update(&update), None);
    }

    #[test]
    fn an_update_shape_this_client_does_not_know_is_not_an_error() {
        assert_eq!(summarise_update(&json!({ "params": {} })), None);
        assert_eq!(
            summarise_update(&json!({ "params": { "update": { "sessionUpdate": "new_thing" } } })),
            None
        );
    }

    #[test]
    fn streamed_chunks_of_one_sentence_read_as_one_sentence() {
        let mut trace = Vec::new();
        for chunk in ["it ", "is ", "done"] {
            assert!(absorb(
                &mut trace,
                entry(TraceKind::Message, chunk),
                10,
                100
            ));
        }
        assert_eq!(trace, vec![entry(TraceKind::Message, "it is done")]);
    }

    #[test]
    fn a_thought_does_not_continue_a_message() {
        let mut trace = Vec::new();
        absorb(&mut trace, entry(TraceKind::Message, "a"), 10, 100);
        absorb(&mut trace, entry(TraceKind::Thought, "b"), 10, 100);
        absorb(&mut trace, entry(TraceKind::Message, "c"), 10, 100);
        assert_eq!(trace.len(), 3);
    }

    #[test]
    fn two_tool_calls_in_a_row_stay_two_tool_calls() {
        let mut trace = Vec::new();
        absorb(&mut trace, entry(TraceKind::ToolCall, "x [ok]"), 10, 100);
        absorb(&mut trace, entry(TraceKind::ToolCall, "x [ok]"), 10, 100);
        assert_eq!(trace.len(), 2);
    }

    #[test]
    fn a_transcript_past_its_cap_reports_what_did_not_fit() {
        let mut trace = Vec::new();
        assert!(absorb(&mut trace, entry(TraceKind::ToolCall, "1"), 2, 100));
        assert!(absorb(&mut trace, entry(TraceKind::ToolCall, "2"), 2, 100));
        assert!(!absorb(&mut trace, entry(TraceKind::ToolCall, "3"), 2, 100));
        assert_eq!(trace.len(), 2);
    }

    #[test]
    fn one_entry_stops_growing_rather_than_holding_a_whole_turn() {
        let mut trace = Vec::new();
        absorb(&mut trace, entry(TraceKind::Message, "abcde"), 10, 4);
        assert!(!absorb(&mut trace, entry(TraceKind::Message, "f"), 10, 4));
        assert_eq!(trace, vec![entry(TraceKind::Message, "abcde")]);
    }
}
