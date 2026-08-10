#!/usr/bin/env python3
"""Derive the Vingilot loading animation from the owner's single source clip.

Companion to derive-mark.py, and the same contract: nothing is hand-cut, run
this script and the committed outputs reappear byte-for-byte. It writes each
output straight to the place that consumes it, so there is one copy of each
and no chance of a checked-in asset drifting from this derivation.

  desktop/src/features/vingilot-brand/mark-animation.png
      The whole loop as one vertical sprite sheet: LOOP_FRAMES cells, each
      CELL_WIDTH wide, stacked top to bottom. Consumed as a CSS `mask-image`
      over `currentColor` whose `mask-position` is stepped by a keyframe
      animation, so the mark takes the theme's foreground colour exactly as
      the static mark does. See vingilot-mark-animation.css for why the
      animation moves the mask rather than the image.

  desktop/src/features/vingilot-brand/mark-animation-poster.png
      Cell 0 alone, same crop and same size, so it registers with the sheet
      pixel for pixel. Inlined into the JS bundle as a data URI: it is what
      the loading gate draws before the sheet has decoded and what it keeps
      drawing if the sheet never arrives, and an asset that cannot fail to
      load is the only kind that can make that promise.

The source's audio track never reaches either of them -- this reads decoded
video frames and nothing else -- and the committed source carries no audio
track to read (see `Audio` below).

Keying note: this clip is white on black, so alpha is luminance and there is
no chroma work to do. What the window is defending against is the h.264
encode, not the artwork. Luminance histogram of a frame, binned:

    0:1.84M   1-8:92k   8-64:16k   64-192:15k   192-246:6k   246+:96k

The ink is the 96k pixels at 246 and above; the black is the 1.84M at 0.
Everything between is ringing and mosquito noise around the edges, and it is
not faint -- the streaks beside the ship in frame 0 reach luminance 148. So
KEY_LO sits at 192, above every noise pixel measured in the clip and below
the ink, and the antialiased edge that the hard key throws away is put back
by the 3.6:1 LANCZOS downscale to CELL_WIDTH. Keying softer than this keeps
the noise: at KEY_LO 128 the keyed bounding box grows from 789x660 to
882x846, which is a mark rendered 12% smaller to make room for pixels nobody
drew.

Loop note: the clip is 121 frames at 24fps but it is not a 5-second loop. Its
own period is 55-56 frames -- the wave sweeps out and back twice -- and
playing all 121 frames on repeat jumps at the wrap, because frame 120 differs
from frame 0 by 5x a single frame's motion. LOOP_START/LOOP_FRAMES/LOOP_STEP
below name the window that does not: the wrap costs 0.43x one frame of motion,
which is less than the step the loop takes anyway.

Audio: the source clip arrived with an AAC track. It is gone from the
committed source, stripped with `ffmpeg -c:v copy -an` so the video bitstream
is untouched -- the 121 decoded frames hash identically before and after. A
splash screen does not make a sound, and the way to be sure of that is for
there to be no sound anywhere in the repository to play.

Requires ffmpeg and ffprobe on PATH.
"""

from __future__ import annotations

import json
import pathlib
import subprocess

import numpy as np
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent
SOURCE = HERE / "source" / "mark-animation-source.mp4"
SHEET_OUT = REPO / "desktop/src/features/vingilot-brand/mark-animation.png"
POSTER_OUT = REPO / "desktop/src/features/vingilot-brand/mark-animation-poster.png"

# Luminance window mapped to alpha 0..1. See the keying note above.
KEY_LO = 192.0
KEY_HI = 246.0

# The loop, in source frames: first frame, how many, and the stride between
# them. 52 + 28*2 spans 56 source frames -- one period of the clip's own
# motion -- sampled every second frame, so the shipped loop runs at 12fps and
# costs half of what 24fps costs. Animating on twos is what hand-drawn
# animation does; the sails here move slowly enough that it reads the same.
LOOP_START = 52
LOOP_FRAMES = 28
LOOP_STEP = 2
SOURCE_FPS = 24

# Width of one cell. The largest on-screen use is the cold-boot gate at 112
# logical px (`w-28`), so this is exactly 2x for a Retina display. Every pixel
# here is paid for LOOP_FRAMES times over, on the boot path -- do not grow it
# without a surface that actually needs it.
CELL_WIDTH = 224

# Alpha levels kept, out of 256. The sheet is one channel and nothing else, so
# its size is set by how many distinct values the edge ramp holds: 16 levels
# instead of 256 is 96 KiB instead of 235 KiB, for a worst-case error of 3% on
# a pixel that is already a partial edge. Fewer than 16 starts to show as
# contour steps on the slowest gradients in the sails.
ALPHA_LEVELS = 16

# Transparent gutter around the crop, in source pixels (~2 cell pixels). A
# sprite sheet is sampled by a mask-position that lands on a fractional device
# pixel at most zoom levels, so a cell whose ink touches its own edge bleeds a
# line of the neighbouring frame. This is the cheapest way to make that
# impossible rather than unlikely.
PAD = 8

