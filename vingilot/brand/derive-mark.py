#!/usr/bin/env python3
"""Derive every Vingilot mark asset from the owner's single source artwork.

The source (`source/mark-source.png`) is a white mark painted over a grey
gradient, with a soft glow around it. Nothing here is hand-cropped: run this
script and the committed outputs reappear byte-for-byte.

Outputs are written straight to the place that consumes them, so there is
exactly one copy of each and no chance of the checked-in asset drifting from
this derivation. Three surfaces, three different jobs:

  desktop/src/features/vingilot-brand/mark.png
      Tight-cropped silhouette, greyscale+alpha (PNG colour type 4). Consumed
      as a CSS `mask-image` over `currentColor`, so the mark takes the theme's
      foreground colour rather than being a white bitmap that disappears on the
      light theme. The grey channel is pinned to white so the file masks
      identically whether a renderer reads alpha or luminance.

  desktop/src-tauri/src/vingilot_brand/tray-mark.gray
      Raw 8-bit alpha, no container, `include_bytes!`-ed by the tray module.
      macOS template images use the alpha channel and discard the colour, so
      the colour channels would be dead weight in the binary.

  desktop/src-tauri/icons/vingilot-source.png
      The square source `tauri icon` expands into every platform size plus
      .icns/.ico. Unlike the other two, an app icon must carry its own
      background — a transparent white mark vanishes against a light Dock or
      Finder row — so this one composes the keyed mark, in white, over the
      owner's gradient remapped dark, inside the macOS rounded-square plate.
      See the ICON_* constants for why each of those three is not cosmetic.

Keying note (this is the whole trick and it is narrow):
the artwork's "white" is not 255. Luminance histogram of the source:

    ...244:927  245:1271  246:1824  247:2908  248:6616
    249:20115  250:31248  251:17989  252:5020  253:1780  254:1659  255:670

The mark body sits at 249-252 and the glow's brightest tail reaches 248, so the
usable gap is about one level wide and KEY_HI has to land inside it.

Both edges of the window are load-bearing, and each fails differently:

  KEY_LO too low   pulls the glow back in. At low alpha a glow is not a glow,
                   it is a grey smudge, and it only shows up on a *light*
                   background. Check that change against light, never dark.

  KEY_HI too high  leaves the body itself semi-transparent, because the body is
                   249-252 rather than a flat 255. At KEY_HI 250.5 that is
                   37,444 partial-alpha pixels against 54,340 opaque ones and
                   the sails render as visible horizontal streaks. At 249 it is
                   10,033 against 80,890 — the partials are then the antialiased
                   outline, which is what they should be.
"""

from __future__ import annotations

import pathlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent
SOURCE = HERE / "source" / "mark-source.png"
MARK_OUT = REPO / "desktop/src/features/vingilot-brand/mark.png"
TRAY_OUT = REPO / "desktop/src-tauri/src/vingilot_brand/tray-mark.gray"
ICON_OUT = REPO / "desktop/src-tauri/icons/vingilot-source.png"

# Luminance window mapped to alpha 0..1. See the keying note above.
KEY_LO = 245.0
KEY_HI = 249.0

# Longest side of the tight-cropped mask. The largest on-screen use is the
# cold-boot gate at 112 logical px (`w-28`), so 384 covers a 2x display with
# room to spare. This asset is fetched on the boot path — do not grow it
# without a surface that actually needs the pixels.
MARK_LONG_EDGE = 384

# Height of the macOS menu-bar template image, in pixels. The menu bar is 22pt
# and renders template images at the display's scale factor, so 44 is 22pt on
# a Retina display — the same budget upstream's 43px-tall bee uses. Below about
# 32 the sails stop separating; that is the floor this number is defending.
TRAY_HEIGHT = 44

# --- App icon geometry -------------------------------------------------------
#
# Apple's macOS icon grid: on a 1024 canvas the rounded square is 824x824,
# centred, with a 185.4 corner radius. Shipping a full-bleed square instead
# makes the icon read as visibly larger than every neighbour in the Dock.
ICON_SIZE = 1024
ICON_PLATE = 824
ICON_CORNER_RADIUS = 185.4

# Longest side of the mark inside the plate, as a fraction of the plate. Sized
# by eye against the 16px render, which is where a too-small mark disappears.
ICON_MARK_FRACTION = 0.72

# The source artwork's background is a mid-grey (luminance ~95-135). White on
# mid-grey is roughly a 3.5:1 contrast ratio, and at 16px in the menu bar it
# collapses into an undifferentiated grey square — measured, not guessed. These
# two values remap that gradient onto a dark plate, keeping the owner's
# top-left-to-bottom-right falloff while buying about 15:1 against white.
ICON_PLATE_DARK = 26.0
ICON_PLATE_LIGHT = 58.0

# Blur radius applied to the plate only (never the mark). See darkened_plate.
PLATE_SMOOTHING_RADIUS = 24

# The source's glow is deliberately dropped from the icon. At 16px it is not a
# glow, it is a halo that eats the gap between the sails.

# Ignore alpha this low when measuring the mark's extent — a stray keyed pixel
# should not push the bounding box outward and shrink the visible mark.
BBOX_ALPHA_FLOOR = 0.05


def luminance_alpha(rgb: np.ndarray) -> np.ndarray:
    """Rec.709 luminance mapped through the key window to 0..1 alpha."""
    y = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    return np.clip((y - KEY_LO) / (KEY_HI - KEY_LO), 0.0, 1.0)


