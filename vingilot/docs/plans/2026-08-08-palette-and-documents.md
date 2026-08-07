# The palette, and the two documents a project carries

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Branch:** `vingilot/palette` off `vingilot/panes`.

**Goal:** The pane host exists. Now fill it, and give the workspace the one thing that ties
every surface together — a way to get anywhere and do anything without hunting for it.

**Where this comes from:** the owner's own list, 2026-08-07 — *"shortcutlar, ⌘K ile hızlı bir
şeyler arama, /btw benzeri anlık soru sorma yazışma (bu ekranın ortasına popup gibi gelse güzel
olur, ilgili proje ile ilgili soru), normal chatte yazışma sonucu oluşturduğumuz planı agent bir
tool ile projelerin altına worktree ile açabilsin ve bunun için tabi plan sekmesi ekleyelim,
notlar ekleyelim … biraz Zed ve VS Code'dan kopya çekelim."*

---

## The two ideas underneath the list

**1. ⌘K is not a search box, it is the verb surface.** Zed and VS Code both converged on this:
one palette that answers *"go somewhere"* and *"do something"*, with the same keystroke and the
same list. Everything the workspace can do should be reachable there, which also means every
new action gets discoverability for free instead of needing a button somewhere.

**The `/btw` ask popup is a mode of the palette, not a second surface.** It appears in the same
place, from the same key, and differs only in what it does with what you type. Building it as
its own overlay would give the owner two centre-screen popups with different rules, which is
exactly the confusion the palette exists to remove.

**2. Plan and Notes are the same shape.** Both are *a document a project carries*, edited in a
pane, persisted per project, surviving restarts. They differ in what the workspace does with
them: a plan can be **turned into a worktree**, a note cannot. Build one document substrate,
put two panes on it — and if the second pane needs the substrate changed, that is the substrate
telling you it was shaped around the first.

---

## Deliberately not now

- **The Agent pane's real ACP backing.** No adapter is installed on this machine
  (`claude-agent-acp`, `codex-acp`, `goose` — all absent), `claude -p` is forbidden, and
  installing anything lives outside the repo, which needs the owner's say-so. **Flag it in the
  morning report; do not install.**
- **Source control (stage/commit/push).** Next after this branch. It is a pane, so it waits for
  nothing else now — it is simply the smaller prize than the palette.
- **LSP, a plugin API, Docker UI.** Unchanged from the previous plan's reasoning.

---

## Resource budget — a hard constraint, not advice

The owner, 2026-08-08: *"storage ya da RAM'i bitirme."* This machine has already lost both
once: the disk hit **99% (6.8 GiB free)** on 2026-08-07 from cargo artefacts alone, and an
out-of-memory earlier in the project took the whole app down. He works on this machine while
the work runs, so exhausting either is not a build failure, it is his day.

- **Never a release build.** `cargo build --release`, `pnpm tauri build`, and anything that
  produces a signed bundle are out. Debug artefacts are large enough.
- **One heavy build at a time.** Never two `cargo`/`pnpm build` invocations in flight together;
  cargo's own lock serialises within a target dir but not across the four in this repo.
- **Check before you build.** `df -h /System/Volumes/Data`. Below **20 GiB free**, stop and
  report rather than starting a build — do not "just try it".
- **Clean up what you created, with the tool's own verb.** `cargo clean --manifest-path …` is
  the only sanctioned way to reclaim a target dir. Never a recursive filesystem delete.
- **`CARGO_INCREMENTAL=0` is set in the owner's shell**; do not re-enable it, and do not add a
  `[build] incremental` to any config.
- Keep `pnpm build:e2e` runs to what a proof actually needs — each one rewrites `desktop/dist`,
  which is fine, but a build per assertion is not.

## Global Constraints

- Trailers: `Signed-off-by` FIRST, then `Co-authored-by`. `git commit -F` — **never `-s`**.
- **`rm -rf` forbidden, any path, including in generated scripts and test teardown.**
- **The owner uses this app for real work while it is being built.** Live tmux sessions on the
  default socket. Never `tmux kill-server`; never a tmux command without `-L <throwaway>`;
  never quit or relaunch his app.
- **Nothing outside this repo.** Not `~/.zshrc`, not another repo, not a system cache.
- Never `git add -A`. Never amend or rebase existing commits. Never kill a process you did not
  start.
