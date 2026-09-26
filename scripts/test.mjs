#!/usr/bin/env node
/*
 * Single-command CI: spawn http-server, run exact browser pixel parity in
 * headless Chrome, parse pass/fail counts, and exit non-zero on failure.
 *
 * Designed to run on macOS with Google Chrome installed at the standard
 * path. CI on other platforms will need to override CHROME with an env var.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = process.env.PORT || 8765
const LEGACY_BUNDLE = join(process.cwd(), 'dev-noisemaker', '.legacy-hydra-synth.js')
const SWEEPS = [
  { url: '/dev-noisemaker/pixel-parity.html', name: 'pixel-parity', expectPass: 58 }
]

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
  const tmp = mkdtempSync(join(tmpdir(), 'hydra-test-'))
  const out = join(tmp, 'dom.html')
  const args = [
    '--headless', '--no-sandbox',
    '--window-size=1024,1024',
    '--hide-scrollbars',
    '--virtual-time-budget=180000',
    '--dump-dom', `http://localhost:${PORT}${url}`
  ]
  const result = spawnSync(CHROME, args, { encoding: 'utf8' })
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
try {
  writeFileSync(
    LEGACY_BUNDLE,
    execFileSync('git', ['show', 'upstream/main:dist/hydra-synth.js'], { encoding: 'utf8' })
  )
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
}
process.exit(exitCode)
