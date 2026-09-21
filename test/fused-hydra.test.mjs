import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildHydraShaderOverrides,
  installHydraCompiler
} from '../src/engine/fuseHydraPlan.js'

function compiledPlan(chain, write = 'o0') {
  return {
    plans: [{
      chain: chain.concat({
        op: '_write',
        args: { tex: { kind: 'output', name: write } },
        from: chain.at(-1).temp,
        temp: chain.at(-1).temp + 1,
        builtin: true
      }),
      write: { kind: 'output', name: write }
    }]
  }
}

test('fuses coordinate effects into their upstream Hydra source', () => {
  const compiled = compiledPlan([
    {
      op: 'hydra.gradient',
      args: { speed: 0 },
      from: null,
      temp: 0
    },
    {
      op: 'hydra.rotate',
      args: { angle: 0.3, speed: 0 },
      from: 0,
      temp: 1
    }
  ])

  const result = buildHydraShaderOverrides(compiled)
  const shader = result.shaderOverrides[1].rotate.glsl

  assert.deepEqual(result.outputSurfaces, ['o0'])
  assert.match(shader, /return _hydra_node_0\(_hydra_rotate\(_st, 0\.3, 0\.0\)\);/)
  assert.match(shader, /fragColor = _hydra_node_1\(_st\);/)
})

test('fuses nested Hydra inputs for combine-coordinate effects', () => {
  const compiled = compiledPlan([
    {
      op: 'hydra.gradient',
      args: { speed: 0 },
      from: null,
      temp: 0
    },
    {
      op: 'hydra.gradient',
      args: { speed: 0 },
      from: null,
      temp: 1
    },
    {
      op: 'hydra.modulate',
      args: { tex: { kind: 'temp', index: 1 }, amount: 0.1 },
      from: 0,
      temp: 2
    }
  ])

  const result = buildHydraShaderOverrides(compiled)
  const shader = result.shaderOverrides[2].modulate.glsl

  assert.match(
    shader,
    /return _hydra_node_0\(_hydra_modulate\(_st, _hydra_node_1\(_st\), 0\.1\)\);/
  )
})

test('does not override mixed Noisemaker and Hydra trees', () => {
  const compiled = compiledPlan([
    {
      op: 'synth.perlin',
      args: {},
      from: null,
      temp: 0
    },
    {
      op: 'hydra.brightness',
      args: { amount: 0.2 },
      from: 0,
      temp: 1
    }
  ])

  assert.deepEqual(buildHydraShaderOverrides(compiled), {
    shaderOverrides: {},
    outputSurfaces: ['o0']
  })
})

test('does not promote an external surface that Hydra only reads', () => {
  const compiled = compiledPlan([
    {
      op: 'hydra.src',
      args: { tex: { kind: 'output', name: 'o1' } },
      from: null,
      temp: 0
    }
  ])

  assert.deepEqual(buildHydraShaderOverrides(compiled), {
    shaderOverrides: {},
    outputSurfaces: ['o0'],
    retainSurfaces: ['o1']
  })
})

test('preserves an output when Hydra reads its previous contents', () => {
  const compiled = compiledPlan([
    {
      op: 'hydra.prev',
      args: {},
      from: null,
      temp: 0
    }
  ])

  const result = buildHydraShaderOverrides(compiled)

  assert.deepEqual(result.outputSurfaces, ['o0'])
  assert.deepEqual(result.preserveSurfaces, ['o0'])
  assert.ok(result.shaderOverrides[0].prev)
})

test('preserves an output when Hydra samples that same external surface', () => {
  const compiled = compiledPlan([
    {
      op: 'hydra.src',
      args: { tex: { kind: 'output', name: 'o0' } },
      from: null,
      temp: 0
    }
  ])

  assert.deepEqual(buildHydraShaderOverrides(compiled), {
    shaderOverrides: {},
    outputSurfaces: ['o0'],
    preserveSurfaces: ['o0'],
    retainSurfaces: ['o0']
  })
})

test('retains a previously promoted surface read by a native plan', () => {
  const compiled = compiledPlan([
    {
      op: '_read',
      args: { tex: { kind: 'output', name: 'o1' } },
      from: null,
      temp: 0,
      builtin: true
    }
  ])

  assert.deepEqual(buildHydraShaderOverrides(compiled), {
    shaderOverrides: {},
    outputSurfaces: [],
    retainSurfaces: ['o1']
  })
})

