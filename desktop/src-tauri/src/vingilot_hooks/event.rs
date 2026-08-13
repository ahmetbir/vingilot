//! The event vocabulary, and what each event means about a session.
//!
//! The map is VelaTerm's, kept whole
//! (`vingilot/docs/research/2026-08-12-velaterm-notes.md` §1): prompt-submit,
//! pre-tool and post-tool say **working**; `Stop` says **waiting**; a
//! `PermissionRequest`, or a `Notification` of `permission_prompt` or
//! `elicitation_dialog`, says **asking**; `idle_prompt` says waiting, silently.
//!
//! # Two ways an ask arrives, because the two rings send different events
//!
//! Ring 1 — the `claude` wrapper this app installs — registers `http` hooks,
//! and Claude Code accepts an `http` handler on `PermissionRequest` but **not**
//! on `Notification`, which takes `command` handlers only. So the wrapper reads
//! the ask off `PermissionRequest` (`vingilot_shim::scripts` argues that
//! choice), and this parser answers `Asking` for it.
//!
//! Ring 2 — a hook the owner installed himself, with a `curl` in it — has no
//! such limit and will send `Notification`. Both spellings are therefore mapped
//! to the same state, and neither ring has to know about the other.
//!
//! # The race, and why an event is dropped rather than debounced
//!
//! Every Claude Code hook is delivered independently, so the order they *land*
//! in is not the order they *fired* in. VelaTerm hit this hard enough to drop
//! `PostToolUse` for one harness entirely: a post-tool that arrives after the
//! turn's `Stop` re-reports "working" over a session that has finished, and
//! nothing else is coming to correct it. The turn is over — the next event is
//! whenever the owner types again, which may be tomorrow — so the dot stays
//! green for as long as the app is open. That is precisely the failure the
//! plan's self-review names as the one most likely to be got wrong quietly.
//!
//! A debounce does not fix it. Delaying the post-tool by *n* milliseconds only
//! moves the race, because the gap between a `Stop` and a straggling post-tool
//! is whatever the OS felt like; and a debounce that is long enough to be safe
//! is long enough to make a real working state arrive late.
//!
//! So the event is **dropped**, and the rule is narrower than VelaTerm's blunt
//! one: **post-tool may refresh work and may end an ask, never start work from
//! silence.** A tool finishing is the tail of a turn, and a tail cannot begin
//! anything — the only events that legitimately move a session into `working`
//! from nothing are the head of a turn (prompt-submit) and the announcement of
//! a tool about to run (pre-tool). A post-tool landing on a session that is
//! `waiting` or absent is therefore *always* either the straggler above or an
//! event from a turn this app never saw the start of, and both are better read
//! as nothing than as work.
//!
//! **An `asking` session is the exception, and it is not a hedge.** The real
//! order around a permission-gated tool is pre-tool → the dialog → the owner
//! answers → the tool runs → post-tool. That post-tool is positive evidence
//! that the question was answered: the tool it reports could not have run
//! otherwise. Dropping it is what left a needs-you dot and a
//! "waiting for approval: Bash" on the bar for the whole runtime of a command
//! he had already approved — for a long build, until the entry decayed out
//! thirty minutes later — which costs this signal exactly the credibility it
//! exists to have. The race the drop defends against needs only `waiting` and
//! absent to stay drops: a straggler after `Stop` cannot arrive on a session
//! that is asking, because `Stop` and the dialog are not the same turn's end.
//!
//! The drop is total: no state change and no touch of the session's clock, so
//! a straggler cannot extend the life of a session that has stopped talking
//! (`state.rs`'s decay).

use serde::Deserialize;

/// What a hook says happened.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Event {
    PromptSubmit,
    PreTool,
    PostTool,
    Stop,
    Notice(Notice),
}

/// Which notification. Claude Code sends the discriminator in the body as
/// `notification_type` (`permission_prompt`, `idle_prompt`, `auth_success`,
/// `elicitation_dialog`), so the two that mean "he is being asked something"
/// are separated from the two that are not about liveness at all.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Notice {
    /// A permission dialog, or an elicitation — the app is stopped, waiting on
    /// a person.
    Asking,
    /// `idle_prompt`: the session has been sitting at an empty prompt. It
    /// lands where `Stop` lands and says nothing extra, which is the whole of
    /// "corrected silently" — `waiting` is not a state anything announces.
    Idle,
    /// `auth_success`, or a type this build has not heard of. Says nothing
    /// about whether an agent is working, so it changes nothing.
    Mute,
}

