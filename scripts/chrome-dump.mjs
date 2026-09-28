/**
 * Standalone chrome --dump-dom child used by the strict gate's sweep on
 * hosts where a chrome launch inside the long-lived gate process hangs
 * after the unit suite has already launched chrome (observed on macOS:
 * the identical flags succeed in a fresh process but hang 900s+ twice in
 * the gate process). Runs as its own node process per dump: fresh profile
 * dir, honors *_proxy env, writes the DOM to the requested path, exits 0,
 * or exits 3 with a diagnostic on stderr. Usage:
 *   node scripts/chrome-dump.mjs <chrome-path> <url> <timeout-ms> <out-file>
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [chrome, url, timeoutMs, out] = process.argv.slice(2)
if (!chrome || !url || !timeoutMs || !out) {
  console.error('usage: node scripts/chrome-dump.mjs <chrome> <url> <timeout-ms> <out-file>')
  process.exit(3)
}
const profileDir = mkdtempSync(join(tmpdir(), 'ci-gate-chrome-'))
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
const args = [
  '--headless', '--no-sandbox',
  '--user-data-dir=' + profileDir,
  ...(proxy ? ['--proxy-server=' + proxy] : []),
  '--window-size=1024,1024',
  '--hide-scrollbars',
  '--virtual-time-budget=180000',
  '--dump-dom', url
]
let result
try {
  result = spawnSync(chrome, args, { encoding: 'utf8', timeout: Number(timeoutMs), killSignal: 'SIGKILL' })
} finally {
  rmSync(profileDir, { recursive: true, force: true })
}
if (result.error) {
  console.error(`chrome launch failed: ${result.error.message}`)
  process.exit(3)
}
if (result.status !== 0 && result.stdout === '') {
  console.error(`chrome exited ${result.status} with no DOM output (timeout or crash)`)
  process.exit(3)
}
writeFileSync(out, result.stdout)
process.exit(0)
