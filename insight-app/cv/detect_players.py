"""
Detect hero name, level, and item slots from the Dota 2 player panel.

Usage:
    python detect_players.py [--monitor auto|N] [--debug]   # single shot
    python detect_players.py [--monitor auto|N] --watch      # persistent mode

Watch mode: templates are loaded once at startup, then the process reads
newline triggers from stdin and writes JSON results to stdout.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import NamedTuple

import cv2
import numpy as np
import mss

from player_regions import (
    INNATE_THRESHOLD, FRAME_THRESHOLD,
    SKILL_1, LEVEL, SLOT_W, SLOT_H, SLOT_GAP, SLOT_GAP_H_PX, ITEMS_OFFSET_X,
    FRAME_ITEMS_DX, FRAME_ITEMS_DY, NUM_ITEM_SLOTS,
    ITEM_CROP_TOP_PX, ITEM_CROP_BOTTOM_PX,
)
from screen import resolve_monitor

SCRIPT_DIR    = Path(__file__).parent
TEMPLATES_DIR = SCRIPT_DIR / "templates"
ITEMS_DIR     = SCRIPT_DIR / "item_icons"
DEBUG_DIR     = SCRIPT_DIR / "debug"

# Innate and frame are detected independently and sit in different, non-overlapping
# columns of the HUD panel, so each gets its own (narrower) search box.
INNATE_SEARCH_X0 = 0.34
INNATE_SEARCH_X1 = 0.44
FRAME_SEARCH_X0  = 0.72
FRAME_SEARCH_X1  = 0.80
PANEL_SEARCH_Y0  = 0.80


# ── core types ────────────────────────────────────────────────────────────────

class Box(NamedTuple):
    x: int
    y: int
    w: int
    h: int
    score: float


class Templates(NamedTuple):
    innate:          np.ndarray
    frame:           np.ndarray
    skill_templates: dict[str, list[np.ndarray]]
    level_templates: dict[int, np.ndarray]
    item_templates:  dict[str, np.ndarray]


# ── template loading ──────────────────────────────────────────────────────────

def load_template(name: str) -> np.ndarray | None:
    path = TEMPLATES_DIR / f"{name}.png"
    if not path.exists():
        return None
    return cv2.imread(str(path))


def load_all_templates() -> Templates | None:
    innate = load_template("innate_frame")
    frame  = load_template("panel_frame")
    if innate is None or frame is None:
        print("innate_frame.png or panel_frame.png missing — run calibrate_player.py first",
              file=sys.stderr)
        return None

    skill_tmpls: dict[str, list[np.ndarray]] = {}
    skill_dir = SCRIPT_DIR / "skill_templates"
    if skill_dir.exists():
        for p in skill_dir.glob("*.png"):
            img = cv2.imread(str(p))
            if img is not None:
                skill_tmpls[p.stem] = [to_gray(img)]

    skill_variant_count = 0
    skill_variants_dir = skill_dir / "variants"
    if skill_variants_dir.exists():
        for p in skill_variants_dir.glob("*.png"):
            hero_name = p.stem.rsplit("_v", 1)[0]
            img = cv2.imread(str(p))
            if img is None:
                continue
            skill_tmpls.setdefault(hero_name, []).append(to_gray(img))
            skill_variant_count += 1

    level_tmpls: dict[int, np.ndarray] = {}
    level_dir = SCRIPT_DIR / "level_templates"
    if level_dir.exists():
        for lvl in range(1, 31):
            p = level_dir / f"{lvl}.png"
            if p.exists():
                img = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
                if img is not None:
                    level_tmpls[lvl] = img

    item_tmpls: dict[str, np.ndarray] = {}
    if ITEMS_DIR.exists():
        for p in ITEMS_DIR.glob("*.png"):
            img = cv2.imread(str(p))
            if img is not None:
                item_tmpls[p.stem] = to_gray(img)

    print(
        f"Templates loaded: {len(skill_tmpls)} hero skills "
        f"({skill_variant_count} variants), "
        f"{len(level_tmpls)} levels, {len(item_tmpls)} items",
        file=sys.stderr,
    )
    return Templates(innate, frame, skill_tmpls, level_tmpls, item_tmpls)


# ── image utilities ───────────────────────────────────────────────────────────

def to_gray(img: np.ndarray) -> np.ndarray:
    return img if len(img.shape) == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def capture_screen(monitor_num: int) -> tuple[np.ndarray, int, int]:
    with mss.mss() as sct:
        if monitor_num >= len(sct.monitors):
            avail = len(sct.monitors) - 1
            print(f"Monitor {monitor_num} not found. Available: 1-{avail}", file=sys.stderr)
            sys.exit(1)
        mon = sct.monitors[monitor_num]
        shot = sct.grab(mon)
        img = cv2.cvtColor(np.array(shot), cv2.COLOR_BGRA2BGR)
        return img, mon["width"], mon["height"]


def crop(screen: np.ndarray, x: int, y: int, w: int, h: int) -> np.ndarray:
    sh, sw = screen.shape[:2]
    x1, y1 = max(0, x), max(0, y)
    x2, y2 = min(sw, x + w), min(sh, y + h)
    return screen[y1:y2, x1:x2]


# ── detection ─────────────────────────────────────────────────────────────────

def find_template_multiscale(
    screen: np.ndarray,
    template: np.ndarray,
    threshold: float,
    roi_x0: float,
    roi_x1: float,
    scale_range: tuple[float, float] = (0.5, 2.5),
    steps: int = 40,
    roi_y0: float = PANEL_SEARCH_Y0,
) -> Box | None:
    sh, sw = screen.shape[:2]
    roi_x0_px = int(sw * roi_x0)
    roi_x1_px = int(sw * roi_x1)
    roi_y_px  = int(sh * roi_y0)
    sg     = to_gray(screen[roi_y_px:, roi_x0_px:roi_x1_px])
    tg     = to_gray(template)
    th, tw = tg.shape[:2]
    best: Box | None = None

    for s in np.linspace(scale_range[0], scale_range[1], steps):
        nw, nh = int(tw * s), int(th * s)
        if nw < 8 or nh < 8 or nw > sg.shape[1] or nh > sg.shape[0]:
            continue
        resized = cv2.resize(tg, (nw, nh), interpolation=cv2.INTER_AREA)
        result  = cv2.matchTemplate(sg, resized, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(result)
        if max_val > threshold and (best is None or max_val > best.score):
            best = Box(roi_x0_px + max_loc[0], roi_y_px + max_loc[1], nw, nh, max_val)

    return best


def derive_regions(innate: Box, frame: Box) -> dict:
    ih = float(innate.h)

    def region(off: dict, from_right: bool = False) -> tuple[int, int, int, int]:
        ox = innate.x + innate.w if from_right else innate.x
        return (
            int(ox + off["dx"] * ih),
            int(innate.y + off["dy"] * ih),
            int(off["w"] * ih),
            int(off["h"] * ih),
        )

    slot_w_px = int(SLOT_W   * ih)
    slot_h_px = int(SLOT_H   * ih)
    gap_h_px  = int(SLOT_GAP * ih) + SLOT_GAP_H_PX
    gap_v_px  = int(SLOT_GAP * ih)
    col2_right = frame.x + int(FRAME_ITEMS_DX * ih)
    row0_top   = frame.y + int(FRAME_ITEMS_DY * ih)

    items = []
    for row in range(2):
        for col in range(3):
            sx = col2_right - (3 - col) * slot_w_px - (2 - col) * gap_h_px + ITEMS_OFFSET_X
            sy = row0_top + row * (slot_h_px + gap_v_px)
            items.append((sx, sy, slot_w_px, slot_h_px))

    return {"skill_1": region(SKILL_1), "level": region(LEVEL), "items": items}


SKILL_MATCH_THRESHOLD = 0.55

def match_hero_skill(
    skill_img: np.ndarray,
    skill_templates: dict[str, list[np.ndarray]],
) -> tuple[str, float]:
    if skill_img.size == 0 or not skill_templates:
        return "unknown", 0.0
    sg = to_gray(skill_img)
    best_name, best_score = "unknown", 0.0
    for hero, tmpls in skill_templates.items():
        for tmpl in tmpls:
            resized = cv2.resize(tmpl, (sg.shape[1], sg.shape[0]), interpolation=cv2.INTER_AREA)
            _, val, _, _ = cv2.minMaxLoc(cv2.matchTemplate(sg, resized, cv2.TM_CCOEFF_NORMED))
            if val > best_score:
                best_score = val
                best_name  = hero
    return (best_name, best_score) if best_score >= SKILL_MATCH_THRESHOLD else ("unknown", best_score)


def match_level(
    level_img: np.ndarray,
    level_templates: dict[int, np.ndarray],
) -> int:
    if level_img.size == 0 or not level_templates:
        return 0
    proc = to_gray(level_img)
    best_lvl, best_score = 0, 0.0
    for lvl, tmpl in level_templates.items():
        t = tmpl if tmpl.shape == proc.shape else cv2.resize(tmpl, (proc.shape[1], proc.shape[0]), interpolation=cv2.INTER_AREA)
        score = float(cv2.matchTemplate(proc, t, cv2.TM_CCOEFF_NORMED)[0, 0])
        if score > best_score:
            best_score = score
            best_lvl   = lvl
    return best_lvl if best_score >= 0.60 else 0


def _crop_vertical(img: np.ndarray, top_px: int, bottom_px: int) -> np.ndarray:
    h = img.shape[0]
    top, bottom = min(top_px, h), min(bottom_px, h)
    return img[top:h - bottom, :] if h - top - bottom > 0 else img


ITEM_MATCH_THRESHOLD = 0.7

# match_items compares equally-sized images, so TM_CCOEFF_NORMED reduces to a
# single Pearson correlation coefficient per template — cheaper to batch as one
# matrix-vector product than to call cv2.matchTemplate per item. Templates are
# resized once per distinct slot size and cached, since that size is stable
# across frames (it only tracks the detected panel scale, not per-frame noise).
_ITEM_TEMPLATE_CACHE: dict[tuple[int, int, float, float], tuple[np.ndarray, list[str]]] = {}


def _normalize_flat(img: np.ndarray) -> np.ndarray | None:
    flat = img.astype(np.float32).ravel()
    flat -= flat.mean()
    norm = float(np.linalg.norm(flat))
    return (flat / norm) if norm > 1e-6 else None


def _build_item_template_cache(
    item_templates: dict[str, np.ndarray],
    target_w: int,
    target_h: int,
    top_frac: float,
    bottom_frac: float,
) -> tuple[np.ndarray, list[str]]:
    names: list[str] = []
    vecs:  list[np.ndarray] = []
    for item_name, tmpl in item_templates.items():
        th = tmpl.shape[0]
        tmpl_cropped = _crop_vertical(tmpl, round(top_frac * th), round(bottom_frac * th))
        resized = cv2.resize(tmpl_cropped, (target_w, target_h), interpolation=cv2.INTER_AREA)
        vec = _normalize_flat(resized)
        if vec is None:
            continue
        names.append(item_name)
        vecs.append(vec)
    matrix = np.stack(vecs) if vecs else np.zeros((0, target_w * target_h), dtype=np.float32)
    return matrix, names


def match_items(
    slot_imgs: list[np.ndarray],
    item_templates: dict[str, np.ndarray],
) -> list[tuple[str, float]]:
    results: list[tuple[str, float]] = []
    for slot_img in slot_imgs:
        if slot_img.size == 0:
            results.append(("empty", 0.0))
            continue
        sg = to_gray(slot_img)
        sh = sg.shape[0]
        sg_cropped  = _crop_vertical(sg, ITEM_CROP_TOP_PX, ITEM_CROP_BOTTOM_PX)
        top_frac    = ITEM_CROP_TOP_PX / sh
        bottom_frac = ITEM_CROP_BOTTOM_PX / sh
        target_h, target_w = sg_cropped.shape[:2]

        cache_key = (target_w, target_h, round(top_frac, 4), round(bottom_frac, 4))
        matrix, names = _ITEM_TEMPLATE_CACHE.setdefault(
            cache_key,
            _build_item_template_cache(item_templates, target_w, target_h, top_frac, bottom_frac),
        )

        query_vec = _normalize_flat(sg_cropped)
        if query_vec is None or matrix.shape[0] == 0:
            results.append(("unknown", 0.0))
            continue

        scores      = matrix @ query_vec
        best_idx    = int(np.argmax(scores))
        best_score  = float(scores[best_idx])
        best_name   = names[best_idx] if best_score >= ITEM_MATCH_THRESHOLD else "unknown"
        results.append((best_name, best_score))
    return results


def detect_once(
    monitor_num: int,
    tmpls: Templates,
    debug: bool = False,
) -> dict | None:
    screen, _sw, _sh = capture_screen(monitor_num)

    innate = find_template_multiscale(screen, tmpls.innate, INNATE_THRESHOLD, INNATE_SEARCH_X0, INNATE_SEARCH_X1)
    if innate is None:
        return None
    print(f"Innate ({innate.score:.2f})", file=sys.stderr)

    frame = find_template_multiscale(screen, tmpls.frame, FRAME_THRESHOLD, FRAME_SEARCH_X0, FRAME_SEARCH_X1)
    if frame is None:
        return None
    print(f"Frame ({frame.score:.2f})", file=sys.stderr)

    regions  = derive_regions(innate, frame)
    skill_img = crop(screen, *regions["skill_1"])
    level_img = crop(screen, *regions["level"])
    item_imgs = [crop(screen, *r) for r in regions["items"]]

    hero_name, skill_score = match_hero_skill(skill_img, tmpls.skill_templates)
    level      = match_level(level_img, tmpls.level_templates)
    item_results = match_items(item_imgs, tmpls.item_templates)

    print(f"Hero:{hero_name}({skill_score:.2f}) Lvl:{level} "
          f"Items:{[f'{n}({s:.2f})' for n,s in item_results]}",
          file=sys.stderr)

    if debug:
        _save_debug(screen, innate, frame, regions, skill_img, level_img,
                    item_imgs, item_results)

    return {
        "heroName": hero_name,
        "level":    level,
        "items":    [name for name, _ in item_results],
    }


# ── watch mode ────────────────────────────────────────────────────────────────

def watch_mode(monitor_num: int) -> None:
    """Load templates once, then detect on each newline received from stdin."""
    tmpls = load_all_templates()
    if tmpls is None:
        sys.exit(1)

    print("READY", flush=True)
    print("READY", file=sys.stderr)

    for _ in sys.stdin:
        result = detect_once(monitor_num, tmpls)
        if result is not None:
            print(json.dumps(result), flush=True)
        else:
            print("null", flush=True)


# ── debug helper ──────────────────────────────────────────────────────────────

def _save_debug(
    screen: np.ndarray,
    innate: Box,
    frame: Box,
    regions: dict,
    skill_img: np.ndarray,
    level_img: np.ndarray,
    item_imgs: list[np.ndarray],
    item_results: list[tuple[str, float]],
) -> None:
    DEBUG_DIR.mkdir(exist_ok=True)
    ann = screen.copy()

    cv2.rectangle(ann, (innate.x, innate.y), (innate.x + innate.w, innate.y + innate.h), (0, 200, 255), 2)
    cv2.putText(ann, f"innate {innate.score:.2f}", (innate.x, innate.y - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 200, 255), 1)

    cv2.rectangle(ann, (frame.x, frame.y), (frame.x + frame.w, frame.y + frame.h), (100, 200, 255), 2)
    cv2.putText(ann, f"frame {frame.score:.2f}", (frame.x, frame.y - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (100, 200, 255), 1)

    for key, color, label in [("skill_1", (255, 200, 0), "skill1"), ("level", (255, 100, 255), "lvl")]:
        rx, ry, rw, rh = regions[key]
        cv2.rectangle(ann, (rx, ry), (rx + rw, ry + rh), color, 2)
        cv2.putText(ann, label, (rx, ry - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)

    for i, (rx, ry, rw, rh) in enumerate(regions["items"]):
        item_name, score = item_results[i] if i < len(item_results) else ("?", 0.0)
        color = (0, 255, 100) if score >= 0.30 else (0, 100, 255)
        cv2.rectangle(ann, (rx, ry), (rx + rw, ry + rh), color, 1)
        cv2.putText(ann, item_name[:12],      (rx + 1, ry + 10), cv2.FONT_HERSHEY_SIMPLEX, 0.28, color, 1)
        cv2.putText(ann, f"{score:.2f}", (rx + 1, ry + rh - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.28, color, 1)

    cv2.imwrite(str(DEBUG_DIR / "player_annotated.png"), ann)
    if skill_img.size > 0:
        cv2.imwrite(str(DEBUG_DIR / "player_skill.png"),
                    cv2.resize(skill_img, (skill_img.shape[1] * 3, skill_img.shape[0] * 3), interpolation=cv2.INTER_NEAREST))
        proc = to_gray(skill_img)
        cv2.imwrite(str(DEBUG_DIR / "player_skill_processed.png"),
                    cv2.resize(proc, (proc.shape[1] * 3, proc.shape[0] * 3), interpolation=cv2.INTER_NEAREST))
    if level_img.size > 0:
        cv2.imwrite(str(DEBUG_DIR / "player_level.png"),
                    cv2.resize(level_img, (level_img.shape[1] * 3, level_img.shape[0] * 3), interpolation=cv2.INTER_NEAREST))
    for i, si in enumerate(item_imgs):
        if si.size > 0:
            name = item_results[i][0] if i < len(item_results) else "slot"
            cv2.imwrite(str(DEBUG_DIR / f"item_{i}_{name}.png"), si)
    print(f"Debug saved to {DEBUG_DIR}", file=sys.stderr)


# ── entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--monitor", type=str, default="auto",
                        help="Monitor: 'auto' (find the Dota window) or an index (1=primary, 2=second, …)")
    parser.add_argument("--debug",  action="store_true")
    parser.add_argument("--watch",  action="store_true",
                        help="Persistent mode: load templates once, detect on stdin newlines")
    args = parser.parse_args()

    # 'auto' → находим монитор с окном dota2.exe; число → берём как есть.
    # В watch-режиме резолв происходит один раз при старте процесса.
    monitor_num = resolve_monitor(args.monitor)

    if args.watch:
        watch_mode(monitor_num)
    else:
        tmpls = load_all_templates()
        if tmpls is None:
            sys.exit(1)
        result = detect_once(monitor_num, tmpls, debug=args.debug)
        if result is not None:
            print(json.dumps(result))


if __name__ == "__main__":
    main()