test('retains native surface arguments even when the final node is not Hydra', () => {
  const compiled = compiledPlan([
    {
      op: 'filter.example',
      args: { tex: { kind: 'output', name: 'o1' } },
      from: null,
      temp: 0
    }
  ])

  assert.deepEqual(buildHydraShaderOverrides(compiled), {
    shaderOverrides: {},
    outputSurfaces: [],
    retainSurfaces: ['o1']
  })
})

test('preserves implicit prev feedback when the final node is native', () => {
  const compiled = compiledPlan([
    {
      op: 'hydra.prev',
      args: {},
      from: null,
      temp: 0
    },
    {
      op: 'filter.example',
      args: {},
      from: 0,
      temp: 1
    }
  ])

  assert.deepEqual(buildHydraShaderOverrides(compiled), {
    shaderOverrides: {},
    outputSurfaces: [],
    preserveSurfaces: ['o0'],
    retainSurfaces: ['o0']
  })
})

test('binds animated parameters into a fused shader without sampling passes', () => {
  const oscillator = {
    type: 'Oscillator',
    oscType: 0,
    min: 0.2,
    max: 0.4,
    speed: 1,
    offset: 0,
    seed: 1
  }
  const compiled = compiledPlan([
    {
      op: 'hydra.gradient',
      args: { speed: 0 },
      from: null,
      temp: 0
    },
    {
      op: 'hydra.rotate',
      args: { angle: oscillator, speed: 0 },
      from: 0,
      temp: 1
    }
  ])

  const result = buildHydraShaderOverrides(compiled)
  const shader = result.shaderOverrides[1].rotate.glsl

  assert.match(shader, /uniform float _hydra_1_angle;/)
  assert.match(shader, /_hydra_rotate\(_st, _hydra_1_angle, 0\.0\)/)
  assert.deepEqual(result.uniformBindings[1]._hydra_1_angle, {
    value: oscillator,
    min: 0,
    max: 100
  })
})

test('binds dynamic Audio parameters into a fused shader without sampling passes', () => {
  const audio = {
    type: 'Audio',
    channel: 1,
    scale: 2.0
  }
  const compiled = compiledPlan([
    {
      op: 'hydra.gradient',
      args: { speed: 0 },
      from: null,
      temp: 0
    },
    {
      op: 'hydra.rotate',
      args: { angle: audio, speed: 0 },
      from: 0,
      temp: 1
    }
  ])

  const result = buildHydraShaderOverrides(compiled)
  const shader = result.shaderOverrides[1].rotate.glsl

  assert.match(shader, /uniform float _hydra_1_angle;/)
  assert.match(shader, /_hydra_rotate\(_st, _hydra_1_angle, 0\.0\)/)
  assert.deepEqual(result.uniformBindings[1]._hydra_1_angle, {
    value: audio,
    min: 0,
    max: 100
  })
})

test('binds dynamic Midi parameters into a fused shader without sampling passes', () => {
  const midi = {
    type: 'Midi',
    channel: 1,
    cc: 14
  }
  const compiled = compiledPlan([
    {
      op: 'hydra.gradient',
      args: { speed: 0 },
      from: null,
      temp: 0
    },
    {
      op: 'hydra.rotate',
      args: { angle: midi, speed: 0 },
      from: 0,
      temp: 1
    }
  ])

  const result = buildHydraShaderOverrides(compiled)
  const shader = result.shaderOverrides[1].rotate.glsl

  assert.match(shader, /uniform float _hydra_1_angle;/)
  assert.match(shader, /_hydra_rotate\(_st, _hydra_1_angle, 0\.0\)/)
  assert.deepEqual(result.uniformBindings[1]._hydra_1_angle, {
    value: midi,
    min: 0,
    max: 100
  })
})

test('does not reconcile a newer pipeline after a stale compile returns null', async () => {
  const replacement = {
    graph: { textures: new Map() },
    backend: { textures: new Map() },
    surfaces: new Map()
  }

  class CanvasRenderer {
    constructor() {
      this.pipeline = null
    }

    async compile() {
      this.pipeline = replacement
      return null
    }
  }

  const engine = {
    CanvasRenderer,
    compile() {
      return compiledPlan([{
        op: 'hydra.gradient',
        args: { speed: 0 },
        from: null,
        temp: 0
      }])
    }
  }
  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()

  assert.equal(await renderer.compile('stale Hydra source'), null)
  assert.equal(renderer.pipeline, replacement)
  assert.deepEqual([...replacement.graph.textures], [])
})

