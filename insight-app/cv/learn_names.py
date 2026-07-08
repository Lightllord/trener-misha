"""
Collect hero name templates for player panel detection.

Heroes are stepped through in alphabetical order — no typing required.
Press the capture hotkey while the hero's panel is visible, then confirm
or skip in the preview window.

Usage:
    python learn_names.py [--monitor N] [--hotkey KEY]

Preview window controls:
    Enter  — save template for current hero, advance to next
    Space  — skip (no save), advance to next
    B      — go back one hero
    Q      — quit
"""

import argparse
import sys
import time
from pathlib import Path

import cv2
import keyboard
import numpy as np

from detect_players import (
    FRAME_SEARCH_X0,
    FRAME_SEARCH_X1,
    INNATE_SEARCH_X0,
    INNATE_SEARCH_X1,
    capture_screen,
    crop,
    derive_regions,
    find_template_multiscale,
    load_template,
    to_gray,
)
from player_regions import INNATE_THRESHOLD, FRAME_THRESHOLD

SCRIPT_DIR    = Path(__file__).parent
ICONS_DIR     = SCRIPT_DIR / "icons"
NAME_TMPL_DIR = SCRIPT_DIR / "name_templates"

DEBOUNCE_S = 0.5


# ── hero list ─────────────────────────────────────────────────────────────────

def load_hero_list() -> list[str]:
    if not ICONS_DIR.exists():
        print("icons/ not found — run npm run download-icons first.", file=sys.stderr)
        sys.exit(1)
    heroes = sorted(p.stem for p in ICONS_DIR.glob("*.png"))
    if not heroes:
        print("No icons found in icons/.", file=sys.stderr)
        sys.exit(1)
    return heroes


# ── preprocessing ─────────────────────────────────────────────────────────────

def preprocess_name(img: np.ndarray) -> np.ndarray:
    hsv        = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    white_mask = cv2.inRange(hsv, np.array([  0,   0, 220]), np.array([180,  20, 255]))
    fill       = white_mask
    kernel     = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    return cv2.bitwise_not(cv2.dilate(fill, kernel, iterations=1))


# ── detection ─────────────────────────────────────────────────────────────────

def detect_name_region(monitor_num: int) -> np.ndarray | None:
    innate_tmpl = load_template("innate_frame")
    frame_tmpl  = load_template("panel_frame")
    if innate_tmpl is None or frame_tmpl is None:
        print("Templates missing — run calibrate_player.py first.", file=sys.stderr)
        return None

    screen, _sw, _sh = capture_screen(monitor_num)
    innate = find_template_multiscale(screen, innate_tmpl, INNATE_THRESHOLD, INNATE_SEARCH_X0, INNATE_SEARCH_X1)
    if innate is None:
        print("  Innate icon not found.", file=sys.stderr)
        return None
    frame = find_template_multiscale(screen, frame_tmpl, FRAME_THRESHOLD, FRAME_SEARCH_X0, FRAME_SEARCH_X1)
    if frame is None:
        print("  Panel frame not found.", file=sys.stderr)
        return None

    raw = crop(screen, *derive_regions(innate, frame)["name"])
    return raw if raw.size > 0 else None


# ── preview window ─────────────────────────────────────────────────────────────

SCALE = 6   # upscale factor for preview

