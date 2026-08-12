# Seeing a file — the Files pane

> Design note for `vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md`, **Task 3**.
> Written before the code, per the task. Task 2 (search) is the caller this is built for;
> §6 is the part Task 2 must not reimplement.

---

## 1. What this is, and what it deliberately is not

Task 3's sentence is *"a file he cannot open is a file he leaves to find elsewhere."* So: a
tree for the selected worktree, and a viewer. **Not an editor.** He has terminals and agents
for changing things, and an editor is a different promise — undo, saves, conflict with the
agent writing the same file two panes over. Everything here reads.

Three things follow from that and they are the whole design:

1. **The Rust side never walks a tree.** It lists **one directory** per call. A recursive
   walk of a monorepo is a freeze, and a freeze in the pane he opened to *avoid* leaving is
   worse than VS Code.
2. **Every refusal is a sentence, and each refusal is its own sentence.** Too large, binary,
   unreadable — three different next actions for him, so three different sentences, each one
   tested.
3. **The viewer has a door from outside.** Task 2's results are *"a door: file, line, and the
   matching line's text… opening one lands somewhere that shows the file."* That landing has
   to exist before Task 2 is written, and be the same landing the pane uses itself.

---

## 2. Rust: `desktop/src-tauri/src/vingilot_files/`

A new fork-owned island beside `vingilot_worktree`, kept apart from it on purpose:
`vingilot_worktree`'s contract is *worktree administration* (it is the module that runs
`worktree add`/`remove` and argues about `--force`). Reading a file out of a checkout is not
administration of anything, and putting it there would put a filesystem read behind a module
whose header promises it only ever talks to git.

Three files: `mod.rs` (errors, the path guard, the two commands), `tree.rs` (one directory
level), `read.rs` (one bounded file).

### 2.1 `worktree_tree(worktree, dir) -> TreeListing`

```
TreeListing { dir: String, entries: Vec<TreeEntry>, truncated: bool, limit: usize }
TreeEntry   { name: String, kind: "file" | "directory", size: Option<u64> }
```

**Lazy, one level, every time.** `dir` is a repo-relative path (`""` for the root). Expanding
a node is another call. Nothing anywhere in this module recurses, and there is no cache that
would have to be invalidated when an agent writes into the worktree the pane is showing.

**.gitignore is respected by asking git, not by parsing anything.** The listing comes from

```
git -C <worktree> ls-files --cached --others --exclude-standard -z -- <dir>/
```

and the reason is that this is *git's own answer about what belongs to this checkout* — the
same source of truth the Diff pane already uses (`vingilot_worktree/diff.rs` lists untracked
files with the same two flags) and the same one `git grep` will give Task 2. A second
implementation of ignore-matching is a second opinion about the owner's repository, which is
the last thing this app should have; and `.gitignore` is not one file — it is per-directory
files, `.git/info/exclude`, the global excludesfile and `core.excludesFile`, all of which
`--exclude-standard` already knows and a hand-rolled matcher would get subtly wrong on the
one repo that mattered.

`ls-files` reports paths recursively, so the one-level view is **derived**: take each path's
first component after `dir`, and a component with anything after it is a directory. That is
an O(entries-under-dir) string pass over an index scan, not a filesystem walk — and the
pathspec is what bounds it. Listing `desktop/src/features/runs/` on a monorepo enumerates
that subtree only. Listing the root enumerates the index, which is the one call whose cost is
the repository's size, and it is an index read (memory-mapped, sorted) rather than ~N `stat`
calls.

**What this costs, said plainly.** Two consequences of asking git rather than reading the
directory, and both are the right trade but neither is free:

- *A directory holding only ignored files does not appear.* `node_modules/` is not in the
  tree. That is correct for the pane's purpose — there is nothing in it he wants to open —
  but it is a difference from Finder and from `ls`, and the pane says "ignored files are not
  listed" in its footer rather than letting him wonder.
- *An empty directory does not appear*, because git does not track them. Same footer.

`.git/` never appears, for free, because git does not list it.

**Sizes come from `fs::metadata`, one `stat` per file in the directory being listed** — not
from git, which does not know the working-tree size of a tracked file without hashing it. It
is one level, and capped (below), so it is bounded by `MAX_ENTRIES` syscalls per expand. A
`stat` that fails leaves `size: None`; a size this app could not read is not a size of zero.

