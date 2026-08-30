// The search dialog's trigger button, split out of `TopbarSearch.tsx` at the
// 1000-line ratchet (P1.1): that file gained the hidden variant and the
// palette's mailbox subscription, and the house rule is that an edit to a
// file at the ceiling begins with a split. This is the cohesive piece — pure
// presentation, no state, no dialog knowledge. The hidden variant simply
// never renders it (`TopbarSearch` holds that branch).

import { Search } from "lucide-react";
import type * as React from "react";

import { cn } from "@/shared/lib/cn";

export function TopbarSearchTrigger({
  isIconVariant,
  onOpen,
  query,
  triggerRef,
}: {
  isIconVariant: boolean;
  onOpen: () => void;
  query: string;
  triggerRef: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      aria-label="Search everything"
      className={
        isIconVariant
          ? "group/search flex size-6 items-center justify-center rounded p-1 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-border/35 hover:text-sidebar-foreground focus-visible:bg-sidebar-border/35 focus-visible:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          : "group/search flex h-8 w-full items-center gap-2 rounded-md bg-sidebar-border/35 px-2 text-left text-sm text-sidebar-foreground/55 transition-colors duration-150 ease-out hover:bg-sidebar-border/35 hover:text-sidebar-foreground focus-visible:bg-sidebar-border/35 focus-visible:text-sidebar-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-sidebar-ring"
      }
      data-testid="open-search"
      onClick={onOpen}
      ref={triggerRef}
      title="Search everything"
      type="button"
    >
      <Search
        className={
          isIconVariant
            ? "h-4 w-4 shrink-0"
            : "h-4 w-4 shrink-0 text-sidebar-foreground/45 transition-colors duration-150 ease-out group-hover/search:text-sidebar-foreground/65 group-focus-visible/search:text-sidebar-foreground"
        }
      />
      {isIconVariant ? null : (
        <>
          <span
            className={cn(
              "min-w-0 flex-1 truncate transition-colors duration-150 ease-out",
              query ? "text-sidebar-foreground" : "text-sidebar-foreground/55",
            )}
          >
            {query || "Search everything"}
          </span>
          <kbd className="shrink-0 text-2xs text-sidebar-foreground/45">
            &#x2318;K
          </kbd>
        </>
      )}
    </button>
  );
}
