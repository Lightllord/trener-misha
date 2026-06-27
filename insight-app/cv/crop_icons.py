"""
Generate per-team hero icon sets from the uncropped originals.

Radiant and Dire portraits are framed differently, so each side is cropped
with its own margins. Crops are proportional: the pixel margins below are
defined for a 256x144 icon and scaled to each file's actual size, so icons of
any resolution (and the variants/) are handled consistently.

Source:  icons_original/  (+ icons_original/variants/)
Outputs: icons_radiant/   (+ icons_radiant/variants/)
         icons_dire/      (+ icons_dire/variants/)

Usage:
    python crop_icons.py                 # regenerate both teams from icons_original/
    python crop_icons.py --src icons_xxx # use a different source folder
"""

import argparse
from pathlib import Path
from typing import NamedTuple

import cv2

SCRIPT_DIR = Path(__file__).parent

# Reference resolution the pixel margins below are measured at.
REF_W, REF_H = 256, 144


class Crop(NamedTuple):
    left: int
    right: int
    bottom: int


# Per-team crop margins (left, right, bottom) at REF_W x REF_H.
TEAM_CROPS: dict[str, Crop] = {
    "icons_radiant": Crop(left=12, right=23, bottom=92),
    "icons_dire":    Crop(left=23, right=11, bottom=92),
}


def crop_image(img, crop: Crop):
    """Proportionally crop one image by margins scaled from REF_W x REF_H."""
    h, w = img.shape[:2]
    sx, sy = w / REF_W, h / REF_H
    left = round(crop.left * sx)
    right = round(crop.right * sx)
    bottom = round(crop.bottom * sy)
    return img[0:h - bottom, left:w - right]


def process_dir(src: Path, dst: Path, crop: Crop) -> int:
    """Replace every *.png in dst with the cropped versions from src.

    Only *.png files are removed (not the directory itself) to avoid Windows
    directory-lock errors. Returns the number of files written.
    """
    dst.mkdir(parents=True, exist_ok=True)
    for stale in dst.glob("*.png"):
        stale.unlink()
    count = 0
    for path in sorted(src.glob("*.png")):
        img = cv2.imread(str(path))
        if img is None:
            print(f"  skipped (unreadable): {path.name}")
            continue
        cv2.imwrite(str(dst / path.name), crop_image(img, crop))
        count += 1
    return count


def generate(src_dir: Path, out_dir: Path, crop: Crop) -> tuple[int, int]:
    """Regenerate out_dir (icons + variants/) from src_dir. Returns (icons, variants)."""
    icons = process_dir(src_dir, out_dir, crop)

    variants = 0
    variants_src = src_dir / "variants"
    if variants_src.exists():
        variants = process_dir(variants_src, out_dir / "variants", crop)
    return icons, variants


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate per-team cropped hero icon sets")
    parser.add_argument("--src", default="icons_original",
                        help="Source folder with uncropped icons (default: icons_original)")
    args = parser.parse_args()

    src_dir = SCRIPT_DIR / args.src
    if not src_dir.exists():
        raise SystemExit(f"Source folder not found: {src_dir}")

    for out_name, crop in TEAM_CROPS.items():
        out_dir = SCRIPT_DIR / out_name
        icons, variants = generate(src_dir, out_dir, crop)
        print(f"{out_name}: {icons} icons + {variants} variants "
              f"(crop L{crop.left} R{crop.right} B{crop.bottom})")


if __name__ == "__main__":
    main()
