import { listen } from "@tauri-apps/api/event";

import { invokeTauri } from "./tauri";

/**
 * The home harbor's client surface — the frontend half of the `vingilot_harbor`
 * Rust island (vingilot/docs/plans/2026-08-13-home-harbor.md, Tasks 3 and 4).
 *
 * The relay a harbor is spelled here exactly as the Rust side spells it, and the
 * two are asserted against each other on that side. It matters that it is
 * `ws://127.0.0.1:7447` and not a `localhost` or `wss://` spelling: the relay
 * refuses the WebSocket upgrade with a bare 404 for any Host it has no community
 * row for, seeds exactly one row from this authority, and does not treat
 * `localhost` and `127.0.0.1` as the same host. The door hands this string to
 * the ordinary `communityOnboarding.start(…)`, so a harbor is joined like any
 * other community and there is no second onboarding path.
 */
export const HARBOR_RELAY_URL = "ws://127.0.0.1:7447";

/** The event each install step is emitted on. Mirror of `HARBOR_STEP_EVENT`. */
export const HARBOR_STEP_EVENT = "vingilot://harbor-step";

/** Whether this machine can run a harbor. Mirror of Rust `HarborDocker`. */
export type HarborDocker = "absent" | "not-running" | "ready";

/** The docker probe's answer. Mirror of Rust `HarborProbe`. */
export type HarborProbe = {
  docker: HarborDocker;
  /** What went wrong and what to do about it, or `null` when nothing did. */
  refusal: string | null;
  /** Where to get Docker. Set only when `docker` is `"absent"`. */
  installUrl: string | null;
  /** The engine version, when one answered. */
  engine: string | null;
};

/** The four things installing a harbor does, in order. Mirror of `HarborStepId`. */
export type HarborStepId =
  | "checking-docker"
  | "writing-bundle"
  | "starting"
  | "waiting-for-health";

/** Where one step got to. Mirror of `HarborStepState`. */
export type HarborStepState = "running" | "done" | "failed";

/** One step, as the surface draws it. Mirror of Rust `HarborStep`. */
export type HarborStep = {
  step: HarborStepId;
  state: HarborStepState;
  /** One sentence. A failure names the command that ran. */
  detail: string;
};

/** Every step, and the relay URL if there is one. Mirror of `HarborStartReport`. */
export type HarborStartReport = {
  steps: HarborStep[];
  /** Set only when all four steps are done — the go-ahead to join the relay. */
  relayUrl: string | null;
  /** The one sentence to show when something went wrong. */
  failure: string | null;
};

/** What the harbor is, in one word. Mirror of Rust `HarborState`. */
export type HarborState =
  | "not-installed"
  | "stopped"
  | "starting"
  | "running"
  | "unhealthy"
  | "unknown";

/** One container, as `docker compose ps` describes it. Mirror of `HarborService`. */
export type HarborService = {
  service: string;
  state: string;
  health: string | null;
};

/** The two commands that remove a harbor, printed for the owner to run. */
export type HarborUninstall = {
  down: string;
  volumes: string;
};

/** Everything the Home harbor settings card draws. Mirror of Rust `HarborStatus`. */
export type HarborStatus = {
  state: HarborState;
  docker: HarborDocker;
  services: HarborService[];
  relayUrl: string;
  composePath: string;
  envPath: string;
  composeIsShipped: boolean | null;
  uninstall: HarborUninstall;
  message: string | null;
};

/** Probe Docker. Never rejects — "you have no Docker" is an answer, not a failure. */
export async function harborProbe(): Promise<HarborProbe> {
  return await invokeTauri<HarborProbe>("harbor_probe");
}

/**
 * Write the bundle if it is missing, start the harbor, and wait for it to
 * answer. Each step is also emitted on {@link HARBOR_STEP_EVENT} while this runs.
 */
export async function harborInstallAndStart(): Promise<HarborStartReport> {
  return await invokeTauri<HarborStartReport>("harbor_install_and_start");
}

/** What the harbor is right now. Rejects only when the home dir cannot be found. */
export async function harborStatus(): Promise<HarborStatus> {
  return await invokeTauri<HarborStatus>("harbor_status");
}

/** Start an installed harbor and wait for it to be healthy. */
export async function harborStart(): Promise<void> {
  await invokeTauri<null>("harbor_start");
}

/** Stop the harbor's containers, keeping every volume. */
export async function harborStop(): Promise<void> {
  await invokeTauri<null>("harbor_stop");
}

/**
 * Subscribe to install-step events. Resolves to an unlisten function. Never
 * throws — outside a Tauri webview (plain browser, some tests) the event system
 * is absent and steps simply do not stream; the final report still carries them.
 */
export async function listenHarborStep(
  onStep: (step: HarborStep) => void,
): Promise<() => void> {
  try {
    return await listen<HarborStep>(HARBOR_STEP_EVENT, (event) =>
      onStep(event.payload),
    );
  } catch {
    return () => {};
  }
}

/** The canonical order the four steps are drawn in. */
export const HARBOR_STEP_ORDER: readonly HarborStepId[] = [
  "checking-docker",
  "writing-bundle",
  "starting",
  "waiting-for-health",
];

/**
 * Fold one step event into the running list: replace the entry for that step
 * id if it is already present (a `running` becoming `done`), else append it.
 *
 * A pure function so the accumulation the door does across a stream of events —
 * and the merge of the final report's steps on top — is unit-tested without a
 * webview. The last state for a given id always wins, which is what makes a
 * dropped-then-recovered event and a normal running→done transition read the
 * same.
 */
export function foldHarborStep(
  current: HarborStep[],
  next: HarborStep,
): HarborStep[] {
  const index = current.findIndex((step) => step.step === next.step);
  if (index === -1) return [...current, next];
  const merged = current.slice();
  merged[index] = next;
  return merged;
}

/** {@link foldHarborStep} over a whole batch — the final report's steps. */
export function foldHarborSteps(
  current: HarborStep[],
  batch: HarborStep[],
): HarborStep[] {
  return batch.reduce(foldHarborStep, current);
}

/** The steps in {@link HARBOR_STEP_ORDER}, whatever order they arrived in. */
export function orderedHarborSteps(steps: HarborStep[]): HarborStep[] {
  return [...steps].sort(
    (a, b) =>
      HARBOR_STEP_ORDER.indexOf(a.step) - HARBOR_STEP_ORDER.indexOf(b.step),
  );
}

/** Whether a stored community relay URL is this machine's home harbor. */
export function isHarborRelayUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).host === "127.0.0.1:7447";
  } catch {
    return false;
  }
}

const HARBOR_AUTO_START_KEY = "vingilot.harbor.auto-start.v1";

/**
 * Whether the owner has asked the app to start his harbor on launch. Default
 * false: the app never starts Docker for him until he has said so once, which
 * is the "never auto-start without being asked and remembered" rule.
 */
export function readHarborAutoStart(): boolean {
  try {
    return window.localStorage.getItem(HARBOR_AUTO_START_KEY) === "true";
  } catch {
    return false;
  }
}

/** Remember (or forget) the owner's choice to start the harbor on launch. */
export function writeHarborAutoStart(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.setItem(HARBOR_AUTO_START_KEY, "true");
    } else {
      window.localStorage.removeItem(HARBOR_AUTO_START_KEY);
    }
  } catch {
    // Storage unavailable/full — the choice just is not remembered this run.
  }
}
