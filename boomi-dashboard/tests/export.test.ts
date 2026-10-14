import { expect, test } from 'claude-code/testing'
import { toCsv, toTsv } from '../hooks/export'

const TABLE = {
  header: ['Component', 'Component ID', 'Cost (USD)'],
  rows: [
    ['Orders, "EU" sync', 'c-1', '0.17'],
    ['=HYPERLINK("x")', 'c-2', ''],
    ['Two\nlines\tand a tab', 'c-3', '1.00'],
  ],
}

test('CSV as spreadsheets read it: quoted where needed, quotes doubled, CRLF lines', () => {
  expect(toCsv(TABLE)).toBe(
    ['Component,Component ID,Cost (USD)', '"Orders, ""EU"" sync",c-1,0.17', `"'=HYPERLINK(""x"")",c-2,`, '"Two\nlines\tand a tab",c-3,1.00', ''].join('\r\n'),
  )
})

test('tab-separated for pasting into cells: one line a row, no tab or line break inside a cell', () => {
  expect(toTsv(TABLE)).toBe(['Component\tComponent ID\tCost (USD)', 'Orders, "EU" sync\tc-1\t0.17', `'=HYPERLINK("x")\tc-2\t`, 'Two lines and a tab\tc-3\t1.00', ''].join('\n'))
})

test("a name a spreadsheet would run as a formula is made text; IDs and amounts aren't touched", () => {
  for (const risky of ['=1+1', '+1', '-1', '@SUM(A1)']) expect(toTsv({ header: ['x'], rows: [[risky]] })).toBe(`x\n'${risky}\n`)
  expect(toTsv({ header: ['x'], rows: [['execution-1e5c2ffd'], ['0.17']] })).toBe('x\nexecution-1e5c2ffd\n0.17\n')
})
