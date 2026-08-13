//! What is live right now, and — the part that matters — what has stopped
//! being true.
//!
//! # Decay is the feature, not a tidy-up
//!
//! A hook is the only thing that ever speaks here, and a crashed session sends
//! no hook saying it crashed. Claude Code emits `Stop` at the end of a turn and
//! `SessionEnd` when it exits cleanly; a `SIGKILL`, a closed lid, a `tmux
//! kill-server` and a panic emit nothing at all. The last thing such a session
//! ever said was `working` — it was working, that is why it was killed — so a
//! store without decay draws a green dot on that worktree for as long as the
//! app stays open, and the owner learns that the dot means nothing.
//!
//! So a session that has said nothing for long enough is **removed**, and its
//! absence is the unknown state. That is the vocabulary the dots already
//! speak: `attentionSignal.ts` draws no dot for a worktree nothing has
//! answered about, and is explicit that "clean" is a claim nobody has made.
//! Inventing a fourth colour for "the agent might be dead" would be this app
//! saying something it does not know.
//!
//! # How long is long enough — one budget per state, and why each
//!
//! The right horizon is not one number, because the three states make
//! different claims and cost different amounts when they are wrong.
//!
//! **`working` — [`WORKING_SILENCE`], ten minutes.** This is the acceptance
//! criterion. The longest *legitimate* silence inside a working turn is one
//! tool call, `PreToolUse` to `PostToolUse` around a build or a test suite;
//! Claude Code's own tool-hook ceiling is ten minutes, so nothing inside a turn
//! is designed to outlast this. Ten minutes is also short enough that a session
//! killed while the owner was making coffee is honest again by the time he sits
//! down. A long `cargo build` can genuinely exceed it, and then the dot goes
//! *blank* for the rest of the build and comes back the moment the tool
//! finishes — which is the cheap error. Erring toward silence costs a glance;
//! erring toward green costs the surface.
//!
//! **`asking` — [`ASKING_SILENCE`], thirty minutes.** `asking` is the only
//! state here that raises a needs-you dot and an OS notification, and
//! `attentionSignal.ts`'s header is blunt about what a wrong needs-you costs:
//! the first time it is wrong the owner stops believing the dot. A permission
//! prompt is a question aimed at a person; one that has stood unanswered for
//! half an hour means he is not at the machine or the session is gone. Either
//! way the app should stop insisting.
//!
//! **`waiting` — [`WAITING_SILENCE`], four hours.** The cheapest wrong answer
//! in the set: it draws the quietest thing this vocabulary has. Four hours lets
//! a session he left open over lunch still be listed when he comes back, and
//! bounds the map for an app that stays open for days.
//!
//! # Which clock those budgets run on — both of them, and the older answer wins
//!
//! A budget is only as honest as the clock beneath it, and neither clock this
//! machine offers is honest by itself.
//!
//! `Instant` is monotonic, and on Apple targets it is `CLOCK_UPTIME_RAW`,
//! whose man page says in as many words that it **does not increment while the
//! system is asleep**. The closed lid is one of the four deaths named at the
//! top of this file, and it is precisely the one a monotonic clock cannot see:
//! the owner shuts the lid on a `working` session, the agent is killed, he
//! opens it three hours later, and the monotonic delta counts only the awake
//! seconds — fewer than ten minutes of them — so the row still draws a green
//! dot for a session that is gone. The single failure this module exists to
//! prevent, reintroduced underneath it by the clock.
//!
//! `SystemTime` sees that sleep, because it is the wall. It is also settable:
//! NTP steps it and so can the owner. A backwards step makes every session
//! look younger than it is, and that fails in the direction that costs the
//! surface — green for a corpse, again.
//!
//! So a [`Moment`] is a reading of *both*, and an age is the **larger** of what
//! the two report. The monotonic clock bounds the answer from below — no
//! wall-clock rewind can make a session look fresher than its awake seconds.
//! The wall bounds it from above — no sleep can hide the hours. Each clock's
//! failure direction is closed by the other, and both of those failures were
//! toward green, which is the one this vocabulary cannot afford. What is left
//! is a forward wall jump evicting a session that is genuinely alive, and that
//! is the same cheap error a long `cargo build` already produces: a blank dot
//! until the next hook, which arrives within one tool call.
//!
//! Decay is measured against an injected `now` — every method takes one — so
//! the tests advance either clock, or only one of them, by hours in
//! microseconds, and no test anywhere sleeps.

