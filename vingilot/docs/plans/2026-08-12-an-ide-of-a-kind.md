# An IDE of a kind — the ladder, as work

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Decided in:** `vingilot/docs/adr/ADR-005-what-kind-of-ide.md`. Read it first; it is the test
> every sub-decision here is held against.
> **Order in the queue:** after `2026-08-12-polish-the-right-side.md` and the muscle-memory plan.

## Task 1 — The escape hatch, both directions

The cheapest trust in the plan.

- [ ] **Out:** "Open in editor" wherever a file is shown — Files viewer, search hit, diff file
      row, source-control row — opening VS Code/Cursor/Zed at file:line. Detect what is
      installed (`code`, `cursor`, `zed` CLIs; `open -a` fallback), remember the choice, never
      guess between two. The gesture is one keystroke (`⌘⇧O`?) and a row in ⌘K.
- [ ] **In:** a `vingilot` CLI shim, installed the way VelaTerm installs its shims (an app-owned
      bin dir prepended to *our* terminals' PATH; an explicit "install to /usr/local/bin" action
      for outside terminals — never a silent write outside the app's own dirs).
      `vingilot .` opens the app on this directory: if it is a known project, select it in the
      Deck; if it is a worktree of one, land on that worktree; if unknown, open the add-project
      flow pre-filled. `vingilot <file>[:line]` lands in the Files viewer. The owner marked
      `vingilot .` as "belki" — build the shim for files first, and the `.` behaviour behind it.
- [ ] Tests: the target-resolution logic (path → project/worktree/file) is pure and unit-tested;
      the shim is exercised by a test that runs it against a fake `open` recorder.

## Task 2 — One palette engine, three doors

- [ ] Extract the workspace palette's engine (input, ranking, keyboard loop, row rendering) so
      it can host multiple *sources* — it already half-does this (`paletteSources.ts`).
- [ ] **⌘K = go**, one behaviour app-wide: channels (upstream's switcher entries), projects,
      worktrees, recent files. This replaces the route-split where ⌘K means upstream's dialog in
      chat and ours in the workspace — the owner named it: *"cmd k buzz kısmında farklı deck
      kısmında farklı çalışıyor."* Hosting upstream's channel list as a source, not rewriting
      their dialog (ADR-001 discipline; seams entry for the swap point).
- [ ] **⌘P = files** in the selected worktree (the Files pane's listing is the source),
      **⌘⇧P = commands** (today's actions). Prefix grammar inside any door: `>` commands,
      `#` channels — VS Code's own.
- [ ] The cheatsheet and the palette teach the grammar (one hint row, not a tutorial).
- [ ] Tests: source-merging and prefix routing unit-tested; a spec per door; the chat-side ⌘K
      spec updated deliberately (its old assertion described the split this removes).

## Task 3 — Light editing in the viewer

- [ ] CodeMirror 6 in the Files viewer behind an explicit edit toggle (`e` / a pencil affordance
      — reading stays the default and stays instant). Same Shiki-adjacent look: reuse the theme
      tokens, not a second color scheme.
- [ ] Save writes through a new bounded Rust command (`file_write`: refuses over-cap, binary,
      and paths outside the worktree — same refusal-sentence style as `file_read`). Dirty state
      is visible; ⌘S saves; closing with unsaved changes asks.
- [ ] **The scope sentence is part of the feature:** no format-on-save, no completions, no
      multi-file operations. One file, opened, fixed, saved. The plan's test for creep: if a
      change needs a second file open for editing, it is the escape hatch's job.
- [ ] Tests: the write command's refusals (cargo, against a temp repo); an e2e: open → edit →
      save → the diff pane sees the change (the loop that proves the surfaces compose).

## Task 4 — LSP in service of reading (gated: design first)

- [ ] A design note before any code: which servers (rust-analyzer, tsserver/vtsls, gopls —
      detected, never installed by us), lifecycle per worktree, cost when several worktrees are
      open, and what happens when the server is absent (an honest sentence, not a spinner).
- [ ] First and only first: **hover + go-to-definition in the diff and the viewer**, and a
      diagnostics list per worktree. Nothing that writes. Completions are refused by ADR-005.
- [ ] This task does not start until Tasks 1–3 shipped and the owner re-approves — it is the
      expensive rung and the ladder is the point.

---

## Global Constraints

The standing set: `rm -rf` forbidden; never launch the app; no release builds; agents never
commit; island + seams; stock rem tokens (`pnpm check:px-text`); 1000-line ratchet; an empty
read is "no answer"; a test must be able to fail (one designated mutation agent); gates to real
exit codes; never bare `biome`; no commit stamps inside 08:00–18:00 Europe/Istanbul.

## Self-Review

**Riskiest:** Task 2's chat-side ⌘K. It is the first deliberate replacement of an upstream
gesture app-wide; done as a rewrite it breaks ADR-001, done as hosting it needs one careful seam.
The mitigation is written into the task: upstream's channel list is a *source*, their dialog is
not rewritten.

**Most likely to be got wrong quietly:** Task 3 growing an editor. The one-sentence scope is in
the task so that a verifier can hold a diff against it; any completion popup, any second pane of
editable text, is a finding regardless of how useful it looks.
