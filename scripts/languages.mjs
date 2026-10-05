import { execFileSync } from 'node:child_process'
import {
  W,
  P,
  THEMES,
  FADE,
  GROW_X,
  fmt,
  fail,
  text,
  hasGlyphs,
  capOf,
  eyebrow,
  createAnimator,
  sweep,
  frame,
  writeCards,
  request,
  githubHeaders,
} from './lib/card.mjs'

const LOGIN = process.env.LANGS_LOGIN || 'foldvarialex'
const AGENT = `${LOGIN}-languages-card`
const SHOWN = 6
const NAMES = { 'C#': 'C Sharp', 'F#': 'F Sharp', 'Q#': 'Q Sharp', 'C++': 'C plus plus', 'Objective-C++': 'Objective-C plus plus' }

const COLORS = {
  dark: { ranks: ['#5b9cff', '#2a64de', '#1d4396', '#c3c8d1', '#8a8d93', '#5a5f68'], other: '#353940' },
  light: { ranks: ['#1749c6', '#3485ff', '#a9c8ff', '#34373c', '#6b6e74', '#a8abb1'], other: '#dadde2' },
}

function token() {
  if (process.env.LANGS_TOKEN) return process.env.LANGS_TOKEN
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  if (!process.env.GITHUB_ACTIONS) {
    try {
      const value = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      if (value) return value
    } catch {
      return ''
    }
  }
  return ''
}

async function api(path, headers) {
  const res = await request(`https://api.github.com${path}`, { headers })
  return { body: await res.json(), link: res.headers.get('link') || '' }
}

async function pool(items, size, fn) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
  return results
}

async function load() {
  const secret = token()
  if (!secret) throw new Error('No token: set LANGS_TOKEN (or GITHUB_TOKEN, or sign in with gh locally)')
  const headers = githubHeaders(secret, AGENT)
  const me = (await api('/user', headers)).body
  if (me?.login?.toLowerCase() !== LOGIN.toLowerCase()) throw new Error(`The token belongs to another account, expected ${LOGIN}`)
  const repos = []
  for (let page = 1; page <= 20; page++) {
    const { body, link } = await api(`/user/repos?affiliation=owner&visibility=all&per_page=100&page=${page}`, headers)
    if (!Array.isArray(body)) throw new Error('Unexpected repository list')
    repos.push(...body)
    if (!/rel="next"/.test(link)) break
  }
  const owned = repos.filter(
    (r) => r.owner?.login?.toLowerCase() === LOGIN.toLowerCase() && r.owner?.type === 'User' && !r.fork && !r.archived && r.name.toLowerCase() !== LOGIN.toLowerCase(),
  )
  const privateCount = owned.filter((r) => r.private).length
  if (!owned.length) throw new Error('No repositories left after filtering')
  const perRepo = await pool(owned, 6, async (r) => {
    try {
      return (await api(`/repos/${r.owner.login}/${r.name}/languages`, headers)).body
    } catch (error) {
      throw new Error(`A repository languages request failed${error.status ? ` with ${error.status}` : ''}`)
    }
  })
  const totals = new Map()
  let counted = 0
  let countedPrivate = 0
  perRepo.forEach((langs, i) => {
    if (!langs || typeof langs !== 'object' || Array.isArray(langs)) throw new Error('Unexpected languages response')
    let any = false
    for (const [name, bytes] of Object.entries(langs)) {
      if (!Number.isFinite(bytes) || bytes < 0) throw new Error('Unexpected byte count')
      if (bytes > 0) any = true
      totals.set(name, (totals.get(name) || 0) + bytes)
    }
    if (any) {
      counted++
      if (owned[i].private) countedPrivate++
    }
  })
  const sum = [...totals.values()].reduce((a, b) => a + b, 0)
  if (!sum || counted < 2) throw new Error('Not enough language data')
  console.log(`${owned.length} owned repositories after filtering (${privateCount} private), ${counted} with language data, ${totals.size} languages, ${sum} bytes`)
  return { totals, sum, counted, countedPrivate }
}

function shares({ totals, sum }) {
  const sorted = [...totals.entries()].map(([name, bytes]) => ({ name: NAMES[name] || name, bytes })).sort((a, b) => b.bytes - a.bytes)
  const shown = []
  let rest = 0
  for (const lang of sorted) {
    const visible = shown.length < SHOWN && lang.bytes / sum >= 0.0005 && hasGlyphs(lang.name, 'body')
    if (visible) shown.push(lang)
    else rest += lang.bytes
  }
  if (sorted.length === shown.length + 1 && rest > 0) {
    const last = sorted.find((l) => !shown.includes(l))
    if (hasGlyphs(last.name, 'body') && last.bytes / sum >= 0.0005) {
      shown.push(last)
      rest = 0
    }
  }
  const list = rest > 0 ? [...shown, { name: 'Other', bytes: rest, other: true }] : shown
  return list.map((l) => {
    const tenths = Math.round((l.bytes / sum) * 1000)
    return { ...l, share: l.bytes / sum, tenths, label: `${(tenths / 10).toFixed(1)}%` }
  })
}

