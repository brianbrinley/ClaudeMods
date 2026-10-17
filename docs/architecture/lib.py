"""Shared pieces for the architecture diagrams: the two themes, the page, and
the SVG helpers that hold the diagram-design skill's rules (4px grid, orthogonal
connectors, masked labels, one point per connector).

Every colour and font comes from a profile in profiles/ (Exosphere for the
standalone files, Valence for the docs site). The SVG uses classes, and the page
sets the theme's variables, so one file follows the reader's light or dark.
"""

from __future__ import annotations

from html import escape

# --- Themes (values from profiles/exosphere.md and profiles/valence.md) --------

THEMES = {
    "exosphere": {
        "name": "Boomi Exosphere",
        "fonts": "https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,400;0,500;0,600;1,400&family=Noto+Sans:wght@400;500;600&family=Fira+Mono:wght@400;500&display=swap",
        "title": "'Poppins', system-ui, sans-serif",
        "name_font": "'Noto Sans', system-ui, sans-serif",
        "mono": "'Fira Mono', ui-monospace, monospace",
        "eyebrow": "'Fira Mono', ui-monospace, monospace",
        "title_weight": 500,
        "callout": "'Poppins', system-ui, sans-serif",
        "light": dict(paper="#f5f5f5", paper2="#e5e5e5", ink="#1f1f1f", ink_rgb="31 31 31", muted="#707070", muted_rgb="112 112 112",
                      soft="#666666", rule_solid="#cccccc", accent="#bc4a37", accent_rgb="188 74 55", link="#006cd6", node="#ffffff"),
        "dark": dict(paper="#1f1f1f", paper2="#2e2e2e", ink="#ffffff", ink_rgb="255 255 255", muted="#cccccc", muted_rgb="204 204 204",
                     soft="#b3b3b3", rule_solid="#707070", accent="#ff9685", accent_rgb="255 150 133", link="#66b6f6", node="#2e2e2e"),
    },
    "valence": {
        "name": "Valence, Miami Deco",
        "fonts": "https://fonts.googleapis.com/css2?family=Poiret+One&family=Josefin+Sans:ital,wght@0,400;0,600;0,700;1,400&display=swap",
        "title": "'Poiret One', 'Josefin Sans', system-ui, sans-serif",
        "name_font": "'Josefin Sans', system-ui, sans-serif",
        "mono": "system-ui, -apple-system, 'Segoe UI', sans-serif",
        "eyebrow": "'Josefin Sans', system-ui, sans-serif",
        "title_weight": 400,
        "callout": "'Josefin Sans', system-ui, sans-serif",
        "light": dict(paper="#FBF6EE", paper2="#f1eadd", ink="#0B0B0B", ink_rgb="11 11 11", muted="#52514E", muted_rgb="82 81 78",
                      soft="#52514E", rule_solid="#9A7B3F", accent="#C2185B", accent_rgb="194 24 91", link="#0F766E", node="#ffffff"),
        "dark": dict(paper="#161A2E", paper2="#1F2440", ink="#FFFFFF", ink_rgb="255 255 255", muted="#C9CBE0", muted_rgb="201 203 224",
                     soft="#C9CBE0", rule_solid="#6f6240", accent="#F48FB1", accent_rgb="244 143 177", link="#5EEAD4", node="#1F2440"),
    },
}


def _vars(t: dict) -> str:
    return (
        f"--paper:{t['paper']};--paper-2:{t['paper2']};--ink:{t['ink']};--ink-rgb:{t['ink_rgb']};--muted:{t['muted']};--muted-rgb:{t['muted_rgb']};"
        f"--soft:{t['soft']};--rule-solid:{t['rule_solid']};--accent:{t['accent']};--accent-rgb:{t['accent_rgb']};--link:{t['link']};--node:{t['node']};"
    )