use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use serde::Serialize;

use super::binding::Attribution;
use super::event::{step, Event, Liveness, Step, Tool};

const WORKING_SILENCE: Duration = Duration::from_secs(10 * 60);
const ASKING_SILENCE: Duration = Duration::from_secs(30 * 60);
const WAITING_SILENCE: Duration = Duration::from_secs(4 * 60 * 60);

fn silence_budget(state: Liveness) -> Duration {
    match state {
        Liveness::Working => WORKING_SILENCE,
        Liveness::Asking => ASKING_SILENCE,
        Liveness::Waiting => WAITING_SILENCE,
    }
}

/// One instant, read off both of this machine's clocks at once.
///
/// Carried as a pair rather than reduced to one number at the point of reading,
/// because [`Moment::since`] needs both readings of *both* moments to answer —
/// see this file's header for why either clock alone gets the closed lid or the
/// stepped wall clock wrong, and wrong toward green.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Moment {
    /// Uptime. Cannot be stepped; does not run while the machine sleeps.
    monotonic: Instant,
    /// The wall. Runs through sleep; can be stepped, forwards or back.
    wall: SystemTime,
}

impl Moment {
    pub(crate) fn now() -> Self {
        Self {
            monotonic: Instant::now(),
            wall: SystemTime::now(),
        }
    }

    /// How long ago `earlier` was: whichever clock says the longer time.
    ///
    /// Both readings saturate at zero rather than erroring or panicking. A
    /// caller handing in a moment older than the one recorded is not a reason
    /// to take a status dot down, and a `SystemTime` that has been stepped
    /// backwards makes exactly that shape of comparison.
    fn since(self, earlier: Self) -> Duration {
        let monotonic = self.monotonic.saturating_duration_since(earlier.monotonic);
        let wall = self
            .wall
            .duration_since(earlier.wall)
            .unwrap_or(Duration::ZERO);
        monotonic.max(wall)
    }
}

/// One agent session, as far as this app can see it.
#[derive(Clone, Debug)]
struct Session {
    /// `None` is the honest bucket — a session whose cwd named no checkout and
    /// whose terminal offered no usable id. Held, because it is a real live
    /// agent; held apart, because it belongs to no row.
    binding: Option<String>,
    path: Option<String>,
    state: Liveness,
    tool: Option<String>,
    /// When this session last said anything that changed it. A dropped event
    /// deliberately does not move this — see `event.rs`'s header.
    seen: Moment,
}

/// What one worktree's agents are doing, as the frontend reads it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLiveness {
    pub state: Liveness,
    /// The phrase under the dot — "working — Bash", "waiting for approval:
    /// Bash", "waiting". Produced beside the state rather than written next to
    /// it, for `attentionSignal.ts`'s reason: a sentence assembled by a
    /// surface can drift from the state it explains.
    pub sentence: String,
    /// How many sessions are in this state here. One worktree can hold several
    /// terminals, and a bar segment that says "working" over two agents when
    /// only one is working would be wrong about the other.
    pub sessions: u32,
    /// The worktree directory, when the id was derived from one. Carried so a
    /// row whose binding id is `main:<repo>` — a project's own checkout, which
    /// has no `local:` id — can still find its agent by path.
    pub path: Option<String>,
    /// The tool this state is about — `Bash`, `Edit` — when exactly one session
    /// is speaking, and `None` otherwise.
    ///
    /// **Carried beside the sentence rather than parsed back out of it.** The
    /// bottom bar renders `sentence` whole (`claude · working — Bash`), but the
    /// attention dot's tooltip has to name its own source in the dots'
    /// vocabulary — "an agent in this worktree's terminal is waiting for
    /// approval: Bash" — and it is one sentence with the harness's words inside
    /// it, not two sentences concatenated. A frontend that had only `sentence`
    /// would have to split on an em dash to build it, which is a parser for a
    /// string this file is free to reword.
    pub tool: Option<String>,
}

