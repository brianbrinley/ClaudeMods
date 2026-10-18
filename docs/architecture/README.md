# Architecture diagrams

Visual references for how the mods work, drawn with the [diagram-design](https://github.com/cathrynlavery/diagram-design) skill (MIT, by Cathryn Lavery). Each diagram is one self-contained HTML file with inline SVG.

## Two looks

| Where | Theme | Profile |
|---|---|---|
| The standalone files in this folder, for Boomi people to read | Boomi's [Exosphere](https://exosphere.boomi.com/) (light and dark) | [`profiles/exosphere.md`](profiles/exosphere.md) |
| The Architecture page on the docs site | Valence, Miami Deco (Day and Night) | [`profiles/valence.md`](profiles/valence.md) |

The colors come from the same sources as the rest of the repository: Exosphere's Exo III tokens (as used by the dashboard's `report html`) and `brand/tokens.json`. Each profile's header says where every token came from. Both pass the skill's contrast check (`verify-contrast.py`).

Two choices differ from the skill's defaults, on purpose: the fonts are the theme's own (Poppins, Noto Sans and Fira Mono for Exosphere; Poiret One, Josefin Sans and the system sans for Valence), and the light skin's `ink-strong` is white or black, whichever clears 4.5:1 on the accent fill.

## Diagrams

| File | Shows |
|---|---|
| [`d1-overview.html`](d1-overview.html) (Valence: [`valence/`](valence/d1-overview.html)) | How the mod plugs into Claude Code: the hooks module, the pure modules, state, what it draws, and what it reads |

| [`d2-prompt-lifecycle.html`](d2-prompt-lifecycle.html) (Valence: [`valence/`](valence/d2-prompt-lifecycle.html)) | What happens to a prompt you type: the check, the hold, the background rewrite, and the upgrade you send |
| [`d3-companion-awareness.html`](d3-companion-awareness.html) (Valence: [`valence/`](valence/d3-companion-awareness.html)) | How the dashboard stays aware of Companion: the version check, the pointer index, retrieval, and the stamped guide with its drift check |
| [`d4-budget-gate.html`](d4-budget-gate.html) (Valence: [`valence/`](valence/d4-budget-gate.html)) | What the dashboard does with each shell command: the budget gate (warn, ask or refuse), then note, run, read, record and show |
| [`d5-mods.html`](d5-mods.html) (Valence: [`valence/`](valence/d5-mods.html)) | How the repository's mods and Companion fit together: the runtime hand-off, what the dashboard reads, and the set-aside standards mod |

That completes the planned set; the docs site's Architecture page is next (see `tasks/todo.md`).

## On the docs site

The docs site's [Architecture page](https://brianbrinley.github.io/ClaudeMods/architecture/) (`site/architecture.md`) shows the five diagrams inline, in the Valence look and bound to the site's own variables so its Day/Night toggle restyles them, with the notes as prose and a link to each standalone Exosphere file. `build.py` writes what the site needs: a fragment per diagram in `embed/` and `site/assets/diagrams.css`, which is derived from the same rules as the standalone pages and shouldn't be edited by hand. The site build (`site/build.py`) includes the fragments and copies the Exosphere files.

## Building them

The HTML files are generated, so the two themes can't drift apart:

```
python3 docs/architecture/build.py
```

`lib.py` holds the themes (their values come from the profiles) and the helpers that keep the skill's rules: the 4px grid, orthogonal connectors, masked labels and one port per connector. Each diagram is a small module (`d1_overview.py`) with its nodes and connectors. The files follow the reader's light or dark setting, and `data-theme="light"` or `"dark"` on `<html>` forces one.

Check a file with the skill's own tools after a change:

```
python3 <diagram-design>/skills/diagram-design/scripts/self_check.py docs/architecture/d1-overview.html
python3 <diagram-design>/scripts/verify-geometry.py docs/architecture/d1-overview.html
```

## Using a profile

The skill keeps profiles in `~/.diagram-design/profiles/` and its `.diagram-design` marker can only name one of those. These profiles live in the repository instead, so they travel with it: ask for a diagram and point the skill at the profile file to use as the style guide. To check one after editing it:

```
python3 <diagram-design>/scripts/verify-contrast.py --style-guide docs/architecture/profiles/exosphere.md
```
