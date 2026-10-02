#!/usr/bin/env node
/**
 * GAP-002 installed developer workflow qualification — Safari engine leg
 * (Playwright-driven WebKit, the engine Safari 26 uses, with hardware
 * Metal-backed WebGL2 on the macOS Apple silicon host).
 *
 * Packs the package, installs the tarball into an isolated consumer, and
 * exercises the installed API (ESM source entry and browser bundle) in
 * WebKit: meaningful pixels, external image input, structured diagnostics
 * and recovery, stop/restart cancellation, resize, repeated create/render/
 * dispose cycles, reinstall, and removal. Verifies that every tracked
 * repository file is byte-identical afterwards and records a machine-
 * readable evidence receipt with raw commands, browser identity, per-check
 * results, and exit codes.
 *
 * Requires: macOS with the Playwright WebKit cache
 * (PLAYWRIGHT_BROWSERS_PATH), playwright-core in the checkout, network
 * access to the engine CDN, and npm.
 *
 * Usage:
 *   node scripts/installed-workflow-webkit.mjs \
 *     --cycles 12 --output /Users/Shared/installed-workflow-webkit-12cycles.json
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { BUNDLE_PAGE_BODY, MODULE_PAGE_BODY, encodeTestPng, pageHtml, parseSummary } from '../test/installed-workflow-page.mjs'

const args = process.argv.slice(2)
const flag = name => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const CYCLES = Number(flag('cycles')) || 12
const OUTPUT = flag('output') || `workflow-evidence/gap-002/installed-workflow-webkit-${CYCLES}cycles.json`
const REPO = process.cwd()

function freePort() {
  const allowed = (process.env.HOST_PORTS || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).concat(0)
  return new Promise((resolve, reject) => {
    const attempt = i => {
      const server = createServer()
      server.on('error', () => {
        if (i + 1 < allowed.length) attempt(i + 1)
        else reject(new Error('no bindable port (tried ' + allowed.join(',') + ')'))
      })
      server.listen(allowed[i], '127.0.0.1', () => {
        const { port } = server.address()
        server.close(() => resolve(port))
      })
    }
    attempt(0)
  })
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts })
}

function commandReceipt(cmd, args, opts = {}, cwd = REPO) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', cwd, ...opts })
  return {
    command: [cmd, ...args].join(' '),
    cwd: relativeHome(cwd),
    exit_code: result.status,
    stderr_tail: (result.stderr || '').split('\n').filter(Boolean).slice(-5)
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

// Receipt paths stay relative to $HOME so the evidence never names a
// specific machine's user directory.
const HOME = process.env.HOME || ''
const relativeHome = p => (HOME && p.startsWith(HOME) ? join('~', p.slice(HOME.length)) : p)

async function runPage(browser, url, name) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 1024 } })
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', e => pageErrors.push(String(e)))
  const summaryMatch = await page.goto(url, { timeout: 240000, waitUntil: 'load' })
    .then(async () => page.waitForFunction(
      () => /===\s*\d+\s*ok,\s*\d+\s*fail/.test(document.getElementById('log')?.textContent || ''),
      null, { timeout: 200000, polling: 500 }
    ))
    .then(async () => (await page.$eval('#log', el => el.innerText)))
    .catch(e => { pageErrors.push('wait failed: ' + e.message); return null })
  let summary = summaryMatch == null
    ? { ok: 0, fail: 1, failures: ['no summary line captured'], renderer: null }
    : parseSummary(summaryMatch)
  // A transient CDN failure shows up as the page's own engine-load error.
  // Retry the page once; any workflow failure inside the page is returned
  // unchanged and still fails the run.
  if (summary.fail > 0 && summary.failures.some(f => /Failed to load Noisemaker engine/.test(f))) {
    const retry = await page.goto(url, { timeout: 240000, waitUntil: 'load' })
      .then(async () => page.waitForFunction(
        () => /===\s*\d+\s*ok,\s*\d+\s*fail/.test(document.getElementById('log')?.textContent || ''),
        null, { timeout: 200000, polling: 500 }
      ))
      .then(async () => (await page.$eval('#log', el => el.innerText)))
      .catch(e => { pageErrors.push('retry failed: ' + e.message); return null })
    if (retry != null) summary = parseSummary(retry)
  }
  await context.close()
  return { page: name, url, ...summary, console_errors: consoleErrors, page_errors: pageErrors }
}

async function main() {
  const evidence = {
    schema: 'noisemaker-for-hydra-synth installed-workflow host evidence',
    gap: 'GAP-002',
    generated_at: new Date().toISOString(),
    browser: 'webkit (Safari engine, Playwright)',
    cycles: CYCLES,
    node: process.version,
    platform: `${process.platform} ${process.arch}` + (spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout?.trim() ? ' macOS ' + spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim() : ''),
    repo: relativeHome(REPO),
    repo_git_head: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    commands: [],
    runs: [],
    reinstall: null,
    removal: null,
    file_preservation: null
  }

  const scratchRoot = process.env.HOST_SCRATCH || tmpdir()
  mkdirSync(scratchRoot, { recursive: true })
  const scratch = mkdtempSync(join(scratchRoot, 'gap002-webkit-'))
  const consumer = join(scratch, 'consumer')
  const packDir = join(scratch, 'pack')
  mkdirSync(consumer)
  mkdirSync(packDir)
  try {
    // Pack the candidate from the checkout.
    const packArgs = ['pack', '--json', '--pack-destination', packDir]
    const packJson = JSON.parse(run('npm', packArgs, { cwd: REPO }))
    evidence.commands.push(commandReceipt('npm', packArgs))
    const tarball = resolve(join(packDir, packJson[0].filename))
    assert.ok(existsSync(tarball), 'npm pack produced a tarball')
    evidence.pack = { tarball: tarball, filename: packJson[0].filename, file_count: packJson[0].files ? packJson[0].files.length : null, size_bytes: packJson[0].size }

    // Install into an isolated consumer. Give the consumer an explicit
    // package root so npm never walks up out of the scratch consumer and
    // installs into the repository itself.
    const installArgs = ['install', '--ignore-scripts', '--bin-links=false', '--no-audit', '--no-fund', tarball]
    run('npm', ['init', '-y'], { cwd: consumer })
    run('npm', installArgs, { cwd: consumer })
    evidence.commands.push(commandReceipt('npm', installArgs, {}, consumer))
    const installed = JSON.parse(readFileSync(join(consumer, 'node_modules', 'noisemaker-for-hydra-synth', 'package.json'), 'utf8'))
    assert.equal(installed.name, 'noisemaker-for-hydra-synth')
    evidence.installed = { name: installed.name, version: installed.version }

    // Consumer fixtures.
    writeFileSync(join(consumer, 'input-image.png'), encodeTestPng(16, 16))
    writeFileSync(join(consumer, 'workflow.html'), pageHtml('') + MODULE_PAGE_BODY)
    writeFileSync(join(consumer, 'bundle.html'), pageHtml(
      '<script src="./node_modules/noisemaker-for-hydra-synth/dist/hydra-synth.js"></script>'
    ) + BUNDLE_PAGE_BODY)

    const port = await freePort()
    const server = spawn(process.execPath,
      [join(REPO, 'node_modules', 'http-server', 'bin', 'http-server'), consumer, '-p', String(port), '-s'],
      { stdio: ['ignore', 'pipe', 'pipe'] })
    let up = false
    for (let i = 0; i < 50 && !up; i++) {
      try { up = (await fetch(`http://127.0.0.1:${port}/workflow.html`)).ok } catch { await new Promise(r => setTimeout(r, 200)) }
    }
    assert.ok(up, 'consumer server started')

    // Launch Playwright WebKit (Safari's engine) with hardware WebGL2.
    const playwrightModule = process.env.PLAYWRIGHT_MODULE ||
      join(REPO, 'node_modules', 'playwright-core')
    const { webkit } = createRequire(join(playwrightModule, 'package.json'))('playwright-core')
    const browser = await webkit.launch({ headless: true })
    evidence.browser_version = browser.version()
    try {
      for (const [page, expectOk] of [['workflow.html', 11], ['bundle.html', 1]]) {
        const result = await runPage(browser, `http://127.0.0.1:${port}/${page}?cycles=${CYCLES}`, page)
        result.expected_ok_minimum = expectOk
        result.pass = result.fail === 0 && result.ok >= expectOk
        evidence.runs.push(result)
      }
    } finally {
      await browser.close()
    }
    server.kill('SIGTERM')

    // Reinstall over the existing installation.
    const reinstallReceipt = commandReceipt('npm', installArgs, {}, consumer)
    run('npm', installArgs, { cwd: consumer })
    const reinstalledIntact = existsSync(join(consumer, 'node_modules', 'noisemaker-for-hydra-synth', 'src', 'index.js'))
    evidence.reinstall = { ...reinstallReceipt, package_intact: reinstalledIntact, pass: reinstallReceipt.exit_code === 0 && reinstalledIntact }

    // Removal.
    const uninstallArgs = ['uninstall', '--ignore-scripts', '--bin-links=false', '--no-audit', '--no-fund', 'noisemaker-for-hydra-synth']
    const uninstallReceipt = commandReceipt('npm', uninstallArgs, {}, consumer)
    run('npm', uninstallArgs, { cwd: consumer })
    const absent = !existsSync(join(consumer, 'node_modules', 'noisemaker-for-hydra-synth'))
    evidence.removal = { ...uninstallReceipt, package_absent: absent, pass: uninstallReceipt.exit_code === 0 && absent }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  return evidence
}

const hashesBefore = repoTrackedHashes()
try {
  const evidence = await main()
  const hashesAfter = repoTrackedHashes()
  const unchanged = JSON.stringify(hashesAfter) === JSON.stringify(hashesBefore)
  evidence.file_preservation = {
    ...evidence.file_preservation,
    method: 'sha256 over every git ls-files entry, before vs after the run',
    tracked_file_count: Object.keys(hashesBefore).length,
    unchanged,
    pass: unchanged
  }
  evidence.all_pass = evidence.runs.every(r => r.pass) && evidence.reinstall.pass && evidence.removal.pass && unchanged
  writeFileSync(resolve(REPO, OUTPUT), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify({ output: OUTPUT, all_pass: evidence.all_pass, browser_version: evidence.browser_version, runs: evidence.runs.map(r => ({ page: r.page, ok: r.ok, fail: r.fail, renderer: r.renderer })) }, null, 2))
  if (!evidence.all_pass) process.exit(1)
} catch (error) {
  console.error(error)
  process.exit(1)
}
