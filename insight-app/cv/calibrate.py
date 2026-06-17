"""
Interactive calibration tool for scoreboard hero slots.

Full calibration (no --slot): click TOP-LEFT and BOTTOM-RIGHT for all 10 heroes.
Single-slot mode: click 2 points for just one slot, rest are preserved.

Usage:
    python calibrate.py                              # Full calibration, primary monitor
    python calibrate.py --monitor 2                  # Full calibration, monitor 2
    python calibrate.py --team radiant --slot 3      # Recalibrate one slot
    python calibrate.py --monitor 2 --team dire --slot 1

Instructions (full):
    1. Open Dota 2 scoreboard (hold Tab)
    2. Run this script
    3. For each hero (Radiant 1-5, then Dire 1-5):
       click TOP-LEFT, then BOTTOM-RIGHT of the portrait
    4. Regions are saved automatically to regions.py

    Press 'r' to reset, 'u' to undo last click, 'q' to quit.
"""

import argparse
import copy
import sys
from pathlib import Path

import cv2
import numpy as np
import mss

from regions import DRAFT_REGIONS

DEBUG_DIR = Path(__file__).parent / "debug"

screen_w = 0
screen_h = 0
clicks: list[tuple[int, int]] = []
scale = 1.0

TEAMS = ["Radiant", "Dire"]
TOTAL_CLICKS = 20


