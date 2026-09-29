import { describe, expect, it } from 'vitest'
import { primaryClient, secondaryClient } from '../src/chain/client'
import {
  isDeployedManifest,
  requireDeployedManifest,
  type DeploymentManifest,
} from '../src/config/deployment'
import {
  XLAYER_PRIMARY_RPC_URL,
  XLAYER_SECONDARY_RPC_URL,
  xLayer,
} from '../src/config/xlayer'

const notDeployed: DeploymentManifest = {
  schemaVersion: 1,
  chainId: 196,
  factory: '0x1f09daefa827f02cbb40967cc91b259763760761',
  usdt0: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
  status: 'not-deployed',
  transactions: [],
}

describe('X Layer configuration', () => {
  it('uses independent official RPC hosts on chain 196', () => {
    expect(new URL(XLAYER_PRIMARY_RPC_URL).hostname).not.toBe(
      new URL(XLAYER_SECONDARY_RPC_URL).hostname,
    )
    expect(xLayer.id).toBe(196)
    expect(primaryClient.chain?.id).toBe(196)
    expect(secondaryClient.chain?.id).toBe(196)
  })
})

describe('deployment manifest', () => {
  it('keeps the explicit not-deployed state valid', () => {
    expect(isDeployedManifest(notDeployed)).toBe(false)
    expect(() => requireDeployedManifest(notDeployed)).toThrow('not deployed')
  })

  it('rejects deployed manifests without immutable evidence', () => {
    expect(() =>
      requireDeployedManifest({
        ...notDeployed,
        status: 'deployed',
      } as DeploymentManifest),
    ).toThrow('deploymentBlock')
  })
})
