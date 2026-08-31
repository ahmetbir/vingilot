// What git already knows, proved against a real render
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 4).
//
// `historyModel.test.mjs` says how the wire is read when it is malformed, which
// sections git's four columns become, how the cursor walks the rows, how a page
// appends without duplicating a commit, and — the rule this island puts hardest
// — that "no commits yet" and "the working tree is clean" are only ever
// reachable from an answer. All of that is pure and none of it needs a browser.
//
// **What only a browser can say is that any of it reaches him.** Each of the
// following has been a real failure mode in this island or in this app:
//
// - **The pane is on the registry.** A component added to the tree without being
//   added to `PANE_IDS` is a pane that renders and that he cannot reach — the
//   exact thing a new pane gets wrong, and the reason the Files and Search specs
//   each open with this assertion too.
// - **The commit list is drawn, with the four fields the plan named** (hash,
//   subject, author, date) plus the refs. A model that produces the right
//   strings and a pane that never renders them look identical from any unit
//   test.
// - **Selecting a commit shows its patch, in the SHARED renderer.** Task 4
//   forbade forking the patch component by name. The assertion that makes that
//   real is not "a patch appeared" — it is that the box carries `data-wrapped`,
//   which is `PatchView`'s own attribute and exists nowhere else, and that its
//   lines are classified (`+` green, `-` red) by the one `diffView` both panes
//   share. A hand-rolled second renderer would have to reproduce both to pass,
//   at which point it is the same component with extra steps.
// - **Status lists render, and clicking a file shows its diff.** The second half
//   is the one with a route through it: the patch comes from `worktree_diff`,
//   the Diff pane's own read, and lands in the same box a commit's does.
// - **NOTHING IN THE PANE OFFERS A MUTATING ACTION.** The plan drew the line at
//   reading and this is where the line is kept. Every control in the pane is
//   collected out of the real DOM — in both of the pane's layouts, because a
//   stage button hidden behind the narrow layout is still a stage button — and
//   its accessible name is matched against the verbs that write. This is
//   deliberately a scan rather than a list of expected buttons: a test that
//   asserted "there are exactly two buttons" would go red when someone added a
//   third READ, and green when they renamed one of the two into `Discard`.
// - **"no commits yet" waits for git.** The model refuses to produce it from
//   anything but an answer; this asserts the pane really shows the reading
//   sentence in the meantime, which is the only place the distinction is
//   visible.
// - **A binary file and a cut patch each say so, in BOTH halves of the pane.**
//   The failure is a layout that drops the sentence (a PNG as an empty box) or
//   shows it *instead of* the patch (a cut lockfile's 2,000 read lines thrown
//   away) — invisible to a model test, which produced the sentence either way.
// - **`Older` is drawn, clicked, and answered.** The whole paging path — the
//   control, `olderNote`'s count, `appendPage`, and the `before` argument key
//   `historyClient.ts` sends — has no other test: the stub reads that argument
//   and refuses a wrong one. A page git refuses costs the page and not the list,
//   and the refusal is CLEARED by the retry that succeeds — two states, both
//   pinned, because only the first of them used to be.
// - **A slow answer cannot land on a newer one.** The one reading that needed a
//   stub which does not answer in the same tick; see `SLOW_COMMIT_MS`.
//
// The four commands are stubbed through the same `addInitScript` property trap
// `workspace-one-column.spec.ts`, `workspace-files.spec.ts` and
// `workspace-search.spec.ts` document: the bridge assigns `invoke` during boot
// and the home-directory lookup runs on the first render, so an override
// installed after boot is too late. Stubbed rather than run against a real
// checkout because what is under test is the pane — real git would make every
// assertion a property of whatever happened to be in a temp directory, and
// `log.rs`, `status.rs` and `commit_patch.rs` each drive the real binary against
// a real repository in their own cargo tests.

import { expect, test } from "@playwright/test";

