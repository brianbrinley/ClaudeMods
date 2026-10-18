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

---

# Added 2026-10-17

## Docs site: the boomi-dashboard page is too big
- [x] The single boomi-dashboard page on https://brianbrinley.github.io/ClaudeMods/ is overwhelming. Split it into sections or pages (front door, what it does, settings, prompt tips, reference) and add a way to find things.
  Done 2026-10-17: `SPLITS` in `site/build.py` makes it six pages (Overview, Day to day, Cost and budgets, Prompt tips, Reference, How it works) with a sub-nav, "On this page" links and previous/next; the README stays one file on GitHub. A search box in the site header searches every heading and its section (`search.json`).
- [ ] Per the global CLAUDE.md: invoke `impeccable` (and `boomi-branding` where it applies) before changing markup or CSS; Pages access rules apply (state who can see the site before changing anything about publishing).

## Visual architecture reference (decided 2026-10-17)
Audience: very technical people the project was shared with, who want a detailed visual explanation, not just READMEs.
- Decision: **Exosphere** for the standalone HTML files, **Valence** versions on GitHub Pages (the docs site's Architecture page).
- Tool: the `diagram-design` plugin (third-party, MIT, Cathryn Lavery; each diagram is one self-contained HTML + SVG file). Its skill was not registered in the session it was installed in; it may need a restart. Read its output before publishing.
- [x] Read the plugin's SKILL.md and its brand onboarding; feed it Exosphere tokens (reuse `hooks/report-html.ts`) and Valence tokens (`brand/tokens.json`)
- [x] D1 Overall architecture: hooks module, pure modules, state contract, pane / banner / status line
- [x] D2 Prompt upgrade lifecycle (sequence): submit, checks, hold, background rewrite, why notes, taken-suggestion skip
- [x] D3 Awareness of Companion: docs, pointer index, retrieval, model; version stamps and drift
- [x] D4 From a tool call to a pane row and a budget decision
- [x] D5 How the two mods and Companion fit together (boomi-standards is set aside, so it is drawn dashed; there are two live mods, not three)
- [x] Standalone files under `docs/architecture/` (Exosphere); Valence copies built into the site via `site/build.py` (`PAGES`, `COPY_PATHS`, workflow `paths`): the Architecture page, `site/architecture.md`
- [ ] Check each in a real browser, light and dark; no customer names
