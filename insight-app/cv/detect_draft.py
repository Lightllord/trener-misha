"""
Dota 2 draft detection via screen capture and template matching.

Captures the screen, locates hero portrait slots in the draft UI,
and identifies heroes using OpenCV template matching against icon templates.

Usage:
    python detect_draft.py               # Primary monitor, JSON to stdout
    python detect_draft.py --monitor 2   # Capture monitor #2
    python detect_draft.py --debug       # Save annotated debug images to cv/debug/

Output JSON format:
{
    "radiant": ["antimage", "crystal_maiden", ...],
    "dire": ["axe", "drow_ranger", ...],
    "confidence": [0.92, 0.88, ...]
}
"""

import argparse
import json
import os
import sys
from pathlib import Path
import ctypes

import time
import cv2
import numpy as np
import mss

from regions import DRAFT_REGIONS, TEMPLATE_SIZE, CONFIDENCE_THRESHOLD

SCRIPT_DIR = Path(__file__).parent
RADIANT_ICONS_DIR = SCRIPT_DIR / "icons_radiant"
DIRE_ICONS_DIR = SCRIPT_DIR / "icons_dire"
DEBUG_DIR = SCRIPT_DIR / "debug"


def to_gray(img: np.ndarray) -> np.ndarray:
    """Convert BGR image to grayscale."""
    if len(img.shape) == 2:
        return img
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def load_templates(icons_dir: Path) -> dict[str, list[np.ndarray]]:
    """Load hero icon templates from icons_dir, including arcana/persona variants.

    Default icons from icons_dir/ plus variants from icons_dir/variants/.
    Variant filenames: {heroname}_v1.png, {heroname}_v2.png, etc.
    Returns dict mapping hero_name -> list of grayscale templates.
    """
    templates: dict[str, list[np.ndarray]] = {}
    if not icons_dir.exists():
        print(f"Error: {icons_dir.name}/ not found.", file=sys.stderr)
        sys.exit(1)

    icon_files = list(icons_dir.glob("*.png"))
    if not icon_files:
        print(f"Error: No icon files found in {icons_dir.name}/.", file=sys.stderr)
        sys.exit(1)

    # Load default icons
    for icon_path in icon_files:
        hero_name = icon_path.stem
        img = cv2.imread(str(icon_path))
        if img is None:
            continue
        templates[hero_name] = [to_gray(img)]

    # Load variants (arcanas, personas)
    variant_count = 0
    variants_dir = icons_dir / "variants"
    if variants_dir.exists():
        for vpath in variants_dir.glob("*.png"):
            # Parse hero name: "phantom_assassin_v1.png" -> "phantom_assassin"
            stem = vpath.stem
            hero_name = stem.rsplit("_v", 1)[0]
            img = cv2.imread(str(vpath))
            if img is None:
                continue
            if hero_name not in templates:
                templates[hero_name] = []
            templates[hero_name].append(to_gray(img))
            variant_count += 1

    total = sum(len(v) for v in templates.values())
    print(f"Loaded {total} templates from {icons_dir.name}/ "
          f"({len(templates)} heroes, {variant_count} variants)", file=sys.stderr)
    return templates


def capture_screen(monitor_num: int = 1) -> np.ndarray:
    """Capture a specific monitor screen as a BGR numpy array.

    Args:
        monitor_num: Monitor index (1 = primary, 2 = second, etc.)
                     Use 0 to capture all monitors combined.
    """
    with mss.mss() as sct:
        if monitor_num >= len(sct.monitors):
            available = len(sct.monitors) - 1
            print(f"Monitor {monitor_num} not found. Available: 1-{available}", file=sys.stderr)
            print("Monitors:", file=sys.stderr)
            for i, m in enumerate(sct.monitors[1:], 1):
                print(f"  {i}: {m['width']}x{m['height']} at ({m['left']}, {m['top']})", file=sys.stderr)
            sys.exit(1)

        monitor = sct.monitors[monitor_num]
        print(f"Capturing monitor {monitor_num}: {monitor['width']}x{monitor['height']}", file=sys.stderr)
        screenshot = sct.grab(monitor)
        # Convert BGRA to BGR (OpenCV format)
        img = np.array(screenshot)
        return cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)


