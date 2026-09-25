import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EFFECTS,
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

test('fuses effects targeting upper output surface boundary o7', () => {
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
  ], 'o7')

  const result = buildHydraShaderOverrides(compiled)
  const shader = result.shaderOverrides[1].rotate.glsl

  assert.deepEqual(result.outputSurfaces, ['o7'])
  assert.match(shader, /return _hydra_node_0\(_hydra_rotate\(_st, 0\.3, 0\.0\)\);/)
  assert.match(shader, /fragColor = _hydra_node_1\(_st\);/)
})

test('ignores builtin pipeline steps when building shader overrides', () => {
  const compiled = {
    plans: [{
      chain: [
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
        },
        {
          op: 'runtime.pass',
          args: {},
          from: 1,
          temp: 2,
          builtin: true
        },
        {
          op: '_write',
          args: { tex: { kind: 'output', name: 'o0' } },
          from: 1,
          temp: 3,
          builtin: true
        }
      ],
      write: { kind: 'output', name: 'o0' }
    }]
  }

  const result = buildHydraShaderOverrides(compiled)
  const shader = result.shaderOverrides[1]?.rotate?.glsl

  assert.deepEqual(result.outputSurfaces, ['o0'])
  assert.ok(shader, 'Expected shader override for temp 1')
  assert.equal(result.shaderOverrides[2], undefined, 'Builtin step should not generate shader override')

  const builtinTerminalCompiled = {
    plans: [{
      chain: [
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
          temp: 1,
          builtin: true
        },
        {
          op: '_write',
          args: { tex: { kind: 'output', name: 'o0' } },
          from: 1,
          temp: 2,
          builtin: true
        }
      ],
      write: { kind: 'output', name: 'o0' }
    }]
  }

  const builtinResult = buildHydraShaderOverrides(builtinTerminalCompiled)
  assert.deepEqual(builtinResult.outputSurfaces, [])
  assert.equal(builtinResult.shaderOverrides[1], undefined)
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

test('compileWithHydraParity propagates compiler errors and diagnostics with source locations unchanged', async () => {
  class CanvasRenderer {
    async compile() {
      return {}
    }
  }

  const err = new Error('Compilation failed with 1 error(s)')
  err.diagnostics = [
    {
      code: 'S001',
      message: 'read() is a starter node and cannot be chained inline.',
      location: { line: 3, column: 17 }
    }
  ]

  const engine = {
    CanvasRenderer,
    compile() {
      throw err
    }
  }

  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()

  await assert.rejects(
    async () => renderer.compile('search synth\n\n    diagProbe().read(o0).write(o1)'),
    (error) => {
      assert.equal(error.message, 'Compilation failed with 1 error(s)')
      assert.deepEqual(error.diagnostics, [
        {
          code: 'S001',
          message: 'read() is a starter node and cannot be chained inline.',
          location: { line: 3, column: 17 }
        }
      ])
      return true
    }
  )
})

test('compileWithHydraParity propagates structured lexer diagnostics attached to SyntaxError', async () => {
  class CanvasRenderer {
    async compile() {
      return {}
    }
  }

  const err = new SyntaxError("Unexpected character '@' at line 1 col 1")
  Object.defineProperty(err, 'diagnostic', {
    value: {
      code: 'L001',
      stage: 'lexer',
      severity: 'error',
      message: "Unexpected character '@' at line 1 col 1",
      location: { line: 1, column: 1 },
      span: { start: 0, end: 1 }
    },
    writable: true,
    configurable: true
  })

  const engine = {
    CanvasRenderer,
    compile() {
      throw err
    }
  }

  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()

  await assert.rejects(
    async () => renderer.compile('@noise()'),
    (error) => {
      assert.equal(error, err)
      assert.equal(error.message, "Unexpected character '@' at line 1 col 1")
      assert.deepEqual(error.diagnostic, {
        code: 'L001',
        stage: 'lexer',
        severity: 'error',
        message: "Unexpected character '@' at line 1 col 1",
        location: { line: 1, column: 1 },
        span: { start: 0, end: 1 }
      })
      return true
    }
  )
})

