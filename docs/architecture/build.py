#!/usr/bin/env python3
"""Builds the architecture diagrams: Exosphere standalone files in this folder,
Valence copies in valence/ (for the docs site).

    python3 docs/architecture/build.py
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import d1_overview  # noqa: E402
import d2_prompt_lifecycle  # noqa: E402
import d3_companion_awareness  # noqa: E402
import d4_budget_gate  # noqa: E402
from lib import page  # noqa: E402

DIAGRAMS = [d1_overview, d2_prompt_lifecycle, d3_companion_awareness, d4_budget_gate]


def main() -> None:
    for module in DIAGRAMS:
        for theme, folder in (("exosphere", HERE), ("valence", HERE / "valence")):
            folder.mkdir(exist_ok=True)
            html = page(
                theme,
                slug=module.SLUG,
                eyebrow=module.EYEBROW,
                title=module.TITLE,
                desc=module.DESC,
                viewbox=module.VIEWBOX,
                body=module.body(),
                notes=getattr(module, "NOTES", None),
            )
            out = folder / f"{module.SLUG}.html"
            out.write_text(html, encoding="utf-8")
            print(f"wrote {out.relative_to(HERE.parent.parent)}")


if __name__ == "__main__":
    main()
