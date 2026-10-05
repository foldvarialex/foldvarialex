import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  W,
  P,
  THEMES,
  LABEL,
  FADE,
  GROW_X,
  fmt,
  group,
  paint,
  dateLabel,
  MONTHS,
  fail,
  text,
  measure,
  capOf,
  eyebrow,
  createAnimator,
  frame,
  writeCards,
  request,
  githubHeaders,
} from './lib/card.mjs'

const REPO = process.env.QUALITY_REPO || 'foldvarialex/foldvari.ch'
const HOST = process.env.QUALITY_HOST || 'foldvari.ch'
const MAX_AGE_DAYS = Number(process.env.QUALITY_MAX_AGE_DAYS || 14)
const DAY = 86400000

const CATEGORIES = [
  { id: 'performance', label: 'Performance' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'best-practices', label: 'Best Practices' },
  { id: 'seo', label: 'SEO' },
]

const CI_WORDS = {
  success: 'Passing',
  failure: 'Failing',
  startup_failure: 'Failing',
  timed_out: 'Timed out',
  cancelled: 'Cancelled',
}

function arg(name) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label} at ${path} could not be read: ${error.message}`)
  }
}

function checkReport(lhr, path) {
  if (!lhr || typeof lhr !== 'object' || !lhr.categories) throw new Error(`${path} is not a Lighthouse report`)
  if (lhr.runtimeError) throw new Error(`${path} has a runtime error: ${lhr.runtimeError.code || lhr.runtimeError.message}`)
  if (lhr.configSettings?.formFactor !== 'mobile') throw new Error(`${path} was not measured on mobile`)
  const url = new URL(lhr.finalDisplayedUrl || lhr.finalUrl || lhr.requestedUrl)
  if (url.hostname !== HOST && url.hostname !== `www.${HOST}`) throw new Error(`${path} measured ${url.hostname}, expected ${HOST}`)
  const fetched = new Date(lhr.fetchTime)
  if (Number.isNaN(fetched.getTime())) throw new Error(`${path} has no fetch time`)
  const age = Date.now() - fetched.getTime()
  if (age < -DAY || age > MAX_AGE_DAYS * DAY) throw new Error(`${path} is from ${lhr.fetchTime}, outside the ${MAX_AGE_DAYS} day window`)
  const scores = CATEGORIES.map(({ id, label }) => {
    const score = lhr.categories[id]?.score
    if (typeof score !== 'number' || score < 0 || score > 1) throw new Error(`${path} has no ${label} score`)
    return { id, label, value: Math.round(score * 100) }
  })
  return { scores, fetched, url: url.href, version: lhr.lighthouseVersion || '', path }
}

async function loadLighthouse() {
  const input = arg('lh') || process.env.LH_JSON
  if (!input) throw new Error('LH_JSON is not set')
  const paths = []
  for (const entry of input.split(',').map((p) => p.trim()).filter(Boolean)) {
    const info = await stat(entry).catch(() => null)
    if (info?.isDirectory()) paths.push(...(await readdir(entry)).filter((f) => f.endsWith('.json')).sort().map((f) => join(entry, f)))
    else paths.push(entry)
  }
  const runs = []
  for (const path of paths) {
    try {
      runs.push(checkReport(await readJson(path, 'Lighthouse report'), path))
    } catch (error) {
      console.warn(`Skipping a Lighthouse run: ${error.message}`)
    }
  }
  if (!runs.length) throw new Error('No usable Lighthouse report')
  runs.sort((a, b) => a.scores[0].value - b.scores[0].value)
  const chosen = runs[Math.floor((runs.length - 1) / 2)]
  if (runs.length > 1) console.log(`Performance across ${runs.length} runs: ${runs.map((r) => r.scores[0].value).join(', ')}; using ${chosen.path}`)
  return { ...chosen, runs: runs.length }
}

async function loadTests() {
  const jsonPath = arg('tests-json') || process.env.TESTS_JSON
  const countRaw = arg('tests-count') || process.env.TESTS_COUNT
  if (jsonPath) {
    const report = await readJson(jsonPath, 'Vitest report')
    const total = report.numTotalTests
    const passed = report.numPassedTests
    const failed = report.numFailedTests
    const failedFiles = report.numFailedTestSuites || 0
    if (!Number.isInteger(total) || total <= 0 || total > 100000) throw new Error(`${jsonPath} has an implausible test count`)
    if (!Number.isInteger(passed) || passed < 0 || passed > total) throw new Error(`${jsonPath} has an implausible pass count`)
    if (!Number.isInteger(failed) || failed < 0 || failed + passed > total) throw new Error(`${jsonPath} has an implausible failure count`)
    if (report.success === false && !failed && !failedFiles) throw new Error(`${jsonPath} reports an unsuccessful run without failed tests`)
    if (total - passed - failed > 0) console.log(`${total - passed - failed} tests are skipped or todo`)
    return { total, passed, failed, failedFiles, known: true }
  }
  if (countRaw !== undefined && countRaw !== '') {
    const total = Number(countRaw)
    if (!Number.isInteger(total) || total <= 0 || total > 100000) throw new Error(`TESTS_COUNT "${countRaw}" is not a plausible count`)
    return { total, passed: total, failed: 0, failedFiles: 0, known: false }
  }
  throw new Error('Neither TESTS_JSON nor TESTS_COUNT is set')
}

async function loadCi() {
  const token = process.env.GITHUB_TOKEN || ''
  const headers = githubHeaders(token, 'foldvarialex-quality-card')
  const base = `https://api.github.com/repos/${REPO}/actions/workflows/ci.yml/runs?branch=main&per_page=1`
  let run = (await (await request(base, { headers })).json()).workflow_runs?.[0]
  if (run && run.status !== 'completed') {
    console.log(`The latest CI run is ${run.status}, using the latest completed run`)
    run = (await (await request(`${base}&status=completed`, { headers })).json()).workflow_runs?.[0]
  }
  if (!run) throw new Error(`No completed CI run on main for ${REPO}`)
  const word = CI_WORDS[run.conclusion]
  if (!word) throw new Error(`Unexpected CI conclusion "${run.conclusion}"`)
  return { word, conclusion: run.conclusion, at: run.updated_at || run.created_at }
}

