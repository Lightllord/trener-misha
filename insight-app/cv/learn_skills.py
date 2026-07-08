"""
Collect hero skill-1 icon templates for player panel detection.

Heroes are stepped through in alphabetical order — no typing required.
Press the capture hotkey while the hero's panel is visible: the skill-1
icon is captured, saved, and the next hero is selected automatically.

Saved icons go to skill_templates/variants/ as {hero}_v1.png, {hero}_v2.png, ...
When run with --hero, the script stays on that single hero instead of
advancing, so repeated hotkey presses add further numbered variants (e.g.
for facet/shard icon variations) without overwriting earlier captures.

Usage:
    python learn_skills.py [--monitor N] [--hotkey KEY] [--hero NAME]

Controls:
    hotkey (~ / ё)  — capture + save; advances to next hero unless --hero was given
    B               — go back one hero (focus the preview window)
    Q               — quit
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

SCRIPT_DIR     = Path(__file__).parent
ICONS_DIR      = SCRIPT_DIR / "icons_original"
SKILL_TMPL_DIR = SCRIPT_DIR / "skill_templates" / "variants"

DEBOUNCE_S = 0.5


# ── hero list ─────────────────────────────────────────────────────────────────

def load_hero_list() -> list[str]:
    if not ICONS_DIR.exists():
        print(f"{ICONS_DIR} not found.", file=sys.stderr)
        sys.exit(1)
    heroes = sorted(p.stem for p in ICONS_DIR.glob("*.png"))
    if not heroes:
        print(f"No icons found in {ICONS_DIR}.", file=sys.stderr)
        sys.exit(1)
    return heroes


# ── variant naming ────────────────────────────────────────────────────────────

def has_variant(hero: str) -> bool:
    return any(SKILL_TMPL_DIR.glob(f"{hero}_v*.png"))


def next_variant_path(hero: str) -> Path:
    nums = []
    for p in SKILL_TMPL_DIR.glob(f"{hero}_v*.png"):
        try:
            nums.append(int(p.stem.rsplit("_v", 1)[1]))
        except (ValueError, IndexError):
            pass
    return SKILL_TMPL_DIR / f"{hero}_v{max(nums, default=0) + 1}.png"


# ── detection ─────────────────────────────────────────────────────────────────

def detect_skill_region(monitor_num: int) -> np.ndarray | None:
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

    raw = crop(screen, *derive_regions(innate, frame)["skill_1"])
    return raw if raw.size > 0 else None


# ── preview window ─────────────────────────────────────────────────────────────

SCALE = 6   # upscale factor for preview

def build_preview(raw: np.ndarray, processed: np.ndarray, hero: str, saved_name: str | None) -> np.ndarray:
    h = max(raw.shape[0], processed.shape[0])
    raw_up   = cv2.resize(raw, (raw.shape[1] * SCALE, h * SCALE), interpolation=cv2.INTER_NEAREST)
    proc_bgr = cv2.cvtColor(processed, cv2.COLOR_GRAY2BGR)
    proc_up  = cv2.resize(proc_bgr, (proc_bgr.shape[1] * SCALE, h * SCALE), interpolation=cv2.INTER_NEAREST)
    div      = np.full((h * SCALE, 4, 3), 80, dtype=np.uint8)
    preview  = np.hstack([raw_up, div, proc_up])

    # status bar below
    bar_h  = 28
    bar    = np.zeros((bar_h, preview.shape[1], 3), dtype=np.uint8)
    marker = f" [saved: {saved_name}]" if saved_name else ""
    label  = f"{hero}{marker}   hotkey=capture+save  B=back  Q=quit"
    color  = (100, 255, 100) if saved_name else (255, 255, 255)
    cv2.putText(bar, label, (6, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.50, color, 1, cv2.LINE_AA)
    return np.vstack([preview, bar])


# ── main loop ─────────────────────────────────────────────────────────────────

def run(monitor_num: int, hotkey: str, hero: str | None = None) -> None:
    heroes = load_hero_list()
    single_hero = hero is not None
    if single_hero:
        if hero not in heroes:
            print(f"Unknown hero '{hero}'. Not found in {ICONS_DIR}.", file=sys.stderr)
            sys.exit(1)
        heroes = [hero]
    total = len(heroes)
    SKILL_TMPL_DIR.mkdir(parents=True, exist_ok=True)

    # Start from the first hero that has no template yet (full-roster mode only)
    idx = 0
    if not single_hero:
        for i, h in enumerate(heroes):
            if not has_variant(h):
                idx = i
                break

    saved_count = sum(1 for h in heroes if has_variant(h))
    print(f"\n{saved_count}/{total} templates already saved.")
    if single_hero:
        print(f"Capturing variants for: {heroes[0]}  — each press adds a new numbered variant")
    else:
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
        raw = detect_skill_region(monitor_num)
        if raw is None:
            print("failed.")
            return
        print("OK")
        pending = raw

    keyboard.add_hotkey(hotkey, on_hotkey)

    win = "learn_skills"
    cv2.namedWindow(win, cv2.WINDOW_AUTOSIZE)

    prev_idx = -1
    try:
        while 0 <= idx < total:
            if idx != prev_idx:
                saved_marker = "  [already saved]" if has_variant(heroes[idx]) else ""
                print(f"\n>>> [{idx + 1}/{total}] {heroes[idx]}{saved_marker}  — press [{hotkey}]")
                prev_idx = idx

            if pending is not None:
                raw       = pending
                pending   = None
                hero_name = heroes[idx]
                out_path  = next_variant_path(hero_name)
                cv2.imwrite(str(out_path), raw)
                print(f"  Saved: {out_path.name}  ({idx + 1}/{total})")
                cv2.imshow(win, build_preview(raw, to_gray(raw), hero_name, out_path.name))
                if not single_hero:
                    idx += 1

            key = cv2.waitKey(50) & 0xFF
            if key in (ord("b"), ord("B")):
                idx = max(0, idx - 1)
                print(f"  Back to: {heroes[idx]}")
            elif key in (ord("q"), ord("Q"), 27):
                break

    except KeyboardInterrupt:
        pass
    finally:
        keyboard.unhook_all()
        cv2.destroyAllWindows()

    done = sum(1 for h in heroes if has_variant(h))
    print(f"\nDone. {done}/{total} templates saved.")


def main() -> None:
    import ctypes
    parser = argparse.ArgumentParser()
    parser.add_argument("--monitor", type=int, default=2)
    user32  = ctypes.WinDLL("user32", use_last_error=True)
    lang_id = user32.GetKeyboardLayout(0) & 0xFFFF
    parser.add_argument("--hotkey", default="~" if lang_id == 0x409 else "ё")
    parser.add_argument("--hero", help="Capture variants only for this hero (icon filename stem); "
                                        "stays on it so repeated presses add numbered variants")
    args = parser.parse_args()
    run(args.monitor, args.hotkey, args.hero)


if __name__ == "__main__":
    main()
