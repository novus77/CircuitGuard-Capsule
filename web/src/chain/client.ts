import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
  keccak256,
  type Address,
  type EIP1193Provider,
  type Hash,
  type Hex,
} from 'viem'
import {
  XLAYER_PRIMARY_RPC_URL,
  XLAYER_SECONDARY_RPC_URL,
  xLayer,
} from '../config/xlayer'

export { waitForJournaledFinality } from './finality'

export const primaryClient = createPublicClient({
  chain: xLayer,
  transport: http(XLAYER_PRIMARY_RPC_URL),
})

export const secondaryClient = createPublicClient({
  chain: xLayer,
  transport: http(XLAYER_SECONDARY_RPC_URL),
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
  contracts: readonly { address: Address; codeHash: Hash }[],
): Promise<void> {
  const [publicChainId, walletChainId] = await Promise.all([
    primaryClient.getChainId(),
    walletClient.getChainId(),
  ])
  if (publicChainId !== xLayer.id || walletChainId !== xLayer.id) {
    throw new Error('Public RPC and wallet must both be on X Layer')
  }

  const bytecodes = await Promise.all(
    contracts.map(async ({ address }) =>
      walletClient.request({ method: 'eth_getCode', params: [address, 'latest'] }) as Promise<Hex>,
    ),
  )
  for (const [index, code] of bytecodes.entries()) {
    if (!code || code === '0x') {
      throw new Error(`Wallet RPC reports missing code at ${contracts[index].address}`)
    }
    if (keccak256(code).toLowerCase() !== contracts[index].codeHash.toLowerCase()) {
      throw new Error(`Wallet RPC code hash mismatch at ${contracts[index].address}`)
    }
  }
}
