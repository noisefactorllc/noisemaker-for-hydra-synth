#!/usr/bin/env node
/**
 * GAP-002 Safari attempt: drive the real Safari on this macOS host through
 * safaridriver (WebDriver). Two legs, one run: the rendered-parity sweep
 * page served from the checkout, then the GAP-002 installed developer
 * workflow — npm pack, isolated install, both installed entry points, 12
 * create/render/dispose cycles, reinstall, removal, and tracked-file
 * preservation — all driven through the same safaridriver session family.
 * The sweep page renders the port and the pinned legacy authority side by
 * side in Safari's WebGL2 and emits `=== N ok, M fail / T total ===` plus
 * per-case lines into #log - the same evidence surface the chrome-based
 * sweep uses.
 *
 * Requires Safari's remote automation enabled once (`sudo safaridriver
 * --enable`). Usage: node scripts/safaridrive.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { materializeLegacyBundle, cleanupScratchBundle } from './upstream-bundle.mjs'
import assert from 'node:assert/strict'
import { BUNDLE_PAGE_BODY, MODULE_PAGE_BODY, encodeTestPng, pageHtml, parseSummary } from '../test/installed-workflow-page.mjs'

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

const REPO = process.cwd()
// Receipt paths stay relative to $HOME so evidence never names a specific
// machine's user directory.
const HOME = process.env.HOME || ''
const relativeHome = p => (HOME && p.startsWith(HOME) ? join('~', p.slice(HOME.length)) : p)

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts })
}

// Runs a command exactly once and returns its receipt plus outcome, so the
// recorded exit_code describes the only execution (never a second rerun).
function runReceipt(cmd, args, opts = {}, cwd = REPO) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', cwd, ...opts })
  return {
    receipt: {
      command: [cmd, ...args].join(' '),
      cwd: relativeHome(cwd),
      exit_code: result.status,
      stderr_tail: (result.stderr || '').split('\n').filter(Boolean).slice(-5)
    },
    status: result.status,
    stdout: result.stdout || ''
  }
}

function repoTrackedHashes() {
  const files = run('git', ['ls-files'], { cwd: REPO }).split('\n').filter(Boolean)
  const hashes = {}
  for (const file of files) {
    hashes[file] = createHash('sha256')
      .update(readFileSync(join(REPO, file)))
      .digest('hex')
  }
  return hashes
}

async function driverPollSummary(sessionId, timeoutMs, what) {
  return waitFor(async () => {
    const value = await driverFetch('POST', `/session/${sessionId}/execute/sync`, {
      script: 'var d = document.getElementById("log"); return d ? d.innerText : "";',
      args: []
    })
    if (!/===\s*\d+\s*ok,\s*\d+\s*fail/.test(value || '')) throw new Error('summary not ready')
    return value
  }, timeoutMs, what)
}

// GAP-002: the installed developer workflow in the same real Safari. Packs
// the candidate, installs it into an isolated consumer under the OS temp
// dir (an explicit package root, so npm never walks up into the checkout),
// serves the consumer, and drives the installed ESM and bundle entry-point
// pages through safaridriver; then reinstalls, removes, and verifies that
// every tracked repository file is byte-identical afterwards.
async function safariRunInstalledWorkflow() {
  const CYCLES = Number(process.env.HYDRA_SAFARI_CYCLES || 12)
  const hashesBefore = repoTrackedHashes()
  const scratch = mkdtempSync(join(tmpdir(), 'gap002-safari-'))
  const consumer = join(scratch, 'consumer')
  const packDir = join(scratch, 'pack')
  mkdirSync(consumer)
  mkdirSync(packDir)
  const evidence = {
    schema: 'noisemaker-for-hydra-synth installed-workflow host evidence',
    gap: 'GAP-002',
    browser: 'safari (safaridriver WebDriver)',
    cycles: CYCLES,
    node: process.version,
    repo: relativeHome(REPO),
    repo_git_head: (() => {
      const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
      return head.status === 0 ? head.stdout.trim() : null
    })(),
    commands: [],
    runs: [],
    reinstall: null,
    removal: null,
    file_preservation: null
  }
  try {
    const packArgs = ['pack', '--json', '--pack-destination', packDir]
    const packRun = runReceipt('npm', packArgs)
    assert.equal(packRun.status, 0, 'npm pack failed')
    evidence.commands.push(packRun.receipt)
    const packJson = JSON.parse(packRun.stdout)
    const tarball = resolve(join(packDir, packJson[0].filename))
    const installArgs = ['install', '--ignore-scripts', '--bin-links=false', '--no-audit', '--no-fund', tarball]
    run('npm', ['init', '-y'], { cwd: consumer })
    const installRun = runReceipt('npm', installArgs, {}, consumer)
    assert.equal(installRun.status, 0, 'npm install failed')
    evidence.commands.push(installRun.receipt)
    const installed = JSON.parse(readFileSync(join(consumer, 'node_modules', 'noisemaker-for-hydra-synth', 'package.json'), 'utf8'))
    evidence.installed = { name: installed.name, version: installed.version }

    writeFileSync(join(consumer, 'input-image.png'), encodeTestPng(16, 16))
    writeFileSync(join(consumer, 'workflow.html'), pageHtml('') + MODULE_PAGE_BODY)
    writeFileSync(join(consumer, 'bundle.html'), pageHtml(
      '<script src="./node_modules/noisemaker-for-hydra-synth/dist/hydra-synth.js"></script>'
    ) + BUNDLE_PAGE_BODY)

    const cPort = Number(process.env.HYDRA_SAFARI_CONSUMER_PORT || 43127)
    const cServer = spawn(process.execPath,
      [join(REPO, 'node_modules', 'http-server', 'bin', 'http-server'), consumer, '-p', String(cPort), '-s'],
      { stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      await waitFor(async () => {
        const r = await fetch(`http://127.0.0.1:${cPort}/workflow.html`)
        if (!r.ok) throw new Error('not up')
      }, 30000, 'consumer http-server')
      for (const [page, expectOk] of [['workflow.html', 13], ['bundle.html', 1]]) {
        const session = await driverFetch('POST', '/session', {
          capabilities: { alwaysMatch: { browserName: 'safari' } }
        })
        const sessionId = session.sessionId
        try {
          await driverFetch('POST', `/session/${sessionId}/url`, { url: `http://127.0.0.1:${cPort}/${page}?cycles=${CYCLES}` })
          const text = await driverPollSummary(sessionId, 300000, `safari installed workflow ${page}`)
          const summary = parseSummary(text)
          writeFileSync(join(receipts, `safari-installed-${page.replace(/\.html$/, '')}.log`), text)
          const result = { page, url: `http://127.0.0.1:${cPort}/${page}`, ...summary, expected_ok_minimum: expectOk, pass: summary.fail === 0 && summary.ok >= expectOk }
          evidence.runs.push(result)
          console.log(`[safari-installed] ${page}: ok=${summary.ok} fail=${summary.fail}`)
          if (summary.fail) console.log(`[safari-installed] failures: ${summary.failures.join(' | ')}`)
        } finally {
          await driverFetch('DELETE', `/session/${sessionId}`).catch(() => {})
        }
      }
    } finally {
      cServer.kill('SIGTERM')
    }

    const reinstallRun = runReceipt('npm', installArgs, {}, consumer)
    const reinstalledIntact = existsSync(join(consumer, 'node_modules', 'noisemaker-for-hydra-synth', 'src', 'index.js'))
    evidence.reinstall = { ...reinstallRun.receipt, package_intact: reinstalledIntact, pass: reinstallRun.status === 0 && reinstalledIntact }

    const uninstallArgs = ['uninstall', '--ignore-scripts', '--bin-links=false', '--no-audit', '--no-fund', 'noisemaker-for-hydra-synth']
    const uninstallRun = runReceipt('npm', uninstallArgs, {}, consumer)
    const absent = !existsSync(join(consumer, 'node_modules', 'noisemaker-for-hydra-synth'))
    evidence.removal = { ...uninstallRun.receipt, package_absent: absent, pass: uninstallRun.status === 0 && absent }

    const hashesAfter = repoTrackedHashes()
    const unchanged = JSON.stringify(hashesAfter) === JSON.stringify(hashesBefore)
    evidence.file_preservation = {
      method: 'sha256 over every git ls-files entry, before vs after the run',
      tracked_file_count: Object.keys(hashesBefore).length,
      unchanged,
      pass: unchanged
    }
    evidence.all_pass = evidence.runs.every(r => r.pass) && evidence.reinstall.pass && evidence.removal.pass && unchanged
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  writeFileSync(join(receipts, 'safari-installed-workflow.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(`[safari-installed] all_pass=${evidence.all_pass}`)
  return evidence.all_pass
}

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

  // Same real Safari, same run: the GAP-002 installed developer workflow.
  const installedPass = await safariRunInstalledWorkflow()
  if (!installedPass) process.exitCode = 1
} catch (err) {
  console.error('[safari] error:', err.message)
  if (stderr) console.error('[safari] driver stderr tail:', stderr.trim().slice(-400))
  process.exitCode = 1
} finally {
  driver.kill('SIGTERM')
}