const RING = { size: 128, stroke: 9 }
const MOTION = { ring: 1.3, ringStart: 0.25, ringLag: 0.12, label: 0.6, rule: 1.25, ruleDraw: 0.8, stats: 1.4, statLag: 0.08 }

function render(data, theme) {
  const th = THEMES[theme]
  const anim = createAnimator()
  const out = []
  const defs = []
  const push = (s) => out.push(typeof s === 'string' ? s : s.svg)
  const inner = W - P * 2
  const label = { ...LABEL, fill: th.fg3 }

  const top = eyebrow(th, 'FOLDVARI.CH · QUALITY', 'LIGHTHOUSE · MOBILE')
  push(top.svg)

  const colW = inner / CATEGORIES.length
  const r = (RING.size - RING.stroke) / 2
  const circumference = 2 * Math.PI * r
  const ringTop = top.y + 42
  const cy = ringTop + RING.size / 2
  const scoreSize = 44
  const nameSize = 20
  const nameY = Math.round(ringTop + RING.size + 22 + capOf('body', nameSize))

  data.lh.scores.forEach((s, i) => {
    const cx = P + colW * (i + 0.5)
    const delay = MOTION.ringStart + i * MOTION.ringLag
    const d = `M${fmt(cx)} ${fmt(cy - r)}a${fmt(r)} ${fmt(r)} 0 1 1 0 ${fmt(2 * r)}a${fmt(r)} ${fmt(r)} 0 1 1 0 ${fmt(-2 * r)}`
    push(`<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="none" stroke="${th.track}" stroke-width="${RING.stroke}"/>`)
    if (s.value > 0) {
      const len = (circumference * s.value) / 100
      const gap = circumference + RING.stroke * 2
      defs.push(
        `<linearGradient id="r${i}" gradientUnits="userSpaceOnUse" x1="${fmt(cx - r)}" y1="${fmt(cy - r)}" x2="${fmt(cx + r)}" y2="${fmt(cy + r)}"><stop offset="0" stop-color="${th.accent[0]}"/><stop offset="1" stop-color="${th.accent[1]}"/></linearGradient>`,
      )
      push(
        `<path d="${d}" fill="none" stroke="url(#r${i})" stroke-width="${RING.stroke}" stroke-linecap="round" stroke-dasharray="${fmt(len)} ${fmt(gap)}"${anim.style(
          `from{stroke-dashoffset:${fmt(len + RING.stroke)}}`,
          MOTION.ring,
          delay,
        )}/>`,
      )
    }
    const score = text(String(s.value), { font: 'display', size: scoreSize, x: cx, y: cy + capOf('display', scoreSize) / 2, anchor: 'middle', tracking: -0.03, fill: th.fg })
    const name = text(s.label, { font: 'body', size: nameSize, x: cx, y: nameY, anchor: 'middle', fill: th.fg2 })
    if (name.x < P + colW * i + 4 || name.right > P + colW * (i + 1) - 4) throw new Error(`${s.label} does not fit its column`)
    if (score.width > 2 * r - RING.stroke * 2) throw new Error(`${s.value} does not fit its ring`)
    push(`<g${anim.style(FADE, MOTION.label, delay + 0.35)}>${score.svg}${name.svg}</g>`)
  })

  const ruleY = nameY + 36
  push(
    `<path d="M${P} ${fmt(ruleY)}H${W - P}" ${paint('stroke', th.line)} style="transform-box:fill-box;transform-origin:0 50%;${anim.css(GROW_X, MOTION.ruleDraw, MOTION.rule)}"/>`,
  )

  const tests = data.tests
  const healthy = !tests.failed && !tests.failedFiles
  const testValue = !tests.known
    ? { value: group(tests.total), suffix: 'tests' }
    : healthy
      ? { value: group(tests.passed), suffix: 'passing' }
      : tests.failed
        ? { value: group(tests.failed), suffix: `of ${group(tests.total)} failing` }
        : { value: group(tests.failedFiles), suffix: tests.failedFiles === 1 ? 'suite failing' : 'suites failing' }
  const items = [
    { label: 'TEST SUITE', ...testValue, required: true },
    { label: 'CI · MAIN', value: data.ci.word, suffix: '' },
    { label: 'MEASURED', value: `${data.lh.fetched.getUTCDate()} ${MONTHS[data.lh.fetched.getUTCMonth()]}`, suffix: String(data.lh.fetched.getUTCFullYear()) },
  ]
  const statCol = inner / items.length
  const statLabelY = ruleY + 34 + capOf('mono', label.size)
  const statValueY = statLabelY + 24 + capOf('display', 46)
  items.forEach((it, i) => {
    const x = P + i * statCol + (i ? 30 : 0)
    const limit = P + (i + 1) * statCol - 12
    const parts = [text(it.label, { ...label, x, y: statLabelY }).svg]
    if (i) parts.unshift(`<path d="M${fmt(P + i * statCol)} ${fmt(ruleY + 26)}V${fmt(statValueY + 6)}" ${paint('stroke', th.line)}/>`)
    const v = text(it.value, { font: 'display', size: 46, x: x - 2, y: statValueY, tracking: -0.03, fill: th.fg })
    if (v.right > limit) throw new Error(`${it.value} does not fit its column`)
    parts.push(v.svg)
    const sx = v.right + 9
    const fits = it.suffix && sx + measure(it.suffix, 'body', 20).width <= limit
    if (it.required && !fits) throw new Error(`"${it.value} ${it.suffix}" does not fit its column`)
    if (fits) parts.push(text(it.suffix, { font: 'body', size: 20, x: sx, y: statValueY, fill: th.fg3 }).svg)
    push(`<g${anim.style(FADE, MOTION.label, MOTION.stats + i * MOTION.statLag)}>${parts.join('')}</g>`)
  })

  const H = Math.round(statValueY + P)
  const [perf, a11y, bp, seo] = data.lh.scores.map((s) => s.value)
  const skipped = tests.total - tests.passed - tests.failed
  const testLine = !tests.known
    ? `${group(tests.total)} automated tests.`
    : tests.failed
      ? `${group(tests.total)} automated tests, ${group(tests.failed)} failing.`
      : tests.failedFiles
        ? `${group(tests.total)} automated tests, ${group(tests.failedFiles)} test ${tests.failedFiles === 1 ? 'suite' : 'suites'} failing to run.`
        : skipped
          ? `${group(tests.passed)} of ${group(tests.total)} automated tests passing, ${group(skipped)} skipped.`
          : `${group(tests.total)} automated tests, all passing.`
  const page = new URL(data.lh.url)
  const where = `${page.hostname.replace(/^www\./, '')}${page.pathname.replace(/\/$/, '')}`
  const runs = data.lh.runs > 1 ? `, the median of ${data.lh.runs} runs` : ''
  const title = 'Quality of foldvari.ch: Lighthouse scores, tests and CI'
  const desc = [
    `Lighthouse on mobile for ${where}${runs}, measured ${dateLabel(data.lh.fetched)}: Performance ${perf}, Accessibility ${a11y}, Best Practices ${bp}, SEO ${seo} out of 100.`,
    testLine,
    `Latest CI run on the main branch: ${data.ci.word.toLowerCase()}.`,
    'The score rings fill once on load, then the card stays still.',
  ].join(' ')
  return frame({ th, H, title, desc, defs: defs.join(''), css: anim.rules, body: out })
}

try {
  const [lh, tests, ci] = await Promise.all([loadLighthouse(), loadTests(), loadCi()])
  const data = { lh, tests, ci }
  await writeCards('quality', (theme) => render(data, theme))
  console.log(`Lighthouse ${lh.version} ${lh.scores.map((s) => `${s.id} ${s.value}`).join(', ')}; ${tests.total} tests (${tests.failed} failing); CI ${ci.conclusion}`)
} catch (error) {
  fail(`quality card not written: ${error.message}`)
}