test('compileWithHydraParity propagates structured parser expectation diagnostics attached to SyntaxError', async () => {
  class CanvasRenderer {
    async compile() {
      return {}
    }
  }

  const errP001 = new SyntaxError("Expect '(' at line 2 col 8")
  Object.defineProperty(errP001, 'diagnostic', {
    value: {
      code: 'P001',
      stage: 'parser',
      severity: 'error',
      message: "Expect '(' at line 2 col 8",
      location: { line: 2, column: 8 },
      span: null
    },
    writable: true,
    configurable: true
  })

  let thrownErr = errP001
  const engine = {
    CanvasRenderer,
    compile() {
      throw thrownErr
    }
  }

  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()

  await assert.rejects(
    async () => renderer.compile('search synth\nrender o0'),
    (error) => {
      assert.equal(error, errP001)
      assert.equal(error.message, "Expect '(' at line 2 col 8")
      assert.deepEqual(error.diagnostic, {
        code: 'P001',
        stage: 'parser',
        severity: 'error',
        message: "Expect '(' at line 2 col 8",
        location: { line: 2, column: 8 },
        span: null
      })
      return true
    }
  )

  const errP002 = new SyntaxError("Expect ')' at line 2 col 10")
  Object.defineProperty(errP002, 'diagnostic', {
    value: {
      code: 'P002',
      stage: 'parser',
      severity: 'error',
      message: "Expect ')' at line 2 col 10",
      location: { line: 2, column: 10 },
      span: null
    },
    writable: true,
    configurable: true
  })

  thrownErr = errP002
  await assert.rejects(
    async () => renderer.compile('search synth\nrender(o0'),
    (error) => {
      assert.equal(error, errP002)
      assert.equal(error.message, "Expect ')' at line 2 col 10")
      assert.deepEqual(error.diagnostic, {
        code: 'P002',
        stage: 'parser',
        severity: 'error',
        message: "Expect ')' at line 2 col 10",
        location: { line: 2, column: 10 },
        span: null
      })
      return true
    }
  )

  const errUnlocated = new SyntaxError("Expect '(' at line undefined col undefined")
  Object.defineProperty(errUnlocated, 'diagnostic', {
    value: {
      code: 'P001',
      stage: 'parser',
      severity: 'error',
      message: "Expect '(' at line undefined col undefined",
      location: null,
      span: null
    },
    writable: true,
    configurable: true
  })

  thrownErr = errUnlocated
  await assert.rejects(
    async () => renderer.compile('search synth\nrender o0'),
    (error) => {
      assert.equal(error, errUnlocated)
      assert.equal(error.message, "Expect '(' at line undefined col undefined")
      assert.deepEqual(error.diagnostic, {
        code: 'P001',
        stage: 'parser',
        severity: 'error',
        message: "Expect '(' at line undefined col undefined",
        location: null,
        span: null
      })
      return true
    }
  )
})

