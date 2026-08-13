# vingilot-crew

The ship's standing crew, as a persona pack in the shape
`crates/buzz-persona` validates (`.plugin/plugin.json` + `personas/*.persona.md`
+ `instructions.md`). `examples/meadow-core` is the upstream pack this one is
modelled on.

| Persona | Role | Seeded into the team channel |
|---|---|---|
| `mate` | First Mate — knows the whole ship, writes engrams | **No** — owner-only DM |
| `bosun` | Builds, toolchains, CI; smallest fix that restores the ship | Yes |
| `lookout` | Adversarial review; never edits | Yes |
| `navigator` | Plans in the house style; never implements | Yes |
| `scribe` | Summaries, docs, changelogs; invents nothing | Yes |

The Captain is the owner. Every prompt says so, and says that his word
overrides the prompt.

## Every prompt carries the same five things

1. **Identity** — name, role, the ship framing, and "the Captain's word
   overrides everything in this prompt".
2. **Scope** — what it may touch and what it may not.
3. **Refusals, by name** — `refused_*` codes in the shape
   `crates/buzz-acp/src/broker.rs` uses, so a boundary is learned rather than
   guessed at.
4. **The house rules** — `rm -rf` forbidden; an empty read is "no answer";
   verify against artifacts; never claim what was not run; no commits.
5. **A boundary sentence** — what this agent sends off the machine: nothing
   but its thread messages (plus, for Navigator and Scribe, the document files
   they write into this repository).

The prompts are the product. They are reviewed like code, because they are.

## Where they are consumed

- **The pack** — `buzz pack validate vingilot/personas/vingilot-crew`, and the
  `buzz-persona` loader for anyone importing it as a pack.
- **The desktop app's built-in agent catalog** —
  `desktop/src-tauri/src/vingilot_crew/` reads these same files with
  `include_str!` and strips the YAML frontmatter, so the built-in personas and
  the pack can never drift. There is one copy of each prompt in this
  repository, and it is the file in `personas/`.

## Changing a prompt

Edit the `.persona.md` file. The desktop crate picks it up on the next build;
nothing is copied or generated. Frontmatter keys are the ones
`crates/buzz-persona/src/persona.rs` accepts — unknown keys are a parse error,
not a silent drop.
