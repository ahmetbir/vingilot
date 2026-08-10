# The workspace — the Vingilot surface inside Buzz desktop

Per ADR-001's 2026-08-03 Reversal, Vingilot's UI lives **inside the Buzz
desktop app**, not in a sibling application. The former standalone Workbench
(`vingilot/workbench`) is deleted; its logic modules and tests were ported
into the island and its history remains on the `vingilot/workbench-shell`
branch.

Since workspace-v1 (2026-08-07) **Projects is the front door and Runs is one
pane among several** — a tab then, a choice in the right pane's picker now.
The sidebar item reads *Projects*; upstream's own relay-hosted repo
screen was relabelled *Repos*, which is literally what it lists (ADR-001,
naming decision). Nothing was deleted on either side.

---

## The workspace, in one screen

Three columns, left to right (`ui/RunsScreen.tsx`):

| column | what it holds | what it is for |
|---|---|---|
| **Projects** (`ProjectsNav`) | the local checkouts the owner has added, plus a project-less landing view | pick what you are working on. `+ Add project` opens the native folder picker; the choice is validated as a git repository *before* any workspace state is written. **Removing a project forgets the path — it never touches the directory on disk.** |
| **Worktrees** (`WorktreeColumn`) | that project's worktrees: its own checkout plus every `git worktree` | pick where you are working. New worktrees are `git worktree add`; closing one is `git worktree remove`, never a recursive delete. If git refuses because the tree is dirty, what is dirty is shown and nothing happens — that refusal is the feature. |
| **Work surface** (`WorkSurface`) | the terminal on the left, a divider, and a pane on the right chosen from that pane's own header (`PanePicker`, out of `ui/paneRegistry.tsx`): **Diff**, **Agent**, **Team**, **Evidence**, **Runs**, **Notes**, **Plan**, or a second **Terminal** — with the **scratch shell** drawn over all of it when it is open | do the work. The terminal is fixed to the left because in iTerm the terminal *is* the work surface, not a drawer — and because a terminal that changed slots would change parents, which is a new xterm and a replayed session. Either side can have the whole surface. |

A persistent `ProjectStatusBar` names where the owner is and what is backing
the terminals.

## Where attention is needed

The owner asked for dashboards on 2026-08-09 and pointed at two products —
**nodeterm** (per-agent "RUNNING / NEEDS YOU" badges, a notification when a turn
completes, every project doubling as a board of sessions) and **VelaTerm**
(per-session status dots in the sidebar, an OS notification when an agent stops
and waits) — saying *"fikirden alıntı yapabiliriz"*. What was borrowed is the
logic, not the chrome: **the workspace answers "where is my attention needed"
without being asked.** There are no charts here, and every state below is a
signal this app already holds.

**A dot that guesses is worse than no dot.** It is read from across the room and
believed without being checked, so the first time it is wrong the owner stops
looking at the surface, not just the row. Hence the inventory: each state, what
it is derived from, and how current that answer actually is
(`lib/attentionSignal.ts` derives, `ui/AttentionDot.tsx` draws, and nothing else
in the island derives a second opinion about the same worktree).

