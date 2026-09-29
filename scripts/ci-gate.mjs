#!/usr/bin/env node
/*
 * Rendered CI gate (browser sweep): runs the exact browser pixel-parity
 * sweep and enforces the GAP-005 acceptance semantics for the rendered
 * portion of the gate:
 *
 *  - Every expected case executes: ok + fail must equal the full
 *    denominator (71 cases per size sweep), enforced from independent per-case line
 *    accounting. Missing cases fail the gate.
 *  - Failure policy (criterion: "mismatches must fail qualification"):
 *    strict only. The sweep must be fully exact (0 failures). There is
 *    deliberately NO residual-tolerance opt-in: tolerating the documented
 *    Linux animated-parameter residual (rotate_animated_parameter,
 *    96/16384 bytes, max channel delta 1, per docs/COMPLETION_GAPS.md
 *    GAP-001 sweep status) would be an unratified policy weakening of the
 *    criterion. A host that cannot produce an exact sweep fails the gate
 *    by design, until the residual is fixed or the policy change is
 *    explicitly ratified by the actor with workflow authority. The
 *    qualified macOS host record is 58/58 exact.
 *
 * Scope note: this runner is the complete tree-resident gate. It runs the
 * unit suite (`node --test test/*.test.mjs`, failing on failures, skips,
 * todos, and cancellations) and the rendered browser sweep. The GitHub
 * Actions wrapper that invokes this runner on push/PR requires workflow
 * authority this implementation job does not hold.
 *
 * Two rendered gates exist in this tree and both enforce the same
 * zero-failure policy: scripts/test.mjs (npm test) requires fail === 0
 * for exact hosts, and this runner (npm run gate) is the qualification
 * gate with the identical policy — the criterion's "mismatches must fail
 * qualification" is enforced with no exception.
 *
 * Exits 0 only when the unit suite is clean and the sweep is fully exact.
 */
import { spawn, spawnSync } from 'node:child_process'
import { LEGACY_BUNDLE, LEGACY_BUNDLE_SHA256, cleanupScratchBundle, materializeLegacyBundle } from './upstream-bundle.mjs'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const CHROME = process.env.CHROME ||
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/chromium')
// Port 0 means "pick a free port" so concurrent gate and test.mjs runs cannot
// collide on the shared 8765 default; override with PORT for pinned runs.
const PORT = process.env.PORT ? Number(process.env.PORT) : 0
// Scratch-bundle hygiene: the finally block removes the bundle on every
// normal path (including failures and the chrome-timeout throw). Signal
// handlers cover SIGINT/SIGTERM so an interrupted run does not leave the
// in-tree scratch file that would trip the no-dead-runtime contract test;
// SIGKILL cannot be handled by any process.
process.on('SIGINT', () => { cleanupScratchBundle(); process.exit(130) })
process.on('SIGTERM', () => { cleanupScratchBundle(); process.exit(143) })
process.on('exit', cleanupScratchBundle)
const SWEEP_URL = '/dev-noisemaker/pixel-parity.html'
// The gate sweeps the page at the default 64x64 and at 96x48 (?w=96&h=48),
// enforcing the full denominator and zero-failure policy on each sweep.
const SWEEP_URLS = [SWEEP_URL, `${SWEEP_URL}?w=96&h=48`]
// Set when the gate itself added the `upstream` remote for a bare checkout;
// the finally block removes it again so the run leaves no git-config change.
let addedUpstream = false
// Failure-set policy. Strict only, by the criterion's plain reading:
// "mismatches must fail qualification" — the sweep must be fully exact
// (0 failures). The runner deliberately ships NO residual-tolerance
// opt-in: tolerating the documented Linux animated-parameter residual
// (rotate_animated_parameter, 96/16384 bytes, max channel delta 1) would
// be an unratified policy weakening of the criterion. A host that cannot
// produce an exact sweep fails the gate, by design, until the residual is
// fixed or the policy change is explicitly ratified by the actor with
// workflow authority (the qualified macOS host record for the legacy
// 58-case suite is 58/58 exact). The GAP-001 complete expected-case
// inventory remains open and is not claimed by this runner.
// The page emits 71 cases per size sweep (the page runs once at 64x64 and
// once at 96x48 via ?w=96&h=48): `sum` was never a generated legacy case (the
// authority bundle's sum shader cannot compile) and stays excluded there;
// `sum_reference`, `sum_default_scale`, the four parameter-matrix cases,
// `rotate_animated_uniform_parameter` and the six second-time-point cases
// (`osc_nonzero_time_t075`, `voronoi_src_t075`, `parameter_matrix_t075`,
// `parameter_matrix_color_t05`, `parameter_matrix_geometry_t06`,
// `parameter_matrix_combine_t075`) were added on top of the original
// generated fixtures. Denominator is 71 per sweep.
const TOTAL_CASES = 71
export { TOTAL_CASES }

