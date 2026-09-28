/**
 * Host-side runner for the rendered sweep: runs scripts/test.mjs with the
 * host's Chrome and sandboxed-host environment. Executed by the host broker
 * (see scripts/test's exact-parity delegation) inside the job's checkout on
 * the GPU host.
 *
 * The host path, scratch directory and allow-listed loopback ports are host
 * settings, not repository policy; they are overridable through the broker's
 * env with defaults for the qualified macOS host.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { trackedTreeHash } from './tree-hash.mjs'

const repo = fileURLToPath(new URL('..', import.meta.url))
const scratch = process.env.HOST_SCRATCH || new URL('.host-scratch/', import.meta.url).pathname
mkdirSync(scratch, { recursive: true })
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout?.trim()
const tree = trackedTreeHash(repo)
console.log(`[sweep-on-host] tree ${sha || 'unknown'} content ${tree.hash} (${tree.files} tracked files)`)
const result = spawnSync(process.execPath, ['scripts/test.mjs'], {
  stdio: 'inherit',
  cwd: repo,
  env: {
    ...process.env,
    CHROME: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    TMPDIR: scratch,
    HOST_SCRATCH: scratch,
    // The host's filtering-proxy chrome dumps are slow; a tuned dump window
    // (both attempts) must fit two sweep pages inside the broker's 3600s
    // delegation cap.
    HYDRA_TEST_DUMP_TIMEOUT: process.env.HYDRA_TEST_DUMP_TIMEOUT || '720000',
    HOST_PORTS: process.env.HOST_PORTS || '43117,43118,43119,43120,43121,43122,43123,43124,43125,43126'
  }
})
process.exit(result.status ?? 1)
