import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LOGIN = process.env.ACTIVITY_LOGIN || process.env.GITHUB_REPOSITORY_OWNER || 'foldvarialex'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FONTS = JSON.parse(await readFile(join(ROOT, 'scripts', 'glyphs.json'), 'utf8'))

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const DAY = 86400000

const EASE = 'cubic-bezier(.16,1,.3,1)'
const MOTION = {
  sweepStart: 0.3,
  sweepSpan: 1.35,
  cell: 0.55,
  month: 0.6,
  rule: 1.55,
  ruleDraw: 0.8,
}

const THEMES = {
  dark: {
    card: '#111318',
    cardEdge: '#ffffff',
    cardEdgeOpacity: 0.09,
    glow: '#3f7dff',
    glowOpacity: 0.11,
    fg: '#ededef',
    fg3: '#8a8d93',
    line: '#ffffff',
    lineOpacity: 0.08,
    dot: '#5b9cff',
    levels: ['#1a1d22', '#272b32', '#3b404a', '#2a64de', '#5b9cff'],
  },
  light: {
    card: '#ffffff',
    cardEdge: '#141618',
    cardEdgeOpacity: 0.11,
    glow: '#1749c6',
    glowOpacity: 0.05,
    fg: '#141618',
    fg3: '#63666b',
    line: '#141618',
    lineOpacity: 0.09,
    dot: '#1749c6',
    levels: ['#f1f2f4', '#e0e3e8', '#c3c8d1', '#3485ff', '#1749c6'],
  },
}

async function request(url, init, attempts = 3) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init)
      if (!res.ok) throw new Error(`${url} responded ${res.status}`)
      return res
    } catch (error) {
      lastError = error
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
    }
  }
  throw lastError
}

async function fromGraphQL(token) {
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount weekday}}}}}}`
  const res = await request('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': `${LOGIN}-activity-card`,
    },
    body: JSON.stringify({ query, variables: { login: LOGIN } }),
  })
  const json = await res.json()
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '))
  const calendar = json.data?.user?.contributionsCollection?.contributionCalendar
  if (!calendar) throw new Error('GraphQL response has no contribution calendar')
  const days = calendar.weeks.flatMap((w) => w.contributionDays).map((d) => ({ date: d.date, count: d.contributionCount }))
  return { days, reported: calendar.totalContributions, source: 'graphql' }
}

async function fromHtml() {
  const res = await request(`https://github.com/users/${LOGIN}/contributions`, {
    headers: { 'user-agent': `${LOGIN}-activity-card`, accept: 'text/html' },
  })
  const html = await res.text()
  const tips = new Map()
  for (const m of html.matchAll(/<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) tips.set(m[1], m[2].trim())
  const days = []
  for (const m of html.matchAll(/<td\b[^>]*\bdata-date="[^"]+"[^>]*>/g)) {
    const tag = m[0]
    const date = /\bdata-date="(\d{4}-\d{2}-\d{2})"/.exec(tag)?.[1]
    const id = /\bid="([^"]+)"/.exec(tag)?.[1]
    if (!date) continue
    const tip = (id && tips.get(id)) || ''
    const hit = /^([\d,]+)\s+contributions?\b/i.exec(tip)
    if (!hit && !/^No contributions\b/i.test(tip)) throw new Error(`Unrecognised tooltip for ${date}: "${tip}"`)
    days.push({ date, count: hit ? Number(hit[1].replace(/,/g, '')) : 0 })
  }
  const heading = /([\d,]+)\s+contributions?\s+in the last year/i.exec(html)
  const reported = heading ? Number(heading[1].replace(/,/g, '')) : null
  return { days, reported, source: 'html' }
}

