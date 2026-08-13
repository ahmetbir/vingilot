//! The crew — Vingilot's default agents, and the one place their prompts live.
//!
//! The app is a ship and the owner is the Captain; the crew are named for ship
//! roles so the name *is* the job description: Mate, Bosun, Lookout, Navigator,
//! Scribe (`vingilot/docs/plans/2026-08-12-the-crew.md`).
//!
//! # Why this module exists at all
//!
//! The prompts are the product, so they are files in a persona pack —
//! `vingilot/personas/vingilot-crew/`, in exactly the shape
//! `crates/buzz-persona` validates — reviewed like code, because they are. But
//! the desktop app's built-in agent catalog ([`super::personas`]) wants a
//! `&'static str` system prompt, not a pack loaded from disk at runtime.
//!
//! So the pack files are compiled in with [`include_str!`] and the YAML
//! frontmatter is split off with **`buzz-persona`'s own splitter** — the same
//! function the pack loader uses. There is one copy of each prompt in this
//! repository (the `.persona.md` file), one parser for it, and therefore no way
//! for the pack and the built-in catalog to drift apart. Nothing is generated
//! and nothing is copied; editing the pack file is the whole edit.
//!
//! # What this module does not do
//!
//! It does not mint agents, join channels, register a Tauri command, or know
//! anything about the relay — which is why it sits under `managed_agents/`
//! rather than beside the other `vingilot_*` islands at the crate root. It
//! answers two questions and stops: which personas are the crew, and which of
//! them the welcome team seeds. Minting is the rest of `managed_agents/`; the
//! seeding decision is consumed by [`super::teams`] and the frontend's
//! `welcomeGuide.ts`.

use buzz_persona_pkg::persona::split_frontmatter;

/// Persona ids for the crew. These are the ids the built-in catalog registers
/// (`managed_agents::personas::BUILT_IN_PERSONAS`), the ids the welcome team
/// references, and the ids the frontend's `WELCOME_TEAM_STARTERS` mirrors.
pub(crate) const MATE_ID: &str = "builtin:mate";
pub(crate) const BOSUN_ID: &str = "builtin:bosun";
pub(crate) const LOOKOUT_ID: &str = "builtin:lookout";
pub(crate) const NAVIGATOR_ID: &str = "builtin:navigator";
pub(crate) const SCRIBE_ID: &str = "builtin:scribe";

/// The `.persona.md` files, verbatim — frontmatter included. Pass each through
/// [`prompt_body`] before it reaches an agent.
pub(crate) const MATE_PERSONA_FILE: &str =
    include_str!("../../../../../vingilot/personas/vingilot-crew/personas/mate.persona.md");
pub(crate) const BOSUN_PERSONA_FILE: &str =
    include_str!("../../../../../vingilot/personas/vingilot-crew/personas/bosun.persona.md");
pub(crate) const LOOKOUT_PERSONA_FILE: &str =
    include_str!("../../../../../vingilot/personas/vingilot-crew/personas/lookout.persona.md");
pub(crate) const NAVIGATOR_PERSONA_FILE: &str =
    include_str!("../../../../../vingilot/personas/vingilot-crew/personas/navigator.persona.md");
pub(crate) const SCRIBE_PERSONA_FILE: &str =
    include_str!("../../../../../vingilot/personas/vingilot-crew/personas/scribe.persona.md");

/// The crew members the welcome team seeds into the team channel, in the order
/// they are provisioned — the first is the lead, the rest are its teammates.
///
/// **Mate is deliberately absent.** The assistant's identity decision
/// (`vingilot/docs/plans/2026-08-09-the-assistant.md`) makes it an owner-only
/// DM, so it is a built-in persona the Captain can reach directly and never a
/// member of a channel. Adding it here would silently reverse that decision,
/// which is why the exclusion is asserted by a test rather than left to a
/// comment.
pub(crate) const WELCOME_TEAM_PERSONA_IDS: &[&str] =
    &[NAVIGATOR_ID, BOSUN_ID, LOOKOUT_ID, SCRIBE_ID];

/// The markdown body of a `.persona.md` file — the system prompt, with the YAML
/// frontmatter removed.
///
/// Delegates to `buzz-persona`'s `split_frontmatter`, so "what counts as
/// frontmatter" is decided in exactly one place for both the pack loader and
/// this catalog. A string with no frontmatter is returned unchanged, which is
/// what the upstream bee prompts (plain strings, no delimiters) need — and
/// [`tests`] proves every crew file really does split, so the passthrough is
/// never how a crew prompt reaches an agent.
pub(crate) fn prompt_body(raw: &'static str) -> &'static str {
    match split_frontmatter(raw) {
        Ok((_frontmatter, body)) => body,
        Err(_) => raw,
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
