import { getAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { formatEndpointCoordinate } from '../src/domain/endpoint'

const CONTAINER = '0x2222222222222222222222222222222222222222'

describe('endpoint coordinate', () => {
  it('binds the chain ID to a checksummed container address', () => {
    expect(formatEndpointCoordinate(196, CONTAINER)).toBe(`196:${getAddress(CONTAINER)}`)
  })

  it('rejects invalid chain IDs', () => {
    expect(() => formatEndpointCoordinate(0, CONTAINER)).toThrow('positive integer')
    expect(() => formatEndpointCoordinate(196.5, CONTAINER)).toThrow('positive integer')
  })

  it('rejects invalid container addresses', () => {
    expect(() => formatEndpointCoordinate(196, 'not-an-address')).toThrow()
  })
})
