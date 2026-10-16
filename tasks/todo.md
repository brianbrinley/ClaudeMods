# boomi-dashboard themes: Exosphere first, Whimsical second

Status: PLAN, awaiting review. Nothing below is built.

## Decisions so far (from the user, 2026-10-16)
- Exosphere is the primary (default) theme. Light and dark.
- Second theme is "Whimsical": the Valence Miami Deco palette, Day and Night, with the flamingo.
- The flamingo setting becomes a `logo` on/off setting. In Exosphere the mark is the Boomi logo; in Whimsical it is the flamingo.
- Logo source: `~/Downloads/freepng-digital-file-609169404de938af2/boomi-logo-vector-png.svg` (stock-site copy, not an official Boomi download; check against the brand portal before anything customer-facing).

## Prerequisite: finish 0.53.1 (branch claude/band-no-fallback-mark)
- [ ] Run `scratchpad/apply-no-fallback.py` (register.tsx block + tests/boomi-mark.test.ts)
- [ ] `claude plugin test boomi-dashboard` passes; `tsc -p boomi-dashboard` clean; `claude plugin validate`
- [ ] Commit (sole author Brian Brinley, no Claude trailer), PR, merge, `/bc-dashboard upgrade`

## 0.54.0: the theme setting
- [ ] Theme table in one module (`hooks/themes.ts`): name, light/dark, hex per role (brand, page, panel, text, link, selected, border, success, warning, danger, coral accent), mark kind (`logo` | `flamingo`)
- [ ] Exosphere values from https://exosphere.boomi.com/dist/styles.css (read 100k of 151k chars so far; read the rest before relying on it)
- [ ] Whimsical values from `brand/tokens.json` (Valence), unchanged
- [ ] New setting `theme`: `exosphere-light` | `exosphere-dark` | `whimsical-light` | `whimsical-dark`; default follows the OS: `exosphere-light` or `exosphere-dark` (decided 2026-10-16)
- [ ] `logo` on/off replaces `bandIcon`, `bandAnimation`, `flamingo`. Migrate old values (do not silently reset): `bandIcon flamingo` -> theme whimsical; `bandAnimation` kept for the flamingo
- [ ] `paneTheme` (day/night/terminal) folds into `theme`; keep a `terminal` option
- [ ] Banner, pane, status line, toasts read colours from the theme, not literals
- [ ] HTML `report html` uses `.ex-theme-light/.ex-theme-dark` + Exosphere tokens (already the stated exception in CLAUDE.md); logo as inline SVG
- [ ] Logo: rasterize the SVG to the small PNG for kitty/Ghostty; inline SVG for HTML; no mark in other terminals (0.53.1)
- [ ] Status always icon + label
- [ ] Tests: theme table complete for every role in every theme; setting migration; contrast of text on page >= 4.5:1 for each theme
- [ ] README settings table, `types/`, CHANGELOG 0.54.0, plugin.json version, root README Mods row
- [ ] Hand-checks into CHECKLIST.md with pass/fail per step (live terminal, Apple Terminal and Ghostty, each theme)

## Later (separate change, different rules)
- [ ] Update root `CLAUDE.md`: "Default theme: Valence" becomes Exosphere; Valence becomes the Whimsical option
- [ ] Docs site (`brand/valence.css`, `site/`): Exosphere-first, Boomi-branded; invoke `boomi-branding` + `impeccable` first; Pages access rules apply

## Decisions on the open questions (2026-10-16)
1. Default theme follows the OS light/dark.
2. Existing flamingo users land on Whimsical after the update; Exosphere users and new installs get Exosphere.
