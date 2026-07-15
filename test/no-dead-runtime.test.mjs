import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const removedRuntimePaths = [
  'src/hydra-synth.js',
  'src/hydra-source.js',
  'src/eval-sandbox.js',
  'src/engine/HydraPipeline.js',
  'src/engine/chainToDsl.js',
  'src/glsl/gaussian.frag',
  'src/glsl/renderpass-functions.js',
  'src/lib/array-utils.js',
  'src/lib/audio.js',
  'src/lib/easing-functions.js',
  'src/lib/mouse-event.js',
  'src/lib/mouse.js',
  'src/lib/sandbox.js',
  'src/lib/screenmedia.js',
  'src/lib/video-recorder.js',
  'src/lib/webcam.js',
  'docs/superpowers/specs/2026-04-30-noisemaker-engine-port-design.md',
  'docs/upstream-prds/2026-05-01-register-namespace-api.md'
]

test('contains no unreachable legacy Hydra runtime', () => {
  for (const path of removedRuntimePaths) {
    assert.equal(existsSync(path), false, `${path} must be removed`)
  }

  assert.deepEqual(readdirSync('dev-noisemaker').sort(), ['pixel-parity.html'])
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.equal(pkg.dependencies?.meyda, undefined)
})