test('compileWithHydraParity propagates structured parser automation diagnostics attached to SyntaxError', async () => {
  class CanvasRenderer {
    async compile() {
      return {}
    }
  }

  const errP003 = new SyntaxError("midi() requires 'channel' or 'zone' argument at line 2 col 24")
  Object.defineProperty(errP003, 'diagnostic', {
    value: {
      code: 'P003',
      stage: 'parser',
      severity: 'error',
      message: "midi() requires 'channel' or 'zone' argument at line 2 col 24",
      location: { line: 2, column: 24 },
      span: null
    },
    writable: true,
    configurable: true
  })

  let thrownErr = errP003
  const engine = {
    CanvasRenderer,
    compile() {
      throw thrownErr
    }
  }

  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()

  await assert.rejects(
    async () => renderer.compile('search synth\nlet x = midi()'),
    (error) => {
      assert.equal(error, errP003)
      assert.equal(error.message, "midi() requires 'channel' or 'zone' argument at line 2 col 24")
      assert.deepEqual(error.diagnostic, {
        code: 'P003',
        stage: 'parser',
        severity: 'error',
        message: "midi() requires 'channel' or 'zone' argument at line 2 col 24",
        location: { line: 2, column: 24 },
        span: null
      })
      return true
    }
  )

  const errUnlocatedP003 = new SyntaxError("midi() requires 'channel' or 'zone' argument at line undefined col undefined")
  Object.defineProperty(errUnlocatedP003, 'diagnostic', {
    value: {
      code: 'P003',
      stage: 'parser',
      severity: 'error',
      message: "midi() requires 'channel' or 'zone' argument at line undefined col undefined",
      location: null,
      span: null
    },
    writable: true,
    configurable: true
  })

  thrownErr = errUnlocatedP003
  await assert.rejects(
    async () => renderer.compile('search synth\nlet x = midi()'),
    (error) => {
      assert.equal(error, errUnlocatedP003)
      assert.equal(error.message, "midi() requires 'channel' or 'zone' argument at line undefined col undefined")
      assert.deepEqual(error.diagnostic, {
        code: 'P003',
        stage: 'parser',
        severity: 'error',
        message: "midi() requires 'channel' or 'zone' argument at line undefined col undefined",
        location: null,
        span: null
      })
      return true
    }
  )
})

test('compileWithHydraParity propagates structured parser search directive diagnostics attached to SyntaxError', async () => {
  class CanvasRenderer {
    async compile() {
      return {}
    }
  }

  const errP004 = new SyntaxError("Expected namespace identifier after search at line 1 col 7")
  Object.defineProperty(errP004, 'diagnostic', {
    value: {
      code: 'P004',
      stage: 'parser',
      severity: 'error',
      message: "Expected namespace identifier after search at line 1 col 7",
      location: { line: 1, column: 7 },
      span: null
    },
    writable: true,
    configurable: true
  })

  let thrownErr = errP004
  const engine = {
    CanvasRenderer,
    compile() {
      throw thrownErr
    }
  }

  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()

  await assert.rejects(
    async () => renderer.compile('search'),
    (error) => {
      assert.equal(error, errP004)
      assert.equal(error.message, "Expected namespace identifier after search at line 1 col 7")
      assert.deepEqual(error.diagnostic, {
        code: 'P004',
        stage: 'parser',
        severity: 'error',
        message: "Expected namespace identifier after search at line 1 col 7",
        location: { line: 1, column: 7 },
        span: null
      })
      return true
    }
  )

  const errUnlocatedP004 = new SyntaxError("Missing required 'search' directive. Every program must start with 'search <namespace>, ...' to specify namespace search order.")
  Object.defineProperty(errUnlocatedP004, 'diagnostic', {
    value: {
      code: 'P004',
      stage: 'parser',
      severity: 'error',
      message: "Missing required 'search' directive. Every program must start with 'search <namespace>, ...' to specify namespace search order.",
      location: null,
      span: null
    },
    writable: true,
    configurable: true
  })

  thrownErr = errUnlocatedP004
  await assert.rejects(
    async () => renderer.compile(''),
    (error) => {
      assert.equal(error, errUnlocatedP004)
      assert.equal(error.message, "Missing required 'search' directive. Every program must start with 'search <namespace>, ...' to specify namespace search order.")
      assert.deepEqual(error.diagnostic, {
        code: 'P004',
        stage: 'parser',
        severity: 'error',
        message: "Missing required 'search' directive. Every program must start with 'search <namespace>, ...' to specify namespace search order.",
        location: null,
        span: null
      })
      return true
    }
  )
})

