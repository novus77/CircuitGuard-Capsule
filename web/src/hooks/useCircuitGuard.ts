import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import {
  getAddress,
  keccak256,
  toBytes,
  type Address,
  type EIP1193Provider,
  type Hash,
} from 'viem'
import deploymentJson from '../generated/deployment.json'
import { adapterAbi, treasuryAbi } from '../chain/abis'
import {
  connectWallet,
  publicClient,
  verifyExecutionContext,
  waitForJournaledReceipt,
} from '../chain/client'
import { formatAssetAmount, parseAssetAmount, type Asset } from '../domain/amount'
import { decodeDecision, type PolicyDecision, type PolicyFacts } from '../domain/policy'
import { TransactionJournal } from '../state/transactionJournal'

type DeploymentManifest = {
  status: string
  chainId: number
  processor?: Address
  circuitId?: string
  netlistHash?: Hash
  container?: Address
  adapter?: Address
  treasury?: Address
}

declare global {
  interface Window {
    __CIRCUITGUARD_E2E_DEPLOYMENT__?: DeploymentManifest
  }
}

export type AssetSnapshot = {
  balance: string
  instantLimit: string
  dailyLimit: string
  spent: string
}

export type CircuitGuardModel = {
  status: 'loading' | 'ready' | 'unavailable' | 'wrong-network'
  walletStatus: 'disconnected' | 'connecting' | 'connected' | 'wrong-network'
  walletAddress?: Address
  verification: {
    chain: string
    processor: string
    circuitId: string
    netlistHash: string
    container: string
    adapter: string
    treasury: string
  }
  owner: string
  paused: boolean
  assets: Record<Asset, AssetSnapshot>
  facts: PolicyFacts
  inputs: number
  outputs: number
  decision: PolicyDecision
  policyError: string
  proposalState: string
  pending: boolean
  error?: string
}

export type TransferDraft = {
  asset: Asset
  recipient: Address
  amount: string
  memo: string
}

export type CircuitGuardActions = {
  connect: () => Promise<void>
  loadProposal: (proposalId: bigint) => Promise<void>
  requestTransfer: (draft: TransferDraft) => Promise<void>
  approveProposal: (proposalId: bigint) => Promise<void>
  executeApproved: (proposalId: bigint) => Promise<void>
  cancelProposal: (proposalId: bigint) => Promise<void>
}

const emptyAsset: AssetSnapshot = {
  balance: '—',
  instantLimit: '—',
  dailyLimit: '—',
  spent: '—',
}

const emptyFacts: PolicyFacts = {
  systemActive: false,
  recipientTrusted: false,
  recipientBlocked: false,
  amountLow: false,
  withinDailyBudget: false,
  humanApproved: false,
}

const deployment = window.__CIRCUITGUARD_E2E_DEPLOYMENT__ ?? deploymentJson as DeploymentManifest

const policyErrors = ['None', 'NetlistMismatch', 'StepReverted', 'StateMismatch', 'OutputMalformed']
const proposalStates = ['PendingReview', 'Executed', 'Rejected', 'Cancelled', 'Expired']

const decodeFacts = (inputs: number): PolicyFacts => ({
  systemActive: Boolean(inputs & 1),
  recipientTrusted: Boolean(inputs & 2),
  recipientBlocked: Boolean(inputs & 4),
  amountLow: Boolean(inputs & 8),
  withinDailyBudget: Boolean(inputs & 16),
  humanApproved: Boolean(inputs & 32),
})

const clearChainReads = (
  current: CircuitGuardModel,
  error?: string,
): CircuitGuardModel => ({
  ...current,
  status: 'unavailable',
  owner: '—',
  paused: false,
  assets: { OKB: emptyAsset, USDT0: emptyAsset },
  facts: emptyFacts,
  inputs: 0,
  outputs: 0xff,
  decision: 'INVALID',
  policyError: 'Unavailable',
  proposalState: '—',
  error,
})

