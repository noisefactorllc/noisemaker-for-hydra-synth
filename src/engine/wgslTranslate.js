// GLSL ES 3.0 -> WGSL translation for the port's generated Hydra shaders.
//
// Backend qualification: the port registers GLSL bodies only, so the
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
//   - Coordinate conventions: GLSL _st is logical top-origin (the generated
//     mains compute `resolution.y - gl_FragCoord.y`). Noisemaker presents
//     WebGPU internal textures with a vertical flip, so WGSL must compute
//     the same logical _st from `resolution.y - in.position.y` and retain
//     the explicit `1.0 - y` when sampling internal textures.
// Parity expectation: f32 math on identical operation order; no tolerance is
// introduced here — measured deltas are recorded by the WebGPU probes.

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
// Scalar-argument splatting for componentwise builtin overloads. GLSL
// broadcasts a scalar argument against vector ones (step(0.0, c),
// max(0.6 - vec4(...), 0.0)); WGSL has no such mixed overloads.
// Declared before UTILITY_WGSL, whose initializer runs the translator.
const OVERLOAD_CALL = /\b(?:min|max|clamp|step|smoothstep)\s*\(/
const SCALAR_LITERAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/

const UTILITY_WGSL = Object.values(utilityGlsl)
  .map(utility => translateGlslStatements(utility.glsl, {}))
  .join('\n\n')

// Vector width of one call argument, or null when undetectable. A bare
// identifier resolves from the nearest preceding `var NAME: vecNf`
// declaration in the enclosing function's body.
function argVectorWidth(arg, scope) {
  const ctor = arg.match(/\bvec([234])f\s*\(/)
  if (ctor) return Number(ctor[1])
  const swizzle = arg.match(/\.([xyzwrgba]{2,4})\b/)
  if (swizzle) return swizzle[1].length
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(arg)) {
    const decls = [...scope.matchAll(new RegExp(`\\bvar\\s+${arg}\\s*:\\s*vec([234])f\\b`, 'g'))]
    const last = decls[decls.length - 1]
    if (last) return Number(last[1])
  }
  return null
}

// Splat pure scalar-literal arguments to the detected vector width within
// one lexical scope (a function body, or the whole text when it holds no
// function bodies).
function splatScalarCalls(text) {
  let out = ''
  let i = 0
  for (;;) {
    const m = OVERLOAD_CALL.exec(text.slice(i))
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
    if (end === -1) throw new Error('unbalanced min/max/clamp/step( in GLSL source')
    const args = splitTopLevel(text.slice(open + 1, end))
    const arity = args.map(arg => argVectorWidth(arg, out + text.slice(i, start)))
      .find(Boolean)
    if (arity && (args.length === 2 || args.length === 3)) {
      for (let n = 0; n < args.length; n++) {
        if (SCALAR_LITERAL.test(args[n])) args[n] = `vec${arity}f(${args[n]})`
      }
    }
    out += `${m[0]}${args.join(', ')})`
    i = end + 1
  }
  return out
}

// Apply the splat pass per function body, so a bare identifier's declared
// width is resolved within its own function (the GLSL-style fn headers
// still carry return types at this pipeline stage). Text outside function
// bodies is passed through unchanged.
function splatScalarOverloads(text) {
  const header = /\b(?:void|float|int|vec[234]|mat[234])\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/g
  const bodies = []
  let m
  while ((m = header.exec(text))) {
    const open = m.index + m[0].length - 1
    let depth = 0
    let end = -1
    for (let j = open; j < text.length; j++) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') { depth--; if (depth === 0) { end = j; break } }
    }
    if (end === -1) break
    bodies.push([open, end])
    header.lastIndex = end + 1
  }
  if (bodies.length === 0) return splatScalarCalls(text)
  let out = ''
  let cursor = 0
  for (const [open, end] of bodies) {
    out += text.slice(cursor, open + 1)
    out += splatScalarCalls(text.slice(open + 1, end))
    cursor = end
  }
  out += text.slice(cursor)
  return out
}

