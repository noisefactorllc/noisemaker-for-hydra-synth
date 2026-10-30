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
