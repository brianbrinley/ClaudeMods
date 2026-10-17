import { expect, test } from 'claude-code/testing'
import { PALETTES, THEMES, THEME_NAMES, THEME_OPTIONS, isDarkAppearance, isTheme, markOf, resolveTheme, themeFromOptions, themeNamed } from '../hooks/themes'
import type { DrawnTheme } from '../hooks/themes'

const DRAWN = THEMES.filter((t): t is DrawnTheme => t !== 'auto')
const ROLES = ['text', 'muted', 'heading', 'rule', 'bandText', 'accent', 'bird', 'water', 'status'] as const
const LEVELS = ['healthy', 'warning', 'serious', 'critical'] as const

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

test('every theme has a name, and every drawn theme has every role', () => {
  for (const theme of THEMES) expect(THEME_NAMES[theme]).toBeTruthy()
  expect(DRAWN).toEqual(['exosphere-light', 'exosphere-dark', 'whimsical-light', 'whimsical-dark', 'terminal'])
  for (const theme of DRAWN) {
    for (const role of ROLES) expect(PALETTES[theme][role], `${theme} ${role}`).toBeTruthy()
    for (const level of LEVELS) expect(PALETTES[theme].status[level], `${theme} ${level}`).toBeTruthy()
  }
  // A drawn theme with a background also has a band; the terminal's own has neither.
  for (const theme of DRAWN.filter(t => t !== 'terminal')) {
    expect(PALETTES[theme].bg, theme).toMatch(/^#[0-9a-f]{6}$/i)
    expect(PALETTES[theme].band, theme).toMatch(/^#[0-9a-f]{6}$/i)
  }
  expect(PALETTES.terminal.bg).toBeUndefined()
})

test("Exosphere's colors are its tokens, and Whimsical's are Valence's, unchanged", () => {
  expect(PALETTES['exosphere-light']).toMatchObject({ bg: '#ffffff', text: '#1f1f1f', muted: '#707070', heading: '#072b55', band: '#072b55', accent: '#006cd6' })
  expect(PALETTES['exosphere-dark']).toMatchObject({ bg: '#1a1a1a', text: '#ffffff', muted: '#cccccc', heading: '#9caabb', band: '#9caabb', accent: '#66b6f6' })
  expect(PALETTES['whimsical-light']).toMatchObject({ bg: '#FBF6EE', band: '#C2185B', accent: '#0F766E', water: '#9FDED6' })
  expect(PALETTES['whimsical-dark']).toMatchObject({ bg: '#161A2E', band: '#F48FB1', accent: '#5EEAD4', water: '#5EEAD4' })
})

test('text on the page reads at 4.5:1 or better in every theme', () => {
  for (const theme of DRAWN.filter(t => t !== 'terminal')) {
    const p = PALETTES[theme]
    for (const role of ['text', 'muted', 'heading', 'accent'] as const) expect(contrast(p[role], p.bg!), `${theme} ${role}`).toBeGreaterThanOrEqual(4.5)
    expect(contrast(p.bandText, p.band!), `${theme} band`).toBeGreaterThanOrEqual(4.5)
  }
})

test('status keeps four distinct colors in every theme', () => {
  for (const theme of DRAWN) expect(new Set(LEVELS.map(l => PALETTES[theme].status[l])).size, theme).toBe(4)
})

test('an earlier version\'s day and night are Whimsical light and dark; names are read loosely', () => {
  expect(themeNamed('day')).toBe('whimsical-light')
  expect(themeNamed('night')).toBe('whimsical-dark')
  expect(themeNamed(' Exosphere-Dark ')).toBe('exosphere-dark')
  expect(themeNamed('auto')).toBe('auto')
  expect(themeNamed('terminal')).toBe('terminal')
  expect(themeNamed('neon')).toBeUndefined()
  expect(themeNamed(undefined)).toBeUndefined()
  expect(isTheme('day')).toBe(false)
  expect(isTheme('auto')).toBe(true)
})

test('options migrate without a silent reset', () => {
  expect(themeFromOptions({})).toEqual({ theme: 'auto', family: 'exosphere' })
  expect(themeFromOptions({ paneTheme: 'auto', bandIcon: 'boomi' })).toEqual({ theme: 'auto', family: 'exosphere' })
  expect(themeFromOptions({ paneTheme: 'day' })).toEqual({ theme: 'whimsical-light', family: 'exosphere' })
  expect(themeFromOptions({ paneTheme: 'night' })).toEqual({ theme: 'whimsical-dark', family: 'exosphere' })
  expect(themeFromOptions({ paneTheme: 'terminal' })).toEqual({ theme: 'terminal', family: 'exosphere' })
  // A flamingo banner icon and no theme picked: Whimsical, light or dark by the system.
  expect(themeFromOptions({ paneTheme: 'auto', bandIcon: 'flamingo' })).toEqual({ theme: 'auto', family: 'whimsical' })
  // A theme that was picked wins over the icon.
  expect(themeFromOptions({ paneTheme: 'exosphere-dark', bandIcon: 'flamingo' }).theme).toBe('exosphere-dark')
  expect(themeFromOptions({ paneTheme: 'garbage' }).theme).toBe('auto')
})

test('auto follows the system within its family; a picked theme ignores it', () => {
  expect(resolveTheme('auto', 'exosphere', false)).toBe('exosphere-light')
  expect(resolveTheme('auto', 'exosphere', true)).toBe('exosphere-dark')
  expect(resolveTheme('auto', 'whimsical', true)).toBe('whimsical-dark')
  expect(resolveTheme('whimsical-light', 'exosphere', true)).toBe('whimsical-light')
  expect(resolveTheme('terminal', 'exosphere', true)).toBe('terminal')
})

test("the system's mode is Dark only when macOS says so; anything else, or nothing, is light", () => {
  expect(isDarkAppearance('Dark\n')).toBe(true)
  expect(isDarkAppearance('dark')).toBe(true)
  expect(isDarkAppearance('')).toBe(false)
  expect(isDarkAppearance(undefined)).toBe(false)
  expect(isDarkAppearance('The domain/default pair of (kCFPreferencesAnyApplication, AppleInterfaceStyle) does not exist')).toBe(false)
})

test('the mark is the flamingo in Whimsical and the logo everywhere else', () => {
  expect(markOf('whimsical-light')).toBe('flamingo')
  expect(markOf('whimsical-dark')).toBe('flamingo')
  expect(markOf('exosphere-light')).toBe('logo')
  expect(markOf('exosphere-dark')).toBe('logo')
  expect(markOf('terminal')).toBe('logo')
})

test('the picker lists every theme once, each with a label of its own', () => {
  expect(THEME_OPTIONS.map(o => o.value)).toEqual([...THEMES])
  expect(new Set(THEME_OPTIONS.map(o => o.label)).size).toBe(THEMES.length)
})
