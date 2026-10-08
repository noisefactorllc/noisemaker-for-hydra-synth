#!/usr/bin/env node
/*
 * Installed developer workflow qualification — additional declared
 * hosts.
 *
 * Packs the package, installs the tarball into an isolated consumer, and
 * exercises the installed API (ESM source entry and browser bundle) in a
 * Playwright-driven browser (Firefox or Chromium), then reinstalls and
 * removes the package and verifies that every tracked repository file is
 * byte-identical afterwards. Records a machine-readable evidence receipt
 * with raw commands, versions, per-check results, and exit codes.
 *
 * Usage:
 *   node scripts/installed-workflow-host.mjs --browser firefox \
 *     --cycles 12 --output installed-workflow-out/installed-workflow-firefox.json
 *
 * Requires: a Playwright module (PLAYWRIGHT_MODULE, or PLAYWRIGHT_PATH as a
 * node_modules directory to createRequire from), PLAYWRIGHT_BROWSERS_PATH,
 * network access to the engine CDN, npm, and Xvfb + Mesa for Firefox on a
 * display-less Linux host (set DISPLAY).
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { BUNDLE_PAGE_BODY, MODULE_PAGE_BODY, encodeTestPng, pageHtml, parseSummary } from '../test/installed-workflow-page.mjs'

const args = process.argv.slice(2)
const flag = name => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const BROWSER = flag('browser') || 'firefox'
const CYCLES = Number(flag('cycles')) || 12
// Optional same-package upgrade leg: materialize a prior published revision
// of this repository (git archive of <revision>), pack it, and install it
// into the consumer before the candidate tarball is installed over it, so
// the measured install is an upgrade-over rather than a fresh install.
const UPGRADE_FROM = flag('upgrade-from')
const EXTRA_ARGS = (flag('browser-args') || process.env.BROWSER_ARGS || '').split(',').map(s => s.trim()).filter(Boolean)
const OUTPUT = flag('output') || `installed-workflow-out/installed-workflow-${BROWSER}-${CYCLES}cycles.json`
const REPO = process.cwd()

const playwrightPath = process.env.PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_PATH
if (!playwrightPath) {
  console.error('Set PLAYWRIGHT_MODULE to a directory containing the playwright package.')
  process.exit(2)
}
const { firefox, chromium } = createRequire(join(playwrightPath, 'package.json'))('playwright')

function freePort() {
  // A sandboxed host may only serve on an allow-listed loopback range;
  // HOST_PORTS lists those; the ephemeral port (0) is always the final
  // fallback.
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

// Runs a command exactly once and returns its receipt plus outcome, so the
// recorded exit_code describes the only execution (never a second rerun).
function runReceipt(cmd, args, opts = {}, cwd = REPO) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', cwd, ...opts })
  return {
    receipt: {
      command: [cmd, ...args].join(' '),
      cwd,
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
  const summary = summaryMatch == null
    ? { ok: 0, fail: 1, failures: ['no summary line captured'], renderer: null }
    : parseSummary(summaryMatch)
  await context.close()
  // Native browser resource errors (for example WebKit's "too many active
  // WebGL contexts" eviction notice) arrive as console messages without a
  // JS console.error call, so the page fixture cannot capture them; the
  // harness fails the run on any of them.
  const resourceErrors = [...consoleErrors, ...pageErrors]
    .filter(e => /active WebGL contexts|context (already )?lost|INVALID_OPERATION/i.test(e))
  return { page: name, url, ...summary, console_errors: consoleErrors, page_errors: pageErrors, resource_errors: resourceErrors }
}

async function main() {
  const evidence = {
    schema: 'noisemaker-for-hydra-synth installed-workflow host evidence',
    gap: 'GAP-002',
    generated_at: new Date().toISOString(),
    browser: BROWSER,
    cycles: CYCLES,
    node: process.version,
    repo: REPO,
    repo_git_head: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    playwright_module: resolve(playwrightPath),
    commands: [],
    runs: [],
    reinstall: null,
    removal: null,
    file_preservation: null
  }

  const scratchRoot = process.env.HOST_SCRATCH || tmpdir()
  mkdirSync(scratchRoot, { recursive: true })
  const scratch = mkdtempSync(join(scratchRoot, 'gap002-host-'))
  const consumer = join(scratch, 'consumer')
  const packDir = join(scratch, 'pack')
  mkdirSync(consumer)
  mkdirSync(packDir)
  try {
    // Shared consumer preparation (also used by the upgrade-over leg).
    writeFileSync(join(consumer, 'input-image.png'), encodeTestPng(16, 16))
    run('npm', ['init', '-y'], { cwd: consumer })
    // Pack the candidate before selecting an upgrade discriminator: only
    // bytes in both tarballs can prove what was actually installed.
    const packArgs = ['pack', '--json', '--pack-destination', packDir]
    const packRun = runReceipt('npm', packArgs)
    assert.equal(packRun.status, 0, 'npm pack failed')
    evidence.commands.push(packRun.receipt)
    const packJson = JSON.parse(packRun.stdout)
    const tarball = resolve(join(packDir, packJson[0].filename))
    assert.ok(existsSync(tarball), 'npm pack produced a tarball')
    evidence.pack = { tarball: tarball, filename: packJson[0].filename, file_count: packJson[0].files ? packJson[0].files.length : null, size_bytes: packJson[0].size }

    // Optional upgrade-over preparation: pack a prior published revision and
    // install it into the consumer first. The candidate install below then
    // measures an upgrade (install over an existing installation), not a
    // fresh install.
    if (UPGRADE_FROM) {
      const priorDir = join(scratch, 'prior')
      mkdirSync(priorDir)
      const archivePath = join(scratch, 'prior.tar')
      // Binary archive: write to a file (never round-trip through a decoded
      // stdout string, which corrupts tar bytes).
      const archiveRun = runReceipt('git', ['archive', '--format=tar', '-o', archivePath, UPGRADE_FROM], { maxBuffer: 256 * 1024 * 1024 }, REPO)
      assert.equal(archiveRun.status, 0, 'git archive of the prior revision failed')
      execFileSync('tar', ['-xf', archivePath, '-C', priorDir])
      evidence.commands.push({ command: `git archive --format=tar -o ${archivePath} ${UPGRADE_FROM} && tar -xf ${archivePath} -C ${priorDir}`, cwd: REPO, exit_code: 0 })
      // Pack the prior into its own destination so the candidate pack cannot
      // overwrite its tarball (both would otherwise share one filename).
      const priorPackDir = join(packDir, 'prior')
      mkdirSync(priorPackDir)
      const priorPackRun = runReceipt('npm', ['pack', '--json', '--pack-destination', priorPackDir], {}, priorDir)
      assert.equal(priorPackRun.status, 0, 'npm pack of the prior revision failed')
      evidence.commands.push(priorPackRun.receipt)
      const priorJson = JSON.parse(priorPackRun.stdout)
      const priorTarball = resolve(join(priorPackDir, priorJson[0].filename))
      assert.ok(existsSync(priorTarball), 'prior revision tarball exists')
      // Choose differing bytes present in both tarballs; a checkout file may
      // be unchanged or excluded from the published package.
      assert.ok(Array.isArray(priorJson[0].files) && Array.isArray(packJson[0].files), 'both packs must list their files')
      const priorPaths = new Set(priorJson[0].files.map(file => file.path))
      const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
      const packedSha256 = (archive, file) => sha256(execFileSync('tar', ['-xOzf', archive, `package/${file}`]))
      let discriminator, priorSha, candidateSha
      for (const { path } of packJson[0].files) {
        if (!priorPaths.has(path)) continue
        const oldHash = packedSha256(priorTarball, path)
        const newHash = packedSha256(tarball, path)
        if (oldHash === newHash) continue
        discriminator = path
        priorSha = oldHash
        candidateSha = newHash
        break
      }
      assert.ok(discriminator, 'packed revisions need a shared file with differing bytes')
      const priorInstallRun = runReceipt('npm', ['install', '--ignore-scripts', '--bin-links=false', '--no-audit', '--no-fund', priorTarball], {}, consumer)
      assert.equal(priorInstallRun.status, 0, 'npm install of the prior revision failed')
      evidence.commands.push(priorInstallRun.receipt)
      const priorInstalledSha = sha256(readFileSync(join(consumer, 'node_modules', 'noisemaker-for-hydra-synth', discriminator)))
      assert.equal(priorInstalledSha, priorSha, 'prior install carries the prior revision content')
      const priorInstalled = JSON.parse(readFileSync(join(consumer, 'node_modules', 'noisemaker-for-hydra-synth', 'package.json'), 'utf8'))
      assert.equal(priorInstalled.name, 'noisemaker-for-hydra-synth')
      evidence.upgrade = {
        from_revision: UPGRADE_FROM,
        prior_tarball: priorJson[0].filename,
        prior_version: priorInstalled.version,
        prior_installed: true,
        discriminator: {
          file: discriminator,
          prior_sha256: priorSha,
          prior_installed_sha256: priorInstalledSha,
          candidate_sha256: candidateSha
        }
      }
    }

    // Install into an isolated consumer (the consumer root was already
    // prepared above, so npm never walks up out of the scratch consumer and
    // installs into the repository itself).
    const installArgs = ['install', '--ignore-scripts', '--bin-links=false', '--no-audit', '--no-fund', tarball]
    const installRun = runReceipt('npm', installArgs, {}, consumer)
    assert.equal(installRun.status, 0, 'npm install failed')
    evidence.commands.push(installRun.receipt)
    const installed = JSON.parse(readFileSync(join(consumer, 'node_modules', 'noisemaker-for-hydra-synth', 'package.json'), 'utf8'))
    assert.equal(installed.name, 'noisemaker-for-hydra-synth')
    evidence.installed = { name: installed.name, version: installed.version }
    if (evidence.upgrade) {
      // The candidate install ran over the prior revision's installation;
      // prove the installed tree now carries the candidate's content via the
      // revision discriminator.
      const installedSha = createHash('sha256').update(readFileSync(join(consumer, 'node_modules', 'noisemaker-for-hydra-synth', evidence.upgrade.discriminator.file))).digest('hex')
      evidence.upgrade.discriminator.over_installed_sha256 = installedSha
      evidence.upgrade.discriminator.matches_candidate = installedSha === evidence.upgrade.discriminator.candidate_sha256
      assert.ok(evidence.upgrade.discriminator.matches_candidate, 'candidate install carries the candidate tarball content')
      evidence.upgrade.candidate_version = installed.version
      evidence.upgrade.over_install = { receipt: installRun.receipt, pass: installRun.status === 0 && evidence.upgrade.discriminator.matches_candidate }
    }

    // Consumer fixtures.
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

    // Launch the target browser.
    const launchOptions = { headless: true }
    let browserType
    if (BROWSER === 'firefox') {
      browserType = firefox
      launchOptions.headless = false // Firefox headless has no WebGL on this host; run under Xvfb
    } else if (BROWSER === 'chromium') {
      browserType = chromium
      if (process.env.CHROME && !process.env.PLAYWRIGHT_CHROMIUM_BUNDLE) {
        launchOptions.executablePath = process.env.CHROME
        launchOptions.args = ['--no-sandbox']
      }
      launchOptions.args = [...(launchOptions.args || []), ...EXTRA_ARGS]
    } else {
      throw new Error(`unsupported browser: ${BROWSER}`)
    }
    const browser = await browserType.launch(launchOptions)
    evidence.browser_version = browser.version()
    evidence.launch_options = launchOptions

    try {
      for (const [page, expectOk] of [['workflow.html', 13], ['bundle.html', 1]]) {
        const result = await runPage(browser, `http://127.0.0.1:${port}/${page}?cycles=${CYCLES}`, page)
        result.expected_ok_minimum = expectOk
        result.pass = result.fail === 0 && result.ok >= expectOk && (result.resource_errors || []).length === 0
        evidence.runs.push(result)
      }
    } finally {
      await browser.close()
    }
    server.kill('SIGTERM')

    // Reinstall over the existing installation.
    const reinstallRun = runReceipt('npm', installArgs, {}, consumer)
    const reinstalledIntact = existsSync(join(consumer, 'node_modules', 'noisemaker-for-hydra-synth', 'src', 'index.js'))
    evidence.reinstall = { ...reinstallRun.receipt, package_intact: reinstalledIntact, pass: reinstallRun.status === 0 && reinstalledIntact }

    // Removal.
    const uninstallArgs = ['uninstall', '--ignore-scripts', '--bin-links=false', '--no-audit', '--no-fund', 'noisemaker-for-hydra-synth']
    const uninstallRun = runReceipt('npm', uninstallArgs, {}, consumer)
    const absent = !existsSync(join(consumer, 'node_modules', 'noisemaker-for-hydra-synth'))
    evidence.removal = { ...uninstallRun.receipt, package_absent: absent, pass: uninstallRun.status === 0 && absent }

    // File preservation: verified by the caller after main() returns.
    evidence.file_preservation = { tracked_file_count: Object.keys(repoTrackedHashes()).length }
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
    && (!evidence.upgrade || (evidence.upgrade.over_install.pass && evidence.upgrade.prior_installed && evidence.upgrade.discriminator.matches_candidate))
  mkdirSync(dirname(join(REPO, OUTPUT)), { recursive: true })
  writeFileSync(join(REPO, OUTPUT), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify({ output: OUTPUT, all_pass: evidence.all_pass, browser: BROWSER, version: evidence.browser_version, runs: evidence.runs.map(r => ({ page: r.page, ok: r.ok, fail: r.fail, renderer: r.renderer })) }, null, 2))
  if (!evidence.all_pass) process.exit(1)
} catch (error) {
  console.error(error)
  process.exit(1)
}
