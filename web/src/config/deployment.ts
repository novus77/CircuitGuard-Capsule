import { getAddress, isAddress, type Address, type Hash } from 'viem'
import deploymentJson from '../generated/deployment.json'
import { formatEndpointCoordinate } from '../domain/endpoint'
import { e2eDeployment } from './deployment.e2e'

export const CANONICAL_NETLIST_HASH =
  '0xd722aa6af62aa44c485ec471d4234803c859aec19684caa2a510bdca1675c269' as Hash

export type DeploymentTransaction = {
  kind: string
  hash: Hash
}

type DeploymentBase = {
  schemaVersion: 1
  chainId: 196
  factory: Address
  usdt0: Address
  transactions: DeploymentTransaction[]
}

export type NotDeployedManifest = DeploymentBase & {
  status: 'not-deployed'
  processor?: never
  circuitId?: never
  netlistHash?: never
  container?: never
  adapter?: never
  treasury?: never
  merchant?: never
  deploymentBlock?: never
  safeConfirmations?: never
  endpointCoordinate?: never
  processorCodeHash?: never
  containerCodeHash?: never
  adapterCodeHash?: never
  treasuryCodeHash?: never
  site?: never
}

export type SiteManifest =
  | { status: 'unpublished' }
  | { status: 'published'; manifestHash: Hash }

export type DeployedManifest = DeploymentBase & {
  status: 'deployed'
  processor: Address
  circuitId: string
  netlistHash: Hash
  container: Address
  adapter: Address
  treasury: Address
  merchant: Address
  deploymentBlock: number
  safeConfirmations: number
  endpointCoordinate: string
  processorCodeHash: Hash
  containerCodeHash: Hash
  adapterCodeHash: Hash
  treasuryCodeHash: Hash
  site: SiteManifest
}

export type DeploymentManifest = NotDeployedManifest | DeployedManifest

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/

const requireAddress = (value: unknown, field: string): Address => {
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new Error(`${field} must be a 20-byte address`)
  }
  return getAddress(value)
}

const requireHash = (value: unknown, field: string): Hash => {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error(`${field} must be a 32-byte hash`)
  }
  return value as Hash
}

export const isDeployedManifest = (
  manifest: DeploymentManifest,
): manifest is DeployedManifest => manifest.status === 'deployed'

export const requireDeployedManifest = (manifest: DeploymentManifest): DeployedManifest => {
  if (!isDeployedManifest(manifest)) {
    throw new Error('CircuitGuard is not deployed')
  }

  if (!Number.isInteger(manifest.deploymentBlock) || manifest.deploymentBlock <= 0) {
    throw new Error('deploymentBlock must be a positive integer')
  }
  if (
    !Number.isInteger(manifest.safeConfirmations) ||
    manifest.safeConfirmations < 1 ||
    manifest.safeConfirmations > 256
  ) {
    throw new Error('safeConfirmations must be an integer from 1 through 256')
  }

  const processor = requireAddress(manifest.processor, 'processor')
  const container = requireAddress(manifest.container, 'container')
  requireAddress(manifest.adapter, 'adapter')
  requireAddress(manifest.treasury, 'treasury')
  requireAddress(manifest.merchant, 'merchant')
  if (!/^\d+$/.test(manifest.circuitId)) {
    throw new Error('circuitId must be an unsigned integer')
  }
  if (manifest.netlistHash.toLowerCase() !== CANONICAL_NETLIST_HASH) {
    throw new Error('canonical netlist hash mismatch')
  }
  if (manifest.endpointCoordinate !== formatEndpointCoordinate(196, container)) {
    throw new Error('endpointCoordinate does not match chain and container')
  }

  requireHash(manifest.processorCodeHash, 'processorCodeHash')
  requireHash(manifest.containerCodeHash, 'containerCodeHash')
  requireHash(manifest.adapterCodeHash, 'adapterCodeHash')
  requireHash(manifest.treasuryCodeHash, 'treasuryCodeHash')
  if (manifest.site.status === 'published') {
    requireHash(manifest.site.manifestHash, 'site.manifestHash')
  }

  return { ...manifest, processor, container }
}

export const deploymentManifest = (
  import.meta.env.DEV && import.meta.env.MODE === 'e2e' ? e2eDeployment : deploymentJson
) as DeploymentManifest
