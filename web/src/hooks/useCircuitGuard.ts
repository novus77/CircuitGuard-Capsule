import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import {
  getAddress,
  keccak256,
  toBytes,
  type Address,
  type EIP1193Provider,
  type Hash,
} from 'viem'
import { adapterAbi, treasuryAbi } from '../chain/abis'
import {
  connectWallet,
  primaryClient,
  secondaryClient,
  verifyExecutionContext,
  waitForJournaledFinality,
} from '../chain/client'
import {
  loadProposalEvidence,
  type ProposalEvidence,
  type ProposalEvidenceReader,
} from '../chain/evidence'
import {
  verifyIdentityQuorum,
  type IdentityReader,
} from '../chain/quorum'
import {
  deploymentManifest as deployment,
  requireDeployedManifest,
  type DeployedManifest,
} from '../config/deployment'
import { formatAssetAmount, parseAssetAmount, type Asset } from '../domain/amount'
import { decodeDecision, type PolicyDecision, type PolicyFacts } from '../domain/policy'
import {
  canSign,
  classifyOverall,
  type TrustEnvelope,
  type VerificationLayer,
} from '../domain/trustEnvelope'
import { siteAttestationSource } from '../site/siteAttestation'
import {
  TransactionJournal,
  type TransactionEvidence,
} from '../state/transactionJournal'

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
  trustEnvelope: TrustEnvelope
  signingDisabledReason?: string
  transactionEvidence?: TransactionEvidence
  proposalEvidence: ProposalEvidence[]
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

type TrustLayers = Pick<TrustEnvelope, 'site' | 'policy' | 'execution'>
type ConnectedWallet = Awaited<ReturnType<typeof connectWallet>>

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

const loadingLayer: VerificationLayer = {
  status: 'loading',
  summary: 'Verification in progress',
}

const unavailableLayer: VerificationLayer = {
  status: 'unverified',
  summary: 'Deployment identity unavailable',
}

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

const buildTrustEnvelope = (
  coordinate: string,
  layers: TrustLayers,
  runtime: { walletReady: boolean; modelReady: boolean; unresolved: boolean },
): TrustEnvelope => {
  const overall = classifyOverall(layers)
  return {
    coordinate,
    ...layers,
    overall,
    signingEnabled: canSign({ overall, ...runtime }),
  }
}

const disabledReason = (
  envelope: TrustEnvelope,
  runtime: { walletReady: boolean; modelReady: boolean; unresolved: boolean },
): string | undefined => {
  if (envelope.overall !== 'verified') {
    const blockingLayer = [envelope.site, envelope.policy, envelope.execution].find(
      ({ status }) => status === envelope.overall,
    )
    return blockingLayer?.detail ?? blockingLayer?.summary ?? 'Endpoint verification is incomplete.'
  }
  if (!runtime.walletReady) return 'Connect an X Layer wallet to sign.'
  if (!runtime.modelReady) return 'Wait for the verified read model to finish loading.'
  if (runtime.unresolved) return 'Resolve the current transaction before signing another.'
  return undefined
}

const specializeIdentityLayer = (
  layer: VerificationLayer,
  subject: 'Policy' | 'Execution',
): VerificationLayer => ({
  ...layer,
  summary:
    layer.status === 'verified'
      ? `${subject} identity verified`
      : `${subject} identity ${layer.status}`,
})

const verifyLayers = async (manifest: DeployedManifest): Promise<TrustLayers> => {
  const [site, identity] = await Promise.all([
    siteAttestationSource.read(manifest),
    verifyIdentityQuorum(
      primaryClient as unknown as IdentityReader,
      secondaryClient as unknown as IdentityReader,
      manifest,
    ),
  ])

  return {
    site,
    policy: specializeIdentityLayer(identity, 'Policy'),
    execution: specializeIdentityLayer(identity, 'Execution'),
  }
}

