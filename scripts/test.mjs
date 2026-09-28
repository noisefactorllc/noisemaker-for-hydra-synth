#!/usr/bin/env node
/*
 * Single-command CI: spawn http-server, run exact browser pixel parity in
 * headless Chrome, parse pass/fail counts, and exit non-zero on failure.
 *
 * Designed to find an executable Chrome/Chromium via the CHROME env var or a
 * list of common install paths (macOS, Linux, snap). The selected binary is
 * reported in the output so parity evidence records its provenance.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { cleanupScratchBundle, LEGACY_BUNDLE, materializeLegacyBundle } from './upstream-bundle.mjs'
import { accessSync, constants, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME_CANDIDATES = process.env.CHROME ? [process.env.CHROME] : [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium'
].filter(Boolean)
const CHROME = CHROME_CANDIDATES.find(p => {
  try {
    if (statSync(p).isFile() && accessSync(p, constants.X_OK) === undefined) return true
    console.error(`[test] Chrome candidate not an executable file: ${p}`)
    return false
  } catch (_e) { return false }
})
if (!CHROME) {
  if (process.env.CHROME) {
    console.error(`[test] CHROME is set but not an executable file: ${process.env.CHROME}. Refusing to fall through to another candidate.`)
  } else {
    console.error(`No executable Chrome found. Tried: ${CHROME_CANDIDATES.join(', ')}. Set CHROME=<path>.`)
  }
  process.exit(1)
}
console.log(`[test] using Chrome binary: ${CHROME}`)
// A sandboxed host may only serve on an allow-listed loopback range; the
// first bindable entry of HOST_PORTS wins; the ephemeral port (0) is the
// final fallback. Same policy as scripts/ci-gate.mjs. An explicit PORT env
// still pins the server port (the documented invocation in COMPATIBILITY.md
// and the gap receipts).
const PORT = process.env.PORT ? Number(process.env.PORT) : await pickFreePort()
const SWEEPS = [
  { url: '/dev-noisemaker/pixel-parity.html', name: 'pixel-parity-64x64', expectPass: 71 },
  { url: '/dev-noisemaker/pixel-parity.html?w=96&h=48', name: 'pixel-parity-96x48', expectPass: 71 }
]

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

function startServer() {
  // Installs use --bin-links=false, so no http-server binary exists; run it
  // through node directly from the installed dependency.
  const proc = spawn(process.execPath,
    [join(process.cwd(), 'node_modules', 'http-server', 'bin', 'http-server'),
      '-p', String(PORT), '-s'],
    { stdio: ['ignore', 'pipe', 'pipe'] })
  return proc
}

async function waitForServer(timeoutMs = 5000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://localhost:${PORT}/dev-noisemaker/pixel-parity.html`)
      if (r.ok) return
    } catch (_e) {}
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`Server didn't come up on port ${PORT}`)
}

function runChromeDump(url) {
  // Per-run user data dir: some sandboxed hosts (and concurrent runs) fail
  // Chrome's default profile container or collide on a shared profile.
  const scratchRoot = process.env.HOST_SCRATCH || tmpdir()
  mkdirSync(scratchRoot, { recursive: true })
  const tmp = mkdtempSync(join(scratchRoot, 'hydra-test-'))
  const out = join(tmp, 'dom.html')
  // Per-run user data dir: some sandboxed hosts (and concurrent runs) fail
  // Chrome's default profile container or collide on a shared profile.
  const profileDir = mkdtempSync(join(tmpdir(), 'hydra-test-profile-'))
  // Headless Chrome ignores the *_proxy environment variables; honor them
  // explicitly so CDN fetches work through a filtering proxy. Chrome
  // bypasses the proxy for loopback by default, so the local sweep server
  // is unaffected.
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
  const args = [
    '--headless', '--no-sandbox',
    ...(process.env.HYDRA_TEST_CHROME_ARGS ? process.env.HYDRA_TEST_CHROME_ARGS.split(' ') : []),
    '--user-data-dir=' + profileDir,
    ...(proxy ? ['--proxy-server=' + proxy] : []),
    '--window-size=1024,1024',
    '--hide-scrollbars',
    '--virtual-time-budget=180000',
    '--dump-dom', `http://localhost:${PORT}${url}`
  ]
  let result
  try {
    // 900s with one launch retry: the sweep pages render 71 cases each and,
    // on proxy-sandboxed hosts, a single dump can legitimately take longer
    // than a fast local run. The retry is a launch retry, never a parity
    // retry — a real mismatch still fails.
    // Dump window is env-tunable (HOST-DELEGATED runs use a larger window
    // within the broker's cap); one launch retry, never a parity retry —
    // a real mismatch still fails.
    const dumpTimeout = Number(process.env.HYDRA_TEST_DUMP_TIMEOUT) || 900000
    result = spawnSync(CHROME, args, { encoding: 'utf8', timeout: dumpTimeout, killSignal: 'SIGKILL' })
    if (result.error && /ETIMEDOUT/.test(result.error.message)) {
      console.log('[test] chrome dump timed out; retrying once (launch retry)')
      result = spawnSync(CHROME, args, { encoding: 'utf8', timeout: dumpTimeout, killSignal: 'SIGKILL' })
    }
  } finally {
    rmSync(profileDir, { recursive: true, force: true })
  }
  writeFileSync(out, result.stdout)
  return result.stdout
}

function parseSummary(domText) {
  // Each sweep page emits a final line like:
  //   `=== 51 ok, 0 fail / 51 total ===`
  // and individual `FAIL ...` lines. Pull both out of the log div content.
  const logMatch = domText.match(/<div id="log">([\s\S]*?)<\/div>\s*<script/)
  if (!logMatch) return { ok: 0, fail: 0, failures: [] }
  // Strip nested div tags to get the text.
  const text = logMatch[1].replace(/<[^>]*>/g, '\n')
  const summaryMatch = text.match(/===\s*(\d+)\s*ok,\s*(\d+)\s*fail/)
  const failures = [...text.matchAll(/^(?:FAIL|THROW)\s+([^\n]+)/gm)].map(m => m[1].trim())
  if (!summaryMatch) return { ok: 0, fail: failures.length, failures, raw: text.slice(-500) }
  return {
    ok: parseInt(summaryMatch[1], 10),
    fail: parseInt(summaryMatch[2], 10),
    failures
  }
}

let server, exitCode = 0
// The retained upstream Hydra comparison bundle is materialized by the
// shared pinned helper (scripts/upstream-bundle.mjs): identical bytes and
// SHA-256 pin as the strict gate, bootstrapping the remote on a bare
// checkout.
let addedUpstream = false
try {
  addedUpstream = materializeLegacyBundle('[test]').addedUpstream
  console.log(`[test] starting http-server on port ${PORT}`)
  server = startServer()
  await waitForServer()

  for (const { url, name, expectPass } of SWEEPS) {
    console.log(`\n[test] ${name}: GET ${url}`)
    const dom = runChromeDump(url)
    const { ok, fail, failures } = parseSummary(dom)
    const passed = fail === 0 && ok >= expectPass
    console.log(`[test] ${name}: ${ok} ok, ${fail} fail (expected >= ${expectPass} ok, 0 fail)`)
    if (failures.length > 0) {
      console.log('[test] failures:')
      for (const f of failures.slice(0, 10)) console.log(`         ${f}`)
    }
    if (!passed) exitCode = 1
  }

  console.log(exitCode === 0
    ? '\n[test] ALL GREEN'
    : '\n[test] FAILURES — see above')
} catch (err) {
  console.error('[test] error:', err)
  exitCode = 2
} finally {
  if (server) server.kill('SIGTERM')
  rmSync(LEGACY_BUNDLE, { force: true })
  if (addedUpstream) spawnSync('git', ['remote', 'remove', 'upstream'], { encoding: 'utf8' })
}
process.exit(exitCode)