/// The state a session can be in between two hooks.
///
/// There is no `Unknown` member on purpose: a session nothing has said
/// anything about recently is **removed**, and its absence is the unknown. It
/// is the vocabulary the dots already speak — `stat: null` draws no dot, and
/// `NO_MARK` is "nothing has answered" rather than a fifth colour
/// (`features/runs/lib/attentionSignal.ts`).
#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Liveness {
    Working,
    Waiting,
    Asking,
}

impl Liveness {
    /// Precedence, and the same shape as the dots': what needs a person
    /// outranks what is moving, which outranks what is at rest. Read by the
    /// rollup when one worktree has more than one live session.
    pub(crate) fn rank(self) -> u8 {
        match self {
            Liveness::Asking => 0,
            Liveness::Working => 1,
            Liveness::Waiting => 2,
        }
    }

    /// The words for this state on its own. The bottom bar prefixes the
    /// harness (`claude · …`) and the dot's tooltip does not, so what is
    /// produced here is the phrase and never the whole line.
    pub(crate) fn word(self) -> &'static str {
        match self {
            Liveness::Working => "working",
            Liveness::Waiting => "waiting",
            Liveness::Asking => "waiting for approval",
        }
    }
}

/// What to do with the tool name the session's sentence carries.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum Tool {
    Set(String),
    Clear,
    /// Kept, which is how "waiting for approval: Bash" gets its noun when the
    /// event did not carry one. A `Notification` body carries a message and no
    /// `tool_name` — the tool being asked about is the one `PreToolUse`
    /// announced a moment earlier, because that hook fires *before* the
    /// permission check that raises the dialog. Remembering it is exact;
    /// parsing it back out of the English in `message` would be a guess.
    /// (`PermissionRequest`, ring 1's ask, does carry `tool_name`, and there
    /// the noun is read rather than remembered.)
    Keep,
}

/// What one event does to a session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum Step {
    To(Liveness, Tool),
    /// Nothing changes — not the state, not the tool, not the clock. See this
    /// module's header for the two things that land here and why neither is
    /// debounced.
    Drop,
}

/// The map, and the only place it is written down.
///
/// `current` is the session's state as it stands, which the post-tool rule
/// needs and nothing else does.
pub(crate) fn step(event: Event, tool_name: Option<&str>, current: Option<Liveness>) -> Step {
    let named = || match tool_name.filter(|name| !name.is_empty()) {
        Some(name) => Tool::Set(name.to_owned()),
        None => Tool::Clear,
    };
    match event {
        // A new turn. The tool is cleared rather than kept: whatever was
        // running belonged to the last turn, and a sentence naming it would be
        // reporting the previous question's work against this one.
        Event::PromptSubmit => Step::To(Liveness::Working, Tool::Clear),
        Event::PreTool => Step::To(Liveness::Working, named()),
        // Working: the turn goes on. Asking: the owner answered, and the tool
        // he was asked about has now run — see this module's header for why
        // that is evidence rather than a guess.
        Event::PostTool => match current {
            Some(Liveness::Working | Liveness::Asking) => Step::To(Liveness::Working, Tool::Clear),
            _ => Step::Drop,
        },
        Event::Stop => Step::To(Liveness::Waiting, Tool::Clear),
        // `PermissionRequest` carries the tool it is about, so the noun is read
        // rather than remembered when it is there; a `Notification` body has no
        // `tool_name` and falls back to what pre-tool announced.
        Event::Notice(Notice::Asking) => Step::To(Liveness::Asking, {
            match tool_name.filter(|name| !name.is_empty()) {
                Some(name) => Tool::Set(name.to_owned()),
                None => Tool::Keep,
            }
        }),
        Event::Notice(Notice::Idle) => Step::To(Liveness::Waiting, Tool::Clear),
        Event::Notice(Notice::Mute) => Step::Drop,
    }
}

/// The fields of a hook payload this module reads. Everything else Claude Code
/// sends — the prompt, the transcript path, the tool's whole input and
/// response — is ignored by omission: serde drops unknown fields, so a
/// transcript path and a file's contents are never held in this app's memory
/// and can never be logged out of it.
#[derive(Debug, Default, Deserialize)]
pub(crate) struct HookBody {
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    /// Claude Code's own name for the event. Read only when the URL did not
    /// carry one, so a hook installed by hand (Ring 2, and anything with a
    /// plain `curl`) still works without the query string.
    pub hook_event_name: Option<String>,
    pub tool_name: Option<String>,
    pub notification_type: Option<String>,
}

