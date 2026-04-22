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
        {"x_start": 0.0286, "y_start": 0.0861, "x_end": 0.0755, "y_end": 0.1370},
        {"x_start": 0.0286, "y_start": 0.1509, "x_end": 0.0755, "y_end": 0.2028},
        {"x_start": 0.0286, "y_start": 0.2148, "x_end": 0.0755, "y_end": 0.2676},
        {"x_start": 0.0286, "y_start": 0.2796, "x_end": 0.0755, "y_end": 0.3315},
        {"x_start": 0.0286, "y_start": 0.3463, "x_end": 0.0755, "y_end": 0.3963},
        ],
    },
    "dire_picks": {
        "slots": [
        {"x_start": 0.0286, "y_start": 0.4398, "x_end": 0.0755, "y_end": 0.4917},
        {"x_start": 0.0292, "y_start": 0.5056, "x_end": 0.0755, "y_end": 0.5565},
        {"x_start": 0.0292, "y_start": 0.5685, "x_end": 0.0755, "y_end": 0.6222},
        {"x_start": 0.0286, "y_start": 0.6343, "x_end": 0.0740, "y_end": 0.6852},
        {"x_start": 0.0286, "y_start": 0.7009, "x_end": 0.0750, "y_end": 0.7500},
        ],
    },
}

# Template size for matching (width x height)
TEMPLATE_SIZE = (63, 37)

# Minimum confidence threshold for a valid match
CONFIDENCE_THRESHOLD = 0.3
