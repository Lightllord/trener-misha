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
        {"x_start": 0.0458, "y_start": 0.0861, "x_end": 0.0917, "y_end": 0.1370},
        {"x_start": 0.0458, "y_start": 0.1519, "x_end": 0.0911, "y_end": 0.2009},
        {"x_start": 0.0458, "y_start": 0.2176, "x_end": 0.0911, "y_end": 0.2667},
        {"x_start": 0.0458, "y_start": 0.2815, "x_end": 0.0917, "y_end": 0.3306},
        {"x_start": 0.0453, "y_start": 0.3463, "x_end": 0.0917, "y_end": 0.3963},
        ],
    },
    "dire_picks": {
        "slots": [
        {"x_start": 0.0453, "y_start": 0.4417, "x_end": 0.0911, "y_end": 0.4907},
        {"x_start": 0.0453, "y_start": 0.5065, "x_end": 0.0917, "y_end": 0.5565},
        {"x_start": 0.0458, "y_start": 0.5704, "x_end": 0.0922, "y_end": 0.6204},
        {"x_start": 0.0458, "y_start": 0.6352, "x_end": 0.0917, "y_end": 0.6852},
        {"x_start": 0.0448, "y_start": 0.6981, "x_end": 0.0917, "y_end": 0.7500},
        ],
    },
}

# Template size for matching (width x height)
TEMPLATE_SIZE = (63, 37)

# Minimum confidence threshold for a valid match
CONFIDENCE_THRESHOLD = 0.3
