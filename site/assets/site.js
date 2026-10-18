// Valence site: Day/Night toggle, theme-aware banners and Mermaid diagrams, search, and the architecture diagrams.
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

const root = document.documentElement;
const media = window.matchMedia('(prefers-color-scheme: dark)');
const NIGHT_INIT = window.VALENCE_NIGHT_INIT;
const DAY_RECT = /rect rgb\(251, 246, 238\)/g;
const NIGHT_RECT = 'rect rgb(31, 36, 64)';

function isNight() {
  const t = root.getAttribute('data-theme');
  return t ? t === 'dark' : media.matches;
}

// <picture> sources follow the OS setting, so pick the image explicitly when the user overrides it.
function syncPictures() {
  document.querySelectorAll('picture').forEach((pic) => {
    const img = pic.querySelector('img');
    const dark = pic.querySelector('source[media*="dark"]');
    if (!img || !dark) return;
    if (!img.dataset.day) img.dataset.day = img.getAttribute('src');
    if (!pic.dataset.night) pic.dataset.night = dark.getAttribute('srcset');
    dark.setAttribute('media', 'not all');
    img.setAttribute('src', isNight() ? pic.dataset.night : img.dataset.day);
  });
}

async function renderDiagrams() {
  const nodes = [...document.querySelectorAll('pre.mermaid')];
  if (!nodes.length) return;
  const night = isNight();
  for (const node of nodes) {
    if (!node.dataset.source) node.dataset.source = node.textContent;
    let src = node.dataset.source;
    if (night && NIGHT_INIT) {
      src = src.replace(/^\s*%%\{init:[\s\S]*?\}%%/, NIGHT_INIT).replace(DAY_RECT, NIGHT_RECT);
    }
    node.removeAttribute('data-processed');
    node.textContent = src;
  }
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
  await mermaid.run({ nodes });
}

// A Copy button only on blocks meant to be pasted somewhere else: shell commands and prompts (```prompt).
// Sample output and config examples don't get one.
const COPYABLE = ['bash', 'sh', 'shell', 'prompt'].map((l) => `pre > code.language-${l}`).join(', ');
function addCopyButtons() {
  document.querySelectorAll(COPYABLE).forEach((code) => {
    const pre = code.parentElement;
    if (pre.querySelector('.copy-button')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-button';
    button.textContent = 'Copy';
    button.addEventListener('click', async () => {
      const text = (pre.querySelector('code') ?? pre).innerText;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copied';
      } catch (e) {
        button.textContent = 'Select it to copy';
      }
      setTimeout(() => { button.textContent = 'Copy'; }, 2000);
    });
    pre.appendChild(button);
  });
}

// Architecture diagrams are pages of their own (docs/architecture/valence), shown scaled to the column.
// Same origin, so the preview takes the site's theme and drops the title the section heading already gives.
const DIAGRAM_WIDTH = 1344; // the diagram page's 1280px frame and its 2rem padding each side
function fitDiagram(iframe) {
  const doc = iframe.contentDocument;
  if (!doc?.querySelector('.frame')) return;
  doc.documentElement.setAttribute('data-theme', isNight() ? 'dark' : 'light');
  if (!doc.getElementById('preview-style')) {
    const style = doc.createElement('style');
    style.id = 'preview-style';
    style.textContent = 'body { min-height: 0; padding: 1.5rem 2rem; } .eyebrow, .frame > h1 { display: none; }';
    doc.head.append(style);
  }
  const box = iframe.parentElement;
  const scale = box.clientWidth / DIAGRAM_WIDTH;
  iframe.style.height = '0px';
  const height = doc.documentElement.scrollHeight;
  iframe.style.height = `${height}px`;
  iframe.style.transform = `scale(${scale})`;
  box.classList.add('fitted');
  box.style.height = `${Math.ceil(height * scale)}px`;
}
function fitDiagrams() {
  document.querySelectorAll('.diagram-frame iframe').forEach(fitDiagram);
}
document.querySelectorAll('.diagram-frame iframe').forEach((iframe) => {
  iframe.addEventListener('load', () => fitDiagram(iframe));
  fitDiagram(iframe);
});
window.addEventListener('resize', fitDiagrams);

