// "Mint the crew" — the one dialog a workspace with no crew is offered, once
// (vingilot/docs/plans/2026-08-12-the-crew.md, Task 2).
//
// **An offer, and it reads like one.** A row per crew member this workspace
// does not have — up to five, and on a machine that came through community
// onboarding just the First Mate — every box already ticked, two buttons: mint
// them, or not now. "Not now" is remembered and nothing asks again
// (`crewMintStore.ts`) — so the dialog gets exactly one chance to be wrong
// about what he wanted, which is the budget an unprompted dialog should have.
//
// **Every row has a name field, and the name is his.** The persona is the job:
// what Lookout *does* is a prompt in the repo and is not editable here. What it
// is *called* is the Captain's, at mint time, in a text field that starts on
// the persona's own name and falls back to it when he empties it.
//
// **Mate sits apart, with a sentence.** It is the only row that is not a member
// of anything — an owner-only DM, per the assistant plan's identity decision —
// and a row that looked identical to the other four would be the dialog
// quietly telling him it is one of the crew in the room. So it is above the
// rule, with the line that says where it lives.
//
// **What it claims afterwards is one sentence and it is checkable**
// (`mintSentence`): who is aboard, that the keys are on this machine, and — if
// no relay answered — that their profiles are not published yet. Never a
// spinner: minting is local, so by the time that sentence is on screen the work
// is done.

import type { CrewMint } from "@/features/runs/lib/useCrewMint";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

import type { CrewMintRow } from "@/features/runs/lib/crewMint";

function Row({ crew, row }: { crew: CrewMint; row: CrewMintRow }) {
  const fieldId = `crew-mint-name-${row.personaId}`;
  return (
    <div
      className="flex items-start gap-3"
      data-testid={`crew-mint-row-${row.personaId}`}
    >
      <Checkbox
        aria-label={`Mint ${row.defaultName}`}
        checked={row.mint}
        className="mt-2"
        data-testid={`crew-mint-check-${row.personaId}`}
        disabled={crew.minting}
        onCheckedChange={(checked) =>
          crew.setChecked(row.personaId, checked === true)
        }
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Input
          aria-label={`${row.defaultName}'s name`}
          data-testid={`crew-mint-name-${row.personaId}`}
          disabled={crew.minting || !row.mint}
          id={fieldId}
          onChange={(event) => crew.setName(row.personaId, event.target.value)}
          placeholder={row.defaultName}
          value={row.name}
        />
        <p className="text-2xs text-muted-foreground">{row.job}</p>
      </div>
    </div>
  );
}

export function CrewMintDialog({ crew }: { crew: CrewMint }) {
  const mate = crew.rows.filter((row) => row.berth === "dm");
  const thread = crew.rows.filter((row) => row.berth === "thread");

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) crew.dismiss();
      }}
      open={crew.open}
    >
      <DialogContent data-testid="crew-mint-dialog">
        <DialogHeader>
          <DialogTitle>Mint the crew</DialogTitle>
          {/* No count in the sentence: the offer is what this workspace is
           * missing, so it is five rows on a fresh machine and one on a
           * machine that came through onboarding (`crewMint.ts`, rule 1b). A
           * description that said "these five" would be wrong on the commoner
           * of the two. */}
          <DialogDescription>
            Vingilot is a ship and you are its Captain. Below is the crew it
            does not have yet — each one a persona whose prompt is a file in
            this repository. Minting generates their keys on this machine;
            nothing is sent anywhere, and you can rename any of them here.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto py-3">
          {mate.map((row) => (
            <Row crew={crew} key={row.personaId} row={row} />
          ))}
          {/* The rule only separates two groups that are both here. An offer of
           * Mate alone has nothing below it, and Mate's own line already says
           * where it answers. */}
          {mate.length === 0 || thread.length === 0 ? null : (
            <p className="border-t border-border/50 pt-3 text-2xs text-muted-foreground/80">
              Those below share the team thread of whichever worktree you open.
              The First Mate above does not: it answers in a direct message
              meant only for you.
            </p>
          )}
          {thread.map((row) => (
            <Row crew={crew} key={row.personaId} row={row} />
          ))}
        </div>

        {crew.sentence === null ? null : (
          <p
            className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
            data-testid="crew-mint-sentence"
          >
            {crew.sentence}
          </p>
        )}

        <DialogFooter>
          {crew.sentence === null ? (
            <>
              <Button
                data-testid="crew-mint-decline"
                disabled={crew.minting}
                onClick={crew.decline}
                type="button"
                variant="ghost"
              >
                Not now
              </Button>
              <Button
                data-testid="crew-mint-confirm"
                disabled={crew.minting || crew.rows.every((row) => !row.mint)}
                onClick={crew.mint}
                type="button"
              >
                {crew.minting ? "Minting…" : "Mint the crew"}
              </Button>
            </>
          ) : (
            <Button
              data-testid="crew-mint-done"
              onClick={crew.dismiss}
              type="button"
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