def extract_slots(screen: np.ndarray, region: dict) -> list[np.ndarray]:
    """Extract individual hero portrait slots from a region as grayscale.

    Supports individually defined slots (list of {x_start, y_start, x_end, y_end}).
    """
    h, w = screen.shape[:2]
    slots = []

    for slot_def in region["slots"]:
        x_start = int(slot_def["x_start"] * w)
        y_start = int(slot_def["y_start"] * h)
        x_end = int(slot_def["x_end"] * w)
        y_end = int(slot_def["y_end"] * h)
        slot = screen[y_start:y_end, x_start:x_end]
        slots.append(to_gray(slot))

    return slots


def match_hero(slot: np.ndarray, templates: dict[str, list[np.ndarray]]) -> tuple[str, float]:
    """Match a slot against all templates.

    Templates are grayscale (converted at load time) and resized to the slot
    size for comparison; no further processing is applied.
    """
    best_name = "unknown"
    best_score = 0.0
    slot_h, slot_w = slot.shape[:2]

    for hero_name, hero_templates in templates.items():
        for template in hero_templates:
            resized = cv2.resize(template, (slot_w, slot_h), interpolation=cv2.INTER_AREA)
            result = cv2.matchTemplate(slot, resized, cv2.TM_CCOEFF_NORMED)
            _, max_val, _, _ = cv2.minMaxLoc(result)

            if max_val > best_score:
                best_score = max_val
                best_name = hero_name

    if best_score < CONFIDENCE_THRESHOLD:
        return "unknown", best_score

    return best_name, best_score


def save_debug_images(screen: np.ndarray) -> None:
    """Save annotated debug images for calibration and verification."""
    DEBUG_DIR.mkdir(exist_ok=True)

    # Save full screenshot
    cv2.imwrite(str(DEBUG_DIR / "screenshot.png"), screen)

    # Save annotated screenshot with region rectangles
    annotated = screen.copy()
    h, w = screen.shape[:2]

    for team, region in DRAFT_REGIONS.items():
        color = (0, 255, 0) if "radiant" in team else (0, 0, 255)
        for slot_def in region["slots"]:
            x_start = int(slot_def["x_start"] * w)
            y_start = int(slot_def["y_start"] * h)
            x_end = int(slot_def["x_end"] * w)
            y_end = int(slot_def["y_end"] * h)
            cv2.rectangle(annotated, (x_start, y_start), (x_end, y_end), color, 2)

    cv2.imwrite(str(DEBUG_DIR / "annotated.png"), annotated)

    # Save each slot as the raw color crop straight from the screen, before any
    # grayscale / resize processing.
    for team, region in DRAFT_REGIONS.items():
        name = "radiant" if "radiant" in team else "dire"
        for i, slot_def in enumerate(region["slots"]):
            x_start = int(slot_def["x_start"] * w)
            y_start = int(slot_def["y_start"] * h)
            x_end = int(slot_def["x_end"] * w)
            y_end = int(slot_def["y_end"] * h)
            crop = screen[y_start:y_end, x_start:x_end]
            cv2.imwrite(str(DEBUG_DIR / f"{name}_slot_{i}.png"), crop)

    print(f"Debug images saved to {DEBUG_DIR}", file=sys.stderr)


