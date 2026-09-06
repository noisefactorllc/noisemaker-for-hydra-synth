<!-- repo-hero -->
<a href="https://noisemaker.app/"><img src="docs/hero.jpg" alt="Noisemaker for Hydra Synth" width="100%"></a>

<sub>Open source from <a href="https://noisefactor.io">Noise Factor</a> &middot; <a href="https://github.com/noisefactorllc">more projects</a></sub>

# Noisemaker for Hydra Synth

Noisemaker for Hydra Synth is an experimental demo port of Hydra's GLSL effects to the [Noisemaker](https://noisemaker.app/) rendering engine. These effects can be mixed with Noisemaker effects in the same program chains.

This is intended only as a tech demo that shows how to integrate the Noisemaker renderer into other projects.

## Use from a module

When this checkout is installed as a local package:

```js
import {
  DEFAULT_CDN,
  loadHydraEffects
} from 'noisemaker-for-hydra-synth'

const engine = await loadHydraEffects()
const renderer = new engine.CanvasRenderer({
  canvas: document.querySelector('canvas'),
  basePath: DEFAULT_CDN,
  bundlePath: `${DEFAULT_CDN}/effects`,
  useBundles: true
})

await renderer.loadManifest()
await renderer.compile(`search hydra
hydraOsc(frequency: 30, sync: 0.1, offset: 0.1).write(o0)`)
renderer.start()
```

`osc` is exposed as `hydraOsc` because Noisemaker reserves `osc` for animated parameters.

## Browser bundle

```html
<script src="./dist/hydra-synth.js"></script>
<script type="module">
  const engine = await window.HydraEffects.loadHydraEffects()
</script>
```

The historical `hydra-synth.js` artifact name is retained for the editor's internal bundle path. The project identity is `Noisemaker for Hydra Synth` and the repository/package name is `noisemaker-for-hydra-synth`.

## Develop and verify

```sh
npm install
npm run build
npm test
```

The test command runs Node contract tests and exact browser pixel comparisons against upstream Hydra, including native-to-Hydra and Hydra-to-native surface transitions.

## Upstream

Hydra effect definitions originate from [hydra-synth](https://github.com/ojack/hydra-synth). This fork retains the upstream AGPL license and attribution history.
