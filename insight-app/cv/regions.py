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
        {"x_start": 0.1281, "y_start": 0.0065, "x_end": 0.1510, "y_end": 0.0676},
        {"x_start": 0.1917, "y_start": 0.0065, "x_end": 0.2146, "y_end": 0.0667},
        {"x_start": 0.2573, "y_start": 0.0065, "x_end": 0.2812, "y_end": 0.0667},
        {"x_start": 0.3229, "y_start": 0.0065, "x_end": 0.3458, "y_end": 0.0648},
        {"x_start": 0.3880, "y_start": 0.0056, "x_end": 0.4104, "y_end": 0.0667},
        ],
    },
    "dire_picks": {
        "slots": [
        {"x_start": 0.5891, "y_start": 0.0065, "x_end": 0.6115, "y_end": 0.0667},
        {"x_start": 0.6547, "y_start": 0.0065, "x_end": 0.6755, "y_end": 0.0676},
        {"x_start": 0.7208, "y_start": 0.0065, "x_end": 0.7411, "y_end": 0.0667},
        {"x_start": 0.7859, "y_start": 0.0065, "x_end": 0.8052, "y_end": 0.0667},
        {"x_start": 0.8479, "y_start": 0.0056, "x_end": 0.8703, "y_end": 0.0676},
        ],
    },
}

# Template size for matching (width x height)
TEMPLATE_SIZE = (63, 37)

# Minimum confidence threshold for a valid match
CONFIDENCE_THRESHOLD = 0.6
