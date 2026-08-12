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

test("the History pane is on the registry — the palette and the picker both offer it", async ({
  page,
}) => {
  // A claim about the registry rather than about this pane: a component added
  // to the tree without being added to `PANE_IDS` is a pane that renders and
  // that he cannot reach.
  await openHistoryWorkspace(page);
  await expect(page.getByTestId("pane-history")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.getByTestId("palette-input").fill("history");
  const row = page.getByTestId("palette-row-pane:history");
  await expect(row).toBeVisible();
  await expect(row).not.toHaveAttribute("data-blocked", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("palette")).toBeHidden();
  await expect(page.getByTestId("pane-history")).toBeVisible();

  await page.getByTestId("pane-picker").click();
  await expect(page.getByRole("menuitem", { name: /History/ })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("the commit list renders with hash, subject, author, date and refs", async ({
  page,
}) => {
  await openHistoryWorkspace(page);
  await openHistoryPane(page);

  const head = page.getByTestId(`history-commit-${HEAD_HASH}`);
  await expect(head).toBeVisible();
  await expect(head).toContainText("Read what git already knows");
  await expect(head).toContainText("aaaaaaa");
  await expect(head).toContainText("Yusuf Birinci");
  // The author's own clock, sliced out of git's `%aI` rather than re-zoned into
  // the reader's — 02:18 at +03:00 is 23:18 UTC, and a `Date` would have said
  // so on a machine in London.
  await expect(head).toContainText("2026-08-12 02:18");
  // Refs are their own marks, not part of the subject line.
  await expect(page.getByTestId("history-ref-HEAD -> spike")).toBeVisible();
  await expect(page.getByTestId("history-ref-origin/spike")).toBeVisible();

  // Every commit is a row, in git's own order (newest first).
  await expect(
    page.getByTestId("history-commits").getByRole("option"),
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

  await page.getByTestId(`history-commit-${HEAD_HASH}`).click();
  await expect(page.getByTestId("history-patch-title")).toContainText(
    "Read what git already knows",
  );

  const box = page.getByTestId("history-patch-src/read.rs");
  await expect(box).toBeVisible();
  // At this width the patch is under its own column floor, so it wraps rather
  // than scrolling sideways — `patchWrapsAt`, the Diff pane's own decision,
  // reached through the same module.
  await expect(box).toHaveAttribute("data-wrapped", "true");
  await expect(box).toContainText("+is here now");
  await expect(box).toContainText("-was here");

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
  await page.getByTestId(`history-commit-${MERGE_HASH}`).click();

  const note = page.getByTestId("history-commit-note");
  await expect(note).toBeVisible();
  await expect(note).toContainText("a merge");
  await expect(note).toContainText("not the whole of what it joined");
});

test("the status lists render, and clicking a file shows its diff", async ({
  page,
}) => {
  await openHistoryWorkspace(page);
  await openHistoryPane(page);

  await expect(page.getByTestId("history-status-headline")).toHaveText(
    "1 staged, 1 not staged, 1 untracked",
  );
  await expect(page.getByTestId("history-section-staged")).toBeVisible();
  await expect(page.getByTestId("history-section-unstaged")).toBeVisible();
  await expect(page.getByTestId("history-section-untracked")).toBeVisible();

  // The same path in two columns would be two rows; here the three are three
  // different files, each under its own heading.
  await expect(
    page.getByTestId("history-file-status:staged:src/new.rs"),
  ).toBeVisible();
  await expect(
    page.getByTestId("history-file-status:untracked:notes.txt"),
  ).toBeVisible();

  // Clicking one shows its patch — from `worktree_diff`, the Diff pane's own
  // read, in the same box a commit's patch lands in.
  await page.getByTestId("history-file-status:unstaged:src/a.rs").click();
  await expect(page.getByTestId("history-patch-title")).toHaveText("src/a.rs");
  const box = page.getByTestId("history-patch-body");
  await expect(box).toContainText("+new working line");
  await expect(box).toHaveAttribute("data-wrapped", "true");

  // And what that patch IS is said rather than implied: against HEAD, which is
  // staged and unstaged together, because git's two columns are two reads and
  // this is one.
  await expect(page.getByTestId("history-file-scope")).toContainText(
    "staged and unstaged changes together",
  );
});

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
  await page.getByTestId(`history-commit-${HEAD_HASH}`).click();

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
  await expect(cutBox).toContainText("+new-resolution");

  // And a file with nothing to declare gets no sentence: a note under every
  // file is a note nobody reads.
  await expect(page.getByTestId("history-file-note-src/read.rs")).toHaveCount(
    0,
  );
  await expect(page.getByTestId("history-patch-src/read.rs")).toBeVisible();
});

test("a source-control file whose patch was cut shows the warning AND the patch", async ({
  page,
}) => {
  // The same claim on the other half of the pane, and the one that was inverted
  // here: the note and the patch were exclusive, so a regenerated lockfile
  // clicked in Diff showed the patch plus the warning, and the same file clicked
  // in Source control showed only the warning.
  await openHistoryWorkspace(page);
  await openHistoryPane(page);
  await page.getByTestId("history-file-status:staged:src/new.rs").click();

  await expect(page.getByTestId("history-patch-title")).toHaveText(
    "src/new.rs",
  );
  const note = page.getByTestId("history-file-note");
  await expect(note).toBeVisible();
  await expect(note).toContainText("patch cut off");
  const box = page.getByTestId("history-patch-body");
  await expect(box).toBeVisible();
  await expect(box).toContainText("+brand new");
});

test("a refused HEAD diff is not kept — the next file asks git again", async ({
  page,
}) => {
  // **Only an answer is worth caching.** The pane reads the HEAD diff once and
  // holds it, because it is up to one `git diff` per changed file. Writing the
  // refusal into that cache too meant one transient failure — an index.lock, a
  // checkout gone for a moment — was replayed for every row he clicked after it,
  // with no retry until he pressed Reread: the product looking broken because
  // one read failed.
  //
  // At the external display's width, and load-bearing for the same reason the
  // click test above needs it: at 16 inches picking a row swaps the list out for
  // the patch, so there would be no second row on screen to click. See
  // `EXTERNAL_DISPLAY`.
  await openHistoryWorkspace(page, EXTERNAL_DISPLAY);
  await page.evaluate(() => {
    (
      window as unknown as { __DIFF_FAILS_ONCE__: boolean }
    ).__DIFF_FAILS_ONCE__ = true;
  });
  await openHistoryPane(page);

  await page.getByTestId("history-file-status:unstaged:src/a.rs").click();
  const refused = page.getByTestId("history-patch-refused");
  await expect(refused).toBeVisible();
  await expect(refused).toContainText("index.lock");

  // The very next click asks again, and git answers.
  await page.getByTestId("history-file-status:staged:src/new.rs").click();
  await expect(page.getByTestId("history-patch-body")).toContainText(
    "+brand new",
  );
  await expect(page.getByTestId("history-patch-refused")).toHaveCount(0);
});

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

  const rows = page.getByTestId("history-commits").getByRole("option");
  await expect(rows).toHaveCount(2);
  // The count on screen, not the cap — a sentence that said "200" over two rows
  // would be the pane contradicting itself.
  await expect(page.getByTestId("history-older-note")).toHaveText(
    "2 commits shown — there are older ones.",
  );

  await page.getByTestId("history-older").click();

  // The page arrived, appended under what was already there, and the stub only
  // answers it when the cursor it received is the last commit's hash.
  await expect(rows).toHaveCount(COMMITS.length);
  await expect(page.getByTestId("history-older-refused")).toHaveCount(0);
  for (const entry of COMMITS) {
    await expect(page.getByTestId(`history-commit-${entry.hash}`)).toHaveCount(
      1,
    );
  }
  // The last page says so: a control that answered nothing forever is worse
  // than no control.
  await expect(page.getByTestId("history-older")).toHaveCount(0);
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

  const rows = page.getByTestId("history-commits").getByRole("option");
  await expect(rows).toHaveCount(2);
  await page.getByTestId("history-older").click();

  const refused = page.getByTestId("history-older-refused");
  await expect(refused).toBeVisible();
  // git's own words, beside the control that asked — not in place of the list.
  await expect(refused).toContainText("unable to read the object store");

  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId(`history-commit-${HEAD_HASH}`)).toBeVisible();
  // And the pane has NOT collapsed into a refusal.
  await expect(page.getByTestId("history-log-refused")).toHaveCount(0);
  // The control is still there, so the page can be asked for again.
  await expect(page.getByTestId("history-older")).toBeVisible();

  // **And the banner is CLEARED by the page that succeeds.** The pane
  // distinguishes two states — a page refused and a page that arrived — and
  // only the first was ever pinned: deleting the line that clears the refusal
  // left "could not read the page under this one" rendered permanently beside a
  // control that had since worked, and every assertion above still passed. The
  // stub refuses exactly once (see `__PAGE_REFUSES__`), so the second press is
  // the retry a real transient failure gets.
  await page.getByTestId("history-older").click();
  await expect(rows).toHaveCount(COMMITS.length);
  // The premise of the next line: the banner lives inside this control's own
  // block, so the control being on screen is what makes "no banner" a reading
  // of the state rather than of the layout.
  await expect(page.getByTestId("history-older")).toBeVisible();
  await expect(page.getByTestId("history-older-refused")).toHaveCount(0);
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

  await page.getByTestId(`history-commit-${HEAD_HASH}`).click();
  await page.getByTestId(`history-commit-${MERGE_HASH}`).click();
  await expect(page.getByTestId("history-patch-title")).toContainText(
    "Merge branch",
  );

  // The slow answer has now certainly arrived — and been dropped. The header
  // still names the commit the highlight is on, which is the pair that came
  // apart: the title said one commit and `aria-selected` said another.
  await page.waitForTimeout(SLOW_COMMIT_MS * 2);
  await expect(page.getByTestId("history-patch-title")).toContainText(
    "Merge branch",
  );
  await expect(page.getByTestId("history-commit-note")).toBeVisible();
  await expect(
    page.getByTestId(`history-commit-${MERGE_HASH}`),
  ).toHaveAttribute("aria-selected", "true");
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
  await expect(page.getByTestId("history-status-headline")).toBeVisible();

  // The list layout, where every status row and every commit row is on screen.
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
    .getByTestId("pane-history")
    .locator("[role='option'] button, [role='option'] input");
  await expect(nested).toHaveCount(0);

  // And no checkbox anywhere, which is the other way staging is always offered.
  await expect(
    page.getByTestId("pane-history").locator("input[type='checkbox']"),
  ).toHaveCount(0);

  // Now the OTHER layout. At this width picking something swaps the list out
  // for the patch, so a control living only there would never have been read
  // above — which is exactly how a stage button survives a scan.
  await page.getByTestId(`history-commit-${HEAD_HASH}`).click();
  await expect(page.getByTestId("history-patch-src/read.rs")).toBeVisible();
  const onPatch = await controlNames(page);
  expect(onPatch.length).toBeGreaterThan(0);
  for (const name of onPatch) expect(name).not.toMatch(MUTATING);
});