// WGSL function parameters are immutable; GLSL parameters are mutable
// copies. An effect body that assigns to a leading parameter (`_st *=
// scale;` in voronoi, `_st.x += ...` in the scroll family) must be
// translated as a renamed parameter plus a local mutable copy, or Tint
// rejects the program with "cannot assign to parameter".
const ASSIGNMENT_OP = '(?:\\+=|-=|\\*=|/=|(?<![=!<>])=(?!=))'

function paramIsMutated(body, name) {
  return new RegExp(`(?<![\\w.])${name}\\b(?:\\.[A-Za-z0-9_]+)*\\s*${ASSIGNMENT_OP}`).test(body)
}

// Rewrite WGSL fn signatures so no declared parameter is assigned: the
// body keeps its references under the original name, which now resolves to
// the injected local copy, and the parameter itself is renamed to
// `<name>_in`. Used on fully translated programs (the fused path), whose
// fn signatures are already WGSL.
function fixMutatedFnParams(text) {
  const header = /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*[^{;]*)?\{/g
  let out = ''
  let cursor = 0
  let m
  while ((m = header.exec(text))) {
    const open = m.index + m[0].length - 1
    let depth = 0
    let end = -1
    for (let j = open; j < text.length; j++) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') { depth--; if (depth === 0) { end = j; break } }
    }
    if (end === -1) break
    header.lastIndex = end + 1
    const body = text.slice(open + 1, end)
    const params = splitTopLevel(m[2])
      .map(param => param.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/))
      .filter(Boolean)
    const decls = []
    const rewritten = params.map(param => {
      const name = param[1]
      const type = param[2].trim()
      if (paramIsMutated(body, name)) {
        decls.push(`var ${name}: ${type} = ${name}_in;`)
        return `${name}_in: ${type}`
      }
      return `${name}: ${type}`
    })
    if (decls.length > 0) {
      const fixedHeader = m[0].replace(m[2], rewritten.join(', '))
      out += text.slice(cursor, m.index) + fixedHeader + '\n' + decls.join('\n') + '\n' + body
      cursor = end
    } else {
      out += text.slice(cursor, end)
      cursor = end
    }
  }
  out += text.slice(cursor)
  return out
}

