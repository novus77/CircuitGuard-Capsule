import { useState } from 'preact/hooks'
import { getAddress } from 'viem'
import type { Asset } from '../domain/amount'
import type { CircuitGuardActions, CircuitGuardModel } from '../hooks/useCircuitGuard'

export function ProposalForm({
  model,
  actions,
}: {
  model: CircuitGuardModel
  actions: CircuitGuardActions
}) {
  const [asset, setAsset] = useState<Asset>('USDT0')
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('3')
  const [memo, setMemo] = useState('Trusted data provider')
  const [error, setError] = useState<string>()
  const [preview, setPreview] = useState(false)

  const disabled = !model.trustEnvelope.signingEnabled

  const submit = async (event: Event) => {
    event.preventDefault()
    setError(undefined)
    try {
      const draft = { asset, recipient: getAddress(recipient), amount, memo }
      if (!preview) {
        setPreview(true)
        return
      }
      await actions.requestTransfer(draft)
      setPreview(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Request failed')
    }
  }

  return (
    <section class="panel proposal-panel">
      <div class="panel-heading">
        <div><span class="eyebrow">Agent intent</span><h2>Request a transfer</h2></div>
        <span class="step-label">Preview → Sign → Verify</span>
      </div>
      <div class="preset-row" aria-label="Demo presets">
        <button type="button" onClick={() => { setAsset('USDT0'); setAmount('3'); setMemo('Trusted data provider'); setPreview(false) }}>3 USDT0 / trusted</button>
        <button type="button" onClick={() => { setAsset('USDT0'); setAmount('30'); setMemo('Human-reviewed provider'); setPreview(false) }}>30 USDT0 / review</button>
        <button type="button" onClick={() => { setAsset('OKB'); setAmount('0.01'); setMemo('Trusted compute job'); setPreview(false) }}>0.01 OKB / trusted</button>
      </div>
      <form onSubmit={submit}>
        <label>Asset<select value={asset} onChange={(event) => { setAsset(event.currentTarget.value as Asset); setPreview(false) }}><option>USDT0</option><option>OKB</option></select></label>
        <label class="wide">Recipient<input value={recipient} placeholder="0x…" onInput={(event) => { setRecipient(event.currentTarget.value); setPreview(false) }} /></label>
        <label>Amount<input inputMode="decimal" value={amount} onInput={(event) => { setAmount(event.currentTarget.value); setPreview(false) }} /></label>
        <label class="wide">Memo (hashed on submit)<input value={memo} onInput={(event) => { setMemo(event.currentTarget.value); setPreview(false) }} /></label>
        {preview && <div class="transfer-preview" role="status"><strong>Review request</strong><span>{amount} {asset}</span><code>{recipient}</code><small>Submitting creates an immutable on-chain proposal.</small></div>}
        {error && <p class="form-error">{error}</p>}
        <button
          class="primary-action"
          type="submit"
          disabled={disabled}
          title={disabled ? model.signingDisabledReason : undefined}
        >
          {model.pending ? 'Transaction pending' : preview ? 'Confirm & request' : 'Preview transfer'}
        </button>
      </form>
    </section>
  )
}
