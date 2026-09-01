// A page produced in a worktree, LOOKED at — under a sandbox that says out
// loud what it switched off
// (owner ask: "html gosterme, dizayn gosterme, artifact gosterme vs hepsi
// olsun"; the posture itself is `filePreview.ts`, where it is argued).
//
// **The page is untrusted input, and it is treated like input.** Whatever wrote
// it — an agent two panes over, a build step, a designer's export — this app did
// not, and its author is not the owner. So the frame it draws in has an opaque
// origin (no `allow-same-origin`), runs no script (no `allow-scripts`), submits
// no form, opens no window, navigates nothing, and is handed a policy that
// forbids every load that would leave this machine.
//
// **Nothing crosses back either.** There is no `postMessage` listener here and
// no `ref` that reaches into the frame: with `sandbox=""` the frame's
// `contentDocument` is `null` from this side, which is the same fact from the
// other direction, and the pane never asks for it. The one channel a framed
// document always keeps is `parent.postMessage`, which cannot be revoked by any
// attribute — and it reaches nothing, because nothing in this app listens for
// it.
//
// **The sentence above the frame is part of the feature, not chrome.** A design
// whose web font never arrives and whose carousel never moves looks broken, and
// a reader with no explanation concludes the pane is broken. The note is what
// turns "this is wrong" into "this is a sandbox".

import {
  PREVIEW_SANDBOX,
  PREVIEW_SANDBOX_NOTE,
  sandboxedDocument,
} from "@/features/runs/lib/filePreview";

export function HtmlPreview({ html, path }: { html: string; path: string }) {
  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="files-viewer-html"
    >
      <p
        className="shrink-0 border-b border-border/60 px-2 py-1 text-2xs text-muted-foreground"
        data-testid="files-preview-sandbox-note"
      >
        {PREVIEW_SANDBOX_NOTE}
      </p>
      {/* **`bg-white` and not a theme token.** The frame is the page's own
          canvas, and a page written against a browser's default was written
          against white: painting the app's dark surface behind it would make
          every page with dark text unreadable and would be this pane putting
          its own theme on someone else's work. The note above is the app's
          surface and is measured against it; this is the page's. */}
      <iframe
        className="min-h-0 w-full flex-1 border-0 bg-white"
        data-testid="files-viewer-html-frame"
        // Belt: the frame is not asked to send one, and with `connect-src
        // 'none'` there is no request left to attach it to.
        referrerPolicy="no-referrer"
        // The empty string is every restriction ON. See `PREVIEW_SANDBOX`.
        sandbox={PREVIEW_SANDBOX}
        srcDoc={sandboxedDocument(html)}
        title={`${path}, rendered in a sandbox`}
      />
    </div>
  );
}