test('compileWithHydraParity preserves pipeline sink deferral contract across recompilation', async () => {
  let deferState = false
  const textures = new Map()

  class MockPipeline {
    constructor() {
      this.graph = { textures: new Map(), passes: [] }
      this.backend = {
        textures,
        createTexture(name, spec) { textures.set(name, spec) },
        destroyTexture(name) { textures.delete(name) }
      }
      this.surfaces = new Map()
      this.sinkManager = {
        shouldDeferRender() { return deferState }
      }
    }
    createSurfaces() {}
    shouldDeferRender() {
      return this.sinkManager.shouldDeferRender()
    }
  }

  class CanvasRenderer {
    constructor() {
      this.pipeline = new MockPipeline()
      this._deferredFrameCount = 0
    }
    async compile() {
      return this.pipeline
    }
    get deferredFrameCount() {
      return this._deferredFrameCount
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
      }], 'o0')
    }
  }

  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()
  const pipeline = await renderer.compile('search hydra\ngradient(speed: 0).write(o0)')

  assert.equal(pipeline, renderer.pipeline)
  assert.equal(typeof pipeline.shouldDeferRender, 'function')
  assert.equal(pipeline.shouldDeferRender(), false)
  assert.equal(renderer.deferredFrameCount, 0)

  deferState = true
  assert.equal(pipeline.shouldDeferRender(), true)

  const recompiledPipeline = await renderer.compile('search hydra\nosc(frequency: 60).write(o0)')
  assert.equal(recompiledPipeline, renderer.pipeline)
  assert.equal(recompiledPipeline.shouldDeferRender(), true)

  deferState = false
  assert.equal(recompiledPipeline.shouldDeferRender(), false)
})

test('compileWithHydraParity propagates structured parser output validation diagnostics attached to SyntaxError', async () => {
  class CanvasRenderer {
    async compile() {
      return {}
    }
  }

  const errP005 = new SyntaxError("write() requires an explicit surface reference (e.g., o0, o1, xyz0, vel0, rgba0, mesh0, none) at line 2 col 21")
  Object.defineProperty(errP005, 'diagnostic', {
    value: {
      code: 'P005',
      stage: 'parser',
      severity: 'error',
      message: "write() requires an explicit surface reference (e.g., o0, o1, xyz0, vel0, rgba0, mesh0, none) at line 2 col 21",
      location: { line: 2, column: 21 },
      span: null
    },
    writable: true,
    configurable: true
  })

  let thrownErr = errP005
  const engine = {
    CanvasRenderer,
    compile() {
      throw thrownErr
    }
  }

  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()

  await assert.rejects(
    async () => renderer.compile('search synth\nnoise().write()'),
    (error) => {
      assert.equal(error, errP005)
      assert.equal(error.message, "write() requires an explicit surface reference (e.g., o0, o1, xyz0, vel0, rgba0, mesh0, none) at line 2 col 21")
      assert.deepEqual(error.diagnostic, {
        code: 'P005',
        stage: 'parser',
        severity: 'error',
        message: "write() requires an explicit surface reference (e.g., o0, o1, xyz0, vel0, rgba0, mesh0, none) at line 2 col 21",
        location: { line: 2, column: 21 },
        span: null
      })
      return true
    }
  )

  const errUnlocatedP005 = new SyntaxError("Expected output reference in render()")
  Object.defineProperty(errUnlocatedP005, 'diagnostic', {
    value: {
      code: 'P005',
      stage: 'parser',
      severity: 'error',
      message: "Expected output reference in render()",
      location: null,
      span: null
    },
    writable: true,
    configurable: true
  })

  thrownErr = errUnlocatedP005
  await assert.rejects(
    async () => renderer.compile('search synth\nrender(none)'),
    (error) => {
      assert.equal(error, errUnlocatedP005)
      assert.equal(error.message, "Expected output reference in render()")
      assert.deepEqual(error.diagnostic, {
        code: 'P005',
        stage: 'parser',
        severity: 'error',
        message: "Expected output reference in render()",
        location: null,
        span: null
      })
      return true
    }
  )
})

