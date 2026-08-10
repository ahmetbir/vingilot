// What the workspace may say about the control plane, and how hard it looks
// for one (vingilot/docs/plans/2026-08-10-coordinator-optional.md, Task 2).
//
// The sentence this module exists to end read *"control plane unreachable —
// read-only since 2:08:55 PM · new runs and transitions disabled · retrying,
// next in 2s"*, and on the owner's work Mac every clause of it was wrong.
// Nothing became unreachable: there had never been a coordinator on that
// machine. Nothing was read-only: since Task 1 the project list, worktrees,
// terminals, diff and notes are all on this machine, and the team thread is on
// the relay — a different service, up or down on its own. And a ticking
// countdown is a promise that waiting will fix it, so he waited.
//
// **The two states are different facts and get different sentences.** A
// coordinator that answered and then stopped is an outage: it has a start
// time, it is probably temporary, and counting down to the next retry is
// useful. A machine where nothing has ever answered is not an outage at all —
// it is the shape of the install. It has no start time worth naming, and the
// only true thing to say is which one feature is unavailable and that
// everything else is not waiting on anything.
//
// **`everAnswered` is scoped to this workspace session, on purpose.** The
// alternative was a durable "a coordinator answered here once" record in
// `~/.vingilot/projects.json`, and it was declined: that file holds his
// projects, a wrong value written into it is permanent, and the fact it would
// buy is only right on a machine that HAS a coordinator and was launched
// before it. Both sentences below are claims about now — the probe is always
// `127.0.0.1`, so "on this machine" is exactly what is being reported — and
// the wrong one costs one slow tick, not a file.
//
// **The retry policy for the never-answered case** (the plan asks for it out
// loud): it keeps probing, but it stops hammering and it stops counting at
// him. The normal 2s cadence holds for the first minute — a coordinator he
// starts by hand right after launch is picked up at once — and then settles to
// 30s. It never stops entirely: `cargo run` on the Mac mini can start at any
// moment, and a state that needs a click to leave is one he would not know to
// leave. The banner says that in words and never renders a countdown.
//
// The countdown maths below (`unreachableView`) is unchanged and still ported
// from vingilot/workbench/src/system/reachability.ts (ADR-001's 2026-08-03
// reversal); it now serves the outage sentence alone.

export interface UnreachableView {
  since: Date;
  nextRetrySecs: number;
}

/** usePolling retries at a fixed cadence (`intervalMs`) regardless of
 * reachability — the countdown here is just "time until the next tick",
 * computed from how far `now` is past `since` modulo that cadence. Returns
 * null when reachable (nothing to render) or when `since` is unknown. */
export function unreachableView(
  reachable: boolean,
  since: Date | null,
  now: Date,
  intervalMs: number,
): UnreachableView | null {
  if (reachable || since === null) return null;
  if (intervalMs <= 0) return { since, nextRetrySecs: 0 };

  const elapsedMs = Math.max(0, now.getTime() - since.getTime());
  const remainderMs = intervalMs - (elapsedMs % intervalMs);
  const nextRetrySecs = Math.ceil(remainderMs / 1000);
  return { since, nextRetrySecs };
}

/** Which of the three things is true right now. `"absent"` is the state this
 * task exists for: not reachable, and nothing has answered here at all. */
export type ControlPlaneKind = "reachable" | "outage" | "absent";

/** `everAnswered` is "a poll has come back ok since this workspace opened",
 * not "one is configured" — nothing configures a coordinator, the client
 * always talks to `127.0.0.1:7117` (`coordinatorClient.ts`). An answer is
 * therefore the only evidence there is that one exists on this machine, and
 * its absence is the only evidence that one does not. */
export function controlPlaneKind(
  reachable: boolean,
  everAnswered: boolean,
): ControlPlaneKind {
  if (reachable) return "reachable";
  return everAnswered ? "outage" : "absent";
}

/** How long the never-answered case keeps the normal cadence before settling.
 * A minute is the width of "I just launched this and I am about to start the
 * coordinator", which is how the Mac mini is used. */
export const ABSENT_SETTLE_AFTER_MS = 60_000;

/** The settled cadence. Slow enough to stop being a 2s hammer against a port
 * nothing is listening on, fast enough that starting a coordinator does not
 * feel like it needs the button. */
