#!/usr/bin/env python3
"""Release check for the prompt guide (maintainer only; run before a dashboard release).

The guide in hooks/prompt-guide.ts was written against a stamped version of
each Companion plugin (GUIDE_STAMP). This compares those stamps with the
versions installed on this machine, as `claude plugin list --json` reports
them, and fails when a plugin has moved on, printing the command that drafts
the update. It changes nothing and needs no model.

Usage: python3 scripts/guide-check.py [dashboard-folder]
Exit 0: every stamped plugin is current, or not installed here.
Exit 1: a stamp is behind the installed version.
"""

import json
import pathlib
import re
import subprocess
import sys


def stamps(guide_source: str) -> dict[str, str]:
    block = re.search(r"GUIDE_STAMP[^=]*=\s*\{(.*?)\}", guide_source, re.S)
    if not block:
        sys.exit("guide-check: GUIDE_STAMP not found in hooks/prompt-guide.ts")
    return dict(re.findall(r"'([\w-]+)':\s*'([\d.]+)'", block.group(1)))


def installed(list_json: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for entry in json.loads(list_json):
        plugin_id = entry.get("id", "")
        name = plugin_id.split("@")[0]
        if entry.get("enabled") is True and plugin_id.endswith("@boomi-companion") and entry.get("version"):
            found[name] = entry["version"]
    return found


def numbers(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", version))


def main() -> int:
    folder = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parent.parent)
    stamped = stamps((folder / "hooks" / "prompt-guide.ts").read_text(encoding="utf-8"))
    try:
        listed = subprocess.run(["claude", "plugin", "list", "--json"], capture_output=True, text=True, timeout=60, check=True).stdout
    except (OSError, subprocess.SubprocessError) as error:
        sys.exit(f"guide-check: could not list the installed plugins ({error}). Run it again where `claude` is on the PATH.")
    here = installed(listed)

    behind = []
    for name, stamp in sorted(stamped.items()):
        version = here.get(name)
        if version is None:
            print(f"{name}: not installed here; nothing to compare (stamped {stamp}).")
        elif numbers(version) > numbers(stamp):
            behind.append((name, stamp, version))
            print(f"{name}: the guide was written for {stamp}, installed is {version}.")
        else:
            print(f"{name}: current (stamped {stamp}, installed {version}).")

    if not behind:
        return 0
    for name, stamp, version in behind:
        print(f"\nTo update the guide for {name} {version}:")
        print("  1. In a Claude Code session in a Companion folder, run: /bc-dashboard prompt guide refresh")
        print("  2. Read each draft line against the note it names, and keep only the ones that hold.")
        print(f"  3. Edit GUIDE in hooks/prompt-guide.ts, then set GUIDE_STAMP['{name}'] to '{version}'.")
        print("  4. Run this check again: it should pass before the release.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
