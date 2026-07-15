import glslFunctions from '../glsl/glsl-functions.js'
import utilityGlsl from '../glsl/utility-functions.js'
import { getEngine } from './index.js'
import {
  hydraGlslBody,
  isExecutableHydraEffect
} from './hydraGlsl.js'

export const HYDRA_NAMESPACE = 'hydra'
const CALLABLE_ALIASES = { osc: 'hydraOsc' }

const TYPE_LEADING = {
  src:          [{ type: 'vec2', name: '_st' }],
  coord:        [{ type: 'vec2', name: '_st' }],
  color:        [{ type: 'vec4', name: '_c0' }],
  combine:      [{ type: 'vec4', name: '_c0' }, { type: 'vec4', name: '_c1' }],
  combineCoord: [{ type: 'vec2', name: '_st' }, { type: 'vec4', name: '_c0' }]
}

function processInputs(effect) {
  const leading = TYPE_LEADING[effect.type] || []
  const all = leading.concat(effect.inputs || [])
  return all.slice(1)
}

function isSurfaceInput(input) {
  return input.type === 'sampler2D' || input.name === '_c0' || input.name === '_c1'
}

function classifyInputs(inputs) {
  const wrapperInputs = []
  const samplerInputs = []
  for (const def of inputs) {
    if (isSurfaceInput(def)) {
      const samplerName = samplerInputs.length === 0 ? 'tex' : 'tex2'
      samplerInputs.push({ inputName: def.name, samplerName, def })
    } else {
      wrapperInputs.push(def)
    }
  }
  return { wrapperInputs, samplerInputs }
}

const TEMPLATES = {
  src: {
    needsInputTex: false,
    body: (sig, args, _s1, _s2) => `
void main() {
  vec2 _st = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y) / resolution.xy;
  fragColor = ${sig}(_st${args});
}`
  },
  coord: {
    needsInputTex: true,
    body: (sig, args) => `
void main() {
  vec2 _st = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y) / resolution.xy;
  vec2 newUV = ${sig}(_st${args});
  fragColor = texture(inputTex, vec2(newUV.x, 1.0 - newUV.y));
}`
  },
  color: {
    needsInputTex: true,
    body: (sig, args) => `
void main() {
  vec2 _st = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y) / resolution.xy;
  vec4 _c0 = texture(inputTex, vec2(_st.x, 1.0 - _st.y));
  fragColor = ${sig}(_c0${args});
}`
  },
  combine: {
    needsInputTex: true,
    body: (sig, args, sampler1) => `
void main() {
  vec2 _st = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y) / resolution.xy;
  vec4 _c0 = texture(inputTex, vec2(_st.x, 1.0 - _st.y));
  vec4 _c1 = texture(${sampler1}, vec2(_st.x, 1.0 - _st.y));
  fragColor = ${sig}(_c0, _c1${args});
}`
  },
  combineCoord: {
    needsInputTex: true,
    body: (sig, args, sampler1) => `
void main() {
  vec2 _st = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y) / resolution.xy;
  vec4 _c0 = texture(${sampler1}, vec2(_st.x, 1.0 - _st.y));
  vec2 newUV = ${sig}(_st, _c0${args});
  fragColor = texture(inputTex, vec2(newUV.x, 1.0 - newUV.y));
}`
  }
}

function inputToGlobalSpec(input) {
  if (isSurfaceInput(input)) {
    return {
      type: 'surface',
      default: 'none',
      ui: { label: input.name }
    }
  }
  return {
    type: input.type,
    default: input.default,
    uniform: input.name,
    ui: { label: input.name, control: input.type === 'float' ? 'slider' : false }
  }
}

function inlineUtilities(body) {
  const used = []
  for (const [name, util] of Object.entries(utilityGlsl)) {
    const re = new RegExp(`\\b${name}\\b\\s*\\(`)
    if (re.test(body)) used.push(util.glsl)
  }
  return used.join('\n')
}

function wrapperName(funcName) { return `_hydra_${funcName}` }

function buildSignature(funcName, type, wrapperInputs) {
  const leading = ({
    src:          [{ type: 'vec2', name: '_st' }],
    coord:        [{ type: 'vec2', name: '_st' }],
    color:        [{ type: 'vec4', name: '_c0' }],
    combine:      [{ type: 'vec4', name: '_c0' }, { type: 'vec4', name: '_c1' }],
    combineCoord: [{ type: 'vec2', name: '_st' }, { type: 'vec4', name: '_c0' }]
  })[type]

  const ret = (type === 'coord' || type === 'combineCoord') ? 'vec2' : 'vec4'
  const allArgs = leading.concat(wrapperInputs)
  const fnName = wrapperName(funcName)
  const signature = `${ret} ${fnName}(${allArgs.map(i => `${i.type} ${i.name}`).join(', ')})`
  const callArgs = wrapperInputs.length > 0
    ? ', ' + wrapperInputs.map(i => i.name).join(', ')
    : ''
  return { signature, callArgs, ret, fnName }
}

