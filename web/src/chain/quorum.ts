import {
  getAddress,
  keccak256,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import type { DeployedManifest } from '../config/deployment'
import type { VerificationLayer } from '../domain/trustEnvelope'
import { factoryAbi, processorAbi } from './abis'

export type IdentitySnapshot = {
  chainId: number
  factoryRecognizesProcessor: boolean
  processor: Address
  circuitId: bigint
  nIn: number
  nOut: number
  nState: number
  gateCount: number
  netlistHash: Hash
  processorCodeHash: Hash
  container: Address
  containerCodeHash: Hash
  adapter: Address
  adapterCodeHash: Hash
  treasury: Address
  treasuryCodeHash: Hash
}

type IdentityReadRequest = {
  address: Address
  abi: readonly unknown[]
  functionName: string
  args: readonly unknown[]
}

export type IdentityReader = {
  getChainId(): Promise<number>
  readContract(request: IdentityReadRequest): Promise<unknown>
  getCode(request: { address: Address }): Promise<Hex | undefined>
}

const SNAPSHOT_FIELDS = [
  'chainId',
  'factoryRecognizesProcessor',
  'processor',
  'circuitId',
  'nIn',
  'nOut',
  'nState',
  'gateCount',
  'netlistHash',
  'processorCodeHash',
  'container',
  'containerCodeHash',
  'adapter',
  'adapterCodeHash',
  'treasury',
  'treasuryCodeHash',
] as const satisfies readonly (keyof IdentitySnapshot)[]

const comparableValue = (value: IdentitySnapshot[keyof IdentitySnapshot]): string =>
  typeof value === 'string' && value.startsWith('0x') ? value.toLowerCase() : String(value)

const firstSnapshotConflict = (
  left: IdentitySnapshot,
  right: IdentitySnapshot,
): keyof IdentitySnapshot | undefined =>
  SNAPSHOT_FIELDS.find(
    (field) => comparableValue(left[field]) !== comparableValue(right[field]),
  )

const expectedSnapshot = (manifest: DeployedManifest): IdentitySnapshot => ({
  chainId: manifest.chainId,
  factoryRecognizesProcessor: true,
  processor: getAddress(manifest.processor),
  circuitId: BigInt(manifest.circuitId),
  nIn: 6,
  nOut: 2,
  nState: 0,
  gateCount: 13,
  netlistHash: manifest.netlistHash,
  processorCodeHash: manifest.processorCodeHash,
  container: getAddress(manifest.container),
  containerCodeHash: manifest.containerCodeHash,
  adapter: getAddress(manifest.adapter),
  adapterCodeHash: manifest.adapterCodeHash,
  treasury: getAddress(manifest.treasury),
  treasuryCodeHash: manifest.treasuryCodeHash,
})

export const compareIdentitySnapshots = (
  manifest: DeployedManifest,
  primary: IdentitySnapshot | undefined,
  secondary: IdentitySnapshot | undefined,
): VerificationLayer => {
  if (!primary && !secondary) {
    return {
      status: 'unverified',
      summary: 'Identity unavailable',
      detail: 'Neither RPC endpoint returned a valid identity snapshot',
    }
  }

  if (primary && secondary) {
    const conflict = firstSnapshotConflict(primary, secondary)
    if (conflict) {
      return {
        status: 'blocked',
        summary: 'Identity mismatch',
        detail: `${conflict} differs between RPC endpoints`,
      }
    }
  }

  const available = primary ?? secondary
  if (!available) {
    return { status: 'blocked', summary: 'Identity mismatch' }
  }

  const manifestConflict = firstSnapshotConflict(expectedSnapshot(manifest), available)
  if (manifestConflict) {
    return {
      status: 'blocked',
      summary: 'Identity mismatch',
      detail: `${manifestConflict} differs from deployment manifest`,
    }
  }

  if (!primary || !secondary) {
    return {
      status: 'degraded',
      summary: 'Single-source identity',
      detail: `${primary ? 'Secondary' : 'Primary'} RPC endpoint is unavailable`,
    }
  }

  return {
    status: 'verified',
    summary: 'Identity verified by both RPC endpoints',
  }
}

const requireCode = (code: Hex | undefined, field: string): Hex => {
  if (!code || code === '0x') {
    throw new Error(`${field} runtime bytecode is missing`)
  }
  return code
}

export const readIdentitySnapshot = async (
  client: IdentityReader,
  manifest: DeployedManifest,
): Promise<IdentitySnapshot> => {
  const circuitId = BigInt(manifest.circuitId)
  const [
    chainId,
    registered,
    metadata,
    netlist,
    processorCode,
    containerCode,
    adapterCode,
    treasuryCode,
  ] = await Promise.all([
    client.getChainId(),
    client.readContract({
      address: manifest.factory,
      abi: factoryAbi,
      functionName: 'isCPU',
      args: [manifest.processor],
    }),
    client.readContract({
      address: manifest.processor,
      abi: processorAbi,
      functionName: 'circuitInfo',
      args: [circuitId],
    }),
    client.readContract({
      address: manifest.processor,
      abi: processorAbi,
      functionName: 'netlist',
      args: [circuitId],
    }),
    client.getCode({ address: manifest.processor }),
    client.getCode({ address: manifest.container }),
    client.getCode({ address: manifest.adapter }),
    client.getCode({ address: manifest.treasury }),
  ])

  if (chainId !== 196) {
    throw new Error(`Identity RPC must be on chain 196, received ${chainId}`)
  }

  const [nIn, nOut, nState, gateCount] = metadata as readonly [number, number, number, number]
  return {
    chainId,
    factoryRecognizesProcessor: registered as boolean,
    processor: getAddress(manifest.processor),
    circuitId,
    nIn,
    nOut,
    nState,
    gateCount,
    netlistHash: keccak256(netlist as Hex),
    processorCodeHash: keccak256(requireCode(processorCode, 'Processor')),
    container: getAddress(manifest.container),
    containerCodeHash: keccak256(requireCode(containerCode, 'Container')),
    adapter: getAddress(manifest.adapter),
    adapterCodeHash: keccak256(requireCode(adapterCode, 'Adapter')),
    treasury: getAddress(manifest.treasury),
    treasuryCodeHash: keccak256(requireCode(treasuryCode, 'Treasury')),
  }
}

export const verifyIdentityQuorum = async (
  primaryClient: IdentityReader,
  secondaryClient: IdentityReader,
  manifest: DeployedManifest,
): Promise<VerificationLayer> => {
  const [primaryResult, secondaryResult] = await Promise.allSettled([
    readIdentitySnapshot(primaryClient, manifest),
    readIdentitySnapshot(secondaryClient, manifest),
  ])

  const deterministicFailure = [primaryResult, secondaryResult].find(
    (result): result is PromiseRejectedResult =>
      result.status === 'rejected'
      && result.reason instanceof Error
      && /must be on chain 196|runtime bytecode is missing/i.test(result.reason.message),
  )
  if (deterministicFailure) {
    return {
      status: 'blocked',
      summary: 'Invalid RPC identity',
      detail: deterministicFailure.reason.message,
    }
  }

  const primary = primaryResult.status === 'fulfilled' ? primaryResult.value : undefined
  const secondary = secondaryResult.status === 'fulfilled' ? secondaryResult.value : undefined

  return compareIdentitySnapshots(manifest, primary, secondary)
}
