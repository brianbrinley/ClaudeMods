"""Build the GitHub Pages docs site from the repository READMEs.

Usage: python site/build.py [--out _site]

Each README listed in PAGES becomes a page. Relative links are rewritten so that links to other pages and to
copied files work on the site, and anything else points at the file on GitHub. Mermaid code blocks are rendered
in the browser (site/assets/site.js), switching to the Night theme with the page.
"""
import argparse
import datetime
import html
import json
import os
import posixpath
import re
import shutil
import subprocess

import markdown

REPO = "brianbrinley/ClaudeMods"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# source README -> output directory ("" is the site root), nav label (None: built but not in the top nav)
PAGES = [
    ("README.md", "", "Home"),
    ("boomi-runtime/README.md", "boomi-runtime", "Boomi Runtime"),
    ("boomi-dashboard/README.md", "boomi-dashboard", "Companion Dashboard"),
    ("site/architecture.md", "architecture", "Architecture"),
    ("site/style.md", "style", None),
]
# Long READMEs become several pages on the site; GitHub keeps the one file. {page dir: [(sub-directory, title,
# the README's h2 ids)]}. The first keeps the README's opening and the page's own address. The build stops if an h2
# isn't listed, so a new section can't drop off the site.
SPLITS = {
    "boomi-dashboard": [
        ("", "Overview", ["install", "what-you-see"]),
        ("using", "Day to day", ["stages-and-what-needs-attention", "companions-other-plugins", "watched-components",
                                 "companions-activity-log", "past-companion-sessions", "session-report"]),
        ("spend", "Cost and budgets", ["tokens-and-spend"]),
        ("prompts", "Prompt tips", ["prompt-tips"]),
        ("reference", "Reference", ["commands-and-tools", "setup-and-settings", "limits"]),
        ("internals", "How it works", ["how-it-works", "whats-coming-next", "development"]),
    ],
}
# One line on what each sub-page holds, for the first page's "Where to go next" list: {page dir: {sub-page dir: line}}
SPLIT_BLURBS = {
    "boomi-dashboard": {
        "using": "what the pane shows as Claude works",
        "spend": "what a session costs, and how to cap it",
        "prompts": "checks and upgrades for your prompts",
        "reference": "commands, settings and limits",
        "internals": "the design, and how to build on it",
    },
}
# Copied verbatim to the same path on the site (only what the pages use)
COPY_PATHS = ["brand/valence.css", "brand/assets", "boomi-runtime/assets", "boomi-dashboard/assets",
              "docs/architecture/valence"]
# Built files offered as downloads on a page: {page dir: [(source directory, filename regex)]}
DOWNLOADS = {}


def git(*args):
    try:
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def page_url(out_dir):
    return out_dir + "/" if out_dir else ""


def rel(from_dir, target):
    """Relative URL from a page directory to a site path."""
    r = posixpath.relpath(target or ".", from_dir or ".")
    return "" if r == "." else r


def rewrite_links(body, src_dir, out_dir, page_dirs, site_files, page_sources, anchor_dirs):
    def fix(match):
        attr, quote, url = match.group(1), match.group(2), match.group(3)
        if re.match(r"^([a-z][a-z0-9+.-]*:|#|//)", url, re.I):
            return match.group(0)
        path, _, frag = url.partition("#")
        frag = "#" + frag if frag else ""
        target = posixpath.normpath(posixpath.join(src_dir, path)) if path else src_dir
        target = "" if target == "." else target
        if target in page_sources:
            target = page_sources[target]
        elif target.endswith("README.md"):
            target = posixpath.dirname(target)
        # A split page's section lives on the sub-page that holds it
        target = anchor_dirs.get(target, {}).get(frag[1:], target)
        if target in page_dirs:
            new = rel(out_dir, target) + ("/" if target and rel(out_dir, target) else "")
            new = new or "./"
        elif target in site_files:
            new = rel(out_dir, target)
        else:
            full = os.path.join(ROOT, target)
            kind = "tree" if os.path.isdir(full) else "blob"
            new = f"https://github.com/{REPO}/{kind}/main/{target}"
        return f'{attr}={quote}{new}{frag}{quote}'

    # Leave code samples exactly as written
    parts = re.split(r"(<pre[^>]*>.*?</pre>|<code>.*?</code>)", body, flags=re.S)
    return "".join(part if part.startswith(("<pre", "<code>")) else
                   re.sub(r'\b(href|src|srcset)=(["\'])([^"\']+)\2', fix, part)
                   for part in parts)


