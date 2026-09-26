import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateSweep, parseSummary } from '../scripts/ci-gate.mjs'

// Synthetic sweep-page DOMs in the exact protocol dev-noisemaker/pixel-parity.html
// emits: per-case `ok <name>` / `FAIL <name> ...` lines inside <div id="log">,
// followed by the `=== N ok, M fail / T total ===` summary.

function dom({ okCases, failCases, summaryOk, summaryFail, summaryTotal, duplicate }) {
  const lines = []
  const names = []
  for (let i = 0; i < okCases; i++) {
    const n = `case_${i}`
    if (duplicate && i === 0) names.push(n)
    names.push(n)
  }
  for (const n of names) lines.push(`ok    ${n}`)
  for (let i = 0; i < failCases; i++) {
    lines.push(`FAIL  fail_case_${i}  →  1/16384 bytes differ; max delta 1; samples []`)
  }
  lines.push(`=== ${summaryOk} ok, ${summaryFail} fail / ${summaryTotal} total ===`)
  return `<html><body><div id="log"><div>${lines.join('</div><div>')}</div></div><script></script></body></html>`
}

const TOTAL = 58

test('evaluateSweep GREEN path: fully exact 58/58 sweep passes with zero reasons', () => {
  const parsed = parseSummary(dom({ okCases: TOTAL, failCases: 0, summaryOk: TOTAL, summaryFail: 0, summaryTotal: TOTAL }))
  const result = evaluateSweep(parsed, TOTAL)
  assert.equal(result.passed, true)
  assert.deepEqual(result.reasons, [])
})

test('evaluateSweep: 57/58 with one mismatch fails with the strict mismatch reason, reported once', () => {
  const parsed = parseSummary(dom({ okCases: 57, failCases: 1, summaryOk: 57, summaryFail: 1, summaryTotal: TOTAL }))
  const result = evaluateSweep(parsed, TOTAL)
  assert.equal(result.passed, false)
  assert.equal(result.reasons.length, 1)
  assert.match(result.reasons[0], /mismatches must fail qualification/)
  assert.match(result.reasons[0], /fail_case_0/)
})

test('evaluateSweep: a page bug that misreports the summary while silently skipping a case fails', () => {
  // 57 per-case lines but the summary claims 58 total — the page's own
  // accounting must not be trusted.
  const parsed = parseSummary(dom({ okCases: 57, failCases: 0, summaryOk: 57, summaryFail: 0, summaryTotal: TOTAL }))
  const result = evaluateSweep(parsed, TOTAL)
  assert.equal(result.passed, false)
  assert.ok(result.reasons.some(r => r.includes('per-case line count')))
  assert.ok(result.reasons.some(r => r.includes('distinct executed cases')))
})

test('evaluateSweep: a page reporting a case more than once fails', () => {
  const parsed = parseSummary(dom({ okCases: 58, failCases: 0, summaryOk: 58, summaryFail: 0, summaryTotal: TOTAL, duplicate: true }))
  const result = evaluateSweep(parsed, TOTAL)
  assert.equal(result.passed, false)
  assert.ok(result.reasons.some(r => r.includes('duplicate ok case names')))
})

test('evaluateSweep: unreported failures (FAIL line without summary acknowledgement) fail', () => {
  const parsed = parseSummary(dom({ okCases: 57, failCases: 1, summaryOk: 58, summaryFail: 0, summaryTotal: TOTAL }))
  const result = evaluateSweep(parsed, TOTAL)
  assert.equal(result.passed, false)
  assert.ok(result.reasons.some(r => r.includes('unreported failures')))
})

test('evaluateSweep: a sweep with no summary line fails closed', () => {
  const result = evaluateSweep({ ok: null, total: null, fail: null, failures: [], okLines: [], perCaseCount: 0 }, TOTAL)
  assert.equal(result.passed, false)
  assert.ok(result.reasons.some(r => r.includes('no summary line')))
})
