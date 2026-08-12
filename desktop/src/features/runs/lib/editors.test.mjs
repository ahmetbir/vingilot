import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  editorAction,
  editorButtonLabel,
  editorLabel,
  EDITOR_IDS,
  getChosenEditor,
  parseEditorId,
  resetChosenEditorForTests,
  setChosenEditor,
  subscribeChosenEditor,
} from "./editors.ts";

beforeEach(() => {
  resetChosenEditorForTests();
});

test("only the three ids the backend knows are editors", () => {
  for (const id of EDITOR_IDS) {
    assert.equal(parseEditorId(id), id);
  }
  // Everything else is no preference at all — including the near-misses a
  // refactor produces and the shapes storage can hand back.
  for (const value of [
    "code",
    "Cursor",
    "vscode ",
    "",
    null,
    undefined,
    42,
    ["zed"],
    { id: "zed" },
  ]) {
    assert.equal(
      parseEditorId(value),
      null,
      JSON.stringify(value) ?? "undefined",
    );
  }
});

test("nothing installed is the backend's sentence, never a button", () => {
  const action = editorAction([], null, "no editor command was found.");
  assert.deepEqual(action, {
    refusal: "no editor command was found.",
    type: "none",
  });
  // And a probe that has not answered still says something, rather than
  // rendering an empty tooltip.
  const silent = editorAction([], "cursor", null);
  assert.equal(silent.type, "none");
  assert.match(silent.refusal, /has not answered/);
});

test("one editor installed is opened, never asked about", () => {
  // A menu with one row is not a choice; it is a click the owner pays for
  // nothing.
  assert.deepEqual(editorAction(["zed"], null, null), {
    editor: "zed",
    installed: ["zed"],
    type: "open",
  });
  // Even when he once chose a different one — see the stale-pick test below.
  assert.equal(editorAction(["zed"], "cursor", null).type, "open");
});

test("several installed and no choice yet is the one question this asks", () => {
  const action = editorAction(["cursor", "vscode"], null, null);
  assert.deepEqual(action, { installed: ["cursor", "vscode"], type: "ask" });
  // The plan's words: never guess between two. Asserted as the absence of an
  // `open` here, because a "first one found" default is exactly what this row
  // would otherwise become.
  assert.notEqual(action.type, "open");
});

test("a choice already made is honoured without asking again", () => {
  assert.deepEqual(editorAction(["cursor", "vscode", "zed"], "vscode", null), {
    editor: "vscode",
    installed: ["cursor", "vscode", "zed"],
    type: "open",
  });
});

test("a choice naming an editor this machine does not have falls back to asking", () => {
  // He chose Zed on the machine that had it. Honouring it here would fail with
  // a sentence about a missing binary instead of showing him the two editors he
  // does have.
  const action = editorAction(["cursor", "vscode"], "zed", null);
  assert.equal(action.type, "ask");
  // And the pick is left in storage rather than un-chosen for him.
  setChosenEditor("zed");
  assert.equal(
    editorAction(["cursor", "vscode"], getChosenEditor(), null).type,
    "ask",
  );
  assert.equal(getChosenEditor(), "zed");
});

test("the pick is remembered and everybody reading it is told", () => {
  // Four surfaces draw this button and they are never in one subtree, so the
  // notification is the only thing that keeps them agreeing about the label.
  let told = 0;
  const stop = subscribeChosenEditor(() => {
    told += 1;
  });
  setChosenEditor("cursor");
  assert.equal(getChosenEditor(), "cursor");
  assert.equal(told, 1);
  // The same choice again is not a change and must not re-render four panes.
  setChosenEditor("cursor");
  assert.equal(told, 1);
  setChosenEditor("zed");
  assert.equal(told, 2);
  stop();
  setChosenEditor("vscode");
  assert.equal(told, 2);
});

test("the button says where the click lands", () => {
  assert.equal(
    editorButtonLabel(editorAction(["cursor"], null, null)),
    "Open in Cursor",
  );
  // The ellipsis is the promise that a menu is coming — the same grammar every
  // other "…" row in this workspace keeps.
  assert.equal(
    editorButtonLabel(editorAction(["cursor", "zed"], null, null)),
    "Open in editor…",
  );
  assert.equal(
    editorButtonLabel(editorAction([], null, "none")),
    "Open in editor",
  );
  assert.equal(editorLabel("vscode"), "VS Code");
});