def render(md_text):
    md = markdown.Markdown(extensions=["tables", "fenced_code", "toc", "sane_lists"],
                           extension_configs={"toc": {"permalink": "#", "permalink_class": "anchor",
                                                      "permalink_title": "Link to this section"}})
    body = md.convert(md_text)
    # Mermaid blocks render client-side
    body = re.sub(r'<pre><code class="language-mermaid">(.*?)</code></pre>',
                  lambda m: f'<pre class="mermaid">{m.group(1)}</pre>', body, flags=re.S)
    body = re.sub(r"(<table>.*?</table>)", r'<div class="table-wrap">\1</div>', body, flags=re.S)
    return body


STATUS_ICONS = {
    "healthy": '<path d="M5 12.5l4.5 4.5L19 7.5" />',
    "warning": '<path d="M12 4 L21 20 H3 Z" /><path d="M12 10v4" /><path d="M12 17v.5" />',
    "serious": '<path d="M12 3l9 9-9 9-9-9z" /><path d="M12 8v5" /><path d="M12 16v.5" />',
    "critical": '<circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" />',
}


def swatches_html(theme_name, theme):
    panel = theme["background"]["value"]
    ink = theme["text"]["value"]
    muted = theme["mutedText"]["value"]
    cards = []
    for token in theme.values():
        cards.append(
            '<figure class="swatch">'
            f'<div class="swatch-chip" style="background:{token["value"]}"></div>'
            f'<figcaption><strong style="color:{ink}">{html.escape(token["name"])}</strong>'
            f'<code style="color:{ink}">{token["value"].upper()}</code>'
            f'<span style="color:{muted}">{html.escape(token["use"])}</span></figcaption></figure>')
    return (f'<div class="swatch-panel" style="background:{panel}" role="group" '
            f'aria-label="{theme_name.title()} colors"><div class="swatches">{"".join(cards)}</div></div>')


def status_html(status):
    items = []
    for name, color in status.items():
        if name.startswith("_"):
            continue
        items.append(
            f'<div class="status-pill" style="border-color:{color}">'
            f'<span class="status-icon" style="background:{color}"><svg viewBox="0 0 24 24" width="16" height="16" '
            f'aria-hidden="true" fill="none" stroke="#0B0B0B" stroke-width="2.4" stroke-linecap="round" '
            f'stroke-linejoin="round">{STATUS_ICONS.get(name, "")}</svg></span>'
            f'<span class="status-name">{name.title()}</span><code>{color.upper()}</code></div>')
    return f'<div class="status-row">{"".join(items)}</div>'


# The dashboard pane's 8-bit flamingo, read from the mod itself so the site's bird is always the pane's.
FLAMINGO_SOURCE = "boomi-dashboard/hooks/activity.ts"
# Pixel letters as CSS classes: P the bird, L its pastel wing, K its eye.
FLAMINGO_CLASSES = {"P": "fl-p", "L": "fl-l", "K": "fl-k"}
# One cycle, as the pane's flamingo does it: standing, a look back, the other leg, turned around, then back.
# Each pose and how many seconds it holds.
FLAMINGO_SCENE = [("stand", 6), ("look back", 2), ("stand", 4), ("other leg", 5), ("turned", 5), ("turned, look back", 2), ("turned", 3)]


