# Workbench mount spike — report

**Verdict: fallback to the chat adapter.**

Date: 2026-08-02. Commit: `066e4dd9f2c242d0129ede030bce303f4cf84003`. Branch:
`vingilot/workbench-mount-spike`.

Two of the three ADR-001 exit criteria fail against the harness as built, and
the failures are structural, not fixable from inside `vingilot/`:

- Criterion 2 fails mechanically: `MessageTimeline` transitively reaches
  `desktop/src/app/**` through a chain the Workbench does not own
  (`MessageRow` → `shared/ui/markdown` → a config-nudge component →
  `AppShellContext`/navigation). `MessageTimeline`'s own 22 direct imports
  never touch `@/app/`, exactly as the plan's baseline states — the edge is
  two hops deeper, invisible to a direct-import read and only caught by the
  transitive walker built in Task 2.
- Criterion 3 shows 10 of 20 registered community-scoped singletons reachable
  from the mount — past the plan's own "more than 3 ... weigh it against the
  adapter fallback" threshold, decided in Task 4 before the number was known.
- Criterion 1 does not pass either, though for a different reason: the
  mounted subtree throws on missing `QueryClientProvider` and renders
  nothing. That failure alone might have been an acceptable "small number of
  leaf providers" condition. It doesn't get the chance to be judged on its
  own, because criterion 2 already disqualifies the mount.

No upstream file was modified and no provider or shim was added to force any
result, per the plan's explicit instruction.

## Evidence

### Criterion 1 — message list and composer render and accept input

```
$ pnpm --filter @vingilot/workbench typecheck
> tsc --noEmit
(exit 0, no output)
```

Runtime check — dev server at `http://localhost:5273`, loaded with Playwright
(no `.playwright-mcp` state left in the repo; the browser tab was navigated,
inspected, and closed during this task):

```
Page URL: http://localhost:5273/
Page Title: Vingilot Workbench — mount spike
Console: 1 errors, 1 warnings

Error: No QueryClient set, use QueryClientProvider to set one
    at useQueryClient (.../node_modules/.vite/deps/@tanstack_react-query.js:2546:21)
    at useBaseQuery (.../@tanstack_react-query.js:2680:17)
    at useQuery (.../@tanstack_react-query.js:2719:9)
    at useIdentityQuery (.../desktop/src/shared/api/hooks.ts:4:9)
    at MessageComposerImpl (.../desktop/src/features/messages/ui/MessageComposer.tsx:53:24)
    ...

Snapshot:
(empty — #root has no content; React discarded the tree after the uncaught render error)
```

This matches Task 3's and Task 5's independent findings: `MessageRow` (via
`useReactionHandler`) and `MessageComposer` (via `useIdentityQuery`) both call
`useQueryClient()` with no provider in the tree, and `main.tsx` installs no
error boundary, so the failure is a fully blank page rather than a partial
render. **Result: fails as mounted.** Not evaluated further because criterion
2 already disqualifies this mount independent of providers.

### Criterion 2 — no import edge to `desktop/src/app/**` or the sidebar shell

```
$ pnpm --filter @vingilot/workbench check:import-edges
check-import-edges: 4 forbidden edge(s) from .../vingilot/workbench/src/SpikeHarness.tsx:

  ../../desktop/src/app/AppShellContext.tsx
  ../../desktop/src/app/navigation/resolveSearchHitDestination.ts
  ../../desktop/src/app/navigation/searchHitEventCache.ts
  ../../desktop/src/app/navigation/useAppNavigation.ts

ADR-001 spike exit criterion 2 requires no edge into the upstream app shell.
(exit 1)
```

