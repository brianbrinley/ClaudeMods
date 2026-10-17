// What a prompt's rewrite reads besides the prompt: the folder's own
// components and the parts of Companion's reference docs that match the
// prompt's words. Keyword matching, no index or embeddings. Plain functions:
// the tests call them directly, and the hooks module does the reading.

/** A component in the folder, from its XML's root element. */
export type FolderComponent = { name: string; type?: string; folder?: string }

/** One section of a reference doc, under its heading. */
export type Section = { source: string; heading: string; text: string }

/** The component an XML file holds: its name, type and folder, from the root element's attributes. */
export const folderComponentOf = (xml: string): FolderComponent | undefined => {
  const root = xml.match(/<(?:\w+:)?Component\b[^>]*>/)?.[0]
  if (!root) return undefined
  const attr = (name: string) => root.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
  const name = attr('name')
  if (!name) return undefined
  const type = attr('type')
  const folder = attr('folderFullPath')
  return { name, ...(type ? { type } : {}), ...(folder ? { folder } : {}) }
}

const STOP = new Set(
  'the and for with that this from into onto then than them they you your our ours lets let make build create need want would could should will can please just like some also into over under about what when where which while have has had not but are was were been being its it'.split(' '),
)

/** A text's words worth matching on: lowercase, three letters or more, without the common ones. */
export const keywords = (text: string): string[] => [
  ...new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 3 && !STOP.has(w))
      .map(w => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)),
  ),
]

const hits = (words: readonly string[], text: string) => {
  const lower = text.toLowerCase()
  return words.filter(w => lower.includes(w)).length
}

