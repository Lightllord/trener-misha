"""
Download Dota 2 item icons from Valve CDN via OpenDota constants API.

Icons are saved to item_icons/{item_name}.png where item_name matches
the GSI item names without the 'item_' prefix (e.g. 'blink', 'power_treads').

Usage:
    python download_item_icons.py
    python download_item_icons.py --skip-existing   # skip already downloaded
"""

import argparse
import sys
import time
import urllib.request
import urllib.error
import json
from pathlib import Path

OPENDOTA_ITEMS_URL = "https://api.opendota.com/api/constants/items"
CDN_URL            = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/{name}.png"

SCRIPT_DIR     = Path(__file__).parent
ITEM_ICONS_DIR = SCRIPT_DIR / "item_icons"

SKIP_PREFIXES = ("recipe_",)  # recipe placeholders — not real inventory items


def fetch_item_list() -> dict:
    print("Fetching item list from OpenDota...", end=" ", flush=True)
    req = urllib.request.Request(OPENDOTA_ITEMS_URL, headers={"User-Agent": "trener-misha-cv/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    print(f"OK — {len(data)} items")
    return data


def download_icon(name: str, dest: Path) -> bool:
    url = CDN_URL.format(name=name)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "trener-misha-cv/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            dest.write_bytes(resp.read())
        return True
    except urllib.error.HTTPError as e:
        if e.code != 404:
            print(f"  HTTP {e.code}: {name}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"  Error {name}: {e}", file=sys.stderr)
        return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-existing", action="store_true",
                        help="Skip items that already have a downloaded icon")
    args = parser.parse_args()

    ITEM_ICONS_DIR.mkdir(exist_ok=True)

    items = fetch_item_list()

    names = sorted(
        name for name in items
        if not any(name.startswith(p) for p in SKIP_PREFIXES)
    )
    print(f"{len(names)} items to process\n")

    ok = skipped = failed = 0
    for i, name in enumerate(names, 1):
        dest = ITEM_ICONS_DIR / f"{name}.png"
        if args.skip_existing and dest.exists():
            skipped += 1
            continue

        success = download_icon(name, dest)
        if success:
            ok += 1
            print(f"  [{i}/{len(names)}] {name}")
        else:
            failed += 1
            print(f"  [{i}/{len(names)}] {name}  — not found, skipped")

        # Be polite to the CDN
        time.sleep(0.05)

    print(f"\nDone: {ok} downloaded, {skipped} skipped, {failed} not found")
    print(f"Icons saved to: {ITEM_ICONS_DIR}")


if __name__ == "__main__":
    main()
