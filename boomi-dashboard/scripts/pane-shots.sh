#!/usr/bin/env bash
# Redraws the README's pane screenshots (assets/pane-exosphere-light.png and
# -dark.png) from the test kit's sample session. Needs Google Chrome and Pillow.
set -euo pipefail
cd "$(dirname "$0")/.."

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

claude plugin test . > "$work/test.out" 2>&1 || { tail -40 "$work/test.out"; exit 1; }

python3 -I - "$work" <<'PY'
import re, sys
for line in open(f'{sys.argv[1]}/test.out'):
    # The name becomes a file name: letters, digits, - and _ only, so it can't leave the work folder.
    m = re.match(r'\s*PANE-TREE ([A-Za-z0-9_-]+) (.*)$', line)
    if m:
        open(f'{sys.argv[1]}/{m.group(1)}.json', 'w').write(m.group(2))
PY

python3 scripts/pane-shot.py "$work/exosphere-light.json" assets/pane-exosphere-light.png
python3 scripts/pane-shot.py "$work/exosphere-dark.json" assets/pane-exosphere-dark.png --link '#66b6f6' --rule '#707070'