def reflect(rows, about):
    """A sprite's rows reflected across a vertical line, as the pane's reflect(): x becomes about - x, within 12 pixels."""
    out = []
    for row in rows:
        line = ["."] * 12
        for x, c in enumerate(row):
            if c != "." and 0 <= about - x < 12:
                line[about - x] = c
        out.append("".join(line))
    return out


def flamingo_frames():
    """Each pose of the scene as pixel rows, built from the dashboard's own sprite rows."""
    src = open(os.path.join(ROOT, FLAMINGO_SOURCE), encoding="utf-8").read()
    parts = {}
    for name in ("HEAD", "WING_DOWN", "ONE_LEG"):
        m = re.search(r"^const " + name + r" = \[(.*?)\]", src, re.S | re.M)
        parts[name] = re.findall(r"'([.PLK]+)'", m.group(1))
    head, wing, leg = parts["HEAD"], parts["WING_DOWN"], parts["ONE_LEG"]
    poses = {
        "stand": head + wing + leg,
        "look back": reflect(head, 11) + wing + leg,
        "other leg": head + wing + reflect(leg, 14),
        "turned": reflect(head + wing + leg, 11),
        "turned, look back": reflect(reflect(head, 11) + wing + leg, 11),
    }
    return [(poses[name], seconds) for name, seconds in FLAMINGO_SCENE]


def flamingo_html():
    """An inline SVG of the flamingo standing in its water: now and then it looks back, shifts its weight and turns."""
    frames = flamingo_frames()
    cycle = sum(seconds for _, seconds in frames)
    width, height = 12, len(frames[0][0])
    groups, keyframes, start = [], [], 0.0
    for i, (rows, seconds) in enumerate(frames):
        rects = "".join(f'<rect class="{FLAMINGO_CLASSES[c]}" x="{x}" y="{y}" width="1" height="1"/>'
                        for y, row in enumerate(rows) for x, c in enumerate(row) if c in FLAMINGO_CLASSES)
        groups.append(f'<g class="fl-frame fl-f{i}">{rects}</g>')
        a, b = 100 * start / cycle, 100 * (start + seconds) / cycle
        before = f"0%, {a:.2f}% {{ opacity: 0 }} " if i > 0 else ""
        keyframes.append(f"@keyframes fl-f{i} {{ {before}{a + (0.01 if i else 0):.2f}%, {b:.2f}% {{ opacity: 1 }} "
                         f"{b + 0.01:.2f}%, 100% {{ opacity: 0 }} }}")
        start += seconds
    style = ("<style>" + " ".join(keyframes) + " "
             + " ".join(f".fl-f{i} {{ animation: fl-f{i} {cycle}s steps(1) infinite; }}" for i in range(len(frames)))
             + " @media (prefers-reduced-motion: reduce) { .fl-frame { animation: none; opacity: 0; } .fl-f0 { opacity: 1; } }"
             + "</style>")
    return (f'<div class="flamingo" aria-hidden="true"><svg viewBox="0 -1 {width} {height + 3}" '
            f'shape-rendering="crispEdges">{style}{"".join(groups)}'
            f'<path class="fl-water" d="M0 {height + 1} q1.5 -1 3 0 t3 0 t3 0 t3 0" fill="none" stroke-width="0.4"/></svg></div>')


def split_page(body, out_dir, parts):
    """A rendered README cut at its h2s into the sub-pages SPLITS lists: [(dir, title, body)], and {id: dir}."""
    head, *sections = re.split(r"(?=<h2[ >])", body)
    by_id = {re.match(r'<h2 id="([^"]+)"', s).group(1): s for s in sections}
    listed = [i for _, _, ids in parts for i in ids]
    if set(by_id) != set(listed) or len(listed) != len(set(listed)):
        raise SystemExit(f"SPLITS[{out_dir!r}] must list each h2 once. Not listed: {sorted(set(by_id) - set(listed))}; "
                         f"no such h2: {sorted(set(listed) - set(by_id))}")
    pages, anchors = [], {}
    for sub, title, ids in parts:
        d = posixpath.join(out_dir, sub) if sub else out_dir
        part = (head if not sub else f"<h1>{html.escape(title)}</h1>\n") + "".join(by_id[i] for i in ids)
        for a in re.findall(r'\bid="([^"]+)"', part):
            anchors.setdefault(a, d)
        pages.append((d, title, part))
    return pages, anchors


