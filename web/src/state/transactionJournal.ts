import type { Hash } from 'viem'

export type TransactionStatus = 'pending' | 'confirmed' | 'reverted'

export type TransactionEntry = {
  hash: Hash
  label: string
  status: TransactionStatus
  createdAt: number
}

export type JournalStorage = Pick<Storage, 'getItem' | 'setItem'>

const STORAGE_KEY = 'circuitguard.transactions.v1'
const HASH_PATTERN = /^0x[0-9a-f]{64}$/i
const STATUSES = new Set<TransactionStatus>(['pending', 'confirmed', 'reverted'])

export class TransactionJournal {
  private items: TransactionEntry[]
  private readonly storage: JournalStorage

  constructor(storage: JournalStorage) {
    this.storage = storage
    this.items = this.load()
  }

  entries(): readonly TransactionEntry[] {
    return this.items.map((entry) => ({ ...entry }))
  }

  pending(): TransactionEntry | undefined {
    const entry = this.items.find(({ status }) => status === 'pending')
    return entry ? { ...entry } : undefined
  }

  begin(entry: Omit<TransactionEntry, 'status'>): void {
    if (this.items.some(({ hash }) => hash.toLowerCase() === entry.hash.toLowerCase())) {
      throw new Error(`Transaction ${entry.hash} already exists`)
    }
    if (this.pending()) throw new Error('A pending transaction must resolve before another starts')
    if (!HASH_PATTERN.test(entry.hash)) throw new Error('Invalid transaction hash')
    if (!entry.label.trim()) throw new Error('Transaction label is required')

    const pendingEntry: TransactionEntry = { ...entry, status: 'pending' }
    this.items = [...this.items, pendingEntry].slice(-30)
    this.persist()
  }

  resolve(hash: Hash, status: Exclude<TransactionStatus, 'pending'>): void {
    const index = this.items.findIndex((entry) => entry.hash.toLowerCase() === hash.toLowerCase())
    if (index < 0) throw new Error(`Transaction ${hash} does not exist`)

    this.items = this.items.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, status } : entry,
    )
    this.persist()
  }

  private load(): TransactionEntry[] {
    try {
      const parsed: unknown = JSON.parse(this.storage.getItem(STORAGE_KEY) ?? '[]')
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isTransactionEntry).slice(-30)
    } catch {
      return []
    }
  }

  private persist(): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.items))
  }
}

function isTransactionEntry(value: unknown): value is TransactionEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<TransactionEntry>
  return (
    typeof entry.hash === 'string' &&
    HASH_PATTERN.test(entry.hash) &&
    typeof entry.label === 'string' &&
    entry.label.length > 0 &&
    typeof entry.createdAt === 'number' &&
    Number.isFinite(entry.createdAt) &&
    typeof entry.status === 'string' &&
    STATUSES.has(entry.status as TransactionStatus)
  )
}
