import test from 'node:test'
import assert from 'node:assert/strict'
import { describeBrowserError, installBrowserDiagnostics } from '../scripts/browser-diagnostics.mjs'

test('empty-message errors retain their type and stack', () => {
  const error = new Error('')
  error.name = 'OperationError'
  error.stack = 'compile@shader.js:42:7'
  assert.deepEqual(describeBrowserError(error), {
    name: 'OperationError', message: '', stack: 'compile@shader.js:42:7'
  })
})

test('browser diagnostics preserve console behavior and capture the failing stage', () => {
  const events = new Map(), calls = []
  const target = { console: {
    error: (...args) => calls.push(args), warn: (...args) => calls.push(args)
  }, addEventListener: (name, fn) => events.set(name, fn) }
  installBrowserDiagnostics(target)
  target.__parityStage = 'render noise_src'
  const error = new Error('shader failed')
  target.console.error('compile', error)
  events.get('unhandledrejection')({ reason: error })
  assert.deepEqual(calls, [['compile', error]])
  assert.equal(target.__parityDiagnostics[0].stage, 'render noise_src')
  assert.equal(target.__parityDiagnostics[0].args[1].message, 'shader failed')
  assert.equal(target.__parityDiagnostics[1].kind, 'unhandledrejection')
  assert.equal(target.__parityDiagnostics[1].error.stack, error.stack)
})

test('context diagnostics retain actual attributes and loss without replacing the context', () => {
  const listeners = new Map()
  const context = { getContextAttributes: () => ({ antialias: true }), isContextLost: () => false }
  class Canvas {
    constructor() { this.width = 64; this.height = 48 }
    getContext() { return context }
    addEventListener(name, fn) { listeners.set(name, fn) }
  }
  const target = { HTMLCanvasElement: Canvas, console: { error() {}, warn() {} }, addEventListener() {} }
  installBrowserDiagnostics(target)
  const canvas = new Canvas()
  assert.equal(canvas.getContext('webgl2', { preserveDrawingBuffer: true }), context)
  assert.equal(canvas.getContext('webgl2'), context)
  assert.equal(target.__parityDiagnostics.length, 1)
  assert.deepEqual(target.__parityDiagnostics[0].actual, { antialias: true })
  listeners.get('webglcontextlost')({ statusMessage: 'test loss' })
  assert.equal(target.__parityDiagnostics[1].kind, 'context.lost')
  assert.equal(target.__parityDiagnostics[1].id, target.__parityDiagnostics[0].id)
})
