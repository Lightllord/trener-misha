"""
Interactive calibration tool for scoreboard hero slots.

Full calibration (no --slot): place 10 rectangles (Radiant 1-5, then Dire 1-5).
Single-slot mode: place one rectangle for one slot, the rest are preserved.

Usage:
    python calibrate.py                              # Full calibration, primary monitor
    python calibrate.py --monitor 2                  # Full calibration, monitor 2
    python calibrate.py --team radiant --slot 3      # Recalibrate one slot
    python calibrate.py --monitor 2 --team dire --slot 1

Workflow (full):
    1. Open Dota 2 scoreboard (hold Tab) and run this script.
    2. Draw the first rectangle (R1) with two clicks: TOP-LEFT then BOTTOM-RIGHT.
    3. Press 'c' to copy its size, then SINGLE-click each remaining slot to stamp
       an identically-sized rectangle.
    4. Drag any rectangle to reposition it; use arrow keys for pixel-perfect nudging.
    5. Regions are saved automatically to regions.py once all 10 are placed.

Controls:
    Left click          — place a rectangle (2 clicks, or 1 click when a size is copied)
    Left drag on a box  — move that rectangle
    Arrow keys          — nudge the selected rectangle by 1px
    Mouse wheel         — zoom in / out (centered on cursor)
    Right drag          — pan
    'c'                 — copy the selected rectangle's size (enables 1-click stamping)
    'd'                 — duplicate the selected rectangle
    'r'                 — reset everything
    'u'                 — undo last rectangle
    'q'                 — quit
"""

import argparse
import copy
import sys
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
import mss

from regions import DRAFT_REGIONS

DEBUG_DIR = Path(__file__).parent / "debug"
FONT = cv2.FONT_HERSHEY_SIMPLEX

screen_w = 0
screen_h = 0

TEAMS = ["Radiant", "Dire"]

# Windows / GTK arrow-key codes from cv2.waitKeyEx → (dx, dy) in base pixels.
ARROW_KEYS = {
    2424832: (-1, 0), 65361: (-1, 0),   # left
    2490368: (0, -1), 65362: (0, -1),   # up
    2555904: (1, 0),  65363: (1, 0),    # right
    2621440: (0, 1),  65364: (0, 1),    # down
}

# ── viewport state ────────────────────────────────────────────────────────────
_zoom            = 1.0
_view_ox         = 0.0   # top-left of visible area in base-image pixels
_view_oy         = 0.0
_pan_active      = False
_pan_start_view  = (0, 0)
_pan_start_off   = (0.0, 0.0)
_base_img: np.ndarray = np.zeros((1, 1, 3), dtype=np.uint8)
_scale           = 1.0   # base_img / original_screen ratio
_win_name        = "Calibration"
_redraw: Callable[[], None] = lambda: None
_on_click: Callable[[float, float], None] = lambda bx, by: None

# ── editor state (rectangles in BASE-IMAGE pixels) ──────────────────────────────
rects: list[dict[str, float]] = []
pending_tl: tuple[float, float] | None = None   # first corner of a 2-click rectangle
stamp_size: tuple[float, float] | None = None   # copied (w, h) for 1-click stamping
selected: int | None = None
dragging   = False
drag_idx   = -1
drag_off   = (0.0, 0.0)
target_count   = 0
_was_complete  = False
_label_for: Callable[[int], str]   = lambda i: str(i)
_color_for: Callable[[int], tuple] = lambda i: (0, 255, 0)
_save_cb:   Callable[[list, bool], None]   = lambda r, v: None
_ref_draw:  Callable[[np.ndarray], None] | None = None


def _view_to_base(vx: float, vy: float) -> tuple[float, float]:
    return _view_ox + vx / _zoom, _view_oy + vy / _zoom


def _base_to_view(bx: float, by: float) -> tuple[int, int]:
    return int((bx - _view_ox) * _zoom), int((by - _view_oy) * _zoom)


