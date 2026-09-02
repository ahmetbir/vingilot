//! Tests for the crew-avatar backfill in [`super::fill_missing_crew_avatars`].
//!
//! The backfill exists because a record's `avatar_url` is written once at mint
//! and every downstream reader — the Agents grid, the DM list, the kind:0
//! profile the runtime publishes on start — reads the record. Agents minted on
//! a v0.2.0 install got a null there, because the emblems did not exist yet.
//!
//! Art belongs to the persona, not to the moment of minting, so the backfill
//! fills a crew record that has none. What it must never do is overwrite art
//! somebody chose, and what it must never do is touch a record that is not
//! crew — those two are the reason it is a filter and not a loop over
//! everything.

use std::collections::BTreeMap;

use super::fill_missing_crew_avatars;
use crate::managed_agents::{vingilot_crew, BackendKind, ManagedAgentRecord, RespondTo};

/// A minted instance record: linked to `persona_id`, holding `avatar_url`,
/// with every other field at the shape `create_managed_agent` leaves it in.
fn crew_record(persona_id: Option<&str>, avatar_url: Option<&str>) -> ManagedAgentRecord {
    ManagedAgentRecord {
        pubkey: "p".repeat(64),
        name: "agent".into(),
        persona_id: persona_id.map(|id| id.to_string()),
        private_key_nsec: "nsec1fake".into(),
        // Four fields the 2026-09 upstream sync added to this record. The
        // fixture's own comment says it holds every other field at the shape
        // `create_managed_agent` leaves it in, so these take that function's
        // own defaults rather than values invented to make a test pass.
        description: None,
        effort_level: None,
        provider_policy_pending: false,
        team_catalog_source: None,
        auth_tag: None,
        relay_url: "ws://localhost:3000".into(),
        avatar_url: avatar_url.map(|url| url.to_string()),
        acp_command: "buzz-acp".into(),
        agent_command: "buzz-agent".into(),
        agent_command_override: None,
        agent_args: vec![],
        mcp_command: String::new(),
        turn_timeout_seconds: 320,
        idle_timeout_seconds: None,
        max_turn_duration_seconds: None,
        parallelism: 1,
        system_prompt: None,
        model: None,
        provider: None,
        persona_source_version: None,
        env_vars: BTreeMap::new(),
        start_on_app_launch: false,
        auto_restart_on_config_change: true,
        runtime_pid: None,
        backend: BackendKind::Local,
        backend_agent_id: None,
        provider_binary_path: None,
        team_id: None,
        persona_team_dir: None,
        persona_name_in_team: None,
        created_at: "2026-03-19T00:00:00Z".into(),
        updated_at: "2026-03-19T00:00:00Z".into(),
        last_started_at: None,
        last_stopped_at: None,
        last_exit_code: None,
        last_error: None,
        last_error_code: None,
        respond_to: RespondTo::OwnerOnly,
        respond_to_allowlist: vec![],
        display_name: None,
        slug: None,
        runtime: None,
        name_pool: Vec::new(),
        is_builtin: false,
        is_active: true,
        shared: false,
        source_team: None,
        source_team_persona_slug: None,
        catalog_source: None,
        definition_respond_to: None,
        definition_respond_to_allowlist: Vec::new(),
        definition_parallelism: None,
        relay_mesh: None,
    }
}

#[test]
fn fills_a_crew_record_that_has_no_avatar() {
    // The defect: minted before the art existed, so `avatar_url` is null.
    let mut records = vec![crew_record(Some(vingilot_crew::MATE_ID), None)];

    assert!(
        fill_missing_crew_avatars(&mut records),
        "filling an empty crew avatar is a change"
    );

    assert_eq!(
        records[0].avatar_url.as_deref(),
        vingilot_crew::avatar_url(vingilot_crew::MATE_ID),
        "the record must be given the crew emblem from the binary"
    );
    assert_ne!(
        records[0].updated_at, "2026-03-19T00:00:00Z",
        "a filled record is a written record and must be stamped"
    );
}