def plain(fragment):
    """Text of an HTML fragment, without heading permalinks or Mermaid sources."""
    fragment = re.sub(r'<a class="anchor"[^>]*>.*?</a>|<pre class="mermaid">.*?</pre>|<style>.*?</style>|<figure.*?</figure>', " ",
                      fragment, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def first_paragraph(body, default):
    m = re.search(r"<p>(.+?)</p>", body, re.S)
    return plain(m.group(1))[:200] if m else default


def subnav_html(label, out_dir, subpages):
    """The pages of a split README as a quiet line of links, the current one in bold, and a Next button on every page after the
    first (the first has a "Where to go next" list instead)."""
    href = lambda d: (rel(out_dir, d) or ".") + "/"
    links = "".join(f'<span class="here" aria-current="page">{html.escape(t)}</span>' if d == out_dir
                    else f'<a href="{href(d)}">{html.escape(t)}</a>' for d, t in subpages)
    i = [d for d, _ in subpages].index(out_dir)
    nxt = (f'<a class="button next-top" rel="next" href="{href(subpages[i + 1][0])}">Next: {html.escape(subpages[i + 1][1])} →</a>'
           if 0 < i and i + 1 < len(subpages) else "")
    return (f'<div class="subnav-row"><nav class="subnav" aria-label="{html.escape(label)} pages">'
            f'<span class="subnav-label">In this guide</span>{links}</nav>{nxt}</div>\n')


def where_next_html(out_dir, subpages):
    """A split README's first page ends its introduction with where to go next: one button on the first stop, and each other page
    with a line on what it holds."""
    blurbs = SPLIT_BLURBS.get(out_dir, {})
    href = lambda d: (rel(out_dir, d) or ".") + "/"
    line = lambda d: blurbs.get(posixpath.basename(d), "")
    (first_dir, first_title), rest = subpages[1], subpages[2:]
    first = (f'<p class="where-first"><a class="button" href="{href(first_dir)}">Start with {html.escape(first_title)} →</a>'
             + (f"<span>{html.escape(line(first_dir))}</span>" if line(first_dir) else "") + "</p>")
    rows = "".join(f'<div><dt><a href="{href(d)}">{html.escape(t)}</a></dt><dd>{html.escape(line(d))}</dd></div>' for d, t in rest)
    return (f'<section class="where-next" aria-labelledby="where-next"><h2 id="where-next">Where to go next</h2>\n'
            f'{first}\n<dl class="where-list">{rows}</dl></section>\n')


def toc_html(body):
    """'On this page' links to a sub-page's h2s, when it has more than one."""
    heads = re.findall(r'<h2 id="([^"]+)">(.*?)</h2>', body, re.S)
    if len(heads) < 2:
        return ""
    links = "".join(f'<a href="#{i}">{html.escape(plain(h))}</a>' for i, h in heads)
    return f'\n<nav class="toc" aria-label="On this page"><span>On this page</span>{links}</nav>'


def pager_html(out_dir, subpages):
    i = [d for d, _ in subpages].index(out_dir)
    link = lambda j, rel_, arrow: (
        f'<a rel="{rel_}" href="{(rel(out_dir, subpages[j][0]) or ".") + "/"}">'
        + (f"← {html.escape(subpages[j][1])}" if arrow == "prev" else f"{html.escape(subpages[j][1])} →") + "</a>")
    parts = ([link(i - 1, "prev", "prev")] if i > 0 else [""]) + ([link(i + 1, "next", "next")] if i + 1 < len(subpages) else [])
    return '\n<nav class="pager" aria-label="More pages">' + "".join(parts) + "</nav>"


def search_entries(body, out_dir, page_title):
    """One entry per heading with an id, for the header's search: page, heading, address and the section's text."""
    entries = []
    for m in re.finditer(r'<h([123]) id="([^"]+)">(.*?)</h\1>(.*?)(?=<h[123][ >]|$)', body, re.S):
        level, anchor, heading, section = m.groups()
        url = page_url(out_dir) + ("" if level == "1" else "#" + anchor)
        entries.append({"p": page_title, "h": plain(heading), "u": url, "x": plain(section)[:600]})
    return entries


def first_text(pattern, text, default):
    m = re.search(pattern, text, re.M)
    return re.sub(r"[*_`\[\]]|\(.*?\)", "", m.group(1)).strip() if m else default


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.join(ROOT, "_site"))
    out = parser.parse_args().out
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)

    # Static files
    shutil.copytree(os.path.join(ROOT, "site", "assets"), os.path.join(out, "assets"))
    for path in COPY_PATHS:
        src, dest = os.path.join(ROOT, path), os.path.join(out, path)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.isdir(src):
            shutil.copytree(src, dest)
        else:
            shutil.copy(src, dest)
    downloads = {}
    for out_dir, specs in DOWNLOADS.items():
        for src_dir, pattern in specs:
            full = os.path.join(ROOT, src_dir)
            for name in sorted(os.listdir(full)) if os.path.isdir(full) else []:
                if re.match(pattern, name):
                    dest = posixpath.join(out_dir, "downloads", name)
                    os.makedirs(os.path.join(out, posixpath.dirname(dest)), exist_ok=True)
                    shutil.copy(os.path.join(full, name), os.path.join(out, dest))
                    downloads.setdefault(out_dir, []).append(dest)

    site_files = set()
    for base, _, files in os.walk(out):
        for f in files:
            site_files.add(posixpath.relpath(os.path.join(base, f), out).replace(os.sep, "/"))
    page_sources = {s: d for s, d, _ in PAGES}

    template = open(os.path.join(ROOT, "site", "template.html"), encoding="utf-8").read()
    night_init = open(os.path.join(ROOT, "brand", "mermaid-init-night.txt"), encoding="utf-8").read().strip()
    mermaid_init = open(os.path.join(ROOT, "brand", "mermaid-init.txt"), encoding="utf-8").read().strip()
    mermaid_classes = open(os.path.join(ROOT, "brand", "mermaid-classes.txt"), encoding="utf-8").read()
    with open(os.path.join(ROOT, "brand", "tokens.json"), encoding="utf-8") as fh:
        tokens = json.load(fh)
    sha = git("rev-parse", "HEAD") or "main"
    built = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # Render every README first, so a link to a split page's section can find the sub-page that holds it.
    units = []  # (source, page dir, output dir, title, description, body, sub-pages of a split page)
    anchor_dirs = {}
    for src, out_dir, label in PAGES:
        text = open(os.path.join(ROOT, src), encoding="utf-8").read()
        text = (text.replace("%%MERMAID_INIT%%", mermaid_init)
                .replace("%%MERMAID_CLASSES%%", mermaid_classes.rstrip("\n")))
        body = render(text)
        body = re.sub(r'<div data-swatches="(\w+)"></div>',
                      lambda m: swatches_html(m.group(1), tokens["themes"][m.group(1)]), body)
        body = body.replace("<div data-status></div>", status_html(tokens["status"]))
        if "<div data-flamingo></div>" in body:
            body = body.replace("<div data-flamingo></div>", flamingo_html())
        if downloads.get(out_dir):
            buttons = []
            for path in downloads[out_dir]:
                name = posixpath.basename(path)
                cls = "button" if name.endswith(".zip") else "button secondary"
                what = "Connector archive (CAR)" if name.endswith(".zip") else "Connector descriptor"
                buttons.append(f'<a class="{cls}" href="{rel(out_dir, path)}" download>{what} · {html.escape(name)}</a>')
            block = ('<div class="downloads" role="group" aria-label="Downloads">' + "".join(buttons)
                     + "</div><p><small>Built from the latest commit on main. Upload both files to your Boomi "
                     "connector group.</small></p>")
            # After the first heading
            body = re.sub(r"(</h1>)", r"\1" + block.replace("\\", "\\\\"), body, count=1)
        title = first_text(r"^#\s+(.+)$", text, label or out_dir)
        description = first_text(r"^(?![#<|`!\s-])(.{20,}?)$", text, label or out_dir)[:200]
        if out_dir in SPLITS:
            parts, anchors = split_page(body, out_dir, SPLITS[out_dir])
            anchor_dirs[out_dir] = anchors
            subpages = [(d, t) for d, t, _ in parts]
            for i, (d, sub_title, sub_body) in enumerate(parts):
                units.append((src, out_dir, d, title if i == 0 else f"{sub_title} · {label}",
                              description if i == 0 else first_paragraph(sub_body, description), sub_body, subpages))
        else:
            units.append((src, out_dir, out_dir, title, description, body, None))
    page_dirs = {d for _, _, d, *_ in units}

    search = []
    for src, page_dir, out_dir, title, description, body, subpages in units:
        src_dir = posixpath.dirname(src)
        label = next(l for _, d, l in PAGES if d == page_dir)
        if subpages:
            here = dict(subpages)[out_dir]
            # A same-page link to a section that now lives on another sub-page goes through the README, like any other
            body = re.sub(r'href="#([^"]+)"', lambda m: (
                m.group(0) if anchor_dirs[page_dir].get(m.group(1), out_dir) == out_dir
                else f'href="{posixpath.basename(src)}#{m.group(1)}"'), body)
            if out_dir != page_dir:
                body = re.sub(r"(</h1>)", lambda m: m.group(1) + toc_html(body), body, count=1)
        body = rewrite_links(body, src_dir, out_dir, page_dirs, site_files, page_sources, anchor_dirs)
        if subpages:
            if out_dir == page_dir and len(subpages) > 1:
                # The first page: where to go next, right after its introduction
                body = re.sub(r"(?=<h2[ >])", lambda m: where_next_html(out_dir, subpages), body, count=1)
            body = subnav_html(label, out_dir, subpages) + body + pager_html(out_dir, subpages)
        search += search_entries(body, out_dir, (label or title) + (f" › {here}" if subpages and out_dir != page_dir else ""))

        nav = "\n".join(
            f'    <a href="{rel(out_dir, d) + "/" if rel(out_dir, d) else "./"}"'
            + (' aria-current="page"' if d == out_dir or (d and out_dir.startswith(d + "/")) else "")
            + f">{html.escape(l)}</a>"
            for _, d, l in PAGES if l)
        root_prefix = rel(out_dir, "")
        root_prefix = root_prefix + "/" if root_prefix else ""
        page = (template
                .replace("{{title}}", html.escape(title))
                .replace("{{description}}", html.escape(description))
                .replace("{{nav}}", nav)
                .replace("{{root}}", root_prefix)
                .replace("{{night_init}}", json.dumps(night_init))
                .replace("{{source}}", src)
                .replace("{{source_dir}}", src_dir)
                .replace("{{sha}}", sha)
                .replace("{{sha_short}}", sha[:7])
                .replace("{{built}}", built)
                .replace("{{content}}", body))
        dest = os.path.join(out, out_dir, "index.html")
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        open(dest, "w", encoding="utf-8").write(page)
        print(f"built {posixpath.join(out_dir, 'index.html')} from {src}")

    with open(os.path.join(out, "search.json"), "w", encoding="utf-8") as fh:
        json.dump(search, fh, ensure_ascii=False, separators=(",", ":"))
    open(os.path.join(out, ".nojekyll"), "w").close()


if __name__ == "__main__":
    main()