/// The whole answer, once per poll.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookLiveness {
    /// Keyed by binding id. A binding with no entry has no live session —
    /// which is the unknown state, and is never "quiet".
    pub by_binding: BTreeMap<String, AgentLiveness>,
    /// Sessions that belong to no worktree this app can name. Kept out of the
    /// map above so nothing can draw them on a row by accident, and kept at
    /// all so the count in a status surface is not a lie of omission.
    pub unattributed: Option<AgentLiveness>,
}

/// Every live session, by session id.
#[derive(Debug, Default)]
pub(crate) struct Sessions {
    // A plain `Mutex` rather than tokio's: every critical section here is a
    // hash lookup and a compare, held across no await point, and the store is
    // read from a Tauri command as well as from the server task.
    live: Mutex<HashMap<String, Session>>,
}

impl Sessions {
    /// Fold one hook into the store. `true` when something changed, which the
    /// endpoint logs nothing about and the tests read.
    pub(crate) fn apply(
        &self,
        session_id: &str,
        attribution: &Attribution,
        event: Event,
        tool_name: Option<&str>,
        now: Moment,
    ) -> bool {
        let Ok(mut live) = self.live.lock() else {
            // A poisoned lock means a previous panic inside one of these tiny
            // critical sections. Nothing here can repair that, and taking the
            // process down over a status dot would be worse than going quiet.
            return false;
        };
        prune(&mut live, now);

        let current = live.get(session_id).map(|session| session.state);
        let Step::To(state, tool) = step(event, tool_name, current) else {
            return false;
        };

        let (binding, path) = match attribution {
            Attribution::Binding { id, path } => (Some(id.clone()), path.clone()),
            Attribution::Unattributed => (None, None),
        };
        match live.get_mut(session_id) {
            Some(session) => {
                session.binding = binding;
                // A hint-derived id carries no path; keeping the old one would
                // be reporting a directory the session may have left.
                session.path = path;
                session.state = state;
                session.tool = resolve_tool(session.tool.take(), tool);
                session.seen = now;
            }
            None => {
                live.insert(
                    session_id.to_owned(),
                    Session {
                        binding,
                        path,
                        state,
                        tool: resolve_tool(None, tool),
                        seen: now,
                    },
                );
            }
        }
        true
    }

    /// What every worktree's agents are doing, with the silent ones already
    /// forgotten. The prune happens here as well as on write because a store
    /// nothing is writing to is exactly the store whose entries have gone
    /// stale.
    pub(crate) fn snapshot(&self, now: Moment) -> HookLiveness {
        let Ok(mut live) = self.live.lock() else {
            return HookLiveness::default();
        };
        prune(&mut live, now);

        let mut attributed: HashMap<&str, Vec<&Session>> = HashMap::new();
        let mut loose: Vec<&Session> = Vec::new();
        for session in live.values() {
            match session.binding.as_deref() {
                Some(binding) => attributed.entry(binding).or_default().push(session),
                None => loose.push(session),
            }
        }

        HookLiveness {
            by_binding: attributed
                .into_iter()
                .filter_map(|(binding, sessions)| {
                    rollup(&sessions).map(|agent| (binding.to_owned(), agent))
                })
                .collect(),
            unattributed: rollup(&loose),
        }
    }

    /// How many sessions are held. Read by the tests, which is the only place
    /// a raw count is honest — every surface reads `snapshot`.
    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.live.lock().map(|live| live.len()).unwrap_or(0)
    }
}

