import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODULE_PAGE_BODY, isExpectedS001Diagnostic } from './installed-workflow-page.mjs'

test('isExpectedS001Diagnostic matches only the complete expected S001 diagnostic', () => {
  const expected = "Recompilation failed: Unknown effect: 'hydraMissing'; write() requires an input - cannot be first in chain: '[Write]' (line 2, col 16)"
  assert.equal(isExpectedS001Diagnostic(expected), true)
  // Numeric fields vary with the source position; the rest must not.
  assert.equal(isExpectedS001Diagnostic(expected.replace('line 2, col 16', 'line 41, col 3')), true)
  // Any other recompilation failure must fail the check.
  assert.equal(isExpectedS001Diagnostic("Recompilation failed: Unknown effect: 'notAnEffect'"), false)
  assert.equal(isExpectedS001Diagnostic("Recompilation failed: hydraMissing"), false)
  assert.equal(isExpectedS001Diagnostic("Recompilation failed: Unknown effect: 'hydraMissing'"), false)
  // The expected diagnostic with additional unexpected text must fail the check.
  assert.equal(isExpectedS001Diagnostic(expected + ' boom'), false)
  assert.equal(isExpectedS001Diagnostic('prefix ' + expected), false)
  assert.equal(isExpectedS001Diagnostic(expected.replace("(line 2, col 16)", "(line 2, col 16) via evil")), false)
  assert.equal(isExpectedS001Diagnostic('unrelated error'), false)
})

test('page body uses the serialized shared predicate, not an ad-hoc regex', () => {
  assert.ok(MODULE_PAGE_BODY.includes('const isExpectedS001 ='))
  assert.ok(!/Recompilation failed[^'`]*hydraMissing/.test(MODULE_PAGE_BODY.replace(/\s+/g, ' ')),
    'page body must not contain a second, divergent S001 regex')
})