def _base_to_screen(bx: float, by: float) -> tuple[int, int]:
    """Base-image coords → original screen coords (for saving regions)."""
    return int(bx / _scale), int(by / _scale)


def _clamp_pan() -> None:
    global _view_ox, _view_oy
    bh, bw = _base_img.shape[:2]
    max_ox = max(0.0, bw - bw / _zoom)
    max_oy = max(0.0, bh - bh / _zoom)
    _view_ox = max(0.0, min(max_ox, _view_ox))
    _view_oy = max(0.0, min(max_oy, _view_oy))


def _new_canvas() -> np.ndarray:
    """Crop the base image to the current viewport and upscale to base size."""
    bh, bw = _base_img.shape[:2]
    vis_w = bw / _zoom
    vis_h = bh / _zoom
    x0 = int(max(0, _view_ox))
    y0 = int(max(0, _view_oy))
    x1 = int(min(bw, _view_ox + vis_w))
    y1 = int(min(bh, _view_oy + vis_h))

    crop = _base_img[y0:y1, x0:x1]
    if crop.size == 0:
        return _base_img.copy()
    return cv2.resize(crop, (bw, bh), interpolation=cv2.INTER_LINEAR)


def _draw_help(canvas: np.ndarray, status: str) -> None:
    cv2.putText(canvas, f"zoom {_zoom:.1f}x  |  {status}", (8, 20),
                FONT, 0.50, (255, 255, 255), 1, cv2.LINE_AA)
    cv2.putText(canvas, "LMB=place/drag  wheel=zoom  RMB=pan  arrows=nudge  c=copy  d=dup  r=reset  u=undo  q=quit",
                (8, canvas.shape[0] - 8), FONT, 0.38, (180, 180, 180), 1, cv2.LINE_AA)


def _rect_at(bx: float, by: float) -> int | None:
    """Index of the topmost (last-drawn) rectangle containing the point, or None."""
    for i in reversed(range(len(rects))):
        r = rects[i]
        if r["x"] <= bx <= r["x"] + r["w"] and r["y"] <= by <= r["y"] + r["h"]:
            return i
    return None


def _rect_from_pts(p1: tuple[float, float], p2: tuple[float, float]) -> dict[str, float]:
    return {
        "x": min(p1[0], p2[0]),
        "y": min(p1[1], p2[1]),
        "w": abs(p2[0] - p1[0]),
        "h": abs(p2[1] - p1[1]),
    }


def _clamp_rect(r: dict[str, float]) -> None:
    bh, bw = _base_img.shape[:2]
    r["x"] = max(0.0, min(bw - r["w"], r["x"]))
    r["y"] = max(0.0, min(bh - r["h"], r["y"]))


def _after_change(verbose_on_complete: bool) -> None:
    """Re-save when all target rectangles exist; print summary only on first completion."""
    global _was_complete
    if target_count and len(rects) == target_count:
        _save_cb(rects, verbose_on_complete and not _was_complete)
        _was_complete = True
    else:
        _was_complete = False


