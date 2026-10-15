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

/** The sections that best match the prompt's words, a heading's words counting three times; each cut to `max` characters. */
export const relevantSections = (all: readonly Section[], prompt: string, limit = 3, max = 1200): Section[] => {
  const words = keywords(prompt)
  return all
    .map(s => ({ s, score: hits(words, s.heading) * 3 + hits(words, s.text) }))
    .filter(x => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => ({ ...x.s, text: x.s.text.length > max ? `${x.s.text.slice(0, max)}…` : x.s.text }))
}

/** What the rewrite reads from the folder and Companion's docs, as lines of its request. */
export const contextLines = (components: readonly FolderComponent[], sections: readonly Section[]): string[] => [
  ...(components.length > 0
    ? ['', 'Components in this folder that may be meant (use a name only where the prompt clearly means it):', ...components.map(c => `- ${c.name}${c.type ? ` (${c.type})` : ''}${c.folder ? `, in ${c.folder}` : ''}`)]
    : []),
  ...(sections.length > 0 ? ['', "From Boomi Companion's guidance (what a good request for this work includes):", ...sections.map(s => `[${s.source}: ${s.heading}]\n${s.text}`)] : []),
]