/// The event a request names, from the URL's `e` first and the body second.
///
/// Both spellings are accepted for each event — the kebab-case labels this
/// app puts in its own hook URLs, and Claude Code's own PascalCase
/// `hook_event_name` — so one parser serves both injection rings. An event
/// this build does not map (`SubagentStop`, `SessionStart`, anything added
/// later) answers `None`, which the endpoint reports as accepted-and-ignored
/// rather than as an error: the sender did nothing wrong.
pub(crate) fn parse_event(label: Option<&str>, body: &HookBody) -> Option<Event> {
    let label = label
        .filter(|label| !label.is_empty())
        .or(body.hook_event_name.as_deref())?;
    match label {
        "prompt-submit" | "UserPromptSubmit" => Some(Event::PromptSubmit),
        "pre-tool" | "PreToolUse" => Some(Event::PreTool),
        "post-tool" | "PostToolUse" => Some(Event::PostTool),
        "stop" | "Stop" => Some(Event::Stop),
        // Ring 1's ask. It has no `notification_type` to read and needs none:
        // the event *is* the permission dialog, which is why it can carry an
        // `http` hook where `Notification` cannot.
        "permission-request" | "PermissionRequest" => Some(Event::Notice(Notice::Asking)),
        "notification" | "Notification" => Some(Event::Notice(parse_notice(
            body.notification_type.as_deref(),
        ))),
        _ => None,
    }
}

