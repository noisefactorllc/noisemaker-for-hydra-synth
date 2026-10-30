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
