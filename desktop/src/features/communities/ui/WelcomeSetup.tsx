import * as React from "react";
import { Check, Copy } from "lucide-react";

import { HostedCommunityOnboarding } from "@/features/communities/ui/HostedCommunityOnboarding";
import { LocalHarborOnboarding } from "@/features/communities/ui/LocalHarborOnboarding";
import { useCommunityOnboarding } from "@/features/onboarding/communityOnboarding";
import { InviteRedeemForm } from "@/features/onboarding/ui/InviteRedeemForm";
import { OnboardingChrome } from "@/features/onboarding/ui/OnboardingChrome";
import { OnboardingSeaBackdrop } from "@/features/onboarding/ui/OnboardingSeaBackdrop";
import {
  OnboardingFooter,
  OnboardingFooterProvider,
} from "@/features/onboarding/ui/OnboardingFooter";
import {
  type OnboardingTransitionDirection,
  OnboardingSlideTransition,
} from "@/features/onboarding/ui/OnboardingSlideTransition";
import { useIdentityQuery } from "@/shared/api/hooks";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { pubkeyToNpub } from "@/shared/lib/nostrUtils";
import { useSystemColorScheme } from "@/shared/theme/useSystemColorScheme";
import { Button } from "@/shared/ui/button";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";

type WelcomeSetupPage =
  | "welcome"
  | "existing"
  | "create-choice"
  | "local"
  | "join"
  | "member"
  | "owned";
type WelcomeTransitionMode = "initial" | OnboardingTransitionDirection;

type WelcomeSetupProps = {
  initialPage?: WelcomeSetupPage;
  initialTransitionMode?: WelcomeTransitionMode;
  onBack?: () => void;
};

/**
 * Dark glass over the moving sea. These were `Card variant="textured"` — the
 * white powder-edge nine-slice baked for upstream's bee-yellow field — but at
 * 88px tall the solid center collapses and only the feathered fade is left,
 * which reads as a blob of white noise on dark water. The glass idiom is the
 * one this file already uses for the npub box below.
 */
const COMMUNITY_OPTION_CARD_CLASS =
  "w-full max-w-[320px] rounded-2xl border border-foreground/15 bg-background/40 px-6 py-5 text-center text-sm font-normal leading-6 text-foreground backdrop-blur-sm transition-colors duration-150 ease-out hover:bg-background/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-foreground/35";