function startServer(port) {
  // Installs use --bin-links=false, so no http-server binary exists; run it
  // through node directly from the installed dependency. stderr is piped so
  // the bound port can be parsed when PORT=0 (auto).
  return spawn(process.execPath,
    [join(process.cwd(), 'node_modules', 'http-server', 'bin', 'http-server'),
      '-p', String(port), '-s'],
    { stdio: ['ignore', 'pipe', 'pipe'] })
}

// Pick a free TCP port before starting the server so concurrent gate and
// test.mjs runs cannot collide on the shared 8765 default. Note: the kernel
// reuses the port on bind only after close, so this is best-effort; the gate
// still verifies the server comes up on the chosen port (waitForServer).
// A sandboxed host may only serve on an allow-listed loopback range; the
// first bindable entry of HOST_PORTS wins; the ephemeral port (0) is always
// the final fallback.
function pickFreePort() {
  const allowed = (process.env.HOST_PORTS || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).concat(0)
  return new Promise((resolve, reject) => {
    const attempt = i => {
      const srv = createServer()
      srv.unref()
      srv.on('error', () => {
        if (i + 1 < allowed.length) attempt(i + 1)
        else reject(new Error('no bindable port (tried ' + allowed.join(',') + ')'))
      })
      srv.listen(allowed[i], '127.0.0.1', () => {
        const { port } = srv.address()
        srv.close(() => resolve(port))
      })
    }
    attempt(0)
  })
}

async function waitForServer(port, timeoutMs = 30000) {
  // The served page must byte-match the checkout's sweep page, so a foreign
  // server that happens to bind the chosen port cannot pass this probe.
  const localPage = readFileSync(join(process.cwd(), 'dev-noisemaker', 'pixel-parity.html'))
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://localhost:${port}${SWEEP_URL}`)
      if (r.ok) {
        const body = Buffer.from(await r.arrayBuffer())
        if (!body.equals(localPage)) {
          throw new Error(`port ${port} is serving foreign content — refusing to run the sweep against it`)
        }
        return
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('foreign content')) throw e
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`Server didn't come up on port ${port}`)
}