def _css(theme: dict, w: int) -> str:
    return f"""
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    :root {{ {_vars(theme['light'])} color-scheme: light dark;
      --f-title:{theme['title']}; --f-callout:{theme['callout']}; --f-name:{theme['name_font']}; --f-mono:{theme['mono']}; --f-eyebrow:{theme['eyebrow']}; }}
    @media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ {_vars(theme['dark'])} }} }}
    :root[data-theme="dark"] {{ {_vars(theme['dark'])} color-scheme: dark; }}
    :root[data-theme="light"] {{ color-scheme: light; }}
    body {{ font-family: var(--f-name); background: var(--paper); color: var(--ink); min-height: 100vh; padding: 3rem 2rem; }}
    .frame {{ max-width: 1280px; width: 100%; margin: 0 auto; }}
    .diagram-container {{ width: 100%; overflow-x: auto; }}
    .eyebrow {{ font-family: var(--f-eyebrow); font-size: 0.66rem; font-weight: 500; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); margin-bottom: 0.5rem; }}
    h1 {{ font-family: var(--f-title); font-size: clamp(1.5rem, 2.4vw + 0.75rem, 2rem); font-weight: {theme['title_weight']}; letter-spacing: -0.01em; line-height: 1.15; color: var(--ink); margin-bottom: 1.5rem; }}
    svg {{ width: 100%; min-width: {w}px; display: block; }}
    .notes {{ display: grid; grid-template-columns: 1.1fr 1fr 0.9fr; gap: 1rem; margin-top: 1.5rem; }}
    .note {{ background: var(--node); border: 1px solid rgb(var(--ink-rgb) / 0.12); border-radius: 6px; padding: 1rem 1.1rem; }}
    .note h2 {{ font-family: var(--f-name); font-size: 0.8rem; font-weight: 600; margin-bottom: 0.4rem; }}
    .note p {{ font-size: 0.8rem; line-height: 1.5; color: var(--muted); }}
    .note code {{ font-family: ui-monospace, SFMono-Regular, Menlo, 'Fira Mono', monospace; font-size: 0.72rem; color: var(--ink); }}
    @media (max-width: 760px) {{ .notes {{ grid-template-columns: 1fr; }} body {{ padding: 2rem 1rem; }} }}
    @media print {{ .diagram-container {{ overflow-x: visible; }} svg {{ min-width: 0; }} }}
    /* the diagram's roles */
    .paper {{ fill: var(--paper); }}
    .zone {{ fill: rgb(var(--ink-rgb) / 0.02); stroke: rgb(var(--ink-rgb) / 0.10); stroke-width: 0.8; }}
    .n-backend {{ fill: var(--node); stroke: var(--ink); stroke-width: 1; }}
    .n-focal {{ fill: rgb(var(--accent-rgb) / 0.08); stroke: var(--accent); stroke-width: 1.2; }}
    .n-store {{ fill: rgb(var(--ink-rgb) / 0.05); stroke: var(--muted); stroke-width: 1; }}
    .n-external {{ fill: rgb(var(--ink-rgb) / 0.03); stroke: rgb(var(--ink-rgb) / 0.30); stroke-width: 1; }}
    .n-input {{ fill: rgb(var(--muted-rgb) / 0.10); stroke: var(--soft); stroke-width: 1; }}
    .n-input + .tag {{ stroke: rgb(var(--muted-rgb) / 0.50); }}
    .lifeline {{ stroke: rgb(var(--ink-rgb) / 0.20); stroke-width: 1; stroke-dasharray: 3 3; }}
    .bar {{ fill: rgb(var(--ink-rgb) / 0.06); stroke: var(--muted); stroke-width: 0.8; }}
    .seq-frame {{ fill: rgb(var(--ink-rgb) / 0.02); stroke: rgb(var(--ink-rgb) / 0.22); stroke-width: 1; }}
    @media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) .seq-frame {{ fill: rgb(var(--ink-rgb) / 0.04); }} }}
    :root[data-theme="dark"] .seq-frame {{ fill: rgb(var(--ink-rgb) / 0.04); }}
    .frame-tab {{ fill: var(--paper); stroke: rgb(var(--ink-rgb) / 0.22); stroke-width: 1; }}
    .divider {{ stroke: rgb(var(--ink-rgb) / 0.20); stroke-width: 1; stroke-dasharray: 4 3; }}
    .t-op {{ font-family: var(--f-eyebrow); font-size: 8px; letter-spacing: 0.12em; fill: var(--muted); text-anchor: middle; }}
    .t-guard {{ font-family: var(--f-mono); font-size: 8px; letter-spacing: 0.04em; fill: var(--muted); }}
    .t-callout {{ font-family: var(--f-callout); font-style: italic; font-size: 14px; fill: var(--ink); }}
    .leader {{ fill: none; stroke: rgb(var(--ink-rgb) / 0.40); stroke-width: 1; stroke-dasharray: 4 3; }}
    .dot {{ fill: var(--ink); }}
    .tag {{ fill: transparent; stroke-width: 0.8; }}
    .n-backend + .tag {{ stroke: rgb(var(--ink-rgb) / 0.40); }}
    .n-focal + .tag {{ stroke: rgb(var(--accent-rgb) / 0.50); }}
    .n-store + .tag {{ stroke: rgb(var(--muted-rgb) / 0.50); }}
    .n-external + .tag {{ stroke: rgb(var(--ink-rgb) / 0.30); }}
    .t-name {{ font-family: var(--f-name); font-size: 12px; font-weight: 600; fill: var(--ink); text-anchor: middle; }}
    .t-sub {{ font-family: var(--f-mono); font-size: 9px; fill: var(--muted); text-anchor: middle; }}
    .t-tag {{ font-family: var(--f-eyebrow); font-size: 7px; letter-spacing: 0.08em; fill: var(--muted); text-anchor: middle; }}
    .t-zone {{ font-family: var(--f-eyebrow); font-size: 7px; letter-spacing: 0.14em; fill: var(--soft); text-anchor: middle; }}
    .t-arrow {{ font-family: var(--f-mono); font-size: 8px; letter-spacing: 0.06em; fill: var(--soft); text-anchor: middle; }}
    .t-legend {{ font-family: var(--f-eyebrow); font-size: 8px; letter-spacing: 0.14em; fill: var(--muted); }}
    .a {{ fill: none; stroke: var(--muted); stroke-width: 1.2; }}
    .a-accent {{ fill: none; stroke: var(--accent); stroke-width: 1.2; }}
    .a-link {{ fill: none; stroke: var(--link); stroke-width: 1.2; }}
    .dash {{ stroke-dasharray: 5 4; stroke-width: 1; }}
    .m-muted {{ fill: var(--muted); }} .m-accent {{ fill: var(--accent); }} .m-link {{ fill: var(--link); }}
    .rule {{ stroke: rgb(var(--ink-rgb) / 0.10); stroke-width: 0.8; }}
  """


