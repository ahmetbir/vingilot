# ADR-005 — What kind of IDE Vingilot is

- **Status:** Accepted (owner, 2026-08-12)
- **Date:** 2026-08-12
- **Related:** ADR-001 (upstream boundary), ADR-003 (trust boundary),
  `vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md` (the work),
  `vingilot/docs/research/2026-08-11-market-survey-prompt.md` (the crowded-ground evidence)

## Context

Real feedback from a working developer (Cursor + Claude daily, relayed 2026-08-12):

> *"ide görmeden terminalden 'gerçek geliştirme' yapılmasına sıcak bakmıyom, saygı duymuyom."*

The sentence is about **seeing**, not typing. In agent-era development the code is mostly written
by the agent; what makes Cursor an IDE to this cohort is that the work is *legible* — file, diff,
structure, all visible. Trust in AI-driven work comes from the verification surface. The same
developer flees Cursor to iTerm to run agents unwatched — which is precisely the job Vingilot was
built for. So the two products fail in opposite directions: the IDE lacks the agent surface, the
agent surface lacks the IDE.

The market survey adds the boundary: editing intelligence (completions, refactoring) is where
Cursor, VS Code, JetBrains and Zed have spent thousands of person-years. Entering it is the
named losing move.

## Decision

**Vingilot is the IDE of the part of development that happens around the agent: reading,
deciding, directing.** Concretely, a ladder — each rung committed, the top rung refused:

1. **A first-class reading IDE.** Tree, viewer, project search, history, commit diff, source
   control — shipped; brought to life (highlighting, polish) as already planned.
2. **Light editing, not an editor.** The viewer gains an edit mode (CodeMirror 6): open, fix,
   save — the "reach out your hand while reading" gesture. No completion engine, no refactors.
3. **The escape hatch is a feature.** "Open in VS Code / Cursor" at file:line, one gesture,
   everywhere a file is shown. Sending the owner to VS Code deliberately beats losing him to it.
   Its mirror is `vingilot .` in a terminal opening the Deck — the door swings both ways.
4. **LSP in service of reading.** Hover, go-to-definition and diagnostics make *review* better —
   a symbol in a diff answers where it lives; the problems an agent introduced are listable.
   That subset, when reached, is welcome.
5. **Refused:** completions, refactoring engines, and debuggers. The terminal is one keystroke
   away and the incumbents are unbeatable there; the survey's "three things not to build" stands.

One palette engine under three doors, matching both muscle memories: **⌘K = go** (channels,
projects, worktrees, recent files — everywhere, one behaviour, ending the current route-split),
**⌘P = files**, **⌘⇧P = commands**, with VS Code's prefix grammar (`>`, `#`) switching modes
inside any of them.

## Consequences

- Every future "should Vingilot do X" gets tested against the ladder: does X serve reading,
  deciding, or directing? If it serves *typing*, it must fit rung 2's one-sentence scope or it
  is the escape hatch's job.
- The ⌘K unification touches upstream's chat chrome and needs a seams entry and care — it is the
  first fork feature deliberately replacing an upstream gesture app-wide (ADR-001 discipline
  applies: host, don't rewrite).
- Rung 2 puts a write path into the viewer. ADR-003's trust boundary applies unchanged: the app
  writes only where the owner explicitly acts, and nothing rewrites history.
