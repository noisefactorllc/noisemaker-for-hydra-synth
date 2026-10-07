import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOTAL_CASES } from '../scripts/ci-gate.mjs'
import { classifyCaseIds, deriveSweepCaseIds, generatedCaseNames, pageCaseNames } from '../scripts/sweep-case-set.mjs'

// Regression pins: the expected sweep case-id
// set must be derived from the same catalog modules and page bytes the sweep
// renders, cross-checked against TOTAL_CASES, with duplicates, missing ids,
// and unexpected ids failing regardless of the counts.

const PAGE_PATH = join(import.meta.dirname, '..', 'dev-noisemaker', 'pixel-parity.html')

test('live derivation: the derived expected id set matches TOTAL_CASES exactly', () => {
  const ids = deriveSweepCaseIds()
  assert.equal(ids.length, TOTAL_CASES)
  assert.equal(new Set(ids).size, ids.length, 'derived ids must be distinct')
})

test('live derivation: generated names come from the catalog modules the page imports', () => {
  const generated = generatedCaseNames()
  assert.ok(generated.includes('noise_src'))
  assert.ok(generated.includes('rotate_coord'))
  assert.ok(generated.every(name => !['src', 'prev', 'sum'].some(excluded => name === `${excluded}_src` || name.startsWith(`${excluded}_`))))
})

test('live derivation: hand-written case ids come from the page bytes the sweep renders', () => {
  const pageNames = pageCaseNames(readFileSync(PAGE_PATH, 'utf8'))
  for (const manual of ['sum_reference', 'sum_default_scale', 'rotate_animated_uniform_parameter', 'native_to_hydra_src_surface', 'hydra_to_native_read_surface', 'noisemaker_native_control']) {
    assert.ok(pageNames.has(manual), `page bytes must yield ${manual}`)
  }
  // Template-generated names must NOT be extractable from page literals —
  // they are covered by the catalog-module derivation.
  assert.ok(!pageNames.has('noise_src'))
})

test('live derivation: a page that drops a hand-written case changes the derived set size, failing the TOTAL_CASES cross-check', () => {
  const dropped = readFileSync(PAGE_PATH, 'utf8').replace("name: 'sum_default_scale',", "name: 'dropped_case_renamed',")
  // A rename keeps the count but changes the id — the sweep-time id-set
  // comparison against the real catalog must flag it.
  const drifted = deriveSweepCaseIds({ pageText: dropped })
  assert.ok(drifted.includes('dropped_case_renamed'))
  const live = deriveSweepCaseIds()
  const { unexpected, missing } = classifyCaseIds(drifted, live)
  assert.deepEqual(unexpected, ['dropped_case_renamed'])
  assert.deepEqual(missing, ['sum_default_scale'])
  // A full drop (the hand-written name literal removed entirely) shrinks the
  // derived set below TOTAL_CASES, which the entrypoints reject before any
  // sweep runs.
  const removed = readFileSync(PAGE_PATH, 'utf8').replace("name: 'sum_default_scale',", '')
  assert.equal(deriveSweepCaseIds({ pageText: removed }).length, TOTAL_CASES - 1)
})

test('classifyCaseIds: a duplicated-and-omitted DOM is caught regardless of consistent counts', () => {
  // The exact reopen scenario: 71 per-case lines where one passing case is
  // reported twice and another is omitted — every count stays consistent
  // (perCaseCount == total == 71) but the id set is wrong.
  const expected = ['a', 'b', 'c']
  const reported = ['a', 'a', 'b'] // c omitted, a duplicated
  const { duplicates, unexpected, missing } = classifyCaseIds(reported, expected)
  assert.deepEqual(duplicates, ['a'])
  assert.deepEqual(unexpected, [])
  assert.deepEqual(missing, ['c'])
})

test('classifyCaseIds: an unexpected id replacing a real one is caught even with a consistent distinct count', () => {
  const { duplicates, unexpected, missing } = classifyCaseIds(['a', 'b', 'bogus_case'], ['a', 'b', 'c'])
  assert.deepEqual(duplicates, [])
  assert.deepEqual(unexpected, ['bogus_case'])
  assert.deepEqual(missing, ['c'])
})

test('classifyCaseIds: a clean full sweep reports no violations', () => {
  const ids = deriveSweepCaseIds()
  assert.deepEqual(classifyCaseIds(ids, ids), { duplicates: [], unexpected: [], missing: [] })
})
