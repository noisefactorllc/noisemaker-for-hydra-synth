// Read the displayed framebuffer without a WebGL-to-2D canvas copy. Keep raw
// RGBA8 channels: equality is strict and performs no alpha conversion.
export function captureFramebuffer(canvas) {
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
  if (!gl) throw new Error('A WebGL context is required for framebuffer capture')
  if (gl.isContextLost()) throw new Error('Cannot capture a lost WebGL context')
  const attributes = gl.getContextAttributes()
  if (!attributes) throw new Error('WebGL context attributes are unavailable')
  const width = canvas.width, height = canvas.height
  if (!width || !height || gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) {
    throw new Error('Canvas and drawing-buffer dimensions must match')
  }
  const priorErrors = []
  for (;;) {
    const error = gl.getError()
    if (error === gl.NO_ERROR) break
    priorErrors.push(error)
    if (priorErrors.length === 16) throw new Error(`Cannot establish a clean capture boundary: ${priorErrors.join(',')}`)
  }
  if (priorErrors.includes(gl.CONTEXT_LOST_WEBGL ?? 37442)) {
    throw new Error('Cannot capture a context with a retained context-lost error')
  }
  const separateRead = gl.READ_FRAMEBUFFER !== undefined
  const target = separateRead ? gl.READ_FRAMEBUFFER : gl.FRAMEBUFFER
  const binding = gl.getParameter(separateRead ? gl.READ_FRAMEBUFFER_BINDING : gl.FRAMEBUFFER_BINDING)
  const drawBinding = separateRead ? gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) : undefined
  const readBuffer = separateRead ? gl.getParameter(gl.READ_BUFFER) : undefined
  const pack = [[gl.PACK_ALIGNMENT, gl.getParameter(gl.PACK_ALIGNMENT)]]
  if (separateRead) {
    for (const key of [gl.PACK_ROW_LENGTH, gl.PACK_SKIP_ROWS, gl.PACK_SKIP_PIXELS]) pack.push([key, gl.getParameter(key)])
  }
  const raw = new Uint8Array(width * height * 4)
  let defaultReadBuffer
  try {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const bits = [gl.RED_BITS, gl.GREEN_BITS, gl.BLUE_BITS, gl.ALPHA_BITS].map(key => gl.getParameter(key))
    if (bits.some((value, index) => value !== (index === 3 && !attributes.alpha ? 0 : 8))) {
      throw new Error(`Raw RGBA8 capture requires matching channel precision: ${bits.join(',')}`)
    }
    if (separateRead) {
      defaultReadBuffer = gl.getParameter(gl.READ_BUFFER)
      gl.readBuffer(gl.BACK)
    }
    for (const [key] of pack) gl.pixelStorei(key, key === gl.PACK_ALIGNMENT ? 1 : 0)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw)
    const error = gl.getError()
    if (error !== gl.NO_ERROR || gl.isContextLost()) throw new Error(`WebGL readback failed: ${error}`)
  } finally {
    if (separateRead && defaultReadBuffer !== undefined) gl.readBuffer(defaultReadBuffer)
    if (separateRead) gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawBinding)
    gl.bindFramebuffer(target, binding)
    if (separateRead) gl.readBuffer(readBuffer)
    for (const [key, value] of pack) gl.pixelStorei(key, value)
  }
  const restoredError = gl.getError()
  if (restoredError !== gl.NO_ERROR || gl.isContextLost()) throw new Error(`WebGL capture restoration failed: ${restoredError}`)
  const data = new Uint8Array(raw.length), stride = width * 4
  for (let y = 0; y < height; y++) data.set(raw.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride)
  return { data, width, height, priorErrors, alpha: attributes.alpha, premultipliedAlpha: attributes.premultipliedAlpha,
    colorSpace: gl.drawingBufferColorSpace || 'srgb' }
}

export function assertComparableFrames(actual, expected) {
  for (const key of ['width', 'height', 'alpha', 'premultipliedAlpha', 'colorSpace']) {
    if (actual[key] !== expected[key]) throw new Error(`Framebuffer ${key} differs between comparison inputs`)
  }
}
