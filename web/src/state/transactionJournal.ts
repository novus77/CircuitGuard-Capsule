import type { Hash } from 'viem'

export type TransactionEvidenceStatus = 'submitted' | 'mined' | 'final' | 'reverted'

export type TransactionEvidence = {
  hash: Hash
  label: string
  status: TransactionEvidenceStatus
  submittedAt: number
  blockNumber?: bigint
  blockHash?: Hash
  confirmations: number
  requiredConfirmations: number
  reorgDetected: boolean
}

export type JournalStorage = Pick<Storage, 'getItem' | 'setItem'>

const V1_STORAGE_KEY = 'circuitguard.transactions.v1'
const V2_STORAGE_KEY = 'circuitguard.transactions.v2'
const HASH_PATTERN = /^0x[0-9a-f]{64}$/i
const V2_STATUSES = new Set<TransactionEvidenceStatus>([
  'submitted',
  'mined',
  'final',
  'reverted',
])

type PersistedEvidence = Omit<TransactionEvidence, 'blockNumber'> & {
  blockNumber?: string
}

type V1Entry = {
  hash: Hash
  label: string
  status: 'pending' | 'confirmed' | 'reverted'
  createdAt: number
}

export class TransactionJournal {
  private items: TransactionEvidence[]
  private readonly storage: JournalStorage

  constructor(storage: JournalStorage) {
    this.storage = storage
    const loaded = this.loadV2()
    if (loaded) {
      this.items = loaded
      return
    }

    this.items = this.loadV1().map(migrateV1Entry).slice(-30)
    this.persist()
  }

  entries(): readonly TransactionEvidence[] {
    return this.items.map((entry) => ({ ...entry }))
  }

  unresolved(): TransactionEvidence | undefined {
    const entry = this.items.find(({ status }) => status === 'submitted' || status === 'mined')
    return entry ? { ...entry } : undefined
  }

  pending(): TransactionEvidence | undefined {
    return this.unresolved()
  }

  begin(
    entry: Pick<
      TransactionEvidence,
      'hash' | 'label' | 'submittedAt' | 'requiredConfirmations'
    >,
  ): void {
    if (this.items.some(({ hash }) => hash.toLowerCase() === entry.hash.toLowerCase())) {
      throw new Error(`Transaction ${entry.hash} already exists`)
    }
    if (this.unresolved()) {
      throw new Error('An unresolved transaction must resolve before another starts')
    }
    if (!HASH_PATTERN.test(entry.hash)) throw new Error('Invalid transaction hash')
    if (!entry.label.trim()) throw new Error('Transaction label is required')
    if (
      !Number.isInteger(entry.requiredConfirmations) ||
      entry.requiredConfirmations < 1 ||
      entry.requiredConfirmations > 256
    ) {
      throw new Error('requiredConfirmations must be an integer from 1 through 256')
    }

    const submitted: TransactionEvidence = {
      ...entry,
      status: 'submitted',
      confirmations: 0,
      reorgDetected: false,
    }
    this.items = [...this.items, submitted].slice(-30)
    this.persist()
  }

  update(evidence: TransactionEvidence): void {
    if (!isTransactionEvidence(evidence)) {
      throw new Error('Invalid transaction evidence')
    }
    const index = this.items.findIndex(
      ({ hash }) => hash.toLowerCase() === evidence.hash.toLowerCase(),
    )
    if (index < 0) throw new Error(`Transaction ${evidence.hash} does not exist`)

    this.items = this.items
      .map((entry, entryIndex) => (entryIndex === index ? { ...evidence } : entry))
      .slice(-30)
    this.persist()
  }

  private loadV2(): TransactionEvidence[] | undefined {
    const encoded = this.storage.getItem(V2_STORAGE_KEY)
    if (encoded === null) return undefined

    try {
      const parsed: unknown = JSON.parse(encoded)
      if (!Array.isArray(parsed)) return []
      return parsed.map(decodePersistedEvidence).filter(isTransactionEvidence).slice(-30)
    } catch {
      return []
    }
  }

  private loadV1(): V1Entry[] {
    try {
      const parsed: unknown = JSON.parse(this.storage.getItem(V1_STORAGE_KEY) ?? '[]')
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isV1Entry)
    } catch {
      return []
    }
  }

  private persist(): void {
    const encoded: PersistedEvidence[] = this.items.map(({ blockNumber, ...entry }) => ({
      ...entry,
      ...(blockNumber === undefined ? {} : { blockNumber: blockNumber.toString() }),
    }))
    this.storage.setItem(V2_STORAGE_KEY, JSON.stringify(encoded))
  }
}

const decodePersistedEvidence = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return value
  const entry = value as Partial<PersistedEvidence>
  if (entry.blockNumber === undefined) return entry
  if (typeof entry.blockNumber !== 'string' || !/^\d+$/.test(entry.blockNumber)) return undefined
  return { ...entry, blockNumber: BigInt(entry.blockNumber) }
}

const isTransactionEvidence = (value: unknown): value is TransactionEvidence => {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<TransactionEvidence>
  return (
    typeof entry.hash === 'string' &&
    HASH_PATTERN.test(entry.hash) &&
    typeof entry.label === 'string' &&
    entry.label.trim().length > 0 &&
    typeof entry.status === 'string' &&
    V2_STATUSES.has(entry.status as TransactionEvidenceStatus) &&
    typeof entry.submittedAt === 'number' &&
    Number.isFinite(entry.submittedAt) &&
    typeof entry.confirmations === 'number' &&
    Number.isInteger(entry.confirmations) &&
    entry.confirmations >= 0 &&
    typeof entry.requiredConfirmations === 'number' &&
    Number.isInteger(entry.requiredConfirmations) &&
    entry.requiredConfirmations >= 1 &&
    entry.requiredConfirmations <= 256 &&
    typeof entry.reorgDetected === 'boolean' &&
    (entry.blockNumber === undefined || typeof entry.blockNumber === 'bigint') &&
    (entry.blockHash === undefined ||
      (typeof entry.blockHash === 'string' && HASH_PATTERN.test(entry.blockHash)))
  )
}

const isV1Entry = (value: unknown): value is V1Entry => {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<V1Entry>
  return (
    typeof entry.hash === 'string' &&
    HASH_PATTERN.test(entry.hash) &&
    typeof entry.label === 'string' &&
    entry.label.trim().length > 0 &&
    typeof entry.createdAt === 'number' &&
    Number.isFinite(entry.createdAt) &&
    (entry.status === 'pending' || entry.status === 'confirmed' || entry.status === 'reverted')
  )
}

const migrateV1Entry = (entry: V1Entry): TransactionEvidence => ({
  hash: entry.hash,
  label: entry.label,
  status: entry.status === 'pending' ? 'submitted' : entry.status === 'confirmed' ? 'final' : 'reverted',
  submittedAt: entry.createdAt,
  confirmations: entry.status === 'confirmed' ? 1 : 0,
  requiredConfirmations: 1,
  reorgDetected: false,
})
