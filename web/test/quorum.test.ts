import { describe, expect, it } from 'vitest'
import { keccak256, type Address, type Hash, type Hex } from 'viem'
import type { DeployedManifest } from '../src/config/deployment'
import {
  compareIdentitySnapshots,
  readIdentitySnapshot,
  verifyIdentityQuorum,
  type IdentityReader,
  type IdentitySnapshot,
} from '../src/chain/quorum'

const HASH_B = `0x${'22'.repeat(32)}` as Hash
const CODE = '0x6000' as Hex
const CODE_HASH = keccak256(CODE)
const PROCESSOR = '0x1111111111111111111111111111111111111111' as Address
const CONTAINER = '0x2222222222222222222222222222222222222222' as Address
const ADAPTER = '0x3333333333333333333333333333333333333333' as Address
const TREASURY = '0x4444444444444444444444444444444444444444' as Address

const makeDeployedManifest = (
  overrides: Partial<DeployedManifest> = {},
): DeployedManifest => ({
  schemaVersion: 1,
  chainId: 196,
  factory: '0x1f09daefa827f02cbb40967cc91b259763760761',
  usdt0: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
  status: 'deployed',
  processor: PROCESSOR,
  circuitId: '7',
  netlistHash: CODE_HASH,
  container: CONTAINER,
  adapter: ADAPTER,
  treasury: TREASURY,
  merchant: '0x5555555555555555555555555555555555555555',
  deploymentBlock: 1,
  safeConfirmations: 12,
  endpointCoordinate: `196:${CONTAINER}`,
  processorCodeHash: CODE_HASH,
  containerCodeHash: CODE_HASH,
  adapterCodeHash: CODE_HASH,
  treasuryCodeHash: CODE_HASH,
  site: { status: 'unpublished' },
  transactions: [],
  ...overrides,
})

const makeIdentitySnapshot = (
  overrides: Partial<IdentitySnapshot> = {},
): IdentitySnapshot => ({
  chainId: 196,
  factoryRecognizesProcessor: true,
  processor: PROCESSOR,
  circuitId: 7n,
  nIn: 6,
  nOut: 2,
  nState: 0,
  gateCount: 13,
  netlistHash: CODE_HASH,
  processorCodeHash: CODE_HASH,
  container: CONTAINER,
  containerCodeHash: CODE_HASH,
  adapter: ADAPTER,
  adapterCodeHash: CODE_HASH,
  treasury: TREASURY,
  treasuryCodeHash: CODE_HASH,
  ...overrides,
})

describe('identity snapshot comparison', () => {
  it('verifies two matching snapshots against the manifest', () => {
    const expected = makeDeployedManifest()
    const snapshot = makeIdentitySnapshot()

    expect(compareIdentitySnapshots(expected, snapshot, snapshot)).toMatchObject({
      status: 'verified',
    })
  })

  it('degrades when exactly one matching RPC snapshot is available', () => {
    const expected = makeDeployedManifest()
    const snapshot = makeIdentitySnapshot()

    expect(compareIdentitySnapshots(expected, snapshot, undefined)).toMatchObject({
      status: 'degraded',
    })
    expect(compareIdentitySnapshots(expected, undefined, snapshot)).toMatchObject({
      status: 'degraded',
    })
  })

  it('blocks on the first deterministic RPC conflict', () => {
    const expected = makeDeployedManifest()
    const primary = makeIdentitySnapshot()
    const secondary = makeIdentitySnapshot({ treasuryCodeHash: HASH_B })

    expect(compareIdentitySnapshots(expected, primary, secondary)).toEqual({
      status: 'blocked',
      summary: 'Identity mismatch',
      detail: 'treasuryCodeHash differs between RPC endpoints',
    })
  })

  it('blocks when a surviving snapshot conflicts with the manifest', () => {
    expect(
      compareIdentitySnapshots(
        makeDeployedManifest(),
        makeIdentitySnapshot({ netlistHash: HASH_B }),
        undefined,
      ),
    ).toMatchObject({
      status: 'blocked',
      detail: 'netlistHash differs from deployment manifest',
    })
  })

  it('is unverified when neither RPC can provide a snapshot', () => {
    expect(compareIdentitySnapshots(makeDeployedManifest(), undefined, undefined)).toMatchObject({
      status: 'unverified',
    })
  })
})

const makeReader = (overrides: Partial<IdentityReader> = {}): IdentityReader => ({
  getChainId: async () => 196,
  readContract: async ({ functionName }) => {
    if (functionName === 'isCPU') return true
    if (functionName === 'circuitInfo') return [6, 2, 0, 13] as const
    if (functionName === 'netlist') return CODE
    throw new Error(`Unexpected read: ${functionName}`)
  },
  getCode: async () => CODE,
  ...overrides,
})

describe('identity snapshot reader', () => {
  it('rejects a client on the wrong chain', async () => {
    await expect(
      readIdentitySnapshot(makeReader({ getChainId: async () => 1 }), makeDeployedManifest()),
    ).rejects.toThrow('chain 196')
  })

  it('rejects missing runtime bytecode', async () => {
    await expect(
      readIdentitySnapshot(makeReader({ getCode: async () => undefined }), makeDeployedManifest()),
    ).rejects.toThrow('bytecode')
  })

  it('isolates endpoint failures before comparison', async () => {
    const failing = makeReader({ getChainId: async () => Promise.reject(new Error('offline')) })
    const result = await verifyIdentityQuorum(failing, makeReader(), makeDeployedManifest())

    expect(result.status).toBe('degraded')
  })
})
