# Project conventions

## Layout

One mod per top-level folder, each a self-contained plugin: `.claude-plugin/plugin.json`, `hooks/hooks.json`, the hooks module, `types/` for its state contract, `tests/` and a `README.md`. Add every new mod to the **Mods** table in the root README.

Before pushing a mod change, run `claude plugin validate <mod>` and `claude plugin test <mod>`, and type-check it with `tsc -p <mod>` once Claude Code has loaded it (that's when it lays `.claude-plugin/types/`, which is gitignored).

The engine follows `$` only within one file: helpers that take `$` live in the hooks module itself; plain functions can live in other files and be unit-tested there.

Credentials never go in a mod's files or in chat. Mods read them from the environment or from the user's own gitignored files.

## Default theme: Valence — Miami Deco

Every visual in this repository uses the Valence theme unless the user says otherwise. The source of truth is [`brand/`](brand/):

- Colors come from `brand/tokens.json`. Don't invent new colors.
- **Status** (healthy / warning / serious / critical) uses the fixed status colors, never brand colors, and never color alone: always with an icon and a label. This covers a mod's status line and panes too.
- **Mermaid:** the first line of every diagram is `brand/mermaid-init.txt`. Flowcharts end with `brand/mermaid-classes.txt` and tag nodes `focus`, `decision`, `highlight`, `external` and `error` (error paths, always with "error" in the label). Wrap sequence diagrams in `rect rgb(251, 246, 238)` … `end`.
- **HTML / UI:** use `brand/valence.css` (Miami Day by default, Miami Night for dark).
- **Type:** Poiret One for the wordmark and display only; Josefin Sans for headings and labels; system UI sans for body text and data.
- **New README:** start it with a Valence banner rendered from `brand/banner.html` into the mod's `assets/` folder, with Day and Night versions in a `<picture>` element.