test('installs Hydra overrides and restores native Noisemaker surface precision', async () => {
  const oscillator = {
    type: 'Oscillator',
    oscType: 0,
    min: 0.2,
    max: 0.4,
    speed: 1,
    offset: 0,
    seed: 1
  }
  const hydra = compiledPlan([
    {
      op: 'hydra.gradient',
      args: { speed: 0 },
      from: null,
      temp: 0
    },
    {
      op: 'hydra.brightness',
      args: { amount: oscillator },
      from: 0,
      temp: 1
    }
  ])
  const native = compiledPlan([
    {
      op: 'synth.perlin',
      args: {},
      from: null,
      temp: 0
    }
  ])
  let compiled = hydra

  class CanvasRenderer {
    constructor() {
      const textures = new Map([
        ['global_o0_read', { format: 'rgba16f', width: 1, height: 1, value: null }],
        ['global_o0_write', { format: 'rgba16f', width: 1, height: 1, value: null }]
      ])
      this.pipeline = {
        graph: {
          textures: new Map(),
          passes: [{
            nodeId: 'node_1',
            uniforms: {},
            uniformSpecs: {}
          }]
        },
        backend: {
          textures,
          createTexture(name, spec) {
            textures.set(name, {
              format: spec.format,
              width: spec.width,
              height: spec.height,
              value: null
            })
          },
          copyTexture(source, target) {
            textures.get(target).value = textures.get(source).value
          },
          destroyTexture(name) { textures.delete(name) }
        },
        surfaces: new Map([
          ['o0', { read: 'global_o0_read', write: 'global_o0_write' }]
        ]),
        createSurfaces() {
          const format = this.graph.textures.get('global_o0')?.format || 'rgba16f'
          this.backend.createTexture('global_o0_read', {
            format,
            width: 1,
            height: 1
          })
          this.backend.createTexture('global_o0_write', {
            format,
            width: 1,
            height: 1
          })
          this.surfaces.set('o0', {
            read: 'global_o0_read',
            write: 'global_o0_write'
          })
        }
      }
      this.calls = []
    }

    async compile(source, options) {
      this.calls.push([source, options])
      return this.pipeline
    }
  }

  const engine = {
    CanvasRenderer,
    compile() { return compiled }
  }
  installHydraCompiler(engine)
  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()

  await renderer.compile('hydra source')
  assert.ok(renderer.calls[0][1].shaderOverrides[1].brightness)
  assert.equal(renderer.pipeline.backend.textures.get('global_o0_read').format, 'rgba32f')
  assert.equal(
    renderer.pipeline.graph.passes[0].uniforms._hydra_1_amount,
    oscillator
  )
  assert.deepEqual(
    renderer.pipeline.graph.passes[0].uniformSpecs._hydra_1_amount,
    { min: 0, max: 100 }
  )

  renderer.pipeline.backend.textures.get('global_o0_read').value = 'hydra frame'
  compiled = compiledPlan([
    {
      op: 'hydra.prev',
      args: {},
      from: null,
      temp: 0
    },
    {
      op: 'filter.example',
      args: {},
      from: 0,
      temp: 1
    }
  ])
  await renderer.compile('mixed prev with native final node')
  assert.equal(renderer.pipeline.backend.textures.get('global_o0_read').format, 'rgba32f')
  assert.equal(renderer.pipeline.backend.textures.get('global_o0_read').value, 'hydra frame')

  compiled = compiledPlan([{
    op: '_read',
    args: { tex: { kind: 'output', name: 'o0' } },
    from: null,
    temp: 0,
    builtin: true
  }], 'o1')
  await renderer.compile('native read of Hydra surface')
  assert.equal(renderer.pipeline.backend.textures.get('global_o0_read').format, 'rgba32f')
  assert.equal(renderer.pipeline.backend.textures.get('global_o0_read').value, 'hydra frame')

  compiled = native
  await renderer.compile('native source')
  assert.deepEqual(renderer.calls[3][1].shaderOverrides, {})
  assert.equal(renderer.pipeline.backend.textures.get('global_o0_read').format, 'rgba16f')

  renderer.pipeline.backend.textures.get('global_o0_read').value = 'native frame'
  compiled = compiledPlan([{
    op: 'hydra.prev',
    args: {},
    from: null,
    temp: 0
  }])
  await renderer.compile('prev after native source')
  assert.equal(renderer.pipeline.backend.textures.get('global_o0_read').format, 'rgba32f')
  assert.equal(renderer.pipeline.backend.textures.get('global_o0_read').value, 'native frame')
})

