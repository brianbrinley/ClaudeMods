import { expect, test } from 'claude-code/testing'
import { BOOMI_MARK_PIXELS, BOOMI_MARK_PNG, drawsPictures, markCells } from '../hooks/boomi-mark'

test('the mark is 6 pixels square: three rows of six cells, with the corners of the disc left clear', () => {
  expect(BOOMI_MARK_PIXELS).toHaveLength(6)
  for (const row of BOOMI_MARK_PIXELS) expect(row).toHaveLength(6)
  const cells = markCells()
  expect(cells).toHaveLength(3)
  for (const row of cells) expect(row).toHaveLength(6)
  expect(cells[0]![0]).toEqual({ char: '▄', color: '#003D58' })
  expect(cells[0]![1]).toEqual({ char: '▀', color: '#003D58', backgroundColor: '#FFFFFF' })
})

test('the coral dot is in the upper right, as in the logo, and the b stands to the left', () => {
  const cells = markCells().flat()
  expect(cells.some(c => c.color === '#FF7C66' || c.backgroundColor === '#FF7C66')).toBe(true)
  expect(BOOMI_MARK_PIXELS[1]!.indexOf('C')).toBeGreaterThan(BOOMI_MARK_PIXELS[1]!.indexOf('W'))
})

test('the picture is a PNG', () => {
  expect(BOOMI_MARK_PNG.startsWith('iVBORw0KGgo')).toBe(true)
})

test('pictures are drawn in kitty and Ghostty only', () => {
  expect(drawsPictures({ TERM_PROGRAM: 'ghostty' })).toBe(true)
  expect(drawsPictures({ TERM: 'xterm-kitty' })).toBe(true)
  expect(drawsPictures({ TERM_PROGRAM: 'Apple_Terminal', TERM: 'xterm-256color' })).toBe(false)
  expect(drawsPictures({})).toBe(false)
})
