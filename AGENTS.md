# Noisemaker for Hydra Synth

Hydra effects ported natively to the Noisemaker shader engine.

## Strict Rules

HARD, PERMANENT, INVIOLABLE BAN: BANNED FROM SYMLINKS. Never create, introduce, or use symbolic links anywhere in checkouts, repositories, configuration, scripts, or documentation. All files must be regular files. Zero exceptions.

HARD, PERMANENT, INVIOLABLE BAN: Research documents must be written and presented strictly in the established technical whitepaper style. Banned from slop headlines, promotional/slogan headers, parenthetical subtitles in titles, stat cards, metric cards, decorative callouts, marketing-speak, and invented report layouts. Zero exceptions.

## Testing & Build

- **Unit tests**: `node --test test/*.test.mjs`
- **Pixel-parity browser sweep**: `node scripts/test.mjs` (serves fixtures via local `http-server` on port 8765 and executes headless Chrome parity sweep)
- **Combined verification**: `npm test` runs both unit tests and browser pixel-parity tests.
- **Production bundle build**: `npm run build` (runs `node scripts/build.mjs` using `esbuild`).
