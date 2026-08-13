use std::path::PathBuf;

use buzz_persona_pkg::{pack, validate};

use super::*;

/// The pack directory as `buzz-persona` sees it.
fn pack_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../vingilot/personas/vingilot-crew")
}

/// Every crew member: its id, the file it came from, and the persona `name`
/// the pack declares for it.
fn crew() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        (MATE_ID, MATE_PERSONA_FILE, "mate"),
        (BOSUN_ID, BOSUN_PERSONA_FILE, "bosun"),
        (LOOKOUT_ID, LOOKOUT_PERSONA_FILE, "lookout"),
        (NAVIGATOR_ID, NAVIGATOR_PERSONA_FILE, "navigator"),
        (SCRIBE_ID, SCRIBE_PERSONA_FILE, "scribe"),
    ]
}

/// The pack is the contract. If `buzz-persona` will not load it, nothing that
/// consumes it — this catalog, `buzz pack validate`, an outside importer —
/// works, so this is the first thing that must hold.
#[test]
fn pack_validates_clean_against_buzz_persona() {
    let report = validate::validate_pack(&pack_dir());
    assert_eq!(
        report.exit_code(),
        0,
        "vingilot-crew pack is not clean:\n{report}"
    );
}

#[test]
fn pack_declares_exactly_the_five_crew_personas() {
    let loaded = pack::load_pack(&pack_dir()).expect("vingilot-crew pack should load");
    assert_eq!(loaded.manifest.id, "vingilot-crew");

    let names: Vec<&str> = loaded
        .personas
        .iter()
        .map(|persona| persona.name.as_str())
        .collect();
    assert_eq!(
        names,
        vec!["mate", "bosun", "lookout", "navigator", "scribe"]
    );

    assert!(
        loaded.pack_instructions.is_some(),
        "the pack's shared house rules must load"
    );
}

/// The ids this catalog registers and the names the pack declares are the same
/// roster. Renaming one without the other is the drift this asserts away.
#[test]
fn built_in_ids_match_the_pack_persona_names() {
    let loaded = pack::load_pack(&pack_dir()).expect("vingilot-crew pack should load");
    for (id, _file, pack_name) in crew() {
        assert_eq!(id, format!("builtin:{pack_name}"));
        assert!(
            loaded.personas.iter().any(|p| p.name == pack_name),
            "pack has no persona named {pack_name}"
        );
    }
}

/// The compiled-in file and the file the pack loader reads must be the same
/// bytes — this is what makes `include_str!` safe instead of a second copy.
#[test]
fn compiled_prompts_are_the_pack_files() {
    let loaded = pack::load_pack(&pack_dir()).expect("vingilot-crew pack should load");
    for (_id, file, pack_name) in crew() {
        let persona = loaded
            .personas
            .iter()
            .find(|p| p.name == pack_name)
            .expect("persona present");
        assert_eq!(
            prompt_body(file).trim_end(),
            persona.prompt.trim_end(),
            "{pack_name}: compiled prompt differs from the loaded pack prompt"
        );
    }
}

#[test]
fn prompt_body_strips_frontmatter_from_every_crew_file() {
    for (id, file, _name) in crew() {
        let body = prompt_body(file);
        assert!(
            !body.starts_with("---"),
            "{id}: frontmatter delimiter survived into the system prompt"
        );
        assert!(
            !body.contains("display_name:"),
            "{id}: frontmatter key survived into the system prompt"
        );
        assert!(
            body.len() < file.len(),
            "{id}: nothing was stripped — the file has no frontmatter"
        );
    }
}

/// Upstream's built-in prompts are plain strings with no frontmatter. Routing
/// them through the same helper must not change them by a byte.
#[test]
fn prompt_body_passes_through_a_prompt_without_frontmatter() {
    const PLAIN: &str = "You are Honey, a warm and thoughtful communicator.";
    assert_eq!(prompt_body(PLAIN), PLAIN);
}