**`MAX_ENTRIES = 2_000` per directory**, and `truncated`/`limit` travel back with the answer
so the pane states the real number rather than a second copy of it. A directory with 40,000
generated files is a thing to *notice*, not to page through.

### 2.2 `file_read(worktree, path) -> FileText`

```
FileText { path: String, text: String, bytes: usize, lines: usize }
```

Three bounds, checked in this order, each with its own error variant and its own sentence:

| # | Check | Variant | Sentence carries |
|---|-------|---------|------------------|
| 1 | `metadata.len() > 512 KiB` | `TooLarge { path, size, cap }` | **the actual size** and the cap |
| 2 | NUL byte in the first 8 KiB | `Binary { path }` | that it is not text |
| 3 | open/read failed | `Unreadable { path, detail }` | the OS error, verbatim |

**512 KiB** is the cap because it is comfortably past every source file in this repository and
comfortably below the point where handing a string across the Tauri IPC and into a React tree
is felt. It is checked against `metadata` **before the file is opened**, so a 4 GB file costs
one `stat` and not 4 GB of reads — the same lesson `vingilot_worktree/diff.rs` paid for with
an agent's 191 MB `run.log`.

**The NUL sniff is the first 8 KiB**, which is what `git diff` itself uses to decide a file is
binary, and it is a heuristic rather than a proof — a UTF-16 file has NULs everywhere and is
correctly refused; a 9 KiB header of ASCII in front of a blob is not. The refusal names it as
"looks binary", not as "is binary", because that is the claim the check supports.

Invalid UTF-8 **without** a NUL is *not* a fourth refusal: it is read lossily and shown. A
Latin-1 changelog is a file he can read, and a fourth sentence about encodings is a sentence
about an edge he does not have.

`size` is reported for the too-large refusal because "too large" without a number is a
sentence he can do nothing with; with it, he knows whether to reach for `less` or for `head`.

### 2.3 The path guard, and why it is not optional

Both commands take a caller-supplied relative path. The guard is in `mod.rs`, in one place,
used by both:

1. Reject an absolute path, and reject any `..` component, before touching the disk.
2. `canonicalize(worktree.join(rel))` and require the result to start with
   `canonicalize(worktree)`.

Step 2 is what step 1 cannot do: a **symlink** inside the checkout pointing at `~/.ssh` has no
`..` in its path. Both are `OutsidePath { path }`, which is its own sentence — this app reads
inside the worktree you selected, and that link goes outside it. Task 2 will hand this module
paths that came out of `git grep`, and a route from a search result to an arbitrary file read
is exactly the shape that must be closed before there is a caller for it.

### 2.4 Both commands are `async`

For the reason `vingilot_worktree/mod.rs` documents at `off_thread`: a `#[tauri::command] fn`
is generated `ExecutionContext::Blocking` and is inlined into the IPC handler — the macOS main
thread. A `git ls-files` over a monorepo index there is a stall in the terminal, which is the
product. The same `accepts_only_a_future` test guards it here.

---

## 3. Frontend: the pane, and where the thinking lives

Island only, under `desktop/src/features/runs/`.

```
lib/filesModel.ts    tree state: nodes, expansion, flattening, selection, keys   (pure)
lib/fileViewer.ts    language from path, the highlight decision, refusal words    (pure)
lib/filesClient.ts   the two invokes, answering rather than throwing
lib/filesTarget.ts   the door from outside (§6)                                   (pure)
ui/FilesPane.tsx     tree left, viewer right
```

The split is the same one every other pane in this island uses and for the same reason: an
availability rule or a key map that needed React could not be tested. `FilesPane.tsx` holds
effects, layout and Shiki; every decision it makes is a call into `lib/`.

**Tree left, viewer right, inside the pane.** The pane is itself the right half of a work
surface whose left half has an 80-column floor (`paneModel.ts`, `MIN_LEFT_PX`), so at his
1728px 16-inch the pane is ~435px and the tree cannot be a fixed 288px column — that is
precisely the mistake `workspace-diff-fits.spec.ts` was written about. The tree is therefore
laid out on the **same rule the Diff pane now uses**: beside the viewer when there is room for
both, and an overlay drawer over it when there is not. Reused, not re-derived — `diffLayout.ts`
already owns that arithmetic and its test.