def _on_mouse(event: int, vx: int, vy: int, flags: int, _param: object) -> None:
    global _zoom, _view_ox, _view_oy
    global _pan_active, _pan_start_view, _pan_start_off, dragging

    if event == cv2.EVENT_MOUSEWHEEL:
        factor   = 1.15 if flags > 0 else 1 / 1.15
        new_zoom = max(1.0, min(12.0, _zoom * factor))
        bx, by   = _view_to_base(vx, vy)   # keep cursor pixel fixed in image space
        _view_ox = bx - vx / new_zoom
        _view_oy = by - vy / new_zoom
        _zoom = new_zoom
        _clamp_pan()
        _redraw()

    elif event == cv2.EVENT_RBUTTONDOWN:
        _pan_active     = True
        _pan_start_view = (vx, vy)
        _pan_start_off  = (_view_ox, _view_oy)

    elif event == cv2.EVENT_RBUTTONUP:
        _pan_active = False

    elif event == cv2.EVENT_MOUSEMOVE and _pan_active:
        _view_ox = _pan_start_off[0] + (_pan_start_view[0] - vx) / _zoom
        _view_oy = _pan_start_off[1] + (_pan_start_view[1] - vy) / _zoom
        _clamp_pan()
        _redraw()

    elif event == cv2.EVENT_MOUSEMOVE and dragging:
        bx, by = _view_to_base(vx, vy)
        r = rects[drag_idx]
        r["x"] = bx - drag_off[0]
        r["y"] = by - drag_off[1]
        _clamp_rect(r)
        _redraw()

    elif event == cv2.EVENT_LBUTTONUP and dragging:
        dragging = False
        _after_change(False)
        _redraw()

    elif event == cv2.EVENT_LBUTTONDOWN:
        bx, by = _view_to_base(vx, vy)
        _on_click(bx, by)


def _editor_click(bx: float, by: float) -> None:
    global pending_tl, selected, dragging, drag_idx, drag_off

    # Completing a 2-click rectangle takes priority over grabbing existing boxes.
    if pending_tl is not None:
        rects.append(_rect_from_pts(pending_tl, (bx, by)))
        pending_tl = None
        selected = len(rects) - 1
        _print_placed()
        _after_change(True)
        _redraw()
        return

    hit = _rect_at(bx, by)
    if hit is not None:
        selected = hit
        dragging = True
        drag_idx = hit
        r = rects[hit]
        drag_off = (bx - r["x"], by - r["y"])
        _redraw()
        return

    if len(rects) >= target_count:
        return

    if stamp_size is not None:
        r = {"x": bx, "y": by, "w": stamp_size[0], "h": stamp_size[1]}
        _clamp_rect(r)
        rects.append(r)
        selected = len(rects) - 1
        _print_placed()
        _after_change(True)
        _redraw()
        return

    pending_tl = (bx, by)
    print(f"  {_label_for(len(rects))}: TOP-LEFT set, click BOTTOM-RIGHT")
    _redraw()


def _print_placed() -> None:
    i = selected if selected is not None else len(rects) - 1
    r = rects[i]
    sx, sy = _base_to_screen(r["x"], r["y"])
    ex, ey = _base_to_screen(r["x"] + r["w"], r["y"] + r["h"])
    print(f"  {_label_for(i)} placed: ({sx},{sy}) -> ({ex},{ey})  [{len(rects)}/{target_count}]")


def _render() -> None:
    canvas = _new_canvas()
    if _ref_draw is not None:
        _ref_draw(canvas)

    for i, r in enumerate(rects):
        color = _color_for(i)
        p1 = _base_to_view(r["x"], r["y"])
        p2 = _base_to_view(r["x"] + r["w"], r["y"] + r["h"])
        cv2.rectangle(canvas, p1, p2, color, 2)
        cv2.putText(canvas, _label_for(i), (p1[0] + 2, p1[1] - 5), FONT, 0.4, color, 1)
        if i == selected:
            cv2.rectangle(canvas, (p1[0] - 2, p1[1] - 2), (p2[0] + 2, p2[1] + 2),
                          (255, 255, 255), 1)

    if pending_tl is not None:
        cv2.circle(canvas, _base_to_view(*pending_tl), 4, (0, 255, 255), -1)

    n = len(rects)
    if pending_tl is not None:
        status = f"BOTTOM-RIGHT of {_label_for(n)}"
    elif n >= target_count:
        status = "Done — press q to quit"
    elif stamp_size is not None:
        status = f"STAMP {int(stamp_size[0])}x{int(stamp_size[1])} — click TOP-LEFT of {_label_for(n)}"
    else:
        status = f"TOP-LEFT of {_label_for(n)}"
    _draw_help(canvas, status)
    cv2.imshow(_win_name, canvas)


