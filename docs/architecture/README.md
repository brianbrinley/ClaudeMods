# Architecture diagrams

Visual references for how the mods work, drawn with the [diagram-design](https://github.com/cathrynlavery/diagram-design) skill (MIT, by Cathryn Lavery). Each diagram is one self-contained HTML file with inline SVG.

## Two looks

| Where | Theme | Profile |
|---|---|---|
| The standalone files in this folder, for Boomi people to read | Boomi's [Exosphere](https://exosphere.boomi.com/) (light and dark) | [`profiles/exosphere.md`](profiles/exosphere.md) |
| The Architecture page on the docs site | Valence, Miami Deco (Day and Night) | [`profiles/valence.md`](profiles/valence.md) |

The colors come from the same sources as the rest of the repository: Exosphere's Exo III tokens (as used by the dashboard's `report html`) and `brand/tokens.json`. Each profile's header says where every token came from. Both pass the skill's contrast check (`verify-contrast.py`).

Two choices differ from the skill's defaults, on purpose: the fonts are the theme's own (Poppins, Noto Sans and Fira Mono for Exosphere; Poiret One, Josefin Sans and the system sans for Valence), and the light skin's `ink-strong` is white or black, whichever clears 4.5:1 on the accent fill.

## Using a profile

The skill keeps profiles in `~/.diagram-design/profiles/` and its `.diagram-design` marker can only name one of those. These profiles live in the repository instead, so they travel with it: ask for a diagram and point the skill at the profile file to use as the style guide. To check one after editing it:

```
python3 <diagram-design>/scripts/verify-contrast.py --style-guide docs/architecture/profiles/exosphere.md
```
