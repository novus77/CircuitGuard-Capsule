import { formatUnits, parseUnits } from 'viem'

export type Asset = 'OKB' | 'USDT0'

const UINT128_MAX = (1n << 128n) - 1n
const ASSET_DECIMALS: Record<Asset, number> = {
  OKB: 18,
  USDT0: 6,
}

export function parseAssetAmount(asset: Asset, text: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(text)) {
    throw new Error('Amount must use canonical decimal notation')
  }

  const decimals = ASSET_DECIMALS[asset]
  const fractionalDigits = text.split('.')[1]?.length ?? 0
  if (fractionalDigits > decimals) {
    throw new Error(`${asset} supports at most ${decimals} fractional digits`)
  }

  const value = parseUnits(text, decimals)
  if (value === 0n) throw new Error('Amount must be greater than zero')
  if (value > UINT128_MAX) throw new Error('Amount exceeds uint128')
  return value
}

export function formatAssetAmount(asset: Asset, value: bigint): string {
  if (value < 0n || value > UINT128_MAX) throw new Error('Amount is outside uint128')
  return formatUnits(value, ASSET_DECIMALS[asset])
}