// Structural checker over a finished WGSL program: any fn whose body
// assigns to one of its own declared parameters. Exported so the unit lint
// pins the invariant corpus-wide with the same rule the translator applies.
export function wgslParameterAssignments(wgsl) {
  const violations = []
  const header = /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*[^{;]*)?\{/g
  let m
  while ((m = header.exec(wgsl))) {
    const open = m.index + m[0].length - 1
    let depth = 0
    let end = -1
    for (let j = open; j < wgsl.length; j++) {
      if (wgsl[j] === '{') depth++
      else if (wgsl[j] === '}') { depth--; if (depth === 0) { end = j; break } }
    }
    if (end === -1) break
    header.lastIndex = end + 1
    const body = wgsl.slice(open + 1, end)
    for (const param of splitTopLevel(m[2])) {
      const name = param.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/)?.[1]
      if (name && paramIsMutated(body, name)) violations.push(`${m[1]}.${name}`)
    }
  }
  return violations
}

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
  // here retain their explicit y flip to sample the engine's WebGPU
  // internal texture orientation (see module comment).
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
  // GLSL broadcasts scalar arguments in componentwise builtin calls; WGSL's
  // min/max/clamp/step/smoothstep require matching argument types, so pure
  // scalar-literal arguments are splatted to the vector width of a sibling
  // argument (from a vecNf constructor, a swizzle, or — for bare
  // identifiers — the nearest preceding `var` declaration in the same
  // function, which is the visible one because WGSL forbids shadowing).
  // Runs after the declaration rewrite so declared widths are readable.
  text = splatScalarOverloads(text)
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
  // generated GLSL computes logical top-origin st as
  // (x, resolution.y - gl_FragCoord.y) / resolution. The engine flips its
  // WebGPU texture during presentation, so WGSL retains the y-flip term.
  text = text.replace(/\bfn main\(\)/, '@fragment\nfn fs_main(in: VertexOutput) -> @location(0) vec4f')
  text = text.replace(/\bfn main\(/, '@fragment\nfn fs_main(in: VertexOutput) -> @location(0) vec4f')
  text = text.replace(/gl_FragCoord\.x/g, 'in.position.x')
  text = text.replace(/gl_FragCoord\.y/g, 'in.position.y')
  // GLSL parameters are mutable copies; WGSL parameters are immutable. The
  // fused wrappers inherit the effect bodies, some of which assign to their
  // leading parameter (voronoi's `_st *= scale`, the scroll family's
  // `_st.x += ...`). Rename each mutated parameter and inject the local
  // mutable copy its body expects.
  text = fixMutatedFnParams(text)
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
  // GLSL parameters are mutable copies; WGSL parameters are immutable. A
  // body that assigns to any of its parameters (voronoi's `_st *= scale`,
  // the scroll family's `_st.x += ...`) gets a renamed parameter plus the
  // local mutable copy it expects.
  const candidateParams = [
    ...leading,
    ...wrapperInputs.map(i => [i.name, glslTypeToWgsl(i.type)])
  ]
  const mutated = candidateParams.filter(([arg]) => paramIsMutated(translated, arg))
  const paramToken = ([arg, t]) => (mutated.some(([m]) => m === arg) ? `${arg}_in: ${t}` : `${arg}: ${t}`)
  const fnName = `_hydra_${name}`
  const params = leading.map(paramToken)
  const extraParams = wrapperInputs.map(i => paramToken([i.name, glslTypeToWgsl(i.type)]))
  const copies = mutated.map(([arg, t]) => `var ${arg}: ${t} = ${arg}_in;`)
  const wrapper = `fn ${fnName}(${[...params, ...extraParams].join(', ')}) -> ${ret} {\n${copies.length > 0 ? copies.join('\n') + '\n' : ''}${translated}\n}`

  // Fragment main, mirroring each GLSL template and the engine's internal
  // texture orientation (see module comment).
  const sample = (tex, coord) => `textureSample(${tex}, ${samplers[tex]}, ${coord})`
  let main
  const st = 'let _st = vec2f(in.position.x, params.resolution.y - in.position.y) / params.resolution;'
  if (type === 'src') {
    main = `${st}\n  return ${fnName}(_st${wrapperInputs.map(i => `, params.${i.name}`).join('')});`
  } else if (type === 'coord') {
    main = `${st}\n  let newUV = ${fnName}(_st${wrapperInputs.map(i => `, params.${i.name}`).join('')});\n  return ${sample('inputTex', 'vec2f(newUV.x, 1.0 - newUV.y)')};`
  } else if (type === 'color') {
    main = `${st}\n  let _c0 = ${sample('inputTex', 'vec2f(_st.x, 1.0 - _st.y)')};\n  return ${fnName}(_c0${wrapperInputs.map(i => `, params.${i.name}`).join('')});`
  } else if (type === 'combine') {
    main = `${st}\n  let _c0 = ${sample('inputTex', 'vec2f(_st.x, 1.0 - _st.y)')};\n  let _c1 = ${sample('tex', 'vec2f(_st.x, 1.0 - _st.y)')};\n  return ${fnName}(_c0, _c1${wrapperInputs.map(i => `, params.${i.name}`).join('')});`
  } else if (type === 'combineCoord') {
    main = `${st}\n  let _c0 = ${sample('tex', 'vec2f(_st.x, 1.0 - _st.y)')};\n  let newUV = ${fnName}(_st, _c0${wrapperInputs.map(i => `, params.${i.name}`).join('')});\n  return ${sample('inputTex', 'vec2f(newUV.x, 1.0 - newUV.y)')};`
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
