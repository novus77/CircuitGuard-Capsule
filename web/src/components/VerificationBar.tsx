import type { CircuitGuardModel } from '../hooks/useCircuitGuard'

type Props = {
  model: CircuitGuardModel
  onConnect: () => void
}

const compact = (value: string) =>
  value.startsWith('0x') && value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value

export function VerificationBar({ model, onConnect }: Props) {
  const items = [
    ['Processor', model.verification.processor],
    ['Circuit', `#${model.verification.circuitId}`],
    ['Container', model.verification.container],
    ['Adapter', model.verification.adapter],
    ['Treasury', model.verification.treasury],
  ]

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
        {items.map(([label, value]) => (
          <span class="verification-item" title={value} key={label}>
            <small>{label}</small>{compact(value)}
          </span>
        ))}
      </div>
      <button class="wallet-button" type="button" onClick={onConnect}>
        {model.walletStatus === 'connected'
          ? compact(model.walletAddress ?? 'Connected')
          : model.walletStatus === 'connecting'
            ? 'Connecting…'
            : 'Connect wallet'}
      </button>
    </header>
  )
}
