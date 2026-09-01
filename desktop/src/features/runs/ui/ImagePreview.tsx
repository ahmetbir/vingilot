// A picture in a worktree, LOOKED at
// (owner ask: "html gosterme, dizayn gosterme, artifact gosterme vs hepsi
// olsun"; which files are pictures and where their pixels come from is
// `filePreview.ts`).
//
// **Everything here goes through an `<img>`, and that is the security half of
// the feature.** An `.svg` is a script vector as well as a picture — `<script>`,
// `onload`, `<foreignObject>` — and all of it goes inert the moment the SVG is
// the `src` of an image element: an image document runs no script and fetches no
// subresource. The alternative, inlining the same bytes into this app's DOM,
// would run every one of them with the app's own privileges. So there is no
// path in this file that produces markup, only a `data:` URL and an `<img>`.
//
// **Two sources, one picture.** An `.svg` is text the viewer already holds, so
// it draws with no second read at all; a `.png` is bytes nobody has read, so it
// asks `file_bytes` in an effect and shows the file's own name while it waits.
// Neither path does work on the main thread beyond building a string — the
// decode is the image pipeline's, off this thread, which is what keeps a 3 MiB
// screenshot from being felt in the terminal one pane over.
//
// **A picture that does not arrive says which way it failed.** The read's three
// refusals are `filesRefusal`'s words (too large with its numbers, gone away,
// the filesystem's own complaint); a decode that turns the bytes down is a
// fourth and different failure with its own sentence (`pictureRefusal`), because
// "could not be read" would name the wrong thing about a file that read fine.

import * as React from "react";

import {
  bytesImageSource,
  type FileRendering,
  pictureRefusal,
  textImageSource,
} from "@/features/runs/lib/filePreview";
import {
  type FileBytesValue,
  readFileBytes,
} from "@/features/runs/lib/filesClient";
import { type FilesError, filesRefusal } from "@/features/runs/lib/filesModel";

/** The words a refusal is shown in, wherever it comes from. The same
 * `p.text-xs` `FileViewer` gives `filesRefusal` so the two cannot drift into
 * looking like different kinds of news. */
function PreviewRefusal({ sentence }: { sentence: string }) {
  return (
    <p
      className="p-3 text-xs text-foreground"
      data-testid="files-preview-refusal"
    >
      {sentence}
    </p>
  );
}

/** The picture and its one refusal, sharing a box so the pane's geometry does
 * not jump between them.
 *
 * `object-contain` inside a scrolling box: a screenshot wider than the pane is
 * shrunk to fit rather than clipped, because the first thing he wants from a
 * picture is its shape. No checkerboard is drawn behind it — a transparent PNG
 * on the pane's own surface is what it will look like in this app, and
 * inventing a second ground would be this pane guessing at one the file does
 * not have.
 *
 * The decode failure is the one thing only the element can report: the bytes
 * arrived whole and WebKit turned them down, which no read could have
 * predicted. */
function PictureBody({
  mime,
  path,
  source,
}: {
  mime: string;
  path: string;
  source: string;
}) {
  const [broken, setBroken] = React.useState(false);
  // A new source is a new picture: a failure that outlived the file it was
  // about would refuse the next one for the previous one's reason.
  const [seen, setSeen] = React.useState(source);
  if (seen !== source) {
    setSeen(source);
    setBroken(false);
  }
  if (broken) {
    return <PreviewRefusal sentence={pictureRefusal(path, mime)} />;
  }
  return (
    <div
      className="flex h-full items-center justify-center overflow-auto p-3"
      data-testid="files-viewer-picture"
    >
      <img
        alt={path}
        className="max-h-full max-w-full object-contain"
        data-testid="files-viewer-image"
        onError={() => setBroken(true)}
        src={source}
      />
    </div>
  );
}

/** A picture the viewer already holds as text — an `.svg`, drawn from the very
 * buffer the source view is showing, so the two halves of the toggle can never
 * disagree about what is in the file. */
export function TextImagePreview({
  mime,
  path,
  text,
}: {
  mime: string;
  path: string;
  text: string;
}) {
  return (
    <PictureBody mime={mime} path={path} source={textImageSource(mime, text)} />
  );
}

type Bytes =
  | { status: "reading" }
  | { status: "read"; value: FileBytesValue }
  | { status: "refused"; error: FilesError };

/** A picture that has to be read first.
 *
 * The read discipline is `ViewTabSurface`'s `FileView`, kept: the effect is
 * cancelled on the way out and the answer is dropped unless it names the path
 * that is still open, so a fast walk through a directory of screenshots cannot
 * land an older picture under a newer name. */
export function BytesImagePreview({
  cwd,
  mime,
  path,
}: {
  cwd: string;
  mime: string;
  path: string;
}) {
  const [state, setState] = React.useState<Bytes>({ status: "reading" });
  React.useEffect(() => {
    let alive = true;
    setState({ status: "reading" });
    void readFileBytes(cwd, path).then((answered) => {
      if (!alive) return;
      setState(
        answered.ok
          ? { status: "read", value: answered.value }
          : { error: answered.error, status: "refused" },
      );
    });
    return () => {
      alive = false;
    };
  }, [cwd, path]);

  if (state.status === "reading") {
    // The same sentence the text read shows while it waits, so a slow disk
    // looks the same whichever half of the viewer is up — and never a spinner
    // with no end, which is the one thing a wait must not be.
    return (
      <p
        className="p-3 text-xs text-muted-foreground"
        data-testid="files-viewer-reading"
      >
        reading {path}…
      </p>
    );
  }
  if (state.status === "refused") {
    return <PreviewRefusal sentence={filesRefusal(state.error)} />;
  }
  return (
    <PictureBody
      mime={mime}
      path={path}
      source={bytesImageSource(mime, state.value.base64)}
    />
  );
}

/** Whichever of the two a rendering asks for. `text` is the viewer's buffer and
 * is only read for the `"text"` source — a raster file has no text and the
 * viewer never has one to give. */
export function ImagePreview({
  cwd,
  path,
  rendering,
  text,
}: {
  cwd: string;
  path: string;
  rendering: Extract<FileRendering, { look: "image" }>;
  text: string | null;
}) {
  if (rendering.from === "bytes" || text === null) {
    return <BytesImagePreview cwd={cwd} mime={rendering.mime} path={path} />;
  }
  return <TextImagePreview mime={rendering.mime} path={path} text={text} />;
}