> **Measured, after the build: at his width the tree is the drawer.** 1728 − 300 (sidebar)
> − 224 (nav) → 1195px surface; − 752 (`MIN_LEFT_PX`) − 8 (divider) → **435px**.
> `PATCH_MIN_PX` is 466 (60 columns of `font-mono text-xs` plus `px-4`), so 435 is below
> `PATCH_MIN_PX + LIST_MIN_PX` and `diffListPlacement` answers `over`. The 60-column
> judgement is right for a file viewer for the same reason it is right for a patch, so this
> is the rule working rather than the rule being wrong — but it means the pane he gets is
> *viewer with a tree drawer*, and two things follow that the first build got wrong:
>
> - **The drawer starts open.** The Diff pane's starts shut because it opens on a file
>   already and a self-opening drawer would cover the very patch the layout exists to give
>   back. This pane opens on *nothing*, so a shut drawer is a file tree he cannot see over a
>   viewer with nothing in it. It is not closed for him again either — the gesture that
>   opened it puts it away, which keeps arrow-key navigation from fighting a drawer that
>   shuts on every Enter.
> - **The drawer covers the viewer, not its own toggle.** `relative` goes on the box holding
>   the viewer, not on the row holding the button. The Diff pane's list already paid for this
>   exact bug and says so in a comment; this build reproduced it anyway, and Playwright caught
>   it the same way — "subtree intercepts pointer events" on the toggle. A drawer laid over
>   the whole pane is a drawer with no way out.

**Ordering:** directories before files, then case-insensitive by name. Stated because a tree
that ordered by `ls-files`' own output would order by git's byte order and look broken.

---

## 4. Shiki: reuse, and what it costs

`desktop/src/shared/ui/markdown/CodeBlock.tsx` exports **`SyntaxHighlightedCode`** — the
highlighter this app already ships, with a singleton, a lazy per-language load, a per-theme
load and a token cache. The Files pane **imports that component**. It adds no highlighter, no
language bundle and no theme.

That component's own ceiling is the honest part of this section:

- **`MAX_HIGHLIGHT_LINES = 150`.** Over 150 newlines it returns `null` and renders plain
  `<span>` lines. Silently. For a markdown code block that is invisible and fine; for a file
  viewer it is a lie — a 400-line file would render unhighlighted with nothing saying why, and
  he would reasonably conclude the highlighting is broken.
- **`codeToTokens` is synchronous.** It runs on the main thread inside a `useMemo`. Shiki is
  a TextMate grammar engine: roughly **1–3 ms per 100 lines** for a common grammar, so a
  2,000-line TypeScript file is tens of milliseconds of blocked main thread — a visible hitch
  in the terminal beside it.
- **Per-language load** is a dynamic `import()` of a grammar (tens to a few hundred KB) the
  first time a language is seen, and `MAX_LOADED_LANGUAGES = 30` after which new languages are
  silently not loaded.

So the decision, in `fileViewer.ts` and tested there:

> **Highlight when the file is ≤ 150 lines and ≤ 128 KiB. Otherwise render plain text and
> say so, in the pane, in words.**

The threshold is not new behaviour — it is upstream's, which the viewer would hit anyway. What
is new is that the pane *states* it: *"1,204 lines — shown as plain text; syntax highlighting
is limited to 150 lines."* A fallback he can read is a fallback; a fallback he cannot see is a
bug report.

The 150-line constant is **mirrored** in `fileViewer.ts` rather than imported, because
`CodeBlock.tsx` does not export it and adding an export there is an upstream touch for a
number. The mirror is a known coupling, it is named in a comment at the constant, and the
alternative — the pane guessing at what upstream did — is worse. If it drifts, the pane
over-reports the ceiling and the file renders plain either way; it cannot drift into a freeze.

**Rejected:** chunking the file into 150-line windows and highlighting each. It would
"work" and would be wrong — a grammar's state crosses a window boundary, so every block
comment, template literal and heredoc past the first chunk colours as code.

---

## 5. Keyboard

