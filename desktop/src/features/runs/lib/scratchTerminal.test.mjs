import assert from "node:assert/strict";
import { test } from "node:test";
import {
  closeScratch,
  openScratch,
  resolveScratchKey,
  scratchBlocked,
  scratchOnWorktree,
  scratchSessionId,
} from "./scratchTerminal.ts";
import {
  applyTabCommand,
  dropWorktrees,
  emptyLayout,
  ensureWorktree,
  layoutSessions,
  sessionIdFor,
} from "./terminalTabs.ts";

const AT = { bindingId: "wt-1", cwd: "/tmp/wt-1", nonce: 1 };

// ---------------------------------------------------------------------------
// opening and closing
// ---------------------------------------------------------------------------

test("opening puts one shell in the worktree it was asked for", () => {
  const { closed, scratch } = openScratch(null, AT);
  assert.deepEqual(closed, []);
  assert.deepEqual(scratch, {
    bindingId: "wt-1",
    cwd: "/tmp/wt-1",
    sessionId: scratchSessionId(1),
  });
});

test("closing it ends it, and names the session that really closed", () => {
  const open = openScratch(null, AT).scratch;
  const { closed, scratch } = closeScratch(open);
  assert.equal(scratch, null);
  // The pty must really be closed: a caller that took the null without this
  // would leave a shell running with nothing tracking it.
  assert.deepEqual(closed, [scratchSessionId(1)]);
});

test("closing when there is none closes nothing", () => {
  assert.deepEqual(closeScratch(null), { closed: [], scratch: null });
});

test("opening again in the same place keeps the shell that is already running", () => {
  // The chord and the palette row are two doors to one surface. Either of them
  // costing the owner whatever is running in the shell he already has would be
  // the surface eating its own point.
  const first = openScratch(null, AT).scratch;
  const again = openScratch(first, { ...AT, nonce: 2 });
  assert.equal(again.scratch, first);
  assert.deepEqual(again.closed, []);
});

test("opening on a different worktree ends the old shell and starts one there", () => {
  const first = openScratch(null, AT).scratch;
  const moved = openScratch(first, {
    bindingId: "wt-2",
    cwd: "/tmp/wt-2",
    nonce: 2,
  });
  assert.deepEqual(moved.closed, [scratchSessionId(1)]);
  assert.deepEqual(moved.scratch, {
    bindingId: "wt-2",
    cwd: "/tmp/wt-2",
    sessionId: scratchSessionId(2),
  });
});

test("a worktree that moved on disk is a new shell, not a header that lies", () => {
  const first = openScratch(null, AT).scratch;
  const moved = openScratch(first, { ...AT, cwd: "/tmp/elsewhere", nonce: 2 });
  assert.deepEqual(moved.closed, [scratchSessionId(1)]);
  assert.equal(moved.scratch.cwd, "/tmp/elsewhere");
});

test("an ordinal is never handed to a second shell", () => {
  // Closing kills the pty; if that kill lost a race, a reused id would attach
  // the new scratch to the shell the owner just closed.
  const ids = new Set();
  let scratch = null;
  for (let nonce = 1; nonce <= 20; nonce++) {
    scratch = openScratch(closeScratch(scratch).scratch, {
      ...AT,
      nonce,
    }).scratch;
    ids.add(scratch.sessionId);
  }
  assert.equal(ids.size, 20);
});

// ---------------------------------------------------------------------------
// where it starts
// ---------------------------------------------------------------------------

test("leaving the worktree ends the shell", () => {
  const open = openScratch(null, AT).scratch;
  const gone = scratchOnWorktree(open, "wt-2");
  assert.equal(gone.scratch, null);
  assert.deepEqual(gone.closed, [scratchSessionId(1)]);
});

test("the landing view ends it too — there is no surface left to draw it over", () => {
  const open = openScratch(null, AT).scratch;
  assert.deepEqual(scratchOnWorktree(open, null), {
    closed: [scratchSessionId(1)],
    scratch: null,
  });
});

