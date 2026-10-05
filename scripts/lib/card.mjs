import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(HERE, '..', '..')
export const OUT = process.env.CARDS_OUT || join(ROOT, 'assets')
export const FONTS = JSON.parse(await readFile(join(HERE, '..', 'glyphs.json'), 'utf8'))

export const W = 880
export const P = 48
export const MAX_BYTES = 80 * 1024

export const EASE_CURVE = [0.16, 1, 0.3, 1]
export const EASE = `cubic-bezier(${EASE_CURVE.join(',')})`

export const THEMES = {
  dark: {
    card: '#111318',
    edge: ['#ffffff', 0.09],
    glow: ['#3f7dff', 0.11],
    fg: '#ededef',
    fg2: '#a1a4aa',
    fg3: '#8a8d93',
    dot: '#5b9cff',
    line: ['#ffffff', 0.08],
    track: '#272b32',
    accent: ['#2a64de', '#5b9cff'],
    strong: '#5b9cff',
    neutral: ['#c3c8d1', '#8a8d93', '#555a63', '#33373f'],
  },
  light: {
    card: '#ffffff',
    edge: ['#141618', 0.11],
    glow: ['#1749c6', 0.05],
    fg: '#141618',
    fg2: '#4f5257',
    fg3: '#63666b',
    dot: '#1749c6',
    line: ['#141618', 0.09],
    track: '#eceef1',
    accent: ['#1749c6', '#3485ff'],
    strong: '#1749c6',
    neutral: ['#34373c', '#63666b', '#a1a4aa', '#d5d8de'],
  },
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const fmt = (v) => {
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}
export const sec = (v) => `${fmt(v)}s`
export const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
export const paint = (attr, [color, opacity]) => `${attr}="${color}" ${attr}-opacity="${opacity}"`
export const dateLabel = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`

export function fail(message) {
  console.error(message)
  process.exitCode = 1
}

export function hasGlyphs(str, font) {
  const g = FONTS[font].glyphs
  return [...str].every((ch) => ch in g)
}

export function measure(str, font, size, tracking = 0) {
  const f = FONTS[font]
  const s = size / f.upm
  const chars = [...str]
  const parts = []
  let x = 0
  chars.forEach((ch, i) => {
    const g = f.glyphs[ch]
    if (!g) throw new Error(`Glyph "${ch}" is missing from the ${font} table`)
    parts.push([x, g[1]])
    x += g[0]
    if (i < chars.length - 1) x += (f.kern[ch + chars[i + 1]] || 0) + tracking * f.upm
  })
  return { parts, width: x * s, scale: s }
}

function outline(path, ox, x0, y0, s, segs) {
  for (const [, cmd, args] of path.matchAll(/([MLQCZ])([^MLQCZ]*)/g)) {
    if (cmd === 'Z') {
      segs.push(['Z'])
      continue
    }
    const n = args.match(/-?\d+/g).map(Number)
    const pts = []
    for (let i = 0; i < n.length; i += 2) pts.push(x0 + (n[i] + ox) * s, y0 - n[i + 1] * s)
    segs.push([cmd, ...pts])
  }
}

const q1 = (v) => Math.round(v * 10)

function num(v) {
  const r = v / 10
  let str = String(r)
  if (str.startsWith('0.')) str = str.slice(1)
  else if (str.startsWith('-0.')) str = '-' + str.slice(2)
  return str
}

function serialise(segs) {
  let d = ''
  let last = ''
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let prev = null
  const write = (cmd, values) => {
    if (cmd !== last || cmd === 'm') {
      d += cmd
      prev = null
    }
    for (const v of values) {
      const joined = prev === null || v.startsWith('-') || (v.startsWith('.') && prev.includes('.'))
      d += joined ? v : ` ${v}`
      prev = v
    }
    last = cmd
  }
  for (const seg of segs) {
    const [cmd, ...pts] = seg
    if (cmd === 'Z') {
      d += 'z'
      last = 'z'
      prev = null
      cx = sx
      cy = sy
      continue
    }
    const abs = pts.map(q1)
    const rel = []
    for (let i = 0; i < abs.length; i += 2) rel.push(num(abs[i] - cx), num(abs[i + 1] - cy))
    const ex = abs.at(-2)
    const ey = abs.at(-1)
    if (cmd === 'M') {
      write('m', rel)
      sx = ex
      sy = ey
    } else if (cmd === 'L') {
      if (ey === cy) write('h', [rel[0]])
      else if (ex === cx) write('v', [rel[1]])
      else write('l', rel)
    } else write(cmd.toLowerCase(), rel)
    cx = ex
    cy = ey
  }
  return d
}

export function text(str, { font, size, x, y, anchor = 'start', tracking = 0, fill, attrs = '' }) {
  const m = measure(str, font, size, tracking)
  const x0 = anchor === 'end' ? x - m.width : anchor === 'middle' ? x - m.width / 2 : x
  const segs = []
  for (const [ox, p] of m.parts) outline(p, ox, x0, y, m.scale, segs)
  const d = serialise(segs)
  return { svg: d ? `<path fill="${fill}"${attrs} d="${d}"/>` : '', width: m.width, x: x0, right: x0 + m.width }
}

export const capOf = (font, size) => (FONTS[font].cap / FONTS[font].upm) * size
export const descOf = (font, size) => (-FONTS[font].desc / FONTS[font].upm) * size

export const LABEL = { font: 'mono', size: 17, tracking: 0.09 }

export function eyebrow(th, label, right = '') {
  const style = { ...LABEL, fill: th.fg3 }
  const y = P + capOf('mono', LABEL.size)
  const mid = y - capOf('mono', LABEL.size) / 2
  const left = text(label, { ...style, x: P + 20, y })
  const parts = [`<circle cx="${P + 4.5}" cy="${fmt(mid)}" r="4.5" fill="${th.dot}"/>`, left.svg]
  let rightX = W - P
  if (right) {
    const r = text(right, { ...style, x: W - P, y, anchor: 'end' })
    if (r.x < left.right + 32) throw new Error('The eyebrow labels overlap')
    parts.push(r.svg)
    rightX = r.x
  }
  return { svg: parts.join(''), y, mid, leftEnd: left.right, rightX }
}

export function bezier([p1x, p1y, p2x, p2y]) {
  const cx = 3 * p1x
  const bx = 3 * (p2x - p1x) - cx
  const ax = 1 - cx - bx
  const cy = 3 * p1y
  const by = 3 * (p2y - p1y) - cy
  const ay = 1 - cy - by
  const sx = (t) => ((ax * t + bx) * t + cx) * t
  const sy = (t) => ((ay * t + by) * t + cy) * t
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let lo = 0
    let hi = 1
    let t = x
    for (let i = 0; i < 40; i++) {
      const v = sx(t)
      if (Math.abs(v - x) < 1e-7) break
      if (v < x) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return sy(t)
  }
}

export function sweep(delay, duration, curve = [0.5, 1, 0.89, 1]) {
  const ease = bezier(curve)
  const headAt = (t) => ease((t - delay) / duration)
  return (fraction) => {
    if (fraction <= 0) return delay
    let lo = delay
    let hi = delay + duration
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2
      if (headAt(mid) < fraction) lo = mid
      else hi = mid
    }
    return hi
  }
}

export function createAnimator() {
  const byBody = new Map()
  const rules = []
  let n = 0
  let end = 0
  const name = (body) => {
    if (!byBody.has(body)) {
      const id = `k${(n++).toString(36)}`
      byBody.set(body, id)
      rules.push(`@keyframes ${id}{${body}}`)
    }
    return byBody.get(body)
  }
  const css = (body, dur, delay, ease = EASE) => {
    end = Math.max(end, delay + dur)
    return `animation:${name(body)} ${sec(dur)} ${ease} ${sec(delay)} backwards`
  }
  const style = (body, dur, delay, ease = EASE) => ` style="${css(body, dur, delay, ease)}"`
  return { rules, name, css, style, end: () => end }
}

export const FADE = 'from{opacity:0}'
export const GROW_X = 'from{transform:scaleX(0)}'
export const GROW_Y = 'from{transform:scaleY(0)}'

export function frame({ th, H, title, desc, defs = '', css = [], body }) {
  const style = [...css, `@media (prefers-reduced-motion:reduce){*{animation:none!important}}`].join('')
  return (
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc">`,
      `<title id="title">${escapeXml(title)}</title><desc id="desc">${escapeXml(desc)}</desc>`,
      `<defs><radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(${P} 0) scale(560 300)"><stop offset="0" stop-color="${th.glow[0]}" stop-opacity="${th.glow[1]}"/><stop offset="1" stop-color="${th.glow[0]}" stop-opacity="0"/></radialGradient>`,
      `<clipPath id="card"><rect width="${W}" height="${H}" rx="24"/></clipPath>${defs}</defs>`,
      `<style>${style}</style>`,
      `<g clip-path="url(#card)"><rect width="${W}" height="${H}" fill="${th.card}"/><rect width="${W}" height="${H}" fill="url(#glow)"/></g>`,
      `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="23.5" fill="none" ${paint('stroke', th.edge)}/>`,
      ...body,
      `</svg>`,
    ].join('\n') + '\n'
  )
}

