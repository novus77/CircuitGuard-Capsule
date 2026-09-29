import { describe, expect, it } from 'vitest'
import {
  TransactionJournal,
  type JournalStorage,
} from '../src/state/transactionJournal'

const HASH_A = `0x${'a'.repeat(64)}` as const
const HASH_B = `0x${'b'.repeat(64)}` as const

class MemoryStorage implements JournalStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

describe('transaction journal', () => {
  it('inserts a submitted transaction and persists it', () => {
    const storage = new MemoryStorage()
    const journal = new TransactionJournal(storage)

    journal.begin({
      hash: HASH_A,
      label: 'Request transfer',
      submittedAt: 100,
      requiredConfirmations: 12,
    })

    expect(journal.entries()).toEqual([
      {
        hash: HASH_A,
        label: 'Request transfer',
        status: 'submitted',
        submittedAt: 100,
        confirmations: 0,
        requiredConfirmations: 12,
        reorgDetected: false,
      },
    ])
    expect(new TransactionJournal(storage).entries()).toEqual(journal.entries())
  })

  it('updates mined evidence and terminal states', () => {
    const storage = new MemoryStorage()
    const journal = new TransactionJournal(storage)
    journal.begin({ hash: HASH_A, label: 'First', submittedAt: 100, requiredConfirmations: 12 })
    journal.update({
      ...journal.entries()[0],
      status: 'mined',
      blockNumber: 100n,
      blockHash: HASH_B,
      confirmations: 6,
    })

    expect(journal.unresolved()?.status).toBe('mined')
    expect(new TransactionJournal(storage).entries()).toEqual(journal.entries())
  })

  it('rejects duplicate hashes and concurrent unresolved transactions', () => {
    const journal = new TransactionJournal(new MemoryStorage())
    journal.begin({ hash: HASH_A, label: 'First', submittedAt: 100, requiredConfirmations: 12 })

    expect(() =>
      journal.begin({
        hash: HASH_A,
        label: 'Duplicate',
        submittedAt: 200,
        requiredConfirmations: 12,
      }),
    ).toThrow('already exists')
    expect(() =>
      journal.begin({
        hash: HASH_B,
        label: 'Second',
        submittedAt: 200,
        requiredConfirmations: 12,
      }),
    ).toThrow('unresolved transaction')
  })

  it('migrates valid V1 entries into V2 once', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      'circuitguard.transactions.v1',
      JSON.stringify([
        { hash: HASH_A, label: 'Pending', status: 'pending', createdAt: 100 },
        { hash: HASH_B, label: 'Confirmed', status: 'confirmed', createdAt: 200 },
      ]),
    )

    const journal = new TransactionJournal(storage)

    expect(journal.entries().map(({ status }) => status)).toEqual(['submitted', 'final'])
    expect(new TransactionJournal(storage).entries()).toEqual(journal.entries())
  })

  it('ignores malformed persisted data without inventing entries', () => {
    const storage = new MemoryStorage()
    storage.setItem('circuitguard.transactions.v1', '{broken')

    expect(new TransactionJournal(storage).entries()).toEqual([])
  })
})
