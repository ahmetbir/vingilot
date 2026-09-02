use super::{
    built_in_persona_avatar_url, built_in_persona_records, ensure_persona_ids_are_active,
    ensure_persona_is_active, fold_personas_for_serving, merge_personas, migrate_retired_personas,
    overlay_built_in_avatars, validate_persona_activation_change, validate_persona_deletion,
    BUILT_IN_PERSONAS, RETIRED_PERSONAS,
};
use crate::managed_agents::discovery::{default_agent_command, effective_agent_command};
use crate::managed_agents::AgentDefinition;

fn custom_persona(id: &str, display_name: &str) -> AgentDefinition {
    AgentDefinition {
        description: None,
        id: id.to_string(),
        display_name: display_name.to_string(),
        avatar_url: Some("https://example.com/avatar.png".to_string()),
        system_prompt: "Custom prompt".to_string(),
        runtime: None,
        model: None,
        provider: None,
        name_pool: Vec::new(),
        is_builtin: false,
        is_active: true,
        shared: false,
        source_team: None,
        source_team_persona_slug: None,
        catalog_source: None,
        team_catalog_source: None,
        env_vars: std::collections::BTreeMap::new(),
        respond_to: None,
        respond_to_allowlist: Vec::new(),
        parallelism: None,
        created_at: "2026-03-19T00:00:00Z".to_string(),
        updated_at: "2026-03-19T00:00:00Z".to_string(),
    }
}

#[test]
fn merge_personas_adds_missing_built_ins() {
    let (records, changed) = merge_personas(Vec::new(), "2026-03-19T00:00:00Z");

    assert!(changed);
    assert_eq!(records.len(), BUILT_IN_PERSONAS.len());
    assert!(records.iter().all(|record| record.is_builtin));
    assert!(records
        .iter()
        .any(|record| record.id == "builtin:fizz" && record.runtime.is_none()));
    let display_names: Vec<&str> = records
        .iter()
        .map(|record| record.display_name.as_str())
        .collect();
    assert_eq!(
        display_names,
        vec![
            "Mate",
            "Bosun",
            "Lookout",
            "Navigator",
            "Scribe",
            "Fizz",
            "Honey",
            // Renamed by the upstream sync. `Bumble` survives as
            // `POLLEN_LEGACY_DISPLAY_NAME` so agents minted under the old name
            // still resolve, but a freshly merged catalog publishes the new one.
            "Pollen"
        ]
    );
    let active_ids: Vec<&str> = records
        .iter()
        .filter(|record| record.is_active)
        .map(|record| record.id.as_str())
        .collect();
    assert_eq!(
        active_ids,
        vec![
            "builtin:mate",
            "builtin:bosun",
            "builtin:lookout",
            "builtin:navigator",
            "builtin:scribe",
            "builtin:fizz",
            "builtin:honey",
            "builtin:bumble",
        ]
    );
}

/// The crew's prompts come from `.persona.md` pack files. `built_in_persona_records`
/// is where the YAML frontmatter is split off, so this is where "a system prompt
/// never carries frontmatter" has to hold — for the crew, and unchanged for the
/// upstream built-ins that have none.
#[test]
fn built_in_records_carry_prompt_bodies_not_persona_files() {
    let records = built_in_persona_records("2026-03-19T00:00:00Z");

    for record in &records {
        assert!(
            !record.system_prompt.starts_with("---"),
            "{}: frontmatter leaked into the system prompt",
            record.id
        );
        assert!(
            !record.system_prompt.contains("display_name:"),
            "{}: frontmatter key leaked into the system prompt",
            record.id
        );
        assert!(
            !record.system_prompt.is_empty(),
            "{}: empty system prompt",
            record.id
        );
    }

    let mate = records
        .iter()
        .find(|record| record.id == "builtin:mate")
        .expect("Mate should be a built-in persona");
    assert!(mate.system_prompt.contains("First Mate"));
    assert!(mate
        .system_prompt
        .contains("overrides everything in this prompt"));

    let fizz = records
        .iter()
        .find(|record| record.id == "builtin:fizz")
        .expect("Fizz should still be a built-in persona");
    assert!(
        fizz.system_prompt.starts_with("You are Fizz"),
        "upstream prompts must pass through untouched"
    );
}

