import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateSweep, parseSummary, TOTAL_CASES } from '../scripts/ci-gate.mjs'
import { deriveSweepCaseIds } from '../scripts/sweep-case-set.mjs'

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

const TOTAL = TOTAL_CASES

test('evaluateSweep GREEN path: fully exact 71/71 sweep passes with zero reasons', () => {
  const parsed = parseSummary(dom({ okCases: TOTAL, failCases: 0, summaryOk: TOTAL, summaryFail: 0, summaryTotal: TOTAL }))
  const result = evaluateSweep(parsed, TOTAL)
  assert.equal(result.passed, true)
  assert.deepEqual(result.reasons, [])
})

test('evaluateSweep: one short of the denominator with a mismatch fails with the strict mismatch reason, reported once', () => {
  const parsed = parseSummary(dom({ okCases: TOTAL - 1, failCases: 1, summaryOk: TOTAL - 1, summaryFail: 1, summaryTotal: TOTAL }))
  const result = evaluateSweep(parsed, TOTAL)
  assert.equal(result.passed, false)
  assert.equal(result.reasons.length, 1)
  assert.match(result.reasons[0], /mismatches must fail qualification/)
  assert.match(result.reasons[0], /fail_case_0/)
})

test('evaluateSweep: a page bug that misreports the summary while silently skipping a case fails', () => {
  // 70 per-case lines but the summary claims 71 total — the page's own
  // accounting must not be trusted.
  const parsed = parseSummary(dom({ okCases: 70, failCases: 0, summaryOk: 71, summaryFail: 0, summaryTotal: TOTAL }))
  const result = evaluateSweep(parsed, TOTAL)
  assert.equal(result.passed, false)
  assert.ok(result.reasons.some(r => r.includes('per-case line count')))
  assert.ok(result.reasons.some(r => r.includes('distinct executed cases')))
})

test('evaluateSweep: a page reporting a case more than once fails', () => {
  const parsed = parseSummary(dom({ okCases: 70, failCases: 0, summaryOk: 71, summaryFail: 0, summaryTotal: TOTAL, duplicate: true }))
  const result = evaluateSweep(parsed, TOTAL)
  assert.equal(result.passed, false)
  assert.ok(result.reasons.some(r => r.includes('duplicate ok case names')))
})

test('evaluateSweep: unreported failures (FAIL line without summary acknowledgement) fail', () => {
  const parsed = parseSummary(dom({ okCases: 70, failCases: 1, summaryOk: 71, summaryFail: 0, summaryTotal: TOTAL }))
  const result = evaluateSweep(parsed, TOTAL)
  assert.equal(result.passed, false)
  assert.ok(result.reasons.some(r => r.includes('unreported failures')))
})

test('evaluateSweep: a sweep with no summary line fails closed', () => {
  const result = evaluateSweep({ ok: null, total: null, fail: null, failures: [], okLines: [], perCaseCount: 0 }, TOTAL)
  assert.equal(result.passed, false)
  assert.ok(result.reasons.some(r => r.includes('no summary line')))
})

// Pins: with the derived expected id set, the
// gate must fail duplicates, missing ids, and unexpected ids regardless of
// the counts, and THROW lines must surface as unexpected ids.

test('evaluateSweep with expectedIds: GREEN path passes against the live derived set', () => {
  const ids = deriveSweepCaseIds()
  const parsed = parseSummary(dom({ okCases: ids.length, failCases: 0, summaryOk: ids.length, summaryFail: 0, summaryTotal: ids.length }))
  // Rewrite the synthetic names to the real derived ids, in order.
  const okLines = ids
  parsed.okLines = okLines
  parsed.ok = okLines.length
  parsed.perCaseCount = okLines.length + parsed.failures.length
  const result = evaluateSweep(parsed, ids.length, ids)
  assert.equal(result.passed, true)
  assert.deepEqual(result.reasons, [])
})

test('evaluateSweep with expectedIds: a duplicated-and-omitted DOM fails with id-set reasons even when counts are consistent', () => {
  // 71 per-case lines: case_0 reported twice, case_1 omitted. perCaseCount,
  // total, and the summary all agree at 71; the id set is still wrong.
  const lines = []
  for (let i = 0; i < TOTAL; i++) lines.push(`ok    case_${i === 1 ? 0 : i}`)
  lines.push(`=== ${TOTAL} ok, 0 fail / ${TOTAL} total ===`)
  const domText = `<html><body><div id="log"><div>${lines.join('</div><div>')}</div></div><script></script></body></html>`
  const parsed = parseSummary(domText)
  const expectedIds = Array.from({ length: TOTAL }, (_, i) => `case_${i}`)
  const result = evaluateSweep(parsed, TOTAL, expectedIds)
  assert.equal(result.passed, false)
  assert.ok(result.reasons.some(r => r.includes('duplicate case ids') && r.includes('case_0')))
  assert.ok(result.reasons.some(r => r.includes('missing case ids') && r.includes('case_1')))
})

test('evaluateSweep with expectedIds: an unexpected id replacing a real one fails even with a consistent distinct count', () => {
  const expectedIds = Array.from({ length: TOTAL }, (_, i) => `case_${i}`)
  const lines = expectedIds.map(id => `ok    ${id === 'case_1' ? 'bogus_case' : id}`)
  lines.push(`=== ${TOTAL} ok, 0 fail / ${TOTAL} total ===`)
  const domText = `<html><body><div id="log"><div>${lines.join('</div><div>')}</div></div><script></script></body></html>`
  const parsed = parseSummary(domText)
  const result = evaluateSweep(parsed, TOTAL, expectedIds)
  assert.equal(result.passed, false)
  assert.ok(result.reasons.some(r => r.includes('unexpected case ids') && r.includes('bogus_case')))
  assert.ok(result.reasons.some(r => r.includes('missing case ids') && r.includes('case_1')))
})

test('evaluateSweep with expectedIds: THROW lines are counted as failures and their names surface as unexpected ids', () => {
  const expectedIds = Array.from({ length: TOTAL }, (_, i) => `case_${i}`)
  const lines = expectedIds.slice(0, TOTAL - 1).map(id => `ok    ${id}`)
  lines.push('THROW parity_fixture  →  boom')
  lines.push(`=== ${TOTAL - 1} ok, 1 fail / ${TOTAL} total ===`)
  const domText = `<html><body><div id="log"><div>${lines.join('</div><div>')}</div></div><script></script></body></html>`
  const parsed = parseSummary(domText)
  const result = evaluateSweep(parsed, TOTAL, expectedIds)
  assert.equal(result.passed, false)
  assert.ok(result.reasons.some(r => r.includes('mismatches must fail qualification')))
  assert.ok(result.reasons.some(r => r.includes('unexpected case ids') && r.includes('parity_fixture')))
  assert.ok(result.reasons.some(r => r.includes('missing case ids') && r.includes(`case_${TOTAL - 1}`)))
})

test('evaluateSweep without expectedIds: behavior is unchanged (no id-set reasons)', () => {
  const parsed = parseSummary(dom({ okCases: TOTAL, failCases: 0, summaryOk: TOTAL, summaryFail: 0, summaryTotal: TOTAL }))
  const result = evaluateSweep(parsed, TOTAL)
  assert.equal(result.passed, true)
  assert.deepEqual(result.reasons, [])
})