- Island-first: `desktop/src/features/runs/**`, `desktop/src-tauri/src/vingilot_*/**`,
  `vingilot/**`. Anything else needs a `seams.yaml` entry with a real reason.
- Gates: `pnpm check && pnpm typecheck && pnpm test`; `cargo check`; `cargo fmt --check`;
  `check-seams.sh` exit 0. Playwright for anything that renders.
- **An empty read is "no answer", never "nothing there".** Broken twice on this project, both
  times hiding the owner's work.
- **A test must be able to fail.** The 80-column floor shipped landing 79 because its test
  checked the model's arithmetic against itself. Assert against what is rendered or stored, not
  against the formula under test.

---

## Task 1 — The palette

- [ ] `⌘K` opens a palette centred over the work surface. `Esc` closes, arrows move, `Enter`
      runs. Check the binding against the whole app and Tauri's default macOS menu first —
      upstream already has a "Search everything ⌘K" in the sidebar, so **find out what that
      does before claiming the key**, and say what you found. If it is taken, the honest
      outcomes are: extend it, or pick another key and explain.
- [ ] Sources, each a pure function from query to results: **projects**, **worktrees**,
      **panes** (choose what sits on the right), **actions** (new worktree, new terminal tab,
      toggle a column, prune, …). Ranked by a single tested scorer — a palette whose ordering
      is per-source is a palette that feels random.
- [ ] Empty query shows something useful (recents), not an empty box.
- [ ] Pure model in `lib/` with tests: matching, ranking, keyboard resolution.
- [ ] Commit `feat(runs): one key to go anywhere and do anything`.

## Task 2 — Ask, as a mode of the palette
- [ ] A prefix (`?` or `/ask` — pick one and say why) switches the palette from *find* to
      *ask*: the text becomes a question about the current project rather than a filter.
- [ ] The question and its answer land in a real conversation, not a toast — it must be
      possible to go back and read it. Reuse the app's existing chat surface rather than
      inventing a second message store; if that is not reachable from the island, say so and
      propose the smallest seam.
- [ ] **Scope is the honest part:** the answer's quality depends on what context is attached.
      State plainly, in the UI, what the question is being asked *with* (project, worktree,
      current diff?) — not a claim that it "knows about your project" when it was handed a path.
- [ ] Commit `feat(runs): ask about this project without leaving it`.

## Task 3 — The document substrate, and the Notes pane
- [ ] One store: a document per project (later: per worktree), markdown, persisted, restored.
      Decide where it lives and why — this is the first fork-owned thing on this branch that
      outlives a session, so say what happens if two windows edit it.
- [ ] **Notes pane** on the registry. Plain markdown editing, no ceremony.
- [ ] Autosave with a stated debounce, and a visible saved/unsaved state. Never silently lose
      an edit; never claim saved before it is.
- [ ] Commit `feat(runs): a project keeps its notes`.

## Task 4 — The Plan pane, and turning a plan into a worktree
- [ ] **Plan pane** on the same substrate — its own document, not a note with a flag.
- [ ] The action the owner asked for: **turn this plan into a worktree.** Branch name derived
      from the plan's title (offered, editable, never silently taken), worktree created through
      the existing `git worktree add` path from the previous branch, plan copied into it so the
      work carries its own brief.
- [ ] Reachable from the palette as well as from the pane.
- [ ] Failure paths are the feature: a branch that exists, a dirty tree, a title that is not a
      legal ref. Report, never force. **No `--force`, no filesystem delete, ever.**
- [ ] Commit `feat(runs): a plan becomes a worktree`.

## Task 5 — Proof
- [ ] Playwright over the real bundle: palette opens, finds a project, switches a pane, runs an
      action; ask-mode renders its scope; notes survive a reload; a plan creates a worktree
      against a temp repo.
- [ ] Update `vingilot/docs/workbench.md`.
- [ ] Commit `docs(vingilot): the palette, notes, and plans`.

## Self-Review

**Riskiest:** Task 2. "Ask about this project" is the easiest place on this branch to overclaim
— the difference between *a model that was handed a directory path* and *a model that knows the
codebase* is invisible in a nice UI and enormous in practice. The UI has to say which.

**Most likely to be got wrong quietly:** Task 3's autosave. A debounce that drops the last
keystroke on unmount loses work that the owner watched himself type, and no gate here can see
it — it needs a test that unmounts mid-debounce.