test('compileWithHydraParity propagates structured parser subchain validation diagnostics attached to SyntaxError', async () => {
  class CanvasRenderer {
    async compile() {
      return {}
    }
  }

  const errP006 = new SyntaxError("Expected '.' before chain element in subchain body at line 2 col 28")
  Object.defineProperty(errP006, 'diagnostic', {
    value: {
      code: 'P006',
      stage: 'parser',
      severity: 'error',
      message: "Expected '.' before chain element in subchain body at line 2 col 28",
      location: { line: 2, column: 28 },
      span: null
    },
    writable: true,
    configurable: true
  })

  let thrownErr = errP006
  const engine = {
    CanvasRenderer,
    compile() {
      throw thrownErr
    }
  }

  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()

  await assert.rejects(
    async () => renderer.compile('search synth\nnoise().subchain() { invert() }'),
    (error) => {
      assert.equal(error, errP006)
      assert.equal(error.message, "Expected '.' before chain element in subchain body at line 2 col 28")
      assert.deepEqual(error.diagnostic, {
        code: 'P006',
        stage: 'parser',
        severity: 'error',
        message: "Expected '.' before chain element in subchain body at line 2 col 28",
        location: { line: 2, column: 28 },
        span: null
      })
      return true
    }
  )

  const errUnlocatedP006 = new SyntaxError("Subchain body cannot be empty at line undefined col undefined")
  Object.defineProperty(errUnlocatedP006, 'diagnostic', {
    value: {
      code: 'P006',
      stage: 'parser',
      severity: 'error',
      message: "Subchain body cannot be empty at line undefined col undefined",
      location: null,
      span: null
    },
    writable: true,
    configurable: true
  })

  thrownErr = errUnlocatedP006
  await assert.rejects(
    async () => renderer.compile('search synth\nnoise().subchain() {}'),
    (error) => {
      assert.equal(error, errUnlocatedP006)
      assert.equal(error.message, "Subchain body cannot be empty at line undefined col undefined")
      assert.deepEqual(error.diagnostic, {
        code: 'P006',
        stage: 'parser',
        severity: 'error',
        message: "Subchain body cannot be empty at line undefined col undefined",
        location: null,
        span: null
      })
      return true
    }
  )
})