def current_step_label() -> str:
    idx = len(clicks)
    if idx >= TOTAL_CLICKS:
        return "Done! Press 'q' to quit"
    hero_idx = idx // 2
    is_top_left = idx % 2 == 0
    team = TEAMS[hero_idx // 5]
    slot = (hero_idx % 5) + 1
    corner = "TOP-LEFT" if is_top_left else "BOTTOM-RIGHT"
    return f"{corner} of {team} hero {slot}"


def to_original(x: int, y: int) -> tuple[int, int]:
    return int(x / scale), int(y / scale)


def fmt_slots(team_slots: list[dict]) -> str:
    lines = []
    for s in team_slots:
        lines.append(
            f'        {{"x_start": {s["x_start"]:.4f}, "y_start": {s["y_start"]:.4f}, '
            f'"x_end": {s["x_end"]:.4f}, "y_end": {s["y_end"]:.4f}}},'
        )
    return "\n".join(lines)


def write_regions(regions: dict, cal_w: int, cal_h: int) -> None:
    regions_path = Path(__file__).parent / "regions.py"
    content = f'''"""
Draft screen region definitions for Dota 2 scoreboard.

All coordinates are proportional (0.0 - 1.0) relative to screen dimensions.
Calibrated at {cal_w}x{cal_h} resolution.
Re-run `python calibrate.py` to recalibrate.
"""

# Each slot is defined individually for precise calibration
DRAFT_REGIONS = {{
    "radiant_picks": {{
        "slots": [
{fmt_slots(regions["radiant_picks"]["slots"])}
        ],
    }},
    "dire_picks": {{
        "slots": [
{fmt_slots(regions["dire_picks"]["slots"])}
        ],
    }},
}}

# Template size for matching (width x height)
TEMPLATE_SIZE = (63, 37)

# Minimum confidence threshold for a valid match
CONFIDENCE_THRESHOLD = 0.3
'''
    regions_path.write_text(content, encoding="utf-8")
    print(f"\nRegions saved to {regions_path}")


def draw_existing_regions(canvas: np.ndarray) -> None:
    """Draw all current regions on canvas as reference."""
    h, w = canvas.shape[:2]
    for team_key, color in [("radiant_picks", (0, 200, 0)), ("dire_picks", (200, 0, 0))]:
        for i, s in enumerate(DRAFT_REGIONS[team_key]["slots"]):
            x1 = int(s["x_start"] * w)
            y1 = int(s["y_start"] * h)
            x2 = int(s["x_end"] * w)
            y2 = int(s["y_end"] * h)
            cv2.rectangle(canvas, (x1, y1), (x2, y2), color, 1)
            label = f"{'R' if 'radiant' in team_key else 'D'}{i + 1}"
            cv2.putText(canvas, label, (x1 + 2, y1 - 3),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.35, color, 1)


def run_single_slot(img_orig: np.ndarray, team: str, slot_idx: int) -> None:
    """Recalibrate one slot: 2 clicks, update regions.py, keep the rest."""
    global clicks, scale

    team_key = f"{team}_picks"
    team_label = team.capitalize()
    color = (0, 255, 255)  # yellow for the target slot

    max_display_h = 900
    scale = min(1.0, max_display_h / screen_h)
    display_base = cv2.resize(img_orig, None, fx=scale, fy=scale) if scale != 1.0 else img_orig.copy()

    draw_existing_regions(display_base)

    # Highlight the target slot
    h_disp, w_disp = display_base.shape[:2]
    s = DRAFT_REGIONS[team_key]["slots"][slot_idx]
    x1 = int(s["x_start"] * w_disp)
    y1 = int(s["y_start"] * h_disp)
    x2 = int(s["x_end"] * w_disp)
    y2 = int(s["y_end"] * h_disp)
    cv2.rectangle(display_base, (x1, y1), (x2, y2), color, 2)
    cv2.putText(display_base, f"TARGET: {team_label} {slot_idx + 1}",
                (x1 + 2, y1 - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)

    canvas = display_base.copy()
    window_name = f"Calibrate {team_label} slot {slot_idx + 1}"
    cv2.namedWindow(window_name, cv2.WINDOW_AUTOSIZE)

    print(f"\nRecalibrating {team_label} slot {slot_idx + 1}")
    print("Click TOP-LEFT, then BOTTOM-RIGHT of the portrait")
    print("Press 'r' to reset, 'u' to undo, 'q' to quit\n")
    print("  Next: TOP-LEFT")

    def on_mouse(event: int, x: int, y: int, flags: int, param: object) -> None:
        nonlocal canvas

        if event == cv2.EVENT_LBUTTONDOWN:
            if len(clicks) >= 2:
                return

            clicks.append((x, y))
            ox, oy = to_original(x, y)
            corner = "TOP-LEFT" if len(clicks) == 1 else "BOTTOM-RIGHT"
            print(f"  Click {len(clicks)}/2: pixel ({ox}, {oy}) — {corner}")

            cv2.circle(canvas, (x, y), 4, color, -1)

            if len(clicks) == 2:
                cv2.rectangle(canvas, clicks[0], clicks[1], color, 2)

                tl_x, tl_y = to_original(*clicks[0])
                br_x, br_y = to_original(*clicks[1])
                new_slot = {
                    "x_start": tl_x / screen_w,
                    "y_start": tl_y / screen_h,
                    "x_end": br_x / screen_w,
                    "y_end": br_y / screen_h,
                }

                regions = copy.deepcopy(DRAFT_REGIONS)
                regions[team_key]["slots"][slot_idx] = new_slot
                write_regions(regions, screen_w, screen_h)

                s = new_slot
                print(f"\n  Saved: ({s['x_start']:.4f}, {s['y_start']:.4f}) -> ({s['x_end']:.4f}, {s['y_end']:.4f})")
                print("Press 'q' to quit")
            else:
                print("  Next: BOTTOM-RIGHT")

            cv2.imshow(window_name, canvas)

    cv2.setMouseCallback(window_name, on_mouse)
    cv2.imshow(window_name, canvas)

    while True:
        key = cv2.waitKey(50) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("r"):
            clicks = []
            canvas = display_base.copy()
            cv2.imshow(window_name, canvas)
            print("\nReset! Click TOP-LEFT")
        elif key == ord("u") and clicks:
            clicks.pop()
            canvas = display_base.copy()
            if clicks:
                cv2.circle(canvas, clicks[0], 4, color, -1)
            cv2.imshow(window_name, canvas)
            corner = "TOP-LEFT" if not clicks else "BOTTOM-RIGHT"
            print(f"  Undo! Next: {corner}")

    cv2.destroyAllWindows()


def run_full(img_orig: np.ndarray) -> None:
    """Full calibration: 20 clicks for all 10 heroes."""
    global clicks, scale

    max_display_h = 900
    scale = min(1.0, max_display_h / screen_h)
    display_base = cv2.resize(img_orig, None, fx=scale, fy=scale) if scale != 1.0 else img_orig.copy()
    canvas = display_base.copy()

    window_name = "Calibration"
    cv2.namedWindow(window_name, cv2.WINDOW_AUTOSIZE)

    def on_mouse(event: int, x: int, y: int, flags: int, param: object) -> None:
        nonlocal canvas

        if event == cv2.EVENT_LBUTTONDOWN:
            if len(clicks) >= TOTAL_CLICKS:
                return

            clicks.append((x, y))
            idx = len(clicks)
            hero_idx = (idx - 1) // 2
            is_bottom_right = idx % 2 == 0
            team_color = (0, 255, 0) if hero_idx < 5 else (0, 0, 255)

            ox, oy = to_original(x, y)
            print(f"  Click {idx}/{TOTAL_CLICKS}: pixel ({ox}, {oy}) | {current_step_label()}")

            cv2.circle(canvas, (x, y), 4, team_color, -1)

            if is_bottom_right:
                tl = clicks[-2]
                br = clicks[-1]
                cv2.rectangle(canvas, tl, br, team_color, 2)
                slot_num = (hero_idx % 5) + 1
                team = TEAMS[hero_idx // 5]
                cv2.putText(canvas, f"{team[0]}{slot_num}",
                            (tl[0] + 2, tl[1] - 5),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, team_color, 1)

            if len(clicks) >= TOTAL_CLICKS:
                slots: dict[str, list[dict]] = {"radiant": [], "dire": []}
                for i in range(10):
                    tl_x, tl_y = to_original(*clicks[i * 2])
                    br_x, br_y = to_original(*clicks[i * 2 + 1])
                    t = "radiant" if i < 5 else "dire"
                    slots[t].append({
                        "x_start": tl_x / screen_w,
                        "y_start": tl_y / screen_h,
                        "x_end": br_x / screen_w,
                        "y_end": br_y / screen_h,
                    })
                regions = {
                    "radiant_picks": {"slots": slots["radiant"]},
                    "dire_picks": {"slots": slots["dire"]},
                }
                write_regions(regions, screen_w, screen_h)
                for team_name in ["radiant", "dire"]:
                    print(f"\n  {team_name.capitalize()}:")
                    for j, s in enumerate(slots[team_name]):
                        print(f"    Slot {j+1}: ({s['x_start']:.4f}, {s['y_start']:.4f}) -> ({s['x_end']:.4f}, {s['y_end']:.4f})")
            else:
                print(f"  Next: {current_step_label()}")

            cv2.imshow(window_name, canvas)

    cv2.setMouseCallback(window_name, on_mouse)
    cv2.imshow(window_name, canvas)

    print(f"\n{current_step_label()}")
    print("Press 'r' to reset all, 'u' to undo last click, 'q' to quit\n")

    while True:
        key = cv2.waitKey(50) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("r"):
            clicks = []
            canvas = display_base.copy()
            cv2.imshow(window_name, canvas)
            print(f"\nReset! {current_step_label()}")
        elif key == ord("u") and clicks:
            clicks.pop()
            canvas = display_base.copy()
            for i in range(len(clicks)):
                pt = clicks[i]
                h_idx = i // 2
                tc = (0, 255, 0) if h_idx < 5 else (0, 0, 255)
                cv2.circle(canvas, pt, 4, tc, -1)
                if i % 2 == 1:
                    cv2.rectangle(canvas, clicks[i - 1], pt, tc, 2)
                    slot_n = (h_idx % 5) + 1
                    t = TEAMS[h_idx // 5]
                    cv2.putText(canvas, f"{t[0]}{slot_n}",
                                (clicks[i - 1][0] + 2, clicks[i - 1][1] - 5),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.4, tc, 1)
            cv2.imshow(window_name, canvas)
            print(f"  Undo! {current_step_label()}")

    cv2.destroyAllWindows()


def main() -> None:
    global screen_w, screen_h

    parser = argparse.ArgumentParser(description="Calibrate scoreboard hero slots")
    parser.add_argument("--monitor", type=int, default=1,
                        help="Monitor number (1=primary, 2=second, etc.)")
    parser.add_argument("--team", choices=["radiant", "dire"],
                        help="Team for single-slot mode")
    parser.add_argument("--slot", type=int, choices=range(1, 6), metavar="{1-5}",
                        help="Slot number (1-5) for single-slot mode")
    args = parser.parse_args()

    single_slot_mode = args.team is not None or args.slot is not None
    if single_slot_mode and (args.team is None or args.slot is None):
        parser.error("--team and --slot must be used together")

    with mss.mss() as sct:
        if args.monitor >= len(sct.monitors):
            available = len(sct.monitors) - 1
            print(f"Monitor {args.monitor} not found. Available: 1-{available}", file=sys.stderr)
            sys.exit(1)

        monitor = sct.monitors[args.monitor]
        screen_w = monitor["width"]
        screen_h = monitor["height"]
        print(f"Captured monitor {args.monitor}: {screen_w}x{screen_h}")

        screenshot = sct.grab(monitor)
        img_orig = np.array(screenshot)
        img_orig = cv2.cvtColor(img_orig, cv2.COLOR_BGRA2BGR)

    DEBUG_DIR.mkdir(exist_ok=True)
    cv2.imwrite(str(DEBUG_DIR / "calibration_screenshot.png"), img_orig)

    if single_slot_mode:
        run_single_slot(img_orig, args.team, args.slot - 1)
    else:
        run_full(img_orig)


if __name__ == "__main__":
    main()
