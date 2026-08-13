import {
  CopyPlus,
  EllipsisVertical,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";

import type { AgentPersona, ManagedAgent } from "@/shared/api/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

export function PersonaActionsMenu({
  isActionPending,
  isPending,
  persona,
  linkedAgent,
  onDuplicate,
  onEdit,
  onShare,
  onDelete,
}: {
  isActionPending: boolean;
  isPending: boolean;
  persona: AgentPersona;
  /** Profile agent instance linked to this definition, if one exists. */
  linkedAgent: ManagedAgent | undefined;
  onDuplicate: (persona: AgentPersona) => void;
  onEdit: (persona: AgentPersona) => void;
  onShare: (
    persona: AgentPersona,
    linkedAgent: ManagedAgent | undefined,
  ) => void;
  onDelete: (persona: AgentPersona) => void;
}) {
  const disabled = isActionPending || isPending;
  const canEdit = !persona.sourceTeam;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Open actions for ${persona.displayName}`}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          type="button"
        >
          <EllipsisVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {canEdit ? (
          <DropdownMenuItem disabled={disabled} onClick={() => onEdit(persona)}>
            <Pencil className="h-4 w-4" />
            Edit
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          disabled={disabled}
          onClick={() => onDuplicate(persona)}
        >
          <CopyPlus className="h-4 w-4" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={disabled}
          onClick={() => onShare(persona, linkedAgent)}
        >
          <Share2 className="h-4 w-4" />
          Share
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {persona.sourceTeam ? (
          <DropdownMenuItem disabled>
            <Trash2 className="h-4 w-4" />
            Managed by team
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={disabled}
            // **One gesture, for built-ins as much as for customs.** Delete on
            // a built-in used to jump straight to persona deactivation, which
            // `validate_persona_activation_change` refuses outright while a
            // managed agent still references it — so removing a crew member
            // answered with "… is still assigned to a managed agent. Remove or
            // reassign those agents first." and left the owner to hunt down
            // agents he had never been shown as a dependency.
            //
            // Both kinds now open the same confirm dialog. It is the dialog
            // that names the cascade and `AgentsView`'s `onConfirm` that runs
            // it, after which deactivation succeeds because nothing references
            // the persona any more.
            onClick={() => onDelete(persona)}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
