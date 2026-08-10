# The four things that sent him back to VS Code

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Branch:** `vingilot/finding-things` off `main`.

**Goal:** He opened VS Code today, and said exactly why:

> *"bugün işte ne için vscode açtım biliyor musun. projede cmd shift f yapıp bir şey bulmak
> için."*

The workspace's whole claim is that he does not leave it. He left it to search. That is the
gap, and beside it are three defects he hit in the same sitting:

> *"16 inch macbook pro'ya bile şu an diff sidebar sığmıyor, diff görünmüyor… team chat açıkken
> cmd k yaparsam bazı şeyler cmd k'nın önüne geliyor, textler… üstteki prompt mudur nedir çok
> sinir bozucu, onu kapatma ya da küçültme tuşu da gelmeli."*

**Fixes first, and in their own commits.** He is using this build now; a defect he reports
twice is worse than a feature he is waiting for.

---

## Task 1 — The three defects

- [ ] **The diff does not fit a 16-inch screen.** Reproduce it at his geometry before changing
      anything — the diff pane renders a file list beside a patch, and the work surface already
      has a floor that keeps the terminal at 80 columns (`lib/paneModel.ts`). Find out which
      constraint actually squeezes it, and say which. Then make the diff readable at that width:
      the file list and the patch cannot both hold their ground, so one of them yields, and
      what yields must be a stated decision rather than whatever the flexbox does. Test at the
      widths he owns, not at a convenient one.
- [ ] **⌘K is drawn under things while the team thread is open.** Something in the hosted
      channel surface paints above the palette. Find what — a z-index, a portal, a stacking
      context created by a transform — and say which, because "raise the palette" without
      knowing is how the next surface lands on top of it too.
- [ ] **The team thread's header cannot be dismissed.** The scope sentence is deliberately long
      — it enumerates what is and is not sent — and it earns that on first read and never
      again. Give it a way to collapse or close, remember the choice per thread, and keep the
      full text one gesture away. Do not shorten the sentence to solve a layout problem: what
      it says is the honest part.

## Task 2 — Finding a thing

`⌘⇧F` is the whole reason he left. This is the task that decides whether he comes back.

- [ ] **Read first, report before building:** what search already exists in this app — upstream's
      `⌘K` is a *navigation* palette over projects, worktrees, panes and actions, and
      `features/search` searches the relay (messages), not the checkout. Neither reads files.
      Say what can be reused and what genuinely has to be new.
- [ ] Search the **selected worktree's checkout**, not an index the app maintains: `git grep`
      already knows the tree, respects `.gitignore`, and cannot go stale. State the cost and
      what happens on a huge repo, rather than discovering it on his monorepo.
- [ ] Results that are a door: file, line, and the matching line's text, keyboard-navigable,
      and opening one lands somewhere that shows the file — which means Task 3 is its
      dependency, not its sequel.
- [ ] Honest bounds: a result cap, a "still searching" state, and what it does when git refuses.
      A search that silently truncates is a search that lies about what is in the repo.

## Task 3 — Seeing a file

- [ ] A file tree for the selected worktree, and a viewer. It does not need to be an editor —
      he has terminals and agents for changing things — but a file he cannot open is a file he
      leaves to find elsewhere.
- [ ] Syntax highlighting: the app already ships Shiki for markdown code blocks. Reuse it
      rather than adding a second highlighter, and say what that costs on a large file.
- [ ] The tree is a pane on the registry like every other, and obeys the recorded type scale.
- [ ] Large files, binary files and unreadable files each get their own sentence.

## Task 4 — What git already knows

- [ ] Commit history for the worktree, and the diff of a commit — the two things he named. The
      diff pane already renders patches; a commit is another patch source, so this is mostly
      about where the patch comes from rather than how it is drawn.
- [ ] Source control as a surface: what is staged, what is not, what would be committed. **Read
      before deciding how far to go** — committing from the app is a different promise from
      showing state, and the terminal is one keystroke away. Say where you drew the line.
- [ ] Everything reads; nothing rewrites history. No amend, no rebase, no force, no discard of
      uncommitted work from a click.

---

## Global Constraints

- **`rm -rf` forbidden**, any path, including test teardown.
- **Never launch the app or any GUI**; **do not run a release build.**
- **His work is in these checkouts.** Read-only against his real repos: no `git checkout`,
  no `git clean`, no `git reset`, no stash pop. Never touch the default tmux socket. Never kill
  a process you did not start. **Nothing outside this repo.**
- Never `git add -A`; never amend, rebase, or force-push. Trailers `Signed-off-by` then
  `Co-authored-by`; `git commit -F`, never `-s`.
- Island-first; anything outside `desktop/src/features/runs/**` and `vingilot_*/**` needs a
  `vingilot/seams.yaml` entry with a true, specific reason.
- **An empty read is "no answer", never "nothing there."**
- **A test must be able to fail** — prove each new test red by breaking what it guards.
- The fork's own CI builds a `.dmg` and runs no lints, which is how three clippy errors reached
  upstream's CI unnoticed. Run `cargo clippy --all-targets -- -D warnings` yourself.

## Self-Review

**Riskiest:** Task 2's cost on a real repo. `git grep` on a monorepo with a cold page cache can
take seconds, and a search box that freezes the workspace is worse than no search box —
he already has a terminal that does this without blocking anything. Whatever is built streams
or bounds, and says which.

**Most likely to be got wrong quietly:** Task 1's diff fix. "It fits now" is easy to produce on
a 27-inch display and impossible to notice failing on a laptop. The width he actually uses is
the test, and it belongs in a spec rather than in a screenshot taken once.