test('compileWithHydraParity propagates structured parser call-form validation diagnostics attached to SyntaxError (P007)', async () => {
  class CanvasRenderer {
    async compile() {
      return {}
    }
  }

  const errP007 = new SyntaxError("Cannot mix positional and keyword arguments at line 2 col 14")
  Object.defineProperty(errP007, 'diagnostic', {
    value: {
      code: 'P007',
      stage: 'parser',
      severity: 'error',
      message: "Cannot mix positional and keyword arguments at line 2 col 14",
      location: { line: 2, column: 14 },
      span: null
    },
    writable: true,
    configurable: true
  })

  let thrownErr = errP007
  const engine = {
    CanvasRenderer,
    compile() {
      throw thrownErr
    }
  }

  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()

  await assert.rejects(
    async () => renderer.compile('search synth\ndiagProbe(1, x: 2)'),
    (error) => {
      assert.equal(error, errP007)
      assert.equal(error.message, "Cannot mix positional and keyword arguments at line 2 col 14")
      assert.deepEqual(error.diagnostic, {
        code: 'P007',
        stage: 'parser',
        severity: 'error',
        message: "Cannot mix positional and keyword arguments at line 2 col 14",
        location: { line: 2, column: 14 },
        span: null
      })
      return true
    }
  )

  const errFromP007 = new SyntaxError("'from' requires exactly two arguments (namespace, call) at line 2 col 9")
  Object.defineProperty(errFromP007, 'diagnostic', {
    value: {
      code: 'P007',
      stage: 'parser',
      severity: 'error',
      message: "'from' requires exactly two arguments (namespace, call) at line 2 col 9",
      location: { line: 2, column: 9 },
      span: null
    },
    writable: true,
    configurable: true
  })

  thrownErr = errFromP007
  await assert.rejects(
    async () => renderer.compile('search synth\nfrom(synth)'),
    (error) => {
      assert.equal(error, errFromP007)
      assert.equal(error.message, "'from' requires exactly two arguments (namespace, call) at line 2 col 9")
      assert.deepEqual(error.diagnostic, {
        code: 'P007',
        stage: 'parser',
        severity: 'error',
        message: "'from' requires exactly two arguments (namespace, call) at line 2 col 9",
        location: { line: 2, column: 9 },
        span: null
      })
      return true
    }
  )

  const errUnlocatedP007 = new SyntaxError("Cannot mix positional and keyword arguments")
  Object.defineProperty(errUnlocatedP007, 'diagnostic', {
    value: {
      code: 'P007',
      stage: 'parser',
      severity: 'error',
      message: "Cannot mix positional and keyword arguments",
      location: null,
      span: null
    },
    writable: true,
    configurable: true
  })

  thrownErr = errUnlocatedP007
  await assert.rejects(
    async () => renderer.compile('search synth\ndiagProbe(1, x: 2)'),
    (error) => {
      assert.equal(error, errUnlocatedP007)
      assert.equal(error.message, "Cannot mix positional and keyword arguments")
      assert.deepEqual(error.diagnostic, {
        code: 'P007',
        stage: 'parser',
        severity: 'error',
        message: "Cannot mix positional and keyword arguments",
        location: null,
        span: null
      })
      return true
    }
  )
})

test('compileWithHydraParity propagates structured parser expectation diagnostics with explicit null location and span attached to SyntaxError (P001)', async () => {
  class CanvasRenderer {
    async compile() {
      return {}
    }
  }

  const errNumberP001 = new SyntaxError("Expected number")
  Object.defineProperty(errNumberP001, 'diagnostic', {
    value: {
      code: 'P001',
      stage: 'parser',
      severity: 'error',
      message: "Expected number",
      location: null,
      span: null
    },
    writable: true,
    configurable: true
  })

  const engine = {
    CanvasRenderer,
    compile() {
      throw errNumberP001
    }
  }

  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()

  await assert.rejects(
    async () => renderer.compile('search synth\nnoise([true])'),
    (error) => {
      assert.equal(error, errNumberP001)
      assert.equal(error.message, "Expected number")
      assert.deepEqual(error.diagnostic, {
        code: 'P001',
        stage: 'parser',
        severity: 'error',
        message: "Expected number",
        location: null,
        span: null
      })
      return true
    }
  )
})

test('compileWithHydraParity forwards options to engine.compile', async () => {
  class CanvasRenderer {
    async compile() {
      return {}
    }
  }

  let capturedSource = null
  let capturedOptions = null
  const engine = {
    CanvasRenderer,
    compile(source, options) {
      capturedSource = source
      capturedOptions = options
      return {
        plans: [],
        diagnostics: []
      }
    }
  }

  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()
  await renderer.compile('search hydra\nosc().write(o0)', { subchainArguments: 'strict' })

  assert.equal(capturedSource, 'search hydra\nosc().write(o0)')
  assert.deepEqual(capturedOptions, { subchainArguments: 'strict' })
})

