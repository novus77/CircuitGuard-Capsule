export type VerificationStatus = 'loading' | 'verified' | 'unverified' | 'degraded' | 'blocked'

export type VerificationLayer = {
  status: VerificationStatus
  summary: string
  detail?: string
  verifiedAtBlock?: bigint
}

export type TrustEnvelope = {
  coordinate: string
  site: VerificationLayer
  policy: VerificationLayer
  execution: VerificationLayer
  overall: VerificationStatus
  signingEnabled: boolean
}

type TrustLayers = Pick<TrustEnvelope, 'site' | 'policy' | 'execution'>

const STATUS_PRIORITY: readonly VerificationStatus[] = [
  'blocked',
  'unverified',
  'degraded',
  'loading',
  'verified',
]

export const classifyOverall = (layers: TrustLayers): VerificationStatus => {
  const statuses = new Set([
    layers.site.status,
    layers.policy.status,
    layers.execution.status,
  ])

  return STATUS_PRIORITY.find((status) => statuses.has(status)) ?? 'blocked'
}

export const canSign = (input: {
  overall: VerificationStatus
  walletReady: boolean
  modelReady: boolean
  unresolved: boolean
}): boolean =>
  input.overall === 'verified' && input.walletReady && input.modelReady && !input.unresolved