/** The folder's components that share words with the prompt, best first; none when nothing matches. */
export const relevantComponents = (all: readonly FolderComponent[], prompt: string, limit = 8): FolderComponent[] => {
  const words = keywords(prompt)
  return all
    .map(c => ({ c, score: hits(words, `${c.name} ${c.type ?? ''}`) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map(x => x.c)
}

/** A Markdown doc in sections, one per heading of level one to three. */
export const sectionsOf = (source: string, markdown: string): Section[] => {
  const sections: Section[] = []
  let heading = ''
  let lines: string[] = []
  const flush = () => {
    const text = lines.join('\n').trim()
    if (text) sections.push({ source, heading, text })
  }
  for (const line of markdown.split('\n')) {
    const h = line.match(/^#{1,3}\s+(.*)$/)
    if (h) {
      flush()
      heading = h[1]!.trim()
      lines = []
    } else lines.push(line)
  }
  flush()
  return sections
}

/** How much of Companion's guidance a rewrite reads: up to this many sections, each cut to this many characters, and this many in all (about 2,500 tokens). */
export const CONTEXT_SECTIONS = 6
export const SECTION_CHARS = 2000
export const CONTEXT_CHARS = 10_000

/** The words of a text counted by how often they come up, most often first. */
const topWords = (text: string, count: number): string[] => {
  const seen = new Map<string, number>()
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue
    const w = raw.length > 4 && raw.endsWith('s') ? raw.slice(0, -1) : raw
    seen.set(w, (seen.get(w) ?? 0) + 1)
  }
  return [...seen].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, count).map(([w]) => w)
}

/**
 * A section cut to `max` characters by keeping the paragraphs that match the
 * prompt's words best, in their order, with `…` where some were left out.
 */
export const excerpt = (text: string, words: readonly string[], max: number): string => {
  if (text.length <= max) return text
  const paragraphs = text.split(/\n\s*\n/)
  const ranked = paragraphs.map((para, i) => ({ para, i, score: hits(words, para) })).sort((a, b) => b.score - a.score || a.i - b.i)
  const kept = new Set<number>()
  let used = 0
  for (const { para, i } of ranked) {
    const cost = Math.min(para.length, max) + 2
    if (used + cost > max && kept.size > 0) continue
    kept.add(i)
    used += cost
  }
  const out: string[] = []
  let last = -1
  for (const [i, para] of paragraphs.entries()) {
    if (!kept.has(i)) continue
    if (i > last + 1 && out.length > 0) out.push('…')
    out.push(para.length > max ? `${para.slice(0, max - 1)}…` : para)
    last = i
  }
  if (last < paragraphs.length - 1) out.push('…')
  return out.join('\n\n')
}

/**
 * The sections that best match the prompt's words, a heading's words counting
 * three times and its file's two; each cut to `max` characters by its best
 * paragraphs, and all together to `total`.
 */
export const relevantSections = (all: readonly Section[], prompt: string, limit = CONTEXT_SECTIONS, max = SECTION_CHARS, total = CONTEXT_CHARS): Section[] => {
  const words = keywords(prompt)
  const picked = all
    .map(s => ({ s, score: hits(words, s.heading) * 3 + hits(words, s.source.replace(/[^A-Za-z0-9]+/g, ' ')) * 2 + hits(words, s.text) }))
    .filter(x => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  const out: Section[] = []
  let used = 0
  for (const { s } of picked) {
    const text = excerpt(s.text, words, Math.min(max, Math.max(200, total - used)))
    if (used + text.length > total && out.length > 0) break
    used += text.length
    out.push({ ...s, text })
  }
  return out
}

// --- The index of Companion's reference docs ---------------------------------------

/** A fingerprint of a text (FNV-1a, 32 bits, in hex): enough to tell a doc changed, not to protect anything. */
export const fingerprint = (text: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** One section's place in the index: its heading and its most telling words. The text stays in the doc. */
export type IndexSection = { heading: string; words: string[] }

/** One doc in the index: what it said when it was last read. `digest` is for a summary added later, after a person reviewed it. */
export type IndexFile = { plugin: string; file: string; hash: string; sections: IndexSection[]; digest?: string }

/**
 * Companion's reference docs, by pointer: for each plugin its version and
 * folder, and for each doc its fingerprint, its sections' headings and their
 * key words. The docs' text is never copied: a rewrite reads the few sections
 * it needs from the doc itself, so the text can't go stale. Rebuilt when a
 * plugin's version changes, reusing every doc whose fingerprint hasn't.
 */
export type DocIndex = {
  built: 1
  plugins: Record<string, { version: string; dir: string }>
  files: Record<string, IndexFile>
}

export const EMPTY_INDEX: DocIndex = { built: 1, plugins: {}, files: {} }

/** A doc's entry: reused when its text hasn't changed since `before`, else rebuilt from its sections. */
export const indexFile = (plugin: string, file: string, text: string, before?: IndexFile): IndexFile => {
  const hash = fingerprint(text)
  if (before && before.hash === hash && before.plugin === plugin) return before
  return { plugin, file, hash, sections: sectionsOf(file, text).map(s => ({ heading: s.heading, words: topWords(s.text, 30) })) }
}

/** Whether the index was built for exactly these plugin versions (so nothing needs reading again). */
export const isCurrent = (index: DocIndex, installed: Readonly<Record<string, { version: string; dir: string }>>): boolean => {
  const have = Object.keys(index.plugins)
  const want = Object.keys(installed)
  return have.length === want.length && want.every(n => index.plugins[n]?.version === installed[n]!.version && index.plugins[n]?.dir === installed[n]!.dir)
}

/** A doc's name for a person: `bc-integration/guides/boomi_error_reference.md`. */
export const docName = (f: IndexFile): string => `${f.plugin}/${f.file.replace(/^skills\/[^/]+\/references\//, '')}`

/** The sections of every indexed doc that best match the prompt's words, best first: where to read, not the text. */
export const relevantPlaces = (index: DocIndex, prompt: string, limit = CONTEXT_SECTIONS * 2): { file: IndexFile; heading: string; score: number }[] => {
  const words = keywords(prompt)
  const places: { file: IndexFile; heading: string; score: number }[] = []
  for (const file of Object.values(index.files)) {
    const fileWords = keywords(file.file.replace(/[^A-Za-z0-9]+/g, ' '))
    for (const section of file.sections) {
      const headingWords = keywords(section.heading)
      const score =
        words.filter(w => headingWords.includes(w)).length * 3 +
        words.filter(w => fileWords.includes(w)).length * 2 +
        words.filter(w => section.words.includes(w)).length
      if (score >= 2) places.push({ file, heading: section.heading, score })
    }
  }
  return places.sort((a, b) => b.score - a.score || a.file.file.localeCompare(b.file.file)).slice(0, limit)
}

/** What the rewrite reads from the folder and Companion's docs, as lines of its request. */
export const contextLines = (components: readonly FolderComponent[], sections: readonly Section[]): string[] => [
  ...(components.length > 0
    ? ['', 'Components in this folder that may be meant (use a name only where the prompt clearly means it):', ...components.map(c => `- ${c.name}${c.type ? ` (${c.type})` : ''}${c.folder ? `, in ${c.folder}` : ''}`)]
    : []),
  ...(sections.length > 0
    ? ['', "From Boomi Companion's guidance (only to decide what to ask the person about, never work to add):", ...sections.map(s => `[${s.source}: ${s.heading}]\n${s.text}`)]
    : []),
]