def _init_viewport(img_orig: np.ndarray) -> None:
    global _base_img, _scale, _zoom, _view_ox, _view_oy

    max_display_h = 900
    _scale = min(1.0, max_display_h / screen_h)
    if _scale < 1.0:
        bw = int(screen_w * _scale)
        bh = int(screen_h * _scale)
        _base_img = cv2.resize(img_orig, (bw, bh), interpolation=cv2.INTER_AREA)
    else:
        _base_img = img_orig.copy()

    _zoom    = 1.0
    _view_ox = 0.0
    _view_oy = 0.0

    cv2.namedWindow(_win_name, cv2.WINDOW_AUTOSIZE)
    cv2.setMouseCallback(_win_name, _on_mouse)


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


def _rect_to_slot(r: dict[str, float]) -> dict[str, float]:
    sx, sy = _base_to_screen(r["x"], r["y"])
    ex, ey = _base_to_screen(r["x"] + r["w"], r["y"] + r["h"])
    return {
        "x_start": sx / screen_w,
        "y_start": sy / screen_h,
        "x_end": ex / screen_w,
        "y_end": ey / screen_h,
    }


def draw_existing_regions(canvas: np.ndarray) -> None:
    """Draw all current regions (mapped through the viewport) as reference."""
    bh, bw = _base_img.shape[:2]
    for team_key, color in [("radiant_picks", (0, 200, 0)), ("dire_picks", (200, 0, 0))]:
        for i, s in enumerate(DRAFT_REGIONS[team_key]["slots"]):
            p1 = _base_to_view(s["x_start"] * bw, s["y_start"] * bh)
            p2 = _base_to_view(s["x_end"] * bw, s["y_end"] * bh)
            cv2.rectangle(canvas, p1, p2, color, 1)
            label = f"{'R' if 'radiant' in team_key else 'D'}{i + 1}"
            cv2.putText(canvas, label, (p1[0] + 2, p1[1] - 3), FONT, 0.35, color, 1)


def run_editor(
    img_orig: np.ndarray,
    count: int,
    label_for: Callable[[int], str],
    color_for: Callable[[int], tuple],
    save_cb: Callable[[list, bool], None],
    ref_draw: Callable[[np.ndarray], None] | None,
    intro: list[str],
) -> None:
    global rects, pending_tl, stamp_size, selected, dragging
    global target_count, _was_complete
    global _label_for, _color_for, _save_cb, _ref_draw, _redraw, _on_click

    _init_viewport(img_orig)
    rects = []
    pending_tl = None
    stamp_size = None
    selected = None
    dragging = False
    target_count = count
    _was_complete = False
    _label_for, _color_for, _save_cb, _ref_draw = label_for, color_for, save_cb, ref_draw
    _redraw, _on_click = _render, _editor_click

    for line in intro:
        print(line)
    print("Controls: LMB=place/drag  wheel=zoom  RMB=pan  arrows=nudge  "
          "c=copy size  d=duplicate  r=reset  u=undo  q=quit\n")
    _render()

    while True:
        full = cv2.waitKeyEx(50)
        if full == -1:
            continue

        if full in ARROW_KEYS and selected is not None:
            dx, dy = ARROW_KEYS[full]
            r = rects[selected]
            r["x"] += dx
            r["y"] += dy
            _clamp_rect(r)
            _after_change(False)
            _render()
            continue

        key = full & 0xFF
        if key == ord("q"):
            break
        elif key == ord("r"):
            rects.clear()
            pending_tl = None
            stamp_size = None
            selected = None
            _was_complete = False
            print("\nReset.")
            _render()
        elif key == ord("u"):
            if pending_tl is not None:
                pending_tl = None
                print("  Undo: cleared in-progress corner")
            elif rects:
                rects.pop()
                selected = len(rects) - 1 if rects else None
                _was_complete = False
                print(f"  Undo: removed last rectangle  [{len(rects)}/{target_count}]")
            _render()
        elif key == ord("c"):
            if selected is not None:
                r = rects[selected]
                stamp_size = (r["w"], r["h"])
                print(f"  Copied size {int(r['w'])}x{int(r['h'])} — single-click to stamp identical rectangles")
                _render()
        elif key == ord("d"):
            if selected is not None and len(rects) < target_count:
                src = rects[selected]
                dup = {"x": src["x"] + 12, "y": src["y"] + 12, "w": src["w"], "h": src["h"]}
                _clamp_rect(dup)
                rects.append(dup)
                selected = len(rects) - 1
                _print_placed()
                _after_change(True)
                _render()

    cv2.destroyAllWindows()


