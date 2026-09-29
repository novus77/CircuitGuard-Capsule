import type { CircuitGuardModel } from '../hooks/useCircuitGuard'

export function TreasuryPanel({ model }: { model: CircuitGuardModel }) {
  return (
    <section class="panel treasury-panel">
      <div class="panel-heading">
        <div><span class="eyebrow">Vault telemetry</span><h2>Dual-asset treasury</h2></div>
        <span class={`status-pill ${model.paused ? 'danger' : 'healthy'}`}>
          {model.paused ? 'Paused' : 'Active'}
        </span>
      </div>
      <div class="asset-grid">
        {(['OKB', 'USDT0'] as const).map((asset) => {
          const snapshot = model.assets[asset]
          return (
            <article class="asset-card" key={asset}>
              <div class="asset-title"><span aria-hidden="true">{asset === 'OKB' ? '◈' : '$'}</span>{asset}</div>
              <strong>{snapshot.balance} {asset}</strong>
              <dl>
                <div><dt>Instant</dt><dd>{snapshot.instantLimit}</dd></div>
                <div><dt>Daily</dt><dd>{snapshot.dailyLimit}</dd></div>
                <div><dt>Spent</dt><dd>{snapshot.spent}</dd></div>
              </dl>
            </article>
          )
        })}
      </div>
      <p class="owner-note">Owner governance: <code>{model.owner}</code>. Agents cannot change policy or recovery settings.</p>
    </section>
  )
}