```
$ pnpm --filter @vingilot/workbench test
...
✖ the harness reaches no upstream app shell module (151.742375ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  + [
  +   '.../desktop/src/app/AppShellContext.tsx',
  +   '.../desktop/src/app/navigation/resolveSearchHitDestination.ts',
  +   '.../desktop/src/app/navigation/searchHitEventCache.ts',
  +   '.../desktop/src/app/navigation/useAppNavigation.ts'
  + ]
  - []
✔ a deliberate app-shell import is detected (237.075833ms)
✔ the harness reaches the upstream message timeline (150.5015ms)
✔ the harness reaches the upstream composer (123.877084ms)
✔ every reachable community singleton is enumerated (152.294458ms)
ℹ tests 5
ℹ pass 4
ℹ fail 1
```

**Result: fails.** This is a hard, mechanical violation of the exit
criterion, reached via `MessageTimeline` → `MessageRow` →
`shared/ui/markdown` → a config-nudge attachment component → `AppShellContext`
/ `useAppNavigation` / `resolveSearchHitDestination` / `searchHitEventCache`.
It exists whether or not the composer is mounted (confirmed in Task 3 with
the timeline alone) and whether or not any provider is supplied. There is no
Workbench-side fix: fixing it requires either upstream editing `MessageRow`/
`markdown` to stop depending on app-scoped navigation (forbidden — an
upstream edit that makes the spike pass invalidates it), or the Workbench
not mounting these components in place at all.

### Criterion 3 — every reachable community-scoped singleton is unreachable or registered

```
$ pnpm --filter @vingilot/workbench check:singleton-reach
check-singleton-reach: 10 reachable community singleton(s) from .../vingilot/workbench/src/SpikeHarness.tsx
  clearAllDrafts  (features/messages/lib/useDrafts.ts)
  clearMarkdownNodeCache  (shared/ui/markdown/nodeCache.ts)
  clearSearchHitEventCache  (app/navigation/searchHitEventCache.ts)
  resetActiveAgentTurnsStore  (features/agents/activeAgentTurnsStore.ts)
  resetAgentObserverStore  (features/agents/observerRelayStore.ts)
  resetAgentWorkingSignal  (features/agents/agentWorkingSignal.ts)
  resetAvatarPresentations  (features/profile/avatarPresentationStore.ts)
  resetMediaCaches  (shared/lib/mediaUrl.ts)
  resetRateLimitGate  (shared/api/relayRateLimitGate.ts)
  resetVideoPlayerState  (shared/ui/videoPlayerState.ts)
(exit 0)
```

**Result: 10 of 20 registered singletons reachable** — none registered with a
Workbench reset path (none exist; the Workbench has no community-switching
concept yet). Per the interpretation fixed in Task 4 before this number was
seen: "more than 3 ... treat as a signal the mount drags in far more than
presentation, and weigh it against the adapter fallback." This mount is
roughly 3x that threshold, and one of the ten (`clearSearchHitEventCache`) is
the same `app/navigation` module already flagged as a criterion-2 violation —
the two failures share a root cause, not two independent problems.

### Seams and merge posture

```
$ ./vingilot/scripts/check-seams.sh; echo "seams exit=$?"
seams exit=0
```

```
$ ./vingilot/scripts/upstream-merge-dryrun.sh
VERDICT: clean
Remote:            upstream/main
HEAD:               066e4dd9f2c242d0129ede030bce303f4cf84003
Merge base:         19d57b0d46baa55814ac737041a36d0b405c9f64
Upstream head:      fc598f5f8d70728d11d0712b9fa8e3acc44ea4c3
Incoming commits:  13
Incoming files:    24
Seam check: vingilot/seams.yaml
  7 seam path(s)/pattern(s) declared
  no incoming file touches a declared seam
Conflict candidates (changed by upstream AND by the fork since 19d57b0d46baa55814ac737041a36d0b405c9f64):
  none
VERDICT: clean
```

Neither check is a spike exit criterion, but both are prerequisites for any
mount-based approach to stay viable — confirmed clean at this commit.

## What the mount dragged in

