import glslFunctions from '../glsl/glsl-functions.js'
import utilityGlsl from '../glsl/utility-functions.js'
import {
  hydraGlslBody,
  isExecutableHydraEffect
} from './hydraGlsl.js'

const EFFECTS = new Map(
  glslFunctions()
    .filter(isExecutableHydraEffect)
    .map(effect => [effect.name, effect])
)
const INSTALLED = Symbol('hydraCompilerInstalled')
const PROMOTED_SURFACES = new WeakMap()
let surfaceBackupIndex = 0
const HYDRA_SURFACE_SPEC = Object.freeze({
  width: 'screen',
  height: 'screen',
  format: 'rgba32f',
  usage: ['render', 'sample', 'copySrc', 'copyDst']
})

const LEADING_ARGUMENTS = {
  src: [{ type: 'vec2', name: '_st' }],
  coord: [{ type: 'vec2', name: '_st' }],
  color: [{ type: 'vec4', name: '_c0' }],
  combine: [
    { type: 'vec4', name: '_c0' },
    { type: 'vec4', name: '_c1' }
  ],
  combineCoord: [
    { type: 'vec2', name: '_st' },
    { type: 'vec4', name: '_c0' }
  ]
}

function effectName(step) {
  if (!step.op.startsWith('hydra.')) return null
  const name = step.op.slice('hydra.'.length)
  return name === 'hydraOsc' ? 'osc' : name
}

function isTextureInput(_effect, input) {
  return input.type === 'sampler2D'
}

function textureArgumentName(effect) {
  const sampler = (effect.inputs || []).find(input => isTextureInput(effect, input))
  if (sampler) return sampler.name
  if (effect.type === 'combine' || effect.type === 'combineCoord') return 'tex'
  return null
}

function valueLiteral(value, input, temp, bindings, bindingTypes) {
  const type = input.type
  if (value && typeof value === 'object' &&
      ['Oscillator', 'Midi', 'Audio'].includes(value.type || value._ast?.type)) {
    const uniform = `_hydra_${temp}_${input.name}`
    bindings[uniform] = {
      value,
      min: input.min ?? 0,
      max: input.max ?? 100
    }
    bindingTypes[uniform] = type
    return uniform
  }
  const resolved = value && typeof value === 'object' && 'value' in value
    ? value.value
    : value

  if (typeof resolved === 'number' && Number.isFinite(resolved)) {
    return Number.isInteger(resolved) ? `${resolved}.0` : String(resolved)
  }
  if (typeof resolved === 'boolean') return resolved ? 'true' : 'false'
  if (Array.isArray(resolved)) {
    if (!/^vec[234]$/.test(type)) throw new Error(`Unsupported Hydra input type '${type}'`)
    return `${type}(${resolved.map(item => valueLiteral(
      item,
      { type: 'float', name: input.name },
      temp,
      bindings,
      bindingTypes
    )).join(', ')})`
  }
  throw new Error(`Unsupported dynamic Hydra input '${String(resolved)}'`)
}

function wrapperName(name) {
  return `_hydra_${name}`
}

function buildWrapper(effect) {
  const leading = LEADING_ARGUMENTS[effect.type]
  const inputs = (effect.inputs || []).filter((input, index) => (
    !isTextureInput(effect, input, index)
  ))
  const returnType = effect.type === 'coord' || effect.type === 'combineCoord'
    ? 'vec2'
    : 'vec4'
  const args = leading.concat(inputs)
    .map(input => `${input.type} ${input.name}`)
    .join(', ')

  return `${returnType} ${wrapperName(effect.name)}(${args}) {
${hydraGlslBody(effect)}
}`
}

function buildNode(step, effect, steps, bindings, bindingTypes) {
  const inputs = effect.inputs || []
  const values = inputs
    .filter((input, index) => !isTextureInput(effect, input, index))
    .map(input => valueLiteral(
      step.args?.[input.name] ?? input.default,
      input,
      step.temp,
      bindings,
      bindingTypes
    ))
  const suffix = values.length > 0 ? `, ${values.join(', ')}` : ''
  const upstream = step.from == null ? null : `_hydra_node_${step.from}`
  const textureInput = textureArgumentName(effect)
  let nested = null

  if (textureInput) {
    const reference = step.args?.[textureInput]
    if (reference?.kind !== 'temp' || !steps.has(reference.index)) {
      throw new Error(`Hydra effect '${effect.name}' requires a Hydra texture input`)
    }
    nested = `_hydra_node_${reference.index}`
  }

  let expression
  if (effect.type === 'src') {
    if (textureInput) throw new Error(`Hydra source '${effect.name}' cannot be fused`)
    expression = `${wrapperName(effect.name)}(_st${suffix})`
  } else if (!upstream) {
    throw new Error(`Hydra effect '${effect.name}' has no upstream source`)
  } else if (effect.type === 'coord') {
    expression = `${upstream}(${wrapperName(effect.name)}(_st${suffix}))`
  } else if (effect.type === 'color') {
    expression = `${wrapperName(effect.name)}(${upstream}(_st)${suffix})`
  } else if (effect.type === 'combine') {
    expression = `${wrapperName(effect.name)}(${upstream}(_st), ${nested}(_st)${suffix})`
  } else if (effect.type === 'combineCoord') {
    expression = `${upstream}(${wrapperName(effect.name)}(_st, ${nested}(_st)${suffix}))`
  } else {
    throw new Error(`Unsupported Hydra effect type '${effect.type}'`)
  }

  return `vec4 _hydra_node_${step.temp}(vec2 _st) {
  return ${expression};
}`
}

