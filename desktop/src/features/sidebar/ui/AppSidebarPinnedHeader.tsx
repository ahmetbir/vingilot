import {
  Activity,
  Bot,
  FolderGit2,
  Inbox,
  SquareTerminal,
  Zap,
} from "lucide-react";

import { TopbarSearch } from "@/features/search/ui/TopbarSearch";
import {
  AgentsWorkingDot,
  useOpenPullRequestCount,
} from "@/features/sidebar/ui/SidebarNavSignals";
import { FeatureGate } from "@/shared/features";
import type { Channel, SearchHit } from "@/shared/api/types";
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";

type SidebarSelectedView =
  | "home"
  | "channel"
  | "messages"
  | "agents"
  | "workspace"
  | "workflows"
  | "pulse"
  | "projects";

type AppSidebarPinnedHeaderProps = {
  channelLabels: Record<string, string>;
  currentChannelId?: string | null;
  currentPubkey?: string;
  onBrowseChannels?: () => void;
  onCreateAgent: () => void;
  onCreateChannel: () => void;
  onOpenDm: (input: { pubkeys: string[] }) => Promise<void>;
  onOpenSearchResult: (hit: SearchHit) => void;
  onSelectChannel: (channelId: string) => void;
  searchChannels: Channel[];
  searchFocusRequest: number;
  scopeSearchFocusRequest: number;
  suggestionChannels: Channel[];
};

type AppSidebarPrimaryMenuProps = {
  homeBadgeCount: number;
  onSelectAgents: () => void;
  onSelectHome: () => void;
  onSelectProjects: () => void;
  onSelectPulse: () => void;
  onSelectWorkspace: () => void;
  onSelectWorkflows: () => void;
  selectedView: SidebarSelectedView;
};

/** **The search dialog with no box** (vingilot P1.1, owner veto 1). The
 * sidebar's own "Search everything ⌘K" box is gone — the top bar's pill is the
 * only search affordance — but the dialog itself stays mounted and reachable
 * through the focus-request wires (⌘F channel search and `AppShell`'s search
 * plumbing), so nothing about search *works* differently, it just has one
 * fewer door. Renamed from `AppSidebarPinnedHeader`; the props are unchanged
 * so `AppSidebar`'s wiring did not have to move. */
export function AppSidebarHiddenSearch({
  channelLabels,
  currentChannelId,
  currentPubkey,
  onBrowseChannels,
  onCreateAgent,
  onCreateChannel,
  onOpenDm,
  onOpenSearchResult,
  onSelectChannel,
  searchChannels,
  searchFocusRequest,
  scopeSearchFocusRequest,
  suggestionChannels,
}: AppSidebarPinnedHeaderProps) {
  return (
    <TopbarSearch
      channelLabels={channelLabels}
      channels={searchChannels}
      currentChannelId={currentChannelId}
      currentPubkey={currentPubkey}
      focusRequest={searchFocusRequest}
      onOpenChannel={onSelectChannel}
      onOpenResult={onOpenSearchResult}
      onOpenUser={(user) => onOpenDm({ pubkeys: [user.pubkey] })}
      onBrowseChannels={onBrowseChannels}
      onCreateAgent={onCreateAgent}
      onCreateChannel={onCreateChannel}
      scopeFocusRequest={scopeSearchFocusRequest}
      suggestionChannels={suggestionChannels}
      variant="hidden"
    />
  );
}

