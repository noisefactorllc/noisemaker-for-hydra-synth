export function isExecutableHydraEffect(effect) {
  return effect.name !== 'sum'
}

export function hydraGlslBody(effect) {
  let body = effect.glsl
    .replace(/\btexture2D\s*\(/g, 'texture(')
    .replace(/\btextureCube\s*\(/g, 'texture(')

  if (effect.name === 'src' || effect.name === 'prev') {
    body = body.replace(
      /fract\(\s*_st\s*\)/g,
      'fract(vec2(_st.x, 1.0 - _st.y))'
    )
  }
  return body
}
