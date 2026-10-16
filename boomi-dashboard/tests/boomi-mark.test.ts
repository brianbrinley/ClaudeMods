import { expect, test } from 'claude-code/testing'
import { BOOMI_MARK_PNG, drawsPictures } from '../hooks/boomi-mark'

test('the picture is a PNG', () => {
  expect(BOOMI_MARK_PNG.startsWith('iVBORw0KGgo')).toBe(true)
})

test('pictures are drawn in kitty and Ghostty only', () => {
  expect(drawsPictures({ TERM_PROGRAM: 'ghostty' })).toBe(true)
  expect(drawsPictures({ TERM: 'xterm-kitty' })).toBe(true)
  expect(drawsPictures({ TERM_PROGRAM: 'Apple_Terminal', TERM: 'xterm-256color' })).toBe(false)
  expect(drawsPictures({})).toBe(false)
})