function usedUtilities(effects) {
  const bodies = effects.map(effect => effect.glsl).join('\n')
  return Object.entries(utilityGlsl)
    .filter(([name]) => new RegExp(`\\b${name}\\b\\s*\\(`).test(bodies))
    .map(([, utility]) => utility.glsl)
}

function reachableHydraSteps(finalTemp, steps) {
  const reachable = new Map()

  function visit(temp) {
    if (reachable.has(temp)) return
    const step = steps.get(temp)
    const name = step && effectName(step)
    const effect = name && EFFECTS.get(name)
    if (!step || !effect) throw new Error('Plan contains a non-Hydra node')
    reachable.set(temp, { step, effect })
    if (step.from != null) visit(step.from)
    const textureInput = textureArgumentName(effect)
    if (textureInput) {
      const reference = step.args?.[textureInput]
      if (reference?.kind !== 'temp') {
        throw new Error(`Hydra effect '${name}' uses an external texture`)
      }
      visit(reference.index)
    }
  }

  visit(finalTemp)
  return [...reachable.values()].sort((a, b) => a.step.temp - b.step.temp)
}

function buildShader(nodes, finalTemp) {
  const effects = [...new Map(nodes.map(({ effect }) => [effect.name, effect])).values()]
  const utilities = usedUtilities(effects)
  const wrappers = effects.map(buildWrapper)
  const steps = new Map(nodes.map(({ step }) => [step.temp, step]))
  const uniformBindings = {}
  const bindingTypes = {}
  const nodeFunctions = nodes.map(({ step, effect }) => buildNode(
    step,
    effect,
    steps,
    uniformBindings,
    bindingTypes
  ))
  const bindingDeclarations = Object.entries(bindingTypes)
    .map(([name, type]) => `uniform ${type} ${name};`)
    .join('\n')

  const glsl = `#version 300 es
precision highp float;

uniform vec2 resolution;
uniform float time;
uniform sampler2D prevBuffer;
${bindingDeclarations}

out vec4 fragColor;

${utilities.join('\n\n')}

${wrappers.join('\n\n')}

${nodeFunctions.join('\n\n')}

void main() {
  vec2 _st = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y) / resolution.xy;
  fragColor = _hydra_node_${finalTemp}(_st);
}
`
  return { glsl, uniformBindings }
}

export function buildHydraShaderOverrides(compiled) {
  const shaderOverrides = {}
  const outputSurfaces = []
  const preserveSurfaces = []
  const retainSurfaces = []
  const uniformBindings = {}

  for (const plan of compiled?.plans || []) {
    const chain = plan.chain || []
    const writeStep = [...chain].reverse().find(step => step.op === '_write')
    const finalTemp = writeStep?.from
    const output = plan.write?.name || writeStep?.args?.tex?.name

    for (const step of chain) {
      if (step.op === '_write') continue
      for (const value of Object.values(step.args || {})) {
        if (value?.kind === 'output') retainSurfaces.push(value.name)
      }
      if (output && effectName(step) === 'prev') {
        preserveSurfaces.push(output)
        retainSurfaces.push(output)
      }
    }

    if (finalTemp == null || !output) continue

    const steps = new Map(
      chain
        .filter(step => !step.builtin)
        .map(step => [step.temp, step])
    )
    const finalStep = steps.get(finalTemp)
    if (finalStep && effectName(finalStep)) {
      outputSurfaces.push(output)
      for (const step of steps.values()) {
        const name = effectName(step)
        if (!name) continue
        for (const value of Object.values(step.args || {})) {
          if (value?.kind === 'output') {
            if (value.name === output) preserveSurfaces.push(output)
          }
        }
      }
    }

    try {
      const nodes = reachableHydraSteps(finalTemp, steps)
      const final = nodes.find(({ step }) => step.temp === finalTemp)
      const fused = buildShader(nodes, finalTemp)
      shaderOverrides[finalTemp] = {
        [final.effect.name]: { glsl: fused.glsl }
      }
      if (Object.keys(fused.uniformBindings).length > 0) {
        uniformBindings[finalTemp] = fused.uniformBindings
      }
    } catch (_) {}
  }

  const result = {
    shaderOverrides,
    outputSurfaces: [...new Set(outputSurfaces)]
  }
  if (preserveSurfaces.length > 0) {
    result.preserveSurfaces = [...new Set(preserveSurfaces)]
  }
  if (retainSurfaces.length > 0) {
    result.retainSurfaces = [...new Set(retainSurfaces)]
  }
  if (Object.keys(uniformBindings).length > 0) result.uniformBindings = uniformBindings
  return result
}

