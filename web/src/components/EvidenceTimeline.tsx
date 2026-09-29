import type { CircuitGuardModel } from '../hooks/useCircuitGuard'

const compact = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

export function EvidenceTimeline({ model }: { model: CircuitGuardModel }) {
  const transaction = model.transactionEvidence
  const hasEvidence = Boolean(transaction) || model.proposalEvidence.length > 0
  if (!hasEvidence) return null

  return (
    <section class="evidence-timeline" aria-labelledby="evidence-title">
      <div class="evidence-heading">
        <span class="eyebrow">On-chain receipts</span>
        <h3 id="evidence-title">Evidence timeline</h3>
      </div>
      <ol>
        {transaction && (
          <li class={transaction.reorgDetected ? 'blocked' : transaction.status}>
            <div>
              <strong>{transaction.label}</strong>
              <code>{compact(transaction.hash)}</code>
            </div>
            <span>
              {capitalize(transaction.status)} · {transaction.confirmations}/
              {transaction.requiredConfirmations} confirmations
            </span>
          </li>
        )}
        {model.proposalEvidence.map((evidence) => (
          <li class={evidence.final ? 'final' : 'pending'} key={`${evidence.transactionHash}:${evidence.logIndex}`}>
            <div>
              <strong>{capitalize(evidence.kind)}</strong>
              <code>{compact(evidence.transactionHash)}</code>
            </div>
            <span>
              {evidence.final ? 'Final' : 'Pending'} · {evidence.confirmations}/
              {evidence.requiredConfirmations} confirmations
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