export function AppSidebarPrimaryMenu({
  homeBadgeCount,
  onSelectAgents,
  onSelectHome,
  onSelectProjects,
  onSelectPulse,
  onSelectWorkspace,
  onSelectWorkflows,
  selectedView,
}: AppSidebarPrimaryMenuProps) {
  return (
    <SidebarHeader
      className="relative z-40 cursor-default select-none px-2 pb-0 pt-3"
      data-tauri-drag-region
      data-testid="sidebar-primary-menu"
    >
      <SidebarMenu className="pb-2">
        <SidebarMenuItem>
          <SidebarMenuButton
            className="data-[active=true]:font-normal"
            isActive={selectedView === "home"}
            onClick={onSelectHome}
            tooltip="Inbox"
            type="button"
          >
            <Inbox
              className={
                selectedView !== "home" ? "h-4 w-4 opacity-80" : "h-4 w-4"
              }
            />
            <SidebarMenuLabel
              className={selectedView !== "home" ? "opacity-80" : undefined}
            >
              Inbox
            </SidebarMenuLabel>
          </SidebarMenuButton>
          {homeBadgeCount > 0 ? (
            <SidebarMenuBadge
              className="right-2 rounded-full bg-primary/15 px-1.5 text-2xs text-primary peer-data-[active=true]/menu-button:bg-sidebar-active-foreground/20 peer-data-[active=true]/menu-button:text-sidebar-active-foreground"
              data-testid="sidebar-home-count"
            >
              {Math.min(homeBadgeCount, 99)}
            </SidebarMenuBadge>
          ) : null}
        </SidebarMenuItem>
        {/* Vingilot redesign P1 row order (mockup sidebar): Inbox above,
         * then Agents (working dot), Pull requests (open count — upstream's
         * Repos view renamed to what the mockup's stage calls it; the view,
         * route and `open-projects-view` testid keep their names), Deck. The
         * gated Pulse/Workflows rows survive below — removal is P7's. */}
        <SidebarMenuItem>
          <SidebarMenuButton
            className="data-[active=true]:font-normal"
            data-testid="open-agents-view"
            isActive={selectedView === "agents"}
            onClick={onSelectAgents}
            tooltip="Agents"
            type="button"
          >
            <Bot
              className={
                selectedView !== "agents" ? "h-4 w-4 opacity-80" : "h-4 w-4"
              }
            />
            <SidebarMenuLabel
              className={selectedView !== "agents" ? "opacity-80" : undefined}
            >
              Agents
            </SidebarMenuLabel>
            <AgentsWorkingDot />
          </SidebarMenuButton>
        </SidebarMenuItem>
        <FeatureGate feature="projects">
          <PullRequestsMenuItem
            isActive={selectedView === "projects"}
            onSelect={onSelectProjects}
          />
        </FeatureGate>
        <SidebarMenuItem>
          {/* "Deck", not "Projects": upstream's Repos entry two rows up owns
           * the Projects name, and two menu items readable as "Projects" one
           * row apart was the collision the owner flagged (vingilot
           * single-sidebar plan, §1.2). Label only — the view, route, test id
           * and handlers keep their `workspace` names. */}
          <SidebarMenuButton
            data-testid="open-workspace-view"
            isActive={selectedView === "workspace"}
            onClick={onSelectWorkspace}
            tooltip="Deck"
            type="button"
          >
            <SquareTerminal className="h-4 w-4" />
            <SidebarMenuLabel>Deck</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <FeatureGate feature="pulse">
          <SidebarMenuItem>
            <SidebarMenuButton
              data-testid="open-pulse-view"
              isActive={selectedView === "pulse"}
              onClick={onSelectPulse}
              tooltip="Pulse"
              type="button"
            >
              <Activity className="h-4 w-4" />
              <SidebarMenuLabel>Pulse</SidebarMenuLabel>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </FeatureGate>
        <FeatureGate feature="workflows">
          <SidebarMenuItem>
            <SidebarMenuButton
              data-testid="open-workflows-view"
              isActive={selectedView === "workflows"}
              onClick={onSelectWorkflows}
              tooltip="Workflows"
              type="button"
            >
              <Zap className="h-4 w-4" />
              <SidebarMenuLabel>Workflows</SidebarMenuLabel>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </FeatureGate>
      </SidebarMenu>
    </SidebarHeader>
  );
}

/** The Pull requests row — its own component so the work-items query mounts
 * only when the projects feature gate is on (hooks cannot sit behind a
 * conditional inside the menu above). Count badge in the mockup's green. */
function PullRequestsMenuItem({
  isActive,
  onSelect,
}: {
  isActive: boolean;
  onSelect: () => void;
}) {
  const openCount = useOpenPullRequestCount();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        data-testid="open-projects-view"
        isActive={isActive}
        onClick={onSelect}
        tooltip="Pull requests"
        type="button"
      >
        <FolderGit2 className="h-4 w-4" />
        <SidebarMenuLabel>Pull requests</SidebarMenuLabel>
      </SidebarMenuButton>
      {openCount > 0 ? (
        <SidebarMenuBadge
          className="right-2 rounded-full bg-emerald-500/15 px-1.5 text-2xs text-emerald-400 peer-data-[active=true]/menu-button:bg-sidebar-active-foreground/20 peer-data-[active=true]/menu-button:text-sidebar-active-foreground"
          data-testid="sidebar-open-pr-count"
        >
          {Math.min(openCount, 99)}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}
