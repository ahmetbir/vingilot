import { expect, test, type Page } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { seedActiveIdentity } from "../helpers/onboarding";
import { openSettings } from "../helpers/settings";

/**
 * The home harbor: run a whole Vingilot community on this Mac, then join it like
 * any other (vingilot/docs/plans/2026-08-13-home-harbor.md, Tasks 3 + 4). These
 * specs drive the mock bridge — the `harbor_*` commands are mocked in
 * src/testing/e2eBridge.ts, seeded through `mock.harbor` — so no Docker runs.
 */

const HARBOR_RELAY_URL = "ws://127.0.0.1:7447";

const BLANK_TYLER_IDENTITY = {
  ...TEST_IDENTITIES.tyler,
  username: "",
};

const ONBOARDING_TRANSACTION_KEY = "buzz-community-onboarding-transaction.v1";

/** Reach the first-community create hub with no community configured yet. */
async function gotoCreateHub(
  page: Page,
  mock?: Parameters<typeof installMockBridge>[1],
) {
  await seedActiveIdentity(page, BLANK_TYLER_IDENTITY);
  await page.addInitScript((pubkey) => {
    window.localStorage.setItem(
      `buzz-machine-onboarding-complete.v2:${pubkey}`,
      "true",
    );
  }, BLANK_TYLER_IDENTITY.pubkey);
  await installMockBridge(page, mock, {
    relayWsUrl: "ws://localhost:3000",
    skipOnboardingSeed: true,
    skipCommunitySeed: true,
  });
  await page.goto("/");
  await page.getByTestId("community-choice-create").click();
}

