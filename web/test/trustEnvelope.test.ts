import { describe, expect, it } from 'vitest'
import { canSign, classifyOverall } from '../src/domain/trustEnvelope'

const verified = { status: 'verified', summary: 'Verified' } as const
const unverified = { status: 'unverified', summary: 'Unverified' } as const
const degraded = { status: 'degraded', summary: 'Degraded' } as const
const blocked = { status: 'blocked', summary: 'Blocked' } as const
const loading = { status: 'loading', summary: 'Loading' } as const

describe('Trust Envelope classification', () => {
  it('reports verified only when every layer is verified', () => {
    expect(classifyOverall({ site: verified, policy: verified, execution: verified })).toBe(
      'verified',
    )
  })

  it('uses the fail-closed status priority', () => {
    expect(classifyOverall({ site: unverified, policy: degraded, execution: verified })).toBe(
      'unverified',
    )
    expect(classifyOverall({ site: verified, policy: blocked, execution: degraded })).toBe(
      'blocked',
    )
    expect(classifyOverall({ site: verified, policy: degraded, execution: loading })).toBe(
      'degraded',
    )
    expect(classifyOverall({ site: verified, policy: verified, execution: loading })).toBe(
      'loading',
    )
  })
})

describe('shared signing gate', () => {
  it('enables signing only when trust and runtime prerequisites are ready', () => {
    expect(
      canSign({
        overall: 'verified',
        walletReady: true,
        modelReady: true,
        unresolved: false,
      }),
    ).toBe(true)

    expect(
      canSign({
        overall: 'verified',
        walletReady: true,
        modelReady: true,
        unresolved: true,
      }),
    ).toBe(false)
  })

  it.each([
    { overall: 'loading', walletReady: true, modelReady: true },
    { overall: 'unverified', walletReady: true, modelReady: true },
    { overall: 'degraded', walletReady: true, modelReady: true },
    { overall: 'blocked', walletReady: true, modelReady: true },
    { overall: 'verified', walletReady: false, modelReady: true },
    { overall: 'verified', walletReady: true, modelReady: false },
  ] as const)('rejects incomplete or unsafe state: $overall', (input) => {
    expect(canSign({ ...input, unresolved: false })).toBe(false)
  })
})
