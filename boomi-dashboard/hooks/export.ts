// A table as text another program takes: tab-separated for pasting into a
// spreadsheet's cells, CSV for a file. Plain functions: nothing here touches
// the engine.

/** A table to hand on: its column names and its rows, every cell text. */
export type Table = { header: readonly string[]; rows: readonly (readonly string[])[] }

/**
 * A cell a spreadsheet would read as a formula (=, +, -, @ first) gets a
 * leading apostrophe, so pasting a component's name never runs anything.
 * IDs, times and amounts never start that way.
 */
const inert = (cell: string) => (/^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell)

/** CSV as RFC 4180 has it: a cell with a comma, quote or line break quoted, quotes doubled; lines end CRLF. */
export const toCsv = (table: Table): string =>
  [table.header, ...table.rows]
    .map(row => row.map(inert).map(cell => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
    .join('\r\n') + '\r\n'

/** Tab-separated, as a spreadsheet takes a paste: tabs and line breaks inside a cell become spaces. */
export const toTsv = (table: Table): string =>
  [table.header, ...table.rows].map(row => row.map(inert).map(cell => cell.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n') + '\n'
