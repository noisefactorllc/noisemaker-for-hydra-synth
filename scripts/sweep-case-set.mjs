// Expected sweep case-id derivation for the rendered parity entrypoints.
//
// The parity-summary line counting could
// accept a sweep DOM that duplicates one passing case and omits another —
// such a DOM still reported expected=executed=exact with missing=0. The
// fix required by the reopen: derive the EXPECTED id set from the same
// catalog modules and page bytes the sweep renders, cross-check it against
// TOTAL_CASES, and fail every sweep whose per-case ids contain duplicates,
// missing ids, or unexpected ids regardless of the counts.
//
// The sweep page (dev-noisemaker/pixel-parity.html) builds its fixtures
// from two sources:
//   1. generated cases: glslFunctions() filtered by isExecutableHydraEffect
//      and the exclusion list ['src', 'prev', 'sum'], named
//      `${effect.name}_${effect.type}` — derived here from the SAME catalog
//      modules the page imports;
//   2. hand-written cases: literal `name: '<id>'` entries in the page's
//      FIXTURES.push block and transition list, plus literal
//      `want('<id>')` guards — extracted from the page bytes themselves.
// The union is the expected case-id set. Its size must equal TOTAL_CASES
// (the strict gate's denominator), so a catalog or page drift fails the
// derivation loudly instead of silently moving the denominator.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import glslFunctions from '../src/glsl/glsl-functions.js'
import { isExecutableHydraEffect } from '../src/engine/hydraGlsl.js'

const SWEEP_PAGE = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dev-noisemaker', 'pixel-parity.html')

// Same derivation as the page's FIXTURES map: identical filter, identical
// exclusion list, identical name template.
export function generatedCaseNames() {
  return glslFunctions()
    .filter(effect => isExecutableHydraEffect(effect) && !['src', 'prev', 'sum'].includes(effect.name))
    .map(effect => `${effect.name}_${effect.type}`)
}

// Hand-written case ids, extracted from the page bytes the sweep actually
// renders: every literal `name: '<id>'` (FIXTURES.push entries and the
// native-transition list) plus every literal `want('<id>')` guard.
export function pageCaseNames(pageText) {
  const names = new Set()
  for (const m of pageText.matchAll(/\bname:\s*'([a-zA-Z0-9_]+)'/g)) names.add(m[1])
  for (const m of pageText.matchAll(/\bwant\('([a-zA-Z0-9_]+)'\)/g)) names.add(m[1])
  return names
}

// Full expected id set for one size sweep: generated + page-derived, sorted.
// Cross-checked against TOTAL_CASES by the caller (or via the default below).
export function deriveSweepCaseIds({ pageText } = {}) {
  const text = pageText ?? readFileSync(SWEEP_PAGE, 'utf8')
  return [...new Set([...generatedCaseNames(), ...pageCaseNames(text)])].sort()
}

// Classify a sweep's per-case ids (in emission order, duplicates preserved)
// against the expected set. Returns { duplicates, unexpected, missing } —
// empty arrays mean the id accounting is clean regardless of counts.
export function classifyCaseIds(reportedIds, expectedIds) {
  const expected = new Set(expectedIds)
  const seen = new Set()
  const duplicates = []
  const unexpected = []
  for (const id of reportedIds) {
    if (seen.has(id) && !duplicates.includes(id)) duplicates.push(id)
    seen.add(id)
    if (!expected.has(id) && !unexpected.includes(id)) unexpected.push(id)
  }
  const missing = expectedIds.filter(id => !seen.has(id))
  return { duplicates, unexpected, missing }
}
