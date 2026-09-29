import { expect, test, type Page, type Route } from '@playwright/test'
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import { adapterAbi, factoryAbi, processorAbi, treasuryAbi } from '../src/chain/abis'

const NETLIST = '0x0000000400000400000002000008000000090000090000000a0000060000000b00000b00000003000005000000070000070000000e00000d0000000f00000f0000000c00000f0000000c0000100000001100001100000012000012'
const CODE = '0x6000'
const TX_HASH = `0x${'aa'.repeat(32)}` as Hash
const BLOCK_HASH = `0x${'bb'.repeat(32)}` as Hash

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

type RpcRequest = {
  id: number
  method: string
  params?: readonly unknown[]
}

type SecondaryMode = 'matching' | 'offline' | 'mismatch'

const resultForCall = (data: Hex) => {
  const decoded = decodeFunctionData({
    abi: [...factoryAbi, ...processorAbi, ...adapterAbi, ...treasuryAbi],
    data,
  })

  switch (decoded.functionName) {
    case 'isCPU':
      return encodeFunctionResult({ abi: factoryAbi, functionName: 'isCPU', result: true })
    case 'circuitInfo':
      return encodeFunctionResult({
        abi: processorAbi,
        functionName: 'circuitInfo',
        result: [6, 2, 0, 13],
      })
    case 'netlist':
      return encodeFunctionResult({ abi: processorAbi, functionName: 'netlist', result: NETLIST })
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

const logBase = {
  address: addresses.treasury,
  blockNumber: '0x64',
  blockHash: BLOCK_HASH,
  transactionHash: TX_HASH,
  transactionIndex: '0x0',
  logIndex: '0x0',
  removed: false,
}

const logsForFilter = (filter: { topics?: readonly (Hex | readonly Hex[] | null)[] }) => {
  const topic0 = filter.topics?.[0]
  const proposalTopic = filter.topics?.[1]
  if (typeof topic0 !== 'string' || typeof proposalTopic !== 'string') return []
  const proposalId = BigInt(proposalTopic)
  const scenario = scenarios[Number(proposalId) as keyof typeof scenarios]
  if (!scenario) return []

  const transferTopic = encodeEventTopics({ abi: treasuryAbi, eventName: 'TransferExecuted' })[0]
  if (scenario.state === 1 && topic0 === transferTopic) {
    return [{
      ...logBase,
      topics: encodeEventTopics({
        abi: treasuryAbi,
        eventName: 'TransferExecuted',
        args: { proposalId, asset: proposalId === 4n ? 0 : 1, recipient: addresses.recipient },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [proposalId === 4n ? 10000000000000000n : 3000000n]),
    }]
  }

  const evaluatedTopic = encodeEventTopics({ abi: treasuryAbi, eventName: 'PolicyEvaluated' })[0]
  if (scenario.state === 2 && topic0 === evaluatedTopic) {
    return [{
      ...logBase,
      topics: encodeEventTopics({
        abi: treasuryAbi,
        eventName: 'PolicyEvaluated',
        args: { proposalId },
      }),
      data: encodeAbiParameters(
        [{ type: 'uint8' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'uint8' }],
        [scenario.inputs, scenario.outputs, scenario.decision, 0],
      ),
    }]
  }
  return []
}

const rpcResult = (payload: RpcRequest, endpoint: 'primary' | 'secondary', mode: SecondaryMode) => {
  if (payload.method === 'eth_chainId') return '0xc4'
  if (payload.method === 'eth_blockNumber') return '0x78'
  if (payload.method === 'eth_getTransactionReceipt') {
    const isFinalFixture = payload.params?.[0] === `0x${'dd'.repeat(32)}`
    return {
      transactionHash: payload.params?.[0],
      transactionIndex: '0x0',
      blockHash: BLOCK_HASH,
      blockNumber: isFinalFixture ? '0x6d' : '0x73',
      from: addresses.agent,
      to: addresses.treasury,
      cumulativeGasUsed: '0x5208',
      gasUsed: '0x5208',
      contractAddress: null,
      logs: [],
      logsBloom: `0x${'00'.repeat(256)}`,
      status: '0x1',
      effectiveGasPrice: '0x1',
      type: '0x2',
    }
  }
  if (payload.method === 'eth_getCode') {
    return endpoint === 'secondary' && mode === 'mismatch' ? '0x6001' : CODE
  }
  if (payload.method === 'eth_getLogs') {
    return logsForFilter(payload.params?.[0] as { topics?: readonly (Hex | readonly Hex[] | null)[] })
  }
  if (payload.method === 'eth_call') {
    const request = payload.params?.[0] as { data?: Hex }
    if (request.data) return resultForCall(request.data)
  }
  return '0x'
}

const mockRpc = (endpoint: 'primary' | 'secondary', mode: SecondaryMode) => async (route: Route) => {
  if (endpoint === 'secondary' && mode === 'offline') {
    await route.abort('connectionfailed')
    return
  }
  const payload = route.request().postDataJSON() as RpcRequest
  await route.fulfill({
    json: { jsonrpc: '2.0', id: payload.id, result: rpcResult(payload, endpoint, mode) },
  })
}

const installWallet = async (
  page: Page,
  code: Hex,
  observedMethods: string[],
  sendDelayMs = 0,
) => {
  await page.exposeFunction('recordWalletMethod', (method: string) => observedMethods.push(method))
  await page.addInitScript(({ walletCode, account, delay }) => {
    const host = window as typeof window & {
      recordWalletMethod: (method: string) => Promise<void>
      ethereum?: { request: (request: { method: string }) => Promise<unknown> }
    }
    host.ethereum = {
      request: async ({ method }) => {
        await host.recordWalletMethod(method)
        if (method === 'eth_chainId') return '0xc4'
        if (method === 'eth_requestAccounts') return [account]
        if (method === 'eth_getCode') return walletCode
        if (method === 'eth_call') return '0x'
        if (method === 'eth_sendTransaction') {
          await new Promise((resolve) => setTimeout(resolve, delay))
          return `0x${'dd'.repeat(32)}`
        }
        return null
      },
    }
  }, { walletCode: code, account: addresses.agent, delay: sendDelayMs })
}

const seedEvidence = async (page: Page, status: 'mined' | 'final', confirmations: number) => {
  await page.addInitScript(({ evidenceStatus, depth }) => {
    window.localStorage.setItem('circuitguard.transactions.v2', JSON.stringify([{
      hash: evidenceStatus === 'mined'
        ? `0x${'ee'.repeat(32)}`
        : `0x${'dd'.repeat(32)}`,
      label: 'Request transfer',
      status: evidenceStatus,
      submittedAt: 100,
      blockNumber: evidenceStatus === 'mined' ? '115' : '109',
      blockHash: `0x${'bb'.repeat(32)}`,
      confirmations: depth,
      requiredConfirmations: 12,
      reorgDetected: false,
    }]))
  }, { evidenceStatus: status, depth: confirmations })
}

async function openDemo(page: Page, mode: SecondaryMode = 'matching') {
  await page.route('https://rpc.xlayer.tech/**', mockRpc('primary', mode))
  await page.route('https://xlayerrpc.okx.com/**', mockRpc('secondary', mode))
  await page.goto('/')
}

async function loadProposal(page: Page, id: number) {
  await page.getByLabel('Proposal ID').fill(String(id))
  await page.getByRole('button', { name: 'Load evidence' }).click()
}

test('matching RPC identity and E2E Site attestation verify the endpoint', async ({ page }) => {
  const methods: string[] = []
  await installWallet(page, CODE, methods)
  await openDemo(page)
  await expect(page.getByRole('status', { name: 'Endpoint verification' })).toContainText('Verified')
  await page.getByRole('button', { name: 'Connect wallet' }).click()
  await expect(page.getByRole('button', { name: 'Preview transfer' })).toBeEnabled()
})

test('secondary RPC outage degrades to read-only while preserving balances', async ({ page }) => {
  await openDemo(page, 'offline')
  await expect(page.getByRole('status', { name: 'Endpoint verification' })).toContainText('Degraded')
  await expect(page.getByText('0.5 OKB')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Preview transfer' })).toBeDisabled()
})

test('immutable identity mismatch blocks and clears actionable balances', async ({ page }) => {
  await openDemo(page, 'mismatch')
  await expect(page.getByRole('status', { name: 'Endpoint verification' })).toContainText('Blocked')
  await expect(page.getByText('— OKB')).toBeVisible()
  await expect(page.getByText('0.5 OKB')).toHaveCount(0)
})

test('wallet code mismatch prevents transaction submission', async ({ page }) => {
  const methods: string[] = []
  await installWallet(page, '0x6001', methods)
  await openDemo(page)
  await page.getByRole('button', { name: 'Connect wallet' }).click()
  await page.getByPlaceholder('0x…').fill(addresses.recipient)
  await page.getByRole('button', { name: 'Preview transfer' }).click()
  await page.getByRole('button', { name: 'Confirm & request' }).click()
  await expect(page.getByRole('alert')).toContainText('code hash mismatch')
  await expect(page.getByRole('status', { name: 'Endpoint verification' })).toContainText('Blocked')
  expect(methods).not.toContain('eth_sendTransaction')
})

test('wallet transport simulates a write before transaction submission', async ({ page }) => {
  const methods: string[] = []
  await installWallet(page, CODE, methods)
  await openDemo(page)
  await page.getByRole('button', { name: 'Connect wallet' }).click()
  await page.getByPlaceholder('0x…').fill(addresses.recipient)
  await page.getByRole('button', { name: 'Preview transfer' }).click()
  await page.getByRole('button', { name: 'Confirm & request' }).click()
  await expect.poll(() => methods.includes('eth_sendTransaction')).toBe(true)

  expect(methods.indexOf('eth_call')).toBeGreaterThan(-1)
  expect(methods.indexOf('eth_call')).toBeLessThan(methods.indexOf('eth_sendTransaction'))
})

test('slow wallet confirmation keeps the signing gate closed before a hash exists', async ({ page }) => {
  test.setTimeout(15_000)
  const methods: string[] = []
  await installWallet(page, CODE, methods, 7_000)
  await openDemo(page)
  await page.getByRole('button', { name: 'Connect wallet' }).click()
  await page.getByPlaceholder('0x…').fill(addresses.recipient)
  await page.getByRole('button', { name: 'Preview transfer' }).click()
  await page.getByRole('button', { name: 'Confirm & request' }).click()

  await page.waitForTimeout(5_500)
  await expect(page.getByRole('button', { name: 'Transaction pending' })).toBeDisabled()
  expect(methods.filter((method) => method === 'eth_sendTransaction')).toHaveLength(1)
})

test('recovered receipt evidence distinguishes mined from final', async ({ page }) => {
  await seedEvidence(page, 'mined', 6)
  await openDemo(page)
  await expect(page.getByText('Mined · 6/12 confirmations')).toBeVisible()

  await page.evaluate(() => window.localStorage.clear())
  await seedEvidence(page, 'final', 12)
  await page.reload()
  await expect(page.getByText('Final · 12/12 confirmations')).toBeVisible()
})

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

test('production mode without TapeKit attestation stays unverified without wallet access', async ({ page }) => {
  const methods: string[] = []
  await installWallet(page, CODE, methods)
  await page.goto('http://127.0.0.1:4174/')
  await expect(page.getByRole('status', { name: 'Endpoint verification' })).toContainText('Unverified')
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeDisabled()
  expect(methods).toEqual([])
})