/// "Sağlam promptlara sahip" is the request, and the plan's self-review names
/// prompt quality as the riskiest part: a persona that is a paragraph of vibes
/// fails it. The spine — identity with the Captain's override, scope, refusals
/// by name, the house rules, a boundary sentence — is what makes it reviewable,
/// so it is asserted rather than trusted.
#[test]
fn every_crew_prompt_carries_the_spine() {
    for (id, file, _name) in crew() {
        let body = prompt_body(file);
        let missing = |needle: &str| format!("{id}: prompt is missing {needle:?}");

        // Identity, and the override that outranks the whole prompt.
        assert!(body.contains("Vingilot"), "{}", missing("Vingilot"));
        assert!(body.contains("Captain"), "{}", missing("Captain"));
        assert!(
            body.contains("overrides everything in this prompt"),
            "{}",
            missing("the Captain's override")
        );

        // Scope: what it may and may not touch.
        assert!(body.contains("You may not"), "{}", missing("You may not"));

        // Refusals, by name — the broker's vocabulary is the model.
        assert!(
            body.contains("Refusals, by name"),
            "{}",
            missing("a refusals section")
        );
        assert!(
            body.matches("refused_").count() >= 5,
            "{id}: fewer than five named refusals"
        );

        // The house rules that bind every agent here.
        assert!(
            body.contains("`rm -rf` is forbidden"),
            "{}",
            missing("the rm -rf rule")
        );
        assert!(
            body.contains("An empty read is \"no answer\""),
            "{}",
            missing("the empty-read rule")
        );
        assert!(
            body.contains("Verify against artifacts") || body.contains("verify against artifacts"),
            "{}",
            missing("the verify-against-artifacts rule")
        );
        assert!(
            body.contains("Never claim what was not run"),
            "{}",
            missing("the never-claim rule")
        );

        // The boundary sentence: what leaves this machine, enumerable and true.
        assert!(
            body.contains("What you send off this machine"),
            "{}",
            missing("the boundary section")
        );
        assert!(
            body.contains("Nothing but the messages"),
            "{}",
            missing("the boundary sentence")
        );
    }
}

/// Each prompt is written for its own job — the roster's whole point. A copy of
/// one persona pasted under another's name would pass every structural
/// assertion above, so the distinguishing instruction is pinned per member.
#[test]
fn each_prompt_is_written_for_its_own_job() {
    assert!(prompt_body(MATE_PERSONA_FILE).contains("engrams"));
    assert!(prompt_body(BOSUN_PERSONA_FILE).contains("smallest change that restores the ship"));
    assert!(prompt_body(LOOKOUT_PERSONA_FILE).contains("refused_edit"));
    assert!(prompt_body(NAVIGATOR_PERSONA_FILE).contains("refused_implementation"));
    assert!(prompt_body(SCRIBE_PERSONA_FILE).contains("refused_invention"));
}

/// The identity decision from the assistant plan: Mate is an owner-only DM, so
/// it is never seeded into the team channel. The other four are.
#[test]
fn welcome_team_seeds_the_crew_without_mate() {
    assert_eq!(
        WELCOME_TEAM_PERSONA_IDS,
        &[NAVIGATOR_ID, BOSUN_ID, LOOKOUT_ID, SCRIBE_ID]
    );
    assert!(
        !WELCOME_TEAM_PERSONA_IDS.contains(&MATE_ID),
        "Mate is owner-only DM and must not be seeded into the channel"
    );
}

#[test]
fn welcome_team_ids_are_crew_ids_and_unique() {
    let ids: Vec<&str> = crew().iter().map(|(id, _, _)| *id).collect();
    for seeded in WELCOME_TEAM_PERSONA_IDS {
        assert!(ids.contains(seeded), "{seeded} is not a crew persona id");
    }
    let mut sorted = WELCOME_TEAM_PERSONA_IDS.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(sorted.len(), WELCOME_TEAM_PERSONA_IDS.len());
}
