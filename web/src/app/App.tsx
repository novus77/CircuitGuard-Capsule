import { CircuitDecision } from '../components/CircuitDecision'
import { ProposalForm } from '../components/ProposalForm'
import { TreasuryPanel } from '../components/TreasuryPanel'
import { VerificationBar } from '../components/VerificationBar'
import {
  useCircuitGuard,
  type CircuitGuardActions,
  type CircuitGuardModel,
} from '../hooks/useCircuitGuard'
import '../styles.css'

export function Dashboard({
  model,
  actions,
}: {
  model: CircuitGuardModel
  actions: CircuitGuardActions
}) {
  return (
    <div class="app-shell">
      <VerificationBar model={model} onConnect={() => void actions.connect()} />
      {model.status === 'wrong-network' && (
        <div class="network-alert" role="alert">Switch your wallet to X Layer (chain 196) before signing.</div>
      )}
      {model.error && <div class="network-alert" role="alert">{model.error}</div>}
      <main>
        <section class="hero-copy">
          <div>
            <span class="eyebrow">On-chain policy enforcement</span>
            <h1>Agents can propose.<br /><em>The circuit decides.</em></h1>
          </div>
          <p>Every OKB and USDT0 transfer is derived from six Treasury facts, evaluated by the pinned TapeOut circuit, and recorded as verifiable evidence.</p>
        </section>
        <aside class="risk-banner">
          <strong>Experimental prototype</strong>
          <span>Limited demo funds only. Owner recovery bypasses the policy circuit, and current TapeOut infrastructure is not independently audited or sealed.</span>
        </aside>
        <section class="endpoint-summary" aria-label="Endpoint trust summary">
          <strong>Endpoint {model.trustEnvelope.overall}</strong>
          <code>{model.trustEnvelope.coordinate}</code>
          {model.signingDisabledReason && <p>{model.signingDisabledReason}</p>}
        </section>
        {model.status === 'unavailable' && (
          <section class="deployment-empty">
            <span class="eyebrow">Local build ready</span>
            <h2>Mainnet deployment not recorded yet</h2>
            <p>The interface refuses to invent contract identities. Complete the reviewed X Layer deployment to enable live reads and signing.</p>
          </section>
        )}
        <div class="dashboard-grid">
          <TreasuryPanel model={model} />
          <ProposalForm model={model} actions={actions} />
          <CircuitDecision model={model} actions={actions} />
        </div>
      </main>
      <footer>
        <span>Canonical netlist</span>
        <code>{model.verification.netlistHash}</code>
        <span>Frontend target: same Circuit container</span>
      </footer>
    </div>
  )
}

export function App() {
  const { model, actions } = useCircuitGuard()
  return <Dashboard model={model} actions={actions} />
}
