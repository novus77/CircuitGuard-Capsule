import type { Address, Hash } from 'viem'
import type { DeployedManifest } from '../config/deployment'
import { treasuryAbi } from './abis'

export type ProposalEvidenceKind =
  | 'created'
  | 'evaluated'
  | 'approved'
  | 'cancelled'
  | 'expired'
  | 'executed'

export type ProposalLifecycleLog = {
  kind: ProposalEvidenceKind
  proposalId: bigint
  transactionHash: Hash
  blockHash: Hash
  blockNumber: bigint
  transactionIndex: number
  logIndex: number
  decision?: number
}

export type ProposalEvidence = ProposalLifecycleLog & {
  confirmations: number
  requiredConfirmations: number
  final: boolean
}

type RawEvidenceLog = {
  transactionHash?: Hash | null
  blockHash?: Hash | null
  blockNumber?: bigint | null
  transactionIndex?: number | null
  logIndex?: number | null
  args?: { proposalId?: bigint; decision?: number }
}

type EvidenceRequest = {
  address: Address
  abi: typeof treasuryAbi
  eventName: string
  args: { proposalId: bigint }
  fromBlock: bigint
  toBlock: bigint
}

export type ProposalEvidenceReader = {
  getBlockNumber(): Promise<bigint>
  getContractEvents(request: EvidenceRequest): Promise<readonly RawEvidenceLog[]>
}

const EVENT_KINDS = [
  ['ProposalCreated', 'created'],
  ['PolicyEvaluated', 'evaluated'],
  ['ProposalApproved', 'approved'],
  ['ProposalCancelled', 'cancelled'],
  ['ProposalExpired', 'expired'],
  ['TransferExecuted', 'executed'],
] as const satisfies readonly (readonly [string, ProposalEvidenceKind])[]

const proposalTerminalState = (logs: readonly ProposalLifecycleLog[]): string | undefined => {
  const terminal = [...logs]
    .reverse()
    .find(({ kind }) => kind === 'executed' || kind === 'cancelled' || kind === 'expired')
  if (terminal?.kind === 'executed') return 'Executed'
  if (terminal?.kind === 'cancelled') return 'Cancelled'
  if (terminal?.kind === 'expired') return 'Expired'
  if ([...logs].reverse().some(({ kind, decision }) => kind === 'evaluated' && decision === 0)) {
    return 'Rejected'
  }
  return undefined
}

export const buildProposalTimeline = (
  logs: readonly ProposalLifecycleLog[],
  latestBlock: bigint,
  requiredConfirmations: number,
  proposalState: string,
): ProposalEvidence[] => {
  if (!Number.isInteger(requiredConfirmations) || requiredConfirmations < 1) {
    throw new Error('requiredConfirmations must be a positive integer')
  }

  const deduplicated = new Map<string, ProposalLifecycleLog>()
  for (const log of logs) {
    deduplicated.set(`${log.transactionHash.toLowerCase()}:${log.logIndex}`, log)
  }
  const ordered = [...deduplicated.values()].sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber < right.blockNumber ? -1 : 1
    }
    if (left.transactionIndex !== right.transactionIndex) {
      return left.transactionIndex - right.transactionIndex
    }
    if (left.logIndex !== right.logIndex) return left.logIndex - right.logIndex
    return left.transactionHash.localeCompare(right.transactionHash)
  })

  const terminalState = proposalTerminalState(ordered)
  const contractIsTerminal = ['Executed', 'Rejected', 'Cancelled', 'Expired'].includes(proposalState)
  if ((terminalState && terminalState !== proposalState) || (contractIsTerminal && !terminalState)) {
    throw new Error(
      `Proposal state conflicts with event evidence: contract=${proposalState}, events=${terminalState ?? 'none'}`,
    )
  }

  return ordered.map((log) => {
    const confirmations =
      latestBlock >= log.blockNumber ? Number(latestBlock - log.blockNumber + 1n) : 0
    return {
      ...log,
      confirmations,
      requiredConfirmations,
      final: confirmations >= requiredConfirmations,
    }
  })
}

const normalizeLog = (
  raw: RawEvidenceLog,
  kind: ProposalEvidenceKind,
  proposalId: bigint,
): ProposalLifecycleLog => {
  if (
    !raw.transactionHash
    || !raw.blockHash
    || raw.blockNumber === null
    || raw.blockNumber === undefined
  ) {
    throw new Error(`${kind} evidence is missing mined transaction identity`)
  }
  if (raw.transactionIndex === null || raw.transactionIndex === undefined) {
    throw new Error(`${kind} evidence is missing transactionIndex`)
  }
  if (raw.logIndex === null || raw.logIndex === undefined) {
    throw new Error(`${kind} evidence is missing logIndex`)
  }
  if (raw.args?.proposalId !== undefined && raw.args.proposalId !== proposalId) {
    throw new Error(`${kind} evidence contains the wrong proposalId`)
  }

  return {
    kind,
    proposalId,
    transactionHash: raw.transactionHash,
    blockHash: raw.blockHash,
    blockNumber: raw.blockNumber,
    transactionIndex: raw.transactionIndex,
    logIndex: raw.logIndex,
    ...(raw.args?.decision === undefined ? {} : { decision: Number(raw.args.decision) }),
  }
}

export const loadProposalEvidence = async (
  client: ProposalEvidenceReader,
  manifest: DeployedManifest,
  proposalId: bigint,
  proposalState?: string,
): Promise<ProposalEvidence[]> => {
  if (proposalId <= 0n) throw new Error('proposalId must be positive')

  const latestBlock = await client.getBlockNumber()
  const deploymentBlock = BigInt(manifest.deploymentBlock)
  if (deploymentBlock > latestBlock) {
    throw new Error('deploymentBlock is above the current chain head')
  }

  const logs: ProposalLifecycleLog[] = []
  for (let fromBlock = deploymentBlock; fromBlock <= latestBlock; fromBlock += 10_000n) {
    const toBlock = fromBlock + 9_999n < latestBlock ? fromBlock + 9_999n : latestBlock
    const windowResults = await Promise.all(
      EVENT_KINDS.map(async ([eventName, kind]) => {
        const events = await client.getContractEvents({
          address: manifest.treasury,
          abi: treasuryAbi,
          eventName,
          args: { proposalId },
          fromBlock,
          toBlock,
        })
        return events.map((event) => normalizeLog(event, kind, proposalId))
      }),
    )
    logs.push(...windowResults.flat())
  }

  const inferredState = proposalState ?? proposalTerminalState(logs) ?? 'PendingReview'
  return buildProposalTimeline(logs, latestBlock, manifest.safeConfirmations, inferredState)
}