// The world this spec runs in — the invented repository and the stubs that make
// git say it — is the file beside this one. Split there because this spec had
// reached the 1,000-line ratchet, and the rule in this repository is a split and
// never a raise; the halves also change for different reasons, which is the
// better half of the argument. See `workspace-history.fixtures.ts`.
import {
  COMMIT_PATCH,
  COMMITS,
  controlNames,
  EXTERNAL_DISPLAY,
  HEAD_HASH,
  MERGE_HASH,
  MUTATING,
  openHistoryPane,
  openHistoryWorkspace,
  SIXTEEN_INCH,
  SLOW_COMMIT_MS,
} from "./workspace-history.fixtures";

test("the History pane is on the registry — the palette offers it, and the dock's own tab agrees", async ({
  page,
}) => {
  // A claim about the registry rather than about this pane: a component added
  // to the tree without being added to `PANE_IDS` is a pane that renders and
  // that he cannot reach.
  //
  // History is one of the dock's six fixed tabs (`dockModel.ts`), so the
  // retired PanePicker's "also offered from the dropdown" half of this claim
  // has a stronger dock equivalent: the tab lights up in agreement with the
  // palette's choice, and is itself the second door.
  await openHistoryWorkspace(page);
  await expect(page.getByTestId("dock-history")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.getByTestId("palette-input").fill("history");
  const row = page.getByTestId("palette-row-pane:history");
  await expect(row).toBeVisible();
  await expect(row).not.toHaveAttribute("data-blocked", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("palette")).toBeHidden();
  await expect(page.getByTestId("dock-history")).toBeVisible();
  await expect(page.getByTestId("dock-tab-history")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // And the tab offers it too — the second door, clicked directly.
  await page.getByTestId("dock-tab-history").click();
  await expect(page.getByTestId("dock-history")).toBeVisible();
});

test("the commit list renders with hash, subject, author, date and refs", async ({
  page,
}) => {
  await openHistoryWorkspace(page);
  await openHistoryPane(page);

  const head = page.getByTestId(`dock-history-commit-${HEAD_HASH}`);
  await expect(head).toBeVisible();
  await expect(head).toContainText("Read what git already knows");
  await expect(head).toContainText("aaaaaaa");
  // The mockup's `.gmeta2` carries an avatar, a sha and an AGE — not a name
  // and not a timestamp (Vingilot.html:281). Both facts are still on screen,
  // in the places the mockup puts them: the author names the avatar, and the
  // author's own clock — sliced out of git's `%aI` rather than re-zoned into
  // the reader's; 02:18 at +03:00 is 23:18 UTC, and a `Date` would have said
  // so on a machine in London — names the age.
  await expect(head.getByTitle("Yusuf Birinci")).toBeVisible();
  await expect(head.getByTitle(/2026-08-12 02:18/)).toBeVisible();
  // Refs are their own marks, not part of the subject line.
  await expect(
    page.getByTestId("dock-history-ref-HEAD -> spike"),
  ).toBeVisible();
  await expect(page.getByTestId("dock-history-ref-origin/spike")).toBeVisible();

  // Every commit is a row, in git's own order (newest first).
  await expect(
    page.getByTestId("dock-history-graph").getByRole("option"),
  ).toHaveCount(COMMITS.length);
});

test("selecting a commit shows its patch, drawn by the shared renderer", async ({
  page,
}) => {
  // **Task 4's "do not fork the patch component", made an assertion.** Not "a
  // patch appeared" — that passes against a copy. `data-wrapped` is
  // `PatchView`'s own attribute, and the per-line classes come from the one
  // `diffView` both panes share; a second renderer would have to reproduce both,
  // at which point it is the same component with extra steps.
  await openHistoryWorkspace(page);
  await openHistoryPane(page);

  await page.getByTestId(`dock-history-commit-${HEAD_HASH}`).click();
  await expect(page.getByTestId("history-patch-title")).toContainText(
    "Read what git already knows",
  );

  const box = page.getByTestId("history-patch-src/read.rs");
  await expect(box).toBeVisible();
  // The wrap decision is `patchWrapsAt`, the Diff pane's own rule reached
  // through the same module: wrapped exactly when the box is under the 467px
  // patch floor. Asserted against the measured box rather than as a literal,
  // because the pane's width has moved twice now (the one-column merge, then
  // the single-sidebar rework, which widened it past the floor here) and the
  // claim is the shared rule, not a particular window's answer to it.
  const boxWidth = Math.round((await box.boundingBox())?.width ?? 0);
  await expect(box).toHaveAttribute(
    "data-wrapped",
    boxWidth < 467 ? "true" : "false",
  );
  // **Without their markers, since P4.4.** The claim is unchanged and the
  // shape is not: the `+`/`-` used to be the first character of the code,
  // which is what made a patch read as terminal spew. The sign is now a
  // column of its own — generated content, so it is not in `textContent` at
  // all — and the row says which it is in an attribute. Both readings are
  // asserted, because "the text is there" alone would pass against the old
  // rendering too.
  await expect(box).toContainText("is here now");
  await expect(box).toContainText("was here");
  await expect(box.locator('[data-diff-sign="add"]').first()).toContainText(
    "is here now",
  );
  await expect(box.locator('[data-diff-sign="del"]').first()).toContainText(
    "was here",
  );

  // The lines are classified rather than printed as one blob: the added line
  // and the removed line resolve to different colours.
  const colours = await box.locator("span").evaluateAll((nodes) => {
    const seen = new Set<string>();
    for (const node of nodes) seen.add(getComputedStyle(node).color);
    return [...seen];
  });
  expect(colours.length).toBeGreaterThan(1);
});

test("a merge says its patch is the first parent's, not the whole of what it joined", async ({
  page,
}) => {
  // `git show` on a merge prints no patch at all, so the backend reads the first
  // parent instead — a choice among several true answers, which is why it is
  // said out loud rather than left to look like the whole story.
  await openHistoryWorkspace(page);
  await openHistoryPane(page);
  await page.getByTestId(`dock-history-commit-${MERGE_HASH}`).click();

  const note = page.getByTestId("history-commit-note");
  await expect(note).toBeVisible();
  await expect(note).toContainText("a merge");
  await expect(note).toContainText("not the whole of what it joined");
});

// RETIRED WITH ITS SUBJECT (P4.1): the working tree's staged/unstaged/untracked lists lived in the Deck
// sidebar's History member, which P4.1 removed. The mockup's History panel is
// Graph/Reflog and draws no status list; what the working tree has changed is
// the Diff tab's answer, and it is real there (`worktree-diff-*`). Nothing was
// dropped quietly — the surface went, so its test went with it.

test("a commit's binary file says so, and its cut patch shows the warning AND the lines", async ({
  page,
}) => {
  // **What `fileNote` exists to prevent, at the pane.** The backend answers
  // honestly — `commit_patch.rs` sets `patch: ""` for a binary file and
  // `truncated: true` for one past the cap — and the Diff pane says both. The
  // commit view dropped the sentence, so a commit that added a PNG rendered as a
  // heading, `+0 −0` and an empty box: a positive claim ("no textual change")
  // made by a layout rather than by git.
  await openHistoryWorkspace(page);
  await openHistoryPane(page);
  await page.getByTestId(`dock-history-commit-${HEAD_HASH}`).click();

  // The binary file: the sentence, and NO patch box — an empty box under a
  // sentence explaining the emptiness is a second way of saying nothing.
  const binaryNote = page.getByTestId("history-file-note-logo.png");
  await expect(binaryNote).toBeVisible();
  await expect(binaryNote).toContainText("binary file");
  await expect(page.getByTestId("history-patch-logo.png")).toHaveCount(0);

  // The cut file: **both**. The sentence quotes the cap from the answer, and the
  // box still holds the lines git did read — showing only the warning throws
  // them away, and the same file in the Diff pane would then show more.
  const cutNote = page.getByTestId("history-file-note-pnpm-lock.yaml");
  await expect(cutNote).toBeVisible();
  await expect(cutNote).toContainText("patch cut off");
  await expect(cutNote).toContainText("2000 lines");
  const cutBox = page.getByTestId("history-patch-pnpm-lock.yaml");
  await expect(cutBox).toBeVisible();
  await expect(cutBox).toContainText("new-resolution");
  await expect(cutBox.locator('[data-diff-sign="add"]')).toContainText(
    "new-resolution",
  );

  // And a file with nothing to declare gets no sentence: a note under every
  // file is a note nobody reads.
  await expect(page.getByTestId("history-file-note-src/read.rs")).toHaveCount(
    0,
  );
  await expect(page.getByTestId("history-patch-src/read.rs")).toBeVisible();
});

// RETIRED WITH ITS SUBJECT (P4.1): same subject as above — a source-control ROW is what was clicked, and there
// is no such row any more. The cut-patch warning itself is still proved, on a
// commit's patch, by the binary/cut test above.

// RETIRED WITH ITS SUBJECT (P4.1): the cache this proved belonged to the status rows' one `worktree_diff` read,
// which went with them.

test("Older asks git for the page under the one on screen, and the list grows by it", async ({
  page,
}) => {
  // **One of the pane's only two controls, and nothing rendered it.** Both
  // branches of the log stub answered `more: false`, so the button, `olderNote`,
  // `appendPage` and the `before` argument `historyClient` sends were never on
  // any path a browser walked.
  await openHistoryWorkspace(page);
  await page.evaluate(() => {
    (window as unknown as { __LOG_MORE__: boolean }).__LOG_MORE__ = true;
  });
  await openHistoryPane(page);

  const rows = page.getByTestId("dock-history-graph").getByRole("option");
  await expect(rows).toHaveCount(2);
  // The count on screen, not the cap — a sentence that said "200" over two rows
  // would be the pane contradicting itself.
  await expect(page.getByTestId("dock-history-older-note")).toHaveText(
    "2 commits shown — there are older ones.",
  );

  await page.getByTestId("dock-history-older").click();

  // The page arrived, appended under what was already there, and the stub only
  // answers it when the OFFSET it received is the number of rows on screen.
  await expect(rows).toHaveCount(COMMITS.length);
  await expect(page.getByTestId("dock-history-older-refused")).toHaveCount(0);
  for (const entry of COMMITS) {
    await expect(
      page.getByTestId(`dock-history-commit-${entry.hash}`),
    ).toHaveCount(1);
  }
  // The last page says so: a control that answered nothing forever is worse
  // than no control.
  await expect(page.getByTestId("dock-history-older")).toHaveCount(0);
});

test("a page git refused costs the page and not the history already on screen", async ({
  page,
}) => {
  // The failure that used to replace 200 commits with one sentence: `LogState`
  // had no shape holding both, so the refusal took the list with it. One
  // transient `git log` failure is not a reason to un-read what was read.
  await openHistoryWorkspace(page);
  await page.evaluate(() => {
    const w = window as unknown as {
      __LOG_MORE__: boolean;
      __PAGE_REFUSES__: boolean;
    };
    w.__LOG_MORE__ = true;
    w.__PAGE_REFUSES__ = true;
  });
  await openHistoryPane(page);

  const rows = page.getByTestId("dock-history-graph").getByRole("option");
  await expect(rows).toHaveCount(2);
  await page.getByTestId("dock-history-older").click();

  const refused = page.getByTestId("dock-history-older-refused");
  await expect(refused).toBeVisible();
  // git's own words, beside the control that asked — not in place of the list.
  await expect(refused).toContainText("unable to read the object store");

  await expect(rows).toHaveCount(2);
  await expect(
    page.getByTestId(`dock-history-commit-${HEAD_HASH}`),
  ).toBeVisible();
  // And the pane has NOT collapsed into a refusal.
  await expect(page.getByTestId("dock-history-refused")).toHaveCount(0);
  // The control is still there, so the page can be asked for again.
  await expect(page.getByTestId("dock-history-older")).toBeVisible();

  // **And the banner is CLEARED by the page that succeeds.** The pane
  // distinguishes two states — a page refused and a page that arrived — and
  // only the first was ever pinned: deleting the line that clears the refusal
  // left "could not read the page under this one" rendered permanently beside a
  // control that had since worked, and every assertion above still passed. The
  // stub refuses exactly once (see `__PAGE_REFUSES__`), so the second press is
  // the retry a real transient failure gets.
  await page.getByTestId("dock-history-older").click();
  await expect(rows).toHaveCount(COMMITS.length);
  // The premise of the next line: the banner lives inside this control's own
  // block, so the control being on screen is what makes "no banner" a reading
  // of the state rather than of the layout.
  await expect(page.getByTestId("dock-history-older")).toBeVisible();
  await expect(page.getByTestId("dock-history-older-refused")).toHaveCount(0);
});

test("a slow commit's answer cannot land on top of the one clicked after it", async ({
  page,
}) => {
  // **The guard the Diff pane already had and this pane did not.** See
  // `SLOW_COMMIT_MS` for why this needs a late stub to be visible at all.
  //
  // At the external display's width, so the list survives the first click and
  // there is a second row to click. See `EXTERNAL_DISPLAY`.
  await openHistoryWorkspace(page, EXTERNAL_DISPLAY);
  await page.evaluate((slow) => {
    (window as unknown as { __SLOW_COMMIT__: string }).__SLOW_COMMIT__ = slow;
  }, HEAD_HASH);
  await openHistoryPane(page);

  await page.getByTestId(`dock-history-commit-${HEAD_HASH}`).click();
  await page.getByTestId(`dock-history-commit-${MERGE_HASH}`).click();
  await expect(page.getByTestId("history-patch-title")).toContainText(
    "Merge branch",
  );

  // The slow answer has now certainly arrived — and cannot land on screen. The
  // guard is the same one it always was (a read whose component is no longer
  // the one showing drops its answer); what P4.1 changed is the shape around
  // it: two commits are two TABS, so the pair that used to come apart — a
  // title naming one commit while the selection named another — cannot even be
  // spelled. The slow tab is still open and still reachable; it is simply not
  // the one being read.
  await page.waitForTimeout(SLOW_COMMIT_MS * 2);
  await expect(page.getByTestId("history-patch-title")).toContainText(
    "Merge branch",
  );
  await expect(
    page.getByTestId(`view-tab-commit:${HEAD_HASH}`),
  ).toHaveAttribute("data-active", "false");
  await expect(
    page.getByTestId(`view-tab-commit:${MERGE_HASH}`),
  ).toHaveAttribute("data-active", "true");
});

test("nothing in the pane offers a mutating action", async ({ page }) => {
  // **Where the plan's line is kept.** Task 4: "No buttons that write — the
  // terminal is one keystroke away, and the plan drew the line at reading."
  //
  // A scan rather than a list of expected controls, deliberately: a test that
  // asserted "there are exactly two buttons" would go red when someone added a
  // third READ and green when they renamed one of the two into `Discard`.
  await openHistoryWorkspace(page);
  await openHistoryPane(page);
  await expect(page.getByTestId("dock-history-graph")).toBeVisible();

  // The graph layout, where every commit row is on screen.
  const onList = await controlNames(page);
  // The premise, asserted rather than assumed: the scan really found controls,
  // so an empty result cannot pass this test by finding nothing.
  expect(onList.length).toBeGreaterThan(0);
  for (const name of onList) expect(name).not.toMatch(MUTATING);

  // **No row CONTAINS a control**, which is the VS Code-shaped failure the
  // exclusion above would otherwise let through: staging is offered as a
  // per-row button (or checkbox) beside the file name, and such a button lives
  // INSIDE the row rather than beside it. A row here is one button and nothing
  // nested, so there is nowhere for a per-file act to be added without this
  // going red.
  const nested = page
    .locator('[data-testid="dock-history"], [data-view-kind="commit"]')
    .locator("[role='option'] button, [role='option'] input");
  await expect(nested).toHaveCount(0);

  // And no checkbox anywhere, which is the other way staging is always offered.
  await expect(
    page
      .locator(`[data-testid="dock-history"], [data-view-kind="commit"]`)
      .locator("input[type='checkbox']"),
  ).toHaveCount(0);

  // Now the OTHER layout. At this width picking something swaps the list out
  // for the patch, so a control living only there would never have been read
  // above — which is exactly how a stage button survives a scan.
  await page.getByTestId(`dock-history-commit-${HEAD_HASH}`).click();
  await expect(page.getByTestId("history-patch-src/read.rs")).toBeVisible();
  const onPatch = await controlNames(page);
  expect(onPatch.length).toBeGreaterThan(0);
  for (const name of onPatch) expect(name).not.toMatch(MUTATING);
});

// RETIRED WITH ITS SUBJECT (P4.1): the j/k walk was the sidebar list's; the dock's graph rows are a mouse/
// focus surface with no vim map, so there is no keystroke left to own.

// RETIRED WITH ITS SUBJECT (P4.1): same subject as the j/k walk above.

test("a repository with no commits says so, once git has said so", async ({
  page,
}) => {
  // The other side of the same rule: a repository that has been `git init`ed and
  // never committed really does have no history, and the backend reports that as
  // an ANSWER rather than as a failure — so the pane is entitled to the
  // sentence, and only here.
  await openHistoryWorkspace(page);
  await page.evaluate(() => {
    (window as unknown as { __LOG_EMPTY__: boolean }).__LOG_EMPTY__ = true;
  });
  await openHistoryPane(page);

  const empty = page.getByTestId("dock-history-empty");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("no commits yet");
  await expect(page.getByTestId("dock-history-reading")).toHaveCount(0);
});

test("the split toggle rides the patch onto the stage, on the same flag and the same floor", async ({
  page,
}) => {
  // **The claim is that Task 2 added a layout and not a second renderer**
  // (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 2, and the
  // self-review that names "a second diff renderer" as the way it goes wrong).
  // The Diff pane's own reading of split lives in `workspace-diff-fits.spec.ts`;
  // what this adds is that the SAME control and the SAME precondition arrived on
  // this surface without being written twice — a commit's patch is the same
  // reading as a worktree's, and a forked toggle would be the first place the two
  // drifted.
  //
  // **P4.1 answers P3.1's geometry ruling here.** The patch used to be drawn
  // inside the dock, whose card is clamped 300–540px (`dockModel.ts`, birebir
  // to the mockup's own `Math.min(540, Math.max(300, …))`) — short of the
  // 695px two columns need at every width, so the control was permanently
  // disabled and the only way to it was ⇧⌥⌘B. A commit now opens as a TAB on
  // the stage, which at his own 16-inch width is already past that floor: the
  // toggle is enabled where it used to be dead, and the diff that needs room
  // takes the whole surface instead of a 540px card.
  await openHistoryWorkspace(page, SIXTEEN_INCH);
  await openHistoryPane(page);
  await page.getByTestId(`dock-history-commit-${HEAD_HASH}`).click();
  await expect(page.getByTestId("history-patch-src/read.rs")).toBeVisible();

  const toggle = page.getByTestId("history-split");
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeEnabled();
  await expect(page.getByTestId("history-split-why")).toHaveCount(0);
  // Unified until asked — the flag is the app's, not this surface's.
  await expect(page.getByTestId("history-patch-src/read.rs")).toHaveAttribute(
    "data-mode",
    "unified",
  );
  await toggle.click();

  const box = page.getByTestId("history-patch-src/read.rs");
  await expect(box).toHaveAttribute("data-mode", "split");
  // The fixture's block is one deletion against two additions, so the gap is on
  // the LEFT here — the mirror of the Diff pane's fixture, and the reading that
  // says the alignment is the model's rather than a property of one patch.
  const rows = await box.locator("[data-split-row]").evaluateAll((nodes) =>
    nodes.map((node) => ({
      cells: Array.from(node.querySelectorAll("span"), (cell) =>
        (cell.textContent ?? "").trim(),
      ),
      kind: node.getAttribute("data-split-row"),
    })),
  );
  expect(rows.map((row) => row.kind)).toEqual([
    "span",
    "context",
    "change",
    "change",
  ]);
  // gutter, code, gutter, code — the deletion beside the first addition, then
  // the second addition beside nothing at all.
  expect(rows[2].cells).toEqual(["2", "was here", "2", "is here now"]);
  expect(rows[3].cells).toEqual(["", "", "3", "and this too"]);
  // And the patch it was built from is the fixture's, so nothing above is a
  // reading of some other commit's answer.
  expect(COMMIT_PATCH).toContain("+and this too");

  // The floor itself is still real and still the shared one: narrow the stage
  // by giving the dock the whole surface, and the control goes unavailable
  // with `diffLayout.ts`'s own sentence rather than silently doing nothing.
  await page.keyboard.press("Shift+Alt+Meta+b");
  await expect(page.getByTestId("history-split")).toBeDisabled();
  await expect(page.getByTestId("history-split-why")).toContainText(
    "split needs 695px of pane",
  );
});
