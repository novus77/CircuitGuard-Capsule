import type { Hash } from 'viem'
import {
  TransactionJournal,
  type TransactionEvidence,
} from '../state/transactionJournal'

export type FinalityReceipt = {
  status: 'success' | 'reverted'
  blockNumber: bigint
  blockHash: Hash
}

export type FinalityClient = {
  getTransactionReceipt(request: { hash: Hash }): Promise<FinalityReceipt>
  getBlockNumber(): Promise<bigint>
}

export const deriveFinality = (
  previous: TransactionEvidence,
  receipt: FinalityReceipt | null,
  latestBlock: bigint,
  requiredConfirmations: number,
): TransactionEvidence => {
  if (!Number.isInteger(requiredConfirmations) || requiredConfirmations < 1) {
    throw new Error('requiredConfirmations must be a positive integer')
  }

  if (!receipt) {
    if (previous.status === 'mined') {
      const { blockNumber: _blockNumber, blockHash: _blockHash, ...rest } = previous
      return {
        ...rest,
        status: 'submitted',
        confirmations: 0,
        requiredConfirmations,
        reorgDetected: true,
      }
    }
    return { ...previous, requiredConfirmations }
  }

  if (
    previous.status === 'mined' &&
    previous.blockHash &&
    previous.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase()
  ) {
    return {
      ...previous,
      status: 'submitted',
      blockNumber: undefined,
      blockHash: undefined,
      confirmations: 0,
      requiredConfirmations,
      reorgDetected: true,
    }
  }

  const confirmations =
    latestBlock >= receipt.blockNumber ? Number(latestBlock - receipt.blockNumber + 1n) : 0
  const common = {
    ...previous,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    confirmations,
    requiredConfirmations,
  }

  if (receipt.status === 'reverted') {
    return { ...common, status: 'reverted' }
  }

  return {
    ...common,
    status: confirmations >= requiredConfirmations ? 'final' : 'mined',
  }
}

export type FinalityPollOptions = {
  pollIntervalMs?: number
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
  onUpdate?: (evidence: TransactionEvidence) => void | Promise<void>
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

export const waitForJournaledFinality = async (
  client: FinalityClient,
  journal: TransactionJournal,
  hash: Hash,
  requiredConfirmations: number,
  timeoutMs = 120_000,
  options: FinalityPollOptions = {},
): Promise<TransactionEvidence> => {
  const pollIntervalMs = Math.max(100, options.pollIntervalMs ?? 1_000)
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep
  const startedAt = now()

  while (true) {
    const previous = journal.entries().find(
      (entry) => entry.hash.toLowerCase() === hash.toLowerCase(),
    )
    if (!previous) throw new Error(`Transaction ${hash} does not exist`)

    const [receipt, latestBlock] = await Promise.all([
      client.getTransactionReceipt({ hash }).catch(() => null),
      client.getBlockNumber(),
    ])
    const next = deriveFinality(previous, receipt, latestBlock, requiredConfirmations)
    journal.update(next)
    await options.onUpdate?.(next)

    if (next.status === 'final' || next.status === 'reverted' || now() - startedAt >= timeoutMs) {
      return next
    }

    await sleep(Math.min(pollIntervalMs, Math.max(0, timeoutMs - (now() - startedAt))))
  }
}