export const ABSENT_SETTLED_POLL_MS = 30_000;

/** The interval the coordinator polls should actually run at. Everything but
 * a settled `"absent"` polls at `fastMs`: an outage is a thing that comes
 * back, and the deck reads it the moment it does. */
export function controlPlanePollMs(
  kind: ControlPlaneKind,
  since: Date | null,
  now: Date,
  fastMs: number,
): number {
  if (kind !== "absent" || since === null) return fastMs;
  const elapsedMs = now.getTime() - since.getTime();
  return elapsedMs >= ABSENT_SETTLE_AFTER_MS ? ABSENT_SETTLED_POLL_MS : fastMs;
}

export interface ControlPlaneBanner {
  /** `"alert"` is a fault that started; `"note"` is a fact about the install.
   * Drives the colour and, more importantly, whether the banner is announced
   * assertively — a machine that never had a coordinator has nothing to
   * interrupt anyone about. */
  tone: "alert" | "note";
  text: string;
  /** The label on the probe button. Both states get one: the outage's skips
   * the wait, and the absent one is how he checks a coordinator he just
   * started without waiting out the settled cadence. */
  action: string;
}

/** The banner's whole content, or `null` when there is nothing to say.
 *
 * Neither sentence says "read-only", because the workspace is not: the
 * project list is a local file, worktrees come off the filesystem, terminals
 * are local processes, and notes and plan are per-project storage. Runs are
 * the one thing that genuinely needs the coordinator, and both sentences name
 * exactly that.
 *
 * Neither sentence calls the team thread local either, which is the same
 * class of clause in the other direction. The thread is on the relay
 * (`teamThread.ts`: "This conversation lives there and not in this app") — it
 * is unaffected by the control plane, which is what the sentence is about,
 * but a banner that told him it was on this machine would be wrong the next
 * time the relay was the thing that was down. */
export function controlPlaneBanner(
  kind: ControlPlaneKind,
  since: Date | null,
  now: Date,
  intervalMs: number,
): ControlPlaneBanner | null {
  if (kind === "reachable") return null;
  if (kind === "absent") {
    return {
      action: "Check now",
      text:
        "no control plane on this machine — runs cannot start here. " +
        "Nothing else in the workspace goes through it: projects, worktrees, " +
        "terminals, diff and notes are on this machine. The team thread is " +
        "on the relay, which is a different service. This is not an outage " +
        "and there is nothing to wait for. If a coordinator starts here, " +
        "this picks it up on its own.",
      tone: "note",
    };
  }
  const view = unreachableView(false, since, now, intervalMs);
  // An outage with no start time is not a state this screen can produce
  // (`since` is stamped the moment reachability flips), and inventing a clock
  // reading for it would be the same class of lie this module is fixing.
  if (view === null) return null;
  return {
    action: "Retry now",
    text:
      `control plane not answering since ${view.since.toLocaleTimeString()} — ` +
      "new runs and transitions are unavailable. Projects, worktrees, " +
      "terminals, diff and notes are on this machine and still work. The " +
      "team thread is on the relay, which is a different service. " +
      `Retrying, next in ${view.nextRetrySecs}s.`,
    tone: "alert",
  };
}

/** The status bar's reading. Three words for three states — "unreachable" on
 * a machine that never had one was the same lie as the banner's, in less
 * room to explain itself. */
export function controlPlaneStatus(kind: ControlPlaneKind): string {
  if (kind === "reachable") return "synced";
  return kind === "outage" ? "not answering" : "no control plane";
}

/** Why Start Run is disabled, or `null` when it is not. */
export function runsUnavailableNote(kind: ControlPlaneKind): string | null {
  if (kind === "reachable") return null;
  return kind === "outage"
    ? "control plane not answering — Start Run disabled until it does"
    : "no control plane on this machine — runs cannot start here";
}

/** Why pin toggles are disabled, or `null` when they are not. Pins live in
 * the workspace document, so they are genuinely a coordinator feature — this
 * says so rather than implying the deck itself is broken. */
export function pinsUnavailableNote(kind: ControlPlaneKind): string | null {
  if (kind === "reachable") return null;
  return kind === "outage"
    ? "control plane not answering — pin toggles disabled"
    : "no control plane on this machine — pins are kept in it, so pinning is unavailable here";
}
