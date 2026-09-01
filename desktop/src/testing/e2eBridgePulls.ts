// **`pulls_list` and `pulls_view`, mocked at the bridge** — the only place a
// spec is allowed to stand in for `vingilot_pulls`.
//
// The island shells out to `git` and then to `gh`, against github.com, with
// this machine's own credentials. A spec that let that happen would be reading
// the owner's real pull requests over the real network: slow, flaky, dependent
// on a login, and — for the eight refusal states, which are the whole point of
// the feature — impossible to produce on demand. So the seam is the IPC. The
// webview under test is the real one; only the two commands answer from a
// fixture.
//
// **The fixture is the island's own wire shape, not a convenience shape.**
// Every seeded answer is the exact JSON `mod.rs` serialises (`kind: "answer"`
// with a `PullList`, or one of the eight refusals), so `pullsAnswer.ts` parses
// it the same way it parses the real thing. A spec that seeded a friendlier
// shape would be testing a parser that does not exist.

/** What the mock answers, per worktree path. Mirrored in tests/helpers/bridge.ts. */
export type MockPulls = {
  /** `pulls_list` answers keyed by the `worktree` argument. */
  list?: Record<string, unknown>;
  /** `pulls_view` answers keyed by `${worktree}#${number}`. */
  view?: Record<string, unknown>;
  /** When set, both commands reject with this message — the IPC failing rather
   * than the island refusing, which is `call-failed`'s own case. */
  error?: string;
  /** Hold every answer this long, so a spec can watch the in-flight state
   * instead of racing it. */
  delayMs?: number;
};

/** The answer for a worktree with no seeded entry. A spec that navigates
 * somewhere it did not seed gets a refusal with a sentence — never an empty
 * list, which is the one wrong answer this feature must never produce. */
function unseeded(worktree: string): unknown {
  return { enclosing: null, kind: "not-a-repo", path: worktree };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** `pulls_list`. */
export async function mockPullsList(
  pulls: MockPulls | undefined,
  payload: unknown,
): Promise<unknown> {
  const worktree = String((payload as { worktree?: string })?.worktree ?? "");
  if (pulls?.error) throw new Error(pulls.error);
  if (pulls?.delayMs) await wait(pulls.delayMs);
  return pulls?.list?.[worktree] ?? unseeded(worktree);
}

/** `pulls_view`. */
export async function mockPullsView(
  pulls: MockPulls | undefined,
  payload: unknown,
): Promise<unknown> {
  const held = payload as { number?: number; worktree?: string };
  const worktree = String(held?.worktree ?? "");
  const key = `${worktree}#${held?.number ?? 0}`;
  if (pulls?.error) throw new Error(pulls.error);
  if (pulls?.delayMs) await wait(pulls.delayMs);
  return pulls?.view?.[key] ?? unseeded(worktree);
}
