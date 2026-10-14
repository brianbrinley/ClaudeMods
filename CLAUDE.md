# Project conventions

## Layout

One mod per top-level folder, each a self-contained plugin: `.claude-plugin/plugin.json`, `hooks/hooks.json`, the hooks module, `types/` for its state contract, `tests/` and a `README.md`. Add every new mod to the **Mods** table in the root README and to the docs site's `PAGES` (see below). Mod ideas that aren't built yet go in `IDEAS.md`; when one ships, move it from there to the Mods table. What a change needs checked by hand (a live session, a real Boomi account) goes in `CHECKLIST.md`, with a visible pass and fail for each step; tick it off once the user confirms it.

Each mod release bumps the version in its `plugin.json` and adds an entry at the top of its `CHANGELOG.md` (`## <version>`), which `/bc-dashboard upgrade` shows.

Before pushing a mod change, run `claude plugin validate <mod>` and `claude plugin test <mod>`, and type-check it with `tsc -p <mod>` once Claude Code has loaded it (that's when it lays `.claude-plugin/types/`, which is gitignored).

The engine follows `$` only within one file: helpers that take `$` live in the hooks module itself; plain functions can live in other files and be unit-tested there.

Credentials never go in a mod's files or in chat. Mods read them from the environment or from the user's own gitignored files.

Brian Brinley is the sole author of every commit: author and committer `Brian Brinley <brianbrinley@gmail.com>`. Check `git config user.name` and `git config user.email` before committing, and set them if they differ.

No Claude attribution in commits or pull requests: commit messages end with their last line of text, with no `Co-Authored-By: Claude` or `Claude-Session:` trailer, and pull request descriptions end with their last section, with no "Generated with Claude Code" line and no Claude session link.

## Docs site (GitHub Pages)

`.github/workflows/pages.yml` publishes https://brianbrinley.github.io/ClaudeMods/ on every merge to `main` that touches the READMEs, `brand/`, `site/` or a mod:
- `site/build.py` renders the READMEs listed in its `PAGES` with `site/template.html`, `brand/valence.css` and `site/assets/`. A `PAGES` entry whose nav label is `None` is built but left out of the top nav (the Style page, `site/style.md`). Code blocks get a Copy button.
- Mermaid diagrams render in the browser and switch to `brand/mermaid-init-night.txt` in Night mode.
- `<div data-flamingo></div>` in a README becomes the dashboard pane's 8-bit flamingo, drawn from the sprite in `boomi-dashboard/hooks/activity.ts` and floated beside the opening prose. It's hidden on narrow screens and stands still under reduced motion. GitHub shows nothing for it.

To publish a new mod's README, add it to `PAGES`, its `assets/` folder to `COPY_PATHS`, and its folder to the `paths` that trigger `.github/workflows/pages.yml`. `IDEAS.md` stays in the repository but isn't published on the site; links to it go to GitHub. Keep README links relative: the build rewrites them for the site and sends anything not on the site to GitHub.

Check locally with `pip install -r site/requirements.txt && python site/build.py --out _site`, then open `_site/index.html` through a local web server.

## Default theme: Valence — Miami Deco

Every visual in this repository uses the Valence theme unless the user says otherwise. The source of truth is [`brand/`](brand/):

- Colors come from `brand/tokens.json`. Don't invent new colors.
- **Status** (healthy / warning / serious / critical) uses the fixed status colors, never brand colors, and never color alone: always with an icon and a label. This covers a mod's status line and panes too.
- **Mermaid:** the first line of every diagram is `brand/mermaid-init.txt`. Flowcharts end with `brand/mermaid-classes.txt` and tag nodes `focus`, `decision`, `highlight`, `external` and `error` (error paths, always with "error" in the label). Wrap sequence diagrams in `rect rgb(251, 246, 238)` … `end`.
- **HTML / UI:** use `brand/valence.css` (Miami Day by default, Miami Night for dark).
- **Type:** Poiret One for the wordmark and display only; Josefin Sans for headings and labels; system UI sans for body text and data.
- **New README:** start it with a Valence banner rendered from `brand/banner.html` into the mod's `assets/` folder, with Day and Night versions in a `<picture>` element.

**The exception, Boomi's Exosphere:** what a mod produces for Boomi people to read outside Claude Code, such as the dashboard's `report html`, follows Boomi's [Exosphere](https://exosphere.boomi.com/) design system instead: its Exo III tokens (light and dark), Poppins for headings, Noto Sans for text and Fira Mono for code. Status still always shows an icon and a label.
