import type { CircuitGuardModel } from '../hooks/useCircuitGuard'

const layers = [
  ['Site', 'site'],
  ['Policy', 'policy'],
  ['Execution', 'execution'],
] as const

const identityDetails = (model: CircuitGuardModel, layer: (typeof layers)[number][1]) => {
  if (layer === 'site') return [`Container ${model.verification.container}`]
  if (layer === 'policy') {
    return [
      `Processor ${model.verification.processor}`,
      `Circuit #${model.verification.circuitId}`,
      `Netlist ${model.verification.netlistHash}`,
    ]
  }
  return [
    `Adapter ${model.verification.adapter}`,
    `Treasury ${model.verification.treasury}`,
  ]
}

export function TrustEnvelopePanel({ model }: { model: CircuitGuardModel }) {
  return (
    <section class="trust-envelope" aria-labelledby="trust-envelope-title">
      <div class="trust-heading">
        <div>
          <span class="eyebrow">Fail-closed verification</span>
          <h2 id="trust-envelope-title">Trust Envelope</h2>
        </div>
        <span class={`status-pill trust-overall ${model.trustEnvelope.overall}`}>
          {model.trustEnvelope.signingEnabled ? 'Signing enabled' : 'Read only'}
        </span>
      </div>
      <div class="trust-grid">
        {layers.map(([label, key]) => {
          const layer = model.trustEnvelope[key]
          return (
            <article class={`trust-card ${layer.status}`} key={key}>
              <div class="trust-card-header">
                <span>{label}</span>
                <strong>{layer.status}</strong>
              </div>
              <h3>{layer.summary}</h3>
              <details>
                <summary>Technical details</summary>
                {layer.detail && <p>{layer.detail}</p>}
                {layer.verifiedAtBlock !== undefined && (
                  <p>Verified at block {layer.verifiedAtBlock.toString()}</p>
                )}
                {identityDetails(model, key).map((detail) => <code key={detail}>{detail}</code>)}
              </details>
            </article>
          )
        })}
      </div>
    </section>
  )
}
