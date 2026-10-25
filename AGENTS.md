# Noisemaker for Hydra Synth

Hydra effects ported natively to the Noisemaker shader engine.

## Rules

Never create, introduce or use symbolic links anywhere in checkouts, repositories, configuration, scripts or documentation. Every file is a regular file.

Write and present research documents in the established technical whitepaper style. Never use slop headlines, promotional or slogan headers, parenthetical subtitles in titles, stat cards, metric cards, decorative callouts, marketing-speak or invented report layouts.

## Testing & Build

- **Unit tests**: `node --test test/*.test.mjs`
- **Pixel-parity browser sweep**: `node scripts/test.mjs` (serves fixtures via local `http-server` on port 8765 and executes headless Chrome parity sweep)
- **Combined verification**: `npm test` runs both unit tests and browser pixel-parity tests.
- **Production bundle build**: `npm run build` (runs `node scripts/build.mjs` using `esbuild`).
