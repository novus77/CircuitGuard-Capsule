import type { DeployedManifest } from '../config/deployment'
import type { VerificationLayer } from '../domain/trustEnvelope'

export type SiteAttestationSource = {
  read(
    expected: Pick<DeployedManifest, 'container' | 'site'>,
  ): Promise<VerificationLayer>
}

export const noSiteAttestation: SiteAttestationSource = {
  async read() {
    return {
      status: 'unverified',
      summary: 'Site origin is not externally attested',
      detail: 'Open this deployment with a verified TapeKit client to enable signing.',
    }
  },
}

export const createE2ESiteAttestation = (mode: string): SiteAttestationSource => {
  if (mode !== 'e2e') {
    throw new Error('The verified Site attestation fixture is test-only')
  }

  return {
    async read(expected) {
      if (expected.site.status !== 'published') {
        return {
          status: 'unverified',
          summary: 'Site manifest is not published',
          detail: 'A published TapeKit manifest hash is required for Site verification.',
        }
      }

      return {
        status: 'verified',
        summary: 'Site verified by E2E fixture',
        detail: 'CIRCUITGUARD_E2E_SITE_VERIFIED',
      }
    },
  }
}

export const siteAttestationSource: SiteAttestationSource =
  import.meta.env.DEV && import.meta.env.MODE === 'e2e'
    ? createE2ESiteAttestation('e2e')
    : noSiteAttestation