// Search: every heading on the site and the text under it, from search.json, loaded on first use.
const searchInput = document.getElementById('site-search');
const searchList = document.getElementById('search-results');
const searchStatus = document.getElementById('search-status');
let searchIndex;
async function loadIndex() {
  if (!searchIndex) {
    searchIndex = fetch(`${window.VALENCE_ROOT ?? ''}search.json`).then((r) => r.json()).catch(() => []);
  }
  return searchIndex;
}
function highlight(parent, text, terms) {
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  text.split(re).forEach((part, i) => {
    if (i % 2) {
      const mark = document.createElement('mark');
      mark.textContent = part;
      parent.append(mark);
    } else {
      parent.append(part);
    }
  });
}
function snippet(text, terms) {
  const lower = text.toLowerCase();
  const at = Math.min(...terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0));
  if (!Number.isFinite(at)) return text.slice(0, 140);
  const start = Math.max(0, at - 50);
  return (start ? '…' : '') + text.slice(start, start + 150) + (start + 150 < text.length ? '…' : '');
}
function closeSearch() {
  searchList.hidden = true;
  searchInput.setAttribute('aria-expanded', 'false');
}
async function runSearch() {
  const terms = searchInput.value.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  searchList.replaceChildren();
  if (!terms.length) { closeSearch(); searchStatus.textContent = ''; return; }
  const index = await loadIndex();
  const hits = index
    .map((e) => {
      const h = e.h.toLowerCase(); const x = e.x.toLowerCase(); const p = e.p.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (h.includes(t)) score += 5;
        else if (x.includes(t)) score += 1;
        else if (p.includes(t)) score += 0.5;
        else return null;
      }
      return { e, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  for (const { e } of hits) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `${window.VALENCE_ROOT ?? ''}${e.u}`;
    const where = document.createElement('span');
    where.className = 'where';
    where.textContent = e.p;
    const title = document.createElement('strong');
    highlight(title, e.h, terms);
    const text = document.createElement('span');
    text.className = 'snippet';
    highlight(text, snippet(e.x, terms), terms);
    a.append(where, title, text);
    a.addEventListener('click', closeSearch);
    li.append(a);
    searchList.append(li);
  }
  if (!hits.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No matches';
    searchList.append(li);
  }
  searchStatus.textContent = hits.length ? `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}` : 'No matches';
  searchList.hidden = false;
  searchInput.setAttribute('aria-expanded', 'true');
}
if (searchInput) {
  searchInput.addEventListener('focus', loadIndex);
  searchInput.addEventListener('input', runSearch);
  searchInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); searchList.querySelector('a')?.focus(); }
    if (ev.key === 'Enter') { const first = searchList.querySelector('a'); if (first) { ev.preventDefault(); first.click(); } }
    if (ev.key === 'Escape') { searchInput.value = ''; closeSearch(); }
  });
  searchList.addEventListener('keydown', (ev) => {
    const links = [...searchList.querySelectorAll('a')];
    const i = links.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); links[Math.min(i + 1, links.length - 1)]?.focus(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); (i > 0 ? links[i - 1] : searchInput).focus(); }
    if (ev.key === 'Escape') { closeSearch(); searchInput.focus(); }
  });
  document.addEventListener('click', (ev) => { if (!ev.target.closest('.search')) closeSearch(); });
}

function update() {
  syncPictures();
  renderDiagrams();
  fitDiagrams();
}

document.querySelector('.theme-toggle')?.addEventListener('click', () => {
  const next = isNight() ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('valence-theme', next); } catch (e) { /* storage unavailable */ }
  update();
});
media.addEventListener('change', () => { if (!root.getAttribute('data-theme')) update(); });

addCopyButtons();
update();