test('compileWithHydraParity propagates numeric-coercion diagnostics with source position span attached to SyntaxError (P001)', async () => {
  class CanvasRenderer {
    async compile() {
      return {}
    }
  }

  const errNumberCoercionP001 = new SyntaxError("Expected number")
  Object.defineProperty(errNumberCoercionP001, 'diagnostic', {
    value: {
      code: 'P001',
      stage: 'parser',
      severity: 'error',
      message: "Expected number",
      location: { line: 2, column: 9 },
      span: { start: 21, end: 22 }
    },
    writable: true,
    configurable: true
  })

  const engine = {
    CanvasRenderer,
    compile() {
      throw errNumberCoercionP001
    }
  }

  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()

  await assert.rejects(
    async () => renderer.compile('search synth\nlet x = [1] + 1'),
    (error) => {
      assert.equal(error, errNumberCoercionP001)
      assert.equal(error.message, "Expected number")
      assert.deepEqual(error.diagnostic, {
        code: 'P001',
        stage: 'parser',
        severity: 'error',
        message: "Expected number",
        location: { line: 2, column: 9 },
        span: { start: 21, end: 22 }
      })
      return true
    }
  )
})

test('compileWithHydraParity propagates structured parser subchain argument validation diagnostics attached to SyntaxError (P008, P009, P010)', async () => {
  class CanvasRenderer {
    async compile() {
      return {}
    }
  }

  const errP008 = new SyntaxError("Unknown subchain argument 'bad' at line 2 col 18. Valid keys: name, id. The value is discarded.")
  Object.defineProperty(errP008, 'diagnostic', {
    value: {
      code: 'P008',
      stage: 'parser',
      severity: 'error',
      message: "Unknown subchain argument 'bad' at line 2 col 18. Valid keys: name, id. The value is discarded.",
      location: { line: 2, column: 18 },
      span: { start: 30, end: 33 }
    },
    writable: true,
    configurable: true
  })

  let thrownErr = errP008
  const engine = {
    CanvasRenderer,
    compile() {
      throw thrownErr
    }
  }

  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()

  await assert.rejects(
    async () => renderer.compile('search synth\nnoise().subchain(bad: "x") { .noise() }.write(o0)', { subchainArguments: 'strict' }),
    (error) => {
      assert.equal(error, errP008)
      assert.equal(error.message, "Unknown subchain argument 'bad' at line 2 col 18. Valid keys: name, id. The value is discarded.")
      assert.deepEqual(error.diagnostic, {
        code: 'P008',
        stage: 'parser',
        severity: 'error',
        message: "Unknown subchain argument 'bad' at line 2 col 18. Valid keys: name, id. The value is discarded.",
        location: { line: 2, column: 18 },
        span: { start: 30, end: 33 }
      })
      return true
    }
  )

  const errP009 = new SyntaxError("Duplicate subchain argument 'name' at line 2 col 28. Later values override earlier ones.")
  Object.defineProperty(errP009, 'diagnostic', {
    value: {
      code: 'P009',
      stage: 'parser',
      severity: 'error',
      message: "Duplicate subchain argument 'name' at line 2 col 28. Later values override earlier ones.",
      location: { line: 2, column: 28 },
      span: { start: 40, end: 44 }
    },
    writable: true,
    configurable: true
  })

  thrownErr = errP009
  await assert.rejects(
    async () => renderer.compile('search synth\nnoise().subchain(name: "a", name: "b") { .noise() }.write(o0)', { subchainArguments: 'strict' }),
    (error) => {
      assert.equal(error, errP009)
      assert.equal(error.message, "Duplicate subchain argument 'name' at line 2 col 28. Later values override earlier ones.")
      assert.deepEqual(error.diagnostic, {
        code: 'P009',
        stage: 'parser',
        severity: 'error',
        message: "Duplicate subchain argument 'name' at line 2 col 28. Later values override earlier ones.",
        location: { line: 2, column: 28 },
        span: { start: 40, end: 44 }
      })
      return true
    }
  )

  const errP010 = new SyntaxError("Missing ',' between subchain arguments at line 2 col 28")
  Object.defineProperty(errP010, 'diagnostic', {
    value: {
      code: 'P010',
      stage: 'parser',
      severity: 'error',
      message: "Missing ',' between subchain arguments at line 2 col 28",
      location: { line: 2, column: 28 },
      span: { start: 40, end: 44 }
    },
    writable: true,
    configurable: true
  })

  thrownErr = errP010
  await assert.rejects(
    async () => renderer.compile('search synth\nnoise().subchain(name: "a" id: "b") { .noise() }.write(o0)', { subchainArguments: 'strict' }),
    (error) => {
      assert.equal(error, errP010)
      assert.equal(error.message, "Missing ',' between subchain arguments at line 2 col 28")
      assert.deepEqual(error.diagnostic, {
        code: 'P010',
        stage: 'parser',
        severity: 'error',
        message: "Missing ',' between subchain arguments at line 2 col 28",
        location: { line: 2, column: 28 },
        span: { start: 40, end: 44 }
      })
      return true
    }
  )
})

