import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import {
  CANONICAL_NETLIST,
  EXPECTED_HASH,
  compilePolicy,
  evaluateGraph,
  evaluateReference,
} from '../src/policy.mjs'

test('canonical netlist and hash are stable', () => {
  assert.equal(compilePolicy(), CANONICAL_NETLIST)
  assert.equal((CANONICAL_NETLIST.length - 2) / 2, 91)
  const hash = execFileSync('cast', ['keccak', CANONICAL_NETLIST], {
    encoding: 'utf8',
  }).trim()
  assert.equal(hash, EXPECTED_HASH)
})

test('all 64 vectors match and never produce invalid output', () => {
  for (let inputs = 0; inputs < 64; inputs += 1) {
    const actual = evaluateGraph(inputs)
    const expected = evaluateReference(inputs)
    const vector = inputs.toString(2).padStart(6, '0')

    assert.equal(actual, expected, `vector ${vector}`)
    assert.notEqual(actual, 3, `vector ${vector}`)
  }
})