#[test]
fn merge_personas_preserves_custom_records() {
    let custom = custom_persona("custom:test", "Custom");
    let (records, changed) = merge_personas(vec![custom.clone()], "2026-03-19T00:00:00Z");

    assert!(changed);
    assert!(records.iter().any(|record| record.id == custom.id));
}

#[test]
fn merge_personas_preserves_builtin_edits() {
    let mut edited_builtin = custom_persona("builtin:fizz", "My Fizz");
    edited_builtin.is_builtin = true;
    edited_builtin.is_active = true;
    edited_builtin.system_prompt = "User-edited instructions".to_string();
    edited_builtin.name_pool = vec!["User-edited name".to_string()];
    edited_builtin.env_vars =
        std::collections::BTreeMap::from([("USER_SETTING".to_string(), "value".to_string())]);

    let (records, changed) = merge_personas(vec![edited_builtin.clone()], "2026-03-19T00:00:00Z");

    assert!(changed); // The remaining seeded built-ins are added.
    let fizz = records
        .iter()
        .find(|record| record.id == "builtin:fizz")
        .expect("fizz built-in should exist");
    assert_eq!(fizz.display_name, edited_builtin.display_name);
    assert_eq!(fizz.system_prompt, edited_builtin.system_prompt);
    assert_eq!(fizz.name_pool, edited_builtin.name_pool);
    assert_eq!(fizz.env_vars, edited_builtin.env_vars);
    assert_eq!(fizz.is_active, edited_builtin.is_active);
}

#[test]
fn merge_personas_restores_builtin_marker_without_resetting_edits() {
    let mut edited_builtin = custom_persona("builtin:fizz", "My Fizz");
    edited_builtin.is_builtin = false;

    let (records, changed) = merge_personas(vec![edited_builtin], "2026-03-19T00:00:00Z");

    assert!(changed);
    let fizz = records
        .iter()
        .find(|record| record.id == "builtin:fizz")
        .expect("fizz built-in should exist");
    assert!(fizz.is_builtin);
    assert_eq!(fizz.display_name, "My Fizz");
}

#[test]
fn merge_personas_adds_fizz_and_retires_old_builtins_for_existing_store() {
    let mut legacy_builtins = vec![custom_persona("builtin:solo", "Solo")];
    for persona in &mut legacy_builtins {
        persona.is_builtin = true;
        persona.avatar_url = None;
    }

    let (records, changed) = merge_personas(legacy_builtins, "2026-03-19T00:00:00Z");

    assert!(changed);
    let fizz = records
        .iter()
        .find(|record| record.id == "builtin:fizz")
        .expect("fizz built-in should exist");
    assert!(fizz.is_builtin);
    assert!(fizz.is_active);

    let solo = records
        .iter()
        .find(|record| record.id == "builtin:solo")
        .expect("old solo record should be retained as retired custom persona");
    assert!(!solo.is_builtin);
    assert!(!solo.is_active);
    assert_eq!(solo.display_name, "Solo (retired)");
}

#[test]
fn merge_personas_demotes_retired_builtins() {
    // custom_persona uses "Custom prompt", which doesn't match the original
    // retired system prompt, so the migration pass soft-deprecates rather
    // than removes the record.
    let mut retired = custom_persona("builtin:reviewer", "Reviewer");
    retired.is_builtin = true;
    retired.is_active = true;
    let original_created_at = retired.created_at.clone();

    let (records, changed) = merge_personas(vec![retired], "2026-04-01T00:00:00Z");

    assert!(changed);
    let demoted = records
        .iter()
        .find(|record| record.id == "builtin:reviewer")
        .expect("retired built-in should be retained as a soft-deprecated custom persona");
    assert!(!demoted.is_builtin);
    // migrate_retired_personas deactivates customized retired personas.
    assert!(!demoted.is_active);
    assert_eq!(demoted.display_name, "Reviewer (retired)");
    assert_eq!(demoted.created_at, original_created_at);
    assert_eq!(demoted.updated_at, "2026-04-01T00:00:00Z");
}

#[test]
fn ensure_persona_is_active_rejects_missing_personas() {
    let err = ensure_persona_is_active(&[], "missing").unwrap_err();

    assert_eq!(err, "agent missing not found");
}

