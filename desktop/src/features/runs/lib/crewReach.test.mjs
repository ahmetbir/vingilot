// The crew's ⌘K rows: that they appear only for crew that exists, that the
// Captain's rename is what they are called, that the worktree is in the draft,
// and that a member with nowhere to be reached refuses with a sentence rather
// than writing into nothing (vingilot/docs/plans/2026-08-12-the-crew.md,
// Task 3).

import assert from "node:assert/strict";
import { test } from "node:test";

import { crewReachRow, crewReachRows } from "./crewReach.ts";

const LOOKOUT = {
  berth: "thread",
  name: "Lookout",
  personaId: "builtin:lookout",
  pubkey: "a".repeat(64),
};
const MATE = {
  berth: "dm",
  name: "Mate",
  personaId: "builtin:mate",
  pubkey: "b".repeat(64),
};
const NAVIGATOR = {
  berth: "thread",
  name: "Navigator",
  personaId: "builtin:navigator",
  pubkey: "c".repeat(64),
};

function context(overrides = {}) {
  return {
    crew: [],
    threadChannelId: "channel-1",
    worktreeCwd: "/Users/x/work/the-crew",
    worktreeLabel: "the-crew",
    ...overrides,
  };
}

test("no crew is no rows — an agent that was never minted is not a blocked row", () => {
  assert.deepEqual(crewReachRows(context()), []);
});

test("one row per crew member, in the order the crew was handed over", () => {
  const rows = crewReachRows(context({ crew: [MATE, NAVIGATOR, LOOKOUT] }));
  assert.deepEqual(
    rows.map((row) => row.personaId),
    ["builtin:mate", "builtin:navigator", "builtin:lookout"],
  );
});

test("the labels are the plan's three errands", () => {
  const rows = crewReachRows(context({ crew: [MATE, LOOKOUT, NAVIGATOR] }));
  assert.equal(rows[0].label, "Ask Mate…");
  assert.equal(rows[1].label, "Have Lookout review this worktree");
  assert.equal(rows[2].label, "Ask Navigator for a plan");
});

test("the Captain's rename is what the row is called and who the draft addresses", () => {
  const [row] = crewReachRows(
    context({ crew: [{ ...LOOKOUT, name: "Watch" }] }),
  );
  assert.equal(row.label, "Have Watch review this worktree");
  assert.ok(row.message.startsWith("@Watch "));
  assert.doesNotMatch(row.message, /Lookout/);
});

// `name` exists because the mention reference written beside the draft is
// keyed on it, and upstream then looks for literally `@${name}` in the text
// (`hasMention`). The label is an errand sentence — a ref keyed on *that*
// matches nothing, so the composer would not highlight the mention and the
// next persist would drop the ref. This is the assertion that catches it.
test("every row carries the name its own draft mentions, not the errand sentence", () => {
  for (const row of crewReachRows(
    context({
      crew: [
        { ...LOOKOUT, name: "Watch" },
        { ...NAVIGATOR, name: "Pilot" },
        { ...MATE, name: "Nabi" },
      ],
    }),
  )) {
    assert.notEqual(row.name, row.label);
    assert.ok(
      row.label.includes(row.name),
      `${row.personaId}'s label should be a sentence about ${row.name}`,
    );
    if (row.message.startsWith("@")) {
      assert.ok(
        row.message.startsWith(`@${row.name} `),
        `${row.personaId} must be mentioned as @${row.name}`,
      );
    }
  }
});

test("crewReachRow: the row's name is the record's name, so Enter addresses the same agent", () => {
  const row = crewReachRow(
    context({ crew: [{ ...LOOKOUT, name: "Watch" }] }),
    "builtin:lookout",
  );
  assert.equal(row.name, "Watch");
  assert.ok(row.message.includes(`@${row.name}`));
});

test("the draft names the worktree by branch and by directory", () => {
  const [row] = crewReachRows(context({ crew: [NAVIGATOR] }));
  assert.match(
    row.message,
    /the the-crew worktree \(\/Users\/x\/work\/the-crew\)/,
  );
});

test("the draft is pre-addressed, never pre-sent: it ends where he starts typing", () => {
  for (const row of crewReachRows(
    context({ crew: [MATE, NAVIGATOR, LOOKOUT] }),
  )) {
    assert.ok(
      row.message.endsWith(" "),
      `${row.personaId} should hand the cursor over, not finish the sentence`,
    );
  }
});

test("a thread member with no thread open is blocked with a sentence, and carries no channel", () => {
  const [row] = crewReachRows(
    context({ crew: [LOOKOUT], threadChannelId: null }),
  );
  assert.match(row.blocked, /no team thread yet/);
  assert.equal(row.channelId, null);
});

test("Mate is never blocked on a thread it is deliberately not in", () => {
  const [row] = crewReachRows(context({ crew: [MATE], threadChannelId: null }));
  assert.equal(row.blocked, null);
  assert.equal(
    row.channelId,
    null,
    "the DM is opened on demand, not looked up",
  );
  assert.equal(
    row.message.startsWith("@"),
    false,
    "a DM has one other party; mentioning them is noise",
  );
});

test("a thread member carries the channel its draft lands in", () => {
  const [row] = crewReachRows(context({ crew: [LOOKOUT] }));
  assert.equal(row.blocked, null);
  assert.equal(row.channelId, "channel-1");
});

test("with no worktree at all the row still reads as a sentence", () => {
  const [row] = crewReachRows(
    context({ crew: [MATE], worktreeCwd: null, worktreeLabel: null }),
  );
  assert.equal(row.message, "this workspace — ");
});

test("a persona with no errand draws no row — the table decides, not the agent list", () => {
  assert.deepEqual(
    crewReachRows(
      context({
        crew: [{ ...LOOKOUT, personaId: "builtin:fizz" }],
      }),
    ),
    [],
  );
});

test("crewReachRow: the same rules answer again at Enter", () => {
  const ctx = context({ crew: [LOOKOUT], threadChannelId: null });
  assert.match(crewReachRow(ctx, "builtin:lookout").blocked, /no team thread/);
  assert.equal(crewReachRow(ctx, "builtin:scribe"), null);
});