def alpha_bbox(alpha: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(alpha > BBOX_ALPHA_FLOOR)
    if xs.size == 0:
        raise SystemExit(f"{SOURCE}: key produced an empty mark — check KEY_LO/KEY_HI")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def write_mask(alpha: np.ndarray, box: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = box
    cropped = alpha[top:bottom, left:right]
    height, width = cropped.shape
    scale = MARK_LONG_EDGE / max(width, height)
    grey_alpha = np.empty((height, width, 2), dtype=np.uint8)
    grey_alpha[..., 0] = 255
    grey_alpha[..., 1] = np.round(cropped * 255).astype(np.uint8)
    Image.fromarray(grey_alpha).resize(
        (max(1, round(width * scale)), max(1, round(height * scale))),
        Image.LANCZOS,
    ).save(MARK_OUT, optimize=True)


def write_tray_alpha(alpha: np.ndarray, box: tuple[int, int, int, int]) -> None:
    """Raw alpha plane for the menu-bar template image, no PNG container.

    The width is derived from the mark's own aspect ratio rather than fixed, so
    the mark is never stretched; `vingilot_brand::tray_mark_icon` recomputes it
    the same way and asserts the byte count matches.
    """
    left, top, right, bottom = box
    cropped = Image.fromarray(np.round(alpha[top:bottom, left:right] * 255).astype(np.uint8))
    width = round(TRAY_HEIGHT * cropped.width / cropped.height)
    resized = cropped.resize((width, TRAY_HEIGHT), Image.LANCZOS)
    TRAY_OUT.write_bytes(resized.tobytes())


def rounded_rect_alpha(size: int, radius: float, supersample: int = 4) -> Image.Image:
    """Antialiased rounded-square coverage mask, drawn oversized then reduced."""
    big = Image.new("L", (size * supersample, size * supersample), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        (0, 0, size * supersample - 1, size * supersample - 1),
        radius=radius * supersample,
        fill=255,
    )
    return big.resize((size, size), Image.LANCZOS)


def darkened_plate(source: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    """The owner's gradient, centred on the mark and remapped onto a dark plate.

    Only the background gradient is wanted here, so the crop is taken from a
    region wide enough that the mark's own pixels are a minority and the linear
    remap below is driven by the backdrop rather than by the white mark.
    """
    left, top, right, bottom = box
    centre_x = (left + right) / 2
    centre_y = (top + bottom) / 2
    side = min(source.width, source.height)
    half = side / 2
    x0 = min(max(centre_x - half, 0), source.width - side)
    y0 = min(max(centre_y - half, 0), source.height - side)
    crop = source.crop(
        (round(x0), round(y0), round(x0 + side), round(y0 + side))
    ).resize((ICON_PLATE, ICON_PLATE), Image.LANCZOS)

    rgb = np.asarray(crop, dtype=np.float32)
    y = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    # Percentiles, not min/max: the mark and its glow are outliers that would
    # otherwise anchor the top of the range and flatten the gradient.
    lo, hi = np.percentile(y, 5), np.percentile(y, 95)
    span = max(hi - lo, 1.0)
    normalized = np.clip((y - lo) / span, 0.0, 1.0)
    plate = ICON_PLATE_DARK + normalized * (ICON_PLATE_LIGHT - ICON_PLATE_DARK)
    flat = Image.fromarray(np.repeat(plate.round().astype(np.uint8)[..., None], 3, axis=2))
    # The source carries fine horizontal noise that survives the remap and
    # bands once the range is compressed into 32 levels. The plate is a
    # gradient and nothing else, so blurring it away costs no detail.
    return flat.filter(ImageFilter.GaussianBlur(PLATE_SMOOTHING_RADIUS))


def write_icon_source(
    source: Image.Image, alpha: np.ndarray, box: tuple[int, int, int, int]
) -> None:
    left, top, right, bottom = box
    mark = Image.fromarray(
        np.round(alpha[top:bottom, left:right] * 255).astype(np.uint8)
    )
    scale = (ICON_PLATE * ICON_MARK_FRACTION) / max(mark.width, mark.height)
    mark = mark.resize(
        (max(1, round(mark.width * scale)), max(1, round(mark.height * scale))),
        Image.LANCZOS,
    )

    plate = darkened_plate(source, box).convert("RGBA")
    plate.paste(
        Image.new("RGBA", mark.size, (255, 255, 255, 255)),
        ((ICON_PLATE - mark.width) // 2, (ICON_PLATE - mark.height) // 2),
        mark,
    )
    plate.putalpha(rounded_rect_alpha(ICON_PLATE, ICON_CORNER_RADIUS))

    canvas = Image.new("RGBA", (ICON_SIZE, ICON_SIZE), (0, 0, 0, 0))
    offset = (ICON_SIZE - ICON_PLATE) // 2
    canvas.paste(plate, (offset, offset))
    canvas.save(ICON_OUT, optimize=True)


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    alpha = luminance_alpha(np.asarray(source, dtype=np.float32))
    box = alpha_bbox(alpha)
    write_mask(alpha, box)
    write_tray_alpha(alpha, box)
    write_icon_source(source, alpha, box)
    print(f"mark bbox in source: {box}")
    for out in (MARK_OUT, TRAY_OUT, ICON_OUT):
        print(f"wrote {out.relative_to(REPO)} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
