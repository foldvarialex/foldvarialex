import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
function findRoot(dir) {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, 'scripts', 'glyphs.json')) && existsSync(join(d, 'assets'))) return d
    if (dirname(d) === d) throw new Error('Could not find the repository root (scripts/glyphs.json)')
  }
}
const ROOT = process.env.TIMELINE_ROOT || findRoot(HERE)
const OUT = process.env.TIMELINE_OUT || join(ROOT, 'assets')
const META = process.env.TIMELINE_META ?? (basename(HERE) === 'scripts' ? '' : join(HERE, 'meta.json'))
const FONTS = JSON.parse(await readFile(join(ROOT, 'scripts', 'glyphs.json'), 'utf8'))

const START = { y: 2022, m: 1 }
const TODAY = process.env.TIMELINE_NOW ? new Date(`${process.env.TIMELINE_NOW}T00:00:00Z`) : new Date()
if (Number.isNaN(TODAY.getTime())) throw new Error('TIMELINE_NOW must be a YYYY-MM-DD date')
const NOW = { y: TODAY.getUTCFullYear(), m: TODAY.getUTCMonth() + 1, d: TODAY.getUTCDate(), dim: new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() + 1, 0)).getUTCDate() }
const YEARS = Array.from({ length: NOW.y - START.y + 1 }, (_, i) => START.y + i)

const SEGMENTS = [
  { key: 'helix', from: [2022, 1], to: [2024, 3], kind: 'work', title: 'HelixLab Kft', sub: 'Frontend Developer (Angular)' },
  { key: 'studies', from: [2024, 4], to: [2025, 4], kind: 'study', title: 'Studies', sub: 'and own projects' },
  { key: 'dynex', from: [2025, 5], to: [2026, 3], kind: 'work', title: 'Dynex Kft', sub: 'Full-Stack, Technical Lead' },
  { key: 'self', from: [2026, 4], to: null, kind: 'now', title: 'Self-employed', sub: 'Building Solory' },
]

const MILESTONES = [
  { at: [2024, 9], text: 'BSc studies start', align: 'start' },
  { at: [2025, 11], text: '1st place, research competition', align: 'end' },
]

const THEMES = {
  dark: {
    card: '#111318',
    edge: ['#ffffff', 0.09],
    glow: ['#3f7dff', 0.11],
    fg: '#ededef',
    fg2: '#a1a4aa',
    fg3: '#8a8d93',
    dot: '#5b9cff',
    axis: ['#ffffff', 0.16],
    tick: ['#ffffff', 0.22],
    leader: ['#ffffff', 0.2],
    work: '#3d424c',
    study: '#2b2f37',
    accent: ['#2a64de', '#5b9cff'],
    now: '#5b9cff',
    pin: '#c3c8d1',
  },
  light: {
    card: '#ffffff',
    edge: ['#141618', 0.11],
    glow: ['#1749c6', 0.05],
    fg: '#141618',
    fg2: '#4f5257',
    fg3: '#63666b',
    dot: '#1749c6',
    axis: ['#141618', 0.16],
    tick: ['#141618', 0.24],
    leader: ['#141618', 0.22],
    work: '#c9cdd4',
    study: '#e6e8ec',
    accent: ['#1749c6', '#3485ff'],
    now: '#1749c6',
    pin: '#34373c',
  },
}

const W = 880
const P = 48
const X0 = P
const X1 = W - P
const BAR = 12
const GAP = 3

const EASE_CURVE = [0.16, 1, 0.3, 1]
const EASE = `cubic-bezier(${EASE_CURVE.join(',')})`
const RAIL_CURVE = [0.5, 1, 0.89, 1]
const MOTION = {
  railDelay: 0.1,
  railDur: 1.5,
  lag: 0.05,
  label: 0.6,
  tick: 0.5,
  nowAt: 1.3,
  leaderAt: 1.4,
  leaderDraw: 0.5,
  calloutAt: 1.55,
  milestoneLag: 0.08,
}

