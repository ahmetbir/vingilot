import * as React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertCircle, Check, ExternalLink, LoaderCircle } from "lucide-react";

import { OnboardingFooter } from "@/features/onboarding/ui/OnboardingFooter";
import {
  foldHarborStep,
  foldHarborSteps,
  harborInstallAndStart,
  harborProbe,
  type HarborProbe,
  type HarborStep,
  listenHarborStep,
  orderedHarborSteps,
} from "@/shared/api/tauriHarbor";
import { Button } from "@/shared/ui/button";

type LocalHarborOnboardingProps = {
  /** Return to the create-a-community choice. */
  onBack: () => void;
  /** The harbor answered on this relay URL — join it through the ordinary path. */
  onReady: (relayUrl: string) => void;
};

type Phase = "intro" | "running" | "blocked";

/**
 * The local door: run a whole Vingilot community on this one machine, then join
 * it like any other (vingilot/docs/plans/2026-08-13-home-harbor.md, Tasks 3+4).
 *
 * This side ends with one string, `ws://127.0.0.1:7447`, handed to
 * {@link LocalHarborOnboardingProps.onReady} which routes it into the same
 * `communityOnboarding.start(…)` a hosted community goes through — there is no
 * parallel onboarding here. The Rust island (`vingilot_harbor`) does the docker
 * work and streams named steps; this component only draws them.
 *
 * The blocked state carries Docker's own way out: a missing Docker offers the
 * Docker Desktop link (the island decides that, not this file), a stopped engine
 * offers "Try again", and a failed install shows the sentence that names the
 * command the owner can paste into his own terminal.
 */
export function LocalHarborOnboarding({
  onBack,
  onReady,
}: LocalHarborOnboardingProps) {
  const [phase, setPhase] = React.useState<Phase>("intro");
  const [steps, setSteps] = React.useState<HarborStep[]>([]);
  const [probe, setProbe] = React.useState<HarborProbe | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  const run = React.useCallback(async () => {
    setPhase("running");
    setSteps([]);
    setProbe(null);
    setFailure(null);

    // Probe first, only so a machine with no Docker gets the install link. The
    // install sequence classifies Docker again as its first step, so a stopped
    // engine or a mid-install death is still reported by the report itself.
    const reading = await harborProbe();
    if (reading.docker !== "ready") {
      setProbe(reading);
      setFailure(reading.refusal ?? "Docker could not be reached.");
      setPhase("blocked");
      return;
    }

    const unlisten = await listenHarborStep((step) =>
      setSteps((current) => foldHarborStep(current, step)),
    );
    try {
      const report = await harborInstallAndStart();
      // The report re-sends every step, so a listener that missed one still
      // renders the whole sequence.
      setSteps((current) => foldHarborSteps(current, report.steps));
      if (report.relayUrl) {
        onReady(report.relayUrl);
        return;
      }
      setFailure(report.failure ?? "The harbor did not start.");
      setPhase("blocked");
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
      setPhase("blocked");
    } finally {
      unlisten();
    }
  }, [onReady]);

  const ordered = orderedHarborSteps(steps);

  return (
    <div className="flex w-full max-w-[620px] flex-col items-center text-center">
      <h1 className="text-title font-normal">Run Vingilot on this Mac</h1>
      <p className="mt-3 text-sm leading-6 text-foreground/80">
        A whole community — the relay, its database and its cache — running as
        three Docker containers on this machine. No host to join, nothing to
        sign in to.
      </p>

      {phase === "intro" ? (
        <div className="mt-8 w-full max-w-[520px] space-y-3 text-left">
          <HonestyLine>
            Everything stays on this Mac: the relay listens on loopback only, so
            your agents and messages never leave the machine.
          </HonestyLine>
          <HonestyLine>
            Nothing binds beyond 127.0.0.1 — the compose file publishes that one
            address and no other.
          </HonestyLine>
          <HonestyLine>
            There is no phone pairing to a loopback relay, and no second machine
            can reach it: one Mac, one harbor.
          </HonestyLine>
          <HonestyLine>
            It needs Docker Desktop running — Vingilot will check for it and
            tell you if it is missing.
          </HonestyLine>
        </div>
      ) : null}

      {ordered.length > 0 ? (
        <ol
          className="mt-8 w-full max-w-[520px] space-y-3 text-left"
          data-testid="harbor-steps"
        >
          {ordered.map((step) => (
            <li
              className="flex items-start gap-3 rounded-xl border border-foreground/10 bg-background/35 px-4 py-3"
              data-testid={`harbor-step-${step.step}`}
              data-state={step.state}
              key={step.step}
            >
              <StepIcon state={step.state} />
              <span
                className={
                  step.state === "failed"
                    ? "min-w-0 flex-1 text-sm leading-6 text-destructive"
                    : "min-w-0 flex-1 text-sm leading-6 text-foreground/85"
                }
              >
                {step.detail}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {phase === "blocked" && failure ? (
        <div
          className="mt-6 w-full max-w-[520px] rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-left text-sm leading-6 text-destructive"
          data-testid="harbor-failure"
        >
          {failure}
        </div>
      ) : null}

      <div className="mt-8 flex flex-col items-center gap-3">
        {phase === "running" ? (
          <Button className="h-11 px-6" disabled type="button">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            Working…
          </Button>
        ) : phase === "blocked" ? (
          <div className="flex flex-wrap items-center justify-center gap-3">
            {probe?.installUrl ? (
              <Button
                className="h-11 px-6"
                data-testid="harbor-get-docker"
                onClick={() => void openUrl(probe.installUrl as string)}
                type="button"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Get Docker Desktop
              </Button>
            ) : null}
            <Button
              className="h-11 px-6"
              data-testid="harbor-retry"
              onClick={() => void run()}
              type="button"
              variant={probe?.installUrl ? "outline" : "default"}
            >
              Try again
            </Button>
          </div>
        ) : (
          <Button
            className="h-11 px-6"
            data-testid="harbor-run"
            onClick={() => void run()}
            type="button"
          >
            Run Vingilot on this Mac
          </Button>
        )}
      </div>

      <OnboardingFooter>
        <Button
          className="h-9 rounded-full bg-foreground/10 px-6 hover:bg-foreground/15"
          data-testid="harbor-back"
          disabled={phase === "running"}
          onClick={onBack}
          type="button"
          variant="ghost"
        >
          Back
        </Button>
      </OnboardingFooter>
    </div>
  );
}

function HonestyLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm leading-6 text-foreground/75">
      <Check
        className="mt-0.5 h-4 w-4 shrink-0 text-foreground/45"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  );
}

function StepIcon({ state }: { state: HarborStep["state"] }) {
  if (state === "running") {
    return (
      <LoaderCircle
        className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-foreground/60"
        aria-hidden="true"
      />
    );
  }
  if (state === "failed") {
    return (
      <AlertCircle
        className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
        aria-hidden="true"
      />
    );
  }
  return (
    <Check
      className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"
      aria-hidden="true"
    />
  );
}