test("the create hub offers both a hosted and a local door", async ({
  page,
}) => {
  await gotoCreateHub(page);

  await expect(
    page.getByRole("heading", { name: "Create a community" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("community-choice-create-hosted"),
  ).toBeVisible();
  await expect(page.getByTestId("community-choice-create-local")).toBeVisible();
});

test("the local door states the honesty lines before it runs", async ({
  page,
}) => {
  await gotoCreateHub(page);
  await page.getByTestId("community-choice-create-local").click();

  await expect(
    page.getByRole("heading", { name: "Run Vingilot on this Mac" }),
  ).toBeVisible();
  await expect(
    page.getByText("the relay listens on loopback only"),
  ).toBeVisible();
  await expect(page.getByText("Nothing binds beyond 127.0.0.1")).toBeVisible();
  await expect(page.getByText("no second machine can reach it")).toBeVisible();
  await expect(page.getByTestId("harbor-run")).toBeVisible();
});

test("the local door renders each step and joins the loopback relay", async ({
  page,
}) => {
  const doneSteps = [
    {
      step: "checking-docker" as const,
      state: "done" as const,
      detail: "Docker is running (Docker Desktop 27.0.0).",
    },
    {
      step: "writing-bundle" as const,
      state: "done" as const,
      detail: "Wrote the harbor bundle to ~/.vingilot/harbor.",
    },
    {
      step: "starting" as const,
      state: "done" as const,
      detail: "Started the relay, database and cache.",
    },
    {
      step: "waiting-for-health" as const,
      state: "done" as const,
      detail: "The relay is answering on ws://127.0.0.1:7447.",
    },
  ];
  await gotoCreateHub(page, {
    harbor: {
      installSteps: doneSteps,
      installReport: {
        steps: doneSteps,
        relayUrl: HARBOR_RELAY_URL,
        failure: null,
      },
    },
  });
  await page.getByTestId("community-choice-create-local").click();
  await page.getByTestId("harbor-run").click();

  // On success the door hands off immediately and unmounts, so the step list is
  // the timeout spec's job — here the proof is the outcome: the door hands the
  // loopback URL to the ordinary community machinery, and the onboarding
  // transaction is written for this relay, with no parallel path.
  await expect
    .poll(() =>
      page.evaluate(
        (key) => window.localStorage.getItem(key),
        ONBOARDING_TRANSACTION_KEY,
      ),
    )
    .toContain(HARBOR_RELAY_URL);
  await expect
    .poll(() =>
      page.evaluate(
        (key) => window.localStorage.getItem(key),
        ONBOARDING_TRANSACTION_KEY,
      ),
    )
    .toContain('"firstCommunityPage":"local"');
});

test("a machine without Docker gets an honest sentence and the Docker link", async ({
  page,
}) => {
  await gotoCreateHub(page, {
    harbor: {
      probe: {
        docker: "absent",
        refusal:
          "Docker isn’t installed. Install Docker Desktop, then try again.",
        installUrl: "https://www.docker.com/products/docker-desktop/",
        engine: null,
      },
    },
  });
  await page.getByTestId("community-choice-create-local").click();
  await page.getByTestId("harbor-run").click();

  await expect(page.getByTestId("harbor-failure")).toContainText(
    "Docker isn’t installed",
  );
  await expect(page.getByTestId("harbor-get-docker")).toBeVisible();
  await expect(page.getByTestId("harbor-retry")).toBeVisible();
  // The install sequence never ran — the probe stopped it before any step.
  await expect(page.getByTestId("harbor-steps")).toHaveCount(0);
});

test("a --wait timeout names the container that never went healthy", async ({
  page,
}) => {
  const timeoutSteps = [
    {
      step: "checking-docker" as const,
      state: "done" as const,
      detail: "Docker is running.",
    },
    {
      step: "writing-bundle" as const,
      state: "done" as const,
      detail: "Wrote the harbor bundle.",
    },
    {
      step: "starting" as const,
      state: "done" as const,
      detail: "Started the containers.",
    },
    {
      step: "waiting-for-health" as const,
      state: "failed" as const,
      detail:
        "vingilot-relay (unhealthy) did not answer within 600s. Run: docker compose -p vingilot-harbor logs relay",
    },
  ];
  await gotoCreateHub(page, {
    harbor: {
      installSteps: timeoutSteps,
      installReport: {
        steps: timeoutSteps,
        relayUrl: null,
        failure:
          "vingilot-relay (unhealthy) did not answer within 600s. Run: docker compose -p vingilot-harbor logs relay",
      },
    },
  });
  await page.getByTestId("community-choice-create-local").click();
  await page.getByTestId("harbor-run").click();

  await expect(
    page.getByTestId("harbor-step-waiting-for-health"),
  ).toHaveAttribute("data-state", "failed");
  // The failed step row carries the sentence itself — container name and the
  // logs command. The separate failure box must NOT appear when it would only
  // repeat that row: the owner's first real run showed the same paragraph
  // twice in red, and this pins the dedup.
  await expect(
    page.getByTestId("harbor-step-waiting-for-health"),
  ).toContainText("vingilot-relay (unhealthy)");
  await expect(
    page.getByTestId("harbor-step-waiting-for-health"),
  ).toContainText("docker compose -p vingilot-harbor logs relay");
  await expect(page.getByTestId("harbor-failure")).toHaveCount(0);
});

test("the settings card draws a running harbor with Stop and the uninstall commands", async ({
  page,
}) => {
  await installMockBridge(page, {
    harbor: {
      status: {
        state: "running",
        docker: "ready",
        services: [
          { service: "relay", state: "running", health: "healthy" },
          { service: "postgres", state: "running", health: "healthy" },
          { service: "redis", state: "running", health: "healthy" },
        ],
        relayUrl: HARBOR_RELAY_URL,
        composePath: "/Users/dev/.vingilot/harbor/harbor-compose.yml",
        envPath: "/Users/dev/.vingilot/harbor/harbor.env",
        composeIsShipped: true,
        uninstall: {
          down: "docker compose -p vingilot-harbor down",
          volumes: "docker volume rm vingilot-harbor_postgres",
        },
        message: null,
      },
    },
  });
  await page.goto("/");
  await openSettings(page, "home-harbor");

  await expect(page.getByTestId("settings-home-harbor")).toBeVisible();
  await expect(page.getByTestId("harbor-status-label")).toHaveAttribute(
    "data-state",
    "running",
  );
  await expect(page.getByTestId("harbor-status-label")).toContainText(
    "Running",
  );
  await expect(page.getByTestId("harbor-stop")).toBeVisible();
  await expect(page.getByTestId("harbor-start")).toHaveCount(0);
  await expect(page.getByTestId("harbor-uninstall-down")).toContainText(
    "docker compose -p vingilot-harbor down",
  );
  await expect(page.getByTestId("harbor-uninstall-volumes")).toContainText(
    "docker volume rm vingilot-harbor_postgres",
  );
});

test("the settings card offers Start for a stopped harbor and calls harbor_start", async ({
  page,
}) => {
  await installMockBridge(page, {
    harbor: {
      status: {
        state: "stopped",
        docker: "ready",
        services: [],
        relayUrl: HARBOR_RELAY_URL,
        composePath: "/Users/dev/.vingilot/harbor/harbor-compose.yml",
        envPath: "/Users/dev/.vingilot/harbor/harbor.env",
        composeIsShipped: true,
        uninstall: {
          down: "docker compose -p vingilot-harbor down",
          volumes: "docker volume rm vingilot-harbor_postgres",
        },
        message: null,
      },
    },
  });
  await page.goto("/");
  await openSettings(page, "home-harbor");

  await expect(page.getByTestId("harbor-status-label")).toHaveAttribute(
    "data-state",
    "stopped",
  );
  await expect(page.getByTestId("harbor-start")).toBeVisible();
  await expect(page.getByTestId("harbor-stop")).toHaveCount(0);

  await page.getByTestId("harbor-start").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
            .__BUZZ_E2E_COMMANDS__ ?? [],
      ),
    )
    .toContain("harbor_start");
});

test("the settings card explains a not-installed harbor and hides the uninstall block", async ({
  page,
}) => {
  await installMockBridge(page, {
    harbor: {
      status: {
        state: "not-installed",
        docker: "ready",
        services: [],
        relayUrl: HARBOR_RELAY_URL,
        composePath: "/Users/dev/.vingilot/harbor/harbor-compose.yml",
        envPath: "/Users/dev/.vingilot/harbor/harbor.env",
        composeIsShipped: null,
        uninstall: {
          down: "docker compose -p vingilot-harbor down",
          volumes: "docker volume rm vingilot-harbor_postgres",
        },
        message: null,
      },
    },
  });
  await page.goto("/");
  await openSettings(page, "home-harbor");

  await expect(page.getByTestId("harbor-status-label")).toHaveAttribute(
    "data-state",
    "not-installed",
  );
  await expect(page.getByTestId("harbor-status-label")).toContainText(
    "Not installed",
  );
  await expect(page.getByTestId("harbor-start")).toHaveCount(0);
  await expect(page.getByTestId("harbor-stop")).toHaveCount(0);
  await expect(page.getByTestId("harbor-uninstall")).toHaveCount(0);
});
