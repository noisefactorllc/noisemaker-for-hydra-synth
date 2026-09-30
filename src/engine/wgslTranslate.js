// GLSL ES 3.0 -> WGSL translation for the port's generated Hydra shaders.
//
// GAP-001 backend qualification: the port registers GLSL bodies only, so the
// engine's WebGPU backend fails every Hydra program with ERR_NO_WGSL_SOURCE
// (its resolveWGSLSource finds no `wgsl` key). This module translates the
// machine-generated GLSL of the port (per-effect programs from
// portHydraEffects.buildShader and fused chain programs from
// fuseHydraPlan.buildShader) into equivalent WGSL.
//
// The translation is constrained by the engine's WebGPU conventions
// (verified against the served engine core):
//   - Programs are single modules; entry points are detected from the source
//     (detectEntryPoints), so we emit `@vertex fn vs_main` (fullscreen
//     triangle, VertexOutput{position, uv}) and `@fragment fn fs_main`.
//   - Bind groups are built by createLegacyBindGroup: for each pass input in
//     declaration order a (texture, sampler) pair occupies two consecutive
//     binding indices, then one uniform buffer follows. The WGSL must
//     declare ALL of these bindings (even unused ones) or the auto layout
//     will not match the entries.
//   - Uniform values are packed BY NAME against the struct declared in the
//     WGSL source (the graph render path reads packedUniformLayout =
//     parsePackedUniformLayout(source) and packs via packUniformsWithLayout,
//     which writes float32 for every f32 member regardless of value
//     integrality). The Params struct therefore only names the members the
//     program reads, always as f32/vecNf. The separate positional
//     packUniforms path (int32 for integer-valued scalars) applies only to
//     shaders without declared bindings (createLegacyBindGroup), which the
//     generated WGSL never is; whether integer-valued uniforms survive the
//     name-based path byte-exactly is not pinned by anything in-repo and is
//     part of the pending pixel qualification.
//   - Coordinate conventions: GLSL _st is top-origin (the generated mains
//     compute `resolution.y - gl_FragCoord.y`), which equals the WebGPU
//     framebuffer coordinate — so the fused mains' flip term is DROPPED
//     (in.position is already top-origin), and textureSample() addressing is
//     top-origin while GLSL texture() is bottom-origin, so the mains'
//     explicit `1.0 - y` flips are dropped and st coordinates are used
//     directly; hydraGlslBody's injected bottom-origin flip in src/prev is
//     rewritten to its top-origin equivalent rather than kept verbatim.
// Parity expectation: f32 math on identical operation order; no tolerance is
// introduced here — measured deltas are recorded by the GAP-001 probes.

const GLSL_TYPE_TO_WGSL = {
  float: 'f32',
  int: 'i32',
  vec2: 'vec2f',
  vec3: 'vec3f',
  vec4: 'vec4f',
  mat2: 'mat2x2f',
  mat3: 'mat3x3f',
  mat4: 'mat4x4f'
}

export function glslTypeToWgsl(type) {
  const wgsl = GLSL_TYPE_TO_WGSL[type]
  if (!wgsl) throw new Error(`No WGSL equivalent for GLSL type '${type}'`)
  return wgsl
}

// Split "a, b(c, d), e" at top-level commas.
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim() !== '') parts.push(current)
  return parts.map(part => part.trim())
}

// Rewrites two-argument atan(...) calls to atan2(...) with balanced-paren
// scanning. Single-argument calls are left unchanged.
export function translateAtan(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const idx = text.indexOf('atan', i)
    if (idx === -1) {
      out += text.slice(i)
      break
    }
    const before = idx > 0 ? text[idx - 1] : ''
    const after = text[idx + 4]
    if (!/[A-Za-z0-9_]/.test(before) && after === '(' && !text.slice(idx).startsWith('atan2')) {
      let depth = 0
      let end = -1
      for (let j = idx + 4; j < text.length; j++) {
        if (text[j] === '(') depth++
        else if (text[j] === ')') {
          depth--
          if (depth === 0) { end = j; break }
        }
      }
      if (end !== -1) {
        const inner = text.slice(idx + 5, end)
        const args = splitTopLevel(inner)
        if (args.length === 2) {
          out += text.slice(i, idx) + 'atan2(' + inner + ')'
          i = end + 1
          continue
        }
      }
    }
    out += text.slice(i, idx + 4)
    i = idx + 4
  }
  return out
}

