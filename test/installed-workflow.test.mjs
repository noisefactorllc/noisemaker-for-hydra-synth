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
import { deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

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

// Minimal PNG encoder (8-bit RGBA, filter 0 per row) for the external image.
function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(pngChunk.crc(body) >>> 0)
  return Buffer.concat([len, body, crc])
}
{
  const table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  pngChunk.crc = buffer => {
    let c = 0xffffffff
    for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
}

// Left half opaque red, right half opaque blue: unambiguous sampler evidence.
function encodeTestPng(width, height) {
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4)
    raw[row] = 0
    for (let x = 0; x < width; x++) {
      const o = row + 1 + x * 4
      raw[o] = x < width / 2 ? 255 : 0
      raw[o + 1] = 0
      raw[o + 2] = x < width / 2 ? 0 : 255
      raw[o + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
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

function parseSummary(domText) {
  const logMatch = domText.match(/<div id="log">([\s\S]*?)<\/div>\s*<script/)
  if (!logMatch) return { ok: 0, fail: 1, failures: ['no #log div in DOM'] }
  const text = logMatch[1].replace(/<[^>]*>/g, '\n')
  const summaryMatch = text.match(/===\s*(\d+)\s*ok,\s*(\d+)\s*fail/)
  const failures = [...text.matchAll(/^(?:FAIL|THROW)\s+([^\n]+)/gm)].map(m => m[1].trim())
  if (!summaryMatch) return { ok: 0, fail: failures.length + 1, failures, raw: text.slice(-500) }
  return {
    ok: parseInt(summaryMatch[1], 10),
    fail: parseInt(summaryMatch[2], 10),
    failures
  }
}

const pageHtml = preload => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<style>html,body{margin:0;background:#000;color:#ccc;font:13px/1.4 monospace}canvas{display:none}#log{padding:12px;white-space:pre-wrap}</style>
</head><body><div id="log"></div>
${preload}
<script type="module">
const log = document.getElementById('log')
const emit = line => { const d = document.createElement('div'); d.textContent = line; log.appendChild(d) }
let ok = 0, fail = 0
const check = (name, pass, detail) => {
  if (pass) { emit('ok ' + name); ok++ } else { emit('FAIL ' + name + ' -> ' + detail); fail++ }
}
const errorText = error => {
  if (Array.isArray(error?.diagnostics) && error.diagnostics.length > 0) return error.diagnostics.map(d => d?.message || JSON.stringify(d)).join('; ')
  if (error?.diagnostic != null) return error.diagnostic?.message || JSON.stringify(error.diagnostic)
  if (error && typeof error.message === 'string') return error.message
  try { return JSON.stringify(error) } catch (_) { return String(error) }
}
window.__finish = () => emit('=== ' + ok + ' ok, ' + fail + ' fail / ' + (ok + fail) + ' total ===')
window.__error = error => { emit('THROW page -> ' + errorText(error)); emit('=== ' + ok + ' ok, ' + (fail + 1) + ' fail / ' + (ok + fail + 1) + ' total ===') }

const meaningful = (canvas, threshold = 5000) => {
  const copy = document.createElement('canvas')
  copy.width = canvas.width; copy.height = canvas.height
  const ctx = copy.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(canvas, 0, 0)
  const data = ctx.getImageData(0, 0, copy.width, copy.height).data
  let lit = 0
  for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 0) lit++
  window.__lastPixels = data
  return { lit, total: data.length / 4, data }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const loadImage = src => new Promise((resolve, reject) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error('image failed to load: ' + src))
  img.src = src
})
const sample = (data, canvas, x, y) => {
  const o = (y * canvas.width + x) * 4
  return [data[o], data[o + 1], data[o + 2], data[o + 3]]
}
`

const MODULE_PAGE_BODY = `try {
  const { DEFAULT_CDN, loadHydraEffects } = await import('./node_modules/noisemaker-for-hydra-synth/src/index.js')
  const canvas = document.createElement('canvas')
  canvas.width = 64; canvas.height = 48
  document.body.appendChild(canvas)
  const engine = await loadHydraEffects()
  const renderer = new engine.CanvasRenderer({
    canvas, basePath: DEFAULT_CDN, bundlePath: DEFAULT_CDN + '/effects',
    useBundles: true, preferWebGPU: false, autoStart: false
  })
  await renderer.loadManifest()

  // 1. README first result through the installed ESM entry.
  await renderer.compile('search hydra\\nhydraOsc(frequency: 30, sync: 0.1, offset: 0.1).write(o0)')
  renderer.pipeline.graph.renderSurface = 'o0'
  renderer.pipeline.globalUniforms.time = 0
  renderer.pipeline.globalUniforms.resolution = [64, 48]
  renderer.pipeline.render(0)
  const first = meaningful(canvas)
  check('readme_first_result', first.lit > first.total * 0.5, 'lit ' + first.lit + '/' + first.total)

  // 2. Parameter change produces different pixels.
  await renderer.compile('search hydra\\nhydraOsc(frequency: 5, sync: 0.1, offset: 0.1).write(o0)')
  renderer.pipeline.render(0)
  const second = meaningful(canvas)
  let differing = 0
  for (let i = 0; i < first.data.length; i++) if (first.data[i] !== second.data[i]) differing++
  check('frequency_change_differences', differing > 0, differing + ' differing channels')

  // 3. External image input through the installed renderer.
  // synth/media declares externalTexture "imageTex"; the pipeline binds it as
  // "imageTex_step_<index>" (verified against the engine's texture bindings).
  const img = await loadImage('./input-image.png')
  await renderer.loadEffects(['synth/media'])
  await renderer.compile('search synth\\nmedia().write(o0)')
  renderer.pipeline.graph.renderSurface = 'o0'
  renderer.pipeline.render(0)
  const uploaded = renderer.updateTextureFromSource('imageTex_step_0', img, { flipY: false })
  renderer.pipeline.render(0)
  const imageFrame = meaningful(canvas)
  const left = sample(imageFrame.data, canvas, 8, 24)
  const right = sample(imageFrame.data, canvas, 56, 24)
  const redLeft = left[0] > 150 && left[1] < 100 && left[2] < 100
  const blueRight = right[2] > 150 && right[0] < 100 && right[1] < 100
  check('external_image_input', uploaded.width === img.naturalWidth && redLeft && blueRight,
    'upload ' + JSON.stringify(uploaded) + ' left ' + left + ' right ' + right)

  // 4. Structured diagnostics identify invalid input; recovery renders.
  let diagnosticMessage = null
  try {
    await renderer.compile('search hydra\\nhydraMissing().write(o0)')
  } catch (error) {
    diagnosticMessage = errorText(error)
  }
  check('structured_diagnostics', diagnosticMessage !== null && /hydraMissing/.test(diagnosticMessage),
    String(diagnosticMessage))
  await renderer.compile('search hydra\\nhydraOsc(frequency: 30, sync: 0.1, offset: 0.1).write(o0)')
  renderer.pipeline.graph.renderSurface = 'o0'
  renderer.pipeline.globalUniforms.time = 0
  renderer.pipeline.globalUniforms.resolution = [64, 48]
  renderer.pipeline.render(0)
  const recovered = meaningful(canvas)
  check('recovery_after_invalid_input', recovered.lit > recovered.total * 0.5,
    'lit ' + recovered.lit + '/' + recovered.total)

  // 5. stop() cancels the render loop; start() resumes it. Frame scheduling
  // is observed through a requestAnimationFrame counter because virtual time
  // makes pixel-delta probes unreliable in headless capture.
  await renderer.compile('search hydra\\nhydraOsc(frequency: 30, sync: 0.1, offset: 0.1).write(o0)')
  const originalRAF = window.requestAnimationFrame
  let scheduled = 0
  window.requestAnimationFrame = cb => { scheduled++; return originalRAF(cb) }
  renderer.start()
  await sleep(80)
  const runningCount = scheduled
  renderer.stop()
  await sleep(80)
  const stoppedCount = scheduled
  renderer.start()
  await sleep(80)
  const resumedCount = scheduled
  renderer.stop()
  window.requestAnimationFrame = originalRAF
  check('start_schedules_frames', runningCount > 0, 'scheduled ' + runningCount)
  check('stop_cancels_frames', stoppedCount === runningCount, 'scheduled ' + stoppedCount + ' vs running ' + runningCount)
  check('start_resumes_frames', resumedCount > stoppedCount, 'scheduled ' + resumedCount + ' vs stopped ' + stoppedCount)

  // 6. Caller-owned canvas resize reaches both canvas and pipeline.
  await renderer.stop()
  canvas.width = 80; canvas.height = 40
  renderer.resize(80, 40)
  renderer.pipeline.globalUniforms.resolution = [80, 40]
  await renderer.compile('search hydra\\ngradient(speed: 0).write(o0)')
  renderer.pipeline.graph.renderSurface = 'o0'
  renderer.pipeline.globalUniforms.time = 0
  renderer.pipeline.globalUniforms.resolution = [80, 40]
  renderer.pipeline.render(0)
  const resized = meaningful(canvas)
  check('resize_caller_canvas', canvas.width === 80 && canvas.height === 40 && resized.lit > 0,
    canvas.width + 'x' + canvas.height + ' lit ' + resized.lit)

  // 7. Repeated create/render/dispose cycles with exact deterministic output.
  let cycleBaseline = null
  let cyclesExact = 0
  let disposeFailures = []
  for (let i = 0; i < 12; i++) {
    const c = document.createElement('canvas')
    c.width = 64; c.height = 48
    document.body.appendChild(c)
    const r = new engine.CanvasRenderer({
      canvas: c, basePath: DEFAULT_CDN, bundlePath: DEFAULT_CDN + '/effects',
      useBundles: true, preferWebGPU: false, autoStart: false
    })
    await r.loadManifest()
    await r.compile('search hydra\\nhydraOsc(frequency: 30, sync: 0.1, offset: 0.1).write(o0)')
    r.pipeline.graph.renderSurface = 'o0'
    r.pipeline.globalUniforms.time = 0
    r.pipeline.globalUniforms.resolution = [64, 48]
    r.pipeline.render(0)
    const frame = meaningful(c)
    if (cycleBaseline === null) {
      cycleBaseline = frame.data.slice()
      cyclesExact++
    } else {
      let delta = 0
      for (let j = 0; j < cycleBaseline.length; j++) if (cycleBaseline[j] !== frame.data[j]) delta++
      if (delta === 0) cyclesExact++
    }
    try { await r.dispose({ loseContext: true }) } catch (e) { disposeFailures.push(errorText(e)) }
    r.stop()
  }
  check('repeated_lifecycle_exact_cycles', cyclesExact === 12, cyclesExact + '/12 exact')
  check('repeated_lifecycle_dispose', disposeFailures.length === 0, disposeFailures.join('; '))
  window.__finish()
} catch (error) {
  window.__error(error)
}
</script></body></html>
`

const BUNDLE_PAGE_BODY = `try {
  const engine = await window.HydraEffects.loadHydraEffects()
  const canvas = document.createElement('canvas')
  canvas.width = 64; canvas.height = 48
  document.body.appendChild(canvas)
  const renderer = new engine.CanvasRenderer({
    canvas, basePath: window.HydraEffects.DEFAULT_CDN,
    bundlePath: window.HydraEffects.DEFAULT_CDN + '/effects',
    useBundles: true, preferWebGPU: false, autoStart: false
  })
  await renderer.loadManifest()
  await renderer.compile('search hydra\\nhydraOsc(frequency: 30, sync: 0.1, offset: 0.1).write(o0)')
  renderer.pipeline.graph.renderSurface = 'o0'
  renderer.pipeline.globalUniforms.time = 0
  renderer.pipeline.globalUniforms.resolution = [64, 48]
  renderer.pipeline.render(0)
  const frame = meaningful(canvas)
  check('bundle_global_readme_result', frame.lit > frame.total * 0.5, 'lit ' + frame.lit + '/' + frame.total)
  window.__finish()
} catch (error) {
  window.__error(error)
}
</script></body></html>
`

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
    const summary = parseSummary(runChromeDump(`http://127.0.0.1:${port}/${page}`))
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
