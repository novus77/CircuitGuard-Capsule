import { describe, expect, it } from 'vitest'
import { formatAssetAmount, parseAssetAmount } from '../src/domain/amount'

describe('asset amount codec', () => {
  it('parses and formats OKB with 18 decimals', () => {
    expect(parseAssetAmount('OKB', '0.01')).toBe(10_000_000_000_000_000n)
    expect(formatAssetAmount('OKB', 10_000_000_000_000_000n)).toBe('0.01')
  })

  it('parses and formats USDT0 with 6 decimals', () => {
    expect(parseAssetAmount('USDT0', '3.123456')).toBe(3_123_456n)
    expect(formatAssetAmount('USDT0', 3_123_456n)).toBe('3.123456')
  })

  it.each(['', '0', '0.0', '-1', '+1', '1e3', '01', ' 1', '1 '])(
    'rejects non-canonical or zero input %j',
    (value) => {
      expect(() => parseAssetAmount('USDT0', value)).toThrow()
    },
  )

  it('rejects fractional precision beyond the selected asset', () => {
    expect(() => parseAssetAmount('USDT0', '1.0000001')).toThrow()
    expect(() => parseAssetAmount('OKB', '1.0000000000000000001')).toThrow()
  })

  it('rejects values that do not fit the on-chain uint128 amount', () => {
    expect(() => parseAssetAmount('USDT0', '340282366920938463463374607431769')).toThrow()
  })
})