def page(theme_key: str, *, slug: str, eyebrow: str, title: str, desc: str, viewbox: tuple[int, int, int, int], body: str, notes: list[tuple[str, str]] | None = None) -> str:
    theme = THEMES[theme_key]
    x0, y0, w, h = viewbox
    cards = ""
    if notes:
        cards = '<div class="notes">' + "".join(f"<div class=\"note\"><h2>{escape(t)}</h2><p>{p}</p></div>" for t, p in notes) + "</div>"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{escape(title)}</title>
  <link href="{theme['fonts']}" rel="stylesheet">
  <style>{_css(theme, w)}</style>
</head>
<body>
  <div class="frame">
    <p class="eyebrow">{escape(eyebrow)}</p>
    <h1>{escape(title)}</h1>
    <div class="diagram-container">
      <svg viewBox="{x0} {y0} {w} {h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{slug}-title {slug}-desc">
        <title id="{slug}-title">{escape(title)}</title>
        <desc id="{slug}-desc">{escape(desc)}</desc>
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon class="m-muted" points="0 0, 8 3, 0 6"/></marker>
          <marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon class="m-accent" points="0 0, 8 3, 0 6"/></marker>
          <marker id="arrow-link" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon class="m-link" points="0 0, 8 3, 0 6"/></marker>
        </defs>
        <rect class="paper" x="{x0}" y="{y0}" width="{w}" height="{h}"/>
{body}
      </svg>
    </div>
    {cards}
  </div>