function mergeShaderOverrides(generated, supplied = {}) {
  const merged = {}
  for (const [temp, programs] of Object.entries(generated)) {
    merged[temp] = { ...programs }
  }
  for (const [temp, programs] of Object.entries(supplied)) {
    merged[temp] = { ...(merged[temp] || {}), ...programs }
  }
  return merged
}

function backupSurfaceRead(pipeline, surface) {
  const { backend } = pipeline
  const state = pipeline.surfaces.get(surface)
  const texture = state && backend.textures.get(state.read)
  if (!state || !texture || typeof backend.createTexture !== 'function' ||
      typeof backend.copyTexture !== 'function') {
    throw new Error(`Cannot preserve Hydra surface '${surface}' during format migration`)
  }

  const name = `_hydra_surface_backup_${surface}_${surfaceBackupIndex++}`
  backend.createTexture(name, {
    width: texture.width,
    height: texture.height,
    format: texture.format,
    usage: ['render', 'sample', 'copySrc', 'copyDst']
  })
  backend.copyTexture(state.read, name)
  return { name, surface }
}

function reconcileSurfaceFormats(
  renderer,
  outputSurfaces,
  preserveSurfaces = [],
  retainSurfaces = [],
  preBackups = []
) {
  const pipeline = renderer.pipeline
  if (!pipeline?.graph?.textures || !pipeline.backend?.textures || !pipeline.surfaces) return

  const promoted = new Set(outputSurfaces)
  const preserve = new Set(preserveSurfaces)
  const retain = new Set(retainSurfaces)
  const previous = PROMOTED_SURFACES.get(renderer) || new Map()
  const current = new Map()
  const touched = new Set([...previous.keys(), ...promoted])

  for (const surface of promoted) {
    pipeline.graph.textures.set(`global_${surface}`, HYDRA_SURFACE_SPEC)
    current.set(surface, HYDRA_SURFACE_SPEC)
  }
  for (const surface of retain) {
    if (current.has(surface) || !previous.has(surface)) continue
    const spec = previous.get(surface)
    pipeline.graph.textures.set(`global_${surface}`, spec)
    current.set(surface, spec)
  }
  for (const [surface, spec] of previous) {
    const key = `global_${surface}`
    if (!current.has(surface) && pipeline.graph.textures.get(key) === spec) {
      pipeline.graph.textures.delete(key)
    }
  }

  let recreate = false
  const backups = [...preBackups]
  for (const surface of touched) {
    const state = pipeline.surfaces.get(surface)
    if (!state) continue
    const key = `global_${surface}`
    const desired = pipeline.graph.textures.get(key)?.format || 'rgba16f'
    const actual = pipeline.backend.textures.get(state.read)?.format
    if (actual === desired) continue
    if (preserve.has(surface) && pipeline.backend.getName?.() === 'WebGPU') {
      const retained = { ...HYDRA_SURFACE_SPEC, format: actual }
      pipeline.graph.textures.set(key, retained)
      current.set(surface, retained)
      continue
    }
    if (preserve.has(surface) && !backups.some(b => b.surface === surface)) {
      backups.push(backupSurfaceRead(pipeline, surface))
    }
    pipeline.backend.destroyTexture(state.read)
    pipeline.backend.destroyTexture(state.write)
    pipeline.surfaces.delete(surface)
    recreate = true
  }
  if (recreate) {
    try {
      pipeline.createSurfaces()
      for (const backup of backups) {
        const state = pipeline.surfaces.get(backup.surface)
        if (!state) throw new Error(`Hydra surface '${backup.surface}' was not recreated`)
        pipeline.backend.copyTexture(backup.name, state.read)
      }
    } finally {
      for (const backup of backups) pipeline.backend.destroyTexture(backup.name)
    }
  } else if (backups.length > 0) {
    try {
      for (const backup of backups) {
        const state = pipeline.surfaces.get(backup.surface)
        if (state) {
          pipeline.backend.copyTexture(backup.name, state.read)
        }
      }
    } finally {
      for (const backup of backups) pipeline.backend.destroyTexture(backup.name)
    }
  }
  PROMOTED_SURFACES.set(renderer, current)
}