test('createSurfaces retains promoted surface format during recompilation', async () => {
  const hydraSource = compiledPlan([{
    op: 'hydra.gradient',
    args: { speed: 0 },
    from: null,
    temp: 0
  }], 'o1')

  const readSource = compiledPlan([{
    op: 'hydra.src',
    args: { tex: { kind: 'output', name: 'o1' } },
    from: null,
    temp: 0
  }], 'o0')

  let compiled = hydraSource
  const textures = new Map()

  class CanvasRenderer {
    constructor() {
      this.pipeline = {
        graph: { textures: new Map(), passes: [] },
        backend: {
          textures,
          createTexture(name, spec) {
            textures.set(name, {
              format: spec.format,
              width: spec.width,
              height: spec.height,
              value: null
            })
          },
          copyTexture(source, target) {
            textures.get(target).value = textures.get(source).value
          },
          destroyTexture(name) { textures.delete(name) }
        },
        surfaces: new Map(),
        createSurfaces() {
          for (const name of ['o0', 'o1']) {
            const underscoreId = `global_${name}`
            const spec = this.graph?.textures?.get?.(underscoreId)
            const format = spec?.format || 'rgba16f'
            const readKey = `${underscoreId}_read`
            const writeKey = `${underscoreId}_write`
            const existing = textures.get(readKey)
            if (existing && existing.format === format) continue
            textures.set(readKey, { format, width: 1, height: 1, value: null })
            textures.set(writeKey, { format, width: 1, height: 1, value: null })
            this.surfaces.set(name, { read: readKey, write: writeKey })
          }
        }
      }
    }

    async compile(source, options) {
      this.pipeline.graph.textures = new Map()
      this.pipeline.createSurfaces()
      return this.pipeline
    }
  }

  const engine = {
    CanvasRenderer,
    compile() { return compiled }
  }
  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()

  await renderer.compile('hydra to o1')
  assert.equal(textures.get('global_o1_read').format, 'rgba32f')
  textures.get('global_o1_read').value = 'pixel-data'

  compiled = readSource
  await renderer.compile('read o1 into o0')
  assert.equal(textures.get('global_o1_read').format, 'rgba32f')
  assert.equal(textures.get('global_o1_read').value, 'pixel-data')
})

test('pre-compilation backup preserves surface data across format migration', async () => {
  const hydraPrevSource = compiledPlan([{
    op: 'hydra.prev',
    args: {},
    from: null,
    temp: 0
  }], 'o0')

  const nativeSource = compiledPlan([{
    op: 'synth.perlin',
    args: {},
    from: null,
    temp: 0
  }], 'o0')

  let compiled = nativeSource
  const textures = new Map()
  const copyOperations = []

  class CanvasRenderer {
    constructor() {
      this.pipeline = {
        graph: { textures: new Map(), passes: [] },
        backend: {
          textures,
          createTexture(name, spec) {
            textures.set(name, {
              format: spec.format,
              width: spec.width,
              height: spec.height,
              value: null
            })
          },
          copyTexture(source, target) {
            copyOperations.push([source, target])
            const src = textures.get(source)
            const dst = textures.get(target)
            if (src && dst) dst.value = src.value
          },
          destroyTexture(name) { textures.delete(name) }
        },
        surfaces: new Map(),
        createSurfaces() {
          const underscoreId = 'global_o0'
          const spec = this.graph?.textures?.get?.(underscoreId)
          const format = spec?.format || 'rgba16f'
          const readKey = `${underscoreId}_read`
          const writeKey = `${underscoreId}_write`
          const existing = textures.get(readKey)
          if (existing && existing.format === format) return
          textures.set(readKey, { format, width: 1, height: 1, value: null })
          textures.set(writeKey, { format, width: 1, height: 1, value: null })
          this.surfaces.set('o0', { read: readKey, write: writeKey })
        }
      }
    }

    async compile(source, options) {
      this.pipeline.graph.textures = new Map()
      this.pipeline.createSurfaces()
      return this.pipeline
    }
  }

  const engine = {
    CanvasRenderer,
    compile() { return compiled }
  }
  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()

  await renderer.compile('native start')
  assert.equal(textures.get('global_o0_read').format, 'rgba16f')
  textures.get('global_o0_read').value = 'pre-migration-data'

  // Compile hydra.prev which promotes o0 to rgba32f and preserves existing o0
  compiled = hydraPrevSource
  await renderer.compile('hydra prev')
  assert.equal(textures.get('global_o0_read').format, 'rgba32f')
  assert.equal(textures.get('global_o0_read').value, 'pre-migration-data')
  assert.ok(copyOperations.length >= 2, 'Expected backup and restore copyTexture operations')
})

