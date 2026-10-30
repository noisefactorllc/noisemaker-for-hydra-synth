export function describeBrowserError(error) {
  if (error === null || typeof error !== 'object') return String(error)
  const details = {}
  for (const key of new Set(['name', 'message', 'stack', ...Object.getOwnPropertyNames(error)])) {
    let value
    try { value = error[key] } catch { continue }
    if (value === undefined) continue
    try { details[key] = JSON.parse(JSON.stringify(value)) } catch { details[key] = String(value) }
  }
  return details
}

export function installBrowserDiagnostics(target = window) {
  target.__parityStage = 'initialization'
  target.__parityDiagnostics = []
  const record = entry => target.__parityDiagnostics.push({ stage: target.__parityStage, ...entry })
  for (const kind of ['error', 'warn']) {
    const original = target.console[kind].bind(target.console)
    target.console[kind] = (...args) => {
      record({ kind: `console.${kind}`, args: args.map(describeBrowserError) })
      original(...args)
    }
  }
  target.addEventListener('error', event => record({ kind: 'error', error: describeBrowserError(event.error || event.message) }))
  target.addEventListener('unhandledrejection', event => record({ kind: 'unhandledrejection', error: describeBrowserError(event.reason) }))
}
