export const DEFAULT_CDN = 'https://shaders.noisedeck.app/1'

let _engineModule = null
let _engineCDN = null
let _enginePromise = null

export async function loadEngine(cdn = DEFAULT_CDN) {
  if (_engineModule) {
    if (_engineCDN !== cdn) {
      throw new Error(
        `loadEngine: already loaded from ${_engineCDN}; cannot reload from ${cdn}. ` +
        'The engine is a singleton; use a fresh page to switch.'
      )
    }
    return _engineModule
  }
  if (_enginePromise) return _enginePromise

  const url = `${cdn}/noisemaker-shaders-core.esm.min.js`
  _engineCDN = cdn
  _enginePromise = import(url).then(mod => {
    _engineModule = mod
    return mod
  }).catch(err => {
    _enginePromise = null
    _engineCDN = null
    throw new Error(`Failed to load Noisemaker engine from ${url}: ${err.message}`)
  })
  return _enginePromise
}

export function getEngine() {
  if (!_engineModule) {
    throw new Error('Engine not loaded — await loadEngine() first.')
  }
  return _engineModule
}