#[test]
fn ensure_persona_is_active_rejects_inactive_personas() {
    let mut persona = custom_persona("builtin:fizz", "Fizz");
    persona.is_builtin = true;
    persona.is_active = false;

    let err = ensure_persona_is_active(&[persona], "builtin:fizz").unwrap_err();

    assert_eq!(err, "Fizz is not in My Agents.");
}

#[test]
fn ensure_persona_ids_are_active_checks_each_requested_id() {
    let personas = vec![
        custom_persona("custom:alpha", "Alpha"),
        custom_persona("custom:beta", "Beta"),
    ];

    assert!(ensure_persona_ids_are_active(
        &personas,
        &["custom:alpha".to_string(), "custom:beta".to_string()],
    )
    .is_ok());
}

#[test]
fn validate_persona_activation_change_rejects_non_builtins() {
    let persona = custom_persona("custom:alpha", "Alpha");

    let err = validate_persona_activation_change(&persona, false, false, false).unwrap_err();

    assert_eq!(
        err,
        "Only built-in agents can be added to or removed from My Agents."
    );
}

#[test]
fn validate_persona_activation_change_rejects_managed_agent_references() {
    let mut persona = custom_persona("builtin:fizz", "Fizz");
    persona.is_builtin = true;

    let err = validate_persona_activation_change(&persona, false, true, false).unwrap_err();

    assert_eq!(
        err,
        "Fizz is still assigned to a managed agent. Remove or reassign those agents first."
    );
}

#[test]
fn validate_persona_activation_change_rejects_team_references() {
    let mut persona = custom_persona("builtin:fizz", "Fizz");
    persona.is_builtin = true;

    let err = validate_persona_activation_change(&persona, false, false, true).unwrap_err();

    assert_eq!(
        err,
        "Fizz is still referenced by a team. Remove it from those teams first."
    );
}

#[test]
fn validate_persona_activation_change_allows_safe_builtin_updates() {
    let mut persona = custom_persona("builtin:fizz", "Fizz");
    persona.is_builtin = true;

    assert!(validate_persona_activation_change(&persona, true, false, false).is_ok());
    assert!(validate_persona_activation_change(&persona, false, false, false).is_ok());
}

#[test]
fn validate_persona_deletion_rejects_builtins() {
    let mut persona = custom_persona("builtin:fizz", "Fizz");
    persona.is_builtin = true;

    let err = validate_persona_deletion(&persona, false).unwrap_err();

    assert_eq!(err, "Built-in agents cannot be deleted.");
}

#[test]
fn validate_persona_deletion_rejects_team_references() {
    let persona = custom_persona("custom:alpha", "Alpha");

    let err = validate_persona_deletion(&persona, true).unwrap_err();

    assert_eq!(
        err,
        "Alpha is still referenced by a team. Remove it from those teams first."
    );
}

#[test]
fn validate_persona_deletion_allows_safe_custom_personas() {
    let persona = custom_persona("custom:alpha", "Alpha");

    assert!(validate_persona_deletion(&persona, false).is_ok());
}

// ── migrate_retired_personas ──────────────────────────────────────────────────

#[test]
fn migrate_retires_unmodified_personas() {
    let now = "2026-04-01T00:00:00Z";
    // Simulate a store from before the Fizz transition: all 6
    // retired personas with original system prompts.
    let mut stored: Vec<AgentDefinition> = RETIRED_PERSONAS
        .iter()
        .map(|(id, prompt)| AgentDefinition {
            id: id.to_string(),
            system_prompt: prompt.to_string(),
            is_builtin: false, // already demoted by merge_personas
            ..custom_persona(id, "Test Persona")
        })
        .collect();

    let changed = migrate_retired_personas(&mut stored, now);

    assert!(changed);
    assert_eq!(
        stored.len(),
        RETIRED_PERSONAS.len(),
        "all retired personas should be soft-deprecated, not removed",
    );
    assert!(
        stored
            .iter()
            .all(|r| r.display_name.ends_with(" (retired)")),
        "all retired personas should have ' (retired)' suffix",
    );
    assert!(
        stored.iter().all(|r| !r.is_active),
        "all retired personas should be inactive",
    );
    assert!(
        stored.iter().all(|r| r.updated_at == now),
        "all retired personas should have refreshed updated_at",
    );
}

