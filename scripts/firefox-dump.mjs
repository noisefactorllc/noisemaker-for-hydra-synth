/**
 * Standalone Firefox dump child used by the parity summary's Firefox mode
 * (scripts/parity-summary --browser firefox). Mirrors the shape of
 * scripts/chrome-dump.mjs: runs as its own node process per dump, writes
 * the page DOM to the requested path, exits 0, or exits 3 with a
 * diagnostic on stderr. Usage:
 *   node scripts/firefox-dump.mjs <firefox-path> <url> <timeout-ms> <out-file>
 *
 * Firefox has no --dump-dom, so the driver talks to the browser's built-in
 * Marionette server (started with -marionette) over its length-prefixed
 * JSON TCP protocol, navigates to the sweep URL, and polls the serialized
 * DOM (document.documentElement.outerHTML, the same serialization --dump-dom
 * prints) until the page's own summary marker
 * (`=== N ok, M fail / T total ===`) appears. The marker only appears once
 * the sweep's per-case accounting has finished, so — as with chrome-dump —
 * its presence means the accounting is complete. A short settle grace is
 * kept after the first marker sighting so any trailing DOM work finishes.
 * Launch retries only, never parity retries; a real mismatch fails.
 *
 * The browser runs HEADED on purpose: headless Firefox has no WebGL2 on a
 * display-less host, while a headed Firefox under Xvfb renders WebGL2 via
 * Mesa (llvmpipe/swrast). A DISPLAY must therefore be provided by the
 * caller (e.g. xvfb-run). Launch flags are a fresh temporary profile
 * (-profile + user.js prefs) so runs share no state.
 *
 * Firefox's content, GPU and utility sandboxes stay ENABLED by default.
 * On hosts where the kernel refuses the sandbox's user namespace
 * (clone() EPERM), the first attempt dies with that signature on stderr
 * and the dump retries once with the browser sandboxes disabled — the
 * same trade chrome-dump makes with --no-sandbox, applied only on hosts
 * that provably cannot run the sandbox. Parity comparisons are
 * same-browser, so a weakened sandbox cannot mask a mismatch.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'

const [firefox, url, timeoutMs, out] = process.argv.slice(2)
// Mirror chrome-dump: talk to the server over 127.0.0.1, not localhost —
// localhost can resolve to ::1 first.
const safeUrl = url.replace('http://localhost:', 'http://127.0.0.1:')
if (!firefox || !url || !timeoutMs || !out) {
  console.error('usage: node scripts/firefox-dump.mjs <firefox> <url> <timeout-ms> <out-file>')
  process.exit(3)
}
if (!process.env.DISPLAY) {
  console.error('no DISPLAY set — Firefox WebGL2 needs a display (run under Xvfb, e.g. xvfb-run)')
  process.exit(3)
}

const SUMMARY_MARKER = /===\s*\d+\s*ok,\s*\d+\s*fail(?:\s*\/\s*\d+\s*total)?\s*===/
// FXDUMP_DEBUG diagnostics go to STDOUT on purpose: the caller treats any
// stderr output from a dump child as a failed dump, so stderr must stay
// exclusively failure diagnostics.
const debug = msg => { if (process.env.FXDUMP_DEBUG) console.log(`[fxdump-debug] ${msg}`) }
// Grace after the marker, same shape as chrome-dump, so trailing DOM work
// finishes before the source is captured.
const MARKER_GRACE_MS = 5000
const MARIONETTE_HOST = '127.0.0.1'
const MARIONETTE_PORT = 2828
// Firefox prints this at startup when its sandbox cannot start; a dump
// that dies with this signature retries once with the sandboxes disabled.
const SANDBOX_EPERM_SIGNATURE = /CanCreateUserNamespace\(\) clone\(\) failure/

// Fresh-profile prefs: no first-run/welcome/update prompts in the headed
// window, and proxy settings mirroring the *_proxy env when one is set (the
// page loads the engine from the CDN through the proxy while the sweep
// server is loopback and must be bypassed; chrome-dump expresses the same
// split with --proxy-server + <-loopback>).
function profilePrefs() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
  const prefs = [
    'user_pref("browser.startup.page", 0);',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("browser.aboutwelcome.enabled", false);',
    'user_pref("browser.startup.homepage_override.mstone", "ignore");',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("toolkit.telemetry.enabled", false);',
    'user_pref("browser.sessionstore.resume_from_crash", false);',
    'user_pref("browser.tabs.warnOnClose", false);',
    // One content process, no site isolation: this run renders a single
    // local sweep page, and every extra content process costs threads that
    // restricted containers (cgroup task caps) cannot spare.
    'user_pref("fission.autostart", false);',
    'user_pref("dom.ipc.processCount", 1);',
    'user_pref("marionette.enabled", true);'
  ]
  if (proxy) {
    const u = new URL(proxy)
    const host = u.hostname
    const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80)
    prefs.push(
      'user_pref("network.proxy.type", 1);',
      `user_pref("network.proxy.http", "${host}");`,
      `user_pref("network.proxy.http_port", ${port});`,
      `user_pref("network.proxy.ssl", "${host}");`,
      `user_pref("network.proxy.ssl_port", ${port});`,
      'user_pref("network.proxy.no_proxies_on", "localhost, 127.0.0.1");'
    )
  }
  return prefs.join('\n') + '\n'
}

// One dump attempt: launch Firefox, drive Marionette, capture the DOM.
// Resolves { ok: true, source } or { ok: false, stderr, message }.
// deadline bounds the whole dump (both attempts share it).
function attemptDump({ deadline, sandboxDisabled }) {
  return new Promise(resolve => {
    const profileDir = mkdtempSync(join(tmpdir(), 'parity-summary-firefox-'))
    writeFileSync(join(profileDir, 'user.js'), profilePrefs())
    // Default run: no sandbox overrides at all. The fallback attempt (only
    // after a clone-EPERM failure) disables the browser sandboxes because
    // this host cannot run them.
    const env = { ...process.env }
    if (sandboxDisabled) {
      env.MOZ_DISABLE_CONTENT_SANDBOX = '1'
      env.MOZ_DISABLE_GPU_SANDBOX = '1'
      env.MOZ_DISABLE_RDD_SANDBOX = '1'
      env.MOZ_DISABLE_SOCKETPROCESS_SANDBOX = '1'
      env.MOZ_DISABLE_UTILITY_SANDBOX = '1'
      env.MOZ_DISABLE_GMPLUGIN_SANDBOX = '1'
      env.MOZ_DISABLE_GMP_SANDBOX = '1'
    }
    const child = spawn(firefox,
      ['-marionette', '-profile', profileDir, '-no-remote', '-width', '1280', '-height', '1024'],
      { stdio: ['ignore', 'pipe', 'pipe'], env })
    debug(`spawn attempt (sandboxDisabled=${sandboxDisabled})`)

    const stderrChunks = []
    child.stderr.on('data', d => stderrChunks.push(d))
    child.stdout.on('data', () => {})

    let settledSource = null
    let failureMessage = null
    const abort = msg => {
      if (failureMessage === null) failureMessage = msg
      child.kill('SIGKILL')
    }
    const timer = setTimeout(() => {
      abort('firefox dump timed out with no complete DOM')
    }, Math.max(1000, deadline - Date.now()))
    child.on('error', err => {
      clearTimeout(timer)
      rmSync(profileDir, { recursive: true, force: true })
      resolve({ ok: false, stderr: '', message: `firefox launch failed: ${err.message}` })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      rmSync(profileDir, { recursive: true, force: true })
      const stderrText = Buffer.concat(stderrChunks).toString('utf8')
      if (settledSource !== null) {
        resolve({ ok: true, source: settledSource })
        return
      }
      const lastLine = (stderrText.trim().split('\n').pop() || '').slice(-300)
      resolve({ ok: false, stderr: stderrText,
        message: failureMessage !== null ? failureMessage
          : `firefox exited (exit=${code} signal=${signal}): ${lastLine}` })
    })

    // --- Minimal Marionette (protocol 3) client -----------------------------
    // Packets are `<len>:<json>`. The server opens the connection with its
    // handshake object before any command. Commands are four-element arrays
    // [0, id, name, params] (0 = Command type); responses are
    // [1, id, error|null, result|null] (1 = Response type).
    const pending = new Map()
    let nextCommandId = 1
    let handshake = null
    let buf = Buffer.alloc(0)
    let sock = null

    function sendCommand(name, params) {
      const id = nextCommandId++
      const body = JSON.stringify([0, id, name, params])
      debug(`send ${name} (${body.length} bytes)`)
      sock.write(`${Buffer.byteLength(body)}:${body}`)
      return new Promise((resolve2, reject) => pending.set(id, { resolve: resolve2, reject, name }))
    }

    function connectMarionette(attempt = 0) {
      debug(`connect attempt ${attempt}`)
      sock = connect(MARIONETTE_PORT, MARIONETTE_HOST)
      sock.on('connect', () => debug('tcp connected'))
      sock.on('error', err => {
        if (failureMessage !== null || settledSource !== null) return
        if (attempt < 60) {
          sock.destroy()
          setTimeout(() => connectMarionette(attempt + 1), 1000)
        } else {
          abort(`cannot reach the Marionette server on ${MARIONETTE_HOST}:${MARIONETTE_PORT} (${err.message})`)
        }
      })
      sock.on('data', d => {
        // Frame on BYTES: the length prefix counts bytes, and the sweep DOM
        // carries multibyte UTF-8, so a char-counted string buffer never
        // accumulates enough to complete large packets.
        buf = Buffer.concat([buf, d])
        for (;;) {
          const sep = buf.indexOf(0x3a)
          if (sep === -1) return
          const len = Number(buf.slice(0, sep).toString('utf8'))
          if (!Number.isInteger(len) || len < 0) { abort(`bad Marionette packet framing: ${buf.slice(0, 60)}`); return }
          if (buf.length < sep + 1 + len) return
          const payload = buf.slice(sep + 1, sep + 1 + len).toString('utf8')
          buf = buf.slice(sep + 1 + len)
          onPacket(payload)
        }
      })
    }

    function onPacket(payload) {
      let msg
      try { msg = JSON.parse(payload) } catch (e) { abort(`bad Marionette JSON: ${payload.slice(0, 120)}`); return }
      if (handshake === null) {
        handshake = msg
        debug(`handshake: ${JSON.stringify(msg).slice(0, 200)}`)
        if (msg.marionetteProtocol !== 3) {
          abort(`unexpected Marionette protocol ${msg.marionetteProtocol}, expected 3`)
          return
        }
        // The driver sends the session command once the handshake lands.
        return
      }
      if (!Array.isArray(msg)) { abort(`bad Marionette response packet: ${payload.slice(0, 120)}`); return }
      const waiter = pending.get(msg[1])
      if (!waiter) return
      pending.delete(msg[1])
      if (msg[2]) waiter.reject(new Error(`Marionette ${waiter.name} error: ${msg[2].error || ''} ${msg[2].message || ''}`.trim()))
      else waiter.resolve(msg[3])
    }

    async function pollSource() {
      let markerSeen = false
      let lastSighting = 0
      for (;;) {
        if (Date.now() > deadline) { abort('firefox dump timed out with no complete DOM'); return }
        let res
        try {
          // The page source is serialized exactly like --dump-dom would print
          // it: the document element's outerHTML. Taken via
          // WebDriver:ExecuteScript rather than WebDriver:GetPageSource,
          // whose actor path does not answer while a heavy render page keeps
          // the content process busy.
          res = await sendCommand('WebDriver:ExecuteScript',
            { script: 'return document.documentElement.outerHTML' })
        } catch (e) {
          abort(e.message); return
        }
        const source = res && res.value
        if (typeof source === 'string' && SUMMARY_MARKER.test(source)) {
          // The page's summary marker only appears once the per-case
          // accounting has finished emitting. Keep the latest snapshot and
          // settle for a short grace (same shape as chrome-dump) before
          // capturing it.
          settledSource = source
          if (!markerSeen) {
            markerSeen = true
            lastSighting = Date.now()
          }
        } else if (markerSeen) {
          markerSeen = false
        }
        if (markerSeen && Date.now() - lastSighting >= MARKER_GRACE_MS) {
          child.kill('SIGKILL')
          return
        }
        await new Promise(r => setTimeout(r, 1000))
      }
    }

    ;(async () => {
      // Wait for the Marionette handshake, then navigate and poll.
      for (;;) {
        if (handshake !== null || failureMessage !== null) break
        if (Date.now() > deadline) { abort('Marionette handshake never arrived in the dump window'); return }
        await new Promise(r => setTimeout(r, 250))
      }
      if (failureMessage !== null) return
      try {
        const sessionResult = await sendCommand('WebDriver:NewSession', { capabilities: { alwaysMatch: {} } })
        debug(`newSession ok: ${JSON.stringify(sessionResult).slice(0, 200)}`)
        await sendCommand('WebDriver:Navigate', { url: safeUrl })
        debug('navigate ok')
        await pollSource()
      } catch (e) {
        abort(e.message)
      }
    })().catch(e => abort(`driver crashed: ${e && e.stack ? e.stack : e}`))
    setTimeout(() => connectMarionette(0), 500)
  })
}

const deadline = Date.now() + Number(timeoutMs)
let result = await attemptDump({ deadline, sandboxDisabled: false })
if (!result.ok && Date.now() < deadline - 15000 && SANDBOX_EPERM_SIGNATURE.test(result.stderr)) {
  console.log('[firefox-dump] the host cannot start the Firefox sandbox (user-namespace clone EPERM); retrying once with the browser sandboxes disabled')
  result = await attemptDump({ deadline, sandboxDisabled: true })
}
if (!result.ok) {
  console.error(result.message)
  process.exit(3)
}
writeFileSync(out, result.source)
process.exit(0)