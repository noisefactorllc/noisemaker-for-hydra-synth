import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

test('browser bundle exposes HydraEffects without a Hydra renderer global', () => {
  execFileSync('node', ['scripts/build.mjs'], {
    cwd: process.cwd(),
    stdio: 'pipe'
  })

  const source = readFileSync('dist/hydra-synth.js', 'utf8')
  const context = { console }
  context.window = context
  vm.runInNewContext(source, context)

  assert.equal(typeof context.HydraEffects?.registerHydraEffects, 'function')
  assert.equal('Hydra' in context, false)
})
