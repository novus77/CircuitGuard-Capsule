import { describe, expect, it } from 'vitest'
import type { DeployedManifest } from '../src/config/deployment'
import {
  createE2ESiteAttestation,
  noSiteAttestation,
} from '../src/site/siteAttestation'

const expected = {
  container: '0x2222222222222222222222222222222222222222',
  site: {
    status: 'published',
    manifestHash: `0x${'11'.repeat(32)}`,
  },
} as const satisfies Pick<DeployedManifest, 'container' | 'site'>

describe('Site attestation boundary', () => {
  it('defaults to unverified without an external TapeKit attestation', async () => {
    await expect(noSiteAttestation.read(expected)).resolves.toMatchObject({
      status: 'unverified',
    })
  })

  it('allows a verified source only in the explicit E2E mode', async () => {
    await expect(createE2ESiteAttestation('e2e').read(expected)).resolves.toMatchObject({
      status: 'verified',
    })
  })

  it('rejects the E2E source in production mode', () => {
    expect(() => createE2ESiteAttestation('production')).toThrow('test-only')
  })
})