const IDENT = '[A-Za-z_][A-Za-z0-9_]*'

import utilityGlsl from '../glsl/utility-functions.js'

// The GLSL buildShader inlines the utility helpers (_luminance, _noise,
// _rgbToHsv, _hsvToRgb) into every program whose body calls them; the WGSL
// programs carry the same functions, translated once. Utility bodies use no
// samplers and no uniforms (no time/resolution references). Declared after
// IDENT because the translation templates interpolate it at call time.
const UTILITY_WGSL = Object.values(utilityGlsl)
  .map(utility => translateGlslStatements(utility.glsl, {}))
  .join('\n\n')

// Statement-level GLSL -> WGSL translation for the port's constrained GLSL
// subset (see the corpus inventory in test/wgsl-translate.test.mjs).
export function translateGlslStatements(glsl, { samplers = {}, uniformNames = [] } = {}) {
  let text = glsl
  // GLSL-only declarations that the WGSL program builder emits itself.
  text = text.replace(/^\s*#version.*$/gm, '')
  text = text.replace(/^\s*precision\s+.*$/gm, '')
  text = text.replace(/^\s*uniform\s+.*$/gm, '')
  text = text.replace(/^\s*out\s+vec4\s+\w+\s*;$/gm, '')
  // texture2D(tex, coord) and hydraGlslBody-converted texture(tex, coord)
  // both become textureSample(tex, tex_sampler, coord). Texture coordinates
  // here are already top-origin st values (see module comment), so no flip
  // is added: hydraGlslBody's injected bottom-origin flip
  // fract(vec2(x, 1.0 - y)) is rewritten to its top-origin equivalent
  // fract(vec2(x, y)) (1 - fract(1 - y) === fract(y) componentwise), which
  // keeps feedback wrap-around while sampling the same texel.
  text = text.replace(
    /\btexture(?:2D)?\s*\(\s*(\w+)\s*,\s*fract\s*\(\s*vec2\s*\(\s*([^,()]+?)\s*,\s*1\.0\s*-\s*([^()]+?)\s*\)\s*\)\s*/g,
    (m, tex, x, y) => {
      const sampler = samplers[tex]
      if (!sampler) throw new Error(`texture('${tex}') has no known WGSL sampler binding`)
      return `textureSample(${tex}, ${sampler}, fract(vec2(${x}, ${y})))`
    })
  text = text.replace(/\btexture(?:2D)?\s*\(\s*(\w+)\s*,/g, (m, tex) => {
    const sampler = samplers[tex]
    if (!sampler) throw new Error(`texture('${tex}') has no known WGSL sampler binding`)
    return `textureSample(${tex}, ${sampler},`
  })
  // mod(a, b) is componentwise in GLSL; WGSL has neither % for floats nor
  // user function overloading, so each call site is inlined as
  // ((a) - (b) * floor((a) / (b))) with balanced-paren argument extraction
  // (the corpus's mod arguments are side-effect-free).
  {
    let out = ''
    let i = 0
    for (;;) {
      const m = /\bmod\s*\(/.exec(text.slice(i))
      if (!m) { out += text.slice(i); break }
      const start = i + m.index
      out += text.slice(i, start)
      const open = start + m[0].length - 1
      let depth = 0
      let end = -1
      for (let j = open; j < text.length; j++) {
        if (text[j] === '(') depth++
        else if (text[j] === ')') { depth--; if (depth === 0) { end = j; break } }
      }
      if (end === -1) throw new Error('unbalanced mod( in GLSL source')
      const args = splitTopLevel(text.slice(open + 1, end))
      if (args.length !== 2) throw new Error(`mod() with ${args.length} arguments is not supported`)
      const a = args[0]
      const b = args[1]
      out += `((${a}) - (${b}) * floor((${a}) / (${b})))`
      i = end + 1
    }
    text = out
  }
  text = translateAtan(text)
  // Constructors and casts.
  text = text.replace(new RegExp(`\\bconst\\s+(float|int|vec[234]|mat[234])\\s+(${IDENT})\\s*=`, 'g'),
    (_, type, name) => `const ${name}: ${glslTypeToWgsl(type)} =`)
  text = text.replace(/\bvec([234])\s*\(/g, (_, n) => `vec${n}f(`)
  text = text.replace(/\bmat([234])\s*\(/g, (_, n) => `mat${n}x${n}f(`)
  text = text.replace(/\bfloat\s*\(/g, 'f32(')
  text = text.replace(/\bint\s*\(/g, 'i32(')
  // GLSL writes results through the fixed out variable; WGSL fragment entry
  // points return the color.
  text = text.replace(/\bfragColor\s*=/g, 'return ')
  // Variable declarations. The port's GLSL corpus declares one variable per
  // statement (pinned by the unit tests; a multi-declarator would fail the
  // declaration rewrite and surface as invalid WGSL).
  text = text.replace(new RegExp(`\\b(float|int|vec[234]|mat[234])\\s+(${IDENT})\\s*=`, 'g'),
    (_, type, name) => `var ${name}: ${glslTypeToWgsl(type)} =`)
  text = text.replace(new RegExp(`\\b(float|int|vec[234])\\s+(${IDENT})\\s*;`, 'g'),
    (_, type, name) => `var ${name}: ${glslTypeToWgsl(type)};`)
  // GLSL ++/-- have no WGSL equivalent.
  text = text.replace(new RegExp(`(${IDENT})\\s*\\+\\+`, 'g'), '$1 = $1 + 1')
  text = text.replace(new RegExp(`(${IDENT})\\s*--`, 'g'), '$1 = $1 - 1')
  if (/%/.test(text)) throw new Error("GLSL '%' has no WGSL float equivalent and is not in the port's corpus")
  // Global uniforms become Params members. Fused programs additionally
  // declare their dynamic per-chain uniforms (e.g. oscillator references
  // `_hydra_<temp>_<input>`); callers pass those names so their bare GLSL
  // identifiers are rewritten to Params members too.
  const globalUniformNames = ['time', 'resolution', ...uniformNames]
  for (const name of globalUniformNames) {
    text = text.replace(new RegExp(`\\b${name}\\b`, 'g'), `params.${name}`)
  }
  // Function signatures: `vec4 name(vec2 a, float b) {` -> `fn name(a: vec2f, b: f32) -> vec4f {`
  text = text.replace(
    new RegExp(`\\b(void|float|int|vec[234]|mat[234])\\s+(${IDENT})\\s*\\(([^)]*)\\)\\s*\\{`, 'g'),
    (_, returnType, name, params) => {
      const wgslParams = params.trim() === ''
        ? ''
        : splitTopLevel(params).map(param => {
            const m = param.match(new RegExp(`^(float|int|vec[234]|mat[234])\\s+(${IDENT})$`))
            if (!m) throw new Error(`Unsupported GLSL parameter '${param.trim()}'`)
            return `${m[2]}: ${glslTypeToWgsl(m[1])}`
          }).join(', ')
      const ret = returnType === 'void' ? '' : ` -> ${glslTypeToWgsl(returnType)}`
      return `fn ${name}(${wgslParams})${ret} {`
    })
  return text
}

const HELPERS = ''

const VERTEX_STAGE = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  let pos = positions[vertexIndex];
  var out: VertexOutput;
  out.position = vec4f(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + vec2f(0.5, 0.5);
  return out;
}
`

// Build the binding declarations and Params struct for a program.
// inputs: ordered [{ name, kind: 'texture' }] — one (texture, sampler) pair
// each, in pass-input declaration order. uniforms: ordered
// [{ name, wgsl }] where wgsl is the declared member type ('f32', 'i32',
// 'vec2f', ...). Returns { bindings, struct, uniformBindingIndex, samplers }.
export function buildProgramInterface({ inputs: rawInputs, uniforms }) {
  const inputs = rawInputs.map(i => (typeof i === 'string' ? { name: i } : i))
  const lines = []
  const samplers = {}
  let binding = 0
  for (const input of inputs) {
    lines.push(`@group(0) @binding(${binding++}) var ${input.name}: texture_2d<f32>;`)
    const samplerName = `${input.name}_sampler`
    lines.push(`@group(0) @binding(${binding++}) var ${samplerName}: sampler;`)
    samplers[input.name] = samplerName
  }
  let struct = ''
  if (uniforms.length > 0) {
    const members = uniforms.map(u => `  ${u.name}: ${u.wgsl},`).join('\n')
    struct = `struct Params {\n${members}\n}\n@group(0) @binding(${binding++}) var<uniform> params: Params;`
  }
  return { bindings: lines.join('\n'), struct, uniformBindingIndex: uniforms.length > 0 ? binding - 1 : null, samplers }
}

// Params member type for a packed uniform VALUE, mirroring the engine's
// name-based float packing: everything is f32. Kept for callers that need a
// type from a value; arrays map to vecNf.
export function wgslTypeForUniformValue(value, name) {
  if (Array.isArray(value)) {
    if (value.length < 2 || value.length > 4) throw new Error(`Unsupported uniform array length for '${name}': ${value.length}`)
    return `vec${value.length}f`
  }
  return 'f32'
}

// Uniform values are packed by name against the struct the WGSL declares
// (packUniformsWithLayout over parseWgslStructByteLayout), always as float32.
// The Params struct therefore only needs to name the members the program
// reads — unknown merged uniforms (e.g. wrapper inputs that the fused
// program inlined as literals) are skipped by the engine.
export function translateFusedProgram(fusedGlsl, { textureInputs, uniformNames }) {
  const uniforms = []
  for (const name of uniformNames || []) {
    uniforms.push({ name, wgsl: 'f32' })
  }
  uniforms.push({ name: 'resolution', wgsl: 'vec2f' })
  uniforms.push({ name: 'time', wgsl: 'f32' })
  const inputs = [...textureInputs]
  if (!inputs.some(i => (typeof i === 'string' ? i : i.name) === 'prevBuffer')) inputs.push('prevBuffer')
  const { bindings, struct, samplers } = buildProgramInterface({ inputs, uniforms })
  let text = translateGlslStatements(fusedGlsl, { samplers, uniformNames })
  // The fused GLSL's `void main()` becomes the fragment entry point, reading
  // framebuffer coordinates from the vertex stage's position builtin (the
  // generated GLSL computes top-origin st as
  // (x, resolution.y - gl_FragCoord.y) / resolution, which equals
  // in.position.xy / resolution in WebGPU framebuffer coordinates — so the
  // GLSL y-flip term is dropped, not substituted).
  text = text.replace(/\bfn main\(\)/, '@fragment\nfn fs_main(in: VertexOutput) -> @location(0) vec4f')
  text = text.replace(/\bfn main\(/, '@fragment\nfn fs_main(in: VertexOutput) -> @location(0) vec4f')
  text = text.replace(/gl_FragCoord\.x/g, 'in.position.x')
  text = text.replace(/gl_FragCoord\.y/g, 'in.position.y')
  // Drop the GLSL bottom-origin flip: in.position is already top-origin, so
  // (x, resolution.y - y_glsl) is exactly (x, y_webgpu).
  text = text.replace(/params\.resolution\.y\s*-\s*in\.position\.y/g, 'in.position.y')
  // Self-check: every dynamic uniform reference must have been rewritten to
  // a Params member. A bare `_hydra_*` uniform identifier would be an
  // undeclared identifier in WGSL (the engine compiles per program, so a
  // broken source would only fail at render time on the far side of a
  // review). Node wrapper names (_hydra_gradient etc.) are legitimate.
  for (const name of uniformNames || []) {
    if (new RegExp(`(?<!params\\.)\\b${name}\\b`).test(text)) {
      throw new Error(`fused WGSL translation left a bare dynamic uniform reference: ${name}`)
    }
  }
  // The translator stripped the GLSL uniform declarations; inject the
  // bindings, Params struct, helpers, utility functions, and vertex stage
  // before the code.
  return `${bindings}\n\n${struct}\n\n${HELPERS}\n\n${UTILITY_WGSL}\n\n${VERTEX_STAGE}\n\n${text}`
}

// Full WGSL program for a single (non-fused) Hydra effect definition,
// mirroring portHydraEffects' TEMPLATES. `inputs` are the definition's pass
// inputs in order (texture names), `wrapperInputs` the float/vec uniforms.
export function buildEffectWgsl({ name, type, glsl: body, wrapperInputs, passInputs }) {
  const uniforms = [
    ...wrapperInputs.map(i => ({ name: i.name, wgsl: glslTypeToWgsl(i.type) })),
    { name: 'resolution', wgsl: 'vec2f' },
    { name: 'time', wgsl: 'f32' }
  ]
  const { bindings, struct, samplers } = buildProgramInterface({ inputs: passInputs, uniforms })
  const translated = translateGlslStatements(body, { samplers })
  const ret = (type === 'coord' || type === 'combineCoord') ? 'vec2f' : 'vec4f'
  const leading = {
    src: [['_st', 'vec2f']],
    coord: [['_st', 'vec2f']],
    color: [['_c0', 'vec4f']],
    combine: [['_c0', 'vec4f'], ['_c1', 'vec4f']],
    combineCoord: [['_st', 'vec2f'], ['_c0', 'vec4f']]
  }[type]
  const fnName = `_hydra_${name}`
  const params = leading.map(([arg, t]) => `${arg}: ${t}`)
  const extraParams = wrapperInputs.map(i => `${i.name}: ${glslTypeToWgsl(i.type)}`)
  const wrapper = `fn ${fnName}(${[...params, ...extraParams].join(', ')}) -> ${ret} {\n${translated}\n}`

  // Fragment main, mirroring each GLSL template exactly (coordinate flips
  // resolved for WGSL's top-origin texture addressing — see module comment).
  const sample = (tex, coord) => `textureSample(${tex}, ${samplers[tex]}, ${coord})`
  let main
  const st = 'let _st = in.position.xy / params.resolution;'
  if (type === 'src') {
    main = `${st}\n  return ${fnName}(_st${wrapperInputs.map(i => `, params.${i.name}`).join('')});`
  } else if (type === 'coord') {
    main = `${st}\n  let newUV = ${fnName}(_st${wrapperInputs.map(i => `, params.${i.name}`).join('')});\n  return ${sample('inputTex', 'vec2f(newUV.x, newUV.y)')};`
  } else if (type === 'color') {
    main = `${st}\n  let _c0 = ${sample('inputTex', '_st')};\n  return ${fnName}(_c0${wrapperInputs.map(i => `, params.${i.name}`).join('')});`
  } else if (type === 'combine') {
    main = `${st}\n  let _c0 = ${sample('inputTex', '_st')};\n  let _c1 = ${sample('tex', '_st')};\n  return ${fnName}(_c0, _c1${wrapperInputs.map(i => `, params.${i.name}`).join('')});`
  } else if (type === 'combineCoord') {
    main = `${st}\n  let _c0 = ${sample('tex', '_st')};\n  let newUV = ${fnName}(_st, _c0${wrapperInputs.map(i => `, params.${i.name}`).join('')});\n  return ${sample('inputTex', 'vec2f(newUV.x, newUV.y)')};`
  } else {
    throw new Error(`Unknown Hydra effect type '${type}'`)
  }
  const mainFn = `
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  ${main}
}`
  return `${bindings}\n\n${struct}\n\n${HELPERS}\n\n${UTILITY_WGSL}\n\n${VERTEX_STAGE}\n\n${wrapper}\n${mainFn}`
}