The pane is on the registry, so it is reachable from **⌘K** (`paletteSources.ts`'s `paneSource`
maps `rightChoices()` straight to rows — no edit) and from the **pane picker** (`WorkSurface`
maps the same list). Adding `"files"` to `PANE_IDS` is the whole of it; that is what the
registry is for and this pane is the sixth one testing the claim.

Inside the tree, resolved by `resolveFileTreeKey` in `filesModel.ts` — a `resolve*` function
like `terminalKeys.ts`, `columnKeys.ts` and `paneKeys.ts`, so the map is unit-testable with no
DOM:

| Key | Act |
|-----|-----|
| `↓` / `↑` | move the selection one visible row |
| `→` | expand a collapsed directory; on an expanded one, step into its first child |
| `←` | collapse an expanded directory; on a leaf, go to its parent |
| `Enter` | open the selected file (a directory toggles) |
| `Home` / `End` | first / last visible row |

Bound to the tree's own container, never to the window — an unmodified arrow belongs to
whatever has focus, and a global arrow binding would move a tree selection while he was moving
a cursor in the terminal. Selection is roving-`tabindex` with `aria-activedescendant` on a
`role="tree"`.

---

## 6. The door from outside — what Task 2 builds on

**This is the part that must not be reimplemented by the search task.**

```ts
// lib/filesTarget.ts
export interface FileTarget { worktree: string; path: string; line: number | null }
/** A target plus the count that makes a repeat distinguishable from the original. */
export interface FileRequest extends FileTarget { bump: number }

export function requestFile(target: FileTarget): FileRequest
export function pendingFile(): FileRequest | null
export function takeFile(): FileRequest | null
export function subscribeFileTarget(listen: (request: FileRequest) => void): () => void
export function shouldLand(request: FileTarget, cwd: string | null): boolean
export function resetFileTargets(): void
```

**A subscriber is told a `FileRequest`, never a `null`.** There is no "current target"
getter that reads like state, because this is not state — it is a request consumed once
(the paragraph below says why). A pane mounting reads what is waiting with `pendingFile()`
and consumes it with `takeFile()`; a pane already mounted is handed the request by
`subscribeFileTarget` and calls `takeFile()` to clear it, so a later remount does not
re-open a file he has since navigated away from. Two requests for the same file differ only
in `bump`, which is the field a caller compares when it needs to know whether it has already
acted on this one. `shouldLand(request, cwd)` is the guard the *pane* applies, and
`resetFileTargets()` is the community-switch reset — both are part of the surface rather
than internals, because Task 2's caller lives in the same two worlds.

and, on the pane-act channel the registry already gives every pane:

```ts
// paneModel.ts
export type PaneAct =
  | { type: "plan-to-worktree" }
  | { type: "show-file"; worktree: string; path: string; line: number | null }
```

`RunsScreen.runPaneAct` handles `show-file` by calling `requestFile(...)`, then
`panes.choose("files")`, then un-soloing a solo'd terminal — the same three moves the `ask`
palette command already makes for the Agent pane, and for the same reason: an answer behind a
surface he cannot see is a toast with extra steps.

**Why both a store and an act, rather than one.** `onPaneAct` is the channel for a pane
asking the workspace for something, and Task 2's search pane is a pane, so that is its route.
But `PaneAct` has no way to carry an argument *to the next pane* — `paneRegistry.tsx` says so
in a comment and says that inventing the channel before a pane needs it would fix its shape
blind. This is the pane that needs it. Rather than widen `PaneProps` for one case, the
argument goes through a module-level store the Files pane subscribes to, which is also what
lets a **non-pane** caller (a notification, a deep link, a future `buzz://file?…`) reach the
viewer without going through the pane system at all. One landing, two doors — the rule already
in force for New worktree, Prune and Remove project.

`line` is `number | null` and the viewer scrolls the line into view and marks it. `null` means
"the top of the file", not "line 1 emphasised" — a file opened from the tree has no
interesting line and must not have one invented for it. Both render paths emit one
`[data-line]` element per line — upstream's `SyntaxHighlightedCode` does it already and the
plain fallback is written to match — so the scroll works whichever path drew the file.

