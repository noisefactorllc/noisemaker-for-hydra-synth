/**
 * Standalone chrome --dump-dom child used by the strict gate's sweep on
 * hosts where a chrome launch inside the long-lived gate process hangs
 * after the unit suite has already launched chrome (observed on macOS:
 * the identical flags succeed in a fresh process but hang 900s+ twice in
 * the gate process). Runs as its own node process per dump: fresh profile
 * dir, writes the DOM to the requested path, exits 0,
 * or exits 3 with a diagnostic on stderr. Usage:
 *   node scripts/chrome-dump.mjs <chrome-path> <url> <timeout-ms> <out-file>
 *
 * Two macOS-host realities are handled without changing parity semantics:
 * 1. Full-browser builds on macOS runners print the complete DOM (the
 *    sweep summary line included) and then never exit — spawnSync waits
 *    the whole dump window and reports ETIMEDOUT even though the dump
 *    succeeded (GitHub macos-15 runner, runs 36494789416 and 36511129263:
 *    stdout_len=183498 with the full accounting, status=0, error=ETIMEDOUT).
 *    stdout is therefore streamed, and as soon as the sweep's summary
 *    marker (`=== N ok, M fail / T total ===`) is seen the process is
 *    killed after a short settle grace and the DOM is written (exit 0).
 *    A dump without the marker still fails: the marker only appears when
 *    the page's per-case accounting has finished, and the gate re-checks
 *    the full denominator from the DOM's per-case lines.
 * 2. The page loads its engine from the CDN through the *_proxy env when
 *    one is set, while the sweep server is loopback and must bypass the
 *    proxy: --proxy-server + --proxy-bypass-list=<-loopback> gives both
 *    (loopback through the filtering proxy never loads, observed on the
 *    macOS host; on proxy-less runners neither flag is added).
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [chrome, url, timeoutMs, out, extraArgs] = process.argv.slice(2)
// Mirror the unit suite's dumps (which succeed repeatedly on the GitHub
// macos-15 runner): talk to the server over 127.0.0.1, not localhost -
// macOS can resolve localhost to ::1 first.
const safeUrl = url.replace('http://localhost:', 'http://127.0.0.1:')
if (!chrome || !url || !timeoutMs || !out) {
  console.error('usage: node scripts/chrome-dump.mjs <chrome> <url> <timeout-ms> <out-file>')
  process.exit(3)
}
const profileDir = mkdtempSync(join(tmpdir(), 'ci-gate-chrome-'))
// The page loads the Noisemaker engine from the CDN through the *_proxy
// env when one is set, but the sweep server itself is loopback and must
// reach chrome directly: behind a filtering proxy, loopback through the
// proxy fails (page never loads, observed on the macOS host). Chrome does
// NOT reliably bypass loopback on its own here, so the proxy is passed
// explicitly with the <-loopback> bypass token. On proxy-less runners
// neither flag is added.
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
const args = [
  '--headless', '--no-sandbox',
  '--no-first-run', '--no-default-browser-check',
  // macOS CI hang fix: without a mock keychain chrome blocks on Keychain
  // access (observed on the GitHub macos-15 runner as a 900s spawnSync
  // timeout, run 36486021589); harmless elsewhere.
  '--use-mock-keychain',
  '--disable-background-networking',
  ...(proxy ? ['--proxy-server=' + proxy, '--proxy-bypass-list=<local>,localhost,127.0.0.1'] : []),
  // Chrome's own stderr logging pinpoints where a dump hangs (launch, page
  // load, or rendering) when the gate surfaces it via check-run
  // annotations; success is exit 0 with a non-empty DOM file, so stderr is
  // diagnostic only.
  '--enable-logging=stderr',
  '--user-data-dir=' + profileDir,
  '--window-size=1024,1024',
  '--hide-scrollbars',
  '--virtual-time-budget=180000',
  // Extra launch args from the environment (e.g. HYDRA_GATE_CHROME_ARGS=--disable-gpu
  // on hosts whose GPU compositor hangs at teardown after a heavy render);
  // parity comparisons are same-browser, so software rendering cannot mask
  // a mismatch.
  ...((process.env.HYDRA_GATE_CHROME_ARGS || '').trim().split(/\s+/).filter(Boolean)),
  ...((extraArgs || '').split(' ').filter(Boolean)),
  '--dump-dom', safeUrl
]
// The summary marker only appears once the sweep's per-case accounting has
// finished emitting; its presence in the DOM stream means the dump is
// complete even if the browser lingers afterwards.
const SUMMARY_MARKER = /===\s*\d+\s*ok,\s*\d+\s*fail(?:\s*\/\s*\d+\s*total)?\s*===/
// Grace after the marker so the DOM serialization (printed at settle, then
// possibly followed by lingering browser work) finishes streaming.
const MARKER_GRACE_MS = 5000

const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] })
let out_ = ''
let markerSeen = false
let settleTimer = null
let timedOut = false
const timeout = setTimeout(() => {
  timedOut = true
  child.kill('SIGKILL')
}, Number(timeoutMs))
child.stdout.on('data', d => {
  out_ += d
  if (!markerSeen && SUMMARY_MARKER.test(out_)) {
    markerSeen = true
    console.log('[chrome-dump] sweep summary marker seen; giving the DOM 5s to finish streaming')
    settleTimer = setTimeout(() => child.kill('SIGKILL'), MARKER_GRACE_MS)
  }
})
let stderrText = ''
child.stderr.on('data', d => { stderrText += d })
child.on('close', (code, signal) => {
  clearTimeout(timeout)
  if (settleTimer) clearTimeout(settleTimer)
  rmSync(profileDir, { recursive: true, force: true })
  if (!markerSeen) {
    if (timedOut) {
      console.error(`chrome dump timed out after ${timeoutMs}ms with no complete DOM (${out_.length} bytes so far)`)
      process.exit(3)
    }
    if (out_ === '') {
      console.error(`chrome launch failed: ${(stderrText.trim().split('\n').pop() || `exit ${code} signal ${signal}`).slice(-300)}`)
      process.exit(3)
    }
  }
  writeFileSync(out, out_)
  process.exit(0)
})
