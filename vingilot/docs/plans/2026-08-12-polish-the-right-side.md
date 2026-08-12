# Polish the right side — one taste, one pass

> **For the (single) agentic worker:** this is a design pass, done by one agent end to end so it
> has one taste. Read everything named here before changing anything.
> **Branch:** `vingilot/finding-things`, after the finding-things workflow's work has landed.

**Goal:** the owner, looking at the new panes beside the team thread:

> *"team kısmına bak, buzz'dan direkt geçme. bir de diğerlerine bak. biraz zevksiz bir tasarım
> mevcut. şu an renksiz, cansız bir sağ sidebar var."*

He is right, and the diagnosis is structural: the Team pane inherited years of upstream design —
avatars, cards, hover states, spacing rhythm, color that carries meaning. The fork's own panes
(Files, Search, History, Source Control, and the pane chrome around the terminal) were each built
by a different hand against a deadline, in grayscale, with no shared vocabulary beyond the type
scale. They read as forms, not as a product.

**The reference is inside the app.** Not VS Code, not a dribbble shot: the Team pane and
upstream's chat surfaces are the taste this app already has. The right side must look like it was
drawn by the same person on the same day.

---

## The pass

- [ ] **Read first, and write the vocabulary down.** Before any edit: read the Team pane and two
      upstream chat surfaces (message list, channel sidebar) and extract the actual vocabulary —
      row heights, paddings, radii, hover/selected treatments, icon sizes, where color is allowed
      and what it means there. Then read every fork pane. Write the shared vocabulary as a short
      section in this file (append below) so the next pane starts from it.
- [ ] **Color that means something, nowhere else.** The app already has semantic hues: the
      attention states (rose/emerald/amber/muted ring), diff green/red, `+`/`−` numstat. Extend
      that, do not invent: git status letters get the colors every developer already knows
      (M amber, A/U green, D red, R blue); file rows in Source Control / History carry them; the
      match emphasis in Search gets a real highlight; the Files tree gets *restrained* file-kind
      cues (a tinted glyph or dot per kind — folder/code/config/doc/image — not a 400-icon set).
      Decoration for its own sake stays out: gray is still the ground, color is information.
- [ ] **Rows are the unit — make them all one row.** Files tree rows, search hits, commit rows,
      status-file rows, worktree rows: same height rhythm, same hover, same selected treatment,
      same truncation (dim the directory, keep the basename bright — History already half-does
      this; make it the rule). Keyboard focus visible everywhere.
- [ ] **Pane headers become one component in fact, not five imitations.** Title, count/meta on
      the right, the same divider, the same padding. If they already share one, make it look like
      they do.
- [ ] **Empty and loading states say something with substance.** "nothing selected — pick a
      commit to read its patch" in dim center text is a shrug. Each pane's empty state gets one
      designed moment: the pane's glyph, one sentence, one hint (the keyboard way in). No
      illustrations, no cheer — this is a tool.
- [ ] **The terminal's frame belongs to the family too**: the tab strip, the header row, and the
      persistence status line get the same header/row vocabulary. (The terminal *content* is
      xterm's and stays out of scope.)
- [ ] **Viewer life is part of this pass**: implement `2026-08-12-vscode-muscle-memory.md`
      Task 0 — async background highlighting, plain text rendered instantly, spans swapped in;
      the 150-line chat ceiling dies; the "to keep the terminal responsive" copy dies with it.
      A colored file body does more for "cansız" than any chrome.
- [ ] **Restraint is part of the brief.** No new fonts, no gradients, no shadows that upstream
      does not use, no animation beyond what the app already does, nothing that moves on its own.
      Stock rem tokens and the two meta tokens only (`pnpm check:px-text` gates it). If a change
      cannot be defended as "this is what the Team pane would do", it does not ship.

## Verification

One agent, but not one opinion:

- [ ] Every gate to real exit codes: `pnpm check`, `pnpm test`, `pnpm tsc --noEmit`,
      `check-seams.sh`, and the Playwright specs for every pane touched — the existing specs must
      stay green (they assert testids and sentences, which this pass must not break), and the
      geometry spec still holds (polish must not change widths).
- [ ] Screenshots before/after for each pane via the E2E harness (`workspace-readme-shots`
      pattern), saved to the scratchpad and listed in the report — the owner vetoes by eye,
      per pane.
- [ ] Every visual change listed one line each in the report, so a veto is cheap.

## Global Constraints

The standing set: `rm -rf` forbidden; never launch the app; no release builds; agents do not
commit; island + seams; 1000-line ratchet; an empty read is "no answer"; a test must be able to
fail; never bare `biome` (the shell hook wraps it — `pnpm check` and trust only the captured
exit); nothing outside the repo.

## Self-Review

**Riskiest:** taste drift. One agent is the mitigation the owner chose ("tek bir fable xhigh
ile") — but xhigh effort on a vague brief produces *more*, not *better*. The brief above is
deliberately a vocabulary-extraction first: if the vocabulary section does not get written before
the edits start, stop and write it.

**Most likely to be got wrong quietly:** breaking the pane specs' sentences. The empty states and
refusal sentences are pinned by tests on purpose; polish rewrites their *dress*, not their words
— any wording change is a stated decision with the test updated in the same breath.
