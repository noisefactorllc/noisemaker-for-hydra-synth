/**
 * Shared pinned materialization of the retained upstream Hydra comparison
 * bundle (dist/hydra-synth.js at the recorded upstream/main bytes). Both the
 * strict gate (scripts/ci-gate.mjs) and the repository test entrypoint's
 * sweep runner (scripts/test.mjs) must sweep against the same immutable
 * authority: the bundle is fetched from the `upstream` remote (bootstrapped
 * on a bare checkout) and must hash exactly to the recorded SHA-256 — a
 * moving comparison authority fails rather than sweeping against new bytes.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const UPSTREAM_URL = 'https://github.com/ojack/hydra-synth.git'
export const LEGACY_BUNDLE = join(process.cwd(), 'dev-noisemaker', '.legacy-hydra-synth.js')
export const LEGACY_BUNDLE_SHA256 = 'b4881aa9dfbd990a9e37fe6766581816fc273cdd42471e13bf6e79b705a5a7a1'

export function cleanupScratchBundle() {
  try { rmSync(LEGACY_BUNDLE, { force: true }) } catch (_e) {}
}

export function materializeLegacyBundle(logPrefix) {
  // Set when this call added the `upstream` remote for a bare checkout so
  // the caller's cleanup path can remove it again: the run must not leave
  // persistent changes in the checkout's git config.
  let addedUpstream = false
  const show = () => spawnSync('git', ['show', 'upstream/main:dist/hydra-synth.js'], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 })
  let legacy = show()
  if (legacy.status !== 0 || !legacy.stdout || legacy.stdout.length === 0) {
    console.log(`${logPrefix} bootstrapping the upstream remote (bare checkout)`)
    const add = spawnSync('git', ['remote', 'add', 'upstream', UPSTREAM_URL], { encoding: 'utf8' })
    if (add.status !== 0 && !(add.stderr || '').toString().includes('already exists')) {
      throw new Error(`cannot add the upstream remote (${UPSTREAM_URL}): ${(add.stderr || '').toString().trim()}`)
    }
    if (add.status === 0) addedUpstream = true
    const fetch = spawnSync('git', ['fetch', '--depth=1', 'upstream', 'main'], { encoding: 'utf8', timeout: 300000, killSignal: 'SIGKILL' })
    if (fetch.status !== 0) {
      if (addedUpstream) spawnSync('git', ['remote', 'remove', 'upstream'], { encoding: 'utf8' })
      throw new Error(`cannot fetch the retained upstream Hydra bundle from ${UPSTREAM_URL}: ` +
        `git fetch --depth=1 upstream main failed (status=${fetch.status}, stderr=${(fetch.stderr || '').toString().trim()}). ` +
        `Network access to github.com is required; the gate fails rather than sweeping against missing authority.`)
    }
    legacy = show()
  }
  if (legacy.status !== 0 || !legacy.stdout || legacy.stdout.length === 0) {
    throw new Error(`cannot materialize the retained upstream Hydra bundle: ` +
      `git show upstream/main:dist/hydra-synth.js failed (status=${legacy.status}, stderr=${(legacy.stderr || '').toString().trim()}).`)
  }
  // Hash the raw bytes (encoding: 'buffer'), not lossy-repaired utf8 text.
  const actualHash = createHash('sha256').update(legacy.stdout).digest('hex')
  if (actualHash !== LEGACY_BUNDLE_SHA256) {
    if (addedUpstream) spawnSync('git', ['remote', 'remove', 'upstream'], { encoding: 'utf8' })
    throw new Error(`retained upstream Hydra bundle identity changed: ` +
      `expected sha256 ${LEGACY_BUNDLE_SHA256}, got ${actualHash}. ` +
      `The comparison authority moved; re-qualify the sweep against the new bytes on its own evidence before updating the pin.`)
  }
  writeFileSync(LEGACY_BUNDLE, legacy.stdout)
  return { addedUpstream }
}