| state | drawn when | source of truth | refresh |
|---|---|---|---|
| **needs you** — rose diamond | the run that owns this worktree is `paused` or `blocked` (`runAttention`'s `waiting`, the run rail's own grouping, not a second table) | the coordinator's worktree rows: `owner_run_status` | every **2 s** (`lib/usePolling.ts`, `DEFAULT_INTERVAL_MS`), for every worktree in the workspace — so a project the owner is not standing in is as current as the one he is |
| **working** — emerald pulsing circle | that run is `provisioning`, `ready`, `running` or `verifying`; **or** this app's one in-flight ACP turn was started in this worktree's directory | the same coordinator rows; `lib/askStore.ts`'s single `AskInFlight {id, cwd}` | 2 s for the run; the ask slot is **pushed**, not polled (`useSyncExternalStore`, held until `settleAsk`) |
| **dirty** — amber square | `WorktreeStat.dirty` | git itself: four short reads per worktree in `src-tauri/src/vingilot_worktree/stat.rs` (`rev-parse --git-dir`, `rev-parse --verify HEAD`, `diff --numstat -z HEAD`, `ls-files --others`), never `WorktreeDiff`'s per-file patches | every **5 s** (`lib/useWorktreeStats.ts`, `REFRESH_MS`), one read in flight at a time, cached — a slow or failed read leaves the last numbers standing rather than printing zeros. A create, a remove or a project switch re-reads at once |
| **quiet** — hollow ring | git answered *and* said clean, and no run is pressing. The sentence names a run that ended `failed` or `cancelled` (`endedBadly`), and the mark carries that ending so the rollups above it cannot sum it away | git, as above, plus `owner_run_status` | as the two rows above |
| **no dot** | nothing has answered: no usable stat (an unreadable path, no derivable cwd, or the tail past the backend's 64-path `MAX_PATHS`) and no run pressing | — | — |

**Precedence, written down:** needs you > working > dirty > quiet. It is the
order of what changes next if nothing is done. It is deliberately *not*
`lib/worktreeAttention.ts`'s row ordering, which puts dirty first because that
list ranks by what can be **lost**.

**A project's dot is the strongest state among its worktrees** (`rollupMark`),
so the nav answers "which project needs me" without opening one. The three loud
states are existence claims and survive a silent sibling; "nothing needs you"
is a claim about *all* of them, so **one worktree nothing has answered about
costs a project its quiet dot** rather than being absorbed into a sentence that
does not mention it.

**Two signals were considered and dropped, visibly.** *Terminal liveness*: tmux
is probed once per app run and cached for its lifetime, there is no
`has-session` query and no exit event on `vingilot://pty`, so "a terminal is
busy here" is not a question this app can answer — and the tab layout is not a
substitute, being the app's guess about itself. *"An answer arrived and has not
been seen"*: nothing marks an ask exchange read, so as a dot it would burn
forever on every worktree ever asked a question. It survives as an
**interruption** instead, which needs no seen mark.

### The one notification, and the rule that keeps it quiet

Dots are standing claims; a notification is an interruption. So nothing is fired
from a single reading — `lib/attentionNotice.ts` compares **two** readings and
speaks only on the edge into `needs you`, plus the moment an ask turn this app
started settles. A worktree with no previous reading only primes: firing on it
would deliver the backlog as interruptions every time the owner navigates back.

> **Suppression rule (`suppressed`, one pure function):** a notification is
> **not** sent when this app's window has OS focus **and** the worktree it is
> about is the one on screen. Both halves are needed — a focused window showing
> another worktree does not cover this one, and this worktree selected behind
> the owner's browser is not being looked at.

It is the *surface*, not the sidebar: a sibling row going `needs you` still
speaks, because its dot in the column is an indicator he reads when he chooses
to and the point of the channel is reaching him when he is not reading. Clicking
lands on the worktree that needs him. The whole feature is one row in the
notification settings — the `workspace` slot, "Workspace: needs you", default
on, beside the four disabled `job_*` slots it deliberately did not squat in.

### Landing is the dashboard

Both landing states are the same board (`lib/triage.ts`, `ui/TriageBoard.tsx`):
**Deck** (no project selected) grows it under the run composer, and a selected
project with no worktree — a literally blank "select a worktree" panel before —
shows the same board filtered to that project. One component, two filters, in
DeckPane's existing idiom rather than a new pane or a chart page.

Every project × worktree is one row: Task 1's dot **carried, never re-derived**,
the branch, the same `rowDetail` line the worktree column puts under the same
worktree, and one date. Ordering is attention-first and stable within a rank,
with the rows nothing has answered about **last** — an unknown row ranked above
a quiet one would leap to the top of the board and drop back seconds later,
moving under him for a reason nothing on screen explains. Every row is a door
onto that worktree, in a project that need not have been open.

**The date is the coordinator's `updated_at` for the run that owns the row, or
there is none.** A stat observation time was offered and dropped: the stats are
re-read on one 5 s timer, so it would print the same "3 s ago" on every row —
a column spending the owner's trust to say nothing. A worktree no run owns
carries no date rather than borrowing one.

The sentence over the board is `rollupMark`'s, so the headline and the project
dot cannot disagree — including about a run that stopped without finishing:
"nothing needs you" is a real answer and a good one, but not over a worktree
whose run failed.

## Key map

Worktree and terminal chords (`lib/terminalKeys.ts`, `resolveKey`):

| chord | does |
|---|---|
| `⌘1`…`⌘9` | switch to the Nth worktree — iTerm tab muscle memory |
| `` ⌘` `` | focus the terminal |
| `Esc` | leave the terminal |
| `⌘T` | new terminal tab in this worktree |
| `⇧⌘W` | close the terminal tab |
| `⌥⌘←` / `⌥⌘→` | move between this worktree's terminal tabs |
| `⇧⌥⌘←` / `⇧⌥⌘→` | move the tab itself |
| `⌥⌘T` | open the scratch shell — and, pressed again, close it |

Columns and panes (`lib/columnKeys.ts`, `lib/paneKeys.ts`):

| chord | does |
|---|---|
| `⌘B` | show or hide upstream's sidebar |
| `⇧⌘B` | show or hide the worktree column |
| `⌥⌘B` | give the terminal the whole surface, and back |
| `⇧⌥⌘B` | give the right pane the whole surface, and back |

The palette (`lib/paletteKeys.ts`), on `/workspace` only:

| chord | does |
|---|---|
| `⌘K` | open the palette — and, pressed again, put it away |
| `↑` / `↓` | move the cursor, wrapping rather than falling off either end |
| `↵` | run the row under the cursor, or ask the question |
| `⇥` | straight back to the field: there is nothing here to tab *to*, and a Tab that left would put focus on controls the scrim is drawn over |
| `Esc` | close it, from wherever focus went — including a blocked row, which stays clickable on purpose |

**`⌘W` is still not *bound*, and it is answered.** It never reaches this app as
a keydown on macOS: Tauri installs its default application menu, whose Window
submenu holds `close_window` at `⌘W`, and macOS resolves menu key equivalents
before the webview sees the event. The menu is kept rather than replaced —
`⌘Q`, `⌘C`, `⌘X`, `⌘V` and `⌘A` live in the same table for a WKWebView, losing
one would be silent, and no `cargo test` can even construct a replacement
(`src-tauri/src/vingilot_window/mod.rs` carries the whole pricing). What is
answered instead is the **close request** that menu item raises: it takes
whatever is stacked over the work surface — a dialog, else the palette, else
the cheatsheet, else the scratch shell — and with nothing stacked the window
**minimizes into the Dock, where the thumbnail is the way back. It never
hides.** Hiding it is how the owner lost the window with no way back he could
find.

Auto-repeat is not a second press: a leaned-on `⌘T` would otherwise leave
dozens of live shells, removable one click at a time.

The cheatsheet (`lib/cheatsheetKeys.ts`), on `/workspace` only:

| chord | does |
|---|---|
| `⌘/` | every chord in this table, on screen — and, pressed again, put away |
| `Esc` | close it |

Diff panel (`lib/diffKeys.ts`): `j` / `k` move the cursor through the changed
files, `Enter` opens the one under it. A cursor is not a selection — opening
every file you pass over would mean rendering 300 patches to reach the one you
wanted. `Enter` on a focused control (a tab button, a file row, a link)
belongs to that control, not to this list; `j`/`k` do not, because every file
row is itself a button.

A focused card in the deck (`lib/cardKeys.ts`): `←` / `→` move it along the
row. **It was an `onKeyDown` handler inside its component until the cheatsheet
went in**, which is exactly why it is a module now: the sheet is generated by
asking the `resolve*` maps what they answer to, so a chord bound in a component
is a chord it cannot print — and it opens by claiming it carries every chord
this workspace binds.

**The team thread's composer is not one of those maps, and has no section on
the sheet.** It had both — `lib/composerKeys.ts`, where `⌘↵` and `⌃↵` sent and a
bare `↵` was a newline "because a message here carries a path and goes to a
server". The chord is false and so is the reason for it. The pane hosts
upstream's composer (`ui/TeamThreadPane.tsx`), whose plain `↵` submits —
**a bare `↵` sends here now** — and nothing is put in front of the message, so
it carries no path either. The
module and its section were deleted rather than rewritten: a sheet generated
from *this island's* maps has nothing of its own to say about someone else's
chord, and a hand-written row for one would be the sheet claiming a binding it
does not own (`lib/cheatsheet.ts` says so where the section used to be).

**What that generation can and cannot promise.** "Add a chord to a map and it
is on the sheet" holds for a chord on a key in `cheatsheet.ts`'s `KEY_SPACE`,
in a map in its `KEY_MAPS` — both hand-written lists. A chord on a key outside
the first (`⌘;`, say) resolves perfectly well and never appears, and nothing
fails. Adding a chord means adding its key there too.

## The type scale

The owner read the workspace after using it and said *"her yerde bi font
sıkıntısı var — bazıları kücücük bazıları büyük"*. Nothing here was breaking a
rule: every size was a legal rem token and `pnpm check:px-text` was green. What
disagreed was **which** token, across panes written days apart — a pane header
was `text-lg` on one surface and `text-xs` on another, a row's second line was
`text-3xs` here and `text-xs` there. So the scale is written down, and the next
pane inherits it instead of re-guessing.

**Six roles, four sizes.** No `className` written in `features/runs/**` carries
a size outside this table, and `lib/typeScale.test.mjs` keeps it that way.

| role | what it is | token |
|---|---|---|
| **Title** | the name of the surface you are looking at — a column header, a pane's own heading, the pane-header strip's label and picker, a run's objective at the top of its detail | `text-sm` |
| **Body** | anything the workspace says as a statement — an empty state, a refusal, a note, an agent's answer, a thread message — and every field the owner types into | `text-sm` |
| **Row** | the primary line of a list row: a project, a worktree, a run, a palette row, a changed file, a menu item | `text-sm` |
| **Control** | the label on a button, a tab, a form field, a disclosure | `text-xs` |
| **Meta** | the quiet second line under a row, and anything that names or counts rather than states — a timestamp, a path, a count, a chip, a keyboard hint, the whole status bar | `text-2xs` |
| **Eyebrow** | the uppercase heading over a list or a bar | `text-3xs uppercase tracking-[0.14em]` |

Three riders, each of which settles a case that came up while applying it:

- **Body and Row and Title are the same size on purpose.** They are all things
  you read; only weight and colour separate them. The scale is about size —
  weight, colour and case stay each surface's own.
- **A line is Body if it makes a statement and Meta if it names, counts or
  times something.** "control plane unreachable — pin toggles disabled" is
  Body. "+340 −22", "as of 14:02", `~/src/vingilot` are Meta. A line
  subordinate to the line directly above it is Meta whatever it says.
- **Monospace takes its role's size, except output the app produced.** A patch,
  an agent trace, an evidence row and a stderr dump are `text-xs` — they are
  scanned in columns, not read in lines. A path, a branch name or a refusal's
  file list is Meta (`text-2xs`); the Notes/Plan editor is a field the owner
  writes prose into, so it is Body (`text-sm`).

**The Eyebrow's styling belongs to the Eyebrow alone.** `uppercase` plus
`tracking-[0.14em]` at any other size is the drift this section exists to stop,
and it is checked (`lib/typeScale.test.mjs`) in both directions: an eyebrow at
another size, and an 8px line that is not an eyebrow. Two `dismiss` links wore
the eyebrow's styling as controls and now use the app's plain underlined-link
idiom instead. The chip idiom — `text-2xs uppercase tracking-wide` inside a
rounded border, as on `acp`/`int`, a run's status and STOP — is a separate,
self-consistent thing and is left alone.

**The scale governs what the island writes, not what it renders.** A shared
component brings its own size in with it, and no className in this island
mentions it: `@/shared/ui/button` is `text-sm` at its base (its `sm` and `xs`
sizes step down to `text-xs`), `@/shared/ui/input` is `text-base` until
`md:text-sm`, `@/shared/ui/dropdown-menu`'s items are `text-sm`. Island panes
render all three — the dialogs, the deck cards, the pane picker — so the table
above is not the whole answer to "what size is this line", only to "what size
did we ask for". Those components are upstream files: making one of them agree
with this scale is a change to Buzz's own type, which is a seam
(`vingilot/seams.yaml`) and a decision about upstream, not a tidy-up.

**The terminal is exempt, and only the terminal.** The type inside
`ui/Terminal.tsx`'s host element is xterm's own, and it is never inherited:
the component constructs XTerm with no `fontSize`, so xterm falls back to its
own default of 15 and writes that out explicitly wherever it counts — onto the
element it measures a cell from, and onto `.xterm-rows` through a stylesheet it
appends itself (`@xterm/xterm` 5.5.0 `lib/xterm.js`; its `css/xterm.css` has no
font rule at all). A Tailwind size on the host would therefore change nothing
today. The exemption is a boundary, not a live hazard: it keeps app styling
from starting to creep onto the element xterm owns, so the day something inside
does read an inherited font is a day nobody has to find. `lib/typeScale.test.mjs`
holds that line. The chrome *around* it — the tab strip, the scratch shell's
header and footer, the "waiting for this worktree's checkout…" notice — is
workspace type and takes the table above.

`pnpm check:px-text` still gates arbitrary literals app-wide; this scale is the
narrower rule that gates *token choice* inside the island.

## The terminal, and exactly what it does not promise

A real PTY per tab, running **the owner's own login shell** in the worktree's
directory (`desktop/src-tauri/src/vingilot_pty/`).

- **No isolation.** The shell has whatever the owner has: their `$PATH`, their
  keys, their whole filesystem. This is the same risk class as typing into
  Terminal.app (ADR-003's V1 trust model). Nothing here sandboxes anything,
  and no UI copy may imply otherwise — a worktree chip says only where the
  shell *starts*.
- **Persistence is tmux's, and it is bounded.** Where tmux is installed, each
  tab runs under `tmux new-session -A -D -s vingilot_<derived>`, so the shell
  survives quitting the app. It does **not** survive a reboot, a
  `tmux kill-server`, or a crash — the session lives exactly as long as the
  tmux *server*, which is not this app's child. The status bar says
  "persistent (tmux) — survive quitting the app, not a reboot".
- **Without tmux there is no persistence at all.** The shell is a child of
  this app and dies with it. The status bar then says "this session only —
  they end when the app quits". It never implies more than is true.
- **Reattach replays a bounded screen**, not a full scrollback: 256 KiB per
  session, oldest bytes dropped first (`scrollback.rs`). That is roughly 25
  screenfuls — enough that a remount lands on real history. Keeping more is
  tmux's job, and a ring that tried to be a scrollback store would be
  reimplementing tmux badly.
- **A tab's shell is killed when the owner closes the tab or its worktree
  leaves the workspace** — never on a re-render, a project switch, or a tab
  change. `pty_close` also ends the tmux session, because nothing will
  reattach to it.

Proven, not asserted: `vingilot_pty/live.rs` opens sessions against a real
PTY in `cargo test` and checks that the shell's own `pwd` is the worktree,
that a reattach replays what the view missed, that a tmux session outlives
the client attached to it, and that closing a terminal leaves neither a
running shell nor a zombie.

## The scratch shell — a terminal you can throw away

`⌥⌘T`, or `⌘K → scratch shell`. It opens **over** the work surface, runs one
thing, and leaves nothing behind (`lib/scratchTerminal.ts`,
`ui/ScratchTerminal.tsx`). There is exactly one at a time, and both doors reach
the same one: a second `⌥⌘T` on the worktree it is already open on closes it
rather than costing the owner whatever is running in it.

It is drawn over the surface rather than laid out in it, and that is not a
styling preference. Under tmux the sole attached client's size *is* the
session's size, so a layout that squeezed the persistent terminals to make room
would reflow every live shell in the strip and re-wrap its scrollback — the
exact failure `terminalFit.ts` exists to prevent, arriving from a new direction.
Nothing here unmounts, remeasures or resizes a terminal that is not its own, and
nothing bumps a `focusToken`.

**What it does not do**, said in the same breath as what it does:

- **Nothing is kept.** No tmux session, no tab in the strip, no line in the
  saved layout, no id a restart could find. Persistence is the defect here, not
  the missing feature: a scratch terminal that survived anything would be a
  terminal tab, and the workspace already has those.
- **No isolation**, exactly as for the terminal tabs above. It is the owner's
  login shell with the owner's `$PATH`, keys and filesystem. The header names
  the directory it starts in and that is all a directory means here.
- **It ends when you leave, and it does not ask.** Closing it, going to another
  worktree or project, leaving the workspace screen, and quitting the app all
  end it — and whatever it is running ends with it, unasked: a tail, a build, a
  long test run. The alternative was a confirmation before killing a live shell.
  This is the other choice and it is the honest one for a terminal whose whole
  point is being thrown away — a scratch shell that stops to ask permission is a
  tab with extra steps — so the cost is said **up front**, in the footer under
  the shell and in the palette row that opens it, rather than in a warning at
  the moment it is too late to matter.

The footer carries that sentence verbatim from `lib/terminalPersistence.ts`,
beside the status bar's persistence line it must not be confused with. Both
sentences live in one file for that reason: the way this drifts is one being
rewritten without the other in view, and the status bar's old wording
("terminals: persistent…") was a sentence a scratch shell could hide inside. So
the worktree copy now names its subject and the scratch copy says what it is
*not* covered by.

**How "leaves nothing behind" is actually secured**, rather than promised:

| residue | how it is avoided |
|---|---|
| a tmux session | asked for the direct spawn at `pty_open` (`Lifetime::Ephemeral`), so there is no session to strand — not by killing one afterwards |
| the saved layout | never enters `TabLayout` at all: a scratch is one nullable value held beside it |
| the worktree's strip | follows from the above — `applyTabCommand`/`closeTab`, and so `⇧⌘W` and the tab bar, have no name for this session |
| colliding with a tab's shell | a tab's session id is `` `${bindingId}#${n}` `` and always contains a `#`; a scratch id contains none. That is the whole proof, for every binding id the coordinator could ever produce |

Proven, not asserted: `lib/scratchTerminal.test.mjs` for the model,
`vingilot_pty`'s live tests for a shell that leaves no tmux session behind, and
`desktop/tests/e2e/workspace-scratch.spec.ts` over a real bundle for the three
things only a live document can settle — that closing it puts the keyboard back
on the control it was taken from (from both doors, which capture at different
moments in one commit), that the path in the header is the path that crossed the
boundary to `pty_open` and the plan asked for is the ephemeral one, and that
opening and closing one adds no tab, leaves the saved layout byte-identical, and
really closes the pty — including when the owner walks away to another project,
which is the half of the promise that is invisible on screen.

## The diff viewer, and where it stops

Working tree versus a base ref — "what have I changed", including untracked
files, which `git diff` alone would never mention. It is git's own output:
`--numstat`/`--name-status` for the list and counts, a per-file `git diff` for
each patch, `--no-index` against `/dev/null` for untracked ones. Nothing is
reconstructed or inferred, and **nothing here writes** — no `add`, no
`add -N`, no stash, no index touch of any kind.

Every limit is reported on screen, next to the numbers it applies to:

| limit | value | what happens past it |
|---|---|---|
| files listed | 400 | the amber banner names how many more changed |
| untracked files listed | 100 | same, counted separately |
| patch lines per file | 2 000 | "patch cut off", with the real limits named |
| patch bytes per file | 256 KiB | same — for the file that is 40 lines and 8 MB |

The byte cap is applied **at the pipe, not to the answer**: a patch is read up
to the cap and git is then cut off, so an agent's 191 MB `run.log` in a
worktree costs the cap, not 404 MB of resident memory. The whole read runs off
the thread the webview talks on, because one read is up to ~500 `git`
subprocesses and the terminal in the next tab has to keep taking keystrokes.

A file the read could not produce is a **refusal**, never an empty patch: an
empty patch beside `+3 −1` renders as "no textual change to show", which is a
statement about the owner's work that no failed subprocess is entitled to
make. Binary files say they are binary rather than rendering nothing.

The panel reads when it opens, when the base changes, and when *Read* is
pressed. It is never polled — a `git diff` over a real worktree every two
seconds is a permanent load on the machine to answer a question nobody asked
twice.

## The Agent tab, and the difference between wiring and judgement

A worktree can be handed to an **ACP agent** for one turn: a prompt, the
agent's own transcript, and then the Diff tab to read what it changed. ACP is
the protocol this repo already speaks to agents with (`crates/buzz-acp`) —
JSON-RPC 2.0 as newline-delimited JSON over a subprocess's stdio, with
`initialize`, `session/new` carrying the working directory, and
`session/prompt`. Any adapter that speaks it works here: `claude-agent-acp`,
`codex-acp`, `goose`.

**Which agent, and how it is found.** `VINGILOT_ACP_AGENT_COMMAND` first, then
`BUZZ_ACP_AGENT_COMMAND` — the harness's own variable, so a machine already set
up for `buzz-acp` needs no second setting. Arguments come from the *same*
namespace as the command that won (`*_ACP_AGENT_ARGS`, comma-separated), never
mixed across the two. **There is no default agent**: with neither variable set
the panel says so and names both, rather than picking one and failing to spawn
a binary the owner never asked for. The lookup is `PATH` first, then
`/opt/homebrew/bin` and `/usr/local/bin`, because an app launched from Finder
does not inherit a login shell's `PATH`.

**The boundary, said plainly.** The agent runs as a child of this app, with the
owner's account, environment, and credentials, and its working directory is the
worktree. **A worktree is a collision boundary, not a security boundary**
(ADR-003) — it keeps one agent's work off another branch; it does not hold the
agent inside it. Permission requests are answered `allow_once` and every grant
is written into the transcript, so the run is auditable rather than quietly
permissive. Nothing in this feature's copy may read as isolated, sandboxed, or
contained, and `agentTurn.test.mjs` fails the build if it starts to.

**Every wait is bounded**: 60 s for the handshake, 300 s of silence during a
turn, 30 min absolute. A turn that is given up on leaves what the agent already
changed exactly where it is — the panel says so, because the diff is the only
thing that knows.

**What is proven, and what is not.** `vingilot_agent/live.rs` drives the
shipping code — the turn, `git worktree add`, and the diff read — against a real
git repository: the agent edits a file in *its* worktree, the diff surface
reports `+2 −0` on that file, the project's own checkout is untouched, the
permission handed back is the option id the agent minted, a silent agent is
given up on, and a dying one reports what it wrote on the way out. It was also
run once against a throwaway repository outside the tree, which is the form the
owner asked for.

**The agent in those tests is a stub** — forty lines of `/bin/sh` that speak
ACP correctly and decide nothing. No ACP adapter was installed on the machine
this was written on (`claude-agent-acp`, `codex-acp`, `goose`: none; the
installed `codex` CLI has no ACP mode), and nothing was installed to make one
appear. So this proves the **wiring**, end to end, and says nothing about any
real agent's judgement. Those are two different claims and are not merged here.

## The palette — one key to go anywhere and do anything

`⌘K` opens a palette centred over the work surface (`ui/CommandPalette.tsx`,
`lib/usePalette.ts`). It is the workspace's verb surface, not a search box:
everything the workspace can do is reachable from it, so a new action gets
discoverability without needing a button somewhere.

**`⌘K` was already bound in this app, and this map takes it on `/workspace`.**
What was found before claiming it (`lib/paletteKeys.ts` carries the whole
check):

- **Tauri's default macOS menu**, which this app installs by setting none,
  claims `⌘C/X/V`, `⌘Z`, `⇧⌘Z`, `⌘Y`, `⌘A`, `⌘M`, `⌘W`, `⌘Q`, `⌘H`, `⌥⌘H`,
  `⌃⌘F` and Alt+F4 — and nothing else. `K` is not in it, so unlike `⌘W` this
  chord does reach the webview.
- **Upstream's own `⌘K`** is the community search dialog (the sidebar's
  "Search everything ⌘K"), bound at window level on every screen but
  `/settings`. It searches relay messages, so on `/workspace` it opened a
  message search over a workspace it knows nothing about.
- **Upstream's composer** claims `⌘K` at element level for the link editor —
  on the channel screens, never on `/workspace`.

So the island takes it **only on `/workspace`**, through upstream's own
deference path: AppShell's handler returns early on `event.defaultPrevented`,
which is exactly the case it documents. Nothing is taken away — every other
screen keeps upstream's search on `⌘K`, and the sidebar's "Search everything"
button still opens it on `/workspace` too. Extending upstream's dialog instead
would have meant teaching a relay search about worktrees in three upstream
files; a third key would have pointed the owner's muscle memory at the wrong
surface on the one screen this fork exists for.

**Four sources, each a pure function from query to candidates**
(`lib/paletteSources.ts`):

| source | rows |
|---|---|
| **projects** | every project in the workspace, plus **Deck** (the project-less landing view) |
| **worktrees** | the open project's worktrees, labelled with the role and the run that owns them |
| **panes** | every pane in the registry — "show the Diff pane beside the terminal" |
| **actions** | New worktree…, Turn this plan into a worktree…, New terminal tab, **Scratch shell**, **Keyboard shortcuts**, Add project…, Remove *&lt;project&gt;*…, Prune missing worktrees…, and the four layout toggles — each labelled by what it will do next ("Hide the sidebar" / "Show the sidebar") and carrying its own chord |

The scratch row's detail leads with the lifetime — "a shell that ends when you
close it or leave this worktree — keeps nothing: no tab, no tmux session" —
because a row that led with what it *keeps not* would have the owner reading to
the end of the line to find out what he is about to lose.

**One scorer over the union, not one per source** (`lib/paletteModel.ts`).
Nothing in the sort reads a row's `kind`; the five match tiers are 150 points
apart and every penalty is capped, so a substring match can never out-score a
prefix match by being shorter. A palette that ranked within each source and
then concatenated would put the fourth-best project above the perfect action,
and the owner would learn to read the whole list — which is the list he opened
the palette to avoid.

**An action that cannot run is ranked down, never dropped.** Prune with
nothing prunable, "Remove project" on the landing view, a pane with no worktree
under it: all still listed, still findable by name, each carrying the sentence
saying why it will not happen. Hiding them would answer "there is no such
command", which is a different and false statement. Enter and a click on such a
row both do nothing and leave the palette open, because the reason is already
on screen.

**An empty query is the workspace, not an empty box**: what was run recently
comes first (up to 8, kept in `localStorage` under `vingilot-palette.v1` and
surviving a restart), then every source in order.

**While it is open, the chords underneath it do not reach the workspace** —
`⇧⌘B` behind an open palette used to rearrange the columns under it, including
when focus had gone to a blocked row.

## Ask — a mode of the palette, and exactly what it sends

Typing `?` as the **first** character switches the palette from *find* to
*ask*: the text becomes a question about the directory the owner is in
(`lib/askMode.ts`). A `?` anywhere else in a query is just a character in a
filter. `?` rather than `/ask` because this surface's promise is one key and no
ceremony, and because nothing in this workspace is named starting with `?`, so
no row becomes unfindable.

**What is sent with a question is one path.** The panel prints it before the
question is asked, verbatim, and it is a constant in the model so no UI can
drift into implying more:

> **asked with**
> `/path/to/the/worktree`
> …and nothing else — not the diff, not the branch, not the file on screen,
> not a description of the project. The agent is started in that directory and
> reads whatever it opens there itself.

That is the literal call: `agentClient.runAgent` takes a `cwd` and a prompt.
Whether the agent then reads anything in that directory is the agent's own
doing, through its own tools. This is the difference between *a model that was
handed a directory path* and *a model that knows the codebase*, and the UI has
to say which.

**The answer lands in a conversation, not a toast** (`lib/askThread.ts`,
`lib/askStore.ts`). One record per turn — a palette question and a prompt typed
into the Agent pane's box are the same thing, because they are the same adapter
run in the same directory. It is kept per directory in `localStorage`
(`vingilot-ask.v1`): 8 directories, 20 exchanges each, answers cut at 4 000
characters with a marker saying the rest was not kept. Each row carries the
`cwd` it was asked with, so a thread read months later says what *that*
question was sent with rather than what the surface would send today. The
question is written the moment it is asked; the fact that a turn is running is
not, so a row with no answer after a restart reads as "no answer came back"
rather than as an ask still in flight.

**Why not a Buzz channel.** Upstream's chat is the only message store in this
app and it is a relay: every message is a Nostr event signed with the owner's
key and published to a community. Three things follow, each deciding it on its
own — the workspace runs against a local coordinator and needs no community, so
an ask would be unaskable until the owner joined one; the question carries a
path on this machine, and a channel publishes that path to a server; and the
answer comes from a local adapter that holds no key, so landing it in a channel
would mean signing an agent's words with the owner's identity — a forged author
in a signed, hash-chained log. Upstream's *deployed* agents post under their own
pubkeys for exactly this reason (see *Two agent surfaces* below, which is the
same argument read from the other end). The seam that would change this is an
identity for the local agent plus a channel to post into.

**One turn at a time, and a second question is refused in words.** The Agent
pane's Run button and the palette's Enter claim the same mark (`pendingAsk`),
so they cannot disagree — they did, and the palette started a second adapter
process behind the pane's back, which on a hosted adapter is a second login and
a second billed turn. The refusal is shown *before* Enter, and names where the
running turn is, because the guard is one adapter for the whole app rather than
one per directory.

Everything the ask mode can refuse, in the order it is checked:

| when | what it says |
|---|---|
| no worktree open | no worktree is open, so there is no directory to ask in |
| the directory is still being resolved | still working out where this worktree is on disk |
| the agent probe is still running | still asking this machine whether an ACP agent is configured |
| no agent configured | the probe's own sentence, naming `VINGILOT_ACP_AGENT_COMMAND` / `BUZZ_ACP_AGENT_COMMAND` |
| the probe could not answer | this build could not ask, so a question typed here would have nowhere to go |
| a turn is already running | here, or in the other directory it names — "one adapter runs at a time" |
| nothing typed after the `?` | type a question |

**A question storage will not keep is still the conversation.** A refused write
keeps the whole thread in memory and the pane says that is where it is; the
next write storage does take carries the rows it refused earlier, so a quota
that frees up recovers the conversation whole.

## The cheatsheet — what this key does *here*

`⌘/`, or `⌘K → Keyboard shortcuts` (`lib/cheatsheet.ts`, `lib/cheatsheetKeys.ts`,
`ui/KeyCheatsheet.tsx`). Every chord this workspace binds, on one surface,
grouped by what it acts on: the workspace, the columns, the work surface, the
divider, the terminal, the palette, the Diff pane — and then the chords that
are **not** this island's.

**It is generated, and that is the whole feature.** Nothing in
`cheatsheet.ts` writes a chord down. `resolvedChords()` walks a bounded key
space (letters, digits, the arrows, the named keys, every modifier
combination) through every `resolve*` function in the island and keeps what
came back, so adding a chord to `terminalKeys.ts` puts it on the sheet and
removing one takes it off. A hand-written list is a list that goes stale, and
the only way the owner finds out is by pressing a key that does nothing —
which is worse than no sheet at all. What *is* written down is the **sentence**
for each action, because no key module holds one; a chord whose sentence is
missing is still drawn, carrying its own action name, and
`lib/cheatsheet.test.mjs` fails the build until someone writes the line.

**The chords that are not the island's are on it too**, because the question
the sheet answers is "what does this key do *here*" and the owner cannot tell
which handler he is talking to. Two kinds, neither generable from this
repository:

- **`⌘W`**, whose row is the whole point: it takes what is on top and, with
  nothing stacked, minimizes — see the Key map above.
- **The default macOS menu's own table** — `⌘Q`, `⌘C`, `⌘X`, `⌘V`, `⌘Z`,
  `⇧⌘Z`, `⌘A`, `⌘M`, `⌘H`, `⌥⌘H`, `⌃⌘F` — copied from muda 0.19.3
  `src/items/predefined.rs:301-341`, the menu this app installs by setting
  none of its own and deliberately leaves alone. That list is also an
  assertion: **no chord the island resolves may be one of them**, checked over
  the generated set on every build. That check is the ⌘W failure turned into a
  build error.

**`⌘/` was checked against every claimant before it was taken**, which is the
discipline ⌘W was lost for want of: muda's predefined table (no `Slash` — it
exists in muda's accelerator *parser* and no predefined item asks for it),
tauri's own `menu/menu.rs` (no accelerator of its own at all), the app's one
global shortcut (`⌃Space`, push-to-talk), upstream's window handler and
shortcut registry, and this island's own maps. `cheatsheetKeys.ts`'s header
carries the reading, file and line. **`⇧` is tolerated on it**, because on the
Turkish-Q layout the owner types on `/` is `⇧7`; `?` is not, because it is a
different character and would put a `⌘?` on the sheet that nothing can press.

The surface is the palette's, deliberately — same box over the work surface,
same scrim, same eyebrow over a group, and the chords in the same `kbd` boxes
(`ui/Chord.tsx`, which the palette's rows now draw with too). While it is up
it holds the plain keys, so a stray `j` cannot reach the shell underneath, and
lets every chord through, so the keys it describes still work while they are
being read. `⌘1…⌘9` is drawn as its two ends — nine boxes in a row is a wall —
but the row still carries all nine, and that is asserted.

The table in *Key map* above is prose for a reader of this document; the sheet
is the generated answer. If they disagree, the sheet is right.

Proved over a real bundle in `desktop/tests/e2e/workspace-cheatsheet.spec.ts`:
that `⌘/` really arrives over an open project with a terminal mounted, that
the palette's row is a second door to the *same* sheet, that every generated
section renders with its chords as keys, that the `⌘W` row says what it really
does, and that a close request takes the sheet while leaving the palette above
it alone.

## The team thread — talking to a Buzz agent team about one worktree

A pane on the registry (`lib/teamThread.ts`, `lib/teamThreadStore.ts`,
`lib/useTeamThread.ts`, `ui/TeamThreadPane.tsx`). Choose a team, open a thread,
and the conversation is a **Buzz channel on the relay** — upstream's own
messaging, not a fourth store in this island. Choosing the team is part of the
pane rather than a global setting, because the question "which team is this
worktree's" is per worktree.

### The pane owns the chrome; upstream owns the conversation

The conversation in this pane **is** `ChannelRouteScreen` — the same component
`/channels/$channelId` renders, mounted on the thread's channel id, not a copy
of it. It used to be a list and a textarea of the island's own, on the argument
that a worktree thread wants none of upstream's timeline. **That argument cost
the owner the thing the pane is for.** No upstream composer meant no mention
autocomplete and no `p` tags on send, and `buzz-acp` subscribes with
`require_mention` (`crates/buzz-acp/src/config.rs`), so a message carrying no
`p` tag is one the harness **deliberately ignores**. The pane was a room the
team could not hear him in. That is the whole reason mentions matter here, and
it is not a nicety about autocomplete.

What the pane keeps is what only the pane knows: which team, the scope sentence,
the trouble sentences, and the states in which there is nothing to host yet.

**What hosting cost, named.** Four of the things a channel screen does are
*per-app* rather than per-surface, and each is a single slot
(`shared/context/HostedChannelContext.tsx`). On the route there is exactly one
claimant; in a workspace there can be several panes at once and none of them is
*the* channel the app is showing. Two were made per-instance, and two were
deliberately given up:

| slot | what was done | what it cost |
|---|---|---|
| the auxiliary panel (`thread`, `profile`, `agentSession`, channel management) | a component-state twin behind the same `{applyPatch, values}` contract, chosen when hosted (`useLocalPanelState` in `useChannelPanelHistoryState.ts`) | back/forward no longer closes a hosted panel — `replace` is accepted and ignored, because there is no history entry to replace |
| the measured `--buzz-channel-content-top-padding` | the pane supplies its own `MainInsetProvider`, so the variable lands on the pane's root and inherits to exactly the subtree that reads it | nothing, and no upstream change: the app's `<main>` keeps its default, which the spec asserts |
| `setContextParentResolver` | **given up.** One function on the one read-state manager, last mount wins, so a hosted surface does not claim it | a hosted thread's read state rolls up only while the channel route is also mounted |
| `setVisibleChannel` | **given up.** The slot means "the one he is looking at"; a workspace shows several, so any claim is a guess and one pane unmounting would clear a claim another still holds | reconnect replay ordering for panes. The subscription itself is untouched |

`ChannelScreen` sat at 999 lines against the 1000-line ratchet, so lifting the
resolver out was a split (`useChannelContextParentResolver.ts`), not a raise.

**Escape is scoped, not claimed.** `FocusThreadDrawer` binds a capturing window
keydown and calls `stopImmediatePropagation`, so a drawer open inside a pane
would have been the last word on Escape for the whole app — the workspace
palette and the cheatsheet listen on the same window in the same phase, and
register *later*, so they would never have been reached. Hosted, the drawer
answers only while the keystroke is inside its own overlay. On the channel
route, where it really is the top layer, nothing changes.

**What is sent is exactly what was typed.** Nothing is prepended. There is no
honest way to keep a prefix once upstream's composer owns the send: a wrapper
rewriting his message would put a line he did not type into the timeline he is
reading, on a surface whose whole point is being the same one as everywhere
else. So the scope lives where it already lived — the path in the channel's
description, the branch in the channel's name, both on the relay and readable
by every member. The pane prints that claim above the conversation before a word
is typed (`scopeSentence`), and `teamThread.ts` exports nothing that could
compose a prefix again; `teamThread.test.mjs` asserts both the sentence and the
absence of the machinery.

What that costs, said rather than hidden: an agent reading the channel as a
window of recent events sees the path only if it reads the channel's metadata. A
thread whose members need the path *in the words* has to be told it in a
message, by hand, like any other fact.

The scope sentence's last clause — *the team's agents are not started in this
directory* — is what this pane has to say that ask-mode does not. Ask-mode runs
a local adapter *in* the directory; a team member is a managed agent somewhere
else entirely, and a path in a message is a string it may have no way to
resolve.

### What the channel is called, and how a lost thread is found again

`threadChannelName` is **team, then project, then branch** — each slugged to
lowercase alphanumerics and hyphens, capped at 24 characters, empty parts
dropped, `team-thread` if nothing is left. `#welcome-team-vingilot-main` is a
name the owner would have written himself. The build before this one wrote
`wt-<branch>-<team>-<hash>`, and he read `#wt-main-welcome-team-kbz5pz` in his
sidebar and asked what `wt-main` was.

**The discriminator is bought only when a collision actually exists.** The relay
enforces no name uniqueness — nothing in the schema indexes the name, and
`buzz-db` only canonicalises it and refuses an empty one — so a collision is not
an error to report but two identical rows in his sidebar, silently. So
`availableChannelName` checks the wanted name against the list he can see and
appends a six-character FNV-1a of `(bindingId, teamId)` only if it is taken.

**The recovery marker is in the description now, not in the name.** It is
`[vingilot-thread <bindingId> <teamId>]`, and moving it there is what made a
human-readable name possible at all: recovery used to match on the name's
*shape*, so renaming would have disabled it without a word — a failure nothing
notices until a pointer is actually lost, which is the one moment recovery is
all there is. The description was checked to survive the trip first: `get_channels`
builds every row from the kind:39000 `about` tag and `fromRawChannel` copies it
onto `Channel.description`, which is the same list `findThreadChannel` is handed;
and the relay's kind:9002 handler writes only the columns whose tags are present,
so a name-only edit leaves `about` where it was.

A channel the old build named is still *findable*: `isLegacyThreadChannelName`
matches `wt-` plus that pair's discriminator, and `findThreadChannel` asks the
marker first and the old shape only as a fallback, so a repaired channel is
matched on the pair itself. Nothing writes a name of that shape any more.

An old thread is repaired in place, both halves in one `update_channel`
(`threadChannelRepair`): the marker appended to whatever description is there,
and the name rewritten **only if an older build wrote it** — a name the owner
gave the channel is his, and the marker is the half recovery needs. The relay
walks the tags and writes one row per tag, name before about, so a failure
between them leaves a renamed channel with no marker; what saves that case is
the workspace pointer, which finds the channel by id and runs the repair again.
A failed repair is its own trouble sentence (`rename`), because it is an edit
made on his behalf, unasked, to something he can see in his sidebar.

**Availability is answered honestly, and "could not ask" is never rendered as
"no".** Three questions, each asked live rather than once, because all three
change while the owner is looking at them:

| state | what it says |
|---|---|
| no community joined | this conversation is held on the relay, so with none there is nowhere for it to be |
| the team list could not be read | *could not ask* which teams are configured — no answer rather than an answer of none, and the pane stays open |
| no team configured | says so, names `Agents → Teams`, and offers nothing to type into |
| the relay's state is unknown | says the question could not be put; the thread stays open and a send that cannot leave will say so itself |
| the relay is unreachable | the pane can neither show the thread nor take a message; the channel and everything in it are on the relay, and a half-written message is kept on this machine |

**Opening a thread has two halves, and a failure says which one it reached.**
The channel is created and this worktree's pointer written *first*; the members
are deployed *after*. A deploy that fails therefore leaves a working thread, so
the trouble sentence says "the thread is open, but its members could not be
deployed into it — the channel is there and you can send in it, and nobody may
answer". It used to say "the thread could not be opened" for both halves, which
printed a flat contradiction above a live composer.

**What it keeps is a pointer, never a message.** `teamThreadStore.ts` holds two
ids per worktree — which team, and which channel its thread is — and nothing
else. It has no draft store of its own any more: the island had one, and hosting
upstream's composer means upstream's drafts hold what is half-typed, the same
way they do in every other channel. Every message lives on the relay. Changing
team asks first and names the channel it would stop pointing at; nothing is
deleted, the members keep running, and choosing that team again adopts the
existing thread rather than deploying a second one.

### Two agent surfaces, and why that is the design rather than an untidiness

Ask-mode keeps its conversation locally; the team thread puts its conversation
on the relay. That difference is **a consequence of who is speaking**, and
anyone who "tidies" the two stores together will forge an author.

> **The plan's premise was wrong and the survey corrected it.** The plan
> (`docs/plans/2026-08-08-scratch-and-team-thread.md`) said *"a Buzz agent team
> does have its own identity."* It does not. A team is a local JSON record —
> `{id, name, description, instructions, personaIds[]}` (`managed_agents/teams.rs`)
> — with no key of its own, mirrored to the relay as a kind:30176 addressable
> event **signed with the owner's keys** (`commands/teams.rs`). A persona is a
> definition and has no key either.

What does hold a key is each **managed agent instance**, minted at deploy time
with `Keys::generate()` (`commands/agents.rs`). Deploying a team is a fan-out
into one such agent per persona. So the true form of the argument is:

> **The members of a team each post under their own pubkey; the team as such
> never posts.**

That is weaker than what the plan assumed and it is still enough, because the
thing being ruled out is *forged authorship*, not anonymity. The local ACP
adapter holds **no key at all**, so landing its answers in a channel would sign
an agent's words with the owner's identity in a hash-chained log — which is why
ask-mode is local. A deployed team member signs its own, so the relay is exactly
where that conversation belongs — which is why this pane is not local. Nothing
about the pane's design depended on a team having a key; the only thing that had
to be true is that the words in the channel are not attributed to the owner.

Proven over a real bundle in `desktop/tests/e2e/workspace-team.spec.ts`, and the
assertions are on **upstream-owned** testids (`message-composer`, `message-row`)
and on the *absence* of the island's old ones (`team-composer`, `team-send`), so
a pane that grew its own composer back turns them red: that what leaves is the
typed words and nothing in front of them, read off `sign_event` — where every
relay message this app publishes is signed — and addressed to the channel by `h`
tag rather than into any store of the pane's own; that `@` offers the deployed
members from both the sources a normal channel's list is built from, and that
the message carries their `p` tag, compared against the same gesture from
`/channels/general`; that the channel is named the way he would have named it
and an older build's is renamed in place without the pointer or the marker
losing it; that a panel opened inside the pane is the pane's own and never
reaches the URL every pane shares; that a focus drawer inside the pane takes
Escape for its own keystrokes and leaves the workspace's palette holding its
own; that a `list_teams` which *throws* reads as "could not ask" rather than as
"no teams"; that with no team configured the pane says so and hosts nothing;
that a failed deploy does not call its own thread unopened; and that changing
team asks first and comes back without a second deploy.

## An agent replies whatever its shell does to the environment

A team member that cannot answer is not a team member. Every reply from the
owner's Hermes and Kimi agents died the same way — `buzz messages send` exiting
3 with `auth error: BUZZ_PRIVATE_KEY is required` — while the harness that
spawned them held the key the whole time.

**What holds the key: `buzz-acp`, the harness process, and nothing else.** It
signs and publishes on the agent's behalf already; that is how a failure notice
or a heartbeat reaches a channel. **What never holds it: the agent.** It is an
LLM with tools, and everything it does with a credential it does by putting the
credential somewhere a tool can read — a command line, a config file, a
transcript. One of the owner's agents had already put a key-shaped value on a
command line, because the CLI's own error message suggested `--private-key`.

The old arrangement handed the key to the agent's *process* environment and
hoped it would survive into the agent's *shell*. For Claude Code and Goose it
does. For Codex, Hermes and Kimi it does not: those harnesses sanitise the
environment before running any tool command, and with the agent running, its own
shell reported `BUZZ_PRIVATE_KEY`, `BUZZ_RELAY_URL` and `BUZZ_AUTH_TAG` all
empty. Nothing set outside such a harness reaches inside it, so setting the
variables and restarting changed nothing — and no amount of it ever would.

**So a sandboxed shell is now a non-event.** `buzz` resolves its identity in one
order: an explicit `--private-key`, then `BUZZ_PRIVATE_KEY`, then — only when
neither holds a value — the harness's **send broker**, a unix socket (mode 0600
in a per-harness directory created 0700) serving exactly one op: send this
channel message, as this agent. The harness signs it with the key it already
holds. **The key never leaves the harness process**, and a shell may strip
whatever it likes because nothing secret has to get through it.

A key file under `~/.buzz` would also have worked, and was declined: a file the
agent can read hands the agent the key back, which is the one thing this
arrangement is for. The broker is narrow on purpose — it hands out no key
material, signs no caller-supplied bytes or events, and proxies no relay reads,
each refused by name rather than by omission. A general broker is a
key-equivalent with extra steps, and would throw away the reason it was chosen.

The honest boundary: while the harness runs, any process running as the owner
can send messages as that agent. What it cannot do is *take the identity with
it* — there is nothing to copy off the machine, put on a command line, or leave
in a transcript.

**And the agent has to be told, or none of it happens.** The base prompt used to
say *"Auth env vars: BUZZ_RELAY_URL, BUZZ_PRIVATE_KEY…"*, which is precisely
what made an agent read exit 3 as *I have no credentials* and stop. It now says
the agent holds no credentials, that exit 3 means the shell it used has none,
and that a `[Tools]` section names the way round. That section is built per
agent and names **exactly one** path: a credentialed MCP `shell` tool where the
harness was given one (it restores the whole CLI, not just sending, and runs
outside the harness's sandbox), otherwise the broker socket, literally, with the
command to use. Two instructions for one failure would leave the model choosing,
and the wrong choice is silence. The socket path has to be in the prompt because
it is also passed in `BUZZ_BROKER_SOCKET` and the shells this exists for strip
that variable too — the prompt is the one channel they cannot filter. Naming it
costs nothing: a socket path is not a secret, its protection is the mode of the
directory holding it, and that is why it may have a flag when the key never will.

## The two documents a project carries — Notes and Plan

One substrate, two panes (`lib/documents.ts`, `lib/documentStore.ts`,
`lib/autosave.ts`, `lib/useDocument.ts`). A document is markdown, per project,
per kind; **Notes** is a note, **Plan** is a brief that can be turned into a
worktree. They are separate documents, not one document with a flag.

**Where they live: `localStorage`, under `vingilot-documents.v1`** — 24
documents, 40 000 characters each, oldest save evicted first. What that was
weighed against, and why each alternative lost:

- *The coordinator's workspace state*, where `deck.pins` live (and where the
  project list is pushed but no longer kept — see *The control plane is
  optional*), is CAS-versioned and could detect a conflicting write. But **the
  coordinator can be down, or absent altogether** — this screen reads a
  three-state control-plane signal precisely because both happen — and a note
  pane that will not keep a note because a local service is not running is not
  a note pane. It is also one blob read-modify-written, so an
  autosave every few seconds would bump the revision under whoever is writing
  pins, and it buys no sync: the coordinator is a process on 127.0.0.1.
- *A file on disk* would show up in the owner's `git status` inside the
  project, and outside it would need a new Rust command and a directory this
  app decided to own without being asked. Writing a plan into a worktree is an
  explicit act with a name (below), not where the document lives while it is
  being typed.

**Autosave, with the numbers said out loud.** The write happens 600 ms after
the last keystroke, **or** 1 500 ms after the first unwritten one, whichever
comes first — a trailing debounce alone never fires while someone is typing
steadily, so a long paragraph would be a long unwritten one. The pane shows
`saved`, `unsaved`, or `not saved`; the third is deliberately not folded into
the second, because telling the owner "unsaved" about a document that cannot be
saved at all would have him wait for a write that is never coming. **A write
that did not happen is never reported as saved.**

**Every ending flushes what is pending** — the pane being swapped, `⌥⌘B`
taking the right side away, the project changing, the screen closing (all one
unmount), plus the window's own `pagehide` and `beforeunload`. **A `⌘Q` is not
one of them, and that is not hedging:** this app intercepts the main window's
close and either dismisses what is stacked over the work surface or minimizes
the window into the Dock — **it never hides it and it never closes it**
(`src-tauri/src/vingilot_window/mod.rs`) — so a `⌘W` never navigates the
webview and never fires either event; and the real exit stops the Rust side and
ends the process without navigating the webview, so no unload event is promised
there. The honest worst case at a quit is *whatever was typed since the last
write*, and the 1 500 ms ceiling is that bound. Measured in the shipping e2e
bundle under Chromium: either window event alone covers a reload, and with both
removed a note still inside the debounce is lost. **Not measured in the
shipping WKWebView** — that is a different engine and no claim is made for it.

**Two windows on the same project: last write wins, whole document.** There is
no merge and no cross-window notification, and the store deliberately does not
listen for `storage` events — a second window's write arriving into an editor
mid-sentence would replace what the owner is typing, which is a worse failure
than the one it fixes. Each window reads the document when its pane mounts and
writes all of it when its own autosave fires, so paragraphs typed in the other
window between those two moments are gone, not merged. The exposure is exactly
"both windows have the same project's pane open and both are being typed into",
and the losing window still shows its own text until it is remounted.

Both panes say on screen where their document is kept, and neither implies more
than is true: Notes says *"kept in this app on this machine — not in the
project, and not on a server"*, and Plan says the same with the one thing that
is different about it — *"it reaches a checkout only when you open a worktree
from it."*

## A plan becomes a worktree

The act the owner asked for: **turn this plan into a worktree**
(`lib/planBrief.ts`, `ui/PlanWorktreeDialog.tsx`,
`src-tauri/src/vingilot_worktree/brief.rs`). Two doors — the Plan pane's button
and the palette's *Turn this plan into a worktree…* — and **one dialog**, which
is what reads the plan, so a palette row cannot act on a plan the owner has
edited since the row was drawn.

**The branch name is offered, never taken.** It is derived from the plan's
title into an editable field, and what git is asked for is whatever is in that
field when the button is pressed. Non-ASCII letters survive — git refs are
UTF-8 and `dokümanlar` is a perfectly good branch name — while the *directory*
under `~/.vingilot/worktrees/<project id>/` is reduced to ASCII separately,
because that is a fact about paths, not about refs. Legality is git's answer,
not this app's: a second copy of `check-ref-format` here would eventually
disagree with git.

**What crosses the Tauri boundary** is the repo path, the branch in the field,
the base — `HEAD` by default, in a field of its own, because branching from
where the project already is, is what is meant nine times in ten — the worktree
path, the filename `PLAN.md`, and **the plan as
it is on screen** — with a final newline added and nothing else, no header, no
timestamp, no "generated by". The document is read live rather than out of
storage, which is a debounce behind: the pane's button and the dialog once
disagreed about the same plan, so a plan rewritten and acted on straight away
briefed the worktree with the text the owner had already replaced, and a plan
typed from nothing was offered by the pane and called empty by the dialog.

`PLAN.md`, at the root, in capitals: whoever opens the checkout next — the
owner in a shell, an agent handed the directory — has to find it without being
told where to look, and root capitals is what every repository already uses for
a document about the whole checkout. Not the plan's title (a name that varies
cannot be found by convention), and not a dotfile (a hidden file is one nobody
reads).

**The order is the guarantee.** `git worktree add` first, and the brief only
into the path git came back with — so a refused creation leaves no file
anywhere, and the path written to is never one this app chose. The file is
opened `create_new`, so "there was already a `PLAN.md` here" is the
filesystem's answer rather than a check that could lose a race.

Every refusal it can give:

| refusal | what the owner is told |
|---|---|
| the plan is empty | the act is blocked before the dialog will act: "this project's plan is empty, and the worktree would carry an empty `PLAN.md`. Write what the work is first." |
| no project open | the palette row is listed but blocked: "no project is open, so there is none for this to act on." |
| the branch name is not a legal ref | `git will not accept "…" as a branch name.` — git's verdict, not a local rule |
| the branch exists | `the branch "…" already exists. Pick another name — nothing was changed.` |
| something is already at the path | it was left exactly as it is; move it yourself or use a different name |
| the base names no commit | `"HEAD" names no commit in this repository.` |
| the project is no longer a git repository | `… is not a git repository any more — nothing was changed.` |
| no git on this machine | `no git on this machine that answers git --version.` |
| **the worktree was made but the brief was not** | both facts, together: the worktree exists on its branch, the file it would have written was already there and was left alone, the plan is still in the Plan pane, and **nothing was removed**. The dialog stays open and Create is disabled, because re-pressing it would now fail on a branch that exists |
| the filename is not a filename | `"…" is not a filename, so nothing was written.` — `..`, `docs/PLAN.md` and a leading dot are all refused before anything is opened |

A worktree that was created is reported as created even when its brief was not.
Failing the whole call would mean a refusal that describes a worktree which
exists, on a branch that exists, and the only way to make that description true
again is to remove them. **Nothing in this island removes anything to tidy up
after itself.**

**What is proved where, for all four of these surfaces.** The pure models carry
`.test.mjs` files beside them and run in `pnpm test`. What only a running app
can say is in six Playwright specs over the real `pnpm build:e2e` bundle —
`workspace-palette`, `workspace-ask`, `workspace-notes`, `workspace-plan`,
`workspace-columns`, `workspace-no-overlays` (the last two belong to the pane
host underneath) — which assert against what is rendered and, where a boundary
is involved, against **the arguments that crossed it**: the palette's key claim and its deference to upstream, the pane
it switches to, an action that really runs, the scope line before a question is
asked, the second question refused in words, a note surviving a reload and a
note surviving the page ending mid-debounce, and the branch and plan text that
`worktree_add_with_brief` was actually called with.

What git does is proved in Rust instead, against **real repositories** the
tests create and throw away (`vingilot_worktree/brief.rs`, over a `TempDir`
under `TMPDIR` — never a repository the owner is working in): that the plan
lands in the worktree it opened and not in the project, that a `PLAN.md`
already on the base branch is never written over, that a refused creation
writes no file anywhere, that a name which is a path cannot reach outside the
worktree, and that a briefed worktree is still one `git worktree remove` will
close — after refusing while the brief is uncommitted, like any other untracked
file.

## What this workspace deliberately does not do

- **No editor.** VS Code's real value in the owner's screenshots is *reading a
  diff*, which the Diff pane covers. A text editor is a much larger commitment
  and he did not ask for one.
- **The Agent pane's real ACP backing is not built, on purpose.** The pane
  speaks ACP to whatever `VINGILOT_ACP_AGENT_COMMAND` / `BUZZ_ACP_AGENT_COMMAND`
  names, and **no adapter is installed on this machine** — `claude-agent-acp`,
  `codex-acp` and `goose` are all absent, and the installed `codex` CLI has no
  ACP mode. Installing one lives outside this repo and is the owner's call, so
  nothing was installed and nothing is defaulted: with neither variable set the
  pane says so and names both. Everything proved about the agent, and about
  ask-mode, is therefore **wiring** — the turn, the transcript, the guard, the
  diff that follows — proved against a stub that speaks ACP and decides
  nothing. No claim about any real agent's judgement is made anywhere here.
- **No Xcode.** A native iOS toolchain is not reproducible here, and a bad
  imitation of one is worse than alt-tabbing to the real thing.
- **No notes vault.** There is a Notes pane now, and it is one note per
  project — not Obsidian. No vault, no linking, no search across notes, no
  files on disk: a document the project carries, kept in this app on this
  machine. A notes *product* is still not this app's business.
- **No `rm -rf`, anywhere, for any path.** Worktrees are removed with
  `git worktree remove`, which refuses a dirty tree. Named files go with
  `rm <file>`, empty directories with `rmdir`. This binds generated code and
  agent prompts too — anything that appears to need a recursive force-delete
  is a stop-and-ask.
- **No agent runs by default.** Running a real coding agent as a Run's command
  is configuration (`VINGILOT_CMD`), not code — and deliberately not wired up:
  see the note under *Work products* below. The Agent pane and the palette's
  ask mode are the other two doors, and both are configuration too: with no
  `*_ACP_AGENT_COMMAND` set, nothing spawns and both say so.
- **No agent judgement is claimed.** The proof used a stub that speaks ACP and
  decides nothing, because no adapter was installed — see the bullet above and
  *The Agent tab* further up.
- **The scratch shell keeps nothing, and is not going to.** No persistence, no
  isolation, no second one, no confirmation before it ends. Each of those is a
  decision rather than a gap: persistence would make it a terminal tab,
  isolation is outside V1's trust model for every shell in this app, and a
  confirmation would make the throwaway thing the ceremonious one. What has to
  outlive a keystroke belongs in one of the worktree's terminal tabs.
- **The team thread does not put a team in the worktree.** Its members are
  managed agents running wherever they run; the *path* reaches them as the
  channel's description and the branch as its name, never as a line in front of
  a message, and whether anything on the other end can open it is not this
  pane's claim to make. There is no file access, no diff, no transcript and no
  plan in what is sent, and the pane enumerates that on screen rather than in
  this document alone.
- **Neither surface reads the other.** The ask thread is local because its
  speaker has no key; the team thread is on the relay because its speakers have
  their own. They are not two implementations of one thing waiting to be merged
  — see *Two agent surfaces* above before touching either store.

## The control plane is optional

The owner installed the built app on his work Mac and could not use it at all:
*"the coordinator is not answering — nothing was changed … control plane
unreachable — read-only since 2:08:55 PM … proje ekleyemedim."* That was not a
bug in his install. The coordinator is a **development service** — Postgres in
Docker on 5435 plus `cargo run --bin vingilot-coordinator`
(`vingilot/scripts/coordinator-run.sh`) — and none of it ships in the `.dmg`,
while the project list lived only inside its workspace document. So on every
machine that is not the Mac mini, the workspace opened with no projects and no
way to add one, under a red box that said to wait.

Since 2026-08-10 the coordinator is optional, and this is the line:

| needs it | does not |
|---|---|
| **Runs** — starting one, transitioning one, the run list, evidence, budgets, the executor | **Projects** — the list is a file on this machine (below) |
| **Deck pins** — they live in the workspace document, so pinning is genuinely a coordinator feature | **Worktrees** — `git worktree list` off the filesystem (`worktreeClient.ts`), including the ones the owner made in a shell |
| | **Terminals and the scratch shell** — local PTYs, tmux-backed |
| | **Diff** — `git diff` in the checkout |
| | **⌘K, the cheatsheet, Notes, Plan** — in the app, on this machine |

The **team thread is on neither side of that table.** It is on the relay
(`teamThread.ts`), a different service that is up or down on its own — which is
why neither banner sentence calls it local, and why "the team thread works"
would be the next wrong clause if one did.

**Two states, and they get different sentences** (`lib/reachability.ts`'s
`controlPlaneKind`, drawn by `ui/ControlPlaneBanner.tsx`, `data-testid`
`control-plane-banner` carrying `data-state`):

- `outage` — a coordinator answered and then stopped. It has a start time, it
  is probably temporary, and a countdown to the next retry is useful. Drawn as
  an `alert`, in the destructive colour, announced assertively.
- `absent` — nothing has answered here since this workspace opened. Not an
  error, not temporary, no clock worth naming. Drawn as a muted `note`,
  announced politely, saying which one feature is unavailable and that there is
  nothing to wait for. It keeps probing: the 2s cadence holds for the first
  minute (a coordinator started by hand right after launch is picked up at
  once), then settles to 30s, and "Check now" probes immediately at any time.
  **That cadence reaches every coordinator poll in the app** — `pollMs` travels
  as a prop through `PaneProps`, and `controlPlaneCadence.test.mjs` refuses any
  poll in the runs UI that does not take it.

Nothing *configures* a coordinator — the client always talks to
`127.0.0.1:7117` — so an answer is the only evidence one exists on this
machine, and its absence the only evidence one does not. **The word "read-only"
is gone from the app**, and a test keeps it gone: the workspace was never
read-only, and the sentence that said so is why he waited instead of working.

### Where the project list lives

**`~/.vingilot/projects.json`**, beside `~/.vingilot/worktrees` — a plain
pretty-printed JSON file the owner can open, copy and back up. Written by
`src-tauri/src/vingilot_projects/` with write-then-rename, so an interrupted
save leaves the old list intact; read by `lib/localProjects.ts`, which **refuses
an unparseable file rather than reading it as empty** and says so on screen
(`unreadableStoreNotice`). An empty list with nothing said beside it is exactly
what a fresh install looks like, and that is the one thing this file must never
be mistaken for.

Not `localStorage`: a webview data reset clears it without telling anyone, and
the owner cannot open it, put it in a backup, or hand it to anyone who asks
what his projects are.

### One direction, never two

When the coordinator is reachable, the local list is **pushed** into its
workspace document so a Run can still reference a repo by id. **Nothing is ever
read back out of it into the local list** — a two-way merge between a file and
a CAS document is a conflict machine, and this design does not open it.

There is one case that does not push either, and it is reachable on the Mac
mini: launch while the coordinator is down, add one project, coordinator comes
back holding five. Seeding is refused there (the list was already started), so
pushing would replace his five with the one. `pushDecision` refuses too, and
`unreconciledNotice` names the way out on screen rather than picking a winner
behind him.

### Seeded once, and said out loud

On the Mac mini his real projects exist **only** in the coordinator, so the
first run of this build decides whether he still has them.
`seedOnceDecision` imports them exactly once, and its condition is four
separate facts, all required, because each one is a way to lose or duplicate
the list: never imported before; the local list is empty; the coordinator
**answered** (not "was polled" — a `null` snapshot is no answer, and reading it
as "no projects" would write an empty list over his and mark it done); and it
has something to import.

It takes the whole workspace document rather than a list read out of it, so an
entry this build cannot parse is carried across into `foreign` instead of being
dropped at the exact moment the coordinator's array becomes the file he is told
to back up. The import is recorded in the file, so the "once" survives a
restart, and `importNotice` says on screen that it happened — a silent import
is indistinguishable from a silent loss when it goes wrong.

**Proof:** `localProjects.test.mjs` and `reachability.test.mjs` for the pure
model, `vingilot_projects` over real temp directories for the bytes, and
`tests/e2e/workspace-no-coordinator.spec.ts` for the machine itself — a
workspace with nothing listening on 7117 that opens, adds a project, keeps it
across a reload, lists worktrees from git, and says the absent sentence.

## Where things live

- **Island (fork-owned, additive):** `desktop/src/features/runs/**`
  - `lib/` — coordinator client, polling, run model, budget/legalNext,
    provision spec, reachability (`reachability`, `controlPlaneCadence`), the
    local project list (`localProjects`, `localProjectsClient`,
    `useLocalProjects`), projects/worktrees, the terminal tab model
    and key maps, the diff model, the agent turn model, the pane model and
    layout, the palette (`paletteKeys`, `paletteModel`, `paletteSources`,
    `paletteStore`, `usePalette`), ask mode and its thread
    (`askMode`, `askThread`, `askStore`, `askRunner`), the document
    substrate (`documents`, `documentStore`, `autosave`, `useDocument`,
    `planBrief`), the scratch shell (`scratchTerminal`,
    `terminalPersistence`), and the team thread (`teamThread`,
    `teamThreadStore`, `useTeamThread`), what a window close
    request means (`closeRequest`, `useCloseRequest`), and the cheatsheet
    (`cheatsheetKeys`, `useCheatsheet`, and `cheatsheet` — which imports every
    key map above precisely so it can generate the sheet from them). All pure
    modules carry their `.test.mjs` next to them; desktop's own `pnpm test`
    glob runs them. The clauses above name a *role* and then the modules that
    make it up; the deck, the columns, the repo picker and the type scale have
    their own files under the same directory and are not spelled out here —
    `find lib -name '*.ts'` is the list, this is the map.
  - `ui/` — `RunsScreen` (the three columns), `ProjectsNav`, `WorktreeColumn`,
    `WorkSurface` and the pane host (`PaneFrame`, `PaneDivider`, `PanePicker`,
    `paneRegistry`), `Terminal`, `TerminalTabStrip`, `WorktreeDiffPanel`,
    `AgentPanel`, `CommandPalette`, `KeyCheatsheet`, `Chord` (the kbd boxes
    both of those draw a shortcut with), `DocumentEditor`, `NotesPane`,
    `PlanPane`, `ScratchTerminal`, `TeamThreadPane`, `PlanWorktreeDialog`,
    `NewWorktreeDialog`, `PruneWorktreesDialog`, `ProjectStatusBar`,
    `RunsPane`, `EvidencePane`, `PinnedCard`, `DeckConflict`, plus the
    pre-existing `RunList`, `DeckPane`, `RunDetail`, `BudgetBar`,
    `StopAllButton` (hold-to-engage), `ControlPlaneBanner`,
    `RunsLoadingFallback`.
- **Island (fork-owned, Rust):** `desktop/src-tauri/src/vingilot_pty/**` (the
  PTY sessions, their scrollback, tmux backing, and the live proof),
  `vingilot_repo/**` (read-only probe of a picked directory),
  `vingilot_worktree/**` (worktree add/list/remove, the diff read, and
  `brief.rs` — a worktree opened with the plan that asked for it),
  `vingilot_agent/**` (the ACP client over an agent subprocess, which agent to
  run, the transcript, and the end-to-end proof),
  `vingilot_projects/**` (`~/.vingilot/projects.json` — write-then-rename, and
  the only thing in this app that owns those bytes).
- **Touch-points (declared in `vingilot/seams.yaml`):** the sidebar nav entry,
  the `/workspace` route registration, and the command registry in
  `src-tauri/src/lib.rs`. Kept to a few lines each — these are the files
  upstream merges can conflict on.
- **Coordinator:** unchanged except a localhost-allowlist CORS layer so the
  webview can call `http://127.0.0.1:7117` directly.

## Run it

```bash
just dev                                 # Buzz desktop — "Projects" in the sidebar
```

That is the whole of it on a machine with no control plane, which is every
machine but the one the coordinator runs on. Projects, worktrees, terminals,
diff, ⌘K, the cheatsheet, Notes and Plan all work; a muted note says runs
cannot start here and that there is nothing to wait for.

Runs need the two development services below, and nothing in the `.dmg` starts
them:

```bash
docker compose up -d                     # postgres/redis/minio (vingilot-isolated stack)
./vingilot/scripts/coordinator-run.sh    # control plane on 127.0.0.1:7117
```

Killing the coordinator while the workspace is open is the **outage** state,
not the absent one: the banner names the time it stopped answering, counts down
to the next retry, and clears itself when it returns. See *The control plane is
optional* above for which state says what, and why neither of them says
"read-only".

## Honest notes

- The dev bearer token is a constant in webview code (`lib/coordinatorClient.ts`)
  — acceptable for a localhost-only control plane in V1; the follow-up is a
  Tauri-side proxy holding the token in the keychain.
- Wall-clock budgets are enforced (solid meter — the reconciler pauses the
  run); token counts are observed only (dashed `≈`, absent entirely when no
  data exists). Illegal transitions are absent from the DOM, not disabled.
- **⌘K is the island's on `/workspace` and upstream's everywhere else.** It was
  upstream's on every screen until this branch; the claim is scoped to the one
  screen and made through upstream's own `defaultPrevented` deference path, and
  the sidebar's "Search everything" button still opens upstream's dialog from
  the workspace. (This line used to read "no global ⌘K in the Runs screen —
  Buzz owns that shortcut for search". It does not any more.)
- **Six `localStorage` keys are this island's, all origin-scoped and all
  local:** `vingilot-columns.v1` (which columns are collapsed),
  `vingilot-panes.v1` (the pane arrangement), `vingilot-terminal-tabs.v1` (the
  terminal tabs), `vingilot-palette.v1` (the palette's recents),
  `vingilot-ask.v1` (the ask conversation), `vingilot-documents.v1` (Notes and
  Plan). Each is versioned so a shape change
  takes a new key rather than a migration — an older build reading a newer
  library finds nothing rather than something it half-understands. None of them
  is backed up, synced, or reachable from another machine, and the panes say
  so.

## Deferred

Chat adapter tie-in (Runs ↔ channels), attaching a terminal to a *Run's* own
process rather than to a worktree, side-by-side diff rendering, Tauri-proxied
coordinator auth, per-mode token budget enforcement (needs the
executor/broker — see `coordinator.md`'s deferred gaps).

Delivered since this list was written: the per-worktree PTY surface with
multiple tabs and tmux-backed persistence, worktree create/remove from the UI,
adding and removing projects through the folder picker, and worktree diff
review.

## Executor

The executor (`vingilot-executor`, `vingilot/coordinator/executor/`) is the
broker's first incarnation (ADR-003): it claims a `ready` delegated Run over
the coordinator's HTTP API, provisions a real `git worktree`, runs the Run's
command inside it, streams stdout/stderr as evidence rows, and drives the Run
to `completed`/`failed` honestly — a nonzero exit is a `failed` Run with the
exit code recorded, never a retry-until-green.

Every side-effecting step (worktree creation, running the command) is
preceded by a `validate-op` fencing check against the write-granted
binding's epoch (ADR-003 §Fencing). A denial — most commonly a stale epoch
from a concurrent re-acquisition — aborts `execute_run` immediately via
`ExecError::Fenced`, appends an `error` evidence row naming exactly what was
denied, and the run **never transitions past its current state on that
path** (no explicit `failed` transition is fired for a fencing denial itself
— the run simply stops progressing; the coordinator's reconciler
subsequently observes the lapsed/lost lease and moves it to `paused` with
reason `"lease lost"`, which is what live-tested fencing evidence looks like
in the Runs screen).

### Run it

```bash
docker compose up -d                        # postgres/redis/minio
./vingilot/scripts/coordinator-run.sh        # control plane on 127.0.0.1:7117
./vingilot/scripts/executor-run.sh <workspace-id>   # worker: polls every 3s,
                                              # claims oldest ready delegated run
```

`executor-run.sh` env: `VINGILOT_REPOS` (`repo_id=path` map, default
`buzz=<this checkout>`), `VINGILOT_WORKTREE_ROOT` (default
`~/.vingilot/worktrees`), `VINGILOT_CMD` (overrides the default `echo
executing: {objective}` command body). A single Run can also be driven
directly: `cargo run -p vingilot-executor -- execute --run <id>`.

### Live-tested loop (2026-08-03)

Against the dev workspace (`00000000-0000-0000-0000-000000000001`, the id
`RunsScreen` hardcodes): created a delegated Run with objective `"prove the
loop"` via `POST /v1/runs` + `POST /v1/runs/{id}/provision` (one write
binding on `repo_id: "buzz"`), started the worker, and watched it claim →
`git worktree add` → run the default echo command → `completed`, with real
evidence rows (the exact `git worktree add` command + its output, the
command + its output, an `outcome: completed` note) — captured in
`desktop/test-results/screenshots/executor-evidence.png` (Runs screen,
completed run selected, Evidence pane visible with live data from the
running coordinator, not mock data).

Fencing: reproduced by provisioning a second Run and, the instant it was
`ready`, flooding `POST /v1/bindings/{id}/lease` (an unconditional
re-acquire, per `binding.rs`'s doc comment: "always bumps the binding's
epoch regardless of who calls it") from an out-of-band client concurrently
with the worker's own claim — a race, not deterministic on the first try;
worktree_bindings epoch is a single contended row, capped at ~3–3.5k
acquisitions/sec by Postgres's per-row lock serialization, so multiple
attempts were needed before a bump landed between the worker's own
`acquire_lease` and its next `validate-op` call. The denied attempt shows up
exactly as `binding.rs` promises: an `error` evidence row — `"validate-op
denied before git worktree add: denied: stale epoch: binding <id> is at
epoch <N>, presented <N-8>"` — and the run never reaches `completed`; the
background reconciler later paused it (`running → paused`, reason `"lease
lost"`). Captured in
`desktop/test-results/screenshots/executor-fencing-denial.png`.

### Deferred (executor-specific)

Interactive/PTY execution mode, ACP harness launch (the command template —
`ExecutorConfig.command_template`, `{objective}` substituted — is the seam
where `claude -p` slots in later), per-mode token caps, worktree retirement
(worktrees are kept as the Run's artifact; cleanup is later UI work),
multi-run concurrency (the worker claims and runs exactly one Run at a
time), and an explicit `failed` transition on a fencing denial itself (today
the reconciler's `paused`/"lease lost" is the observable signal instead).

## Work products — what a Run changed

After the command exits, the executor captures the Run's work product (fenced,
like every other side effect):

1. `git status --porcelain` in the task worktree → a `note` evidence row.
2. If dirty: `git add -A && git commit` **inside that worktree, on the Run's own
   branch** → a `commit` evidence row carrying the real sha. This is the single
   place `add -A` is correct — the worktree exists solely for this Run and the
   commit *is* the artifact. The standing "never `git add -A`" rule applies to
   this repository and is unaffected.
3. `git diff HEAD~1 --stat` → `note`; the diff itself → a `diff` evidence row,
   capped at 48 KiB (the coordinator's per-row evidence ceiling is 64 KiB) with
   a truncation marker naming the real untruncated byte count.

A capture failure becomes `error` evidence; the Run's outcome still reflects the
command's exit code — capture is reporting, not verification.

RunDetail renders `kind=diff` through a pure `diffView` model: additions in the
ok colour, deletions in the stop colour, `@@` hunks emphasised, meta lines plain.
Commit rows appear in the Evidence timeline with a `⎘` prefix.

**Running a real coding agent as the command** is configuration, not code —
`VINGILOT_CMD` runs anything, so a headless harness slots straight in. That is
deliberately NOT wired up by default: an autonomous agent loop with approvals
disabled, inside a worktree ADR-003 declares is a collision boundary and not a
security boundary, is the owner's call to make explicitly — not a default.

## Deck — membership syncs, layout does not

Deck is the Runs screen's home pane (`ui/DeckPane.tsx`), not a separate
route or a second Deck identity. It splits what a pin *is* from where it
*sits*, because those two facts have different owners:

- **What's pinned (the set) syncs.** The pin set lives in Workspace state
  under `deck.pins` — `{ id, kind, pinnedAt }[]` — written through the
  coordinator's existing CAS mutation endpoint
  (`POST /v1/workspaces/{id}/mutations`) with `expected_revision` set to the
  revision the write was computed against. This is deliberately the *first*
  UI-driven exercise of ADR-002's mutation protocol; until Deck, only Rust
  tests wrote through it. `lib/deckSync.ts` is the orchestrator: read the
  current revision → compute the next `pins` array → write with that
  revision. It never retries a 409 on its own.
- **Where it sits (the layout) does not.** Order is `localStorage`, keyed by
  workspace id **and** a per-device id (`lib/deckLayout.ts`'s `layoutKey`).
  A laptop cannot scramble a monitor's arrangement, because the two devices
  never share a layout key — there is no server round-trip for order at all,
  so there is nothing to race. `deviceId()` is generated once and persisted
  locally; it never leaves the device (it is not part of any request body
  `deckSync` sends).

### Arrival on another device

When a pin appears in the synced set but this device's local `order` has
never seen its id — pinned elsewhere — `applyLayout` puts it in `unplaced`
rather than guessing a position. `DeckPane` renders unplaced cards with a
dashed border and the caption "pinned on another device — place it where you
like." Placing one (move-left/move-right or the `Place` action) inserts its
id into this device's `order` and persists it locally; it has no effect on
any other device's arrangement or on the synced set.

### Conflict resolution

A pin write races another device's write at the same revision → the
coordinator returns 409. `deckSync` surfaces this as
`{ conflict: true, revision, stateHash }` instead of retrying — nothing is
silently overwritten. The UI re-reads the winning state via a follow-up
`GET`, computes `pinsDiff(mine, theirs)`, and shows the conflict banner
(`data-testid="deck-conflict"`): "your pin didn't apply — `<device/rev>`
changed the pinned set first," with the added/removed ids listed. The owner
picks: **Keep theirs** (adopt the winning set, done) or **Re-apply mine on
top** (re-read the current revision and issue a fresh CAS write naming that
revision — a rebase, not a blind retry, per ADR-002).

### Tombstones

A pinned id whose Run no longer exists in the API (deleted, or from a
workspace this device can no longer see) renders a tombstone card — "no
longer available — unpin" — never a blank slot and never a crash. Unpinning
a tombstone is a normal CAS write removing that id from `deck.pins`.

### Reachability

While the coordinator is unreachable, pin toggles disable with the inline
reason inline, matching the rest of the Runs screen's honest-degradation
pattern — no fake queueing of a pin action that cannot actually be sent.

### Deferred

Drag-and-drop (ordering today is move-left/move-right buttons plus
keyboard — testable, no new dependency); `pr`/`surface` pin kinds (the
`Pin`/`PinKind` model already parses them; no UI renders them yet); multiple
Deck identities; Deck as a route independent of the Runs screen; interactive
surface actions (the design's action protocol — its own replay-safety work,
later).

## The name, the mark, and what a new bundle identifier costs

The app is called **Vingilot**. It is a fork of `block/buzz` and it has to be
able to sit in the Dock next to the owner's existing Buzz without either one
shadowing the other, which is what forces the identity change below.

### The one sentence

**Vingilot starts empty; installing and running it changes nothing Buzz owns —
but the identity and the agent nest are not Buzz's, they are the machine's, and
either app's sign-out deletes them for both.** Nothing is copied or moved. The
two shared scopes, and what reaches them, are below — this is not a summary, it
is the whole consequence.

### What actually keys off the bundle identifier

The identifier goes from `xyz.block.buzz.app` to `dev.ahmetbirinci.vingilot`.
Three things in this codebase resolve their location from it and three do not,
plus one that resolves from the *old* identifier by name. The split was read out
of the code, not assumed:

| Storage | Keyed off | Consequence for Vingilot |
|---|---|---|
| App data dir — agent roster, personas, teams, retention db | `app_data_dir()` → `~/Library/Application Support/<identifier>` | **Empty.** Agents must be re-added. |
| Webview storage — community/relay list, theme, accent, drafts, zoom | `~/Library/WebKit/<identifier>` (see `reset.rs`) | **Empty.** The relay must be added once. |
| Single-instance lock | `tauri-plugin-single-instance`, per identifier | This is *why* the identifier must change: same identifier, and the second app refuses to launch. |
| Nostr identity (the owner's nsec) | keychain service `"buzz-desktop"`, a constant in `app_state_keyring.rs` | **Shared.** Vingilot boots as him — same pubkey, same account — and destroys it for both on sign-out. |
| Agent keys | same keychain blob, same service | **Shared**, same terms. |
| Agent nest — `AGENTS.md`, `RESEARCH/`, `PLANS/`, `GUIDES/`, `WORK_LOGS/`, `OUTBOX/`, `REPOS/` | `~/.buzz`, a constant in `managed_agents/nest.rs` | **Shared.** Both apps read and write the same nest, fight over one `REPOS`, and either one's sign-out deletes it. |
| `buzz channels create --template <name>` | the literal `"xyz.block.buzz.app"` in `crates/buzz-cli/src/commands/channel_templates.rs` | **Points at Buzz.** A template made in Vingilot is invisible to the CLI unless `--templates-file` names Vingilot's store. |

So "starts empty" is narrower than it sounds. The identity and everything the
agents have written down survive; the app's own configuration — which relay,
which agents, which layout — does not.

A macOS keychain item carries an access list per signing identity, so the first
launch will raise *"Vingilot wants to use your confidential information stored
in buzz-desktop"*. Answering **Always Allow** is what makes the identity carry;
answering Deny makes Vingilot generate a fresh identity instead.

### The two shared scopes, and what they cost

The last two rows are shared because they are named by *constants* rather than
derived from the identifier, and that has two consequences the table does not
carry on its own. Both are real; neither is fixed in code, and the reason is the
same in both cases: the sharing is what the owner is buying.

**A sign-out is machine-wide.** `reset.rs` step 3 removes
`managed_agents::nest_dir()` and step 4 deletes every key in the `"buzz-desktop"`
blob — the whole nest and the whole keychain, from whichever app is signing out.
The wipe is reached from the product path (`write_sentinel` on sign-out,
`run_boot_reset` at the top of `setup()`). What makes this tolerable rather than
a trap is that **the nsec and the nest are singular on this machine**: Buzz's own
sign-out deletes exactly the same key and exactly the same directory. Vingilot
adds a second button on the same objects, not a new hazard — and the button is
gated behind the displayed nsec, a backup checkbox, and typing *"wipe all my
data"*. The dialog now names the nest and says the other install goes with it
(`SignOutSection.tsx`, asserted in `signout-confirmation.spec.ts`).

The fix that suggests itself — give the fork its own nest and its own keychain
service — is the wrong one, and this is the argument against it: the plan's own
constraint is that *the owner must not silently lose his workspace layout, notes,
or agent keys*. A separate nest strands the agents' accumulated `RESEARCH/`,
`PLANS/` and `WORK_LOGS/`; a separate keychain service regenerates every agent
key, orphaning the pubkeys their history is signed under. Isolation would cause
the loss it was meant to prevent.

**`REPOS` has one value per machine, not one per app.** `nest.rs` splits the dev
nest from the prod nest for exactly this reason — *"so that the DMG and dev-build
instances don't clobber each other's `.repos-dir` dotfile and `REPOS` symlink"* —
and two prod apps in one nest reintroduce it. Whichever app applied a workspace
last owns `~/.buzz/.repos-dir` and the `~/.buzz/REPOS` symlink; the other one's
agents then clone into a workspace its user did not choose. This cannot be
scoped per app while the nest is shared: `REPOS` is the path agents are told to
use, so it must be one name with one target. **Point both apps at the same
workspace, or use only one of them for agent work.**

Two further shared paths the wipe reaches are wiring rather than documents, and
are recreated by whichever app launches next: `~/.sprout` and
`~/.config/buzz-agent`, plus the `~/.local/bin/buzz` symlink both apps rewrite
on every boot.

### Why there is no migration, when the code already has one

`migration.rs` has exactly the hook for this: `migrate_legacy_app_data_dir`
copies from whatever `legacy_app_data_dir()` names, non-destructively, and it
was written for precisely this case ("without this copy a product rename would
look like a fresh install"). Teaching it `dev.ahmetbirinci.vingilot` →
`xyz.block.buzz.app` is a four-line change.

It is not made, because `reset.rs` consumes the same function for the opposite
purpose: `ResetContext.legacy_app_data_dir` is *wiped* on a boot reset, "to
prevent `migrate_legacy_app_data_dir` from restoring the old identity". Wiring
the mapping would therefore mean that signing out of Vingilot deletes the
owner's **Buzz** data directory. Re-adding a relay is a minute; that is not
recoverable. If the agent roster turns out to be worth carrying, the honest
version is a command he runs himself, once, with both apps closed:

```sh
cp -R ~/Library/Application\ Support/xyz.block.buzz.app/agents \
      ~/Library/Application\ Support/dev.ahmetbirinci.vingilot/
```

### What was deliberately left alone

- **The dev identifier stays `xyz.block.buzz.app.dev`.** `migration.rs` derives
  the canonical dev data dir, `is_dev_data_dir_name`, and the worktree
  identity-sharing symlinks from that exact literal. Renaming it strands every
  dev instance's agent data for no gain — dev builds already name themselves
  "Vingilot Dev" via `scripts/instance-env.sh`.
- **The `buzz://` deep-link scheme.** It is woven through the frontend
  (`shared/deep-link.ts`, the markdown link transform) and is what the relay and
  CLI emit. Vingilot registers it too, so with both apps installed macOS awards
  `buzz://` to one of them and which one is not defined. Links open *an* app,
  and it may be the other one.
- **`shared/ui/buzz-logo/**` and `tray_bee_icon`.** Upstream's bee is upstream's
  drawing of upstream's product. Nothing there is edited or deleted; the fork's
  mark is a sibling.

### The mark: one derivation, three surfaces, one theme rule

Everything is generated from the owner's single painting by
`vingilot/brand/derive-mark.py` — nothing is hand-cropped, and the script writes
each output directly to the place that consumes it so no second copy can drift:

| Output | Surface |
|---|---|
| `desktop/src/features/vingilot-brand/mark.png` | in-app mark (45 KB, greyscale+alpha) |
| `desktop/src-tauri/src/vingilot_brand/tray-mark.gray` | menu-bar template image (1,760 bytes) |
| `desktop/src-tauri/icons/vingilot-source.png` | square source for `tauri icon` |

**The theme rule: a mark takes `currentColor`, never a colour of its own.**
Upstream's `BuzzMark` is an SVG filled with `currentColor`; a raster gets the
same behaviour by being used as a *mask* over a `currentColor` fill rather than
being painted as an image. The artwork is white on dark, so every shortcut —
ship the white bitmap, key the glow in — looks right on the dark theme it is
developed against and wrong on the light one. `vingilot-mark.css` may not
contain a literal colour, and a test enforces that.

Keying the white mark out of the painting is narrower than it looks: the
artwork's "white" is 249-252, not 255, and the glow's brightest tail reaches
248. The window is one level wide. Too low and the glow returns as a grey smudge
that is only visible on a *light* background; too high and the mark's own body
goes semi-transparent and the sails render as horizontal streaks. The script's
header carries the histogram and the failure mode for each edge.

### Why the app icon is not just the painting

The Dock icon and the menu-bar icon are different problems, and the painting
solves neither on its own.

The painting is white on mid-grey — about 3.5:1. Shrunk to 16px it is a grey
square with a smudge; that was rendered and looked at before anything was
changed. So the icon composes the keyed mark, in white, over the owner's own
gradient remapped onto a dark plate (~15:1), inside the macOS rounded-square
grid (824/1024, radius 185.4) — a full-bleed square reads as oversized beside
every other Dock icon. The glow is dropped: at 16px it is not a glow, it is a
halo that closes the gap between the sails.

The menu bar gets a separate asset, because a dark plate among monochrome
glyphs is wrong there. It is a 40×44 alpha-only template image — 44 is 22pt at
2x, the same budget upstream's 43px bee uses — which macOS tints for the light
and dark menu bar. Rendered at 44, 36, 32, 22, 18 and 16px against both, the
sails stop separating below about 32px; 44 is the number that is defended.

### Where the mark is drawn today

`VingilotMark` renders in `OnboardingChrome` — the header on every onboarding
page — and the tray takes the template image. The cold-boot gate draws
`VingilotMarkAnimation`, the sprite-sheet loop derived by
`vingilot/brand/derive-animation.py`; upstream's `FlappingBee` still draws
`SetupStep`, `PendingInviteGate` and `LandingBees`.
