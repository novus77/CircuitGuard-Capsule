import { describe, expect, it } from 'vitest'
import { decodeDecision, encodePolicyFacts } from '../src/domain/policy'

describe('policy codec', () => {
  it('maps the six facts to Solidity bits 0 through 5', () => {
    expect(
      encodePolicyFacts({
        systemActive: true,
        recipientTrusted: true,
        recipientBlocked: false,
        amountLow: true,
        withinDailyBudget: true,
        humanApproved: false,
      }),
    ).toBe(0x1b)

    const keys = [
      'systemActive',
      'recipientTrusted',
      'recipientBlocked',
      'amountLow',
      'withinDailyBudget',
      'humanApproved',
    ] as const

    keys.forEach((key, bit) => {
      const facts = Object.fromEntries(keys.map((candidate) => [candidate, candidate === key]))
      expect(encodePolicyFacts(facts)).toBe(1 << bit)
    })
  })

  it('decodes only the three valid two-bit decisions', () => {
    expect(decodeDecision(0)).toBe('DENY')
    expect(decodeDecision(1)).toBe('ALLOW')
    expect(decodeDecision(2)).toBe('REVIEW')
    expect(decodeDecision(3)).toBe('INVALID')
    expect(decodeDecision(0x80)).toBe('INVALID')
  })
})