export function WelcomeSetup({
  initialPage = "welcome",
  initialTransitionMode = "initial",
  onBack,
}: WelcomeSetupProps) {
  const [page, setPage] = React.useState<WelcomeSetupPage>(initialPage);
  const [transitionMode, setTransitionMode] =
    React.useState<WelcomeTransitionMode>(initialTransitionMode);
  // While true, the Builderlab sign-in modal floats over the current page —
  // we only navigate to the hosted stage once sign-in completes, so the page
  // behind the modal never changes out from under the user.
  const [isHostedSignInOpen, setIsHostedSignInOpen] = React.useState(false);
  const [copiedNpub, setCopiedNpub] = React.useState(false);
  const communityOnboarding = useCommunityOnboarding();
  const identityQuery = useIdentityQuery();
  const systemColorScheme = useSystemColorScheme();
  const npub = identityQuery.data?.pubkey
    ? pubkeyToNpub(identityQuery.data.pubkey)
    : "";
  const npubError = identityQuery.error
    ? identityQuery.error instanceof Error
      ? identityQuery.error.message
      : "Could not load your public key."
    : null;

  const showPage = React.useCallback(
    (nextPage: WelcomeSetupPage, direction?: OnboardingTransitionDirection) => {
      setTransitionMode(
        direction ?? (nextPage === "welcome" ? "backward" : "forward"),
      );
      setPage(nextPage);
    },
    [],
  );

  const startConnection = React.useCallback(
    (relayUrl: string) => {
      communityOnboarding.start({
        source: "first-community",
        firstCommunityPage: page === "member" ? "member" : "join",
        relayUrl,
      });
    },
    [communityOnboarding, page],
  );

  const redeemInvite = React.useCallback(
    (relayUrl: string, code: string, policyReceipt?: string) => {
      communityOnboarding.start({
        source: "first-community",
        firstCommunityPage: page === "member" ? "member" : "join",
        relayUrl,
        inviteCode: code,
        policyReceipt,
      });
    },
    [communityOnboarding, page],
  );

  const startLocalHarbor = React.useCallback(
    (relayUrl: string) => {
      // The harbor is a community like any other: same entry point, no parallel
      // onboarding. `communityName` is passed so it is not derived to the
      // generic "Local Dev" every loopback host maps to.
      communityOnboarding.start({
        source: "first-community",
        firstCommunityPage: "local",
        relayUrl,
        communityName: "Home harbor",
      });
    },
    [communityOnboarding],
  );

  const transitionDirection =
    transitionMode === "backward" ? "backward" : "forward";
  // Upstream's back-action mechanism, folded into the fork's structure: the
  // welcome page's back exits onboarding via onBack; the hosted sub-pages step
  // back one level. The fork's own pages (create-choice, local, owned) carry
  // their back affordance inside their door, so they leave backAction undefined.
  const backAction =
    page === "welcome" && onBack
      ? { onClick: onBack, testId: "welcome-setup-back" }
      : page === "existing"
        ? {
            onClick: () => showPage("welcome"),
            testId: "existing-back",
          }
        : page === "join"
          ? {
              onClick: () => showPage("welcome"),
              testId: "welcome-join-back",
            }
          : page === "member"
            ? {
                onClick: () => showPage("existing"),
                testId: "welcome-member-back",
              }
            : undefined;

  return (
    <div
      className="buzz-onboarding-neutral-theme buzz-startup-shell flex h-dvh items-start justify-center overflow-y-auto bg-background px-4 pb-36 pt-[106px] text-foreground"
      data-system-color-scheme={systemColorScheme}
      data-testid="welcome-setup"
    >
      <StartupWindowDragRegion />
      <OnboardingSeaBackdrop />
      <OnboardingChrome current={5} />
      <OnboardingFooterProvider backAction={backAction}>
        <div className="relative z-10 flex min-h-0 w-full max-w-[920px] flex-1 flex-col items-center text-center">
          {page === "welcome" ? (
            <OnboardingSlideTransition
              className="flex h-full min-h-0 w-full flex-col items-center text-center"
              containerClassName="h-full min-h-0 [&>.buzz-onboarding-transition-line]:h-full"
              direction={transitionDirection}
              transitionKey={`welcome-${transitionDirection}`}
            >
              <div className="w-full max-w-[760px]">
                <h1 className="text-title font-normal">
                  Join or create a community
                </h1>
                <p className="mt-3 text-sm leading-6 text-foreground/80">
                  Join with an invite, create your own community, or reconnect
                  one you already have.
                </p>
              </div>
              <div className="flex w-full flex-1 flex-col items-center justify-center gap-5 py-8">
                <button
                  className={COMMUNITY_OPTION_CARD_CLASS}
                  data-testid="community-choice-join"
                  onClick={() => showPage("join")}
                  type="button"
                >
                  Join a community
                </button>
                <button
                  className={COMMUNITY_OPTION_CARD_CLASS}
                  data-testid="community-choice-create"
                  onClick={() => showPage("create-choice")}
                  type="button"
                >
                  Create a community
                </button>
                <button
                  className={COMMUNITY_OPTION_CARD_CLASS}
                  data-testid="community-choice-existing"
                  onClick={() => showPage("existing")}
                  type="button"
                >
                  I already have a community
                </button>
              </div>
            </OnboardingSlideTransition>
          ) : page === "existing" ? (
            <OnboardingSlideTransition
              className="flex h-full min-h-0 w-full flex-col items-center text-center"
              containerClassName="h-full min-h-0 [&>.buzz-onboarding-transition-line]:h-full"
              direction={transitionDirection}
              transitionKey={`existing-${transitionDirection}`}
            >
              <div className="w-full max-w-[760px]">
                <h1 className="text-title font-normal">
                  Reconnect to your community
                </h1>
                <p className="mt-3 text-sm leading-6 text-foreground/80">
                  Tell us your role so we can find the fastest way back in.
                </p>
              </div>
              <div className="flex w-full flex-1 flex-col items-center justify-center gap-5 py-8">
                <button
                  className={COMMUNITY_OPTION_CARD_CLASS}
                  data-testid="existing-choice-owner"
                  onClick={() => setIsHostedSignInOpen(true)}
                  type="button"
                >
                  I own the community
                </button>
                <button
                  className={COMMUNITY_OPTION_CARD_CLASS}
                  data-testid="existing-choice-member"
                  onClick={() => showPage("member")}
                  type="button"
                >
                  I’m a member or admin
                </button>
              </div>
            </OnboardingSlideTransition>
          ) : page === "create-choice" ? (
            <OnboardingSlideTransition
              className="flex h-full min-h-0 w-full flex-col items-center text-center"
              containerClassName="h-full min-h-0 [&>.buzz-onboarding-transition-line]:h-full"
              direction={transitionDirection}
              transitionKey={`create-choice-${transitionDirection}`}
            >
              <div className="w-full max-w-[760px]">
                <h1 className="text-title font-normal">Create a community</h1>
                <p className="mt-3 text-sm leading-6 text-foreground/80">
                  Host it with Block, or run the whole thing on this Mac.
                </p>
              </div>
              <div className="flex w-full flex-1 flex-col items-center justify-center gap-5 py-8">
                <button
                  className={COMMUNITY_OPTION_CARD_CLASS}
                  data-testid="community-choice-create-hosted"
                  onClick={() => setIsHostedSignInOpen(true)}
                  type="button"
                >
                  Create a hosted community
                </button>
                <button
                  className={COMMUNITY_OPTION_CARD_CLASS}
                  data-testid="community-choice-create-local"
                  onClick={() => showPage("local")}
                  type="button"
                >
                  Run Vingilot on this Mac
                </button>
              </div>
              <OnboardingFooter>
                <Button
                  className="h-9 rounded-full bg-foreground/10 px-6 hover:bg-foreground/15"
                  data-testid="create-choice-back"
                  onClick={() => showPage("welcome")}
                  type="button"
                  variant="ghost"
                >
                  Back
                </Button>
              </OnboardingFooter>
            </OnboardingSlideTransition>
          ) : page === "local" ? (
            <OnboardingSlideTransition
              className="flex h-full min-h-0 w-full flex-col items-center text-center"
              direction={transitionDirection}
              transitionKey={`local-${transitionDirection}`}
            >
              <LocalHarborOnboarding
                onBack={() => showPage("create-choice")}
                onReady={startLocalHarbor}
              />
            </OnboardingSlideTransition>
          ) : page === "owned" ? (
            <OnboardingSlideTransition
              className="flex w-full flex-col items-center text-center"
              direction={transitionDirection}
              transitionKey={`owned-${transitionDirection}`}
            >
              <HostedCommunityOnboarding onBack={() => showPage("welcome")} />
            </OnboardingSlideTransition>
          ) : (
            <OnboardingSlideTransition
              className="flex min-h-[calc(100dvh-15.625rem)] w-full flex-col items-center text-center"
              direction={transitionDirection}
              transitionKey={`${page}-${transitionDirection}`}
            >
              <div className="w-full max-w-[620px]">
                <h1 className="text-title font-normal">
                  {page === "member"
                    ? "Reconnect to your community"
                    : "Join a community"}
                </h1>
                <p className="mt-3 text-sm leading-6 text-foreground/80">
                  {page === "member"
                    ? "Enter the community URL or an invite link. Your role will be restored when you connect."
                    : "Enter the invite link or community URL you received."}
                </p>
              </div>
              <div className="flex w-full flex-1 flex-col items-center justify-center gap-16">
                <InviteRedeemForm
                  error={null}
                  isRedeeming={false}
                  onCancel={() =>
                    showPage(page === "member" ? "existing" : "welcome")
                  }
                  onConnect={startConnection}
                  onRedeem={redeemInvite}
                  placeholder="Invite link or community URL"
                  variant="onboarding-spotlight"
                />
                {page === "join" ? (
                  <div className="w-full max-w-[560px] text-left">
                    <p className="text-sm font-medium text-foreground">
                      Joining a private community?
                    </p>
                    <p className="mt-2 text-sm leading-6 text-foreground/75">
                      Some communities need the owner to add you before you can
                      join. Copy your public ID and send it to the community
                      owner.
                    </p>
                    <div className="mt-4 flex items-center gap-3 rounded-xl border border-foreground/10 bg-background/35 px-4 py-3">
                      <code
                        className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80"
                        data-testid="welcome-join-npub"
                      >
                        {npub || "Loading…"}
                      </code>
                      <Button
                        aria-label="Copy public ID"
                        className="h-9 shrink-0 rounded-full px-3"
                        disabled={!npub}
                        onClick={() => {
                          void writeTextToClipboard(npub).then(() => {
                            setCopiedNpub(true);
                            window.setTimeout(() => setCopiedNpub(false), 1500);
                          });
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {copiedNpub ? (
                          <Check className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Copy className="h-4 w-4" aria-hidden="true" />
                        )}
                        <span>{copiedNpub ? "Copied" : "Copy"}</span>
                      </Button>
                    </div>
                    {npubError ? (
                      <p className="mt-3 text-sm text-destructive">
                        {npubError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </OnboardingSlideTransition>
          )}
          {isHostedSignInOpen && page !== "owned" ? (
            <HostedCommunityOnboarding
              onBack={() => setIsHostedSignInOpen(false)}
              onReady={() => {
                setIsHostedSignInOpen(false);
                showPage("owned");
              }}
              stageHidden
            />
          ) : null}
        </div>
      </OnboardingFooterProvider>
    </div>
  );
}
