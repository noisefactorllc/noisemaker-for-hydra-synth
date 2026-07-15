import {
  HYDRA_NAMESPACE,
  registerAllHydraEffects
} from './engine/portHydraEffects.js'
import {
  DEFAULT_CDN,
  getEngine,
  loadEngine
} from './engine/index.js'
import { installHydraCompiler } from './engine/fuseHydraPlan.js'

const NAMESPACE_DESCRIPTION = 'Hydra effects ported to the Noisemaker engine'

export function registerHydraEffects(engine) {
  if (!engine || typeof engine.registerNamespace !== 'function') {
    throw new Error('Noisemaker engine with registerNamespace() is required')
  }

  engine.registerNamespace(HYDRA_NAMESPACE, {
    description: NAMESPACE_DESCRIPTION
  })
  registerAllHydraEffects(engine)
  installHydraCompiler(engine)
  return engine
}

export async function loadHydraEffects({
  engine,
  cdn = DEFAULT_CDN
} = {}) {
  const resolvedEngine = engine || await loadEngine(cdn)
  return registerHydraEffects(resolvedEngine)
}

export {
  DEFAULT_CDN,
  getEngine,
  HYDRA_NAMESPACE,
  loadEngine
}