function buildShader(effect) {
  const { name, type } = effect
  const tmpl = TEMPLATES[type]
  if (!tmpl) throw new Error(`Hydra effect '${name}' has unknown type '${type}'`)
  const body = hydraGlslBody(effect)

  const inputs = processInputs(effect)
  const { wrapperInputs, samplerInputs } = classifyInputs(inputs)
  const { signature, callArgs, fnName } = buildSignature(name, type, wrapperInputs)
  const utilities = inlineUtilities(body)

  const uniformLines = wrapperInputs
    .map(i => `uniform ${i.type} ${i.name};`)
    .join('\n')

  const samplerLines = []
  if (tmpl.needsInputTex) samplerLines.push('uniform sampler2D inputTex;')
  for (const s of samplerInputs) samplerLines.push(`uniform sampler2D ${s.samplerName};`)

  const sampler1 = samplerInputs[0]?.samplerName || null
  const sampler2 = samplerInputs[1]?.samplerName || null

  const wrapper = `${signature} {
  ${body}
}`

  return `#version 300 es
precision highp float;

uniform vec2 resolution;
uniform float time;
// prevBuffer = previous-frame contents of the current output.
// Declared unconditionally so the built-in prev effect (and any user effect
// added via setFunction) can sample it without redeclaring.
uniform sampler2D prevBuffer;
${samplerLines.join('\n')}
${uniformLines}

out vec4 fragColor;

${utilities}

${wrapper}
${tmpl.body(fnName, callArgs, sampler1, sampler2)}
`
}

function buildEffectDefinition(effect, Effect) {
  const { name, type } = effect
  const tmpl = TEMPLATES[type]
  if (!tmpl) throw new Error(`Hydra effect '${name}' has unknown type '${type}'`)

  const inputs = processInputs(effect)
  const { wrapperInputs, samplerInputs } = classifyInputs(inputs)

  const globals = {}
  for (const input of wrapperInputs) {
    globals[input.name] = inputToGlobalSpec(input)
  }
  for (const s of samplerInputs) {
    globals[s.samplerName] = {
      type: 'surface',
      default: 'none',
      ui: { label: s.samplerName }
    }
  }

  const passInputs = {}
  if (tmpl.needsInputTex) passInputs.inputTex = 'inputTex'
  for (const s of samplerInputs) passInputs[s.samplerName] = s.samplerName
  passInputs.prevBuffer = 'feedback'

  const passUniforms = {}
  for (const input of wrapperInputs) {
    passUniforms[input.name] = input.name
  }

  return new Effect({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    namespace: HYDRA_NAMESPACE,
    func: name,
    tags: [type],
    description: `Hydra ${type} effect: ${name}`,
    globals,
    textures: {
      out: { format: 'rgba32f' }
    },
    passes: [
      {
        name: 'render',
        program: name,
        type: 'render',
        inputs: passInputs,
        uniforms: passUniforms,
        outputs: { fragColor: 'outputTex' }
      }
    ]
  })
}

/**
 * Register one Hydra effect against the loaded engine module's registries.
 * Engine module passed explicitly so this function works during init
 * (after loadEngine resolved) without re-importing.
 */
export function registerHydraEffect(effect, engine) {
  const eng = engine || getEngine()
  const definition = buildEffectDefinition(effect, eng.Effect)
  const shader = buildShader(effect)

  if (!definition.shaders) definition.shaders = {}
  definition.shaders[effect.name] = { glsl: shader }

  // Effect registry — multiple keys for resolver flexibility.
  eng.registerEffect(effect.name, definition)
  eng.registerEffect(`${HYDRA_NAMESPACE}.${effect.name}`, definition)
  eng.registerEffect(`${HYDRA_NAMESPACE}/${effect.name}`, definition)
  const callableName = CALLABLE_ALIASES[effect.name] || effect.name
  if (callableName !== effect.name) {
    eng.registerEffect(`${HYDRA_NAMESPACE}.${callableName}`, definition)
  }

  // DSL op + starter-op registration (mirrors canvas.js's
  // registerEffectWithRuntime, which we don't call here because we already
  // have the instance and don't need its runtime-side fetch behavior).
  const args = Object.entries(definition.globals || {}).map(([key, spec]) => ({
    name: key,
    type: spec.type === 'vec4' ? 'color' : spec.type,
    default: spec.default,
    enum: spec.enum || spec.enumPath,
    enumPath: spec.enum || spec.enumPath,
    min: spec.min,
    max: spec.max,
    uniform: spec.uniform,
    choices: spec.choices
  }))
  const opSpec = { name: callableName, args }
  eng.registerOp(`${HYDRA_NAMESPACE}.${callableName}`, opSpec)

  if (eng.isStarterEffect({
    namespace: HYDRA_NAMESPACE, name: effect.name, instance: definition
  })) {
    eng.registerStarterOps([
      callableName,
      `${HYDRA_NAMESPACE}.${callableName}`
    ])
  }

  return definition
}

export function registerAllHydraEffects(engine) {
  const eng = engine || getEngine()
  const builtins = glslFunctions().filter(isExecutableHydraEffect)
  for (const effect of builtins) {
    registerHydraEffect(effect, eng)
  }
}
