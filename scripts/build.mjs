#!/usr/bin/env node
/*
 * Build dist bundles.
 *
 *   dist/hydra-synth.esm.js — ESM bundle for module consumers.
 *
 *   dist/hydra-synth.js — IIFE bundle setting `window.HydraEffects`. For
 *     the Hydra editor and other <script src="…"> consumers. Noisemaker
 *     engine is dynamic-imported from CDN at runtime; not bundled.
 *
 *   dist/hydra-synth.min.js / dist/hydra-synth.esm.min.js — minified.
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('./dist', { recursive: true })

const common = {
  entryPoints: ['src/index.js'],
  bundle: true,
  loader: { '.glsl': 'text', '.wgsl': 'text' }
}

await build({ ...common, format: 'esm', outfile: 'dist/hydra-synth.esm.js' })
await build({ ...common, format: 'esm', outfile: 'dist/hydra-synth.esm.min.js', minify: true })

await build({
  ...common,
  format: 'iife',
  globalName: 'HydraEffects',
  outfile: 'dist/hydra-synth.js'
})
await build({
  ...common,
  format: 'iife',
  globalName: 'HydraEffects',
  outfile: 'dist/hydra-synth.min.js',
  minify: true
})

console.log('Built: dist/hydra-synth.{esm,esm.min,,min}.js')