</body>
</html>
"""


# --- SVG helpers ----------------------------------------------------------------


def up4(n: float) -> int:
    """Round up to the next multiple of 4 (the skill's grid)."""
    return int(-(-n // 4) * 4)


def zone(x: int, y: int, w: int, h: int, label: str) -> str:
    lw = up4(len(label) * 5.4 + 8)
    cx = x + 16 + lw // 2
    return (
        f'<rect class="zone" x="{x}" y="{y}" width="{w}" height="{h}" rx="8"/>'
        f'<rect class="paper" x="{x + 16}" y="{y + 4}" width="{lw}" height="12" rx="2"/>'
        f'<text class="t-zone" x="{cx}" y="{y + 13}">{escape(label)}</text>'
    )


def node(x: int, y: int, w: int, h: int, kind: str, tag: str, name: str, subs: list[str]) -> str:
    """kind: backend, focal, store or external. Opaque mask, box, rectangular tag, name, sublabels."""
    tw = up4(len(tag) * 5.4 + 8)
    cx = x + w // 2
    out = [
        f'<rect class="paper" x="{x}" y="{y}" width="{w}" height="{h}" rx="6"/>',
        f'<rect class="n-{kind}" x="{x}" y="{y}" width="{w}" height="{h}" rx="6"/>',
        f'<rect class="tag" x="{x + 8}" y="{y + 6}" width="{tw}" height="12" rx="2"/>',
        f'<text class="t-tag" x="{x + 8 + tw // 2}" y="{y + 15}">{escape(tag)}</text>',
        f'<text class="t-name" x="{cx}" y="{y + (h // 2) - 2}">{escape(name)}</text>',
    ]
    for i, s in enumerate(subs):
        out.append(f'<text class="t-sub" x="{cx}" y="{y + (h // 2) + 14 + i * 14}">{escape(s)}</text>')
    return "".join(out)


def path(d: str, kind: str = "a", dashed: bool = False) -> str:
    marker = {"a": "arrow", "a-accent": "arrow-accent", "a-link": "arrow-link"}[kind]
    cls = f"{kind} dash" if dashed else kind
    return f'<path class="{cls}" d="{d}" marker-end="url(#{marker})"/>'


def line(x1: int, y1: int, x2: int, y2: int, kind: str = "a", dashed: bool = False) -> str:
    marker = {"a": "arrow", "a-accent": "arrow-accent", "a-link": "arrow-link"}[kind]
    cls = f"{kind} dash" if dashed else kind
    return f'<line class="{cls}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" marker-end="url(#{marker})"/>'


def lifeline(cx: int, y1: int, y2: int) -> str:
    return f'<line class="lifeline" x1="{cx}" y1="{y1}" x2="{cx}" y2="{y2}"/>'


def bar(cx: int, y1: int, y2: int) -> str:
    """An activation bar, 8 wide: the interval an actor holds control."""
    return f'<rect class="bar" x="{cx - 4}" y="{y1}" width="8" height="{y2 - y1}"/>'


def frame(x: int, y: int, w: int, h: int, op: str) -> str:
    """A combined fragment's frame with its operator tab (ALT, OPT or LOOP) at the top left."""
    return (
        f'<rect class="seq-frame" x="{x}" y="{y}" width="{w}" height="{h}" rx="4"/>'
        f'<rect class="frame-tab" x="{x}" y="{y}" width="40" height="16" rx="2"/>'
        f'<text class="t-op" x="{x + 20}" y="{y + 12}">{escape(op)}</text>'
    )


def guard(x: int, y: int, text: str) -> str:
    return f'<text class="t-guard" x="{x}" y="{y}">{escape(text)}</text>'


def divider(x1: int, x2: int, y: int) -> str:
    return f'<line class="divider" x1="{x1}" y1="{y}" x2="{x2}" y2="{y}"/>'


def callout(x: int, y: int, text: str, anchor: str, lx: int, ly: int, tx: int, ty: int) -> str:
    """An italic aside in a margin, with a dashed leader to (tx, ty) and a landing dot. (lx, ly) is where the leader leaves the text."""
    return (
        f'<text class="t-callout" x="{x}" y="{y}" text-anchor="{anchor}">{escape(text)}</text>'
        f'<path class="leader" d="M{lx},{ly} Q{(lx + tx) // 2},{ly + (ty - ly) // 4} {tx},{ty}"/>'
        f'<circle class="dot" cx="{tx}" cy="{ty}" r="2"/>'
    )


def self_loop(cx: int, y: int, text: str) -> str:
    """A self-message: a short U-shaped loop leaving the right of a lifeline's bar and returning, the label right of it."""
    x = cx + 4
    d = f"M{x},{y} H{x + 24} Q{x + 32},{y} {x + 32},{y + 8} V{y + 16} Q{x + 32},{y + 24} {x + 24},{y + 24} H{x}"
    w = up4(len(text) * 5.44 + 8)
    return (
        f'<path class="a" d="{d}" marker-end="url(#arrow)"/>'
        f'<rect class="paper" x="{x + 44}" y="{y + 6}" width="{w}" height="12" rx="2"/>'
        f'<text class="t-arrow" x="{x + 44 + w // 2}" y="{y + 15}">{escape(text)}</text>'
    )


def label(cx: int, cy: int, text: str) -> str:
    """An arrow label on an opaque mask, centred on (cx, cy). The caller keeps the 6 to 10px gap from the stroke."""
    w = up4(len(text) * 5.44 + 8)
    return f'<rect class="paper" x="{cx - w // 2}" y="{cy - 6}" width="{w}" height="12" rx="2"/><text class="t-arrow" x="{cx}" y="{cy + 3}">{escape(text)}</text>'


def label_w(text: str) -> int:
    return up4(len(text) * 5.44 + 8)


def elbow_h_v_h(x1: int, y1: int, xt: int, y2: int, x2: int, r: int = 8) -> str:
    """Leave (x1,y1) to the right, turn at x=xt, run vertically to y2, then right into (x2,y2)."""
    sy = 1 if y2 > y1 else -1
    return f"M{x1},{y1} H{xt - r if xt > x1 else xt + r} Q{xt},{y1} {xt},{y1 + sy * r} V{y2 - sy * r} Q{xt},{y2} {xt + (r if x2 > xt else -r)},{y2} H{x2}"


def legend(y: int, items: list[tuple[str, str]], x0: int = 40, step: int = 200, w: int = 1280) -> str:
    """A horizontal strip with a hairline above it. items: (kind, text); kind is focal, a, a-accent, a-link or dash."""
    out = [f'<line class="rule" x1="40" y1="{y - 16}" x2="{w - 40}" y2="{y - 16}"/>', f'<text class="t-legend" x="{x0}" y="{y + 4}">LEGEND</text>']
    x = x0 + 80
    for kind, text in items:
        if kind == "focal":
            out.append(f'<rect class="n-focal" x="{x}" y="{y - 6}" width="24" height="12" rx="2"/>')
        elif kind == "dash":
            out.append(f'<line class="a dash" x1="{x}" y1="{y}" x2="{x + 24}" y2="{y}" marker-end="url(#arrow)"/>')
        else:
            out.append(f'<line class="{kind}" x1="{x}" y1="{y}" x2="{x + 24}" y2="{y}" marker-end="url(#{ {"a": "arrow", "a-accent": "arrow-accent", "a-link": "arrow-link"}[kind] })"/>')
        out.append(f'<text class="t-legend" x="{x + 36}" y="{y + 4}">{escape(text)}</text>')
        x += step
    return "".join(out)