export function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function finish(raw, label) {
  if (/[\u2013\u2014\u2018\u2019\u201c\u201d]/.test(raw)) throw new Error(`${label}: dash or curly quote characters found`)
  if (/<text|<foreignObject|<image|<script|<!--|href="(?!#)/i.test(raw)) throw new Error(`${label}: live text, script, comment or external reference found`)
  if (/infinite|alternate/.test(raw)) throw new Error(`${label}: looping animation found`)
  if (!/role="img"/.test(raw) || !/<title id="title">[^<]+<\/title>/.test(raw) || !/<desc id="desc">[^<]+<\/desc>/.test(raw)) throw new Error(`${label}: missing role, title or desc`)
  const svg = raw.replace(/[^\x00-\x7f]/g, (c) => `&#${c.codePointAt(0)};`)
  const bytes = Buffer.byteLength(svg)
  if (bytes > MAX_BYTES) throw new Error(`${label}: ${(bytes / 1024).toFixed(1)} KB is over the ${MAX_BYTES / 1024} KB budget`)
  return svg
}

export async function writeCards(name, renderTheme) {
  const files = {}
  for (const theme of Object.keys(THEMES)) files[theme] = finish(renderTheme(theme), `${name}-${theme}.svg`)
  await mkdir(OUT, { recursive: true })
  const written = []
  for (const [theme, svg] of Object.entries(files)) {
    const file = join(OUT, `${name}-${theme}.svg`)
    await writeFile(`${file}.tmp`, svg)
    written.push([file, svg])
  }
  for (const [file, svg] of written) {
    await rename(`${file}.tmp`, file)
    console.log(`${file} ${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB`)
  }
}

export async function request(url, init = {}, attempts = 3) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) })
      if (!res.ok) {
        const error = new Error(`${url.split('?')[0]} responded ${res.status}`)
        error.status = res.status
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          lastError = error
          break
        }
        throw error
      }
      return res
    } catch (error) {
      lastError = error
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
    }
  }
  throw lastError
}

export function githubHeaders(token, agent) {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': agent }
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}
