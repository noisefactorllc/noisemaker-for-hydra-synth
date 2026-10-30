export function describeBrowserError(error) {
  if (error === null || typeof error !== 'object') return String(error)
  const details = {}
  for (const key of new Set(['name', 'message', 'stack', ...Object.getOwnPropertyNames(error)])) {
    let value
    try { value = error[key] } catch { continue }
    if (value === undefined) continue
    try { details[key] = JSON.parse(JSON.stringify(value)) } catch { details[key] = String(value) }
  }
  return details
}

export function installBrowserDiagnostics(target = window) {
  target.__parityStage = 'initialization'
  target.__parityDiagnostics = []
  const record = entry => target.__parityDiagnostics.push({ stage: target.__parityStage, ...entry })
  const canvasPrototype = target.HTMLCanvasElement?.prototype
  if (canvasPrototype) {
    const originalGetContext = canvasPrototype.getContext
    const contexts = new WeakMap()
    let nextContextId = 0
    canvasPrototype.getContext = function(...args) {
      const context = originalGetContext.apply(this, args)
      if (context && (args[0] === 'webgl' || args[0] === 'webgl2') && !contexts.has(context)) {
        const id = ++nextContextId
        contexts.set(context, id)
        record({ kind: 'context.created', id, type: args[0], width: this.width, height: this.height,
          requested: args[1], actual: context.getContextAttributes(), lost: context.isContextLost(), stack: new Error().stack })
        this.addEventListener('webglcontextlost', event => record({ kind: 'context.lost', id, statusMessage: event.statusMessage }))
      }
      return context
    }
  }
  for (const kind of ['error', 'warn']) {
    const original = target.console[kind].bind(target.console)
    target.console[kind] = (...args) => {
      record({ kind: `console.${kind}`, args: args.map(describeBrowserError) })
      original(...args)
    }
  }
  target.addEventListener('error', event => record({ kind: 'error', error: describeBrowserError(event.error || event.message) }))
  target.addEventListener('unhandledrejection', event => record({ kind: 'unhandledrejection', error: describeBrowserError(event.reason) }))
}

export function probeWebGLContexts() {
  const canvases = []
  const measurements = []
  for (const antialias of [undefined, false]) {
    for (const visibility of ['visible', 'hidden']) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 64
      canvas.style.display = visibility === 'visible' ? 'block' : 'none'
      document.body.appendChild(canvas)
      canvases.push(canvas)
      const requested = { preserveDrawingBuffer: true }
      if (antialias !== undefined) requested.antialias = antialias
      const gl = canvas.getContext('webgl2', requested)
      const result = { visibility, requested, created: Boolean(gl) }
      measurements.push(result)
      if (!gl) continue
      result.actual = gl.getContextAttributes()
      result.contextLostBefore = gl.isContextLost()
      result.extensions = gl.getSupportedExtensions()
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      result.renderer = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)
      const vertex = gl.createShader(gl.VERTEX_SHADER)
      const fragment = gl.createShader(gl.FRAGMENT_SHADER)
      const program = gl.createProgram()
      const buffer = gl.createBuffer()
      try {
        gl.shaderSource(vertex, '#version 300 es\nprecision highp float;\nin vec2 a_position;\nout vec2 v_texCoord;\nvoid main(){v_texCoord=a_position*0.5+0.5;gl_Position=vec4(a_position,0.0,1.0);}')
        gl.shaderSource(fragment, '#version 300 es\nprecision highp float;\nout vec4 color;\nvoid main(){color=vec4(1.0,0.0,0.0,1.0);}')
        gl.compileShader(vertex)
        gl.compileShader(fragment)
        result.vertexCompiled = gl.getShaderParameter(vertex, gl.COMPILE_STATUS)
        result.vertexLog = gl.getShaderInfoLog(vertex)
        result.fragmentCompiled = gl.getShaderParameter(fragment, gl.COMPILE_STATUS)
        result.fragmentLog = gl.getShaderInfoLog(fragment)
        gl.attachShader(program, vertex)
        gl.attachShader(program, fragment)
        gl.linkProgram(program)
        result.linked = gl.getProgramParameter(program, gl.LINK_STATUS)
        result.programLog = gl.getProgramInfoLog(program)
        gl.useProgram(program)
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
        const position = gl.getAttribLocation(program, 'a_position')
        gl.enableVertexAttribArray(position)
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
        gl.viewport(0, 0, 64, 64)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        gl.finish()
        const pixel = new Uint8Array(4)
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
        result.pixel = Array.from(pixel)
        result.error = gl.getError()
      } catch (error) {
        result.exception = { name: error?.name, message: error?.message, stack: error?.stack }
      } finally {
        result.contextLostAfter = gl.isContextLost()
        gl.deleteBuffer(buffer)
        gl.deleteProgram(program)
        gl.deleteShader(vertex)
        gl.deleteShader(fragment)
      }
    }
  }
  for (const canvas of canvases) canvas.remove()
  return { userAgent: navigator.userAgent, measurements }
}