#[test]
fn fills_an_empty_string_avatar_too() {
    // `Some("")` is the same absence as `None` — every reader that draws art
    // falls back to a placeholder for both, so both must be filled.
    let mut records = vec![crew_record(Some(vingilot_crew::SCRIBE_ID), Some(""))];

    assert!(
        fill_missing_crew_avatars(&mut records),
        "an empty-string avatar is missing art, not chosen art"
    );

    assert_eq!(
        records[0].avatar_url.as_deref(),
        vingilot_crew::avatar_url(vingilot_crew::SCRIBE_ID),
    );
}

#[test]
fn skips_a_crew_record_that_already_has_art() {
    // Art somebody set is a decision. The backfill is a fallback and must
    // lose to it — otherwise every launch would silently undo a custom avatar.
    let mut records = vec![crew_record(
        Some(vingilot_crew::BOSUN_ID),
        Some("https://example.com/hand-set.png"),
    )];

    assert!(
        !fill_missing_crew_avatars(&mut records),
        "a record with art is not a change"
    );

    assert_eq!(
        records[0].avatar_url.as_deref(),
        Some("https://example.com/hand-set.png"),
        "hand-set art must survive the backfill"
    );
    assert_eq!(
        records[0].updated_at, "2026-03-19T00:00:00Z",
        "an untouched record must not be stamped"
    );
}

#[test]
fn skips_records_that_are_not_crew() {
    // A bee instance and an unlinked agent both have art of their own or none
    // this function can supply; neither is the crew's business.
    let mut records = vec![
        crew_record(Some("builtin:fizz"), None),
        crew_record(Some("custom:mine"), None),
        crew_record(None, None),
    ];

    assert!(
        !fill_missing_crew_avatars(&mut records),
        "nothing here is crew, so nothing changed"
    );

    assert!(
        records.iter().all(|record| record.avatar_url.is_none()),
        "a non-crew record must not be given a crew emblem"
    );
}

#[test]
fn reports_no_change_when_there_is_nothing_to_fill() {
    // The return value is what decides whether the caller writes the store, so
    // "nothing to do" must be false — a true here would rewrite
    // managed-agents.json on every single launch.
    let mut empty: Vec<ManagedAgentRecord> = Vec::new();
    assert!(!fill_missing_crew_avatars(&mut empty));

    let mut already_filled = vec![crew_record(
        Some(vingilot_crew::LOOKOUT_ID),
        vingilot_crew::avatar_url(vingilot_crew::LOOKOUT_ID),
    )];
    assert!(
        !fill_missing_crew_avatars(&mut already_filled),
        "a second pass over a filled record must report no change"
    );
}

#[test]
fn fills_only_the_crew_members_that_need_it() {
    // The mixed roster: one to fill, one to leave, one that is not crew. The
    // single `true` must not be read as "rewrite them all".
    let mut records = vec![
        crew_record(Some(vingilot_crew::NAVIGATOR_ID), None),
        crew_record(
            Some(vingilot_crew::BOSUN_ID),
            Some("https://example.com/hand-set.png"),
        ),
        crew_record(Some("builtin:honey"), None),
    ];

    assert!(fill_missing_crew_avatars(&mut records));

    assert_eq!(
        records[0].avatar_url.as_deref(),
        vingilot_crew::avatar_url(vingilot_crew::NAVIGATOR_ID),
    );
    assert_eq!(
        records[1].avatar_url.as_deref(),
        Some("https://example.com/hand-set.png"),
    );
    assert_eq!(records[2].avatar_url, None);
}

#[test]
fn fills_a_crew_record_wearing_a_runtime_default_icon() {
    // Measured live on the owner's machine: every v0.2.1 crew instance carried
    // the Claude runtime's vsassets icon — the fallback the mint wrote when the
    // persona had no art. A fallback is fillable; only chosen art is not.
    let claude_default =
        crate::managed_agents::discovery::managed_agent_avatar_url("claude-agent-acp")
            .expect("the claude runtime has a default icon");
    let mut records = vec![crew_record(
        Some("builtin:mate"),
        Some(claude_default.as_str()),
    )];

    assert!(fill_missing_crew_avatars(&mut records));
    assert!(
        records[0]
            .avatar_url
            .as_deref()
            .is_some_and(|a| a.starts_with("data:image/png;base64,")),
        "the runtime's fallback icon gives way to the emblem"
    );
}