test("staying put changes nothing, by reference", () => {
  // So the host can skip the write, and so a re-render cannot end a shell.
  const open = openScratch(null, AT).scratch;
  const same = scratchOnWorktree(open, "wt-1");
  assert.equal(same.scratch, open);
  assert.deepEqual(same.closed, []);
  assert.deepEqual(scratchOnWorktree(null, "wt-1"), {
    closed: [],
    scratch: null,
  });
});

test("a scratch is refused rather than opened somewhere arbitrary", () => {
  assert.match(scratchBlocked(null, null, false), /no worktree is open/);
  assert.match(scratchBlocked(null, "/tmp/wt-1", false), /no worktree is open/);
  assert.equal(scratchBlocked("wt-1", "/tmp/wt-1", false), null);
});

test("a directory that has not answered yet is never rendered as one that is not there", () => {
  // The same distinction the panes draw: a lookup still in flight is not a
  // worktree without a checkout, and telling the owner it is sends him looking
  // for a fault that does not exist.
  const pending = scratchBlocked("wt-1", null, true);
  const missing = scratchBlocked("wt-1", null, false);
  assert.match(pending, /not been resolved yet/);
  assert.match(missing, /no checkout on this machine/);
  assert.notEqual(pending, missing);
});

// ---------------------------------------------------------------------------
// the id, against all three alphabets
// ---------------------------------------------------------------------------

/** Binding ids of every shape the workspace can produce: a coordinator row's
 * uuid, a repo's synthesised own checkout, a path-derived local id, and the
 * awkward ones. */
const BINDING_IDS = [
  "00000000-0000-0000-0000-000000000001",
  "main:repo-1",
  "main:00000000-0000-0000-0000-000000000002",
  "local:/Users/o/Developer/thing",
  "wt_7",
  "wt 7",
  "üñî",
  "",
  "-",
  // A binding id that already contains the separator, which is the case the
  // no-`#` argument has to survive.
  "weird#id",
  "vingilot-scratch.1",
];

test("no scratch id can be produced by the tab model, for any binding id", () => {
  // The whole collision proof: `sessionIdFor` always joins on `#`, so an id
  // with none in it is unreachable from the tab model — whatever the binding
  // id is, and however the ordinals grow.
  const tabIds = new Set();
  for (const bindingId of BINDING_IDS) {
    for (let n = 1; n <= 30; n++) tabIds.add(sessionIdFor(bindingId, n));
  }
  for (let nonce = 1; nonce <= 30; nonce++) {
    const id = scratchSessionId(nonce);
    assert.ok(!id.includes("#"), `a scratch id took the tab separator: ${id}`);
    assert.ok(!tabIds.has(id), `a scratch id is also a tab's: ${id}`);
  }
});

test("a scratch id is not a legal Tauri event name, which is why no id is ever put in one", () => {
  // Copied from `is_event_name_valid` (tauri 2.11.5, src/event/event_name.rs),
  // the predicate both `emit` and the webview's `listen` gate on. A tab's id
  // already fails it, and the output channel therefore carries the id in the
  // payload (`vingilot://pty`). A scratch id fails it the same way, so an
  // implementation that added a per-session event would break loudly rather
  // than emit nothing.
  const legal = (event) => /^[A-Za-z0-9\-/:_]*$/.test(event);
  assert.ok(!legal(scratchSessionId(1)));
  assert.ok(!legal(sessionIdFor("main:repo-1", 1)));
  assert.ok(legal("vingilot://pty"));
});

