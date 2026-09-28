#!/usr/bin/env node
/*
 * GAP-002 installed developer workflow qualification.
 *
 * Packs the package, installs the tarball into an isolated consumer, and
 * exercises the installed API (ESM source entry and browser bundle) in
 * headless Chromium: meaningful pixels, external image input, structured
 * diagnostics and recovery, stop/restart cancellation, resize, repeated
 * create/render/dispose cycles, reinstall, and removal.
 *
 * Requires: chromium (override with CHROME), network access to the engine
 * CDN, and npm. Uses TMPDIR for all pack/consumer state; the repository
 * tree is hash-verified unchanged across the run.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BUNDLE_PAGE_BODY, MODULE_PAGE_BODY, encodeTestPng, pageHtml, parseDomSummary } from './installed-workflow-page.mjs'

const CHROME = process.env.CHROME || '/usr/bin/chromium'
const REPO = process.cwd()

function freePort() {
  return new Promise(resolve => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts })
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

function runChromeDump(url) {
  const args = [
    '--headless', '--no-sandbox',
    '--window-size=1024,1024',
    '--hide-scrollbars',
    '--virtual-time-budget=180000',
    '--dump-dom', url
  ]
  const result = spawnSync(CHROME, args, { encoding: 'utf8' })
  if (result.status !== 0 && !result.stdout) {
    throw new Error(`chromium exited ${result.status}: ${result.stderr}`)
  }
  return result.stdout
}

test('installed package workflow: pack, install, exercise, reinstall, remove', async t => {
  const scratch = mkdtempSync(join(tmpdir(), 'gap002-'))
  const consumer = join(scratch, 'consumer')
  const packDir = join(scratch, 'pack')
  mkdirSync(consumer)
  mkdirSync(packDir)

  const hashesBefore = repoTrackedHashes()
  t.after(() => rmSync(scratch, { recursive: true, force: true }))

  // Pack the candidate from the checkout.
  const packJson = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', packDir], { cwd: REPO }))
  const tarball = join(packDir, packJson[0].filename)
  assert.ok(existsSync(tarball), 'npm pack produced a tarball')

  // Install into an isolated consumer.
  run('npm', ['install', '--ignore-scripts', '--bin-links=false', '--no-audit', '--no-fund', tarball],
    { cwd: consumer })
  const installed = JSON.parse(readFileSync(join(consumer, 'node_modules', 'noisemaker-for-hydra-synth', 'package.json'), 'utf8'))
  assert.equal(installed.name, 'noisemaker-for-hydra-synth')

  // Consumer fixtures: procedurally encoded external image and both entry points.
  writeFileSync(join(consumer, 'input-image.png'), encodeTestPng(16, 16))
  writeFileSync(join(consumer, 'workflow.html'), pageHtml('') + MODULE_PAGE_BODY)
  writeFileSync(join(consumer, 'bundle.html'), pageHtml(
    '<script src="./node_modules/noisemaker-for-hydra-synth/dist/hydra-synth.js"></script>'
  ) + BUNDLE_PAGE_BODY)

  // Serve the consumer and run both installed entry points in Chromium.
  const port = await freePort()
  const server = spawn(process.execPath,
    [join(REPO, 'node_modules', 'http-server', 'bin', 'http-server'), consumer, '-p', String(port), '-s'],
    { stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => server.kill('SIGTERM'))
  let up = false
  for (let i = 0; i < 50 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${port}/workflow.html`)).ok } catch { await new Promise(r => setTimeout(r, 200)) }
  }
  assert.ok(up, 'consumer server started')

  for (const [page, expectOk] of [['workflow.html', 11], ['bundle.html', 1]]) {
    const summary = parseDomSummary(runChromeDump(`http://127.0.0.1:${port}/${page}`))
    assert.equal(summary.fail, 0, `${page} failures: ${summary.failures.join(' | ')}`)
    assert.ok(summary.ok >= expectOk, `${page} ok ${summary.ok} < expected ${expectOk}`)
  }

  // Reinstall over the existing installation (upgrade path available offline;
  // no published registry version exists to upgrade from, npm view is E404).
  run('npm', ['install', '--ignore-scripts', '--bin-links=false', '--no-audit', '--no-fund', tarball],
    { cwd: consumer })
  assert.ok(existsSync(join(consumer, 'node_modules', 'noisemaker-for-hydra-synth', 'src', 'index.js')),
    'reinstall keeps the package intact')

  // Removal.
  run('npm', ['uninstall', '--ignore-scripts', '--bin-links=false', '--no-audit', '--no-fund', 'noisemaker-for-hydra-synth'],
    { cwd: consumer })
  assert.equal(existsSync(join(consumer, 'node_modules', 'noisemaker-for-hydra-synth')), false,
    'package absent after uninstall')

  // File preservation: every tracked repository file is byte-identical.
  const hashesAfter = repoTrackedHashes()
  assert.deepEqual(hashesAfter, hashesBefore, 'tracked repository files unchanged')
})