const fmt = (v) => {
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}
const sec = (v) => `${fmt(v)}s`
const paint = (attr, [color, opacity]) => `${attr}="${color}" ${attr}-opacity="${opacity}"`

function bezier([p1x, p1y, p2x, p2y]) {
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

const railEase = bezier(RAIL_CURVE)
const headAt = (t) => X0 + (X1 - X0) * railEase((t - MOTION.railDelay) / MOTION.railDur)
function timeAt(x) {
  if (x <= X0) return MOTION.railDelay
  let lo = MOTION.railDelay
  let hi = MOTION.railDelay + MOTION.railDur
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (headAt(mid) < x) lo = mid
    else hi = mid
  }
  return hi
}

const monthIndex = (y, m, d = 1, dim = 30) => (y - START.y) * 12 + (m - START.m) + (d - 1) / dim
const SPAN = monthIndex(NOW.y, NOW.m, NOW.d, NOW.dim)
const xOf = (mi) => X0 + (mi / SPAN) * (X1 - X0)

function measure(str, font, size, tracking = 0) {
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

function text(str, { font, size, x, y, anchor = 'start', tracking = 0, fill }) {
  const m = measure(str, font, size, tracking)
  const x0 = anchor === 'end' ? x - m.width : anchor === 'middle' ? x - m.width / 2 : x
  const segs = []
  for (const [ox, p] of m.parts) outline(p, ox, x0, y, m.scale, segs)
  const d = serialise(segs)
  return { svg: d ? `<path fill="${fill}" d="${d}"/>` : '', width: m.width, x: x0 }
}

const capOf = (font, size) => (FONTS[font].cap / FONTS[font].upm) * size
const descOf = (font, size) => (-FONTS[font].desc / FONTS[font].upm) * size

function createAnimator() {
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
  const style = (body, dur, delay, ease = EASE) => {
    end = Math.max(end, delay + dur)
    return ` style="animation:${name(body)} ${sec(dur)} ${ease} ${sec(delay)} backwards"`
  }
  const mark = (t) => {
    end = Math.max(end, t)
  }
  return { rules, name, style, mark, end: () => end }
}

function sampled(anim, from, to, valueAt, prop) {
  const steps = Math.max(8, Math.ceil((to - from) / 0.04))
  const frames = []
  let last = null
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps
    const v = valueAt(t)
    const pct = `${Math.round((i / steps) * 10000) / 100}%`
    const body = `${prop}:${fmt(v)}`
    if (body === last && i !== steps) continue
    frames.push(`${pct}{${body}}`)
    last = body
  }
  anim.mark(to)
  return ` style="animation:${anim.name(frames.join(''))} ${sec(to - from)} linear ${sec(from)} backwards"`
}