test("j and k walk the rows and Enter opens the one under the cursor", async ({
  page,
}) => {
  // The half a pure key-map test cannot reach: a map bound to nothing passes
  // every unit test there is. The cursor starts on nothing, so the first `j`
  // lands on the first row — which here is a STATUS row, because source control
  // is above history and they are one list to the keyboard.
  await openHistoryWorkspace(page);
  await openHistoryPane(page);
  await expect(page.getByTestId("history-status-headline")).toBeVisible();

  // **The pane has the keyboard, and this assertion is why it needed to.**
  // Measured before it did: with the pane freshly opened from ⌘K,
  // `document.activeElement` was `textarea.xterm-helper-textarea` — the
  // terminal's hidden input, which xterm keeps focused for as long as it is
  // mounted. `diffKeys.ts` refuses every letter typed into a field, correctly,
  // so every `j` below went into the terminal and the cursor never moved.
  const focused = await page.evaluate(
    () => document.activeElement?.getAttribute("data-testid") ?? "",
  );
  expect(focused).toBe("pane-history");

  await page.keyboard.press("j");
  await expect(
    page.getByTestId("history-file-status:staged:src/new.rs"),
  ).toHaveAttribute("aria-selected", "true");

  // Four more steps walk out of the status rows and into the commits, which is
  // the whole point of one list rather than one cursor per section.
  for (let press = 0; press < 3; press += 1) {
    await page.keyboard.press("j");
  }
  await expect(page.getByTestId(`history-commit-${HEAD_HASH}`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // `k` comes back, and does not wrap past the top.
  await page.keyboard.press("k");
  await expect(
    page.getByTestId("history-file-status:untracked:notes.txt"),
  ).toHaveAttribute("aria-selected", "true");

  // **Enter opens the row under the CURSOR, which is the half that breaks when
  // focus and cursor drift apart.** `diffKeys.ts` deliberately surrenders Enter
  // to a focused control, so a pane whose highlight moved while its focus stayed
  // on the last-clicked row would open the row he left. The cursor carries the
  // focus with it for exactly this reason, and walking three rows before
  // pressing Enter is what makes that a test rather than a coincidence.
  await page.keyboard.press("j");
  await expect(page.getByTestId(`history-commit-${HEAD_HASH}`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("history-patch-title")).toContainText(
    "Read what git already knows",
  );
});

test("after a row is CLICKED, j then Enter opens the row the cursor moved to", async ({
  page,
}) => {
  // **The path where the cursor and the focus come apart**, and the reason the
  // cursor carries the focus with it. Clicking a row puts DOM focus on that
  // row's button; `diffKeys.ts` then deliberately surrenders `Enter` to it
  // ("a key a focused control already presses is the platform's"). So a pane
  // that moved only the highlight on `j` would, on `Enter`, re-open the row he
  // clicked — with the highlight sitting on a different one.
  //
  // The keyboard-only path cannot see this: there the focus stays on the pane
  // box, `focusActivates` is false, and Enter goes through the pane's own
  // handler to the cursor row. Only a click first puts a button in the way.
  //
  // **Read at the external display's width, and that is load-bearing.** At 16
  // inches the pane shows one half at a time, so the click below would take the
  // list off screen and there would be no second row to walk to — the drift is
  // only observable where the list survives the click. See `EXTERNAL_DISPLAY`.
  await openHistoryWorkspace(page, EXTERNAL_DISPLAY);
  await openHistoryPane(page);
  await expect(page.getByTestId("history-status-headline")).toBeVisible();

  // Click the untracked file — the last status row, so `j` from here steps into
  // the commits and the two rows are unmistakably different things.
  await page.getByTestId("history-file-status:untracked:notes.txt").click();
  await expect(page.getByTestId("history-patch-title")).toHaveText("notes.txt");

  // The layout this test needs, asserted rather than assumed: both halves are
  // up, so the row the cursor walks to is on screen to be read.
  await expect(page.getByTestId("history-list")).toBeVisible();
  await expect(page.getByTestId("history-patch")).toBeVisible();

  await page.keyboard.press("j");
  await expect(page.getByTestId(`history-commit-${HEAD_HASH}`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Enter");

  // The commit, not the file he clicked a moment ago.
  await expect(page.getByTestId("history-patch-title")).toContainText(
    "Read what git already knows",
  );
});

test('"no commits yet" waits for git, and an unanswered read says it is still reading', async ({
  page,
}) => {
  // **The rule this island puts hardest, read where it is visible.** The model
  // refuses to produce "no commits yet" from anything but an answer; what a
  // browser adds is that the pane really shows the reading sentence in the
  // meantime, instead of an empty list that reads as "there is nothing there".
  await openHistoryWorkspace(page);
  await page.evaluate(() => {
    (window as unknown as { __LOG_HANGS__: boolean }).__LOG_HANGS__ = true;
  });
  await openHistoryPane(page);

  const reading = page.getByTestId("history-log-reading");
  await expect(reading).toBeVisible();
  await expect(reading).toContainText("reading this worktree's history");
  await expect(page.getByTestId("history-log-empty")).toHaveCount(0);
  await expect(page.getByTestId("history-commits")).toHaveCount(0);
});

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

  const empty = page.getByTestId("history-log-empty");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("no commits yet");
  await expect(page.getByTestId("history-log-reading")).toHaveCount(0);
});

test("the split toggle is this pane's too, on the same flag and the same floor", async ({
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
  // Read at two widths, because the toggle's behaviour is a function of one.
  await openHistoryWorkspace(page, SIXTEEN_INCH);
  await openHistoryPane(page);
  await page.getByTestId(`history-commit-${HEAD_HASH}`).click();
  await expect(page.getByTestId("history-patch-src/read.rs")).toBeVisible();

  // At his own width the pane is ~435px, under the 695px two columns need, so
  // the control is on screen, unavailable, and says why — in `diffLayout.ts`'s
  // words, which the unit tests pin and this one only proves reached the header.
  const toggle = page.getByTestId("history-split");
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeDisabled();
  await expect(page.getByTestId("history-split-why")).toContainText(
    "split needs 695px of pane",
  );
  await expect(page.getByTestId("history-patch-src/read.rs")).toHaveAttribute(
    "data-mode",
    "unified",
  );

  // On the external display the same pane can seat two columns, and the same
  // control turns them on.
  await openHistoryWorkspace(page, EXTERNAL_DISPLAY);
  await openHistoryPane(page);
  await page.getByTestId(`history-commit-${HEAD_HASH}`).click();
  const wide = page.getByTestId("history-split");
  await expect(wide).toBeEnabled();
  await expect(page.getByTestId("history-split-why")).toHaveCount(0);
  await wide.click();

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
});