#[test]
fn migrate_preserves_customized_personas() {
    let now = "2026-04-01T00:00:00Z";
    let mut stored = vec![AgentDefinition {
        id: "builtin:researcher".to_string(),
        display_name: "My Researcher".to_string(),
        system_prompt: "My custom research workflow with special instructions".to_string(),
        is_builtin: false,
        is_active: true,
        shared: false,
        ..custom_persona("builtin:researcher", "My Researcher")
    }];

    let changed = migrate_retired_personas(&mut stored, now);

    assert!(changed);
    assert_eq!(stored.len(), 1);
    let record = &stored[0];
    assert_eq!(record.display_name, "My Researcher (retired)");
    assert!(!record.is_active);
    assert_eq!(
        record.system_prompt,
        "My custom research workflow with special instructions"
    );
    assert_eq!(record.updated_at, now);
}

#[test]
fn migrate_is_idempotent() {
    let now = "2026-04-01T00:00:00Z";

    // 1. Non-retired persona — no-op.
    let mut stored = vec![custom_persona("custom:test", "Custom")];
    assert!(!migrate_retired_personas(&mut stored, now));
    assert_eq!(stored.len(), 1);

    // 2. Already-retired persona (display_name ends with " (retired)") — no-op.
    let mut stored_with_retired = vec![AgentDefinition {
        id: "builtin:researcher".to_string(),
        display_name: "Researcher (retired)".to_string(),
        system_prompt: "My custom prompt".to_string(),
        is_builtin: false,
        is_active: false,
        shared: false,
        ..custom_persona("builtin:researcher", "Researcher (retired)")
    }];
    assert!(
        !migrate_retired_personas(&mut stored_with_retired, now),
        "already-retired persona should not trigger another change"
    );

    // 3. Retired persona still marked is_builtin: true (pre-demotion).
    // migrate_retired_personas should still soft-deprecate it.
    let mut stored_pre_demotion = vec![AgentDefinition {
        id: "builtin:reviewer".to_string(),
        display_name: "Reviewer".to_string(),
        system_prompt: "Custom review prompt".to_string(),
        is_builtin: true,
        is_active: true,
        shared: false,
        ..custom_persona("builtin:reviewer", "Reviewer")
    }];
    assert!(migrate_retired_personas(&mut stored_pre_demotion, now));
    assert_eq!(stored_pre_demotion[0].display_name, "Reviewer (retired)");
    assert!(!stored_pre_demotion[0].is_active);

    // 4. Run again on result of (3) — should be no-op.
    assert!(!migrate_retired_personas(&mut stored_pre_demotion, now));
}

// ── Fizz default harness ──────────────────────────────────────────────────────

#[test]
fn fizz_builtin_has_no_pinned_runtime() {
    // The Fizz built-in must not hard-pin a runtime so it inherits the
    // bundled default (buzz-agent) rather than requiring goose on PATH.
    let records = built_in_persona_records("2026-01-01T00:00:00Z");
    let fizz = records
        .iter()
        .find(|r| r.id == "builtin:fizz")
        .expect("builtin:fizz must exist");
    assert_eq!(
        fizz.runtime, None,
        "Fizz built-in must not pin a runtime — it should inherit the default"
    );
}

#[test]
fn fizz_builtin_resolves_to_buzz_agent() {
    // With no runtime pin, effective_agent_command must fall through to
    // default_agent_command(), which resolves the bundled buzz-agent.
    let records = built_in_persona_records("2026-01-01T00:00:00Z");
    assert_eq!(
        effective_agent_command(Some("builtin:fizz"), &records, None),
        default_agent_command(),
        "Fizz must resolve to the bundled default harness, not goose"
    );
    assert_eq!(
        effective_agent_command(Some("builtin:fizz"), &records, None),
        "buzz-agent",
        "Fizz must resolve to buzz-agent specifically"
    );
}

// ── Built-in art comes from the binary, not from when a row was written ───────

/// A stored definition row the way a v0.2.0 install left it: flagged built-in,
/// no art, because the art did not exist when the row was written.
fn stored_builtin(id: &str, display_name: &str, avatar_url: Option<&str>) -> AgentDefinition {
    AgentDefinition {
        is_builtin: true,
        avatar_url: avatar_url.map(|url| url.to_string()),
        ..custom_persona(id, display_name)
    }
}