# Ignore alpha this low when measuring the mark's extent, exactly as
# derive-mark.py does: one stray keyed pixel should not push the bounding box
# outward and shrink the visible mark.
BBOX_ALPHA_FLOOR = 0.05


def source_size() -> tuple[int, int]:
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "json", str(SOURCE)],
        check=True, capture_output=True, text=True,
    )
    stream = json.loads(probe.stdout)["streams"][0]
    return int(stream["width"]), int(stream["height"])


def loop_frames() -> np.ndarray:
    """The loop's frames, keyed to alpha, as uint8 at source resolution.

    Frames are read from ffmpeg's stdout rather than through a directory of
    extracted PNGs: the whole clip is 750 MB of raw RGB, and only the frames
    the loop actually uses are ever held.
    """
    width, height = source_size()
    last = LOOP_START + (LOOP_FRAMES - 1) * LOOP_STEP
    select = (
        f"select='between(n\\,{LOOP_START}\\,{last})"
        f"*not(mod(n-{LOOP_START}\\,{LOOP_STEP}))'"
    )
    decode = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", str(SOURCE), "-an", "-vf", select,
         "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE,
    )
    frame_bytes = width * height * 3
    keyed = np.empty((LOOP_FRAMES, height, width), dtype=np.uint8)
    with decode.stdout as stream:
        for i in range(LOOP_FRAMES):
            raw = stream.read(frame_bytes)
            if len(raw) != frame_bytes:
                raise SystemExit(
                    f"{SOURCE}: ffmpeg gave {i} frames, expected {LOOP_FRAMES}"
                )
            rgb = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3).astype(np.float32)
            y = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
            alpha = np.clip((y - KEY_LO) / (KEY_HI - KEY_LO), 0.0, 1.0)
            keyed[i] = np.round(alpha * 255).astype(np.uint8)
    if decode.wait() != 0:
        raise SystemExit(f"{SOURCE}: ffmpeg exited {decode.returncode}")
    return keyed


def alpha_bbox(keyed: np.ndarray) -> tuple[int, int, int, int]:
    """The union of every loop frame's extent, padded by PAD on each side."""
    floor = round(BBOX_ALPHA_FLOOR * 255)
    ys, xs = np.nonzero(keyed.max(axis=0) > floor)
    if xs.size == 0:
        raise SystemExit(f"{SOURCE}: key produced an empty mark — check KEY_LO/KEY_HI")
    height, width = keyed.shape[1:]
    return (
        max(int(xs.min()) - PAD, 0),
        max(int(ys.min()) - PAD, 0),
        min(int(xs.max()) + 1 + PAD, width),
        min(int(ys.max()) + 1 + PAD, height),
    )


def quantize(cell: np.ndarray) -> np.ndarray:
    step = 255 / (ALPHA_LEVELS - 1)
    return np.round(np.round(cell / step) * step).astype(np.uint8)


def write_alpha_png(alpha: np.ndarray, path: pathlib.Path) -> None:
    """An alpha-only PNG, written as a palette of one colour with per-entry alpha.

    The mask's colour channels carry nothing -- `currentColor` supplies the
    colour -- so the file holds one index per pixel into a palette that is
    white at every entry and differs only in its tRNS alpha. That is half the
    bytes of the greyscale+alpha form the static mark uses (a 45 KiB asset
    there, LOOP_FRAMES cells here), and identical to a renderer.
    """
    values = sorted(set(np.unique(alpha).tolist()))
    lut = np.zeros(256, dtype=np.uint8)
    for index, value in enumerate(values):
        lut[value] = index
    image = Image.fromarray(lut[alpha]).convert("P")
    image.putpalette([255, 255, 255] * 256)
    image.save(
        path,
        optimize=True,
        transparency=bytes(values) + bytes(256 - len(values)),
    )


def main() -> None:
    keyed = loop_frames()
    left, top, right, bottom = alpha_bbox(keyed)
    cell_height = round(CELL_WIDTH * (bottom - top) / (right - left))

    cells = []
    for frame in keyed:
        cropped = Image.fromarray(frame[top:bottom, left:right])
        cells.append(quantize(np.asarray(
            cropped.resize((CELL_WIDTH, cell_height), Image.LANCZOS), dtype=np.float32
        )))

    sheet = np.concatenate(cells, axis=0)
    write_alpha_png(sheet, SHEET_OUT)
    write_alpha_png(cells[0], POSTER_OUT)

    duration_ms = round(1000 * LOOP_FRAMES * LOOP_STEP / SOURCE_FPS)
    print(f"crop in source: ({left}, {top}, {right}, {bottom})")
    print(f"cell: {CELL_WIDTH}x{cell_height}   frames: {LOOP_FRAMES}   loop: {duration_ms}ms")
    for out in (SHEET_OUT, POSTER_OUT):
        print(f"wrote {out.relative_to(REPO)} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
