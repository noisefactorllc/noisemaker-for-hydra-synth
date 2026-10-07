#!/usr/bin/env node
/*
 * Machine-checkable parity summary for the rendered sweep.
 *
 * Renders the pixel-parity sweep page with this port against the retained
 * upstream comparison authority (the same pinned legacy bundle the strict
 * gate uses) and counts every case from the page's independent per-case
 * line accounting. Given no arguments, the full authority is rendered at
 * both sweep sizes (64x64 and 96x48). Given case ids as arguments, only
 * those cases are counted (each at both sweep sizes). The last output line
 * is the PARITY-SUMMARY JSON:
 *
 *   PARITY-SUMMARY {"expected":N,"executed":N,"exact":N,"strict":N,"near":N,"defer":N,"skip":N,"fail":N,"missing":N}
 *
 * expected  cases the authority must render for the requested ids
 *           (the authority manifest size per size sweep - TOTAL_CASES from
 *           the strict gate - or 2 per given id);
 * executed  per-case lines actually counted (ok + FAIL/THROW);
 * exact     byte-identical passes; strict/near/defer/skip are 0 because the
 *           port's published numerical contract is byte-exact with no
 *           residual tolerance;
 * fail      FAIL/THROW lines; missing = expected - executed.
 *
 * Exit 0 only when executed == expected, fail == 0, and missing == 0.
 * Launch retries only, never parity retries; a real mismatch fails.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseSummary, TOTAL_CASES } from './ci-gate.mjs'
import { classifyCaseIds, deriveSweepCaseIds } from './sweep-case-set.mjs'
import { LEGACY_BUNDLE, cleanupScratchBundle, materializeLegacyBundle } from './upstream-bundle.mjs'

const CHROME = process.env.CHROME ||
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/chromium')
const PORT = process.env.PORT ? Number(process.env.PORT) : 0
process.on('SIGINT', () => { cleanupScratchBundle(); process.exit(130) })
process.on('SIGTERM', () => { cleanupScratchBundle(); process.exit(143) })
process.on('exit', cleanupScratchBundle)
const SWEEP_URL = '/dev-noisemaker/pixel-parity.html'
const SWEEP_URLS = [SWEEP_URL, `${SWEEP_URL}?w=96&h=48`]

function startServer(port) {
  return spawn(process.execPath,
    [join(process.cwd(), 'node_modules', 'http-server', 'bin', 'http-server'),
      '-p', String(port), '-s'],
    { stdio: ['ignore', 'pipe', 'pipe'] })
}

function pickFreePort() {
  const allowed = (process.env.HOST_PORTS || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).concat(0)
  return new Promise((resolve, reject) => {
    const attempt = i => {
      const srv = createServer()
      srv.unref()
      srv.on('error', () => {
        if (i + 1 < allowed.length) attempt(i + 1)
        else reject(new Error('no bindable port (tried ' + allowed.join(',') + ')'))
      })
      srv.listen(allowed[i], '127.0.0.1', () => {
        const { port } = srv.address()
        srv.close(() => resolve(port))
      })
    }
    attempt(0)
  })
}

async function waitForServer(port, timeoutMs = 30000) {
  const localPage = readFileSync(join(process.cwd(), 'dev-noisemaker', 'pixel-parity.html'))
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://localhost:${port}${SWEEP_URL}`)
      if (r.ok) {
        const body = Buffer.from(await r.arrayBuffer())
        if (!body.equals(localPage)) {
          throw new Error(`port ${port} is serving foreign content — refusing to run the sweep against it`)
        }
        return
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('foreign content')) throw e
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`Server didn't come up on port ${port}`)
}

function runChromeDump(url, port) {
  // Per-dump standalone child (scripts/chrome-dump.mjs), same pattern as the
  // strict gate: on hosts where a chrome launch inside a long-lived process
  // hangs (macOS, run 36479833520), the identical flags succeed from a fresh
  // process. One launch retry; never a parity retry — a real mismatch fails.
  const tmp = mkdtempSync(join(tmpdir(), 'parity-summary-dump-'))
  const out = join(tmp, 'dom.html')
  const dumpTimeout = 900000
  const childArgs = [join(process.cwd(), 'scripts', 'chrome-dump.mjs'), CHROME, `http://localhost:${port}${url}`, String(dumpTimeout), out]
  const childOpts = { encoding: 'utf8', timeout: dumpTimeout + 120000, killSignal: 'SIGKILL' }
  try {
    let result = spawnSync(process.execPath, childArgs, childOpts)
    const childFailed = r => r.status !== 0 || (r.stderr || '').toString().trim() !== '' || r.error
    if (childFailed(result)) {
      console.log('[parity-summary] chrome dump timed out or crashed; retrying once (launch retry)')
      result = spawnSync(process.execPath, childArgs, childOpts)
    }
    if (childFailed(result)) {
      throw new Error(`chrome dump failed (exit=${result.status}): ${((result.stderr || '') || (result.error && result.error.message) || '').toString().trim().slice(0, 300)}`)
    }
    const dom = readFileSync(out, 'utf8')
    if (!dom) throw new Error('chrome exited with no DOM output (timeout or crash)')
    return dom
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

let server
let addedUpstream = false
async function main() {
try {
  const requestedIds = process.argv.slice(2)
  if (requestedIds.length > 0 && /[^a-zA-Z0-9_]/.test(requestedIds.join(''))) {
    throw new Error('case ids must match [a-zA-Z0-9_]')
  }
  // Expected case-id derivation: the expected id
  // set comes from the same catalog modules and page bytes the sweep renders,
  // cross-checked against TOTAL_CASES, and every sweep's per-case ids are
  // checked for duplicates, missing ids, and unexpected ids REGARDLESS of
  // the counts — a DOM that duplicates one passing case and omits another
  // keeps every count consistent, so only the id-set comparison catches it.
  const expectedCaseIds = deriveSweepCaseIds()
  if (expectedCaseIds.length !== TOTAL_CASES) {
    throw new Error(`derived expected case-id set has ${expectedCaseIds.length} ids != TOTAL_CASES ${TOTAL_CASES} — the sweep catalog and the denominator have drifted`)
  }
  const requestDuplicates = requestedIds.filter((id, i) => requestedIds.indexOf(id) !== i)
  if (requestDuplicates.length > 0) {
    throw new Error(`duplicate case ids requested: ${[...new Set(requestDuplicates)].join(', ')}`)
  }
  const requestUnknown = requestedIds.filter(id => !expectedCaseIds.includes(id))
  if (requestUnknown.length > 0) {
    throw new Error(`unknown case ids requested (not in the derived expected set): ${requestUnknown.join(', ')}`)
  }
  // The id set each sweep DOM must report: the full derived set, or exactly
  // the requested ids for case-scoped runs.
  const expectedForRun = requestedIds.length > 0 ? [...requestedIds].sort() : expectedCaseIds
  const idViolations = []
  const { addedUpstream: bootstrapped } = materializeLegacyBundle('[parity-summary]')
  addedUpstream = bootstrapped || addedUpstream

  const servingPort = PORT !== 0 ? PORT : await pickFreePort()
  console.log(`[parity-summary] starting http-server on port ${servingPort}`)
  server = startServer(servingPort)
  await waitForServer(servingPort)
  console.log(`[parity-summary] http-server verified serving on port ${servingPort} (page bytes match the checkout)`)

  const counted = new Map()
  // Denominator: the statically knowable authority manifest size
  // (TOTAL_CASES per sweep, exported by the strict gate as the single
  // source), NOT the page's self-reported summary total - the marker's
  // total is the executed count, so deriving from it would make the
  // denominator self-referential and re-allow silent case skips. A silent
  // skip shows up as executed < expected (missing > 0) and fails.
  const authorityTotals = []
  // Case-scoped rendering: with ids, each sweep URL carries the page's
  // `cases` query parameter so the page renders ONLY the requested cases;
  // without ids the complete suite renders (the default, unchanged).
  const urls = requestedIds.length > 0
    ? SWEEP_URLS.map(u => `${u}${u.includes('?') ? '&' : '?'}cases=${requestedIds.join(',')}`)
    : SWEEP_URLS
  for (const sweepUrl of urls) {
    console.log(`[parity-summary] sweep: GET ${sweepUrl}`)
    const dom = runChromeDump(sweepUrl, servingPort)
    const summary = parseSummary(dom)
    if (summary.ok === null) throw new Error('no summary line — the sweep did not report results')
    authorityTotals.push(summary.total)
    // Id-set accounting independent of the counts: the
    // reported ids in emission order (duplicates preserved) must be exactly
    // the expected set — no duplicates, no unexpected ids, no missing ids.
    const reportedIds = [...summary.okLines, ...summary.failures.map(f => f.split(/\s+/)[0])]
    const { duplicates, unexpected, missing: missingIds } = classifyCaseIds(reportedIds, expectedForRun)
    for (const id of duplicates) idViolations.push(`${sweepUrl}: duplicate case id ${id}`)
    for (const id of unexpected) idViolations.push(`${sweepUrl}: unexpected case id ${id}`)
    for (const id of missingIds) idViolations.push(`${sweepUrl}: missing case id ${id}`)
    for (const name of summary.okLines) {
      counted.set(name, (counted.get(name) || { exact: 0, fail: 0 }))
      counted.get(name).exact++
    }
    for (const failure of summary.failures) {
      const name = failure.split(/\s+/)[0]
      counted.set(name, (counted.get(name) || { exact: 0, fail: 0 }))
      counted.get(name).fail++
    }
    console.log(`[parity-summary] ${sweepUrl}: ${summary.ok} ok, ${summary.fail} fail (${summary.perCaseCount} per-case lines)`)
  }

  // With ids the page renders exactly the requested cases, so the expected
  // count is the requested id count per sweep size. Without ids the
  // expected count is the authority manifest's size per sweep (TOTAL_CASES,
  // the strict gate's exported denominator); the page's summary total is
  // additionally cross-checked against it so a misreported or silently
  // skipped manifest fails.
  let expected
  if (requestedIds.length > 0) {
    expected = requestedIds.length * 2
  } else {
    if (authorityTotals.length !== SWEEP_URLS.length) {
      throw new Error('a sweep produced no summary - cannot verify the authority scope')
    }
    for (const t of authorityTotals) {
      if (t !== TOTAL_CASES) {
        throw new Error(`sweep summary total ${t} != authority manifest ${TOTAL_CASES} - refusing a self-referential denominator`)
      }
    }
    expected = TOTAL_CASES * SWEEP_URLS.length
  }
  let executed = 0
  let exact = 0
  let fail = 0
  for (const name of (requestedIds.length > 0 ? requestedIds : [...counted.keys()])) {
    const entry = counted.get(name) || { exact: 0, fail: 0 }
    executed += entry.exact + entry.fail
    exact += entry.exact
    fail += entry.fail
  }
  const missing = Math.max(0, expected - executed)
  const summaryLine = `PARITY-SUMMARY ${JSON.stringify({
    expected, executed, exact, strict: 0, near: 0, defer: 0, skip: 0, fail, missing
  })}`
  // Details first, PARITY-SUMMARY JSON last — the contract makes the JSON
  // the entrypoint's last output line.
  if (requestedIds.length > 0) {
    for (const id of requestedIds) {
      const entry = counted.get(id) || { exact: 0, fail: 0 }
      console.log(`[parity-summary] ${id}: exact=${entry.exact} fail=${entry.fail} (per sweep size)`)
    }
  }
  const passing = executed === expected && fail === 0 && missing === 0 && idViolations.length === 0
  for (const violation of idViolations) {
    console.error(`[parity-summary] ID VIOLATION: ${violation}`)
  }
  console.log(`[parity-summary] ${passing ? 'GREEN' : 'FAIL'}: expected=${expected} executed=${executed} exact=${exact} fail=${fail} missing=${missing}${idViolations.length > 0 ? ` idViolations=${idViolations.length}` : ''}`)
  console.log(summaryLine)
  process.exitCode = passing ? 0 : 1
} catch (err) {
  console.error('[parity-summary] error:', err)
  process.exitCode = 2
} finally {
  if (server) server.kill('SIGTERM')
  rmSync(LEGACY_BUNDLE, { force: true })
  if (addedUpstream) spawnSync('git', ['remote', 'remove', 'upstream'], { encoding: 'utf8' })
}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
