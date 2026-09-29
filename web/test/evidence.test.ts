import { describe, expect, it } from 'vitest'
import type { Address, Hash } from 'viem'
import type { DeployedManifest } from '../src/config/deployment'
import {
  buildProposalTimeline,
  loadProposalEvidence,
  type ProposalLifecycleLog,
} from '../src/chain/evidence'

const HASH_A = `0x${'a'.repeat(64)}` as Hash
const HASH_B = `0x${'b'.repeat(64)}` as Hash
const BLOCK_A = `0x${'c'.repeat(64)}` as Hash
const TREASURY = '0x4444444444444444444444444444444444444444' as Address

const makeLog = (
  kind: ProposalLifecycleLog['kind'],
  blockNumber: bigint,
  logIndex: number,
  transactionHash: Hash = HASH_A,
): ProposalLifecycleLog => ({
  kind,
  proposalId: 7n,
  blockHash: BLOCK_A,
  blockNumber,
  transactionIndex: transactionHash === HASH_A ? 0 : 1,
  logIndex,
  transactionHash,
})

const lifecycle = [
  makeLog('executed', 110n, 2, HASH_B),
  makeLog('evaluated', 100n, 1),
  makeLog('created', 100n, 0),
  makeLog('approved', 110n, 0, HASH_B),
  makeLog('evaluated', 110n, 1, HASH_B),
  makeLog('executed', 110n, 2, HASH_B),
]

describe('Proposal evidence timeline', () => {
  it('deduplicates and orders lifecycle evidence with confirmation depth', () => {
    const timeline = buildProposalTimeline(lifecycle, 121n, 12, 'Executed')

    expect(timeline.map(({ kind }) => kind)).toEqual([
      'created',
      'evaluated',
      'approved',
      'evaluated',
      'executed',
    ])
    expect(timeline.at(-1)).toMatchObject({ confirmations: 12, final: true })
  })

  it('detects terminal evidence that conflicts with contract state', () => {
    expect(() => buildProposalTimeline(lifecycle, 121n, 12, 'PendingReview')).toThrow(
      'Proposal state conflicts',
    )
  })
})

const manifest = {
  status: 'deployed',
  deploymentBlock: 1,
  safeConfirmations: 12,
  treasury: TREASURY,
} as DeployedManifest

describe('Proposal evidence loader', () => {
  it('rejects invalid proposal IDs', async () => {
    const client = {
      getBlockNumber: async () => 1n,
      getContractEvents: async () => [],
    }
    await expect(loadProposalEvidence(client, manifest, 0n)).rejects.toThrow('positive')
  })

  it('scans inclusive 10,000-block windows for all lifecycle events', async () => {
    const windows: Array<[bigint, bigint]> = []
    const client = {
      getBlockNumber: async () => 20_001n,
      getContractEvents: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        windows.push([fromBlock, toBlock])
        return []
      },
    }

    await loadProposalEvidence(client, manifest, 7n)

    expect(new Set(windows.map(([from, to]) => `${from}-${to}`))).toEqual(
      new Set(['1-10000', '10001-20000', '20001-20001']),
    )
    expect(windows).toHaveLength(18)
  })

  it('rejects a deployment block above the current head', async () => {
    const client = {
      getBlockNumber: async () => 0n,
      getContractEvents: async () => [
        { blockNumber: 1n, logIndex: 0, transactionHash: HASH_B },
      ],
    }

    await expect(loadProposalEvidence(client, manifest, 7n)).rejects.toThrow('deploymentBlock')
  })
})