async function runChromeDump(url, port) {
  // Per-dump standalone child (scripts/chrome-dump.mjs): on macOS hosts a
  // chrome launch inside the long-lived gate process hangs after the unit
  // suite has already launched chrome (observed twice for 900s each on the
  // GitHub macos-15 runner, run 36479833520, and reproduced on the macOS
  // GPU host); the identical flags succeed from a fresh process.
  const tmp = mkdtempSync(join(tmpdir(), 'ci-gate-dump-'))
  const out = join(tmp, 'dom.html')
  // Hosted macOS arm64 runners are throttled under capacity pressure
  // (GitHub's own annotation warns about it): identical launches complete
  // in 1.8s one run and stall beyond 60-900s in another. Long windows plus
  // one launch retry, with the two sweep pages rendered in parallel, keep
  // the strict gate inside the job budget on a degraded runner. The window
  // is env-tunable (GATE_DUMP_TIMEOUT ms).
  const dumpTimeout = Number(process.env.GATE_DUMP_TIMEOUT || 2400000)
  // Kill lingering headless chrome from the unit suite first: a leftover
  // renderer can hold macOS launch services and hang the next launch.
  if (process.platform === 'darwin') {
    try { spawnSync('pkill', ['-f', '(Google Chrome|Chromium|headless_shell).*--headless'], { timeout: 15000 }) } catch (_e) {}
  }
  const childArgs = [join(process.cwd(), 'scripts', 'chrome-dump.mjs'), CHROME, `http://localhost:${port}${url}`, String(dumpTimeout), out]
  // Success = exit 0 with a non-empty DOM file (chrome logs to stderr via
  // --enable-logging=stderr even when healthy, so stderr is diagnostic
  // only); failure carries the diagnostic (including chrome's own log
  // tail) on stderr with exit 3.
  const childOk = code => code === 0 && existsSync(out) && statSync(out).size > 0
  const attempt = () => new Promise(resolve => {
    const t0 = Date.now()
    const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderrText = ''
    child.stderr.on('data', d => { stderrText += d })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ ok: false, dom: '', diag: `dump child exceeded ${dumpTimeout + 120000}ms`, elapsed: Date.now() - t0 })
    }, dumpTimeout + 120000)
    child.on('error', err => {
      clearTimeout(timer)
      resolve({ ok: false, dom: '', diag: err.message, elapsed: Date.now() - t0 })
    })
    child.on('exit', code => {
      clearTimeout(timer)
      const ok = childOk(code)
      resolve({
        ok,
        dom: ok ? readFileSync(out, 'utf8') : '',
        diag: ok ? '' : (stderrText.trim().slice(-400) || `exit=${code}`),
        elapsed: Date.now() - t0
      })
    })
  })
  // One launch retry: the retry is a launch retry, never a parity retry —
  // a real mismatch still fails.
  let result = await attempt()
  if (!result.ok) {
    console.log(`[ci-gate] chrome dump failed after ${result.elapsed}ms (${result.diag.slice(0, 120)}); retrying once (launch retry)`)
    result = await attempt()
  }
  try {
    if (!result.ok) {
      throw new Error(`chrome dump failed: ...${result.diag.slice(-400)}`)
    }
    return { dom: result.dom, status: 0, elapsed: result.elapsed }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// Pure sweep accounting: given a parseSummary result, enforce the complete
// denominator from independent per-case lines and the strict zero-failure
// policy. Returns { passed, reasons } so unit tests can exercise the GREEN
// path's logic exactly as the live gate does. Failures are reported once
// (inside the mismatch reason), not duplicated.
export function evaluateSweep(summary, totalCases) {
  const { ok, total, fail, failures, okLines, perCaseCount } = summary
  const reasons = []
  if (ok === null || total === null || fail === null) {
    reasons.push('no summary line — sweep did not report results')
  } else {
    if (total !== totalCases) {
      reasons.push(`denominator ${total} != expected ${totalCases} cases`)
    }
    if (perCaseCount !== totalCases) {
      reasons.push(`per-case line count ${perCaseCount} (ok=${okLines.length}, failures=${failures.length}) != expected ${totalCases} cases`)
    }
    if (perCaseCount !== total) {
      reasons.push(`per-case line count ${perCaseCount} != reported total ${total} — page accounting mismatch`)
    }
    const okNames = new Set(okLines)
    const failNames = new Set(failures.map(f => f.split(/\s+/)[0]))
    if (okNames.size !== okLines.length) {
      reasons.push('duplicate ok case names — the page reported a case more than once')
    }
    if (okNames.size + failNames.size !== totalCases) {
      reasons.push(`distinct executed cases ${okNames.size + failNames.size} != expected ${totalCases}`)
    }
    if (failures.length !== fail) {
      reasons.push('unreported failures detected')
    }
    if (fail !== 0) {
      reasons.push(`mismatches must fail qualification; got ${fail} failures (no residual opt-in exists — the sweep must be fully exact, or the residual policy must be explicitly ratified by the actor with workflow authority): ${failures.join(' | ')}`)
    }
  }
  return { passed: reasons.length === 0, reasons }
}

export function parseSummary(domText) {
  // Each sweep page emits a final line like:
  //   `=== 61 ok, 1 fail / 62 total ===`
  // and individual `FAIL ...` / `THROW ...` lines. Pull both out of the log
  // div content (same protocol as scripts/test.mjs).
  const logMatch = domText.match(/<div id="log">([\s\S]*)<\/div>\s*<script/)
  if (!logMatch) return { ok: null, total: null, fail: null, failures: [] }
  // Strip nested div tags to get the text.
  const text = logMatch[1].replace(/<[^>]*>/g, '\n')
  const summaryMatch = text.match(/===\s*(\d+)\s*ok,\s*(\d+)\s*fail(?:\s*\/\s*(\d+)\s*total)?/)
  const failures = [...text.matchAll(/^(?:FAIL|THROW)\s+([^\n]+)/gm)].map(m => m[1].trim())
  // Independent per-case accounting: the page emits one `ok    <name>` line
  // per passing case and one FAIL/THROW line per failing case. Counting
  // these lines directly keeps denominator enforcement independent of the
  // page's self-reported summary.
  const okLines = [...text.matchAll(/^ok\s+(\S+)/gm)].map(m => m[1])
  const perCaseCount = okLines.length + failures.length
  if (!summaryMatch) return { ok: null, total: null, fail: failures.length, failures, okLines, perCaseCount }
  return {
    ok: parseInt(summaryMatch[1], 10),
    fail: parseInt(summaryMatch[2], 10),
    total: summaryMatch[3] ? parseInt(summaryMatch[3], 10) : null,
    failures,
    okLines,
    perCaseCount
  }
}

let server
async function main() {
try {
  // Unit-suite gate step, run before the browser sweep materializes its
  // scratch bundle (a stray dev-noisemaker/.legacy-hydra-synth.js would fail
  // the no-dead-runtime contract test): failures, skips, todos, and
  // cancellations all fail ("missing cases, errors, skips ... must fail
  // qualification"), and the suite must actually run (tests > 0).
  console.log('[ci-gate] unit suite: node --test test/*.test.mjs')
  const unit = spawnSync(process.execPath, ['--test', ...readdirSync(join(process.cwd(), 'test')).filter(f => f.endsWith('.test.mjs')).map(f => join('test', f))],
    { encoding: 'utf8', timeout: 1800000, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024 })
  if (unit.error) throw new Error(`unit suite failed to run: ${unit.error.message}`)
  const counters = {}
  for (const m of (unit.stdout || '').matchAll(/^ℹ (\w+) (\d+)$/gm)) counters[m[1]] = Number(m[2])
  // TAP-reporter fallback: node --test under --test-reporter tap prints
  // "# tests 46" style summaries; parse those too so the gate is not
  // reporter-version dependent. Spec (ℹ) counters take precedence.
  for (const m of (unit.stdout || '').matchAll(/^# (tests|pass|fail|skipped|todo|cancelled) (\d+)$/gm)) {
    const key = m[1]
    if (!(key in counters)) counters[key] = Number(m[2])
  }
  console.log(`[ci-gate] unit suite: tests=${counters.tests} pass=${counters.pass} fail=${counters.fail} skipped=${counters.skipped} (exit ${unit.status})`)
  let unitOk = unit.status === 0
  if (!counters.tests) {
    console.error('[ci-gate] FAIL: unit suite produced no summary — missing cases fail the gate')
    unitOk = false
  }
  for (const key of ['fail', 'skipped', 'todo', 'cancelled']) {
    if ((counters[key] ?? 0) !== 0) {
      console.error(`[ci-gate] FAIL: unit suite ${key}=${counters[key]} (must be 0)`)
      unitOk = false
    }
  }

  if (!unitOk) {
    // Short-circuit: a failed unit suite already fails the gate; do not
    // spend the remote bootstrap, server start, or browser sweep on it.
    console.error('[ci-gate] FAILURES — gate rejected (unit-suite step)')
    rmSync(LEGACY_BUNDLE, { force: true })
    process.exit(1)
  }
  const { addedUpstream: gateAddedUpstream } = materializeLegacyBundle('[ci-gate]')
  addedUpstream = gateAddedUpstream || addedUpstream

  // Resolve the serving port before starting the server: the configured
  // PORT, or a freshly picked free port (PORT unset) so concurrent gate and
  // test.mjs runs cannot collide on the shared 8765 default.
  const servingPort = PORT !== 0 ? PORT : await pickFreePort()
  console.log(`[ci-gate] starting http-server on port ${servingPort}`)
  server = startServer(servingPort)
  await waitForServer(servingPort)
  console.log(`[ci-gate] http-server verified serving on port ${servingPort} (page bytes match the checkout)`)

  let allSweepsPassed = true
  // Both sweep pages render in parallel: on a throttled hosted runner the
  // wall-clock cost is one page, not two, and a stall in one page's launch
  // no longer consumes the other page's window. Each page is still
  // evaluated independently against the full denominator.
  const sweepResults = await Promise.all(SWEEP_URLS.map(async sweepUrl => {
    console.log(`[ci-gate] pixel-parity: GET ${sweepUrl}`)
    const { dom, status, elapsed } = await runChromeDump(sweepUrl, servingPort)
    return { sweepUrl, dom, status, elapsed }
  }))
  for (const { sweepUrl, dom, status, elapsed } of sweepResults) {
    if (status !== 0 && status !== null) {
      throw new Error(`chrome dump failed (status=${status})`)
    }
    const summary = parseSummary(dom)
    const { ok, total, fail, failures, perCaseCount } = summary
    console.log(`[ci-gate] pixel-parity ${sweepUrl}: ${ok}/${total} pass, ${fail} fail (${perCaseCount} per-case lines counted, ${Math.round(elapsed / 1000)}s)`)
    const evaluation = evaluateSweep(summary, TOTAL_CASES)
    // Surface each failing per-case line verbatim (THROW/FAIL text) so a
    // failing run's root cause is readable from the gate log itself, not
    // only inside the combined mismatch reason.
    for (const failure of failures) console.error(`[ci-gate] FAIL line: ${failure.slice(0, 380)}`)
    for (const reason of evaluation.reasons) console.error(`[ci-gate] FAIL: ${reason}`)
    if (!evaluation.passed) allSweepsPassed = false
  }
  if (!allSweepsPassed) {
    console.error('[ci-gate] FAILURES — gate rejected')
    process.exitCode = 1
  } else {
    console.log(`[ci-gate] GREEN: all ${SWEEP_URLS.length} size sweeps of ${TOTAL_CASES} cases executed with zero failures (exact sweep)`)
  }
} catch (err) {
  console.error('[ci-gate] error:', err)
  process.exitCode = 2
} finally {
  if (server) server.kill('SIGTERM')
  rmSync(LEGACY_BUNDLE, { force: true })
  // Do not leave a gate-added upstream remote in the checkout's config.
  if (addedUpstream) spawnSync('git', ['remote', 'remove', 'upstream'], { encoding: 'utf8' })
}
}

// Run the gate only when invoked directly; unit tests import the pure
// accounting helpers (parseSummary / evaluateSweep) without side effects.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
