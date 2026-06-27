"""
One-time calibration for the Dota 2 player panel detector.

Click two corners (top-left then bottom-right) of each region.
Results are saved to player_regions.py and templates/.

Usage:
    python calibrate_player.py [--monitor N]              # Full calibration (10 clicks)
    python calibrate_player.py [--monitor N] --skill      # Recalibrate SKILL_1 only (2 clicks; innate auto-detected)
    python calibrate_player.py [--monitor N] --frame      # Panel frame template only (2 clicks)

Full calibration steps:
    1. INNATE ABILITY icon   — circular icon to the right of the portrait
    2. FIRST ITEM SLOT       — leftmost item slot
    3. FIRST ABILITY icon    — skill 1 (leftmost ability icon)
    4. HERO LEVEL badge      — level number near bottom-left of portrait

Controls:
    Left click       — place calibration point
    Mouse wheel      — zoom in / out (centered on cursor)
    Right drag       — pan
    'r'              — reset current step
    'u'              — undo last click
    'q'              — quit
"""

import argparse
import sys
from pathlib import Path

import cv2
import mss
import numpy as np

SCRIPT_DIR         = Path(__file__).parent
TEMPLATES_DIR      = SCRIPT_DIR / "templates"
PLAYER_REGIONS_OUT = SCRIPT_DIR / "player_regions.py"

FULL_STEPS = [
    ("innate",       "INNATE ABILITY icon",                    (0, 200, 255)),
    ("item_0",       "FIRST (leftmost) ITEM SLOT",             (0, 255, 100)),
    ("skill_1",      "FIRST ABILITY (skill 1) icon",           (255, 200,   0)),
    ("level",        "HERO LEVEL badge/number",                (255, 100, 255)),
    ("panel_frame",  "PANEL FRAME (trapezoid on right edge)",  (100, 200, 255)),
]

SLOT_GAP_DEFAULT = 0.08   # gap between slots in innate_h units

INNATE_THRESHOLD    = 0.75
TP_SCROLL_THRESHOLD = 0.70
TP_EMPTY_THRESHOLD  = 0.60

# ── viewport state ────────────────────────────────────────────────────────────
_zoom      = 1.0
_view_ox   = 0.0   # top-left of visible area in base-image pixels
_view_oy   = 0.0
_pan_active     = False
_pan_start_view = (0, 0)
_pan_start_off  = (0.0, 0.0)
_base_img: np.ndarray = np.zeros((1, 1, 3), dtype=np.uint8)
_scale = 1.0        # base_img / original_screen ratio
_clicks: list[tuple[int, int]] = []   # stored as BASE-IMAGE pixels
_steps:  list[tuple[str, str, tuple]] = []
_ref_boxes: list[tuple[float, float, float, float, tuple, str]] = []   # BASE-IMAGE pixels
_win_name = "calibrate_player"


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


