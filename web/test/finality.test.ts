import { describe, expect, it } from 'vitest'
import type { Hash } from 'viem'
import {
  deriveFinality,
  readTransactionReceipt,
  waitForJournaledFinality,
} from '../src/chain/finality'
import {
  TransactionJournal,
  type JournalStorage,
  type TransactionEvidence,
} from '../src/state/transactionJournal'

const HASH_A = `0x${'a'.repeat(64)}` as Hash
const HASH_B = `0x${'b'.repeat(64)}` as Hash

const makeEvidence = (
  overrides: Partial<TransactionEvidence> = {},
): TransactionEvidence => ({
  hash: HASH_A,
  label: 'Request transfer',
  status: 'submitted',
  submittedAt: 100,
  confirmations: 0,
  requiredConfirmations: 12,
  reorgDetected: false,
  ...overrides,
})

const successReceiptAt100 = {
  status: 'success',
  blockNumber: 100n,
  blockHash: HASH_A,
} as const

describe('transaction finality', () => {
  it('keeps a transaction submitted while no receipt exists', () => {
    expect(deriveFinality(makeEvidence(), null, 100n, 12)).toMatchObject({
      status: 'submitted',
      confirmations: 0,
    })
  })

  it('tracks mined confirmation depth and finality', () => {
    expect(deriveFinality(makeEvidence(), successReceiptAt100, 105n, 12)).toMatchObject({
      status: 'mined',
      confirmations: 6,
    })
    expect(deriveFinality(makeEvidence(), successReceiptAt100, 111n, 12)).toMatchObject({
      status: 'final',
      confirmations: 12,
    })
  })

  it('marks a disappearing mined receipt as a reorganization', () => {
    const mined = makeEvidence({
      status: 'mined',
      blockNumber: 100n,
      blockHash: HASH_A,
      confirmations: 6,
    })

    expect(deriveFinality(mined, null, 106n, 12)).toMatchObject({
      status: 'submitted',
      confirmations: 0,
      reorgDetected: true,
    })
  })

  it('does not trust a locally terminal transaction after its receipt disappears', () => {
    const locallyFinal = makeEvidence({
      status: 'final',
      blockNumber: 100n,
      blockHash: HASH_A,
      confirmations: 12,
    })

    expect(deriveFinality(locallyFinal, null, 112n, 12)).toMatchObject({
      status: 'submitted',
      confirmations: 0,
      reorgDetected: true,
    })
  })

  it('records a reverted receipt as terminal evidence', () => {
    expect(
      deriveFinality(
        makeEvidence(),
        { status: 'reverted', blockNumber: 100n, blockHash: HASH_B },
        100n,
        12,
      ),
    ).toMatchObject({ status: 'reverted', confirmations: 1 })
  })

  it('propagates transport errors instead of classifying them as a reorganization', async () => {
    const transportError = new Error('RPC rate limited')
    await expect(readTransactionReceipt({
      getTransactionReceipt: async () => Promise.reject(transportError),
      getBlockNumber: async () => 100n,
    }, HASH_A)).rejects.toBe(transportError)
  })

  it('polls until terminal finality and updates the journal', async () => {
    const values = new Map<string, string>()
    const storage: JournalStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    }
    const journal = new TransactionJournal(storage)
    journal.begin({
      hash: HASH_A,
      label: 'Request transfer',
      submittedAt: 100,
      requiredConfirmations: 12,
    })

    const result = await waitForJournaledFinality(
      {
        getTransactionReceipt: async () => successReceiptAt100,
        getBlockNumber: async () => 111n,
      },
      journal,
      HASH_A,
      12,
      1_000,
    )

    expect(result.status).toBe('final')
    expect(journal.unresolved()).toBeUndefined()
  })
})