def build_preview(raw: np.ndarray, processed: np.ndarray, hero: str, saved: bool) -> np.ndarray:
    h = max(raw.shape[0], processed.shape[0])
    raw_up  = cv2.resize(raw, (raw.shape[1] * SCALE, h * SCALE), interpolation=cv2.INTER_NEAREST)
    proc_bgr = cv2.cvtColor(processed, cv2.COLOR_GRAY2BGR)
    proc_up  = cv2.resize(proc_bgr, (proc_bgr.shape[1] * SCALE, h * SCALE), interpolation=cv2.INTER_NEAREST)
    div      = np.full((h * SCALE, 4, 3), 80, dtype=np.uint8)
    preview  = np.hstack([raw_up, div, proc_up])

    # status bar below
    bar_h  = 28
    bar    = np.zeros((bar_h, preview.shape[1], 3), dtype=np.uint8)
    marker = " [saved]" if saved else ""
    label  = f"{hero}{marker}   Enter=save  Space=skip  B=back  Q=quit"
    color  = (100, 255, 100) if saved else (255, 255, 255)
    cv2.putText(bar, label, (6, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.50, color, 1, cv2.LINE_AA)
    return np.vstack([preview, bar])


def show_preview_and_wait(
    raw: np.ndarray,
    hero: str,
    already_saved: bool,
) -> str:
    """Show preview. Returns 'save', 'skip', 'back', or 'quit'."""
    processed = preprocess_name(raw)
    win = "learn_names"
    cv2.namedWindow(win, cv2.WINDOW_AUTOSIZE)

    while True:
        frame = build_preview(raw, processed, hero, already_saved)
        cv2.imshow(win, frame)
        key = cv2.waitKey(50) & 0xFF
        if key in (13, 10):          # Enter
            cv2.destroyWindow(win)
            return "save"
        elif key == ord(" "):
            cv2.destroyWindow(win)
            return "skip"
        elif key in (ord("b"), ord("B")):
            cv2.destroyWindow(win)
            return "back"
        elif key in (ord("q"), ord("Q"), 27):
            cv2.destroyWindow(win)
            return "quit"


# ── main loop ─────────────────────────────────────────────────────────────────

def run(monitor_num: int, hotkey: str) -> None:
    heroes     = load_hero_list()
    total      = len(heroes)
    NAME_TMPL_DIR.mkdir(exist_ok=True)

    # Start from the first hero that has no template yet
    idx = 0
    for i, h in enumerate(heroes):
        if not (NAME_TMPL_DIR / f"{h}.png").exists():
            idx = i
            break

    saved_count = sum(1 for h in heroes if (NAME_TMPL_DIR / f"{h}.png").exists())
    print(f"\n{saved_count}/{total} templates already saved.")
    print(f"Starting at: {heroes[idx]}  (#{idx + 1})")
    print(f"Press [{hotkey}] while a hero panel is visible.\n")

    last_trigger = 0.0
    pending: np.ndarray | None = None

    def on_hotkey() -> None:
        nonlocal last_trigger, pending
        now = time.time()
        if now - last_trigger < DEBOUNCE_S:
            return
        last_trigger = now
        print(f"Capturing for: {heroes[idx]} ...", end=" ", flush=True)
        raw = detect_name_region(monitor_num)
        if raw is None:
            print("failed.")
            return
        print("OK")
        pending = raw

    keyboard.add_hotkey(hotkey, on_hotkey)

    prev_idx = -1
    try:
        while 0 <= idx < total:
            if idx != prev_idx:
                saved_marker = "  [already saved]" if (NAME_TMPL_DIR / f"{heroes[idx]}.png").exists() else ""
                print(f"\n>>> [{idx + 1}/{total}] {heroes[idx]}{saved_marker}  — press [{hotkey}]")
                prev_idx = idx

            if pending is None:
                cv2.waitKey(50)
                continue

            raw     = pending
            pending = None
            hero    = heroes[idx]
            saved   = (NAME_TMPL_DIR / f"{hero}.png").exists()

            action = show_preview_and_wait(raw, hero, saved)

            if action == "save":
                proc = preprocess_name(raw)
                cv2.imwrite(str(NAME_TMPL_DIR / f"{hero}.png"), proc)
                print(f"  Saved: {hero}.png  ({idx + 1}/{total})")
                idx += 1
            elif action == "skip":
                print(f"  Skipped: {hero}")
                idx += 1
            elif action == "back":
                idx = max(0, idx - 1)
                print(f"  Back to: {heroes[idx]}")
            elif action == "quit":
                break

    except KeyboardInterrupt:
        pass
    finally:
        keyboard.unhook_all()
        cv2.destroyAllWindows()

    done = sum(1 for h in heroes if (NAME_TMPL_DIR / f"{h}.png").exists())
    print(f"\nDone. {done}/{total} templates saved.")


def main() -> None:
    import ctypes
    parser = argparse.ArgumentParser()
    parser.add_argument("--monitor", type=int, default=2)
    user32  = ctypes.WinDLL("user32", use_last_error=True)
    lang_id = user32.GetKeyboardLayout(0) & 0xFFFF
    parser.add_argument("--hotkey", default="~" if lang_id == 0x409 else "ё")
    args = parser.parse_args()
    run(args.monitor, args.hotkey)


if __name__ == "__main__":
    main()