def _render() -> np.ndarray:
    bh, bw = _base_img.shape[:2]
    vis_w = bw / _zoom
    vis_h = bh / _zoom
    x0 = int(max(0, _view_ox))
    y0 = int(max(0, _view_oy))
    x1 = int(min(bw, _view_ox + vis_w))
    y1 = int(min(bh, _view_oy + vis_h))

    crop = _base_img[y0:y1, x0:x1]
    if crop.size == 0:
        canvas = _base_img.copy()
    else:
        canvas = cv2.resize(crop, (bw, bh), interpolation=cv2.INTER_LINEAR)

    total   = len(_steps) * 2
    n_done  = len(_clicks)

    # draw reference boxes (e.g. auto-detected innate) for alignment
    for bx, by, bw, bh, color, label in _ref_boxes:
        p1 = _base_to_view(bx, by)
        p2 = _base_to_view(bx + bw, by + bh)
        cv2.rectangle(canvas, p1, p2, color, 1)
        cv2.putText(canvas, label, (p1[0] + 2, p1[1] - 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, color, 1)

    # draw completed rectangles
    for i in range(0, n_done - 1, 2):
        _, _, color = _steps[i // 2]
        p1 = _base_to_view(*_clicks[i])
        p2 = _base_to_view(*_clicks[i + 1])
        cv2.rectangle(canvas, p1, p2, color, 2)
        label = _steps[i // 2][1][:22]
        cv2.putText(canvas, label, (p1[0] + 2, p1[1] - 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, color, 1)

    # draw placed dots
    for i, pt in enumerate(_clicks):
        si = min(i // 2, len(_steps) - 1)
        _, _, color = _steps[si]
        vpt = _base_to_view(*pt)
        cv2.circle(canvas, vpt, 4, color, -1)

    # status line
    if n_done < total:
        si = n_done // 2
        _, label, _ = _steps[si]
        corner = "TOP-LEFT" if n_done % 2 == 0 else "BOTTOM-RIGHT"
        status = f"{corner} of {label}"
    else:
        status = "Done — press q to finish"

    zoom_txt = f"zoom {_zoom:.1f}x  |  {status}"
    cv2.putText(canvas, zoom_txt, (8, 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.50, (255, 255, 255), 1, cv2.LINE_AA)
    cv2.putText(canvas, "wheel=zoom  RMB=pan  r=reset  u=undo  q=quit",
                (8, _base_img.shape[0] - 8),
                cv2.FONT_HERSHEY_SIMPLEX, 0.38, (180, 180, 180), 1, cv2.LINE_AA)

    cv2.imshow(_win_name, canvas)


def _on_mouse(event: int, vx: int, vy: int, flags: int, _param: object) -> None:
    global _zoom, _view_ox, _view_oy
    global _pan_active, _pan_start_view, _pan_start_off

    bh, bw = _base_img.shape[:2]

    if event == cv2.EVENT_MOUSEWHEEL:
        factor   = 1.15 if flags > 0 else 1 / 1.15
        new_zoom = max(1.0, min(12.0, _zoom * factor))
        # keep cursor pixel fixed in image space
        bx, by   = _view_to_base(vx, vy)
        _view_ox = bx - vx / new_zoom
        _view_oy = by - vy / new_zoom
        _zoom = new_zoom
        _clamp_pan()
        _render()

    elif event == cv2.EVENT_RBUTTONDOWN:
        _pan_active     = True
        _pan_start_view = (vx, vy)
        _pan_start_off  = (_view_ox, _view_oy)

    elif event == cv2.EVENT_MOUSEMOVE and _pan_active:
        _view_ox = _pan_start_off[0] + (_pan_start_view[0] - vx) / _zoom
        _view_oy = _pan_start_off[1] + (_pan_start_view[1] - vy) / _zoom
        _clamp_pan()
        _render()

    elif event == cv2.EVENT_RBUTTONUP:
        _pan_active = False

    elif event == cv2.EVENT_LBUTTONDOWN:
        total = len(_steps) * 2
        if len(_clicks) >= total:
            return
        bx, by = _view_to_base(vx, vy)
        _clicks.append((bx, by))
        n = len(_clicks)
        sx, sy = _base_to_screen(bx, by)
        si = (n - 1) // 2
        label = _steps[si][1] if si < len(_steps) else "?"
        corner = "TL" if n % 2 == 1 else "BR"
        print(f"  {n}/{total}: screen ({sx},{sy})  [{corner} of {label}]",
              file=sys.stderr)
        _render()


def _current_step_label() -> str:
    n = len(_clicks)
    total = len(_steps) * 2
    if n >= total:
        return "Done"
    si = n // 2
    _, label, _ = _steps[si]
    return ("TOP-LEFT" if n % 2 == 0 else "BOTTOM-RIGHT") + f" of {label}"


def run_calibration(
    img_orig: np.ndarray,
    screen_w: int,
    screen_h: int,
    steps: list[tuple[str, str, tuple]],
    ref_boxes: list[tuple[float, float, float, float, tuple, str]] | None = None,
) -> dict[str, dict[str, float]]:
    global _base_img, _scale, _zoom, _view_ox, _view_oy, _clicks, _steps, _ref_boxes

    _steps  = steps
    _clicks = []
    _zoom   = 1.0
    _view_ox = 0.0
    _view_oy = 0.0

    # Fit to 85 % of screen height so the OS taskbar doesn't clip the window
    max_display_h = int(screen_h * 0.85)
    _scale = min(1.0, max_display_h / screen_h)
    _ref_boxes = [
        (x * _scale, y * _scale, w * _scale, h * _scale, color, label)
        for (x, y, w, h, color, label) in (ref_boxes or [])
    ]
    if _scale < 1.0:
        bw = int(screen_w * _scale)
        bh = int(screen_h * _scale)
        _base_img = cv2.resize(img_orig, (bw, bh), interpolation=cv2.INTER_AREA)
    else:
        _base_img = img_orig.copy()

    cv2.namedWindow(_win_name, cv2.WINDOW_AUTOSIZE)
    cv2.setMouseCallback(_win_name, _on_mouse)

    total = len(steps) * 2
    print(f"\nNext: {_current_step_label()}", file=sys.stderr)
    print("wheel=zoom  RMB=pan  r=reset step  u=undo  q=quit\n", file=sys.stderr)
    _render()

    while True:
        key = cv2.waitKey(50) & 0xFF
        if key == ord("q"):
            break
        elif key == ord("r"):
            step_start = (len(_clicks) // 2) * 2
            _clicks = _clicks[:step_start]
            print(f"  Reset step → {_current_step_label()}", file=sys.stderr)
            _render()
        elif key == ord("u") and _clicks:
            _clicks.pop()
            print(f"  Undo → {_current_step_label()}", file=sys.stderr)
            _render()

    cv2.destroyAllWindows()

    # Build result dict in SCREEN coordinates
    results: dict[str, dict[str, float]] = {}
    for i in range(0, len(_clicks) - 1, 2):
        step_name = steps[i // 2][0]
        tl = _base_to_screen(*_clicks[i])
        br = _base_to_screen(*_clicks[i + 1])
        results[step_name] = {
            "x": float(min(tl[0], br[0])),
            "y": float(min(tl[1], br[1])),
            "w": float(abs(br[0] - tl[0])),
            "h": float(abs(br[1] - tl[1])),
        }
    return results


def save_template(name: str, img_orig: np.ndarray, r: dict[str, float]) -> None:
    TEMPLATES_DIR.mkdir(exist_ok=True)
    x, y, w, h = int(r["x"]), int(r["y"]), int(r["w"]), int(r["h"])
    crop = img_orig[y : y + h, x : x + w]
    path = TEMPLATES_DIR / f"{name}.png"
    cv2.imwrite(str(path), crop)
    print(f"  Saved template: {path.name} ({w}×{h}px)", file=sys.stderr)


def write_player_regions(regions: dict[str, dict[str, float]]) -> None:
    inn = regions["innate"]
    ih  = inn["h"]
    ix, iy, iw = inn["x"], inn["y"], inn["w"]

    def off(r: dict[str, float], from_right: bool = False) -> dict[str, float]:
        ox = ix + iw if from_right else ix
        return {
            "dx": round((r["x"] - ox) / ih, 4),
            "dy": round((r["y"] - iy) / ih, 4),
            "w":  round( r["w"]       / ih, 4),
            "h":  round( r["h"]       / ih, 4),
        }

    skill1_off = off(regions["skill_1"])
    level_off  = off(regions["level"])
    item_off  = off(regions["item_0"], from_right=True)
    slot_w    = round(regions["item_0"]["w"] / ih, 4)
    slot_h    = round(regions["item_0"]["h"] / ih, 4)
    slot_gap  = SLOT_GAP_DEFAULT

    # Frame-relative item offsets (items anchored from panel frame at detection time)
    item0  = regions["item_0"]
    pframe = regions["panel_frame"]
    col2_right_px  = item0["x"] + (3 * item0["w"] + 2 * slot_gap * ih)
    frame_items_dx = round((col2_right_px - pframe["x"]) / ih, 4)
    frame_items_dy = round((item0["y"] - pframe["y"]) / ih, 4)

    content = f'''"""
Player panel detection configuration.
Auto-generated by calibrate_player.py — do not edit manually.
Re-run calibrate_player.py to recalibrate.
"""

INNATE_THRESHOLD = {INNATE_THRESHOLD}
FRAME_THRESHOLD  = 0.75

# All offsets relative to detected innate icon height (innate_h).
# Origin: innate icon top-left. Positive = right / down.
# pixel_offset = ratio * innate_h at detection time.

SKILL_1 = {skill1_off}
LEVEL   = {level_off}
ITEM_0  = {item_off}  # from innate RIGHT edge — used by --update-frame

# Item grid: 2 rows × 3 cols, anchored from the panel frame (right anchor).
# FRAME_ITEMS_DX: from frame.x to right edge of column 2 (negative = items left of frame).
# FRAME_ITEMS_DY: from frame.y to top of row 0.
SLOT_W         = {slot_w}
SLOT_H         = {slot_h}
SLOT_GAP       = {slot_gap}
FRAME_ITEMS_DX = {frame_items_dx}
FRAME_ITEMS_DY = {frame_items_dy}
NUM_ITEM_SLOTS = 6
'''
    PLAYER_REGIONS_OUT.write_text(content, encoding="utf-8")
    print(f"\nSaved: {PLAYER_REGIONS_OUT.name}", file=sys.stderr)
    for k, v in [("SKILL_1", skill1_off), ("LEVEL", level_off), ("ITEM_0", item_off)]:
        print(f"  {k}: {v}", file=sys.stderr)
    print(f"  SLOT: w={slot_w}  h={slot_h}", file=sys.stderr)


def _match_template_multiscale(
    img: np.ndarray,
    tmpl: np.ndarray,
    threshold: float,
    roi_top: float = 0.60,
) -> tuple[int, int, int, int] | None:
    """Return (x, y, w, h) of best match in the bottom portion of img, or None."""
    sh = img.shape[0]
    roi = cv2.cvtColor(img[int(sh * roi_top):], cv2.COLOR_BGR2GRAY)
    tg  = cv2.cvtColor(tmpl, cv2.COLOR_BGR2GRAY) if len(tmpl.shape) == 3 else tmpl
    th, tw = tg.shape[:2]

    best: tuple[int, int, int, int] | None = None
    best_score = threshold
    for s in np.linspace(0.5, 2.5, 40):
        nw, nh = int(tw * s), int(th * s)
        if nw < 8 or nh < 8 or nw > roi.shape[1] or nh > roi.shape[0]:
            continue
        resized = cv2.resize(tg, (nw, nh), interpolation=cv2.INTER_AREA)
        result  = cv2.matchTemplate(roi, resized, cv2.TM_CCOEFF_NORMED)
        _, val, _, loc = cv2.minMaxLoc(result)
        if val > best_score:
            best_score = val
            best = (loc[0], int(sh * roi_top) + loc[1], nw, nh)
    return best


def _offset_from_innate(inn: dict[str, float], r: dict[str, float]) -> dict[str, float]:
    """Region r as a ratio offset from the innate icon's top-left (innate_h units)."""
    ih = inn["h"]
    return {
        "dx": round((r["x"] - inn["x"]) / ih, 4),
        "dy": round((r["y"] - inn["y"]) / ih, 4),
        "w":  round( r["w"]             / ih, 4),
        "h":  round( r["h"]             / ih, 4),
    }


def _patch_skill_region(skill_off: dict[str, float]) -> None:
    """Overwrite the SKILL_1 line in player_regions.py (adds it if absent)."""
    import re
    if not PLAYER_REGIONS_OUT.exists():
        print("player_regions.py not found — run full calibration first.", file=sys.stderr)
        return
    text = PLAYER_REGIONS_OUT.read_text(encoding="utf-8")
    text = re.sub(r"^# SKILL_1 is a placeholder.*\n", "", text, flags=re.MULTILINE)
    line = f"SKILL_1 = {skill_off}"
    if re.search(r"^SKILL_1\s*=", text, re.MULTILINE):
        text = re.sub(r"^SKILL_1\s*=.*$", line, text, flags=re.MULTILINE)
    else:
        text += f"\n{line}\n"
    PLAYER_REGIONS_OUT.write_text(text, encoding="utf-8")
    print(f"  SKILL_1 = {skill_off}", file=sys.stderr)


def _patch_player_regions(frame_items_dx: float, frame_items_dy: float) -> None:
    """Overwrite FRAME_ITEMS_DX/DY lines in player_regions.py (adds them if absent)."""
    import re
    if not PLAYER_REGIONS_OUT.exists():
        print("player_regions.py not found — run full calibration first.", file=sys.stderr)
        return
    text = PLAYER_REGIONS_OUT.read_text(encoding="utf-8")
    for var, val in [("FRAME_ITEMS_DX", frame_items_dx), ("FRAME_ITEMS_DY", frame_items_dy)]:
        if re.search(rf"^{var}\s*=", text, re.MULTILINE):
            text = re.sub(rf"^{var}\s*=.*$", f"{var} = {val}", text, flags=re.MULTILINE)
        else:
            text += f"\n{var} = {val}\n"
    PLAYER_REGIONS_OUT.write_text(text, encoding="utf-8")
    print(f"  FRAME_ITEMS_DX = {frame_items_dx}", file=sys.stderr)
    print(f"  FRAME_ITEMS_DY = {frame_items_dy}", file=sys.stderr)


def update_frame_offsets(img: np.ndarray) -> bool:
    """Match innate + panel_frame templates on screen, compute offsets, patch player_regions.py."""
    from player_regions import ITEM_0, SLOT_W, SLOT_H

    innate_path = TEMPLATES_DIR / "innate_frame.png"
    frame_path  = TEMPLATES_DIR / "panel_frame.png"

    for p in (innate_path, frame_path):
        if not p.exists():
            print(f"{p.name} not found. Run full calibration first.", file=sys.stderr)
            return False

    innate_tmpl = cv2.imread(str(innate_path))
    innate_box  = _match_template_multiscale(img, innate_tmpl, 0.65)
    if innate_box is None:
        print("Could not find innate icon. Make sure the player panel is visible.", file=sys.stderr)
        return False
    ix, iy, iw, ih_int = innate_box
    ih = float(ih_int)
    print(f"  Innate found at ({ix},{iy}) h={ih_int}", file=sys.stderr)

    frame_tmpl = cv2.imread(str(frame_path))
    frame_box  = _match_template_multiscale(img, frame_tmpl, 0.65)
    if frame_box is None:
        print("Could not find panel frame. Make sure the player panel is visible.", file=sys.stderr)
        return False
    print(f"  Frame found at ({frame_box[0]},{frame_box[1]})", file=sys.stderr)

    item0_x       = ix + iw + ITEM_0["dx"] * ih
    item0_y       = iy      + ITEM_0["dy"] * ih
    col2_right    = item0_x + (3 * SLOT_W + 2 * SLOT_GAP_DEFAULT) * ih
    frame_items_dx = round((col2_right - frame_box[0]) / ih, 4)
    frame_items_dy = round((item0_y    - frame_box[1]) / ih, 4)

    _patch_player_regions(frame_items_dx, frame_items_dy)
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--monitor", type=int, default=2)
    parser.add_argument("--frame", action="store_true",
                        help="Extract panel_frame template only (2 clicks)")
    parser.add_argument("--skill", action="store_true",
                        help="Recalibrate SKILL_1 only (2 clicks on skill 1; innate auto-detected)")
    parser.add_argument("--update-frame", action="store_true",
                        help="Auto-detect frame position from existing templates and update player_regions.py")
    args = parser.parse_args()

    with mss.mss() as sct:
        if args.monitor >= len(sct.monitors):
            avail = len(sct.monitors) - 1
            print(f"Monitor {args.monitor} not found. Available: 1-{avail}", file=sys.stderr)
            sys.exit(1)
        mon = sct.monitors[args.monitor]
        sw, sh = mon["width"], mon["height"]
        shot = sct.grab(mon)
        img_orig = cv2.cvtColor(np.array(shot), cv2.COLOR_BGRA2BGR)

    print(f"Captured monitor {args.monitor}: {sw}×{sh}", file=sys.stderr)
    TEMPLATES_DIR.mkdir(exist_ok=True)

    if args.update_frame:
        print("\nAuto-detecting frame position from existing templates...", file=sys.stderr)
        ok = update_frame_offsets(img_orig)
        if ok:
            print("\nplayer_regions.py updated. Run detect_players.py --debug to verify.", file=sys.stderr)
        else:
            print("\nFailed. Check that the panel is visible and templates exist.", file=sys.stderr)
    elif args.skill:
        innate_path = TEMPLATES_DIR / "innate_frame.png"
        if not innate_path.exists():
            print("innate_frame.png not found. Run full calibration first.", file=sys.stderr)
            return
        innate_box = _match_template_multiscale(img_orig, cv2.imread(str(innate_path)), 0.65)
        if innate_box is None:
            print("Could not auto-detect the innate icon. Make sure the panel is visible.", file=sys.stderr)
            return
        ix, iy, iw, ih = innate_box
        inn = {"x": float(ix), "y": float(iy), "w": float(iw), "h": float(ih)}
        print(f"  Innate auto-detected at ({ix},{iy}) {iw}x{ih}", file=sys.stderr)

        steps = [("skill_1", "FIRST ABILITY (skill 1) icon", (255, 200, 0))]
        ref   = [(ix, iy, iw, ih, (0, 200, 255), "innate (auto)")]
        print("\nSkill calibration — 2 clicks on skill 1 (innate auto-detected).", file=sys.stderr)
        results = run_calibration(img_orig, sw, sh, steps, ref_boxes=ref)
        if "skill_1" not in results:
            print("Incomplete — need skill_1. Aborting.", file=sys.stderr)
            return
        _patch_skill_region(_offset_from_innate(inn, results["skill_1"]))
        print("\nSKILL_1 updated. Run detect_players.py --debug to verify.", file=sys.stderr)
    elif args.frame:
        key, label, color = ("panel_frame", "PANEL FRAME (trapezoid on right edge)", (100, 200, 255))
        print(f"\nFrame template mode — {label}", file=sys.stderr)
        results = run_calibration(img_orig, sw, sh, [(key, label, color)])
        if key in results:
            save_template(key, img_orig, results[key])
            print("Done.", file=sys.stderr)
        else:
            print("Cancelled — no clicks recorded.", file=sys.stderr)
    else:
        print("\nFull calibration — 10 clicks total.", file=sys.stderr)
        results = run_calibration(img_orig, sw, sh, FULL_STEPS)
        if len(results) < len(FULL_STEPS):
            print(f"Incomplete ({len(results)}/{len(FULL_STEPS)} steps). Aborting.", file=sys.stderr)
            return
        save_template("innate_frame", img_orig, results["innate"])
        save_template("panel_frame",  img_orig, results["panel_frame"])
        write_player_regions(results)
        print("\nCalibration complete!", file=sys.stderr)


if __name__ == "__main__":
    main()
