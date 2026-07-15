import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import * as extension from '../src/index.js'

function fakeEngine() {
  const calls = []
  class Effect {
    constructor(spec) { Object.assign(this, spec) }
  }
  class CanvasRenderer {
    async compile() { return null }
  }
  return {
    calls,
    Effect,
    CanvasRenderer,
    compile() { return { plans: [] } },
    registerNamespace(name, descriptor) {
      calls.push(['namespace', name, descriptor])
    },
    registerEffect(key, definition) {
      calls.push(['effect', key, definition])
    },
    registerOp(key, spec) {
      calls.push(['op', key, spec])
    },
    registerStarterOps(keys) {
      calls.push(['starter', keys])
    },
    isStarterEffect({ instance }) {
      return instance.tags?.includes('src') || false
    }
  }
}

test('exports a native effect registrar without a Hydra renderer default', () => {
  assert.equal(typeof extension.registerHydraEffects, 'function')
  assert.equal(typeof extension.loadHydraEffects, 'function')
  assert.equal(typeof extension.loadEngine, 'function')
  assert.equal('default' in extension, false)
  assert.equal('HydraRenderer' in extension, false)
})

test('registers the hydra namespace before native effects', () => {
  const engine = fakeEngine()
  const originalCompile = engine.CanvasRenderer.prototype.compile

  const result = extension.registerHydraEffects(engine)

  assert.equal(result, engine)
  assert.deepEqual(engine.calls[0], [
    'namespace',
    'hydra',
    { description: 'Hydra effects ported to the Noisemaker engine' }
  ])
  const effects = engine.calls.filter(([kind]) => kind === 'effect')
  assert.ok(effects.length > 0)
  assert.ok(effects.every(([, , definition]) => definition.namespace === 'hydra'))
  assert.ok(effects.every(([, , definition]) => definition.func !== 'sum'))
  assert.ok(effects.every(([, , definition]) => (
    definition.textures?.out?.format === 'rgba32f'
  )))
  assert.ok(effects.every(([, , definition]) => (
    definition.passes[0].outputs.fragColor === 'outputTex'
  )))
  assert.ok(engine.calls.some(([kind, key, spec]) => (
    kind === 'op' && key === 'hydra.hydraOsc' && spec.name === 'hydraOsc'
  )))
  const modulate = engine.calls.find(([kind, key]) => (
    kind === 'op' && key === 'hydra.modulate'
  ))[2]
  assert.ok(modulate.args.some(arg => arg.name === 'tex' && arg.type === 'surface'))
  const src = effects.find(([, , definition]) => definition.func === 'src')[2]
  const prev = effects.find(([, , definition]) => definition.func === 'prev')[2]
  assert.match(src.shaders.src.glsl, /texture\(tex, fract\(vec2\(_st\.x, 1\.0 - _st\.y\)\)\)/)
  assert.match(prev.shaders.prev.glsl, /texture\(prevBuffer, fract\(vec2\(_st\.x, 1\.0 - _st\.y\)\)\)/)
  assert.notEqual(engine.CanvasRenderer.prototype.compile, originalCompile)
})

test('rejects an engine without namespace registration support', () => {
  const engine = fakeEngine()
  delete engine.registerNamespace

  assert.throws(
    () => extension.registerHydraEffects(engine),
    /registerNamespace/
  )
})

test('does not expose an unfused custom-effect registration path', () => {
  const source = readFileSync('src/index.js', 'utf8')

  assert.doesNotMatch(source, /extraEffects/)
})