const emptyEnvelope = buildTrustEnvelope(
  deployment.endpointCoordinate ?? '196:Not deployed',
  deployment.status === 'deployed'
    ? { site: loadingLayer, policy: loadingLayer, execution: loadingLayer }
    : { site: unavailableLayer, policy: unavailableLayer, execution: unavailableLayer },
  { walletReady: false, modelReady: false, unresolved: false },
)

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
  trustEnvelope: emptyEnvelope,
  signingDisabledReason: disabledReason(emptyEnvelope, {
    walletReady: false,
    modelReady: false,
    unresolved: false,
  }),
  transactionEvidence: undefined,
  proposalEvidence: [],
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

const clearChainReads = (
  current: CircuitGuardModel,
  envelope: TrustEnvelope,
  error?: string,
): CircuitGuardModel => {
  const runtime = {
    walletReady: current.walletStatus === 'connected',
    modelReady: false,
    unresolved: current.pending,
  }
  return {
    ...current,
    status: 'unavailable',
    trustEnvelope: { ...envelope, signingEnabled: false },
    signingDisabledReason: disabledReason(envelope, runtime),
    owner: '—',
    paused: false,
    assets: { OKB: emptyAsset, USDT0: emptyAsset },
    facts: emptyFacts,
    inputs: 0,
    outputs: 0xff,
    decision: 'INVALID',
    policyError: 'Unavailable',
    proposalState: '—',
    proposalEvidence: [],
    error,
  }
}