test('formats boolean and numeric edge cases into valid GLSL in fused shaders', () => {
  const check = (speed) => {
    const compiled = compiledPlan([{
      op: 'hydra.gradient',
      args: { speed },
      from: null,
      temp: 0
    }])
    return buildHydraShaderOverrides(compiled).shaderOverrides[0].gradient.glsl
  }

  assert.match(check(false), /return _hydra_gradient\(_st, 0\.0\);/)
  assert.match(check(true), /return _hydra_gradient\(_st, 1\.0\);/)
  assert.match(check(1e21), /return _hydra_gradient\(_st, 1e\+21\);/)
  assert.doesNotMatch(check(1e21), /1e\+21\.0/)
  assert.match(check(-0), /return _hydra_gradient\(_st, -0\.0\);/)
})

test('reconcileSurfaceFormats cleans up preBackups when pipeline resources are unavailable', async () => {
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
  const destroyed = []

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
          copyTexture() {},
          destroyTexture(name) {
            textures.delete(name)
            destroyed.push(name)
          }
        },
        surfaces: new Map(),
        createSurfaces() {
          const underscoreId = 'global_o0'
          const format = 'rgba16f'
          const readKey = `${underscoreId}_read`
          const writeKey = `${underscoreId}_write`
          textures.set(readKey, { format, width: 1, height: 1, value: null })
          textures.set(writeKey, { format, width: 1, height: 1, value: null })
          this.surfaces.set('o0', { read: readKey, write: writeKey })
        }
      }
    }

    async compile(source, options) {
      // Simulate pipeline returning without graph.textures
      this.pipeline.graph = null
      return this.pipeline
    }
  }

  const engine = {
    CanvasRenderer,
    compile() { return compiled }
  }
  installHydraCompiler(engine)
  const renderer = new engine.CanvasRenderer()

  renderer.pipeline.createSurfaces()
  assert.equal(textures.get('global_o0_read').format, 'rgba16f')

  compiled = hydraPrevSource
  await renderer.compile('hydra prev')
  assert.ok(destroyed.some(name => name.startsWith('_hydra_surface_backup_o0_')), 'Pre-compilation backup should be destroyed')
})

test('formats scalar and boolean literals into vector constructors in fused shaders', () => {
  const testEffect = {
    name: 'testVec',
    type: 'color',
    inputs: [
      { type: 'vec4', name: 'color', default: 1 },
      { type: 'vec2', name: 'offset', default: 0 }
    ],
    glsl: 'return _c0 * color + vec4(offset, 0.0, 0.0);'
  }
  EFFECTS.set('testVec', testEffect)
  try {
    const compiled = compiledPlan([
      {
        op: 'hydra.gradient',
        args: {},
        from: null,
        temp: 0
      },
      {
        op: 'hydra.testVec',
        args: { color: 0.5, offset: true },
        from: 0,
        temp: 1
      }
    ])
    const shader = buildHydraShaderOverrides(compiled).shaderOverrides[1].testVec.glsl
    assert.match(shader, /_hydra_testVec\(_hydra_node_0\(_st\), vec4\(0\.5\), vec2\(1\.0\)\)/)
  } finally {
    EFFECTS.delete('testVec')
  }
})

