"""
Collect hero level templates for player panel detection.

Steps through levels 1-30 in order — no typing required.
Press the capture hotkey while the hero panel shows the target level,
then confirm or skip in the preview window.

Usage:
    python learn_levels.py [--monitor N] [--hotkey KEY]

Preview window controls:
    Enter  — save template for current level, advance to next
    Space  — skip (no save), advance to next
    B      — go back one level
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


def preprocess_level(img: np.ndarray) -> np.ndarray:
    return to_gray(img)

SCRIPT_DIR     = Path(__file__).parent
LEVEL_TMPL_DIR = SCRIPT_DIR / "level_templates"

LEVELS     = list(range(1, 31))
DEBOUNCE_S = 0.5
SCALE      = 8


# ── detection ─────────────────────────────────────────────────────────────────

def detect_level_region(monitor_num: int) -> np.ndarray | None:
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

    raw = crop(screen, *derive_regions(innate, frame)["level"])
    return raw if raw.size > 0 else None


# ── preview ───────────────────────────────────────────────────────────────────

def build_preview(raw: np.ndarray, processed: np.ndarray, level: int, saved: bool) -> np.ndarray:
    h = max(raw.shape[0], processed.shape[0])
    raw_up   = cv2.resize(raw, (raw.shape[1] * SCALE, h * SCALE), interpolation=cv2.INTER_NEAREST)
    proc_bgr = cv2.cvtColor(processed, cv2.COLOR_GRAY2BGR)
    proc_up  = cv2.resize(proc_bgr, (proc_bgr.shape[1] * SCALE, h * SCALE), interpolation=cv2.INTER_NEAREST)
    div      = np.full((h * SCALE, 4, 3), 80, dtype=np.uint8)
    preview  = np.hstack([raw_up, div, proc_up])

    bar_h  = 28
    bar    = np.zeros((bar_h, max(preview.shape[1], 400), 3), dtype=np.uint8)
    marker = "  [saved]" if saved else ""
    label  = f"Level {level}{marker}   Enter=save  Space=skip  B=back  Q=quit"
    color  = (100, 255, 100) if saved else (255, 255, 255)
    cv2.putText(bar, label, (6, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.50, color, 1, cv2.LINE_AA)

    pw = preview.shape[1]
    bw = bar.shape[1]
    if pw < bw:
        preview = np.hstack([preview, np.zeros((preview.shape[0], bw - pw, 3), dtype=np.uint8)])

    return np.vstack([preview, bar])


def show_preview_and_wait(raw: np.ndarray, level: int, already_saved: bool) -> str:
    processed = preprocess_level(raw)
    win = "learn_levels"
    cv2.namedWindow(win, cv2.WINDOW_AUTOSIZE)
    while True:
        cv2.imshow(win, build_preview(raw, processed, level, already_saved))
        key = cv2.waitKey(50) & 0xFF
        if key in (13, 10):
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
    LEVEL_TMPL_DIR.mkdir(exist_ok=True)
    total = len(LEVELS)

    # Start from the first level without a template
    idx = next(
        (i for i, lvl in enumerate(LEVELS) if not (LEVEL_TMPL_DIR / f"{lvl}.png").exists()),
        0,
    )

    saved_count = sum(1 for lvl in LEVELS if (LEVEL_TMPL_DIR / f"{lvl}.png").exists())
    print(f"\n{saved_count}/{total} level templates already saved.")
    print(f"Press [{hotkey}] while a hero panel shows the target level.\n")

    pending: np.ndarray | None = None
    last_trigger = 0.0
    prev_idx = -1

    def on_hotkey() -> None:
        nonlocal last_trigger, pending
        now = time.time()
        if now - last_trigger < DEBOUNCE_S:
            return
        last_trigger = now
        print(f"Capturing level {LEVELS[idx]} ...", end=" ", flush=True)
        raw = detect_level_region(monitor_num)
        if raw is None:
            print("failed.")
            return
        print("OK")
        pending = raw

    keyboard.add_hotkey(hotkey, on_hotkey)

    try:
        while 0 <= idx < total:
            if idx != prev_idx:
                saved_marker = "  [already saved]" if (LEVEL_TMPL_DIR / f"{LEVELS[idx]}.png").exists() else ""
                print(f"\n>>> [{idx + 1}/{total}] Level {LEVELS[idx]}{saved_marker}  — press [{hotkey}]")
                prev_idx = idx

            if pending is None:
                cv2.waitKey(50)
                continue

            raw   = pending
            pending = None
            level = LEVELS[idx]
            cv2.imwrite(str(LEVEL_TMPL_DIR / f"{level}.png"), preprocess_level(raw))
            print(f"  Saved: {level}.png  ({idx + 1}/{total})")
            idx += 1

    except KeyboardInterrupt:
        pass
    finally:
        keyboard.unhook_all()
        cv2.destroyAllWindows()

    done = sum(1 for lvl in LEVELS if (LEVEL_TMPL_DIR / f"{lvl}.png").exists())
    print(f"\nDone. {done}/{total} level templates saved.")


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