export function useCircuitGuard(): {
  model: CircuitGuardModel
  actions: CircuitGuardActions
} {
  const [model, setModel] = useState(initialModel)
  const [wallet, setWallet] = useState<ConnectedWallet>()

  const refresh = useCallback(async () => {
    let manifest: DeployedManifest
    try {
      manifest = requireDeployedManifest(deployment)
    } catch (error) {
      setModel((current) =>
        clearChainReads(
          current,
          emptyEnvelope,
          error instanceof Error ? error.message : 'Deployment unavailable',
        ),
      )
      return
    }

    try {
      const layers = await verifyLayers(manifest)
      const overall = classifyOverall(layers)
      const unresolved = new TransactionJournal(window.localStorage).unresolved()
      if (overall === 'blocked') {
        const envelope = buildTrustEnvelope(manifest.endpointCoordinate, layers, {
          walletReady: false,
          modelReady: false,
          unresolved: Boolean(unresolved),
        })
        setModel((current) => clearChainReads(current, envelope, disabledReason(envelope, {
          walletReady: current.walletStatus === 'connected',
          modelReady: false,
          unresolved: Boolean(unresolved),
        })))
        return
      }

      const treasury = getAddress(manifest.treasury)
      const adapter = getAddress(manifest.adapter)
      const [owner, paused, okbBalance, usdt0Balance, okbBudget, usdt0Budget, health] =
        await Promise.all([
          primaryClient.readContract({ address: treasury, abi: treasuryAbi, functionName: 'owner' }),
          primaryClient.readContract({ address: treasury, abi: treasuryAbi, functionName: 'paused' }),
          primaryClient.readContract({
            address: treasury,
            abi: treasuryAbi,
            functionName: 'assetBalance',
            args: [0],
          }),
          primaryClient.readContract({
            address: treasury,
            abi: treasuryAbi,
            functionName: 'assetBalance',
            args: [1],
          }),
          primaryClient.readContract({
            address: treasury,
            abi: treasuryAbi,
            functionName: 'currentBudget',
            args: [0],
          }),
          primaryClient.readContract({
            address: treasury,
            abi: treasuryAbi,
            functionName: 'currentBudget',
            args: [1],
          }),
          primaryClient.readContract({ address: adapter, abi: adapterAbi, functionName: 'health' }),
        ])

      if (!health[0]) throw new Error('Policy Adapter provenance check failed')
      setModel((current) => {
        const runtime = {
          walletReady: current.walletStatus === 'connected',
          modelReady: true,
          unresolved: Boolean(unresolved),
        }
        const envelope = buildTrustEnvelope(manifest.endpointCoordinate, layers, runtime)
        return {
          ...current,
          status: 'ready',
          trustEnvelope: envelope,
          signingDisabledReason: disabledReason(envelope, runtime),
          transactionEvidence: unresolved ?? current.transactionEvidence,
          pending: Boolean(unresolved),
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
        }
      })
    } catch (error) {
      setModel((current) =>
        clearChainReads(
          current,
          current.trustEnvelope,
          error instanceof Error ? error.message : 'RPC read failed',
        ),
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
      setModel((current) => {
        const runtime = {
          walletReady: true,
          modelReady: current.status === 'ready',
          unresolved: current.pending,
        }
        const envelope = buildTrustEnvelope(current.trustEnvelope.coordinate, current.trustEnvelope, runtime)
        return {
          ...current,
          walletStatus: 'connected',
          walletAddress: connected.account?.address,
          trustEnvelope: envelope,
          signingDisabledReason: disabledReason(envelope, runtime),
          error: undefined,
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Wallet connection failed'
      const wrongNetwork = /chain|network/i.test(message)
      setModel((current) => ({
        ...current,
        status: wrongNetwork ? 'wrong-network' : current.status,
        walletStatus: wrongNetwork ? 'wrong-network' : 'disconnected',
        trustEnvelope: { ...current.trustEnvelope, signingEnabled: false },
        signingDisabledReason: message,
        error: message,
      }))
    }
  }, [])

  const preflight = useCallback(async (connected: ConnectedWallet, manifest: DeployedManifest) => {
    const layers = await verifyLayers(manifest)
    const overall = classifyOverall(layers)
    if (overall !== 'verified') {
      const envelope = buildTrustEnvelope(manifest.endpointCoordinate, layers, {
        walletReady: true,
        modelReady: model.status === 'ready',
        unresolved: model.pending,
      })
      throw new Error(disabledReason(envelope, {
        walletReady: true,
        modelReady: model.status === 'ready',
        unresolved: model.pending,
      }) ?? 'Endpoint verification failed')
    }

    await verifyExecutionContext(connected, [
      { address: manifest.processor, codeHash: manifest.processorCodeHash },
      { address: manifest.container, codeHash: manifest.containerCodeHash },
      { address: manifest.adapter, codeHash: manifest.adapterCodeHash },
      { address: manifest.treasury, codeHash: manifest.treasuryCodeHash },
    ])
  }, [model.pending, model.status])

  const send = useCallback(
    async (label: string, write: (walletClient: ConnectedWallet) => Promise<Hash>) => {
      const manifest = requireDeployedManifest(deployment)
      if (!wallet) throw new Error('Connect a wallet after deployment is available')
      if (!model.trustEnvelope.signingEnabled) {
        throw new Error(model.signingDisabledReason ?? 'Endpoint verification does not allow signing')
      }

      const journal = new TransactionJournal(window.localStorage)
      if (journal.unresolved()) throw new Error('A transaction is still unresolved')

      setModel((current) => {
        const runtime = {
          walletReady: current.walletStatus === 'connected',
          modelReady: current.status === 'ready',
          unresolved: true,
        }
        const envelope = buildTrustEnvelope(
          current.trustEnvelope.coordinate,
          current.trustEnvelope,
          runtime,
        )
        return {
          ...current,
          pending: true,
          trustEnvelope: envelope,
          signingDisabledReason: disabledReason(envelope, runtime),
          error: undefined,
        }
      })
      try {
        await preflight(wallet, manifest)
        const hash = await write(wallet)
        journal.begin({
          hash,
          label,
          submittedAt: Date.now(),
          requiredConfirmations: manifest.safeConfirmations,
        })
        setModel((current) => ({
          ...current,
          transactionEvidence: journal.unresolved(),
        }))

        const evidence = await waitForJournaledFinality(
          primaryClient,
          journal,
          hash,
          manifest.safeConfirmations,
          120_000,
          {
            onUpdate: (next) => {
              setModel((current) => {
                if (!next.reorgDetected) return { ...current, transactionEvidence: next }
                const execution: VerificationLayer = {
                  status: 'blocked',
                  summary: 'Transaction reorganization detected',
                  detail: 'Manual review is required before another transaction can be signed.',
                }
                const layers = {
                  site: current.trustEnvelope.site,
                  policy: current.trustEnvelope.policy,
                  execution,
                }
                const envelope = buildTrustEnvelope(current.trustEnvelope.coordinate, layers, {
                  walletReady: current.walletStatus === 'connected',
                  modelReady: current.status === 'ready',
                  unresolved: true,
                })
                return {
                  ...current,
                  trustEnvelope: envelope,
                  signingDisabledReason: disabledReason(envelope, {
                    walletReady: current.walletStatus === 'connected',
                    modelReady: current.status === 'ready',
                    unresolved: true,
                  }),
                  transactionEvidence: next,
                }
              })
              if (next.status === 'mined' && !next.reorgDetected) void refresh()
            },
          },
        )
        if (evidence.status === 'reverted') throw new Error(`${label} reverted`)
        await refresh()
      } catch (error) {
        setModel((current) => ({
          ...current,
          error: error instanceof Error ? error.message : `${label} failed`,
        }))
        throw error
      } finally {
        const unresolved = new TransactionJournal(window.localStorage).unresolved()
        setModel((current) => {
          const runtime = {
            walletReady: current.walletStatus === 'connected',
            modelReady: current.status === 'ready',
            unresolved: Boolean(unresolved),
          }
          const envelope = buildTrustEnvelope(
            current.trustEnvelope.coordinate,
            current.trustEnvelope,
            runtime,
          )
          return {
            ...current,
            pending: Boolean(unresolved),
            trustEnvelope: envelope,
            signingDisabledReason: disabledReason(envelope, runtime),
          }
        })
      }
    },
    [model.signingDisabledReason, model.trustEnvelope.signingEnabled, preflight, refresh, wallet],
  )

  const actions = useMemo<CircuitGuardActions>(() => {
    const manifest = deployment.status === 'deployed' ? deployment : undefined
    const treasury = manifest ? getAddress(manifest.treasury) : undefined
    return {
      connect,
      loadProposal: async (proposalId) => {
        if (!treasury || !manifest) throw new Error('Treasury is not deployed')
        try {
          const [proposal, preview] = await Promise.all([
            primaryClient.readContract({
              address: treasury,
              abi: treasuryAbi,
              functionName: 'getProposal',
              args: [proposalId],
            }),
            primaryClient.readContract({
              address: treasury,
              abi: treasuryAbi,
              functionName: 'previewProposal',
              args: [proposalId],
            }),
          ])
          const state = proposalStates[Number(proposal.state)] ?? 'Unknown'
          const proposalEvidence = await loadProposalEvidence(
            primaryClient as unknown as ProposalEvidenceReader,
            manifest,
            proposalId,
            state,
          )
          const inputs = Number(preview[0])
          const evaluation = preview[1]
          setModel((current) => ({
            ...current,
            facts: decodeFacts(inputs),
            inputs,
            outputs: Number(evaluation.outputs),
            decision: decodeDecision(Number(evaluation.decision)),
            policyError: policyErrors[Number(evaluation.error)] ?? 'Unknown',
            proposalState: state,
            proposalEvidence,
            error: undefined,
          }))
        } catch (error) {
          setModel((current) => {
            const execution: VerificationLayer = {
              status: 'blocked',
              summary: 'Proposal evidence conflict',
              detail: error instanceof Error ? error.message : 'Proposal read failed',
            }
            const envelope = buildTrustEnvelope(
              current.trustEnvelope.coordinate,
              {
                site: current.trustEnvelope.site,
                policy: current.trustEnvelope.policy,
                execution,
              },
              { walletReady: false, modelReady: false, unresolved: current.pending },
            )
            return clearChainReads(current, envelope, execution.detail)
          })
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
