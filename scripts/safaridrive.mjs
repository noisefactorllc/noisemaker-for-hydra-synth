#!/usr/bin/env node
/**
 * GAP-002 Safari attempt: drive the real Safari on this macOS host through
 * safaridriver (WebDriver) against the rendered-parity sweep page served
 * from the checkout, and report the page's own per-case summary. The page
 * renders the port and the pinned legacy authority side by side in Safari's
 * WebGL2 and emits `=== N ok, M fail / T total ===` plus per-case lines into
 * #log - the same evidence surface the chrome-based sweep uses.
 *
 * Requires Safari's remote automation enabled once (`sudo safaridriver
 * --enable`). Usage: node scripts/safaridrive.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { materializeLegacyBundle, cleanupScratchBundle } from './upstream-bundle.mjs'

const PORT = Number(process.env.HYDRA_SAFARI_PORT || 43125)
const DRIVER_PORT = Number(process.env.HYDRA_SAFARI_DRIVER_PORT || 4444)
// Serve the repository root: the sweep page's static imports
// (../src/index.js, ../src/glsl/..., ../src/engine/...) resolve outside
// dev-noisemaker/, so the root is the web root (as scripts/test.mjs does).
const SERVE_DIR = process.cwd()
const SWEEP_PATH = '/dev-noisemaker/pixel-parity.html'
// Receipts land in the runner's temp receipt dir when provided (the
// workflow uploads it), else the OS temp dir.
const receipts = join(process.env.RUNNER_TEMP || tmpdir(), 'safari-receipts')

function wait(ms) { return new Promise(r => setTimeout(r, ms)) }

async function waitFor(fn, timeoutMs, what) {
  const t0 = Date.now()
  for (;;) {
    try { return await fn() } catch (_e) { /* retry */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`${what} did not become ready`)
    await wait(300)
  }
}

async function driverFetch(method, path, body) {
  // safaridriver speaks the W3C WebDriver protocol: successful responses
  // carry only a value member (legacy-OSS responses add status:0), so
  // judge on the HTTP status and value.error, not on status:0.
  const r = await fetch(`http://127.0.0.1:${DRIVER_PORT}${path}`, {
    method,
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
  })
  const data = await r.json()
  if (!r.ok || (data.value && data.value.error)) throw new Error(`safaridriver ${method} ${path} failed: ${r.status} ${JSON.stringify(data.value).slice(0, 300)}`)
  return data.value
}

// No --verbose: some safaridriver builds reject that option and exit
// immediately, which would kill the session before it starts.
const driver = spawn('safaridriver', ['-p', String(DRIVER_PORT)], { stdio: ['ignore', 'ignore', 'pipe'] })
let stderr = ''
driver.stderr.on('data', d => { stderr += d })
const { addedUpstream } = materializeLegacyBundle('[safari]')
// The helper's invariant: a bootstrapped upstream remote must be removed
// (as scripts/ci-gate.mjs and scripts/test.mjs do at exit).
const removeUpstream = () => { if (addedUpstream) spawnSync('git', ['remote', 'remove', 'upstream'], { encoding: 'utf8' }) }
process.on('SIGINT', () => { cleanupScratchBundle(); removeUpstream(); process.exit(130) })
process.on('SIGTERM', () => { cleanupScratchBundle(); removeUpstream(); process.exit(143) })
process.on('exit', removeUpstream)
mkdirSync(receipts, { recursive: true })
writeFileSync(join(receipts, 'identity.log'), `driver=${DRIVER_PORT}\nserved=${PORT}\n`)

try {
  const server = spawn(process.execPath,
    [join(process.cwd(), 'node_modules', 'http-server', 'bin', 'http-server'), SERVE_DIR, '-p', String(PORT), '-s'],
    { stdio: ['ignore', 'ignore', 'pipe'] })
  try {
    await waitFor(async () => {
      const r = await fetch(`http://127.0.0.1:${PORT}${SWEEP_PATH}`)
      if (!r.ok) throw new Error('not up')
    }, 30000, 'http-server')

    const session = await driverFetch('POST', '/session', {
      capabilities: { alwaysMatch: { browserName: 'safari' } }
    })
    const sessionId = session.sessionId
    console.log(`[safari] session ${sessionId}`)

    const url = `http://127.0.0.1:${PORT}${SWEEP_PATH}`
    await driverFetch('POST', `/session/${sessionId}/url`, { url })
    // The page renders every case against the pinned authority bundle; wait
    // for the summary marker to appear in #log.
    const text = await waitFor(async () => {
      const value = await driverFetch('POST', `/session/${sessionId}/execute/sync`, {
        script: 'var d = document.getElementById("log"); return d ? d.innerText : "";',
        args: []
      })
      if (!/===\s*\d+\s*ok,\s*\d+\s*fail/.test(value || '')) throw new Error('summary not ready')
      return value
    }, 240000, 'safari sweep summary')
    writeFileSync(join(receipts, 'safari-sweep.log'), text)

    const version = await driverFetch('GET', `/session/${sessionId}`).catch(() => ({}))
    console.log(`[safari] browser=${version.browserName || 'safari'} version=${version.version || 'unknown'}`)
    console.log(text.trim().split('\n').filter(l => /===/.test(l)).join('\n'))
    const perCase = text.trim().split('\n').filter(l => /^(ok|FAIL)\s/.test(l))
    const okLines = perCase.filter(l => /^ok\s/.test(l))
    const failLines = perCase.filter(l => /^FAIL\s/.test(l))
    const summary = text.match(/===\s*(\d+)\s*ok,\s*(\d+)\s*fail(?:\s*\/\s*(\d+)\s*total)?/)
    const ok = summary ? Number(summary[1]) : 0
    const fail = summary ? Number(summary[2]) : 0
    const total = summary && summary[3] ? Number(summary[3]) : null
    console.log(`[safari] per-case lines: ok=${okLines.length} fail=${failLines.length}; summary ok=${ok} fail=${fail} total=${total}`)
    if (failLines.length) console.log(`[safari] FAILURES:\n${failLines.join('\n')}`)
    const passed = ok > 0 && fail === 0 && okLines.length === ok && total !== null && total === ok
    process.exitCode = passed ? 0 : 1
    console.log(`[safari] ${passed ? 'GREEN' : 'FAIL'}: Safari ran the rendered-parity sweep with zero failures`)
    await driverFetch('DELETE', `/session/${sessionId}`).catch(() => {})
  } finally {
    server.kill('SIGTERM')
  }
} catch (err) {
  console.error('[safari] error:', err.message)
  if (stderr) console.error('[safari] driver stderr tail:', stderr.trim().slice(-400))
  process.exitCode = 1
} finally {
  driver.kill('SIGTERM')
}
