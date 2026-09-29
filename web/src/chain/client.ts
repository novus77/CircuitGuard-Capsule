import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  getAddress,
  http,
  type Address,
  type EIP1193Provider,
  type Hash,
  type PublicClient,
} from 'viem'
import { TransactionJournal, type TransactionStatus } from '../state/transactionJournal'

export const XLAYER_RPC_URL = 'https://rpc.xlayer.tech'

export const xLayer = defineChain({
  id: 196,
  name: 'X Layer',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: [XLAYER_RPC_URL] } },
  blockExplorers: { default: { name: 'OKLink', url: 'https://www.oklink.com/xlayer' } },
})

export const publicClient = createPublicClient({
  chain: xLayer,
  transport: http(XLAYER_RPC_URL),
})

export async function connectWallet(provider: EIP1193Provider) {
  const chainId = Number(await provider.request({ method: 'eth_chainId' }))
  if (chainId !== xLayer.id) {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${xLayer.id.toString(16)}` }],
    })
  }

  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
  if (!accounts[0]) throw new Error('Wallet returned no account')

  return createWalletClient({
    account: getAddress(accounts[0]),
    chain: xLayer,
    transport: custom(provider),
  })
}

export async function verifyExecutionContext(
  walletClient: ReturnType<typeof createWalletClient>,
  contractAddresses: readonly Address[],
): Promise<void> {
  const [publicChainId, walletChainId] = await Promise.all([
    publicClient.getChainId(),
    walletClient.getChainId(),
  ])
  if (publicChainId !== xLayer.id || walletChainId !== xLayer.id) {
    throw new Error('Public RPC and wallet must both be on X Layer')
  }

  const bytecodes = await Promise.all(
    contractAddresses.map((address) => publicClient.getCode({ address })),
  )
  if (bytecodes.some((code) => !code || code === '0x')) {
    throw new Error('Configured contract code is missing')
  }
}

export async function waitForJournaledReceipt(
  client: PublicClient,
  journal: TransactionJournal,
  hash: Hash,
  timeoutMs = 120_000,
): Promise<TransactionStatus> {
  const result = await Promise.race([
    client
      .waitForTransactionReceipt({ hash })
      .then((receipt) => ({ kind: 'receipt' as const, receipt }))
      .catch(() => ({ kind: 'timeout' as const })),
    new Promise<{ kind: 'timeout' }>((resolve) =>
      setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs),
    ),
  ])

  if (result.kind === 'timeout') return 'pending'
  const status = result.receipt.status === 'success' ? 'confirmed' : 'reverted'
  journal.resolve(hash, status)
  return status
}