export async function probeNativeEngine({ mode, basePath }) {
  const result = { mode, userAgent: navigator.userAgent }
  let renderer, backend, canvas, probe, legacy, legacyCanvas
  const readback2d = (source, gl, willReadFrequently = true) => {
    const width = source.width, height = source.height
    const before = new Uint8Array(width * height * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, before)
    const result = { beforeLost: gl.isContextLost(), beforeError: gl.getError(), beforePixel: Array.from(before.slice(0, 4)) }
    const copy = document.createElement('canvas')
    copy.width = width; copy.height = height
    const context = copy.getContext('2d', { willReadFrequently })
    result.requested2d = { willReadFrequently }
    result.actual2d = context.getContextAttributes?.()
    context.drawImage(source, 0, 0)
    result.afterDrawLost = gl.isContextLost()
    const data = context.getImageData(0, 0, width, height).data
    result.afterGetImageLost = gl.isContextLost()
    const after = new Uint8Array(before.length)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, after)
    result.afterError = gl.getError()
    result.afterPixel = Array.from(after.slice(0, 4))
    result.copiedBottomPixel = Array.from(data.slice((height - 1) * width * 4, (height - 1) * width * 4 + 4))
    result.changedGLBytes = before.reduce((count, value, i) => count + (value !== after[i]), 0)
    result.differingCopyBytes = before.reduce((count, value, i) => {
      const row = Math.floor(i / (width * 4)), column = i % (width * 4)
      return count + (value !== data[(height - row - 1) * width * 4 + column])
    }, 0)
    return result
  }
  try {
    let engine = await import(`${basePath}/noisemaker-shaders-core.esm.min.js`)
    if (mode.startsWith('legacy-')) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = '/dev-noisemaker/.legacy-hydra-synth.js'
        script.onload = resolve
        script.onerror = () => reject(new Error('Legacy authority script failed to load'))
        document.head.appendChild(script)
      })
      legacyCanvas = document.createElement('canvas')
      legacyCanvas.width = legacyCanvas.height = 64
      legacyCanvas.style.display = 'none'
      document.body.appendChild(legacyCanvas)
      window.__parityStage = 'legacy-create'
      legacy = new window.Hydra({ canvas: legacyCanvas, width: 64, height: 64,
        makeGlobal: false, autoLoop: false, detectAudio: false, enableStreamCapture: false, precision: 'highp' })
      window.__parityStage = 'legacy-noise-render'
      legacy.synth.time = 0
      legacy.synth.noise(10, 0.1).out(legacy.o[0])
      legacy.tick(0)
      const gl = legacyCanvas.getContext('webgl')
      gl.finish()
      result.legacy = { lost: gl.isContextLost(), actual: gl.getContextAttributes(), error: gl.getError() }
      if (mode.startsWith('legacy-readback-native')) {
        window.__parityStage = 'legacy-2d-readback'
        result.readback = readback2d(legacyCanvas, gl, !mode.endsWith('-gpu'))
      }
      if (mode === 'legacy-only') {
        await new Promise(resolve => setTimeout(resolve, 100))
        result.legacy.settledLost = gl.isContextLost()
        return result
      }
    }
    if (mode.startsWith('hydra-')) {
      window.__parityStage = 'hydra-registration'
      const port = await import('/src/index.js')
      engine = await port.loadHydraEffects({ engine })
    }
    if (mode.startsWith('probe-')) {
      probe = document.createElement('canvas')
      const context = probe.getContext('webgl2')
      result.probeCreated = Boolean(context)
      if (!context) throw new Error('Probe context unavailable')
      if (mode !== 'probe-retained') {
        const lost = new Promise(resolve => probe.addEventListener('webglcontextlost', resolve, { once: true }))
        context.getExtension('WEBGL_lose_context').loseContext()
        if (mode === 'probe-lost-settled') {
          await Promise.race([lost, new Promise((_, reject) => setTimeout(() => reject(new Error('Probe loss event timed out')), 5000))])
        }
      }
    }
    canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    canvas.style.display = 'none'
    document.body.appendChild(canvas)
    if (mode === 'backend-init' || mode === 'mrt-only') {
      const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })
      result.before = { lost: gl.isContextLost(), actual: gl.getContextAttributes() }
      backend = new engine.WebGL2Backend(gl, canvas)
      if (mode === 'mrt-only') {
        result.floatExtension = Boolean(gl.getExtension('EXT_color_buffer_float'))
        result.byteBudget = backend.probeColorBytesPerSample()
      } else {
        await backend.init()
      }
      await new Promise(resolve => setTimeout(resolve, 100))
      result.after = { lost: gl.isContextLost(), actual: gl.getContextAttributes(), error: gl.getError() }
    } else {
      window.__parityStage = 'native-create'
      if (mode.startsWith('hydra-osc')) canvas.height = 48
      const dimensions = mode === 'hydra-osc-implicit' ? {} : { width: canvas.width, height: canvas.height }
      result.dimensions = { canvas: [canvas.width, canvas.height], options: dimensions }
      renderer = new engine.CanvasRenderer({ canvas, ...dimensions,
        basePath, bundlePath: `${basePath}/effects`, useBundles: true, preferWebGPU: false, autoStart: false })
      await renderer.loadManifest()
      const source = mode === 'hydra-noise' ? 'search hydra\nnoise(scale: 10, offset: 0.1).write(o0)'
        : mode.startsWith('hydra-osc') ? 'search hydra\nhydraOsc(frequency: 30, sync: 0.1, offset: 0.1).write(o0)'
          : 'search synth\nsolid(color: #ff0000).write(o0)'
      result.source = source
      if (!mode.startsWith('hydra-')) await renderer.loadEffects(['synth/solid'])
      window.__parityStage = 'native-compile'
      await renderer.compile(source)
      renderer.pipeline.graph.renderSurface = 'o0'
      renderer.pipeline.globalUniforms.time = 0
      renderer.pipeline.globalUniforms.resolution = [canvas.width, canvas.height]
      window.__parityStage = 'native-render'
      renderer.pipeline.render(0)
      const gl = renderer.pipeline.backend.gl
      gl.finish()
      const pixel = new Uint8Array(4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
      result.pixel = Array.from(pixel)
      result.immediate = { lost: gl.isContextLost(), actual: gl.getContextAttributes(), error: gl.getError() }
      if (mode.startsWith('native-readback')) {
        window.__parityStage = 'native-2d-readback'
        result.readback = readback2d(canvas, gl, !mode.endsWith('-gpu'))
      }
      await new Promise(resolve => setTimeout(resolve, 100))
      result.settledLost = gl.isContextLost()
    }
  } catch (error) {
    result.exception = { name: error?.name, message: error?.message, stack: error?.stack }
  } finally {
    result.diagnostics = window.__parityDiagnostics || []
    try { await renderer?.dispose() } catch (error) { result.cleanupError = String(error) }
    try { backend?.destroy() } catch (error) { result.cleanupError = String(error) }
    try { legacy?.regl?.destroy() } catch (error) { result.cleanupError = String(error) }
    legacyCanvas?.remove()
    canvas?.remove()
    probe?.remove()
  }
  return result
}
