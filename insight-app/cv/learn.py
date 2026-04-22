"""
Learn hero appearances from the actual game screen.

Captures the top bar, shows each hero slot, and lets you label it.
Saves labeled slots as additional templates for matching.

Usage:
    python learn.py --monitor 2
    python learn.py --monitor 2 --team radiant
    python learn.py --monitor 2 --team dire

Instructions:
    1. Be in a Dota 2 game with heroes visible in the top bar
    2. Run this script
    3. For each slot, type the hero short name (e.g., "phantom_assassin")
    4. Press Enter to skip a slot, or 'q' to quit
    5. Saved templates go to cv/icons/variants/

These variant templates are automatically used by detect_draft.py.
"""

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
import mss

from regions import DRAFT_REGIONS

SCRIPT_DIR = Path(__file__).parent
VARIANTS_DIR = SCRIPT_DIR / "icons" / "variants"


def capture_screen(monitor_num: int = 1) -> np.ndarray:
    """Capture a specific monitor."""
    with mss.mss() as sct:
        if monitor_num >= len(sct.monitors):
            available = len(sct.monitors) - 1
            print(f"Monitor {monitor_num} not found. Available: 1-{available}")
            sys.exit(1)
        monitor = sct.monitors[monitor_num]
        print(f"Captured monitor {monitor_num}: {monitor['width']}x{monitor['height']}")
        screenshot = sct.grab(monitor)
        img = np.array(screenshot)
        return cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)


def extract_slots(screen: np.ndarray, region: dict) -> list[np.ndarray]:
    """Extract hero portrait slots from a region."""
    h, w = screen.shape[:2]
    x_start = int(region["x_start"] * w)
    y_start = int(region["y_start"] * h)
    x_end = int(region["x_end"] * w)
    y_end = int(region["y_end"] * h)

    region_crop = screen[y_start:y_end, x_start:x_end]
    num_slots = region["slots"]
    slot_width = region_crop.shape[1] // num_slots

    slots = []
    for i in range(num_slots):
        slot = region_crop[:, i * slot_width:(i + 1) * slot_width]
        slots.append(slot)
    return slots


def list_existing_variants() -> dict[str, int]:
    """Count existing variant templates per hero."""
    counts: dict[str, int] = {}
    if VARIANTS_DIR.exists():
        for f in VARIANTS_DIR.glob("*.png"):
            # Format: heroname_v1.png, heroname_v2.png, etc.
            name = f.stem.rsplit("_v", 1)[0]
            counts[name] = counts.get(name, 0) + 1
    return counts


def next_variant_num(hero_name: str) -> int:
    """Get next available variant number for a hero."""
    existing = list(VARIANTS_DIR.glob(f"{hero_name}_v*.png"))
    if not existing:
        return 1
    nums = []
    for f in existing:
        try:
            n = int(f.stem.rsplit("_v", 1)[1])
            nums.append(n)
        except (ValueError, IndexError):
            pass
    return max(nums, default=0) + 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Learn hero appearances from game")
    parser.add_argument("--monitor", type=int, default=1,
                        help="Monitor number")
    parser.add_argument("--team", choices=["radiant", "dire", "both"], default="both",
                        help="Which team to label")
    args = parser.parse_args()

    VARIANTS_DIR.mkdir(parents=True, exist_ok=True)

    screen = capture_screen(args.monitor)
    existing = list_existing_variants()

    if existing:
        print(f"\nExisting variant templates: {sum(existing.values())} "
              f"for {len(existing)} heroes")

    teams = []
    if args.team in ("radiant", "both"):
        teams.append(("Radiant", DRAFT_REGIONS["radiant_picks"]))
    if args.team in ("dire", "both"):
        teams.append(("Dire", DRAFT_REGIONS["dire_picks"]))

    print("\nFor each hero slot, type the hero short_name (e.g., phantom_assassin)")
    print("Press Enter to skip, 'q' to quit\n")

    saved = 0
    for team_name, region in teams:
        slots = extract_slots(screen, region)
        print(f"--- {team_name} ---")

        for i, slot in enumerate(slots):
            # Show the slot
            preview = cv2.resize(slot, (256, 144), interpolation=cv2.INTER_LANCZOS4)
            cv2.imshow(f"{team_name} slot {i + 1}", preview)
            cv2.waitKey(100)

            hero_name = input(f"  Slot {i + 1}: ").strip().lower()

            cv2.destroyAllWindows()

            if hero_name == "q":
                print("Quit.")
                if saved > 0:
                    print(f"Saved {saved} variant(s) to {VARIANTS_DIR}")
                return

            if not hero_name:
                print("    Skipped")
                continue

            # Save the slot as a variant template (full color, original size)
            var_num = next_variant_num(hero_name)
            out_path = VARIANTS_DIR / f"{hero_name}_v{var_num}.png"
            cv2.imwrite(str(out_path), slot)
            saved += 1
            print(f"    Saved: {out_path.name}")

    cv2.destroyAllWindows()
    print(f"\nDone! Saved {saved} variant(s) to {VARIANTS_DIR}")


if __name__ == "__main__":
    main()