const initialModel: CircuitGuardModel = {
  status: deployment.status === 'deployed' ? 'loading' : 'unavailable',
  walletStatus: 'disconnected',
  verification: {
    chain: 'X Layer · 196',
    processor: deployment.processor ?? 'Not deployed',
    circuitId: deployment.circuitId ?? '—',
    netlistHash: deployment.netlistHash ?? 'Not deployed',
    container: deployment.container ?? 'Not deployed',
    adapter: deployment.adapter ?? 'Not deployed',
    treasury: deployment.treasury ?? 'Not deployed',
  },
  owner: '—',
  paused: false,
  assets: { OKB: emptyAsset, USDT0: emptyAsset },
  facts: emptyFacts,
  inputs: 0,
  outputs: 0xff,
  decision: 'INVALID',
  policyError: deployment.status === 'deployed' ? 'Loading' : 'Deployment unavailable',
  proposalState: '—',
  pending: false,
}

type ConnectedWallet = Awaited<ReturnType<typeof connectWallet>>

export function useCircuitGuard(): {
  model: CircuitGuardModel
  actions: CircuitGuardActions
} {
  const [model, setModel] = useState(initialModel)
  const [wallet, setWallet] = useState<ConnectedWallet>()

  const refresh = useCallback(async () => {
    if (deployment.status !== 'deployed' || !deployment.treasury || !deployment.adapter) {
      setModel((current) => clearChainReads(current, 'Deployment unavailable'))
      return
    }

    try {
      const treasury = getAddress(deployment.treasury)
      const adapter = getAddress(deployment.adapter)
      const [owner, paused, okbBalance, usdt0Balance, okbBudget, usdt0Budget, health] =
        await Promise.all([
          publicClient.readContract({ address: treasury, abi: treasuryAbi, functionName: 'owner' }),
          publicClient.readContract({ address: treasury, abi: treasuryAbi, functionName: 'paused' }),
          publicClient.readContract({
            address: treasury,
            abi: treasuryAbi,
            functionName: 'assetBalance',
            args: [0],
          }),
          publicClient.readContract({
            address: treasury,
            abi: treasuryAbi,
            functionName: 'assetBalance',
            args: [1],
          }),
          publicClient.readContract({
            address: treasury,
            abi: treasuryAbi,
            functionName: 'currentBudget',
            args: [0],
          }),
          publicClient.readContract({
            address: treasury,
            abi: treasuryAbi,
            functionName: 'currentBudget',
            args: [1],
          }),
          publicClient.readContract({ address: adapter, abi: adapterAbi, functionName: 'health' }),
        ])

      if (!health[0]) throw new Error('Policy Adapter provenance check failed')
      setModel((current) => ({
        ...current,
        status: 'ready',
        owner,
        paused,
        assets: {
          OKB: {
            balance: formatAssetAmount('OKB', okbBalance),
            instantLimit: formatAssetAmount('OKB', okbBudget.instantLimit),
            dailyLimit: formatAssetAmount('OKB', okbBudget.dailyLimit),
            spent: formatAssetAmount('OKB', okbBudget.spent),
          },
          USDT0: {
            balance: formatAssetAmount('USDT0', usdt0Balance),
            instantLimit: formatAssetAmount('USDT0', usdt0Budget.instantLimit),
            dailyLimit: formatAssetAmount('USDT0', usdt0Budget.dailyLimit),
            spent: formatAssetAmount('USDT0', usdt0Budget.spent),
          },
        },
        error: undefined,
      }))
    } catch (error) {
      setModel((current) =>
        clearChainReads(current, error instanceof Error ? error.message : 'RPC read failed'),
      )
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const connect = useCallback(async () => {
    const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum
    if (!provider) {
      setModel((current) => ({ ...current, error: 'No injected wallet found' }))
      return
    }

    setModel((current) => ({ ...current, walletStatus: 'connecting' }))
    try {
      const connected = await connectWallet(provider)
      setWallet(connected)
      setModel((current) => ({
        ...current,
        walletStatus: 'connected',
        walletAddress: connected.account?.address,
        error: undefined,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Wallet connection failed'
      const wrongNetwork = /chain|network/i.test(message)
      setModel((current) => ({
        ...current,
        status: wrongNetwork ? 'wrong-network' : current.status,
        walletStatus: wrongNetwork ? 'wrong-network' : 'disconnected',
        error: message,
      }))
    }
  }, [])

  const send = useCallback(
    async (label: string, write: (walletClient: ConnectedWallet) => Promise<Hash>) => {
      if (!wallet || !deployment.treasury || !deployment.adapter) {
        throw new Error('Connect a wallet after deployment is available')
      }
      const journal = new TransactionJournal(window.localStorage)
      if (journal.pending()) throw new Error('A transaction is still pending')

      setModel((current) => ({ ...current, pending: true, error: undefined }))
      try {
        await verifyExecutionContext(wallet, [
          getAddress(deployment.treasury),
          getAddress(deployment.adapter),
        ])
        const hash = await write(wallet)
        journal.begin({ hash, label, createdAt: Date.now() })
        const status = await waitForJournaledReceipt(publicClient, journal, hash)
        if (status === 'reverted') throw new Error(`${label} reverted`)
        await refresh()
      } catch (error) {
        setModel((current) => ({
          ...current,
          error: error instanceof Error ? error.message : `${label} failed`,
        }))
        throw error
      } finally {
        const pending = new TransactionJournal(window.localStorage).pending() !== undefined
        setModel((current) => ({ ...current, pending }))
      }
    },
    [refresh, wallet],
  )

  const actions = useMemo<CircuitGuardActions>(() => {
    const treasury = deployment.treasury ? getAddress(deployment.treasury) : undefined
    return {
      connect,
      loadProposal: async (proposalId) => {
        if (!treasury) throw new Error('Treasury is not deployed')
        try {
          const [proposal, preview] = await Promise.all([
            publicClient.readContract({
              address: treasury,
              abi: treasuryAbi,
              functionName: 'getProposal',
              args: [proposalId],
            }),
            publicClient.readContract({
              address: treasury,
              abi: treasuryAbi,
              functionName: 'previewProposal',
              args: [proposalId],
            }),
          ])
          const inputs = Number(preview[0])
          const evaluation = preview[1]
          setModel((current) => ({
            ...current,
            facts: decodeFacts(inputs),
            inputs,
            outputs: Number(evaluation.outputs),
            decision: decodeDecision(Number(evaluation.decision)),
            policyError: policyErrors[Number(evaluation.error)] ?? 'Unknown',
            proposalState: proposalStates[Number(proposal.state)] ?? 'Unknown',
            error: undefined,
          }))
        } catch (error) {
          setModel((current) =>
            clearChainReads(
              current,
              error instanceof Error ? error.message : 'Proposal read failed',
            ),
          )
          throw error
        }
      },
      requestTransfer: async (draft) => {
        if (!treasury) throw new Error('Treasury is not deployed')
        const asset = draft.asset === 'OKB' ? 0 : 1
        const amount = parseAssetAmount(draft.asset, draft.amount)
        const memoHash = keccak256(toBytes(draft.memo.trim() || 'CircuitGuard transfer'))
        await send('Request transfer', (client) =>
          client.writeContract({
            address: treasury,
            abi: treasuryAbi,
            functionName: 'requestTransfer',
            args: [asset, draft.recipient, amount, memoHash],
          }),
        )
      },
      approveProposal: async (proposalId) => {
        if (!treasury) throw new Error('Treasury is not deployed')
        await send('Approve proposal', (client) =>
          client.writeContract({
            address: treasury,
            abi: treasuryAbi,
            functionName: 'approveProposal',
            args: [proposalId, 600],
          }),
        )
      },
      executeApproved: async (proposalId) => {
        if (!treasury) throw new Error('Treasury is not deployed')
        await send('Execute approved proposal', (client) =>
          client.writeContract({
            address: treasury,
            abi: treasuryAbi,
            functionName: 'executeApproved',
            args: [proposalId],
          }),
        )
      },
      cancelProposal: async (proposalId) => {
        if (!treasury) throw new Error('Treasury is not deployed')
        await send('Cancel proposal', (client) =>
          client.writeContract({
            address: treasury,
            abi: treasuryAbi,
            functionName: 'cancelProposal',
            args: [proposalId],
          }),
        )
      },
    }
  }, [connect, send])

  return { model, actions }
}