Transitive graph from `SpikeHarness.tsx` (`MessageTimeline` + `MessageComposer`,
fabricated props, no providers): **500 files total**, of which 2 are
Workbench-local (`SpikeHarness.tsx`, `fixtures/timeline.ts`) and 498 resolve
into `desktop/src/`:

| Root | Files reachable |
|---|---|
| `desktop/src/features/**` | 320 |
| `desktop/src/shared/**` | 174 |
| `desktop/src/app/**` (forbidden by criterion 2) | 4 |

Two leaf presentation components pull in roughly two-thirds of desktop's
entire `src/features` tree and most of `shared`. That ratio is itself a
finding: this is not a narrow slice import, it's most of the application's
module graph reached from two chat components.

## Providers required

- `QueryClientProvider` (`@tanstack/react-query`) — required by both mounted
  components (`MessageRow` via `useReactionHandler`, `MessageComposer` via
  `useIdentityQuery`). Not supplied; the harness deliberately supplies no
  providers so a requirement surfaces as an error rather than being quietly
  satisfied. In isolation this is a small, leaf-like requirement — one
  provider, matching what `desktop/src/main.tsx`'s own hierarchy documents
  (`QueryClientProvider > App`) — and would likely have been judged
  acceptable on its own.
- No other provider requirement was observed before the render aborted; it is
  possible additional requirements exist further down the tree and were never
  reached because the QueryClient error stops rendering at the first mounted
  component that needs one.

## Singletons reachable

10 of 20, listed above under Criterion 3. None registered with a Workbench
reset path — no such path exists, since the Workbench has no community
lifecycle. If the mount approach were otherwise viable, each would need
either a Workbench-owned call into `resetCommunityState()`'s underlying reset
functions, or confirmation the Workbench never triggers a community switch
while these are populated. That design work does not proceed given the
criterion-2 failure above.

## Churn exposure

```
$ git fetch upstream --quiet
$ git diff --name-only $(git merge-base HEAD upstream/main) upstream/main \
    | grep -E "desktop/src/(features/(messages|channels|profile)|shared)/" | wc -l
5
```

Changed files on this exact surface, upstream vs. the current merge base:

```
desktop/src/features/channels/ui/ChannelPane.tsx
desktop/src/features/messages/ui/MessageRow.tsx
desktop/src/features/messages/ui/MessageThreadPanel.tsx
desktop/src/features/messages/ui/MessageTimeline.tsx
desktop/src/features/messages/ui/TimelineMessageList.tsx
```

5 files changed on the exact surface this spike would depend on, matching the
plan's stated baseline of 5 changed files in a single day (2026-08-02). Even
setting aside the criterion-2 and criterion-3 failures, an alias-import mount
of this surface would need to absorb changes to `MessageTimeline.tsx` and
`MessageRow.tsx` on a near-daily cadence — the exact files this spike's
harness renders. The adapter fallback isolates the Workbench from this churn
by design: it owns its own presentation and only depends on relay/SDK wire
contracts, which change far less often than UI components.

## Limitations

- The import walker (`vingilot/workbench/scripts/import-graph.mjs`) is
  regex-based, not a parser: it misses dynamic `import()` with a computed
  specifier. It over-approximates nothing and under-approximates rarely,
  which is the safe direction for a guard whose failure mode should be false
  confidence, not false alarms — but it means the true reachable set (both
  for criterion 2 and criterion 3) could be larger than measured, never
  smaller.
- The spike ran with no relay and no Tauri shell. Runtime data-fetching paths
  (the actual `useQuery`/`useMutation` network calls, WebSocket subscription
  setup, Tauri IPC calls the mounted components might make once a
  QueryClient existed) were never exercised — the render aborted before any
  of that code ran. A provider-satisfied mount might surface further
  requirements this spike did not reach.
- The composer's runtime behavior (draft persistence, attachment upload,
  emoji picker) was never observed either, for the same reason: the render
  never got past the QueryClient error. Task 5's comparison of "what the
  composer needs beyond the timeline" is therefore based on static import
  reachability only, not on an interactive session.