function normalise({ days, reported, source }) {
  if (!days.length) throw new Error(`No contribution days found via ${source}`)
  const byDate = new Map()
  for (const d of days) byDate.set(d.date, (byDate.get(d.date) || 0) + d.count)
  const dates = [...byDate.keys()].sort()
  const start = Date.parse(`${dates[0]}T00:00:00Z`)
  const end = Date.parse(`${dates.at(-1)}T00:00:00Z`)
  const series = []
  for (let t = start; t <= end; t += DAY) {
    const date = new Date(t).toISOString().slice(0, 10)
    series.push({ date, time: t, count: byDate.get(date) || 0 })
  }
  const sum = (list) => list.reduce((a, d) => a + d.count, 0)
  if (source === 'html' && reported != null && reported !== sum(series)) {
    throw new Error(`Parsed ${sum(series)} contributions but the page reports ${reported}`)
  }
  const lastDay = new Date(end)
  const cutoff = Date.UTC(lastDay.getUTCFullYear() - 1, lastDay.getUTCMonth(), lastDay.getUTCDate())
  const year = series.filter((d) => d.time > cutoff)
  const total = sum(year)
  if (source === 'graphql' && reported != null && reported !== total) {
    console.warn(`Last 12 months sum to ${total}, the GraphQL calendar reports ${reported}`)
  }
  return { series: year, total, source }
}

function computeStats(series) {
  let longest = 0
  let run = 0
  for (const d of series) {
    run = d.count > 0 ? run + 1 : 0
    if (run > longest) longest = run
  }
  const active = series.filter((d) => d.count > 0).length
  const recent = series.slice(-30).reduce((a, d) => a + d.count, 0)
  const nonzero = series.filter((d) => d.count > 0).map((d) => d.count).sort((a, b) => a - b)
  const q = (p) => (nonzero.length ? nonzero[Math.floor(p * (nonzero.length - 1))] : 0)
  const thresholds = [q(0.35), q(0.65), q(0.88)]
  return { longest, active, recent, days: series.length, thresholds }
}

function level(count, [a, b, c]) {
  if (count <= 0) return 0
  if (count <= a) return 1
  if (count <= b) return 2
  if (count <= c) return 3
  return 4
}

const fmt = (v) => {
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}

const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

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

function text(str, { font, size, x, y, anchor = 'start', tracking = 0, fill, attrs = '' }) {
  const m = measure(str, font, size, tracking)
  const x0 = anchor === 'end' ? x - m.width : anchor === 'middle' ? x - m.width / 2 : x
  const segs = []
  for (const [ox, p] of m.parts) outline(p, ox, x0, y, m.scale, segs)
  const d = serialise(segs)
  return { svg: d ? `<path fill="${fill}"${attrs} d="${d}"/>` : '', width: m.width, x: x0 }
}

const capOf = (font, size) => (FONTS[font].cap / FONTS[font].upm) * size

const at = (seconds) => ` style="animation-delay:${fmt(seconds)}s"`

const STYLE = [
  `.h use{transform-box:fill-box;transform-origin:50% 50%;animation:c ${MOTION.cell}s ${EASE} backwards;animation-delay:inherit}`,
  `.m{animation:f ${MOTION.month}s ${EASE} backwards}`,
  `.x{transform-box:fill-box;transform-origin:0 50%;animation:x ${MOTION.ruleDraw}s ${EASE} backwards}`,
  `@keyframes c{from{opacity:0;transform:scale(.6)}}`,
  `@keyframes f{from{opacity:0}}`,
  `@keyframes x{from{transform:scaleX(0)}}`,
  `@media (prefers-reduced-motion:reduce){*{animation:none!important}}`,
].join('')