**Which line, in one place.** `fileViewer.markedLineIndex` is the only `line - 1` in the
island, and the mark is applied by the effect that already queries `[data-line]` rather than
by each renderer's JSX. That is forced by the highlighted path — upstream's component owns its
line elements and takes no "mark this one" prop — and doing the same for the plain path is
what keeps the two renderers from having their own copy of the arithmetic. The first draft had
two, which is one more than can be right.

**Whose target it is, in one place too.** `filesTarget.shouldLand(request, cwd)` decides
whether the pane standing in `cwd` acts on a request. It is a function rather than a line
inside the component because the interesting branch is the *refusing* one — two checkouts of
one project both have `src/main.rs` — and a browser fixture with a single worktree can only
ever produce the other. Task 2's search results are exactly the caller that will produce a
target for a checkout that is not on screen.

`resetFileTargets()` is registered in upstream's `resetCommunityState()`
(`features/communities/useCommunityInit.ts`, declared in `vingilot/seams.yaml`), which is the
one list that runs on a community change. Not the island's own teardown: a module-level value
survives the `<AppReady key={communityKey}>` remount, and that list is where this repository's
own CLAUDE.md requires such a value to be dropped. An exported reset nothing calls is a
documented invariant that is not enforced anywhere, which is what this was until the wiring
landed.

**It has a caller already, which is what makes it testable.** The Diff pane's patch header
carries a "show the whole file" button that raises `show-file` for the file whose patch is
open, **at the line that patch starts on** — `worktreeDiff.firstHunkLine` reads the `+` side
of the first hunk header, because the file the viewer opens is the file as it is now. That is
real product value on its own — a patch is a reading of a few lines, and the question it most
often raises is what the rest of them say, which until now was answered by VS Code — and it
means the route is proved end to end in the browser rather than by a spec dispatching a
channel it invented. A test that fabricates its own event proves the pane can be *told*, and
nothing about whether anything tells it.

It also means the `line` half of the route has a production caller at all. While that button
passed a hardcoded `null`, the landing was indistinguishable from `openFile(path, null)` and
every browser run exercised the uninteresting half of it.

---

## 7. Bounds, in one place

| Bound | Value | Where | Reported to him |
|---|---|---|---|
| Entries per directory | 2,000 | `tree.rs` | yes — `truncated` + `limit` |
| File size cap | 512 KiB | `read.rs` | yes — refusal names the real size |
| Binary sniff window | 8 KiB | `read.rs` | yes — "looks binary" |
| Highlight line ceiling | 150 lines | `fileViewer.ts` (mirrors `CodeBlock.tsx`) | yes — plain-text notice |
| Highlight byte ceiling | 128 KiB | `fileViewer.ts` | yes — same notice |

Nothing on this list is applied silently. That is the same rule `diff.rs` states in its header
and it is the rule that makes a bounded reader honest instead of merely safe.

**And every bound on this list is applied by something a test can call directly.** The first
two were not: the entry cap was three lines inside `listing()`, reachable only from a temp repo
with 2,001 files in one directory, and the read bound was three lines inside `read()` behind a
`metadata` size check that stops every fixture before it. Both were therefore deletable with
the whole suite still green. They are now `tree::capped(names, limit)` and
`read::bounded(reader, cap)` — pure, driven from three names and from a `Cursor` — which is
the same split `one_level` and `sort_entries` already had, for the same reason. A bound whose
own test cannot reach it is a bound the next refactor removes for free.

---

## 8. Tests

**Rust** (`cargo test --lib vingilot_files`), against a real temp repo — the `testrepo::Repo`
fixture `vingilot_worktree` already has, reused rather than copied:

- one level only: a nested tree lists its own children and nothing deeper
- an ignored file and an ignored directory are absent, with a real `.gitignore`
- an untracked-but-not-ignored file **is** present (that is `--others`)
- `.git` is absent
- sizes are the files' own; a directory carries none
- too large → the size in the refusal, and the file is never opened
- a NUL in the first 8 KiB → binary
- a missing file → unreadable, carrying the OS error
- `..`, an absolute path and a **symlink pointing outside the worktree** → `OutsidePath`
- both commands are futures (`accepts_only_a_future`)
- the argument vector carries `--exclude-standard` and no write flag
- `capped` drops the rest and says so, at a limit of two — the truncation the `2,000` fixture
  cannot reach
