import test from 'node:test'
import assert from 'node:assert/strict'
import glslFunctions from '../src/glsl/glsl-functions.js'
import utilityGlsl from '../src/glsl/utility-functions.js'
import { hydraGlslBody, isExecutableHydraEffect } from '../src/engine/hydraGlsl.js'
import {
  buildEffectWgsl,
  buildProgramInterface,
  glslTypeToWgsl,
  translateAtan,
  translateFusedProgram,
  translateGlslStatements,
  wgslTypeForUniformValue
} from '../src/engine/wgslTranslate.js'

// WebGPU backend: the port's generated GLSL must translate to WGSL
// that satisfies the engine's WebGPU program conventions (explicit
// @group/@binding declarations matching the pass-input pairs plus one uniform
// buffer; a Params struct whose members are packed by name; detected
// vs_main/fs_main entry points). These tests pin the translation structurally.

const LEADING = {
  src: [{ type: 'vec2', name: '_st' }],
  coord: [{ type: 'vec2', name: '_st' }],
  color: [{ type: 'vec4', name: '_c0' }],
  combine: [{ type: 'vec4', name: '_c0' }, { type: 'vec4', name: '_c1' }],
  combineCoord: [{ type: 'vec2', name: '_st' }, { type: 'vec4', name: '_c0' }]
}

function effectInputs(effect) {
  // Mirrors portHydraEffects.processInputs/classifyInputs.
  const all = (LEADING[effect.type] || []).map(x => ({ ...x })).concat(effect.inputs || []).slice(1)
  const wrapperInputs = []
  const samplerInputs = []
  for (const input of all) {
    if (input.type === 'sampler2D' || input.name === '_c0' || input.name === '_c1') {
      samplerInputs.push(samplerInputs.length === 0 ? 'tex' : 'tex2')
    } else {
      wrapperInputs.push(input)
    }
  }
  return { wrapperInputs, samplerInputs }
}

function buildProgram(effect) {
  const { wrapperInputs, samplerInputs } = effectInputs(effect)
  const passInputs = [
    ...(effect.type !== 'src' ? ['inputTex'] : []),
    ...samplerInputs,
    'prevBuffer'
  ]
  return buildEffectWgsl({
    name: effect.name,
    type: effect.type,
    glsl: hydraGlslBody(effect),
    wrapperInputs,
    passInputs
  })
}

