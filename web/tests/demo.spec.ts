import { expect, test, type Page, type Route } from '@playwright/test'
import { decodeFunctionData, encodeFunctionResult, type Address } from 'viem'
import { adapterAbi, treasuryAbi } from '../src/chain/abis'

const addresses = {
  processor: '0x1111111111111111111111111111111111111111',
  container: '0x2222222222222222222222222222222222222222',
  adapter: '0x3333333333333333333333333333333333333333',
  treasury: '0x4444444444444444444444444444444444444444',
  owner: '0x5555555555555555555555555555555555555555',
  agent: '0x6666666666666666666666666666666666666666',
  recipient: '0x7777777777777777777777777777777777777777',
} as const satisfies Record<string, Address>

const scenarios = {
  1: { inputs: 0b011011, outputs: 1, decision: 1, state: 1 },
  2: { inputs: 0b010001, outputs: 2, decision: 2, state: 0 },
  3: { inputs: 0b011101, outputs: 0, decision: 0, state: 2 },
  4: { inputs: 0b011011, outputs: 1, decision: 1, state: 1 },
} as const

type RpcRequest = { id: number; method: string; params?: Array<{ data?: `0x${string}` }> }

const resultForCall = (data: `0x${string}`) => {
  const decoded = decodeFunctionData({ abi: [...adapterAbi, ...treasuryAbi], data })

  switch (decoded.functionName) {
    case 'health':
      return encodeFunctionResult({
        abi: adapterAbi,
        functionName: 'health',
        result: [true, '0xd722aa6af62aa44c485ec471d4234803c859aec19684caa2a510bdca1675c269', 6, 2, 0, 13],
      })
    case 'owner':
      return encodeFunctionResult({ abi: treasuryAbi, functionName: 'owner', result: addresses.owner })
    case 'paused':
      return encodeFunctionResult({ abi: treasuryAbi, functionName: 'paused', result: false })
    case 'assetBalance': {
      const asset = Number(decoded.args[0])
      return encodeFunctionResult({
        abi: treasuryAbi,
        functionName: 'assetBalance',
        result: asset === 0 ? 500000000000000000n : 250000000n,
      })
    }
    case 'currentBudget': {
      const asset = Number(decoded.args[0])
      return encodeFunctionResult({
        abi: treasuryAbi,
        functionName: 'currentBudget',
        result: asset === 0
          ? { instantLimit: 20000000000000000n, dailyLimit: 100000000000000000n, spent: 10000000000000000n, epochDay: 1n }
          : { instantLimit: 10000000n, dailyLimit: 100000000n, spent: 3000000n, epochDay: 1n },
      })
    }
    case 'getProposal': {
      const id = Number(decoded.args[0]) as keyof typeof scenarios
      const scenario = scenarios[id]
      return encodeFunctionResult({
        abi: treasuryAbi,
        functionName: 'getProposal',
        result: {
          id: BigInt(id),
          agent: addresses.agent,
          asset: id === 4 ? 0 : 1,
          recipient: addresses.recipient,
          amount: id === 1 ? 3000000n : id === 2 ? 30000000n : id === 4 ? 10000000000000000n : 1000000n,
          memoHash: `0x${'00'.repeat(32)}`,
          createdAt: 1n,
          expiresAt: 9999999999n,
          inputs: scenario.inputs,
          outputs: scenario.outputs,
          decision: scenario.decision,
          error: 0,
          state: scenario.state,
          approvalExpiresAt: 0n,
        },
      })
    }
    case 'previewProposal': {
      const id = Number(decoded.args[0]) as keyof typeof scenarios
      const scenario = scenarios[id]
      return encodeFunctionResult({
        abi: treasuryAbi,
        functionName: 'previewProposal',
        result: [scenario.inputs, { decision: scenario.decision, outputs: scenario.outputs, error: 0 }],
      })
    }
    default:
      throw new Error(`Unexpected contract read: ${decoded.functionName}`)
  }
}

async function mockRpc(route: Route) {
  const payload = route.request().postDataJSON() as RpcRequest
  const result = payload.method === 'eth_chainId'
    ? '0xc4'
    : payload.method === 'eth_call' && payload.params?.[0]?.data
      ? resultForCall(payload.params[0].data)
      : '0x'
  await route.fulfill({ json: { jsonrpc: '2.0', id: payload.id, result } })
}

async function openDemo(page: Page) {
  await page.addInitScript(({ deployment }) => {
    Object.assign(window, { __CIRCUITGUARD_E2E_DEPLOYMENT__: deployment })
  }, {
    deployment: {
      status: 'deployed',
      chainId: 196,
      processor: addresses.processor,
      circuitId: '7',
      netlistHash: '0xd722aa6af62aa44c485ec471d4234803c859aec19684caa2a510bdca1675c269',
      container: addresses.container,
      adapter: addresses.adapter,
      treasury: addresses.treasury,
    },
  })
  await page.route('https://rpc.xlayer.tech/**', mockRpc)
  await page.goto('/')
  await expect(page.getByText('0.5 OKB')).toBeVisible()
}

async function loadProposal(page: Page, id: number) {
  await page.getByLabel('Proposal ID').fill(String(id))
  await page.getByRole('button', { name: 'Load evidence' }).click()
}

test('trusted 3 USDT0 produces ALLOW', async ({ page }) => {
  await openDemo(page)
  await loadProposal(page, 1)
  await expect(page.getByTestId('decision')).toHaveAttribute('data-decision', 'ALLOW')
  await expect(page.getByText('250 USDT0')).toBeVisible()
})

test('unknown 30 USDT0 produces REVIEW with approval controls', async ({ page }) => {
  await openDemo(page)
  await loadProposal(page, 2)
  await expect(page.getByTestId('decision')).toHaveAttribute('data-decision', 'REVIEW')
  await expect(page.getByRole('button', { name: 'Approve 10 minutes' })).toBeVisible()
})

test('blocked recipient produces DENY without execute control', async ({ page }) => {
  await openDemo(page)
  await loadProposal(page, 3)
  await expect(page.getByTestId('decision')).toHaveAttribute('data-decision', 'DENY')
  await expect(page.getByRole('button', { name: 'Execute approved' })).toHaveCount(0)
})

test('trusted 0.01 OKB produces ALLOW with independent budget', async ({ page }) => {
  await openDemo(page)
  await loadProposal(page, 4)
  await expect(page.getByTestId('decision')).toHaveAttribute('data-decision', 'ALLOW')
  await expect(page.getByText('0.5 OKB')).toBeVisible()
  await expect(page.getByText('0.02')).toBeVisible()
})
