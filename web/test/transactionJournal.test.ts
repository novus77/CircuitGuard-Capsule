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
  it('inserts a pending transaction and persists it', () => {
    const storage = new MemoryStorage()
    const journal = new TransactionJournal(storage)

    journal.begin({ hash: HASH_A, label: 'Request transfer', createdAt: 100 })

    expect(journal.entries()).toEqual([
      { hash: HASH_A, label: 'Request transfer', status: 'pending', createdAt: 100 },
    ])
    expect(new TransactionJournal(storage).entries()).toEqual(journal.entries())
  })

  it('marks receipts confirmed or reverted', () => {
    const journal = new TransactionJournal(new MemoryStorage())
    journal.begin({ hash: HASH_A, label: 'First', createdAt: 100 })
    journal.resolve(HASH_A, 'confirmed')
    journal.begin({ hash: HASH_B, label: 'Second', createdAt: 200 })
    journal.resolve(HASH_B, 'reverted')

    expect(journal.entries().map(({ status }) => status)).toEqual(['confirmed', 'reverted'])
  })

  it('rejects duplicate hashes and concurrent pending transactions', () => {
    const journal = new TransactionJournal(new MemoryStorage())
    journal.begin({ hash: HASH_A, label: 'First', createdAt: 100 })

    expect(() =>
      journal.begin({ hash: HASH_A, label: 'Duplicate', createdAt: 200 }),
    ).toThrow('already exists')
    expect(() => journal.begin({ hash: HASH_B, label: 'Second', createdAt: 200 })).toThrow(
      'pending transaction',
    )
  })

  it('keeps a timed-out transaction pending until a receipt is observed', () => {
    const journal = new TransactionJournal(new MemoryStorage())
    journal.begin({ hash: HASH_A, label: 'Request transfer', createdAt: 100 })

    expect(journal.pending()?.hash).toBe(HASH_A)
    expect(journal.entries()[0].status).toBe('pending')
  })

  it('ignores malformed persisted data without inventing entries', () => {
    const storage = new MemoryStorage()
    storage.setItem('circuitguard.transactions.v1', '{broken')

    expect(new TransactionJournal(storage).entries()).toEqual([])
  })
})
