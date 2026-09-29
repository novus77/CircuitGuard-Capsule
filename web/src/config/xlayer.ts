import { defineChain } from 'viem'

export const XLAYER_PRIMARY_RPC_URL = 'https://rpc.xlayer.tech'
export const XLAYER_SECONDARY_RPC_URL = 'https://xlayerrpc.okx.com'

export const xLayer = defineChain({
  id: 196,
  name: 'X Layer',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: {
    default: { http: [XLAYER_PRIMARY_RPC_URL, XLAYER_SECONDARY_RPC_URL] },
  },
  blockExplorers: {
    default: { name: 'OKLink', url: 'https://www.oklink.com/xlayer' },
  },
})
