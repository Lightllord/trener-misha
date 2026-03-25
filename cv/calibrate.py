"""
Interactive calibration tool for scoreboard hero slots.

Takes a screenshot, then you click TOP-LEFT and BOTTOM-RIGHT
of each hero portrait (10 heroes = 20 clicks).

Usage:
    python calibrate.py               # Primary monitor
    python calibrate.py --monitor 2   # Specific monitor

Instructions:
    1. Open Dota 2 scoreboard (hold Tab)
    2. Run this script
    3. For each hero (Radiant 1-5, then Dire 1-5):
       click TOP-LEFT, then BOTTOM-RIGHT of the portrait
    4. Regions are saved automatically to regions.py

    Press 'r' to reset, 'u' to undo last click, 'q' to quit.
"""

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
import mss

DEBUG_DIR = Path(__file__).parent / "debug"

screen_w = 0
screen_h = 0
clicks: list[tuple[int, int]] = []
scale = 1.0

TEAMS = ["Radiant", "Dire"]
# 10 heroes, 2 clicks each = 20 clicks total
TOTAL_CLICKS = 20


def current_step_label() -> str:
    """Get label for the current click."""
    idx = len(clicks)
    if idx >= TOTAL_CLICKS:
        return "Done! Press 'q' to quit"
    hero_idx = idx // 2          # 0-9
    is_top_left = idx % 2 == 0
    team = TEAMS[hero_idx // 5]
    slot = (hero_idx % 5) + 1
    corner = "TOP-LEFT" if is_top_left else "BOTTOM-RIGHT"
    return f"{corner} of {team} hero {slot}"


def to_original(x: int, y: int) -> tuple[int, int]:
    return int(x / scale), int(y / scale)


def save_results() -> None:
    """Save all 10 individual slot regions to regions.py."""
    slots: dict[str, list[dict]] = {"radiant": [], "dire": []}

    for i in range(10):
        tl_x, tl_y = to_original(*clicks[i * 2])
        br_x, br_y = to_original(*clicks[i * 2 + 1])
        team = "radiant" if i < 5 else "dire"
        slots[team].append({
            "x_start": tl_x / screen_w,
            "y_start": tl_y / screen_h,
            "x_end": br_x / screen_w,
            "y_end": br_y / screen_h,
        })

    def fmt_slots(team_slots: list[dict]) -> str:
        lines = []
        for s in team_slots:
            lines.append(
                f'        {{"x_start": {s["x_start"]:.4f}, "y_start": {s["y_start"]:.4f}, '
                f'"x_end": {s["x_end"]:.4f}, "y_end": {s["y_end"]:.4f}}},'
            )
        return "\n".join(lines)

    regions_path = Path(__file__).parent / "regions.py"
    content = f'''"""
Draft screen region definitions for Dota 2 scoreboard.

All coordinates are proportional (0.0 - 1.0) relative to screen dimensions.
Calibrated at {screen_w}x{screen_h} resolution.
Re-run `python calibrate.py` to recalibrate.
"""

# Each slot is defined individually for precise calibration
DRAFT_REGIONS = {{
    "radiant_picks": {{
        "slots": [
{fmt_slots(slots["radiant"])}
        ],
    }},
    "dire_picks": {{
        "slots": [
{fmt_slots(slots["dire"])}
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
    for team in ["radiant", "dire"]:
        print(f"\n  {team.capitalize()}:")
        for j, s in enumerate(slots[team]):
            print(f"    Slot {j+1}: ({s['x_start']:.4f}, {s['y_start']:.4f}) -> ({s['x_end']:.4f}, {s['y_end']:.4f})")


def main() -> None:
    global screen_w, screen_h, clicks, scale

    parser = argparse.ArgumentParser(description="Calibrate scoreboard hero slots")
    parser.add_argument("--monitor", type=int, default=1,
                        help="Monitor number (1=primary, 2=second, etc.)")
    args = parser.parse_args()

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

            # Draw rectangle when we have a pair
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
                save_results()
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
            # Redraw everything
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


if __name__ == "__main__":
    main()