fn resolve_tool(current: Option<String>, tool: Tool) -> Option<String> {
    match tool {
        Tool::Set(name) => Some(name),
        Tool::Clear => None,
        Tool::Keep => current,
    }
}

/// Forget every session whose silence has outlasted its state's budget.
fn prune(live: &mut HashMap<String, Session>, now: Moment) {
    // `Moment::since` takes the LONGER of the monotonic and wall answers, and
    // saturates both at zero — a session behind a closed lid ages on the wall,
    // and one whose wall clock was stepped backwards still ages on uptime.
    // Neither clock alone can hold a dead session green.
    live.retain(|_, session| now.since(session.seen) < silence_budget(session.state));
}

/// The strongest state among a set of sessions, with a sentence that speaks for
/// all of them.
///
/// Mirrors `rollupMark`'s shape in `attentionSignal.ts` — strongest wins, and
/// the count goes in the words — because these two rollups sum the same kind of
/// thing and a reader should not have to learn two rules.
fn rollup(sessions: &[&Session]) -> Option<AgentLiveness> {
    let strongest = sessions
        .iter()
        .map(|session| session.state)
        .min_by_key(|state| state.rank())?;
    let winners: Vec<&&Session> = sessions
        .iter()
        .filter(|session| session.state == strongest)
        .collect();
    let count = winners.len();
    // The path and the tool are only ever one session's, so they are only
    // spoken when exactly one session is speaking.
    let single = if count == 1 { winners.first() } else { None };
    let tool = single.and_then(|session| session.tool.clone());
    Some(AgentLiveness {
        state: strongest,
        sentence: sentence(strongest, count, tool.as_deref()),
        sessions: count as u32,
        path: sessions.iter().find_map(|session| session.path.clone()),
        tool,
    })
}

