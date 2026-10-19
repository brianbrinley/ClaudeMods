#!/usr/bin/env python3
"""Draws the dashboard pane's render tree as a terminal-style screenshot.

The tree is what the test kit's `pane.drawn()` returns (Box, Text and Button
elements with their props), so the picture shows the colors and layout the pane
really draws, from sample data only. Needs Google Chrome and Pillow.

    python3 scripts/pane-shot.py tree.json out.png [--columns 62]
"""

import argparse
import html
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
SENTINEL = (255, 0, 255)
FONT = 13  # px; one terminal cell is about 0.6 of this wide
LINE = 1.45


def ch(value):
    return f'{value}ch'


def box_style(p):
    css = ['display:flex', f"flex-direction:{p.get('flexDirection', 'row')}"]
    if 'justifyContent' in p:
        css.append(f"justify-content:{p['justifyContent'].replace('flex-', '')}" if p['justifyContent'].startswith('flex-') else f"justify-content:{p['justifyContent']}")
    if 'alignItems' in p:
        css.append(f"align-items:{p['alignItems']}")
    if p.get('flexWrap'):
        css.append(f"flex-wrap:{p['flexWrap']}")
    if 'paddingX' in p:
        css.append(f"padding-left:{ch(p['paddingX'])};padding-right:{ch(p['paddingX'])}")
    if 'marginTop' in p:
        css.append(f"margin-top:{p['marginTop'] * LINE}em")
    if 'columnGap' in p:
        css.append(f"column-gap:{ch(p['columnGap'])}")
    if 'flexGrow' in p:
        css.append(f"flex-grow:{p['flexGrow']}")
    if 'flexShrink' in p:
        css.append(f"flex-shrink:{p['flexShrink']}")
    if 'minWidth' in p:
        css.append(f"min-width:{ch(p['minWidth'])}")
    if p.get('width') == '100%':
        css.append('width:100%')
    if 'backgroundColor' in p:
        css.append(f"background:{p['backgroundColor']}")
    if p.get('borderStyle'):
        css.append(f"border:1px solid {p.get('borderColor', 'currentColor')}")
        if p['borderStyle'] == 'round':
            css.append('border-radius:3px')
    return ';'.join(css)


def text_style(p):
    css = []
    if 'color' in p:
        css.append(f"color:{p['color']}")
    if 'backgroundColor' in p:
        css.append(f"background:{p['backgroundColor']}")
    if p.get('bold'):
        css.append('font-weight:700')
    if p.get('dimColor'):
        css.append('opacity:.65')
    if p.get('italic'):
        css.append('font-style:italic')
    if p.get('underline'):
        css.append('text-decoration:underline')
    # Ink wraps a Text unless its `wrap` says to truncate.
    if str(p.get('wrap', 'wrap')).startswith('truncate'):
        css.append('white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0')
    else:
        css.append('white-space:pre-wrap;overflow-wrap:anywhere;min-width:0')
    if 'flexShrink' in p:
        css.append(f"flex-shrink:{p['flexShrink']}")
    if 'flexGrow' in p:
        css.append(f"flex-grow:{p['flexGrow']}")
    return ';'.join(css)


def draw(node, link):
    if isinstance(node, str):
        return html.escape(node)
    p = node.get('props') or {}
    inner = ''.join(draw(c, link) for c in node.get('children') or [])
    if node['type'] == 'Box':
        return f'<div style="{box_style(p)}">{inner}</div>'
    if node['type'] == 'Text':
        return f'<span style="{text_style(p)}">{inner}</span>'
    if node['type'] == 'Button':
        label = html.escape(str(p.get('label', '')))
        return f'<span style="color:{link};text-decoration:underline;white-space:pre;margin-right:2ch">{label}</span>'
    return inner


def page(tree, background, link, rule, columns):
    return f"""<!doctype html><meta charset="utf-8">
<style>
*{{box-sizing:border-box}}
html,body{{margin:0;background:rgb{SENTINEL}}}
body{{padding:14px}}
#pane{{width:{columns}ch;font:{FONT}px/{LINE} Menlo,Monaco,'Courier New',monospace;background:{background};border:1px solid {rule};overflow:hidden}}
</style>
<div id="pane">{draw(tree, link)}</div>"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('tree')
    parser.add_argument('out')
    parser.add_argument('--columns', type=int, default=80)
    parser.add_argument('--rule', default='#cccccc', help="color of the pane's outline")
    parser.add_argument('--link', default='#006cd6', help="color of a button's label")
    args = parser.parse_args()

    tree = json.loads(Path(args.tree).read_text())
    background = (tree.get('props') or {}).get('backgroundColor', '#ffffff')
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / 'pane.html'
        shot = Path(tmp) / 'pane.png'
        source.write_text(page(tree, background, args.link, args.rule, args.columns))
        subprocess.run(
            [CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
             '--window-size=700,1800', f'--screenshot={shot}', f'file://{source}'],
            check=True, capture_output=True, timeout=60,
        )
        image = Image.open(shot).convert('RGB')
    # Crop to the pane: everything that is not the sentinel page color, with a small margin.
    box = ImageChops.difference(image, Image.new('RGB', image.size, SENTINEL)).getbbox()
    if box is None:
        sys.exit('nothing was drawn')
    margin = 0
    box = (max(0, box[0] - margin), max(0, box[1] - margin), min(image.width, box[2] + margin), min(image.height, box[3] + margin))
    image.crop(box).save(args.out)
    print(f'{args.out}: {box[2] - box[0]}x{box[3] - box[1]}')


main()