#[test]
fn overlay_fills_an_empty_crew_avatar_from_the_binary() {
    // The defect exactly: rows persisted before the emblems shipped.
    let mut records = vec![
        stored_builtin("builtin:mate", "Mate", None),
        stored_builtin("builtin:bosun", "Bosun", Some("")),
    ];

    overlay_built_in_avatars(&mut records);

    for record in &records {
        let served = record
            .avatar_url
            .as_deref()
            .expect("a crew row must be served with art");
        assert_eq!(
            served,
            built_in_persona_avatar_url(&record.id).expect("crew art is compiled in"),
            "{} must be served the binary's emblem",
            record.id
        );
        assert!(
            served.starts_with("data:image/png;base64,"),
            "{} must be served the encoded PNG, not a placeholder",
            record.id
        );
    }
}

#[test]
fn overlay_never_overwrites_stored_art() {
    // Hand-set art is a decision; the overlay is a fallback and must lose to it.
    let mut records = vec![stored_builtin(
        "builtin:scribe",
        "Scribe",
        Some("https://example.com/hand-set.png"),
    )];

    overlay_built_in_avatars(&mut records);

    assert_eq!(
        records[0].avatar_url.as_deref(),
        Some("https://example.com/hand-set.png"),
        "a non-empty stored avatar must survive the overlay"
    );
}

#[test]
fn overlay_serves_a_bee_its_own_literal_through_the_same_door() {
    // Two lookups for built-in art would be two answers waiting to disagree.
    // The crew's art is encoded from pack PNGs and the bees' is a pasted
    // literal, but both must leave through `built_in_persona_avatar_url` — so
    // an empty bee row is served the *bee's* art, not nothing (which is what a
    // crew-only lookup would give it) and not a crew emblem.
    let mut records = vec![stored_builtin("builtin:honey", "Honey", None)];

    overlay_built_in_avatars(&mut records);

    let served = records[0]
        .avatar_url
        .as_deref()
        .expect("the shared accessor answers for a bee as well as for the crew");
    assert_eq!(
        Some(served),
        built_in_persona_avatar_url("builtin:honey"),
        "the overlay must resolve through the single built-in art accessor"
    );
    assert_ne!(
        Some(served),
        built_in_persona_avatar_url("builtin:mate"),
        "a bee must not be served a crew emblem"
    );
}

#[test]
fn overlay_skips_rows_that_are_not_built_in() {
    // A retired built-in is demoted to a custom record; it has no art in the
    // binary and must not acquire one here.
    let mut records = vec![
        custom_persona("custom:mine", "Mine"),
        AgentDefinition {
            avatar_url: None,
            ..custom_persona("builtin:mate", "Mate (a demoted row)")
        },
    ];

    overlay_built_in_avatars(&mut records);

    assert_eq!(
        records[0].avatar_url.as_deref(),
        Some("https://example.com/avatar.png"),
        "a custom persona's own avatar is untouched"
    );
    assert_eq!(
        records[1].avatar_url, None,
        "a row that is not flagged built-in gets no built-in art"
    );
}

#[test]
fn the_overlay_is_served_but_never_stored() {
    // The property the fold exists to hold together: a stale builtin row is
    // SERVED with the binary's emblem, while what goes back to disk — when the
    // merge changed anything at all — carries no overlay. Both halves through
    // the one pipeline `load_personas` runs, so deleting the overlay call in
    // `fold_personas_for_serving` (the mutation that once left every test
    // green) fails here.
    let records = vec![stored_builtin("builtin:mate", "Mate", None)];
    let folded = fold_personas_for_serving(records, "2026-08-13T00:00:00Z");

    let served_mate = folded
        .served
        .iter()
        .find(|r| r.id == "builtin:mate")
        .expect("mate is served");
    assert!(
        served_mate
            .avatar_url
            .as_deref()
            .is_some_and(|a| a.starts_with("data:image/png;base64,")),
        "the served row carries the binary's emblem"
    );

    if let Some(to_store) = &folded.to_store {
        let stored_mate = to_store
            .iter()
            .find(|r| r.id == "builtin:mate")
            .expect("mate is stored");
        assert!(
            stored_mate
                .avatar_url
                .as_deref()
                .is_none_or(|a| !a.starts_with("data:image/png;base64,")),
            "the stored row must never carry a compiled-in data URI"
        );
    }
}
