// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dashboard } from '../src/app/App'
import type { CircuitGuardActions, CircuitGuardModel } from '../src/hooks/useCircuitGuard'

afterEach(cleanup)

const baseModel: CircuitGuardModel = {
  status: 'ready',
  walletStatus: 'disconnected',
  verification: {
    chain: 'X Layer · 196',
    processor: '0x1111111111111111111111111111111111111111',
    circuitId: '12',
    netlistHash: '0xd722aa6af62aa44c485ec471d4234803c859aec19684caa2a510bdca1675c269',
    container: '0x2222222222222222222222222222222222222222',
    adapter: '0x3333333333333333333333333333333333333333',
    treasury: '0x4444444444444444444444444444444444444444',
  },
  owner: '0x5555555555555555555555555555555555555555',
  paused: false,
  assets: {
    OKB: { balance: '0.5', instantLimit: '0.02', dailyLimit: '0.1', spent: '0.01' },
    USDT0: { balance: '250', instantLimit: '10', dailyLimit: '100', spent: '3' },
  },
  facts: {
    systemActive: true,
    recipientTrusted: true,
    recipientBlocked: false,
    amountLow: true,
    withinDailyBudget: true,
    humanApproved: false,
  },
  inputs: 0x1b,
  outputs: 1,
  decision: 'ALLOW',
  policyError: 'None',
  proposalState: 'Executed',
  pending: false,
  trustEnvelope: {
    coordinate: '196:0x2222222222222222222222222222222222222222',
    site: { status: 'verified', summary: 'Site verified' },
    policy: { status: 'verified', summary: 'Policy verified' },
    execution: { status: 'verified', summary: 'Execution verified' },
    overall: 'verified',
    signingEnabled: false,
  },
  signingDisabledReason: 'Connect an X Layer wallet to sign.',
  transactionEvidence: undefined,
  proposalEvidence: [],
}

const connectedModel: CircuitGuardModel = {
  ...baseModel,
  walletStatus: 'connected',
  trustEnvelope: { ...baseModel.trustEnvelope, signingEnabled: true },
  signingDisabledReason: undefined,
}

const actions = (): CircuitGuardActions => ({
  connect: vi.fn(async () => undefined),
  loadProposal: vi.fn(async () => undefined),
  requestTransfer: vi.fn(async () => undefined),
  approveProposal: vi.fn(async () => undefined),
  executeApproved: vi.fn(async () => undefined),
  cancelProposal: vi.fn(async () => undefined),
})

describe('CircuitGuard dashboard', () => {
  it('renders read-only verification, independent balances, and all policy bits', () => {
    render(<Dashboard model={baseModel} actions={actions()} />)

    expect(screen.getByText('X Layer · 196')).toBeInTheDocument()
    expect(
      screen.getByText('196:0x2222222222222222222222222222222222222222'),
    ).toBeInTheDocument()
    expect(screen.getByText('Endpoint verified')).toBeInTheDocument()
    expect(screen.getByText('0.5 OKB')).toBeInTheDocument()
    expect(screen.getByText('250 USDT0')).toBeInTheDocument()
    ;[
      'System active',
      'Recipient trusted',
      'Recipient blocked',
      'Amount low',
      'Within daily budget',
      'Human approved',
    ].forEach((label) => expect(screen.getByText(label)).toBeInTheDocument())
  })

  it.each(['ALLOW', 'REVIEW', 'DENY'] as const)('renders the %s circuit decision', (decision) => {
    render(
      <Dashboard
        model={{ ...baseModel, decision, outputs: decision === 'ALLOW' ? 1 : decision === 'REVIEW' ? 2 : 0 }}
        actions={actions()}
      />,
    )

    expect(screen.getByTestId('decision')).toHaveTextContent(decision)
    expect(screen.getByTestId('decision')).toHaveAttribute('data-decision', decision)
  })

  it('shows wrong-network and experimental-risk warnings', () => {
    render(
      <Dashboard
        model={{ ...baseModel, status: 'wrong-network', walletStatus: 'wrong-network' }}
        actions={actions()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Switch your wallet to X Layer')
    expect(screen.getByText(/experimental prototype/i)).toBeInTheDocument()
  })

  it('does not request a wallet until Connect wallet is clicked', () => {
    const callbacks = actions()
    render(<Dashboard model={baseModel} actions={callbacks} />)

    expect(callbacks.connect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Connect wallet' }))
    expect(callbacks.connect).toHaveBeenCalledTimes(1)
  })

  it('locks transaction controls while a transaction is pending', () => {
    render(<Dashboard model={{ ...baseModel, pending: true }} actions={actions()} />)

    expect(screen.getByRole('button', { name: 'Transaction pending' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Approve 10 minutes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Execute approved' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel proposal' })).toBeDisabled()
  })

  it('loads selected proposal evidence without requiring a wallet', () => {
    const callbacks = actions()
    render(<Dashboard model={baseModel} actions={callbacks} />)

    fireEvent.click(screen.getByRole('button', { name: 'Load evidence' }))
    expect(callbacks.loadProposal).toHaveBeenCalledWith(1n)
  })

  it('requires a review step before requesting a transfer', async () => {
    const callbacks = actions()
    render(
      <Dashboard
        model={connectedModel}
        actions={callbacks}
      />,
    )

    fireEvent.input(screen.getByPlaceholderText('0x…'), {
      target: { value: '0x1111111111111111111111111111111111111111' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview transfer' }))
    expect(callbacks.requestTransfer).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('3 USDT0')

    fireEvent.click(screen.getByRole('button', { name: 'Confirm & request' }))
    expect(callbacks.requestTransfer).toHaveBeenCalledTimes(1)
  })

  it('keeps an unattested Site read-only and explains why', () => {
    const detail = 'Open this deployment with a verified TapeKit client to enable signing.'
    const model: CircuitGuardModel = {
      ...connectedModel,
      trustEnvelope: {
        ...connectedModel.trustEnvelope,
        site: { status: 'unverified', summary: 'Site unverified', detail },
        overall: 'unverified',
        signingEnabled: false,
      },
      signingDisabledReason: detail,
    }

    render(<Dashboard model={model} actions={actions()} />)

    expect(screen.getByRole('button', { name: 'Preview transfer' })).toBeDisabled()
    expect(screen.getByText(detail)).toBeInTheDocument()
  })
})
