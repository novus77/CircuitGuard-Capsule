import type { CircuitGuardModel } from '../hooks/useCircuitGuard'

type Props = {
  model: CircuitGuardModel
  onConnect: () => void
}

const compact = (value: string) =>
  value.startsWith('0x') && value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value

export function VerificationBar({ model, onConnect }: Props) {
  const statusLabel = model.trustEnvelope.overall.charAt(0).toUpperCase()
    + model.trustEnvelope.overall.slice(1)

  return (
    <header class="verification-bar">
      <div class="brand-lockup">
        <span class="brand-mark" aria-hidden="true">CG</span>
        <div>
          <strong>CircuitGuard</strong>
          <span>Capsule / Policy Treasury</span>
        </div>
      </div>
      <div class="verification-items" aria-label="Deployment verification">
        <span class="chain-chip"><i />{model.verification.chain}</span>
        <code class="endpoint-coordinate">{model.trustEnvelope.coordinate}</code>
        <div
          class={`endpoint-status ${model.trustEnvelope.overall}`}
          role="status"
          aria-label="Endpoint verification"
        >
          <span>Endpoint {model.trustEnvelope.overall}</span>
          <strong>{statusLabel}</strong>
        </div>
      </div>
      <button
        class="wallet-button"
        type="button"
        disabled={
          model.walletStatus === 'connecting'
          || (model.walletStatus !== 'connected' && model.trustEnvelope.overall !== 'verified')
        }
        aria-busy={model.walletStatus === 'connecting'}
        title={model.trustEnvelope.overall === 'verified' ? undefined : model.signingDisabledReason}
        onClick={onConnect}
      >
        {model.walletStatus === 'connected'
          ? compact(model.walletAddress ?? 'Connected')
          : model.walletStatus === 'connecting'
            ? 'Connecting…'
            : 'Connect wallet'}
      </button>
    </header>
  )
}
