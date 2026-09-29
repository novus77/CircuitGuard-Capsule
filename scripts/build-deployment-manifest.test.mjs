import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  buildDeploymentManifest,
  validateDeployment,
  verifyDeploymentEvidence,
} from './build-deployment-manifest.mjs'

const NETLIST_HASH = '0xd722aa6af62aa44c485ec471d4234803c859aec19684caa2a510bdca1675c269'
const HASHES = {
  processorCodeHash: `0x${'11'.repeat(32)}`,
  containerCodeHash: `0x${'22'.repeat(32)}`,
  adapterCodeHash: `0x${'33'.repeat(32)}`,
  treasuryCodeHash: `0x${'44'.repeat(32)}`,
}
const ADDRESSES = {
  factory: '0x1f09daefa827f02cbb40967cc91b259763760761',
  usdt0: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
  processor: '0x2222222222222222222222222222222222222222',
  container: '0x3333333333333333333333333333333333333333',
  adapter: '0x4444444444444444444444444444444444444444',
  treasury: '0x5555555555555555555555555555555555555555',
  merchant: '0x6666666666666666666666666666666666666666',
}
const TRANSACTION_KINDS = [
  'createProcessor',
  'mintMaterials',
  'tapeoutPolicy',
  'deployAdapter',
  'deployTreasury',
  'deployMerchant',
  'trustMerchant',
]

const makeValidDeployment = (overrides = {}) => ({
  schemaVersion: 1,
  chainId: 196,
  status: 'deployed',
  ...ADDRESSES,
  circuitId: '7',
  netlistHash: NETLIST_HASH,
  deploymentBlock: 1,
  safeConfirmations: 12,
  endpointCoordinate: `196:${ADDRESSES.container}`,
  ...HASHES,
  site: { status: 'unpublished' },
  transactions: TRANSACTION_KINDS.map((kind, index) => ({
    kind,
    hash: `0x${String(index + 1).repeat(64)}`,
  })),
  ...overrides,
})

test('validates unpublished and published Trust Envelope manifests', () => {
  const unpublished = makeValidDeployment()
  const published = makeValidDeployment({
    site: { status: 'published', manifestHash: `0x${'aa'.repeat(32)}` },
  })

  assert.equal(validateDeployment(unpublished), unpublished)
  assert.equal(validateDeployment(published), published)
})

test('rejects missing or malformed Trust Envelope evidence', () => {
  const valid = makeValidDeployment()

  assert.throws(() => validateDeployment({ ...valid, deploymentBlock: 0 }), /deploymentBlock/)
  assert.throws(() => validateDeployment({ ...valid, safeConfirmations: 0 }), /safeConfirmations/)
  assert.throws(
    () => validateDeployment({ ...valid, endpointCoordinate: '196:wrong' }),
    /endpointCoordinate/,
  )
  assert.throws(() => validateDeployment({ ...valid, adapterCodeHash: '0x12' }), /adapterCodeHash/)
  assert.throws(
    () => validateDeployment({ ...valid, site: { status: 'published' } }),
    /manifestHash/,
  )
  assert.throws(
    () => validateDeployment({ ...valid, site: { status: 'unpublished', manifestHash: `0x${'aa'.repeat(32)}` } }),
    /manifestHash/,
  )
})

const createSuccessfulRunner = () => {
  const calls = []
  const codeByAddress = new Map([
    [ADDRESSES.processor, '0x6001'],
    [ADDRESSES.container, '0x6002'],
    [ADDRESSES.adapter, '0x6003'],
    [ADDRESSES.treasury, '0x6004'],
  ])
  const hashByBytes = new Map([
    ['0xdeadbeef', NETLIST_HASH],
    ['0x6001', HASHES.processorCodeHash],
    ['0x6002', HASHES.containerCodeHash],
    ['0x6003', HASHES.adapterCodeHash],
    ['0x6004', HASHES.treasuryCodeHash],
  ])
  const runner = async (command, args) => {
    calls.push([command, ...args])
    if (args[0] === 'chain-id') return { stdout: '196\n' }
    if (args[0] === 'call' && args[2].startsWith('isCPU')) return { stdout: 'true\n' }
    if (args[0] === 'call' && args[2].startsWith('circuitInfo')) {
      return { stdout: '6\n2\n0\n13\n' }
    }
    if (args[0] === 'call' && args[2].startsWith('netlist')) return { stdout: '0xdeadbeef\n' }
    if (args[0] === 'code') return { stdout: `${codeByAddress.get(args[1])}\n` }
    if (args[0] === 'keccak') return { stdout: `${hashByBytes.get(args[1])}\n` }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
  }
  return { calls, runner }
}

test('verifies immutable evidence through both official RPC endpoints', async () => {
  const { calls, runner } = createSuccessfulRunner()

  await verifyDeploymentEvidence(makeValidDeployment(), runner)

  assert(calls.some((args) => args.includes('https://rpc.xlayer.tech')))
  assert(calls.some((args) => args.includes('https://xlayerrpc.okx.com')))
})

test('leaves the previous generated manifest untouched when evidence verification fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'circuitguard-manifest-'))
  const input = join(directory, 'input.json')
  const output = join(directory, 'output.json')
  const previous = '{"previous":true}\n'
  await writeFile(input, JSON.stringify(makeValidDeployment()), 'utf8')
  await writeFile(output, previous, 'utf8')

  await assert.rejects(
    buildDeploymentManifest(input, output, {
      runner: async () => {
        throw new Error('secondary unavailable')
      },
    }),
    /secondary unavailable/,
  )
  assert.equal(await readFile(output, 'utf8'), previous)
})
