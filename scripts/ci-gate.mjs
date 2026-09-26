#!/usr/bin/env node
/*
 * Rendered CI gate (browser sweep): runs the exact browser pixel-parity
 * sweep and enforces the GAP-005 acceptance semantics for the rendered
 * portion of the gate:
 *
 *  - Every expected case executes: ok + fail must equal the full
 *    denominator (58 cases), enforced from independent per-case line
 *    accounting. Missing cases fail the gate.
 *  - Failure policy (criterion: "mismatches must fail qualification"):
 *    strict only. The sweep must be fully exact (0 failures). There is
 *    deliberately NO residual-tolerance opt-in: tolerating the documented
 *    Linux animated-parameter residual (rotate_animated_parameter,
 *    96/16384 bytes, max channel delta 1, per docs/COMPLETION_GAPS.md
 *    GAP-003 sweep status) would be an unratified policy weakening of the
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
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const CHROME = process.env.CHROME ||
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/chromium')
// Port 0 means "pick a free port" so concurrent gate and test.mjs runs cannot
// collide on the shared 8765 default; override with PORT for pinned runs.
const PORT = process.env.PORT ? Number(process.env.PORT) : 0
const LEGACY_BUNDLE = join(process.cwd(), 'dev-noisemaker', '.legacy-hydra-synth.js')
// Scratch-bundle hygiene: the finally block removes the bundle on every
// normal path (including failures and the chrome-timeout throw). Signal
// handlers cover SIGINT/SIGTERM so an interrupted run does not leave the
// in-tree scratch file that would trip the no-dead-runtime contract test;
// SIGKILL cannot be handled by any process.
function cleanupScratchBundle() { try { rmSync(LEGACY_BUNDLE, { force: true }) } catch (_e) {} }
process.on('SIGINT', () => { cleanupScratchBundle(); process.exit(130) })
process.on('SIGTERM', () => { cleanupScratchBundle(); process.exit(143) })
process.on('exit', cleanupScratchBundle)
const SWEEP_URL = '/dev-noisemaker/pixel-parity.html'
// Set when the gate itself added the `upstream` remote for a bare checkout;
// the finally block removes it again so the run leaves no git-config change.
let addedUpstream = false
// Immutable-authority pin: the retained upstream Hydra comparison bundle is
// fetched from the `upstream` remote and must hash exactly to this recorded
// identity; any other bytes fail the gate before the sweep runs.
const LEGACY_BUNDLE_SHA256 = 'b4881aa9dfbd990a9e37fe6766581816fc273cdd42471e13bf6e79b705a5a7a1'
// Failure-set policy. Strict only, by the criterion's plain reading:
// "mismatches must fail qualification" — the sweep must be fully exact
// (0 failures). The runner deliberately ships NO residual-tolerance
// opt-in: tolerating the documented Linux animated-parameter residual
// (rotate_animated_parameter, 96/16384 bytes, max channel delta 1) would
// be an unratified policy weakening of the criterion. A host that cannot
// produce an exact sweep fails the gate, by design, until the residual is
// fixed or the policy change is explicitly ratified by the actor with
// workflow authority (the qualified macOS host record is 58/58 exact).
// The GAP-001 complete expected-case inventory remains open and is not
// claimed by this runner.
const TOTAL_CASES = 58

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
function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
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

function runChromeDump(url, port) {
  const args = [
    '--headless', '--no-sandbox',
    '--window-size=1024,1024',
    '--hide-scrollbars',
    '--virtual-time-budget=180000',
    '--dump-dom', `http://localhost:${port}${url}`
  ]
  const result = spawnSync(CHROME, args, { encoding: 'utf8', timeout: 300000, killSignal: 'SIGKILL' })
  if (result.error) {
    throw new Error(`chrome launch failed: ${result.error.message}`)
  }
  if (result.status !== 0 && result.stdout === '') {
    throw new Error(`chrome exited ${result.status} with no DOM output (timeout or crash)`)
  }
  // No scratch file: the DOM string is returned directly, so no temp dirs
  // accumulate across runs.
  return { dom: result.stdout, status: result.status }
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
  //   `=== 57 ok, 1 fail / 58 total ===`
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
    { encoding: 'utf8', timeout: 600000, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024 })
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
  const UPSTREAM_URL = 'https://github.com/ojack/hydra-synth.git'
  // Materialize the retained upstream Hydra comparison bundle. On a bare
  // checkout (no `upstream` remote) the gate bootstraps it itself — adds the
  // remote and shallow-fetches main — so no out-of-tree setup is required;
  // a network failure then fails fast with the true root cause.
  let legacy = spawnSync('git', ['show', 'upstream/main:dist/hydra-synth.js'], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 })
  if (legacy.status !== 0 || !legacy.stdout || legacy.stdout.length === 0) {
    console.log('[ci-gate] bootstrapping the upstream remote (bare checkout)')
    const add = spawnSync('git', ['remote', 'add', 'upstream', UPSTREAM_URL], { encoding: 'utf8' })
    if (add.status !== 0 && !(add.stderr || '').toString().includes('already exists')) {
      throw new Error(`cannot add the upstream remote (${UPSTREAM_URL}): ${(add.stderr || '').toString().trim()}`)
    }
    // Remember whether we added the remote so the cleanup path can remove
    // it again: a bare-checkout gate run must not leave persistent changes
    // in the checkout's git config.
    if (add.status === 0) addedUpstream = true
    const fetch = spawnSync('git', ['fetch', '--depth=1', 'upstream', 'main'], { encoding: 'utf8', timeout: 300000, killSignal: 'SIGKILL' })
    if (fetch.status !== 0) {
      if (addedUpstream) spawnSync('git', ['remote', 'remove', 'upstream'], { encoding: 'utf8' })
      throw new Error(`cannot fetch the retained upstream Hydra bundle from ${UPSTREAM_URL}: ` +
        `git fetch --depth=1 upstream main failed (status=${fetch.status}, stderr=${(fetch.stderr || '').toString().trim()}). ` +
        `Network access to github.com is required; the gate fails rather than sweeping against missing authority.`)
    }
    legacy = spawnSync('git', ['show', 'upstream/main:dist/hydra-synth.js'], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 })
  }
  if (legacy.status !== 0 || !legacy.stdout || legacy.stdout.length === 0) {
    throw new Error(`cannot materialize the retained upstream Hydra bundle: ` +
      `git show upstream/main:dist/hydra-synth.js failed (status=${legacy.status}, stderr=${(legacy.stderr || '').toString().trim()}).`)
  }
  // Hash the raw bytes (encoding: 'buffer'), not lossy-repaired utf8 text.
  const actualHash = createHash('sha256').update(legacy.stdout).digest('hex')
  if (actualHash !== LEGACY_BUNDLE_SHA256) {
    throw new Error(`retained upstream Hydra bundle identity changed: ` +
      `expected sha256 ${LEGACY_BUNDLE_SHA256}, got ${actualHash}. ` +
      `The comparison authority moved; re-qualify the sweep against the new bytes on its own evidence before updating the pin.`)
  }
  writeFileSync(LEGACY_BUNDLE, legacy.stdout)

  // Resolve the serving port before starting the server: the configured
  // PORT, or a freshly picked free port (PORT unset) so concurrent gate and
  // test.mjs runs cannot collide on the shared 8765 default.
  const servingPort = PORT !== 0 ? PORT : await pickFreePort()
  console.log(`[ci-gate] starting http-server on port ${servingPort}`)
  server = startServer(servingPort)
  await waitForServer(servingPort)
  console.log(`[ci-gate] http-server verified serving on port ${servingPort} (page bytes match the checkout)`)

  console.log(`[ci-gate] pixel-parity: GET ${SWEEP_URL}`)
  const { dom, status } = runChromeDump(SWEEP_URL, servingPort)
  if (status !== 0 && status !== null) {
    throw new Error(`chrome dump failed (status=${status})`)
  }
  const summary = parseSummary(dom)
  const { ok, total, fail, failures, perCaseCount } = summary
  console.log(`[ci-gate] pixel-parity: ${ok}/${total} pass, ${fail} fail (${perCaseCount} per-case lines counted)`)
  const evaluation = evaluateSweep(summary, TOTAL_CASES)
  for (const reason of evaluation.reasons) console.error(`[ci-gate] FAIL: ${reason}`)
  const passed = evaluation.passed
  if (!passed) {
    console.error('[ci-gate] FAILURES — gate rejected')
    process.exitCode = 1
  } else {
    console.log(`[ci-gate] GREEN: all ${TOTAL_CASES} cases executed with zero failures (exact sweep)`)
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