function render(data, theme) {
  const t = THEMES[theme]
  const { series, total } = data
  const stats = computeStats(series)
  const W = 880
  const P = 48
  const inner = W - P * 2
  const out = []
  const defs = []
  const push = (s) => out.push(typeof s === 'string' ? s : s.svg)

  const label = { font: 'mono', size: 17, tracking: 0.09, fill: t.fg3 }
  const eyebrowY = P + capOf('mono', label.size)
  const mid = eyebrowY - capOf('mono', label.size) / 2

  push(`<circle cx="${P + 4.5}" cy="${fmt(mid)}" r="4.5" fill="${t.dot}"/>`)
  push(text('ACTIVITY · LAST 12 MONTHS', { ...label, x: P + 20, y: eyebrowY }))

  const legendCell = 12
  const legendGap = 4
  let lx = W - P
  const more = text('MORE', { ...label, x: lx, y: eyebrowY, anchor: 'end' })
  push(more)
  lx = more.x - 12 - legendCell * 5 - legendGap * 4
  t.levels.forEach((c, i) => {
    push(`<rect x="${fmt(lx + i * (legendCell + legendGap))}" y="${fmt(mid - legendCell / 2)}" width="${legendCell}" height="${legendCell}" rx="3" fill="${c}"/>`)
  })
  push(text('LESS', { ...label, x: lx - 12, y: eyebrowY, anchor: 'end' }))

  const bigSize = 104
  const bigY = eyebrowY + 40 + capOf('display', bigSize)
  const big = text(group(total), { font: 'display', size: bigSize, x: P - 4, y: bigY, tracking: -0.04, fill: t.fg })
  push(big)
  const labelX = big.x + big.width + 24
  const unit = text(total === 1 ? 'contribution' : 'contributions', { font: 'body', size: 25, x: labelX, y: bigY - 35, fill: t.fg })
  const note = text('private repositories included', { font: 'body', size: 25, x: labelX, y: bigY, fill: t.fg3 })
  push(`${unit.svg}${note.svg}`)

  const gap = 3
  const first = series[0]
  const startDow = (new Date(first.time).getUTCDay() + 6) % 7
  const cols = Math.ceil((startDow + series.length) / 7)
  const cell = (inner - gap * (cols - 1)) / cols
  const pitch = cell + gap
  const monthStyle = { font: 'mono', size: 16, tracking: 0.04, fill: t.fg3 }
  const monthY = bigY + 58
  const gridTop = monthY + 15
  const radius = Math.min(3, cell / 4)

  const sweepAt = (col) => MOTION.sweepStart + (cols > 1 ? col / (cols - 1) : 0) * MOTION.sweepSpan
  const shapes = new Map()
  const shape = (lv, row) => {
    const id = `d${lv}${row}`
    if (!shapes.has(id)) {
      shapes.set(id, `<rect id="${id}" y="${fmt(gridTop + row * pitch)}" width="${fmt(cell)}" height="${fmt(cell)}" rx="${fmt(radius)}" fill="${t.levels[lv]}"/>`)
    }
    return id
  }
  const weeks = Array.from({ length: cols }, () => [])
  const monthMarks = []
  series.forEach((d, i) => {
    const idx = startDow + i
    const col = Math.floor(idx / 7)
    const row = idx % 7
    const lv = level(d.count, stats.thresholds)
    weeks[col].push(`<use href="#${shape(lv, row)}"/>`)
    const date = new Date(d.time)
    if (i === 0 || date.getUTCDate() === 1) monthMarks.push({ col, label: MONTHS[date.getUTCMonth()], first: i === 0 })
  })

  const placed = []
  for (const m of monthMarks) {
    const w = measure(m.label, 'mono', monthStyle.size, monthStyle.tracking).width
    let x = P + m.col * pitch
    if (x + w > W - P) x = W - P - w
    const prev = placed.at(-1)
    if (prev && x < prev.x + prev.w + 12) {
      if (prev.first) placed.pop()
      else continue
    }
    placed.push({ x, w, col: m.col, label: m.label, first: m.first })
  }
  for (const p of placed) push(text(p.label, { ...monthStyle, x: p.x, y: monthY, attrs: ` class="m"${at(sweepAt(p.col))}` }))
  const columns = weeks.map((list, col) => `<g transform="translate(${fmt(P + col * pitch)})"${at(sweepAt(col))}>${list.join('')}</g>`)
  push(`<g class="h">${columns.join('')}</g>`)
  defs.push(...shapes.values())

  const gridBottom = gridTop + 7 * pitch - gap
  const ruleY = gridBottom + 36
  push(`<path class="x" d="M${P} ${fmt(ruleY)}H${W - P}" stroke="${t.line}" stroke-opacity="${t.lineOpacity}"${at(MOTION.rule)}/>`)

  const items = [
    { label: 'ACTIVE DAYS', value: group(stats.active), suffix: `of ${group(stats.days)}` },
    { label: 'LONGEST STREAK', value: group(stats.longest), suffix: stats.longest === 1 ? 'day' : 'days' },
    { label: 'PAST 30 DAYS', value: group(stats.recent), suffix: stats.recent === 1 ? 'contribution' : 'contributions' },
  ]
  const colW = inner / items.length
  const statLabelY = ruleY + 34 + capOf('mono', label.size)
  const statValueY = statLabelY + 24 + capOf('display', 46)
  items.forEach((it, i) => {
    const x = P + i * colW + (i ? 30 : 0)
    if (i) push(`<path d="M${fmt(P + i * colW)} ${fmt(ruleY + 26)}V${fmt(statValueY + 6)}" stroke="${t.line}" stroke-opacity="${t.lineOpacity}"/>`)
    const parts = [text(it.label, { ...label, x, y: statLabelY }).svg]
    const v = text(it.value, { font: 'display', size: 46, x: x - 2, y: statValueY, tracking: -0.03, fill: t.fg })
    parts.push(v.svg)
    const room = P + (i + 1) * colW - (v.x + v.width + 9)
    if (measure(it.suffix, 'body', 20).width <= room) parts.push(text(it.suffix, { font: 'body', size: 20, x: v.x + v.width + 9, y: statValueY, fill: t.fg3 }).svg)
    push(parts.join(''))
  })

  const H = Math.round(statValueY + P)
  const title = `GitHub activity of Alex Földvári (@${LOGIN})`
  const desc = `${group(total)} contributions in the last 12 months, ${stats.active} active days, longest streak ${stats.longest} days, ${group(stats.recent)} contributions in the past 30 days. The daily heatmap fills in once on load, week by week from left to right, then stays static.`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc">`,
    `<title id="title">${title}</title><desc id="desc">${desc}</desc>`,
    `<defs><radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(${P} 0) scale(560 300)"><stop offset="0" stop-color="${t.glow}" stop-opacity="${t.glowOpacity}"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>`,
    `<clipPath id="card"><rect width="${W}" height="${H}" rx="24"/></clipPath>${defs.join('')}</defs>`,
    `<style>${STYLE}</style>`,
    `<g clip-path="url(#card)"><rect width="${W}" height="${H}" fill="${t.card}"/><rect width="${W}" height="${H}" fill="url(#glow)"/></g>`,
    `<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="23.5" fill="none" stroke="${t.cardEdge}" stroke-opacity="${t.cardEdgeOpacity}"/>`,
    ...out,
    `</svg>`,
  ].join('\n') + '\n'
}

async function load() {
  const token = process.env.GITHUB_TOKEN
  if (token) {
    try {
      return normalise(await fromGraphQL(token))
    } catch (error) {
      console.warn(`GraphQL failed, falling back to the public calendar: ${error.message}`)
    }
  }
  return normalise(await fromHtml())
}

const data = await load()
await mkdir(join(ROOT, 'assets'), { recursive: true })
for (const theme of Object.keys(THEMES)) {
  const file = join(ROOT, 'assets', `activity-${theme}.svg`)
  await writeFile(file, render(data, theme))
  console.log(`${file} written`)
}
console.log(`${data.total} contributions from ${data.series[0].date} to ${data.series.at(-1).date} via ${data.source}`)
