// The status bar's configurable canned prompts, as a Settings card (redesign
// P4 — the owner's own feature: "these can be ready-made prompts,
// configurable from Settings, that type into tmux and press Enter
// automatically. Except Review."). Stop and Review are deliberately absent
// from this list: Stop keeps the app's existing real stop-run behavior and
// Review dispatches to an agent instead of typing — neither is a prompt, so
// neither is editable here (`quickActions.ts`'s own header).
//
// Each row is a button's whole record — label, prompt template — persisted
// on every change (`vingilot-quick-actions.ts`, one localStorage key, the
// app's usual per-concern idiom). An empty list is a real, saved choice (the
// owner removed every button); Add restores one starting point, not the full
// defaults, so a deliberately-emptied list does not silently repopulate.

import * as React from "react";
import { X } from "lucide-react";

import {
  newQuickActionId,
  QUICK_ACTION_TEMPLATE_VARS,
  type QuickActionButton,
} from "@/features/runs/lib/quickActions";
import {
  persistVingilotQuickActions,
  readVingilotQuickActions,
} from "@/shared/theme/vingilot-quick-actions";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import { Textarea } from "@/shared/ui/textarea";

export function VingilotQuickActionsSettings() {
  const [buttons, setButtons] = React.useState<QuickActionButton[]>(
    readVingilotQuickActions,
  );

  const persist = React.useCallback((next: QuickActionButton[]) => {
    setButtons(next);
    persistVingilotQuickActions(next);
  }, []);

  const updateButton = (id: string, patch: Partial<QuickActionButton>) =>
    persist(
      buttons.map((button) =>
        button.id === id ? { ...button, ...patch } : button,
      ),
    );
  const removeButton = (id: string) =>
    persist(buttons.filter((button) => button.id !== id));
  const addButton = () =>
    persist([
      ...buttons,
      { id: newQuickActionId(), label: "New action", promptTemplate: "" },
    ]);

  return (
    <SettingsOptionGroup
      data-testid="vingilot-quick-actions-card"
      description={`Canned prompts the status bar types into the active terminal and presses Enter. Vars: ${QUICK_ACTION_TEMPLATE_VARS.map((v) => `{{${v}}}`).join(", ")} — filled from the selected worktree, blank when it has none. Stop and Review are not prompts and are not listed here.`}
      title="Quick actions"
    >
      {buttons.length === 0 ? (
        <SettingsOptionRow>
          <p
            className="text-sm font-normal text-muted-foreground/70"
            data-settings-subcopy
          >
            No quick actions configured.
          </p>
        </SettingsOptionRow>
      ) : (
        buttons.map((button) => (
          <SettingsOptionRow
            className="flex-col items-stretch gap-2"
            data-testid={`quick-action-row-${button.id}`}
            key={button.id}
          >
            <div className="flex items-center gap-2">
              <Input
                aria-label="Button label"
                className="w-48"
                data-testid={`quick-action-label-${button.id}`}
                onChange={(event) =>
                  updateButton(button.id, { label: event.target.value })
                }
                value={button.label}
              />
              <Button
                aria-label={`Remove ${button.label || "this button"}`}
                className="ml-auto text-muted-foreground hover:text-foreground"
                data-testid={`quick-action-remove-${button.id}`}
                onClick={() => removeButton(button.id)}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Textarea
              aria-label="Prompt template"
              className="min-h-16 font-mono text-xs"
              data-testid={`quick-action-prompt-${button.id}`}
              onChange={(event) =>
                updateButton(button.id, { promptTemplate: event.target.value })
              }
              value={button.promptTemplate}
            />
          </SettingsOptionRow>
        ))
      )}
      <SettingsOptionRow>
        <span />
        <Button
          data-testid="quick-action-add"
          onClick={addButton}
          size="sm"
          type="button"
          variant="outline"
        >
          Add
        </Button>
      </SettingsOptionRow>
    </SettingsOptionGroup>
  );
}