def detect_draft(monitor_num: int = 1, debug: bool = False) -> dict:
    """Main detection pipeline: capture screen, match heroes, return results."""
    radiant_templates = load_templates(RADIANT_ICONS_DIR)
    dire_templates = load_templates(DIRE_ICONS_DIR)

    screen = capture_screen(monitor_num)
    print(f"Screen captured: {screen.shape[1]}x{screen.shape[0]}", file=sys.stderr)

    radiant_region = DRAFT_REGIONS["radiant_picks"]
    dire_region = DRAFT_REGIONS["dire_picks"]

    radiant_slots = extract_slots(screen, radiant_region)
    dire_slots = extract_slots(screen, dire_region)

    radiant_results = [match_hero(slot, radiant_templates) for slot in radiant_slots]
    dire_results = [match_hero(slot, dire_templates) for slot in dire_slots]

    if debug:
        save_debug_images(screen)

    radiant_names = [name for name, _ in radiant_results]
    dire_names = [name for name, _ in dire_results]
    all_confidence = [conf for _, conf in radiant_results] + [conf for _, conf in dire_results]

    return {
        "radiant": radiant_names,
        "dire": dire_names,
        "confidence": [round(c, 4) for c in all_confidence],
    }


def print_draft_result(result: dict) -> None:
    """Pretty-print draft detection result to stderr."""
    print("\n--- Draft detected ---", file=sys.stderr)
    print("Radiant:", file=sys.stderr)
    for i, name in enumerate(result["radiant"]):
        conf = result["confidence"][i] * 100
        print(f"  {name:25s} ({conf:.1f}%)", file=sys.stderr)
    print("Dire:", file=sys.stderr)
    for i, name in enumerate(result["dire"]):
        conf = result["confidence"][5 + i] * 100
        print(f"  {name:25s} ({conf:.1f}%)", file=sys.stderr)
    print("---", file=sys.stderr)


def watch_mode(monitor_num: int, debug: bool, hotkey: str) -> None:
    """Watch mode with global hotkey (works outside terminal)."""
    import keyboard

    radiant_templates = load_templates(RADIANT_ICONS_DIR)
    dire_templates = load_templates(DIRE_ICONS_DIR)

    last_trigger = 0
    debounce_delay = 100

    print(f"Press {hotkey} to detect draft... (Ctrl+C to exit)", file=sys.stderr)

    def on_trigger():
        nonlocal last_trigger

        current_time = time.time()
        if current_time - last_trigger < debounce_delay:
            return

        last_trigger = current_time
        print("\nHotkey pressed, detecting...", file=sys.stderr)

        time.sleep(0.5)

        screen = capture_screen(monitor_num)

        radiant_slots = extract_slots(screen, DRAFT_REGIONS["radiant_picks"])
        dire_slots = extract_slots(screen, DRAFT_REGIONS["dire_picks"])

        radiant_results = [match_hero(slot, radiant_templates) for slot in radiant_slots]
        dire_results = [match_hero(slot, dire_templates) for slot in dire_slots]

        if debug:
            save_debug_images(screen)

        result = {
            "radiant": [name for name, _ in radiant_results],
            "dire": [name for name, _ in dire_results],
            "confidence": [round(c, 4) for _, c in radiant_results]
                        + [round(c, 4) for _, c in dire_results],
        }

        print(json.dumps(result))
        print_draft_result(result)

    keyboard.add_hotkey(hotkey, on_trigger)
    keyboard.wait()


def main() -> None:
    parser = argparse.ArgumentParser(description="Detect Dota 2 draft from screen capture")
    parser.add_argument("--monitor", type=int, default=2,
                        help="Monitor number (1=primary, 2=second, etc.)")
    parser.add_argument("--debug", action="store_true", help="Save debug images to cv/debug/")
    parser.add_argument("--watch", action="store_true",
                        help="Watch mode: wait for hotkey and detect on press")
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    layout_id = user32.GetKeyboardLayout(0)
    lang_id = layout_id & 0xFFFF
    if lang_id == 0x409:
        parser.add_argument("--hotkey", type=str, default="~",
                            help="Global hotkey for watch mode (default: `)")
    else:
        parser.add_argument("--hotkey", type=str, default="ё",
                            help="Global hotkey for watch mode (default: `)")
    args = parser.parse_args()

    if args.watch:
        watch_mode(args.monitor, args.debug, args.hotkey)
    else:
        result = detect_draft(monitor_num=args.monitor, debug=args.debug)
        print(json.dumps(result))


if __name__ == "__main__":
    main()