function applyUniformBindings(pipeline, uniformBindings = {}) {
  for (const [temp, bindings] of Object.entries(uniformBindings)) {
    const passes = (pipeline?.graph?.passes || [])
      .filter(pass => pass.nodeId === `node_${temp}`)
    for (const pass of passes) {
      pass.uniforms ||= {}
      pass.uniformSpecs ||= {}
      for (const [name, binding] of Object.entries(bindings)) {
        pass.uniforms[name] = binding.value
        pass.uniformSpecs[name] = {
          min: binding.min,
          max: binding.max
        }
      }
    }
  }
}

export function installHydraCompiler(engine) {
  const prototype = engine?.CanvasRenderer?.prototype
  if (!prototype || typeof prototype.compile !== 'function' || typeof engine.compile !== 'function') {
    throw new Error('Noisemaker CanvasRenderer compiler is required')
  }
  if (prototype[INSTALLED]) return engine

  const compile = prototype.compile
  Object.defineProperty(prototype, INSTALLED, { value: true })
  prototype.compile = async function compileWithHydraParity(source, options = {}) {
    const compiled = engine.compile(source)
    const hydra = buildHydraShaderOverrides(compiled)

    const previous = PROMOTED_SURFACES.get(this) || new Map()
    const promoted = new Set(hydra.outputSurfaces)
    const retain = new Set(hydra.retainSurfaces)
    const preserve = new Set(hydra.preserveSurfaces)
    const current = new Map()

    const existingPipeline = this.pipeline
    const isWebGPU = existingPipeline?.backend?.getName?.() === 'WebGPU'

    for (const surface of promoted) {
      if (isWebGPU && preserve.has(surface)) {
        const state = existingPipeline?.surfaces?.get(surface)
        const actual = state && existingPipeline?.backend?.textures?.get(state.read)?.format
        if (actual && actual !== HYDRA_SURFACE_SPEC.format) {
          current.set(surface, { ...HYDRA_SURFACE_SPEC, format: actual })
          continue
        }
      }
      current.set(surface, HYDRA_SURFACE_SPEC)
    }
    for (const surface of retain) {
      if (current.has(surface) || !previous.has(surface)) continue
      current.set(surface, previous.get(surface))
    }

    const backups = []
    let restoreCreateSurfaces = null
    if (existingPipeline) {
      if (existingPipeline.surfaces && existingPipeline.backend?.textures) {
        for (const surface of existingPipeline.surfaces.keys()) {
          const state = existingPipeline.surfaces.get(surface)
          if (!state) continue
          const actual = existingPipeline.backend.textures.get(state.read)?.format
          const desired = current.get(surface)?.format || 'rgba16f'
          if (actual && actual !== desired && preserve.has(surface)) {
            backups.push(backupSurfaceRead(existingPipeline, surface))
          }
        }
      }

      const origCreateSurfaces = existingPipeline.createSurfaces
      if (typeof origCreateSurfaces === 'function') {
        const hadOwnProperty = Object.prototype.hasOwnProperty.call(existingPipeline, 'createSurfaces')
        const createSurfacesWithHydraParity = function() {
          if (this.graph?.textures) {
            for (const [surface, spec] of current) {
              this.graph.textures.set(`global_${surface}`, spec)
            }
          }
          return origCreateSurfaces.call(this)
        }
        existingPipeline.createSurfaces = createSurfacesWithHydraParity
        restoreCreateSurfaces = () => {
          if (existingPipeline.createSurfaces === createSurfacesWithHydraParity) {
            if (hadOwnProperty) {
              existingPipeline.createSurfaces = origCreateSurfaces
            } else {
              delete existingPipeline.createSurfaces
            }
          }
        }
      }
    }

    let pipeline
    let succeeded = false
    try {
      pipeline = await compile.call(this, source, {
        ...options,
        shaderOverrides: mergeShaderOverrides(
          hydra.shaderOverrides,
          options.shaderOverrides
        )
      })
      succeeded = true
    } finally {
      if (restoreCreateSurfaces) restoreCreateSurfaces()
      if (!succeeded) {
        for (const backup of backups) {
          existingPipeline?.backend?.destroyTexture?.(backup.name)
        }
      }
    }

    if (!pipeline || this.pipeline !== pipeline) {
      for (const backup of backups) {
        existingPipeline?.backend?.destroyTexture?.(backup.name)
      }
      return pipeline
    }

    if (existingPipeline && existingPipeline !== pipeline) {
      for (const backup of backups) {
        existingPipeline?.backend?.destroyTexture?.(backup.name)
      }
      backups.length = 0
    }

    applyUniformBindings(pipeline, hydra.uniformBindings)
    reconcileSurfaceFormats(
      this,
      hydra.outputSurfaces,
      hydra.preserveSurfaces,
      hydra.retainSurfaces,
      backups
    )
    return pipeline
  }

  return engine
}
