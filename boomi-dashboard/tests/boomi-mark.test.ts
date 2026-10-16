import { expect, test } from 'claude-code/testing'
import { BOOMI_MARK_PIXELS, BOOMI_MARK_PNG, drawsPictures, markCells } from '../hooks/boomi-mark'

test('the fallback is 4 by 4 pixels: two rows of four cells, a navy disc with the corners clear', () => {
  expect(BOOMI_MARK_PIXELS).toHaveLength(4)
  for (const row of BOOMI_MARK_PIXELS) expect(row).toHaveLength(4)
  const cells = markCells()
  expect(cells).toHaveLength(2)
  expect(cells[0]!.map(c => c.char).join('')).toBe('▄▀▀▄')
  expect(cells[1]!.map(c => c.char).join('')).toBe('▀▀▀▀')
  expect(cells[0]![1]).toEqual({ char: '▀', color: '#FF7C66', backgroundColor: '#003D58' })
})

test('the ring is coral and the middle is navy', () => {
  const cells = markCells().flat()
  expect(cells.some(c => c.color === '#FF7C66')).toBe(true)
  expect(cells.some(c => c.backgroundColor === '#003D58')).toBe(true)
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
