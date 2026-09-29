import { useState } from 'preact/hooks'
import type { PolicyFacts } from '../domain/policy'
import type { CircuitGuardActions, CircuitGuardModel } from '../hooks/useCircuitGuard'

const facts: Array<[keyof PolicyFacts, string]> = [
  ['systemActive', 'System active'],
  ['recipientTrusted', 'Recipient trusted'],
  ['recipientBlocked', 'Recipient blocked'],
  ['amountLow', 'Amount low'],
  ['withinDailyBudget', 'Within daily budget'],
  ['humanApproved', 'Human approved'],
]

export function CircuitDecision({
  model,
  actions,
}: {
  model: CircuitGuardModel
  actions: CircuitGuardActions
}) {
  const [proposalId, setProposalId] = useState('1')
  const [loadError, setLoadError] = useState<string>()
  const parsedId = /^\d+$/.test(proposalId) ? BigInt(proposalId) : 0n
  const invalidId = parsedId === 0n
  const disabled = !model.trustEnvelope.signingEnabled || invalidId

  const loadProposal = async () => {
    setLoadError(undefined)
    try {
      await actions.loadProposal(parsedId)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Proposal read failed')
    }
  }

  return (
    <section class="panel circuit-panel">
      <div class="panel-heading">
        <div><span class="eyebrow">13 NAND · 0 state</span><h2>Policy circuit</h2></div>
        <div class="decision" data-testid="decision" data-decision={model.decision}>
          <small>Decision</small><strong>{model.decision}</strong>
        </div>
      </div>
      <div class="signal-flow" aria-label="Policy inputs">
        {facts.map(([key, label], bit) => (
          <div class={`signal ${model.facts[key] ? 'on' : 'off'}`} key={key}>
            <span>b{bit}</span><strong>{model.facts[key] ? '1' : '0'}</strong><small>{label}</small>
          </div>
        ))}
      </div>
      <div class="circuit-readout">
        <span>Inputs <code>0x{model.inputs.toString(16).padStart(2, '0')}</code></span>
        <span>Outputs <code>0x{model.outputs.toString(16).padStart(2, '0')}</code></span>
        <span>Error <code>{model.policyError}</code></span>
        <span>State <code>{model.proposalState}</code></span>
      </div>
      <div class="proposal-actions">
        <label>Proposal ID<input inputMode="numeric" value={proposalId} onInput={(event) => setProposalId(event.currentTarget.value)} /></label>
        <button type="button" disabled={model.pending || invalidId || model.status !== 'ready'} onClick={() => void loadProposal()}>Load evidence</button>
        <button type="button" disabled={disabled} onClick={() => void actions.approveProposal(parsedId)}>Approve 10 minutes</button>
        {model.decision !== 'DENY' && (
          <button type="button" disabled={disabled} onClick={() => void actions.executeApproved(parsedId)}>Execute approved</button>
        )}
        <button type="button" disabled={disabled} onClick={() => void actions.cancelProposal(parsedId)}>Cancel proposal</button>
      </div>
      {loadError && <p class="form-error">{loadError}</p>}
    </section>
  )
}