function render(theme) {
  const th = THEMES[theme]
  const anim = createAnimator()
  const out = []
  const push = (s) => out.push(typeof s === 'string' ? s : s.svg)
  const fade = 'from{opacity:0}'
  const draw = 'from{stroke-dashoffset:101}to{stroke-dashoffset:0}'

  const eyebrowText = 'EXPERIENCE · 2022 - TODAY'
  const eyebrow = { font: 'mono', size: 17, tracking: 0.09, fill: th.fg3 }
  const eyebrowY = P + capOf('mono', eyebrow.size)
  const mid = eyebrowY - capOf('mono', eyebrow.size) / 2
  push(`<circle cx="${P + 4.5}" cy="${fmt(mid)}" r="4.5" fill="${th.dot}"/>`)
  push(text(eyebrowText, { ...eyebrow, x: P + 20, y: eyebrowY }))

  const titleSize = 24
  const subSize = 18
  const titleGap = 24

  const nowTitleY = Math.round(eyebrowY + 26 + capOf('display', titleSize))
  const nowSubY = nowTitleY + titleGap
  const rowTitleY = Math.round(nowSubY + descOf('body', subSize) * 0.75 + 14 + capOf('display', titleSize))
  const rowSubY = rowTitleY + titleGap
  const barTop = Math.round(rowSubY + descOf('body', subSize) * 0.75 + 13)
  const barMid = barTop + BAR / 2
  const axisY = barTop + BAR + 11.5
  const tickLen = 6
  const yearStyle = { font: 'mono', size: 16, tracking: 0.04, fill: th.fg3 }
  const yearY = Math.round(axisY + tickLen + 8 + capOf('mono', yearStyle.size))
  const msText = { font: 'body', size: 18, fill: th.fg2 }
  const msRow = [yearY + 34, yearY + 61]
  const H = Math.round(msRow[1] + descOf('body', msText.size) * 0.6 + P - 4)

  const segs = SEGMENTS.map((s) => {
    const a = xOf(monthIndex(...s.from))
    const b = s.to ? xOf(monthIndex(s.to[0], s.to[1] + 1)) : X1
    const x1 = a + (a > X0 ? GAP / 2 : 0)
    const x2 = b - (b < X1 ? GAP / 2 : 0)
    return { ...s, x1, x2 }
  })

  push(
    `<path d="M${fmt(X0)} ${fmt(axisY)}H${fmt(X1)}" fill="none" ${paint('stroke', th.axis)} pathLength="100" stroke-dasharray="100 101"${anim.style(
      draw,
      MOTION.railDur,
      MOTION.railDelay,
      `cubic-bezier(${RAIL_CURVE.join(',')})`,
    )}/>`,
  )

  const nowLabel = text('NOW', { ...yearStyle, x: X1, y: yearY, anchor: 'end', fill: th.now })

  YEARS.forEach((year) => {
    const x = xOf(monthIndex(year, 1))
    const t = timeAt(x)
    const tick = `<path d="M${fmt(x + 0.5)} ${fmt(axisY)}v${tickLen}" fill="none" ${paint('stroke', th.tick)}/>`
    const label = text(String(year), { ...yearStyle, x, y: yearY })
    const fits = label.x + label.width + 16 <= nowLabel.x
    push(`<g${anim.style(fade, MOTION.tick, t)}>${tick}${fits ? label.svg : ''}</g>`)
  })

  const defs = []
  const r = BAR / 2
  segs.forEach((s) => {
    const tFrom = timeAt(s.x1)
    const tTo = timeAt(s.x2) + MOTION.lag
    s.done = tTo
    if (s.kind === 'study') {
      const months = Math.round((s.x2 - s.x1 + GAP) / ((X1 - X0) / SPAN))
      const pitch = (s.x2 - s.x1 + GAP) / months
      const cw = pitch - GAP
      const cells = []
      for (let i = 0; i < months; i++) {
        const cx = s.x1 + i * pitch
        const t = timeAt(cx + cw / 2) + MOTION.lag
        cells.push(
          `<rect class="c" x="${fmt(cx)}" y="${fmt(barTop)}" width="${fmt(cw)}" height="${BAR}" rx="3" fill="${th.study}"${anim.style(
            'from{opacity:0;transform:scale(.55)}to{opacity:1;transform:scale(1)}',
            0.45,
            t,
          )}/>`,
        )
      }
      push(`<g>${cells.join('')}</g>`)
      return
    }
    const len = s.x2 - s.x1 - BAR
    const stroke = s.kind === 'now' ? `url(#acc)` : th.work
    const valueAt = (t) => {
      const head = headAt(t - MOTION.lag)
      if (head < s.x1 + BAR * 0.75) return len + 1
      const v = Math.min(len, Math.max(0, head - s.x1 - BAR))
      return len - v
    }
    push(
      `<path d="M${fmt(s.x1 + r)} ${fmt(barMid)}H${fmt(s.x2 - r)}" fill="none" stroke="${stroke}" stroke-width="${BAR}" stroke-linecap="round" stroke-dasharray="${fmt(len)} ${fmt(len + BAR * 4)}"${sampled(
        anim,
        Math.max(0, tFrom - 0.02),
        tTo + 0.04,
        valueAt,
        'stroke-dashoffset',
      )}/>`,
    )
    if (s.kind === 'now') {
      defs.push(
        `<linearGradient id="acc" gradientUnits="userSpaceOnUse" x1="${fmt(s.x1)}" y1="0" x2="${fmt(s.x2)}" y2="0"><stop offset="0" stop-color="${th.accent[0]}"/><stop offset="1" stop-color="${th.accent[1]}"/></linearGradient>`,
      )
    }
  })

  const self = segs.find((s) => s.kind === 'now')
  const todayX = X1 - 0.75
  push(
    `<g${anim.style(fade, MOTION.tick, MOTION.nowAt)}><path d="M${fmt(X1 - 0.5)} ${fmt(axisY - 5)}V${fmt(axisY + tickLen)}" fill="none" stroke="${th.now}"/>${nowLabel.svg}</g>`,
  )

  segs.forEach((s) => {
    if (s.kind === 'now') return
    const titleFill = s.kind === 'study' ? th.fg2 : th.fg
    const subFill = s.kind === 'study' ? th.fg3 : th.fg2
    const t1 = text(s.title, { font: 'display', size: titleSize, x: s.x1, y: rowTitleY, tracking: -0.02, fill: titleFill })
    const t2 = text(s.sub, { font: 'body', size: subSize, x: s.x1, y: rowSubY, fill: subFill })
    s.labelRight = Math.max(t1.x + t1.width, t2.x + t2.width)
    push(`<g${anim.style(fade, MOTION.label, s.done + 0.02)}>${t1.svg}${t2.svg}</g>`)
  })
  for (let i = 0; i < segs.length - 2; i++) {
    if (segs[i].labelRight + 16 > segs[i + 1].x1) throw new Error(`Label of ${segs[i].key} runs into ${segs[i + 1].key}`)
  }

  const n1 = text(self.title, { font: 'display', size: titleSize, x: X1, y: nowTitleY, anchor: 'end', tracking: -0.02, fill: th.now })
  const n2 = text(self.sub, { font: 'body', size: subSize, x: X1, y: nowSubY, anchor: 'end', fill: th.fg2 })
  const dynex = segs.find((s) => s.key === 'dynex')
  if (dynex.labelRight + 14 > todayX) throw new Error('Dynex label runs into the leader')
  if (nowTitleY - capOf('display', titleSize) < eyebrowY + 12) throw new Error('Callout tier runs into the eyebrow row')
  const leadTop = nowSubY + descOf('body', subSize) * 0.75 + 8
  const leadBottom = barTop - 6
  push(
    `<path d="M${fmt(todayX)} ${fmt(leadBottom)}V${fmt(leadTop)}" fill="none" stroke="${th.now}" stroke-opacity=".5" stroke-width="1.5" pathLength="100" stroke-dasharray="100 101"${anim.style(
      draw,
      MOTION.leaderDraw,
      MOTION.leaderAt,
    )}/>`,
  )
  push(`<g${anim.style(fade, MOTION.label, MOTION.calloutAt)}>${n1.svg}${n2.svg}</g>`)

  MILESTONES.forEach((ms, i) => {
    const x = xOf(monthIndex(ms.at[0], ms.at[1]) + 0.5)
    const t0 = timeAt(x) + MOTION.milestoneLag
    const row = msRow[i]
    const tx = text(ms.text, { ...msText, x: ms.align === 'end' ? x - 10 : x + 10, y: row, anchor: ms.align })
    const pinBottom = row - capOf('body', msText.size) / 2 + 0.5
    const s = 5.4
    push(
      `<path d="M${fmt(x)} ${fmt(axisY + s + 1)}V${fmt(pinBottom)}" fill="none" ${paint('stroke', th.leader)} pathLength="100" stroke-dasharray="100 101"${anim.style(
        draw,
        0.45,
        t0 + 0.08,
      )}/>`,
    )
    push(
      `<path d="M${fmt(x)} ${fmt(axisY - s)}l${fmt(s)} ${fmt(s)}l${fmt(-s)} ${fmt(s)}l${fmt(-s)} ${fmt(-s)}z" fill="${th.pin}" stroke="${th.card}" stroke-width="2" stroke-linejoin="round"${anim.style(
        fade,
        0.4,
        t0,
      )}/>`,
    )
    push(`<g${anim.style(fade, 0.5, t0 + 0.25)}>${tx.svg}</g>`)
    ms.x = x
    ms.left = tx.x
    ms.right = tx.x + tx.width
    ms.row = i
  })
  if (MILESTONES.some((ms) => ms.left < P || ms.right > W - P)) throw new Error('Milestone label runs past the card padding')
  MILESTONES.forEach((a) => {
    MILESTONES.forEach((b) => {
      if (a === b || b.row <= a.row) return
      if (a.left - 12 < b.x && b.x < a.right + 12) throw new Error('A milestone pin crosses a milestone label above it')
    })
  })

  const total = anim.end()
  console.log(theme, 'H', H, 'animation ends at', fmt(total), 's', 'segments', segs.map((s) => `${s.key} ${fmt(s.x1)}-${fmt(s.x2)} done ${fmt(s.done)}`).join(', '))

  const title = 'Experience timeline of Alex Földvári, 2022 to today'
  const desc = [
    'Horizontal timeline from January 2022 to today.',
    'January 2022 to March 2024: HelixLab Kft in Pécs, Frontend Developer (Angular).',
    'April 2024 to April 2025: studies and own projects.',
    'May 2025 to March 2026: Dynex Kft in Budapest, Full-Stack Developer and Technical Lead.',
    'April 2026 to now: self-employed in Zürich, building Solory; the blue bar ends at a tick marked NOW.',
    'Milestones: September 2024, BSc Business Informatics studies start; November 2025, 1st place in a university research competition.',
    'On load the axis draws once from left to right with the bars following it, then the card stays still.',
  ].join(' ')

  const css = [
    `.c{transform-box:fill-box;transform-origin:50% 50%}`,
    ...anim.rules,
    `@media (prefers-reduced-motion:reduce){*{animation:none!important}}`,
  ].join('')

  return {
    svg:
      [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc">`,
        `<title id="title">${title}</title><desc id="desc">${desc}</desc>`,
        `<defs><radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(${P} 0) scale(560 300)"><stop offset="0" stop-color="${th.glow[0]}" stop-opacity="${th.glow[1]}"/><stop offset="1" stop-color="${th.glow[0]}" stop-opacity="0"/></radialGradient>`,
        `<clipPath id="card"><rect width="${W}" height="${H}" rx="24"/></clipPath>${defs.join('')}</defs>`,
        `<style>${css}</style>`,
        `<g clip-path="url(#card)"><rect width="${W}" height="${H}" fill="${th.card}"/><rect width="${W}" height="${H}" fill="url(#glow)"/></g>`,
        `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="23.5" fill="none" ${paint('stroke', th.edge)}/>`,
        ...out,
        `</svg>`,
      ].join('\n') + '\n',
    total,
    H,
  }
}

const report = {}
for (const theme of Object.keys(THEMES)) {
  const { svg: raw, total, H } = render(theme)
  if (/[–—‘’“”]/.test(raw)) throw new Error('Dash or curly quote characters found')
  if (/<text|<foreignObject|<image|<script|<!--|href="(?!#)/i.test(raw)) throw new Error('Live text, script, comment or external reference found')
  const svg = raw.replace(/[^\x00-\x7f]/g, (c) => `&#${c.codePointAt(0)};`)
  if (Buffer.byteLength(svg) > 120 * 1024) throw new Error(`timeline-${theme}.svg is larger than 120 KB`)
  const file = join(OUT, `timeline-${theme}.svg`)
  await writeFile(file, svg)
  report[theme] = { file, kb: Math.round((Buffer.byteLength(svg) / 1024) * 10) / 10, total: Math.round(total * 100) / 100, H }
  console.log(`${file} ${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB`)
}
if (META) await writeFile(META, JSON.stringify(report, null, 2))