- `bounded` refuses at `cap + 1` and returns the whole thing at `cap`, over a `Cursor` — the
  read bound the `metadata` check stops every file from reaching

**Unit** (`node --test`): `filesModel.test.mjs` — flattening, expansion, the five keys, the
ordering rule, selection surviving a refresh that reorders. `fileViewer.test.mjs` — language
from path, both highlight ceilings and the exact fallback sentence, and `markedLineIndex`
including the values a caller cannot mean. `filesTarget.test.mjs` — subscribe/emit/unsubscribe,
the reset, and both sides of `shouldLand`. `paneModel.test.mjs` — `filesAvailability`'s three
branches alongside its five siblings'. `worktreeDiff.test.mjs` — `firstHunkLine`, including the
headers it refuses to guess at.

Two of these are locale- and machine-independent on purpose. `humanCount`'s "1,204" is pinned
to `en-US` because the sentences around it are English; the test that proves the pin proves it
by running the module in a **child node with `LC_ALL=de_DE.UTF-8`**, with a control assertion
that the child really took the locale. In-process the pin is untestable — ICU fixes the default
locale at startup — so the first version of that test only failed on the owner's Turkish laptop
and would have passed CI's en-US runner with the pin removed. That is the same defect it was
written to catch, one level up.

**Playwright** — `desktop/tests/e2e/workspace-files.spec.ts`, registered in
`playwright.config.ts` and in `vingilot/seams.yaml`. Both commands mocked through the same
`addInitScript` property-trap `workspace-one-column.spec.ts` uses, because the home-directory
lookup runs on the first render and the bridge assigns `invoke` during boot. It opens the pane
from the palette, walks the tree with the arrow keys, opens a file with Enter, sees Shiki's
own token colouring on it, and then sees **each refusal sentence in turn** — too large with
its size, binary, and the plain-text notice on a long file. The refusals are the reason this
is a browser test: a sentence that is correct in a model and never rendered is the failure
mode this island has already had.

It also reads the §6 route **twice, once per renderer**: the Diff pane's button on a small
file (highlighted, where the marked span is upstream's) and on a 400-line file (plain, where it
is this pane's), each asserting the marked line by its own *text* rather than by a number, so
an off-by-one in either direction is red. Proved able to fail: `markedLineIndex` returning
`line` instead of `line - 1` turns both readings red, each naming the line it wrongly marked.

---

## 9. Seams

| Path | Why |
|---|---|
| `desktop/src-tauri/src/vingilot_files/**` | new fork-owned Rust island, additive |
| `desktop/src-tauri/src/lib.rs` | `mod vingilot_files;` + two lines in the one command table Tauri has (amend the existing entry) |
| `desktop/src-tauri/src/vingilot_window/mod.rs` | island — receives the close-request body, see below |
| `desktop/tests/e2e/workspace-files.spec.ts` | `playwright.config.ts`'s `testDir` is where every spec in this repo lives |
| `desktop/playwright.config.ts` | one array entry; every `testMatch` is a literal basename, so a new spec cannot run without it (amend) |
| `desktop/src/features/communities/useCommunityInit.ts` | one import + one call in `resetCommunityState()`; upstream keeps one list of community-scoped singletons and there is no registration hook to reach it from the island |

Everything else is island: `features/runs/lib/*`, `features/runs/ui/*`, `paneModel.ts`,
`paneRegistry.tsx`, `RunsScreen.tsx`, `WorktreeDiffPanel.tsx`.

### 9.1 The `lib.rs` ceiling, which this task ran into

`lib.rs` was at **999 lines of the repository's 1000-line ratchet** before this task. Adding
`mod vingilot_files;` and two command entries put it at 1002 and the gate refused it. The
house rule is *split, never raise*, and the split that was available is the honest one: the
macOS `CloseRequested` arm in `app.run` was **28 lines of fork logic sitting in upstream's
file** — logic this repository's own seam entry already described as "fork-owned and pure, in
`vingilot_window`". The arm stays, because `RunEvent` is delivered to that closure and
nowhere else; everything inside it is now `vingilot_window::apply_close_request`. `lib.rs` is
982 lines.

That is not a line-count trick, it is the island rule applied to the last place it had not
been — and it matters beyond this task, because that file is the one every future fork
command has to pass through, and it had one line of headroom left.