fn sentence(state: Liveness, count: usize, tool: Option<&str>) -> String {
    if count > 1 {
        return format!("{count} sessions {}", state.word());
    }
    match (state, tool) {
        (Liveness::Working, Some(tool)) => format!("working — {tool}"),
        (Liveness::Asking, Some(tool)) => format!("waiting for approval: {tool}"),
        (state, _) => state.word().to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::vingilot_hooks::binding::local_binding_id;
    use crate::vingilot_hooks::event::Notice;

    fn worktree(path: &str) -> Attribution {
        Attribution::Binding {
            id: local_binding_id(path),
            path: Some(path.to_owned()),
        }
    }

    /// Ordinary time passing on a machine that stays awake: both clocks agree.
    fn at(base: Moment, seconds: u64) -> Moment {
        Moment {
            monotonic: base.monotonic + Duration::from_secs(seconds),
            wall: base.wall + Duration::from_secs(seconds),
        }
    }

    /// The machine slept: the wall moved, uptime did not. This is the shape
    /// `Instant` alone reports for a closed lid, and it is why `Instant` alone
    /// is not the clock these budgets run on.
    fn slept(base: Moment, seconds: u64) -> Moment {
        Moment {
            monotonic: base.monotonic,
            wall: base.wall + Duration::from_secs(seconds),
        }
    }

    /// The machine ran while the wall clock was stepped backwards under it.
    fn rewound(base: Moment, awake: u64, back: u64) -> Moment {
        Moment {
            monotonic: base.monotonic + Duration::from_secs(awake),
            wall: base.wall - Duration::from_secs(back),
        }
    }

    #[test]
    fn a_turn_walks_from_working_to_waiting_and_the_sentence_follows() {
        let store = Sessions::default();
        let t0 = Moment::now();
        let repo = worktree("/w/repo");

        store.apply("s1", &repo, Event::PromptSubmit, None, t0);
        let working = &store.snapshot(t0).by_binding[&local_binding_id("/w/repo")];
        assert_eq!(working.state, Liveness::Working);
        assert_eq!(working.sentence, "working");
        assert_eq!(working.path.as_deref(), Some("/w/repo"));

        store.apply("s1", &repo, Event::PreTool, Some("Bash"), at(t0, 1));
        assert_eq!(
            store.snapshot(at(t0, 1)).by_binding[&local_binding_id("/w/repo")].sentence,
            "working — Bash"
        );

        store.apply("s1", &repo, Event::Stop, None, at(t0, 2));
        let waiting = &store.snapshot(at(t0, 2)).by_binding[&local_binding_id("/w/repo")];
        assert_eq!(waiting.state, Liveness::Waiting);
        assert_eq!(waiting.sentence, "waiting");
    }

    #[test]
    fn a_permission_prompt_names_the_tool_the_pre_tool_announced() {
        // The sentence the plan asks for by name, and the only route it can
        // come by: the Notification body has no tool_name in it.
        let store = Sessions::default();
        let t0 = Moment::now();
        let repo = worktree("/w/repo");

        store.apply("s1", &repo, Event::PreTool, Some("Bash"), t0);
        store.apply("s1", &repo, Event::Notice(Notice::Asking), None, at(t0, 1));
        let asking = &store.snapshot(at(t0, 1)).by_binding[&local_binding_id("/w/repo")];
        assert_eq!(asking.state, Liveness::Asking);
        assert_eq!(asking.sentence, "waiting for approval: Bash");
        // And beside the sentence, so the dot's own tooltip can name the tool
        // without splitting that string back apart.
        assert_eq!(asking.tool.as_deref(), Some("Bash"));
    }

    #[test]
    fn an_approved_prompt_stops_being_drawn_the_moment_the_tool_runs() {
        // The real sequence around a permission-gated tool, end to end:
        // pre-tool, the dialog, the owner approves, the tool runs, post-tool.
        // Nothing else in this app is told he answered — so a post-tool
        // dropped on an `asking` session leaves a needs-you dot and
        // "waiting for approval: Bash" on screen for the whole runtime of a
        // command he has already dealt with, and past the asking budget it
        // decays out rather than correcting itself.
        let store = Sessions::default();
        let t0 = Moment::now();
        let repo = worktree("/w/repo");
        let id = local_binding_id("/w/repo");

        store.apply("s1", &repo, Event::PreTool, Some("Bash"), t0);
        store.apply("s1", &repo, Event::Notice(Notice::Asking), None, at(t0, 1));
        assert_eq!(
            store.snapshot(at(t0, 1)).by_binding[&id].state,
            Liveness::Asking
        );

        assert!(
            store.apply("s1", &repo, Event::PostTool, Some("Bash"), at(t0, 2)),
            "the tool running is the only event that says the question was answered"
        );
        let answered = &store.snapshot(at(t0, 2)).by_binding[&id];
        assert_eq!(answered.state, Liveness::Working);
        assert_eq!(answered.sentence, "working");
        assert_eq!(answered.tool, None, "the ask's noun goes with the ask");
    }

    #[test]
    fn the_tool_is_only_reported_when_one_session_is_speaking_for_the_row() {
        // Same rule the sentence follows, asserted on the field the dot reads:
        // one session's `Bash` reported over two agents would be a claim about
        // the other one that nothing made.
        let store = Sessions::default();
        let t0 = Moment::now();
        let repo = worktree("/w/repo");
        store.apply("s1", &repo, Event::PreTool, Some("Bash"), t0);
        assert_eq!(
            store.snapshot(t0).by_binding[&local_binding_id("/w/repo")]
                .tool
                .as_deref(),
            Some("Bash")
        );

        store.apply("s2", &repo, Event::PreTool, Some("Edit"), t0);
        assert_eq!(
            store.snapshot(t0).by_binding[&local_binding_id("/w/repo")].tool,
            None,
            "two working sessions have no one tool between them"
        );

        // And a turn with no tool running reports none rather than the last one.
        let store = Sessions::default();
        store.apply("s1", &repo, Event::PromptSubmit, None, t0);
        assert_eq!(
            store.snapshot(t0).by_binding[&local_binding_id("/w/repo")].tool,
            None
        );
    }

    #[test]
    fn a_session_working_in_silence_decays_to_nothing_rather_than_staying_green() {
        // The acceptance criterion. The clock is handed in; nothing sleeps.
        let store = Sessions::default();
        let t0 = Moment::now();
        let repo = worktree("/w/repo");
        store.apply("s1", &repo, Event::PromptSubmit, None, t0);

        // A minute short of the budget it is still working — a long tool call
        // must not be mistaken for a corpse.
        let nearly = at(t0, WORKING_SILENCE.as_secs() - 60);
        assert_eq!(
            store.snapshot(nearly).by_binding[&local_binding_id("/w/repo")].state,
            Liveness::Working
        );

        let past = at(t0, WORKING_SILENCE.as_secs() + 1);
        assert!(
            store.snapshot(past).by_binding.is_empty(),
            "a crashed session's last word must not stay on the row forever"
        );
        assert_eq!(store.len(), 0, "and the entry is gone, not merely hidden");
    }

    #[test]
    fn a_lid_closed_over_a_working_session_ages_it_out_by_the_time_it_opens() {
        // The closed lid is one of the four deaths the header names, and it is
        // the one a monotonic clock cannot see: `Instant` on this platform is
        // `CLOCK_UPTIME_RAW` and stops while the machine sleeps, so uptime
        // reports nothing at all here. The wall has to be what answers, or the
        // acceptance criterion holds only for a machine that never sleeps.
        let store = Sessions::default();
        let t0 = Moment::now();
        let repo = worktree("/w/repo");
        store.apply("s1", &repo, Event::PromptSubmit, None, t0);

        let woken = slept(t0, 3 * 60 * 60);
        assert_eq!(
            woken.monotonic.saturating_duration_since(t0.monotonic),
            Duration::ZERO,
            "the premise: uptime learns nothing from three hours of sleep"
        );
        assert!(
            store.snapshot(woken).by_binding.is_empty(),
            "a session that was working when the lid shut must not still be green when it opens"
        );
        assert_eq!(store.len(), 0, "and the entry is gone, not merely hidden");
    }

    #[test]
    fn a_wall_clock_stepped_backwards_cannot_make_a_dead_session_young() {
        // The other clock's failure, and the reason the wall alone is not the
        // answer either: NTP steps the wall back an hour under a session that
        // has been silent past its budget. Uptime is what refuses.
        let store = Sessions::default();
        let t0 = Moment::now();
        let repo = worktree("/w/repo");
        store.apply("s1", &repo, Event::PromptSubmit, None, t0);

        let stepped = rewound(t0, WORKING_SILENCE.as_secs() + 1, 60 * 60);
        assert!(
            stepped.wall < t0.wall,
            "the premise: the wall now reads earlier than when the session spoke"
        );
        assert!(
            store.snapshot(stepped).by_binding.is_empty(),
            "a rewound wall clock must not resurrect a session uptime has already buried"
        );
    }

    #[test]
    fn each_state_decays_on_its_own_budget() {
        let t0 = Moment::now();
        let repo = worktree("/w/repo");
        for (event, budget) in [
            (Event::PromptSubmit, WORKING_SILENCE),
            (Event::Notice(Notice::Asking), ASKING_SILENCE),
            (Event::Stop, WAITING_SILENCE),
        ] {
            let store = Sessions::default();
            store.apply("s1", &repo, event, None, t0);
            assert_eq!(
                store
                    .snapshot(at(t0, budget.as_secs() - 1))
                    .by_binding
                    .len(),
                1,
                "{event:?} must survive to its own budget"
            );
            assert_eq!(
                store
                    .snapshot(at(t0, budget.as_secs() + 1))
                    .by_binding
                    .len(),
                0,
                "{event:?} must not survive past it"
            );
        }
    }

    #[test]
    fn a_dropped_event_does_not_keep_a_dead_session_alive() {
        // The other half of "dropped, not debounced": a straggling post-tool
        // must not extend the life of a session that has stopped talking, or
        // the decay could be held off indefinitely by the very event the race
        // note is about.
        let store = Sessions::default();
        let t0 = Moment::now();
        let repo = worktree("/w/repo");
        store.apply("s1", &repo, Event::Stop, None, t0);

        let later = at(t0, WAITING_SILENCE.as_secs() - 5);
        assert!(
            !store.apply("s1", &repo, Event::PostTool, Some("Bash"), later),
            "a post-tool on a finished turn changes nothing"
        );
        assert_eq!(
            store.snapshot(later).by_binding[&local_binding_id("/w/repo")].state,
            Liveness::Waiting,
            "and above all does not re-report work"
        );
        assert!(
            store
                .snapshot(at(t0, WAITING_SILENCE.as_secs() + 1))
                .by_binding
                .is_empty(),
            "the clock ran from the Stop, not from the straggler"
        );
    }

    #[test]
    fn a_session_no_worktree_can_be_named_for_is_held_apart_and_not_dropped() {
        let store = Sessions::default();
        let t0 = Moment::now();
        store.apply(
            "s1",
            &Attribution::Unattributed,
            Event::PromptSubmit,
            None,
            t0,
        );
        let answer = store.snapshot(t0);
        assert!(
            answer.by_binding.is_empty(),
            "it must not be drawn on any row"
        );
        let loose = answer.unattributed.expect("but it must still be counted");
        assert_eq!(loose.state, Liveness::Working);
        assert_eq!(loose.sessions, 1);
        assert_eq!(loose.path, None);
    }

    #[test]
    fn two_sessions_in_one_worktree_roll_up_to_the_stronger_one() {
        let store = Sessions::default();
        let t0 = Moment::now();
        let repo = worktree("/w/repo");
        store.apply("s1", &repo, Event::Stop, None, t0);
        store.apply("s2", &repo, Event::PreTool, Some("Bash"), t0);

        let one = &store.snapshot(t0).by_binding[&local_binding_id("/w/repo")];
        assert_eq!(one.state, Liveness::Working);
        assert_eq!(one.sessions, 1, "one of the two is working");
        assert_eq!(one.sentence, "working — Bash");

        // A permission prompt in the second outranks the first's work.
        store.apply("s1", &repo, Event::Notice(Notice::Asking), None, at(t0, 1));
        let two = &store.snapshot(at(t0, 1)).by_binding[&local_binding_id("/w/repo")];
        assert_eq!(two.state, Liveness::Asking);
        assert_eq!(two.sentence, "waiting for approval");
    }

    #[test]
    fn a_state_shared_by_several_sessions_says_how_many() {
        let store = Sessions::default();
        let t0 = Moment::now();
        let repo = worktree("/w/repo");
        store.apply("s1", &repo, Event::PreTool, Some("Bash"), t0);
        store.apply("s2", &repo, Event::PreTool, Some("Edit"), t0);
        let both = &store.snapshot(t0).by_binding[&local_binding_id("/w/repo")];
        assert_eq!(both.sessions, 2);
        assert_eq!(
            both.sentence, "2 sessions working",
            "one session's tool must not be reported over both"
        );
    }

    #[test]
    fn a_session_that_moves_worktrees_leaves_the_first_one_empty() {
        let store = Sessions::default();
        let t0 = Moment::now();
        store.apply("s1", &worktree("/w/one"), Event::PromptSubmit, None, t0);
        store.apply("s1", &worktree("/w/two"), Event::PreTool, None, at(t0, 1));

        let answer = store.snapshot(at(t0, 1));
        assert!(!answer.by_binding.contains_key(&local_binding_id("/w/one")));
        assert!(answer.by_binding.contains_key(&local_binding_id("/w/two")));
        assert_eq!(store.len(), 1, "one session, not two");
    }
}