function lintWgsl(wgsl, label) {
  const stripped = wgsl.replace(/\/\/[^\n]*/g, '')
  const leftovers = []
  for (const [name, pattern] of [
    ['glsl uniform decl', /\buniform\s+(float|vec[234]|int|sampler2D)\b/],
    ['texture2D', /\btexture2D\s*\(/],
    ['bare vec constructor', /(^|[^f\w])vec[234]\s*\(/],
    ['bare mat constructor', /(^|[^x\w])mat[234]\s*\(/],
    ['GLSL mod', /\bmod\s*\(/],
    ['fragColor', /\bfragColor\b/],
    ['GLSL float decl', /\bfloat\s+[A-Za-z_]/],
    ['++', /\+\+/],
    ['undefined', /\bundefined\b/],
    ['#version', /#version/]
  ]) {
    if (pattern.test(stripped)) leftovers.push(name)
  }
  let depth = 0
  for (const ch of stripped) {
    if (ch === '{') depth++
    if (ch === '}') depth--
  }
  assert.equal(depth, 0, `${label}: unbalanced braces`)
  assert.deepEqual(leftovers, [], `${label}: GLSL leftovers in WGSL`)
}

test('every executable Hydra effect translates to a structurally valid WGSL program', () => {
  const effects = glslFunctions().filter(isExecutableHydraEffect)
  assert.ok(effects.length >= 50)
  for (const effect of effects) {
    const wgsl = buildProgram(effect)
    lintWgsl(wgsl, effect.name)
    // Entry points detectable by the engine (detectEntryPoints).
    assert.match(wgsl, /@vertex\s*\nfn vs_main\(/, `${effect.name}: vertex entry`)
    assert.match(wgsl, /@fragment\s*\nfn fs_main\(/, `${effect.name}: fragment entry`)
    // Explicit bindings: one (texture, sampler) pair per pass input, then
    // the uniform buffer.
    const bindings = [...wgsl.matchAll(/@group\(0\) @binding\((\d+)\)/g)].map(m => Number(m[1]))
    assert.deepEqual(bindings, bindings.map((_, i) => i), `${effect.name}: dense sequential bindings`)
    assert.match(wgsl, /var<uniform> params: Params;/, `${effect.name}: uniform block`)
    assert.match(wgsl, /struct Params \{/, `${effect.name}: Params struct`)
  }
})

test('src/prev bodies retain the engine texture orientation', () => {
  // The engine presents WebGPU textures with a vertical flip. Hydra's
  // logical top-origin coordinate therefore still needs 1.0 - y when
  // sampling the internal texture, as it does on the GLSL path.
  const src = glslFunctions().find(e => e.name === 'src')
  const wgsl = buildProgram(src)
  assert.match(wgsl, /textureSample\(tex, tex_sampler, fract\(vec2f\(_st\.x, 1\.0 - _st\.y\)\)\)/)
  const prev = glslFunctions().find(e => e.name === 'prev')
  const prevWgsl = buildProgram(prev)
  assert.match(prevWgsl, /textureSample\(prevBuffer, prevBuffer_sampler, fract\(vec2f\(_st\.x, 1\.0 - _st\.y\)\)\)/)
})

test('per-effect mains match Hydra canvas and texture coordinates', () => {
  const luma = glslFunctions().find(e => e.name === 'luma')
  const wgsl = buildProgram(luma)
  assert.match(wgsl, /let _st = vec2f\(in\.position\.x, params\.resolution\.y - in\.position\.y\) \/ params\.resolution;/)
  assert.match(wgsl, /textureSample\(inputTex, inputTex_sampler, vec2f\(_st\.x, 1\.0 - _st\.y\)\)/)
})

test('atan translates by arity: two-arg becomes atan2, one-arg stays atan', () => {
  assert.equal(translateAtan('float a = atan(st.x, st.y) + 1.0;'), 'float a = atan2(st.x, st.y) + 1.0;')
  assert.equal(translateAtan('float a = atan(x);'), 'float a = atan(x);')
  assert.equal(translateAtan('atan2(a, b)'), 'atan2(a, b)')
})

test('statement translation covers the port GLSL subset', () => {
  const out = translateGlslStatements(`
    vec3 helper(vec2 p, float k) {
      vec3 c = vec3(p.x, p.y, k);
      float m = mod(c.x, 2.0);
      int i = 0;
      for (int j = 0; j < 3; j++) { i++; }
      return mix(c, vec3(m + float(i)), 0.5);
    }
  `, { samplers: {} })
  assert.match(out, /fn helper\(p: vec2f, k: f32\) -> vec3f \{/)
  assert.match(out, /var c: vec3f = vec3f\(p\.x, p\.y, k\);/)
  assert.match(out, /\(\(c\.x\) - \(2\.0\) \* floor\(\(c\.x\) \/ \(2\.0\)\)\)/)
  assert.match(out, /var i: i32 = 0;/)
  assert.match(out, /for \(var j: i32 = 0; j < 3; j = j \+ 1\)/)
  assert.match(out, /i = i \+ 1/)
  assert.match(out, /f32\(i\)/)
  assert.match(out, /vec3f\(m \+ f32\(i\)\)/)
})

test('statement translation rejects unsupported GLSL tokens', () => {
  // '%' has no float semantics in WGSL; the corpus never uses it, and the
  // translator must fail loudly rather than emit invalid WGSL.
  assert.throws(() => translateGlslStatements('float a = k % 1.0;', { samplers: {} }), /%/)
})

test('const declarations translate to WGSL const bindings', () => {
  const out = translateGlslStatements('const vec3 W = vec3(0.2125, 0.7154, 0.0721);\nconst float K=2.0;\nfloat a = K * W.x;', { samplers: {} })
  assert.match(out, /const W: vec3f = vec3f\(0\.2125, 0\.7154, 0\.0721\);/)
  assert.match(out, /const K: f32 =2\.0;/)
  assert.doesNotMatch(out, /const var/)
})

test('per-effect programs carry the translated GLSL utility helpers', () => {
  // noise calls _noise; the per-effect WGSL must define it (and its
  // permute/taylorInvSqrt helpers with const declarations) like the GLSL
  // buildShader's inlineUtilities does.
  const noise = glslFunctions().find(e => e.name === 'noise')
  const wgsl = buildEffectWgsl({
    name: noise.name,
    type: noise.type,
    glsl: hydraGlslBody(noise),
    wrapperInputs: [
      { name: 'scale', type: 'float' },
      { name: 'offset', type: 'float' }
    ],
    passInputs: ['prevBuffer']
  })
  lintWgsl(wgsl, 'noise')
  assert.match(wgsl, /fn permute\(x: vec4f\) -> vec4f \{/)
  assert.match(wgsl, /fn _noise\(v: vec3f\) -> f32 \{/)
  assert.match(wgsl, /const C: vec2f = vec2f\(/)
  assert.match(wgsl, /return _hydra_noise\(_st, params\.scale, params\.offset\);/)
  const luma = glslFunctions().find(e => e.name === 'luma')
  const lumaWgsl = buildEffectWgsl({
    name: luma.name,
    type: luma.type,
    glsl: hydraGlslBody(luma),
    wrapperInputs: [],
    passInputs: ['inputTex', 'prevBuffer']
  })
  lintWgsl(lumaWgsl, 'luma')
  assert.match(lumaWgsl, /fn _luminance\(rgb: vec3f\) -> f32 \{/)
  assert.match(lumaWgsl, /const W: vec3f = vec3f\(/)
})

test('noise utility splats the scalar max argument for WGSL vector overloads', () => {
  const noise = glslFunctions().find(e => e.name === 'noise')
  const wgsl = buildProgram(noise)
  assert.match(wgsl, /var m: vec4f = max\(0\.6 - vec4f\([^\n]+\), vec4f\(0\.0\)\);/)
})

test('color utility splats scalar clamp bounds for WGSL vector overloads', () => {
  const luma = glslFunctions().find(e => e.name === 'luma')
  const wgsl = buildProgram(luma)
  assert.match(wgsl, /clamp\(p - K\.xxx, vec3f\(0\.0\), vec3f\(1\.0\)\)/)
})

test('fused override texture bindings mirror the definition pass inputs', async () => {
  const { hydraPassTextureInputs } = await import('../src/engine/portHydraEffects.js')
  const glslList = glslFunctions()
  const blend = glslList.find(e => e.name === 'blend')
  assert.deepEqual(hydraPassTextureInputs(blend), ['inputTex', 'tex', 'prevBuffer'])
  const modulateRotate = glslList.find(e => e.name === 'modulateRotate')
  assert.deepEqual(hydraPassTextureInputs(modulateRotate), ['inputTex', 'tex', 'prevBuffer'])
  // A combine-final fused program declares the full pair set; bindings run
  // inputTex(0,1), tex(2,3), prevBuffer(4,5), uniform(6).
  const fused = 'void main() {\n  vec2 _st = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y) / resolution.xy;\n  fragColor = vec4(_st, 0.0, 1.0);\n}\n'
  const wgsl = translateFusedProgram(fused, {
    textureInputs: ['inputTex', 'tex', 'prevBuffer'],
    uniformNames: []
  })
  lintWgsl(wgsl, 'combine-final')
  assert.match(wgsl, /@group\(0\) @binding\(2\) var tex: texture_2d<f32>;/)
  assert.match(wgsl, /@group\(0\) @binding\(4\) var prevBuffer: texture_2d<f32>;/)
  assert.match(wgsl, /@group\(0\) @binding\(6\) var<uniform> params: Params;/)
})

test('fused program translation: bindings, struct, and entry points', () => {
  // Mirrors fuseHydraPlan.buildShader output shape for gradient -> posterize.
  const fused = `#version 300 es
precision highp float;

uniform vec2 resolution;
uniform float time;
uniform sampler2D prevBuffer;
uniform float _hydra_t0_speed;

out vec4 fragColor;

vec4 _hydra_gradient(vec2 _st) {
   return vec4(_st, sin(_hydra_t0_speed*0.0), 1.0);
}
vec4 _hydra_posterize(vec4 _c0, float bins, float gamma) {
   return floor(_c0 * 5.0) / 5.0 + floor(0.7);
}
vec4 _hydra_node_1(vec2 _st) {
  return _hydra_posterize(_hydra_node_0(_st), 5.0, 0.7);
}

void main() {
  vec2 _st = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y) / resolution.xy;
  fragColor = _hydra_node_1(_st);
}
`
  const wgsl = translateFusedProgram(fused, {
    textureInputs: ['inputTex', 'prevBuffer'],
    uniformNames: ['_hydra_t0_speed']
  })
  lintWgsl(wgsl, 'fused-sample')
  assert.match(wgsl, /@group\(0\) @binding\(0\) var inputTex: texture_2d<f32>;/)
  assert.match(wgsl, /@group\(0\) @binding\(2\) var prevBuffer: texture_2d<f32>;/)
  assert.match(wgsl, /@group\(0\) @binding\(4\) var<uniform> params: Params;/)
  assert.match(wgsl, /_hydra_t0_speed: f32,/)
  assert.match(wgsl, /params\._hydra_t0_speed/)
  const fsMain = wgsl.slice(wgsl.indexOf('fn fs_main'))
  assert.doesNotMatch(fsMain, /(?<!params\.)\b_hydra_t0_speed\b/)
  // The engine flips internal WebGPU textures during presentation, so the
  // GLSL logical-coordinate flip must survive translation.
  assert.match(wgsl, /var _st: vec2f = vec2f\(in\.position\.x, params\.resolution\.y - in\.position\.y\) \/ params\.resolution\.xy;/)
  assert.match(wgsl, /resolution: vec2f,/)
  assert.match(wgsl, /time: f32,/)
  assert.match(wgsl, /@fragment\s*\nfn fs_main\(/)
  assert.match(wgsl, /return\s+_hydra_node_1\(_st\);/)
  // struct name must match the engine's *Params|*Uniforms|*Config|*Settings
  // scan, with the var<uniform> declaration pointing at it.
  assert.match(wgsl, /struct Params \{[\s\S]*?\}\n@group\(0\) @binding\(\d+\) var<uniform> params: Params;/)
})

test('wgslTypeForUniformValue maps arrays to vecNf and scalars to f32', () => {
  assert.equal(wgslTypeForUniformValue([1, 2]), 'vec2f')
  assert.equal(wgslTypeForUniformValue([1, 2, 3, 4]), 'vec4f')
  assert.equal(wgslTypeForUniformValue(30, 'angle'), 'f32')
  assert.equal(glslTypeToWgsl('vec4'), 'vec4f')
})

test('buildProgramInterface assigns dense pair bindings and reports samplers', () => {
  const { bindings, struct, samplers } = buildProgramInterface({
    inputs: ['inputTex', 'tex', 'prevBuffer'],
    uniforms: [{ name: 'scale', wgsl: 'f32' }, { name: 'resolution', wgsl: 'vec2f' }]
  })
  assert.match(bindings, /@binding\(0\) var inputTex:/)
  assert.match(bindings, /@binding\(1\) var inputTex_sampler:/)
  assert.match(bindings, /@binding\(4\) var prevBuffer:/)
  assert.match(struct, /@binding\(6\) var<uniform> params: Params;/)
  assert.match(struct, /scale: f32,/)
  assert.equal(samplers.tex, 'tex_sampler')
  // The utility functions must not be referenced unless present.
  assert.ok(!bindings.includes('hydra_mod'))
  assert.ok(Object.keys(utilityGlsl).length > 0)
})