test("a scratch id survives the tmux name derivation distinctly", () => {
  // The escape `vingilot_pty/tmux.rs` applies, mirrored here so the JS side's
  // ids are checked against the same alphabet the Rust side pins: [A-Za-z0-9_]
  // through, every other byte as `-<hex>`. Injective, so distinct ids give
  // distinct names — which is what keeps `pty_close` off another shell.
  const tmuxName = (id) => {
    let name = "vingilot_";
    for (const byte of new TextEncoder().encode(id)) {
      const ch = String.fromCharCode(byte);
      name += /[A-Za-z0-9_]/.test(ch)
        ? ch
        : `-${byte.toString(16).padStart(2, "0")}`;
    }
    return name;
  };
  const names = new Set();
  for (const bindingId of BINDING_IDS) {
    for (let n = 1; n <= 4; n++)
      names.add(tmuxName(sessionIdFor(bindingId, n)));
  }
  const before = names.size;
  for (let nonce = 1; nonce <= 4; nonce++) {
    const name = tmuxName(scratchSessionId(nonce));
    assert.match(name, /^[A-Za-z0-9_-]+$/);
    names.add(name);
  }
  assert.equal(names.size, before + 4, "a scratch name collided with a tab's");
});

test("nothing about a scratch reaches the saved layout or the worktree's strip", () => {
  // The other two places a terminal becomes persistent. A scratch enters
  // neither, so ⇧⌘W, the tab strip, and the worktree-drop sweep have no name
  // for it — and the layout that is written to storage never holds one.
  const layout = ensureWorktree(emptyLayout(), "wt-1");
  const scratch = openScratch(null, AT).scratch;
  const sessions = layoutSessions(layout).map(({ bindingId, n }) =>
    sessionIdFor(bindingId, n),
  );
  assert.ok(!sessions.includes(scratch.sessionId));

  // Closing every tab of the worktree, and then losing the worktree itself,
  // names every session that really ended. The scratch is in neither list.
  const closedTab = applyTabCommand(layout, "wt-1", { n: 1, type: "close" });
  assert.ok(!closedTab.closed.includes(scratch.sessionId));
  const dropped = dropWorktrees(layout, ["wt-2"]);
  assert.deepEqual(dropped.closed, [sessionIdFor("wt-1", 1)]);
  assert.ok(!dropped.closed.includes(scratch.sessionId));
});

// ---------------------------------------------------------------------------
// the keyboard, while it is open
// ---------------------------------------------------------------------------

test("the chord that opened it closes it", () => {
  assert.deepEqual(
    resolveScratchKey({ altKey: true, key: "t", primaryModifier: true }),
    { type: "close" },
  );
});

test("the surface underneath does not act while a shell is over it", () => {
  // ⇧⌘W would end a terminal tab's tmux session, ⌘T would pull focus into a
  // terminal the owner cannot see, and both would be acts on something that is
  // not in front of him.
  for (const input of [
    { key: "W", primaryModifier: true, shiftKey: true },
    { key: "t", primaryModifier: true },
    { key: "1", primaryModifier: true },
    { key: "`", primaryModifier: true },
    { altKey: true, key: "ArrowRight", primaryModifier: true },
    { altKey: true, key: "b", primaryModifier: true },
    { key: "b", primaryModifier: true },
  ]) {
    assert.deepEqual(
      resolveScratchKey(input),
      { type: "shield" },
      `${JSON.stringify(input)} reached the surface underneath`,
    );
  }
});

test("Escape belongs to the shell, not to the overlay", () => {
  // A terminal owns Escape — vim, less, every reader. A modal that closed on
  // it would make the shell it opened useless for the things a scratch shell
  // is for, and would end it on a keystroke aimed at a program inside it.
  assert.deepEqual(
    resolveScratchKey({ key: "Escape", primaryModifier: false }),
    {
      type: "shield",
    },
  );
});

test("everything the owner is typing reaches the shell", () => {
  for (const input of [
    { key: "a", primaryModifier: false },
    { key: "Enter", primaryModifier: false },
    { key: "ArrowUp", primaryModifier: false },
    { key: "Tab", primaryModifier: false },
    // The app's own global chords, which are not this surface's to swallow.
    { key: ",", primaryModifier: true },
    { key: "0", primaryModifier: true },
    { key: "r", primaryModifier: true },
  ]) {
    assert.equal(
      resolveScratchKey(input),
      null,
      `${JSON.stringify(input)} was taken from the shell`,
    );
  }
});
