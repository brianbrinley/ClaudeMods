# boomi-dashboard themes: Exosphere first, Whimsical second

Status: DONE. Shipped as boomi-dashboard 0.54.0 (see its CHANGELOG), after 0.53.1.

- Exosphere is the default theme, light and dark; `auto` follows the system. Whimsical (Valence Miami Deco, Day and Night, with the flamingo) is the second.
- The `logo` setting replaced the flamingo, `bandIcon` and `bandAnimation` settings; saved values carry over.
- The root `CLAUDE.md` now makes Exosphere the default theme for new visuals (2026-10-18).
- Decision 2026-10-18: the docs site stays Valence-themed. The old "docs site Exosphere-first" item is dropped.
- Logo source for reference: the Boomi logo SVG is a stock-site copy, not an official Boomi download; check it against the brand portal before anything customer-facing.

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

---

# Added 2026-10-18

## boomi-dashboard 0.61.0: offer to turn on Companion's activity log

Status: PLAN, awaiting review. Nothing below is built.

Today `BOOMI_COMPANION_LOG_ACTIVITY=1` is only advice (README, a rotating tip, CHECKLIST F4). Goal: the dashboard offers to add that one line to Companion's `.env`, with the user's consent, and keeps advising until it is on.

Design rules
- The mod writes it, not Claude. Claude never edits `.env`, so the credentials file never enters the conversation and no model permission prompt is involved.
- Append one line only, and only when the key is absent. Never rewrite the file, never read other lines into a result, toast or log. Companion's `.env` path is the `envFile` setting.
- Consent first: Yes / Not now / Never ask. Offered only in Companion's workspace (`isCompanionFolder`).
- If the write is refused (engine, permission rule, auto mode), show the exact line and path to add by hand. That fallback is a first-class path, not an afterthought.

Open check (decides how prominent the fallback is)
- [ ] Run `/envtest` (throwaway mod in the dev-mods folder): does the mod's `$.fs.write` get through to a `.env`? Then delete the mod and `boomi-dashboard/.tmp-envtest/`.

Build (all under `boomi-dashboard/`; line numbers from the 0.60.0 map)
- [ ] `hooks/activity-env.ts` (plain functions, unit-testable): `withActivityLog(text)` returns the new text, or `undefined` when the key is already set (any value, comments ignored); keeps line endings and adds a trailing newline if missing.
- [ ] `register.tsx`: `activityLogCommand($, settings, target)` for `/bc-dashboard activity-log on|off|status`, wired into the verb switch (~2030-2085) and `USAGE` (~1965). `status` says on, off or can't tell, never printing file contents. `off` removes only that line, after asking.
- [ ] Consent: `$.ui.ask(...)` (pattern at ~2181, ~2605) at session start when the log file is absent, `isCompanionFolder` is true and the setting allows it. Answer `undefined` counts as Not now.
- [ ] Remembering: Not now = per-session atom (declare in `types/index.d.ts`); Never = `saveSetting(..., 'activityLogPrompt', 'never')`, falling back to `$.store` where /config refuses (the pattern at ~2945).
- [ ] Setting `activityLogPrompt` (`ask` | `never`, default `ask`) in all six places: `Settings` type (~375), `settingsFrom` (~415), `hooks/config.ts` next to `activityLog`, `plugin.json` userConfig, `tests/config.test.ts` MANIFEST_KEYS, README settings table.
- [ ] Advice until on: a "log: off" row in the pane near the steps heading and a one-line nudge in the banner (model: the prompt nudge row ~3295), the session report says what the log would have added, and the tip at `activity.ts:2305` and README lines 43 and 370 change from optional to recommended and name the command.
- [ ] If the write is refused: the same row shows the line and path, and a `! ` command to run by hand.
- [ ] Companion must pick the change up: confirm whether its scripts read `.env` on each run (so no restart is needed) before the toast says "on".
- [ ] Tests (`tests/plugin.test.ts` fakes: `on('fs.write')`, `promptWorld`): appends once, idempotent, preserves other lines byte for byte, no trailing newline case, CRLF, refused write shows the fallback, Never persists, Not now doesn't, not offered outside Companion's folder, nothing from the file reaches any result.
- [ ] `claude plugin validate boomi-dashboard`, `claude plugin test boomi-dashboard`, `tsc -p boomi-dashboard`.
- [ ] Version 0.61.0 in `plugin.json`, a `## 0.61.0` CHANGELOG entry, CHECKLIST.md steps with pass and fail (offer accepted, declined, Never, refused write, on and off), root README unchanged unless the Mods row mentions the log.

Questions for the user
1. Offer at session start, or on the first Companion script run? DECIDED 2026-10-18: session start, every session until answered Yes or Never; "Not now" lasts that session only.
2. Should `off` exist at all, or is removing the line the user's own job? DECIDED 2026-10-18: it exists; it asks first and removes only that line.
