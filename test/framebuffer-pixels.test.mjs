import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureFramebuffer, assertComparableFrames } from '../scripts/framebuffer-pixels.mjs'

function fixture({ webgl2 = true, lost = false, error = 0, errors } = {}) {
  const calls = [], state = new Map([[1, 'previous-framebuffer'], [2, 8], [3, 7], [4, 2], [5, 1], [6, 9],
    [7, 'previous-draw-framebuffer'], [16, 8], [17, 8], [18, 8], [19, 8]])
  const readModes = new Map([[null, 0], ['previous-framebuffer', 9]])
  const gl = {
    FRAMEBUFFER: 10, FRAMEBUFFER_BINDING: webgl2 ? 7 : 1, PACK_ALIGNMENT: 2,
    RED_BITS: 16, GREEN_BITS: 17, BLUE_BITS: 18, ALPHA_BITS: 19,
    RGBA: 11, UNSIGNED_BYTE: 12, NO_ERROR: 0, CONTEXT_LOST_WEBGL: 37442,
    drawingBufferWidth: 2, drawingBufferHeight: 2, drawingBufferColorSpace: 'srgb',
    isContextLost: () => lost,
    getContextAttributes: () => ({ alpha: true, premultipliedAlpha: true }),
    getParameter: key => webgl2 && key === 6 ? readModes.get(state.get(1)) : state.get(key),
    bindFramebuffer: (target, value) => {
      calls.push(['bind', target, value])
      if (target !== 15) state.set(1, value)
      if (webgl2 && target !== 13) state.set(7, value)
    },
    pixelStorei: (key, value) => { calls.push(['pack', key, value]); state.set(key, value) },
    getError: () => errors ? (errors.shift() ?? 0) : error,
    readPixels: (...args) => {
      calls.push(['read', ...args.slice(0, 6)])
      assert.equal(state.get(1), null)
      assert.equal(state.get(2), 1)
      if (webgl2) {
        assert.equal(readModes.get(null), gl.BACK)
        for (const key of [gl.PACK_ROW_LENGTH, gl.PACK_SKIP_ROWS, gl.PACK_SKIP_PIXELS]) assert.equal(state.get(key), 0)
      }
      args[6].set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    },
  }
  if (webgl2) Object.assign(gl, {
    READ_FRAMEBUFFER: 13, READ_FRAMEBUFFER_BINDING: 1, READ_BUFFER: 6, BACK: 14,
    DRAW_FRAMEBUFFER: 15, DRAW_FRAMEBUFFER_BINDING: 7,
    PACK_ROW_LENGTH: 3, PACK_SKIP_ROWS: 4, PACK_SKIP_PIXELS: 5,
    readBuffer: value => readModes.set(state.get(1), value),
  })
  const canvas = { width: 2, height: 2, getContext: name => {
    calls.push(['context', name])
    if (name === (webgl2 ? 'webgl2' : 'webgl')) return gl
    assert.notEqual(name, '2d', 'framebuffer capture must not copy through a 2D canvas')
    return null
  } }
  return { canvas, gl, calls, state, readModes }
}

for (const webgl2 of [false, true]) test(`raw ${webgl2 ? 'WebGL2' : 'WebGL'} capture preserves bytes and restores state`, () => {
  const f = fixture({ webgl2 }), before = new Map(f.state)
  const frame = captureFramebuffer(f.canvas)
  assert.deepEqual([...frame.data], [9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8])
  assert.equal(frame.premultipliedAlpha, true)
  assert.equal(frame.colorSpace, 'srgb')
  assert.deepEqual(f.state, before)
  assert.equal(f.calls.filter(call => call[0] === 'read').length, 1)
})

test('lost contexts, uncleared GL errors and wrong buffer dimensions cannot produce parity evidence', () => {
  assert.throws(() => captureFramebuffer(fixture({ lost: true }).canvas), /lost/i)
  assert.throws(() => captureFramebuffer(fixture({ error: 1282 }).canvas), /1282/)
  const f = fixture(); f.gl.drawingBufferWidth = 3
  assert.throws(() => captureFramebuffer(f.canvas), /dimensions/i)
})

test('pre-existing pipeline errors are retained separately from successful capture', () => {
  const frame = captureFramebuffer(fixture({ errors: [1282, 1280, 0] }).canvas)
  assert.deepEqual(frame.priorErrors, [1282, 1280])
  assert.deepEqual([...frame.data], [9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8])
})

test('new capture and restoration errors cannot produce parity evidence', () => {
  assert.throws(() => captureFramebuffer(fixture({ errors: [0, 1282] }).canvas), /readback|1282/i)
  const f = fixture(), original = f.gl.pixelStorei
  let error = 0
  f.gl.getError = () => { const current = error; error = 0; return current }
  f.gl.pixelStorei = (key, value) => {
    original(key, value)
    if (key === f.gl.PACK_ALIGNMENT && value === 8) error = 1282
  }
  assert.throws(() => captureFramebuffer(f.canvas), /restor|1282/i)
})

test('capture restores framebuffer and pack state when readback fails', () => {
  const f = fixture(), before = new Map(f.state)
  const modes = new Map(f.readModes)
  f.gl.readPixels = () => { throw new Error('readback failure') }
  assert.throws(() => captureFramebuffer(f.canvas), /readback failure/)
  assert.deepEqual(f.state, before)
  assert.deepEqual(f.readModes, modes)
})

test('capture preserves the default read-buffer mode while another framebuffer is bound', () => {
  const f = fixture(), before = new Map(f.readModes)
  captureFramebuffer(f.canvas)
  assert.deepEqual(f.readModes, before)
})

test('floating-point drawing buffers cannot masquerade as raw RGBA8 evidence', () => {
  const f = fixture(); f.state.set(f.gl.RED_BITS, 16)
  const before = new Map(f.state)
  assert.throws(() => captureFramebuffer(f.canvas), /channel|RGBA8/i)
  assert.deepEqual(f.state, before)
})

test('equal raw bytes require matching alpha and color interpretation', () => {
  const frame = captureFramebuffer(fixture().canvas)
  assert.doesNotThrow(() => assertComparableFrames(frame, { ...frame }))
  for (const [key, value] of [['alpha', false], ['premultipliedAlpha', false], ['colorSpace', 'display-p3'], ['width', 3]]) {
    assert.throws(() => assertComparableFrames(frame, { ...frame, [key]: value }), new RegExp(key))
  }
})

test('a restored context with a retained loss error cannot produce parity evidence', () => {
  const f = fixture({ errors: [37442, 0] })
  assert.equal(f.gl.isContextLost(), false)
  assert.throws(() => captureFramebuffer(f.canvas), /context.*lost|lost.*context/i)
  assert.equal(f.calls.filter(call => call[0] === 'read').length, 0)
})

test('context loss during readback or restoration cannot produce parity evidence', () => {
  for (const stage of ['readback', 'restoration']) {
    const f = fixture(), before = new Map(f.state), modes = new Map(f.readModes)
    let lost = false
    f.gl.isContextLost = () => lost
    if (stage === 'readback') {
      const read = f.gl.readPixels
      f.gl.readPixels = (...args) => { read(...args); lost = true }
    } else {
      const pack = f.gl.pixelStorei
      f.gl.pixelStorei = (key, value) => {
        pack(key, value)
        if (key === f.gl.PACK_ALIGNMENT && value === 8) lost = true
      }
    }
    assert.throws(() => captureFramebuffer(f.canvas), /readback|restoration/i)
    assert.deepEqual(f.state, before)
    assert.deepEqual(f.readModes, modes)
  }
})
