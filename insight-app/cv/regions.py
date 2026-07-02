"""
Draft screen region definitions for Dota 2 scoreboard.

All coordinates are proportional (0.0 - 1.0) relative to screen dimensions.
Calibrated at 1920x1080 resolution.
Re-run `python calibrate.py` to recalibrate.
"""

# Each slot is defined individually for precise calibration
DRAFT_REGIONS = {
    "radiant_picks": {
        "slots": [
        {"x_start": 0.1120, "y_start": 0.0056, "x_end": 0.1651, "y_end": 0.0287},
        {"x_start": 0.1766, "y_start": 0.0056, "x_end": 0.2297, "y_end": 0.0287},
        {"x_start": 0.2406, "y_start": 0.0056, "x_end": 0.2938, "y_end": 0.0287},
        {"x_start": 0.3057, "y_start": 0.0056, "x_end": 0.3589, "y_end": 0.0287},
        {"x_start": 0.3703, "y_start": 0.0056, "x_end": 0.4234, "y_end": 0.0287},
        ],
    },
    "dire_picks": {
        "slots": [
        {"x_start": 0.5766, "y_start": 0.0056, "x_end": 0.6297, "y_end": 0.0287},
        {"x_start": 0.6411, "y_start": 0.0056, "x_end": 0.6943, "y_end": 0.0287},
        {"x_start": 0.7063, "y_start": 0.0056, "x_end": 0.7589, "y_end": 0.0287},
        {"x_start": 0.7698, "y_start": 0.0056, "x_end": 0.8229, "y_end": 0.0287},
        {"x_start": 0.8349, "y_start": 0.0056, "x_end": 0.8880, "y_end": 0.0287},
        ],
    },
}

# Template size for matching (width x height)
TEMPLATE_SIZE = (63, 37)

# Minimum confidence threshold for a valid match
CONFIDENCE_THRESHOLD = 0.65