const MOTION = { hero: 0.15, barStart: 0.35, barDur: 1.5, rowLag: 0.12, label: 0.6 }

function render(data, langs, theme) {
  const th = THEMES[theme]
  const palette = COLORS[theme]
  const anim = createAnimator()
  const out = []
  const push = (s) => out.push(typeof s === 'string' ? s : s.svg)
  const inner = W - P * 2

  const top = eyebrow(th, 'LANGUAGES · MY REPOSITORIES')
  push(top.svg)

  const lead = langs[0]
  const bigSize = 96
  const bigY = Math.round(top.y + 38 + capOf('display', bigSize))
  const big = text(lead.label, { font: 'display', size: bigSize, x: P - 3, y: bigY, tracking: -0.04, fill: th.fg })
  const labelX = big.right + 24
  const name = text(lead.name, { font: 'body', size: 25, x: labelX, y: bigY - 33, fill: th.fg })
  const repoWord = data.counted === 1 ? 'repository' : 'repositories'
  const scope = data.countedPrivate > 0 ? `across ${data.counted} ${repoWord}, private included` : `across ${data.counted} ${repoWord}`
  const note = text(scope, { font: 'body', size: 25, x: labelX, y: bigY, fill: th.fg3 })
  if (Math.max(name.right, note.right) > W - P) throw new Error('The headline does not fit')
  push(`<g${anim.style(FADE, MOTION.label, MOTION.hero)}>${big.svg}${name.svg}${note.svg}</g>`)

  const barH = 18
  const barTop = bigY + 40
  const gap = 3
  const avail = inner - gap * (langs.length - 1)
  const widths = langs.map((l) => Math.max(3, l.share * avail))
  const over = widths.reduce((a, b) => a + b, 0) - avail
  widths[widths.indexOf(Math.max(...widths))] -= over
  const timeAt = sweep(MOTION.barStart, MOTION.barDur)
  const colorOf = (l, i) => (l.other ? palette.other : palette.ranks[i])
  let x = P
  langs.forEach((l, i) => {
    const w = widths[i]
    const t0 = timeAt((x - P) / inner)
    const t1 = timeAt((x + w - P) / inner)
    l.at = t0
    push(
      `<rect x="${fmt(x)}" y="${barTop}" width="${fmt(w)}" height="${barH}" rx="${fmt(Math.min(4, w / 2))}" fill="${colorOf(l, i)}" style="transform-box:fill-box;transform-origin:0 50%;${anim.css(
        GROW_X,
        Math.max(0.05, t1 - t0),
        t0,
        'linear',
      )}"/>`,
    )
    x += w + gap
  })

  const rows = Math.ceil(langs.length / 2)
  const colW = (inner - 48) / 2
  const rowPitch = 40
  const nameSize = 22
  const firstRow = barTop + barH + 30 + capOf('body', nameSize)
  langs.forEach((l, i) => {
    const col = Math.floor(i / rows)
    const row = i % rows
    const x0 = P + col * (colW + 48)
    const y = firstRow + row * rowPitch
    const sw = 12
    const swatch = `<rect x="${fmt(x0)}" y="${fmt(y - capOf('body', nameSize) / 2 - sw / 2)}" width="${sw}" height="${sw}" rx="3" fill="${colorOf(l, i)}"/>`
    const label = text(l.name, { font: 'body', size: nameSize, x: x0 + sw + 12, y, fill: l.other ? th.fg3 : th.fg })
    const pct = text(l.label, { font: 'display', size: nameSize, x: x0 + colW, y, anchor: 'end', fill: th.fg2 })
    if (label.right + 16 > pct.x) throw new Error(`${l.name} runs into its percentage`)
    const rule = row < rows - 1 && (col === 0 || i + 1 < langs.length) ? `<path d="M${fmt(x0)} ${fmt(y + 15.5)}H${fmt(x0 + colW)}" stroke="${th.line[0]}" stroke-opacity="${th.line[1]}"/>` : ''
    push(`<g${anim.style(FADE, MOTION.label, MOTION.barStart + 0.2 + i * MOTION.rowLag)}>${swatch}${label.svg}${pct.svg}${rule}</g>`)
  })

  const H = Math.round(firstRow + (rows - 1) * rowPitch + P - 4)
  const title = "Languages in Alex Földvári's own repositories"
  const desc = [
    `Share of code by bytes, as reported by GitHub, ${scope}: ${langs.map((l) => `${l.name} ${l.label}`).join(', ')}, each rounded to one decimal.`,
    'Forks, archived repositories, organization repositories and this profile repository are not counted.',
    'The stacked bar grows once from left to right on load, then the card stays still.',
  ].join(' ')
  return frame({ th, H, title, desc, css: anim.rules, body: out })
}

try {
  const data = await load()
  const langs = shares(data)
  if (langs.length < 2) throw new Error('Fewer than two languages to show')
  await writeCards('languages', (theme) => render(data, langs, theme))
  console.log(langs.map((l) => `${l.name} ${l.label}`).join(', '))
} catch (error) {
  fail(`languages card not written: ${error.message}`)
}