def run_full(img_orig: np.ndarray) -> None:
    def label_for(i: int) -> str:
        return f"R{i + 1}" if i < 5 else f"D{i - 4}"

    def color_for(i: int) -> tuple:
        return (0, 255, 0) if i < 5 else (0, 0, 255)

    def save_full(placed: list[dict[str, float]], verbose: bool) -> None:
        slots = {"radiant": [], "dire": []}
        for i in range(10):
            t = "radiant" if i < 5 else "dire"
            slots[t].append(_rect_to_slot(placed[i]))
        write_regions(
            {"radiant_picks": {"slots": slots["radiant"]},
             "dire_picks": {"slots": slots["dire"]}},
            screen_w, screen_h,
        )
        if verbose:
            for team_name in ["radiant", "dire"]:
                print(f"\n  {team_name.capitalize()}:")
                for j, s in enumerate(slots[team_name]):
                    print(f"    Slot {j+1}: ({s['x_start']:.4f}, {s['y_start']:.4f}) -> "
                          f"({s['x_end']:.4f}, {s['y_end']:.4f})")

    intro = [
        "\nFull calibration — place 10 rectangles (Radiant 1-5, then Dire 1-5).",
        "Tip: draw R1 with 2 clicks, press 'c' to copy its size, then single-click",
        "     each remaining slot to stamp identically-sized rectangles.",
    ]
    run_editor(img_orig, 10, label_for, color_for, save_full, None, intro)


def run_single_slot(img_orig: np.ndarray, team: str, slot_idx: int) -> None:
    team_key = f"{team}_picks"
    team_label = team.capitalize()

    def label_for(_i: int) -> str:
        return f"NEW {team_label} {slot_idx + 1}"

    def color_for(_i: int) -> tuple:
        return (0, 255, 0)

    def ref_draw(canvas: np.ndarray) -> None:
        draw_existing_regions(canvas)
        bh, bw = _base_img.shape[:2]
        s = DRAFT_REGIONS[team_key]["slots"][slot_idx]
        p1 = _base_to_view(s["x_start"] * bw, s["y_start"] * bh)
        p2 = _base_to_view(s["x_end"] * bw, s["y_end"] * bh)
        cv2.rectangle(canvas, p1, p2, (0, 255, 255), 2)
        cv2.putText(canvas, f"OLD: {team_label} {slot_idx + 1}",
                    (p1[0] + 2, p1[1] - 6), FONT, 0.45, (0, 200, 200), 1)

    def save_single(placed: list[dict[str, float]], verbose: bool) -> None:
        regions = copy.deepcopy(DRAFT_REGIONS)
        new_slot = _rect_to_slot(placed[0])
        regions[team_key]["slots"][slot_idx] = new_slot
        write_regions(regions, screen_w, screen_h)
        if verbose:
            print(f"\n  Saved: ({new_slot['x_start']:.4f}, {new_slot['y_start']:.4f}) -> "
                  f"({new_slot['x_end']:.4f}, {new_slot['y_end']:.4f})")

    intro = [
        f"\nRecalibrating {team_label} slot {slot_idx + 1}.",
        "Draw the rectangle (2 clicks), then drag or use arrow keys to fine-tune.",
    ]
    run_editor(img_orig, 1, label_for, color_for, save_single, ref_draw, intro)


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
