/**
 * Shared fixtures for the GAP-002 installed developer workflow checks.
 *
 * The pages exercise the installed package through both entry points:
 * meaningful pixels, parameter change, external image input, structured
 * diagnostics and recovery, stop/start cancellation, caller-canvas resize,
 * repeated create/render/dispose cycles. The lifecycle cycle count is
 * parametrized through the `cycles` query parameter (default 12) so the
 * same page can also serve as a sustained-resource soak.
 *
 * `emit('info webgl_renderer ...')` records the host's WebGL2 renderer
 * identity without affecting the ok/fail accounting.
 */

import { deflateSync } from 'node:zlib'

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
export function encodeTestPng(width, height) {
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

// The ONLY console error the installed-workflow pages exempt from
// no_unexpected_console_errors: the complete expected S001 diagnostic.
// Anchored at both ends with bounded numeric fields, so any other
// recompilation failure — or this diagnostic with extra appended text —
// is captured and fails the workflow. Serialized into the page body so
// the page and this predicate share one implementation.
export const isExpectedS001Diagnostic = m =>
  /^Recompilation failed: Unknown effect: 'hydraMissing'; write\(\) requires an input - cannot be first in chain: '\[Write\]' \(line \d+, col \d+\)$/.test(m)

export function pageHtml(preload) {
  return `<!DOCTYPE html>
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
{
  const probe = document.createElement('canvas')
  const gl = probe.getContext('webgl2')
  const ext = gl && gl.getExtension('WEBGL_debug_renderer_info')
  emit('info webgl_renderer ' + (gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'unavailable'))
  if (gl) {
    // The probe context is transient: lose it and detach the canvas so it
    // does not count against the browser's active-context limit for the rest
    // of the run.
    gl.getExtension('WEBGL_lose_context').loseContext()
    probe.remove()
  }
}
const errorText = error => {
  if (Array.isArray(error?.diagnostics) && error.diagnostics.length > 0) return error.diagnostics.map(d => d?.message || JSON.stringify(d)).join('; ')
  if (error?.diagnostic != null) return error.diagnostic?.message || JSON.stringify(error.diagnostic)
  if (error && typeof error.message === 'string') return error.message
  try { return JSON.stringify(error) } catch (_) { return String(error) }
}
window.__finish = () => emit('=== ' + ok + ' ok, ' + fail + ' fail / ' + (ok + fail) + ' total ===')
window.__error = error => { emit('THROW page -> ' + errorText(error)); emit('=== ' + ok + ' ok, ' + (fail + 1) + ' fail / ' + (ok + fail + 1) + ' total ===') }

// One shared 2d canvas serves every pixel readback: creating a fresh 2d
// canvas + context per call retains one extra context per call (the browser
// never reclaims them mid-run), which doubles the page's active-context
// count under sustained soaks and triggers WebKit's forced evictions.
const shared2d = document.createElement('canvas')
const shared2dCtx = shared2d.getContext('2d', { willReadFrequently: true })
const meaningful = (canvas, threshold = 5000) => {
  shared2d.width = canvas.width; shared2d.height = canvas.height
  shared2dCtx.drawImage(canvas, 0, 0)
  const data = shared2dCtx.getImageData(0, 0, shared2d.width, shared2d.height).data
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
}

export const MODULE_PAGE_BODY = `try {
  // Unexpected-error capture: every console.error other than the expected
  // S001 recompilation diagnostic is collected, and unplanned WebGL context
  // losses (a context evicted before this page chose to lose it) are
  // recorded from the webglcontextlost events native eviction notices fire —
  // both checks fail the workflow on resource exhaustion or unexpected
  // engine errors.
  const unexpectedErrors = []
  const consoleError = console.error.bind(console)
  const isExpectedS001 = ${String(isExpectedS001Diagnostic)}
  console.error = (...a) => {
    const m = a.map(String).join(' ')
    // The expected S001 diagnostic is the ONLY exempt console error; any
    // other recompilation failure — or that diagnostic with extra text —
    // is captured and fails no_unexpected_console_errors.
    if (!isExpectedS001(m)) unexpectedErrors.push(m)
    consoleError(...a)
  }
  const { DEFAULT_CDN, loadHydraEffects } = await import('./node_modules/noisemaker-for-hydra-synth/src/index.js')
  const canvas = document.createElement('canvas')
  canvas.width = 64; canvas.height = 48
  document.body.appendChild(canvas)
  // Unplanned WebGL context losses: a context evicted by the browser before
  // this page's own loseContext call (native eviction notices fire
  // webglcontextlost) is recorded; dispose() marks the canvas just before
  // losing its context so the planned loss is not counted.
  const contextLosses = []
  const trackContextLoss = c => {
    c.addEventListener('webglcontextlost', () => {
      if (!c.dataset.losing) contextLosses.push(c === canvas ? 'main canvas' : 'cycle canvas')
    })
  }
  trackContextLoss(canvas)
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
  // The cycle count is set by the 'cycles' query parameter (default 12); a
  // high count doubles as a sustained-resource soak.
  const CYCLES = Number(new URLSearchParams(location.search).get('cycles')) || 12
  let cycleBaseline = null
  let cyclesExact = 0
  let disposeFailures = []
  for (let i = 0; i < CYCLES; i++) {
    const c = document.createElement('canvas')
    c.width = 64; c.height = 48
    document.body.appendChild(c)
    trackContextLoss(c)
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
    c.dataset.losing = '1'
    try { await r.dispose({ loseContext: true }) } catch (e) { disposeFailures.push(errorText(e)) }
    r.stop()
    // Remove the cycle canvas: a canvas still attached to the DOM is never
    // garbage-collected, so its WebGL context counts against the browser's
    // active-context limit and later cycles get force-evicted ("too many
    // active WebGL contexts"). Detach after dispose, then settle so the
    // browser can reclaim the context before the next cycle creates one —
    // WebKit in particular only reclaims lost contexts at GC, which needs
    // an event-loop turn.
    c.remove()
    await sleep(120)
  }
  check('repeated_lifecycle_exact_cycles', cyclesExact === CYCLES, cyclesExact + '/' + CYCLES + ' exact')
  check('repeated_lifecycle_dispose', disposeFailures.length === 0, disposeFailures.join('; '))
  check('no_unexpected_console_errors', unexpectedErrors.length === 0, unexpectedErrors.slice(0, 3).join('; '))
  check('no_forced_context_loss', contextLosses.length === 0, contextLosses.join('; '))
  window.__finish()
} catch (error) {
  window.__error(error)
}
</script></body></html>
`

export const BUNDLE_PAGE_BODY = `try {
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

export function parseSummary(text) {
  const summaryMatch = text.match(/===\s*(\d+)\s*ok,\s*(\d+)\s*fail/)
  const failures = [...text.matchAll(/^(?:FAIL|THROW)\s+([^\n]+)/gm)].map(m => m[1].trim())
  const renderer = text.match(/^info webgl_renderer (.+)$/m)
  if (!summaryMatch) return { ok: 0, fail: failures.length + 1, failures, renderer: renderer?.[1]?.trim() ?? null }
  return {
    ok: parseInt(summaryMatch[1], 10),
    fail: parseInt(summaryMatch[2], 10),
    failures,
    renderer: renderer?.[1]?.trim() ?? null
  }
}

// Parse a Chromium --dump-dom capture: extract the #log element text first.
export function parseDomSummary(domText) {
  const logMatch = domText.match(/<div id="log">([\s\S]*?)<\/div>\s*<script/)
  if (!logMatch) return { ok: 0, fail: 1, failures: ['no #log div in DOM'], renderer: null }
  return parseSummary(logMatch[1].replace(/<[^>]*>/g, '\n'))
}
