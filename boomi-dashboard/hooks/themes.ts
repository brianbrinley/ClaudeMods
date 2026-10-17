// The dashboard's themes: one table of colors by role, and the plain functions
// that pick one. Exosphere (Boomi's design system) is the primary theme, light
// and dark; Whimsical is the Valence Miami Deco look the dashboard started
// with, Day and Night, with the flamingo. Nothing here touches the engine.

import type { PaneTheme } from '../types'

/** A theme the pane draws: `auto` has been settled into light or dark. */
export type DrawnTheme = Exclude<PaneTheme, 'auto'>

/** The two looks `auto` can settle into. */
export type Family = 'exosphere' | 'whimsical'

/** The four status levels, as the dashboard's Level names them. */
export type StatusLevel = 'healthy' | 'warning' | 'serious' | 'critical'

/**
 * The pane's colors: a background of the theme's own (or none, for the
 * terminal's), and a color per role. `band` is the title bar, `accent` the
 * gauges' values. `status` is the color of each level's icon: always drawn with
 * its icon and a label, never alone.
 */
export type Palette = {
  bg?: string
  text: string
  muted: string
  heading: string
  rule: string
  band?: string
  bandText: string
  accent: string
  /** The flamingo's pink. */
  bird: string
  /** The water under it. */
  water: string
  status: Record<StatusLevel, string>
}

/** The fixed status colors Valence and the terminal theme use: the same in every look, as the repo's theme rule says. */
const FIXED_STATUS: Palette['status'] = { healthy: '#0CA30C', warning: '#FAB219', serious: '#EC835A', critical: '#D03B3B' }

export const PALETTES: Record<DrawnTheme, Palette> = {
  // Exosphere's Exo III tokens, light: --exo-color-page, -font, -font-secondary, -brand, -font-link, -border; status from success, warning-strong, highlight-inverse and danger.
  'exosphere-light': {
    bg: '#ffffff',
    text: '#1f1f1f',
    muted: '#707070',
    heading: '#072b55',
    rule: '#cccccc',
    band: '#072b55',
    bandText: '#ffffff',
    accent: '#006cd6',
    bird: '#ff7c66',
    water: '#e5f3fd',
    status: { healthy: '#00a972', warning: '#cf761b', serious: '#b2301a', critical: '#c71739' },
  },
  // The same tokens in Exosphere's dark mode.
  'exosphere-dark': {
    bg: '#1a1a1a',
    text: '#ffffff',
    muted: '#cccccc',
    heading: '#9caabb',
    rule: '#707070',
    band: '#9caabb',
    bandText: '#1a1a1a',
    accent: '#66b6f6',
    bird: '#ff9685',
    water: '#204066',
    status: { healthy: '#0ec38b', warning: '#ec9932', serious: '#ff7c66', critical: '#ff5c6c' },
  },
  // Valence Day and Night, as the pane has always drawn them.
  'whimsical-light': {
    bg: '#FBF6EE',
    text: '#0B0B0B',
    muted: '#52514E',
    heading: '#C2185B',
    rule: '#9A7B3F',
    band: '#C2185B',
    bandText: '#FBF6EE',
    accent: '#0F766E',
    bird: '#C2185B',
    water: '#9FDED6',
    status: FIXED_STATUS,
  },
  'whimsical-dark': {
    bg: '#161A2E',
    text: '#FFFFFF',
    muted: '#C9CBE0',
    heading: '#F48FB1',
    rule: '#D4B46A',
    band: '#F48FB1',
    bandText: '#161A2E',
    accent: '#5EEAD4',
    bird: '#F48FB1',
    water: '#5EEAD4',
    status: FIXED_STATUS,
  },
  // The terminal's own theme: the names are Claude Code's theme keys.
  terminal: { text: 'text', muted: 'inactive', heading: 'claude', rule: 'subtle', bandText: 'claude', accent: 'suggestion', bird: '#C2185B', water: '#9FDED6', status: FIXED_STATUS },
}

/** Every theme a person can pick, in the order the pane lists them. */
export const THEMES: readonly PaneTheme[] = ['auto', 'exosphere-light', 'exosphere-dark', 'whimsical-light', 'whimsical-dark', 'terminal']

export const THEME_NAMES: Record<PaneTheme, string> = {
  auto: 'Auto',
  'exosphere-light': 'Exosphere light',
  'exosphere-dark': 'Exosphere dark',
  'whimsical-light': 'Whimsical light',
  'whimsical-dark': 'Whimsical dark',
  terminal: 'Terminal',
}

/** What the pane's picker shows for each theme: the look and the mode, each with an emoji and a word, since some terminals draw emoji at the wrong width. */
export const THEME_LABELS: Record<PaneTheme, string> = {
  auto: '🌓 Auto (follows your system)',
  'exosphere-light': '🏢 Exosphere · ☀️ Light',
  'exosphere-dark': '🏢 Exosphere · 🌙 Dark',
  'whimsical-light': '🦩 Whimsical · ☀️ Light',
  'whimsical-dark': '🦩 Whimsical · 🌙 Dark',
  terminal: '⌨️ Terminal (your colors)',
}

/** The picker's options, in the order the pane lists the themes. */
export const THEME_OPTIONS = THEMES.map(value => ({ value, label: THEME_LABELS[value] }))

/** The names earlier versions used: Valence Day and Night are Whimsical's two looks now. */
const ALIASES: Record<string, PaneTheme> = { day: 'whimsical-light', night: 'whimsical-dark' }

/** A theme from what a person typed or an earlier version saved, or undefined when it names none. */
export const themeNamed = (value: unknown): PaneTheme | undefined => {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return THEMES.find(t => t === name) ?? ALIASES[name]
}

export const isTheme = (value: unknown): value is PaneTheme => THEMES.includes(value as PaneTheme)

/**
 * The theme a set of options asks for, and the look `auto` settles into.
 * Earlier versions saved `day`, `night` or `terminal`, and a banner icon of
 * `flamingo`: a Day or Night choice becomes Whimsical's, and a person who
 * chose the flamingo and never picked a theme stays in Whimsical.
 */
export const themeFromOptions = (options: Readonly<Record<string, unknown>>): { theme: PaneTheme; family: Family } => {
  const theme = themeNamed(options.paneTheme) ?? 'auto'
  return { theme, family: options.bandIcon === 'flamingo' ? 'whimsical' : 'exosphere' }
}

/** True when the operating system says it is in dark mode: macOS's `defaults read -g AppleInterfaceStyle` prints Dark, and fails in light mode. */
export const isDarkAppearance = (stdout: string | undefined): boolean => /^dark\s*$/i.test(stdout ?? '')

/** The theme to draw: `auto` follows the operating system's light or dark in its family. */
export const resolveTheme = (theme: PaneTheme, family: Family, isDark: boolean): DrawnTheme =>
  theme === 'auto' ? (`${family}-${isDark ? 'dark' : 'light'}` as DrawnTheme) : theme

/** What marks the dashboard: Whimsical's flamingo, or the Boomi logo in Exosphere and the terminal's own theme. */
export const markOf = (theme: DrawnTheme): 'flamingo' | 'logo' => (theme.startsWith('whimsical') ? 'flamingo' : 'logo')

/** True when a theme is dark, for the pieces that need to pick a mode. */
export const isDarkTheme = (theme: DrawnTheme): boolean => theme.endsWith('-dark')