fn parse_notice(notification_type: Option<&str>) -> Notice {
    match notification_type {
        Some("permission_prompt") | Some("elicitation_dialog") => Notice::Asking,
        Some("idle_prompt") => Notice::Idle,
        // Including `None`: a notification whose type this app cannot read
        // must not be promoted to a permission prompt, because `asking` is the
        // one state that puts a needs-you dot on a row and shows the owner a
        // notification. Guessing loud is how a dot loses its credibility.
        _ => Notice::Mute,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(event: &str, notice: Option<&str>) -> HookBody {
        HookBody {
            hook_event_name: Some(event.to_owned()),
            notification_type: notice.map(str::to_owned),
            ..HookBody::default()
        }
    }

    #[test]
    fn the_three_working_events_say_working() {
        assert_eq!(
            step(Event::PromptSubmit, None, None),
            Step::To(Liveness::Working, Tool::Clear)
        );
        assert_eq!(
            step(Event::PreTool, Some("Bash"), Some(Liveness::Waiting)),
            Step::To(Liveness::Working, Tool::Set("Bash".to_owned()))
        );
        assert_eq!(
            step(Event::PostTool, Some("Bash"), Some(Liveness::Working)),
            Step::To(Liveness::Working, Tool::Clear)
        );
    }

    #[test]
    fn stop_says_waiting_and_idle_lands_in_the_same_place() {
        assert_eq!(
            step(Event::Stop, None, Some(Liveness::Working)),
            Step::To(Liveness::Waiting, Tool::Clear)
        );
        assert_eq!(
            step(Event::Notice(Notice::Idle), None, Some(Liveness::Waiting)),
            Step::To(Liveness::Waiting, Tool::Clear)
        );
    }

    #[test]
    fn a_permission_prompt_says_asking_and_keeps_the_tool_it_is_about() {
        // The whole of "waiting for approval: Bash": the noun comes from the
        // PreToolUse that fired before the dialog, because the Notification
        // body has no tool_name to read.
        assert_eq!(
            step(Event::Notice(Notice::Asking), None, Some(Liveness::Working)),
            Step::To(Liveness::Asking, Tool::Keep)
        );
    }

    #[test]
    fn a_post_tool_after_a_stop_is_dropped_rather_than_debounced() {
        // VelaTerm's race, and the acceptance criterion for this file: a
        // straggling post-tool must not re-report work over a finished turn.
        assert_eq!(
            step(Event::PostTool, Some("Bash"), Some(Liveness::Waiting)),
            Step::Drop,
            "a tool finishing cannot start a turn that has stopped"
        );
        // And the same for a session this app has never heard of, which is the
        // other way a post-tool arrives without a turn behind it.
        assert_eq!(step(Event::PostTool, None, None), Step::Drop);
    }

    #[test]
    fn a_post_tool_on_an_asking_session_is_the_answer_arriving() {
        // The other half of the post-tool rule, and the one the owner sees: he
        // approves, the tool runs, and its post-tool is the only event that
        // says so. Dropped, the row keeps drawing needs-you and the bar keeps
        // saying "waiting for approval: Bash" for the whole runtime of a
        // command he already answered.
        assert_eq!(
            step(Event::PostTool, Some("Bash"), Some(Liveness::Asking)),
            Step::To(Liveness::Working, Tool::Clear)
        );
    }

    #[test]
    fn ring_ones_permission_request_is_the_same_ask_as_ring_twos_notification() {
        // The wrapper cannot put an http hook on `Notification` — Claude Code
        // takes command handlers only there — so ring 1's ask arrives on
        // `PermissionRequest` and must land in exactly the same state, with the
        // tool it names.
        let empty = HookBody::default();
        for label in ["permission-request", "PermissionRequest"] {
            assert_eq!(
                parse_event(Some(label), &empty),
                Some(Event::Notice(Notice::Asking)),
                "{label}"
            );
        }
        assert_eq!(
            parse_event(None, &body("PermissionRequest", None)),
            Some(Event::Notice(Notice::Asking))
        );
        // It carries `tool_name`, unlike a Notification, so the noun in
        // "waiting for approval: Bash" is read rather than remembered...
        assert_eq!(
            step(Event::Notice(Notice::Asking), Some("Bash"), None),
            Step::To(Liveness::Asking, Tool::Set("Bash".to_owned()))
        );
        // ...and when it is absent the remembered one still stands.
        assert_eq!(
            step(Event::Notice(Notice::Asking), Some(""), None),
            Step::To(Liveness::Asking, Tool::Keep)
        );
    }

    #[test]
    fn a_notification_this_build_cannot_read_changes_nothing() {
        for kind in [Some("auth_success"), Some("something_new"), None] {
            assert_eq!(
                parse_notice(kind),
                Notice::Mute,
                "{kind:?} must not be promoted to a permission prompt"
            );
        }
        assert_eq!(
            step(Event::Notice(Notice::Mute), None, Some(Liveness::Working)),
            Step::Drop
        );
    }

    #[test]
    fn both_spellings_of_every_event_parse() {
        let empty = HookBody::default();
        for (ours, theirs, expected) in [
            ("prompt-submit", "UserPromptSubmit", Event::PromptSubmit),
            ("pre-tool", "PreToolUse", Event::PreTool),
            ("post-tool", "PostToolUse", Event::PostTool),
            ("stop", "Stop", Event::Stop),
        ] {
            assert_eq!(parse_event(Some(ours), &empty), Some(expected));
            assert_eq!(parse_event(Some(theirs), &empty), Some(expected));
            // And with no `e` at all, the body's own name carries it — the
            // path a hand-installed hook takes.
            assert_eq!(parse_event(None, &body(theirs, None)), Some(expected));
            assert_eq!(parse_event(Some(""), &body(theirs, None)), Some(expected));
        }
    }

    #[test]
    fn a_notification_reads_its_kind_from_the_body_whichever_way_it_arrived() {
        assert_eq!(
            parse_event(
                Some("notification"),
                &body("Notification", Some("permission_prompt"))
            ),
            Some(Event::Notice(Notice::Asking))
        );
        assert_eq!(
            parse_event(
                Some("notification"),
                &body("Notification", Some("idle_prompt"))
            ),
            Some(Event::Notice(Notice::Idle))
        );
        assert_eq!(
            parse_event(None, &body("Notification", Some("elicitation_dialog"))),
            Some(Event::Notice(Notice::Asking))
        );
    }

    #[test]
    fn an_event_this_build_does_not_map_is_not_an_error() {
        let empty = HookBody::default();
        for label in ["SubagentStop", "SessionStart", "PreCompact", "nonsense"] {
            assert_eq!(parse_event(Some(label), &empty), None, "{label}");
        }
        assert_eq!(parse_event(None, &empty), None);
    }

    #[test]
    fn asking_outranks_working_outranks_waiting() {
        assert!(Liveness::Asking.rank() < Liveness::Working.rank());
        assert!(Liveness::Working.rank() < Liveness::Waiting.rank());
    }
}
