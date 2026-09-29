#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultInput = resolve(projectRoot, 'deployments/xlayer.json')
const defaultOutput = resolve(projectRoot, 'web/src/generated/deployment.json')

const EXPECTED_CHAIN_ID = 196
const EXPECTED_FACTORY = '0x1f09daefa827f02cbb40967cc91b259763760761'
const EXPECTED_USDT0 = '0x779ded0c9e1022225f8e0630b35a9b54be713736'
const EXPECTED_NETLIST_HASH = '0xd722aa6af62aa44c485ec471d4234803c859aec19684caa2a510bdca1675c269'
const XLAYER_RPC_URLS = ['https://rpc.xlayer.tech', 'https://xlayerrpc.okx.com']
const REQUIRED_ADDRESSES = ['factory', 'usdt0', 'processor', 'container', 'adapter', 'treasury', 'merchant']
const REQUIRED_CODE_HASHES = [
  ['processor', 'processorCodeHash'],
  ['container', 'containerCodeHash'],
  ['adapter', 'adapterCodeHash'],
  ['treasury', 'treasuryCodeHash'],
]
const REQUIRED_TRANSACTIONS = [
  'createProcessor',
  'mintMaterials',
  'tapeoutPolicy',
  'deployAdapter',
  'deployTreasury',
  'deployMerchant',
  'trustMerchant',
]

const addressPattern = /^0x[0-9a-fA-F]{40}$/
const hashPattern = /^0x[0-9a-fA-F]{64}$/

const fail = (message) => {
  throw new Error(`Invalid X Layer deployment: ${message}`)
}

export function validateDeployment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected an object')
  if (value.schemaVersion !== 1) fail('schemaVersion must be 1')
  if (value.chainId !== EXPECTED_CHAIN_ID) fail(`chainId must be ${EXPECTED_CHAIN_ID}`)
  if (value.status !== 'deployed') fail('status must be deployed')

  for (const field of REQUIRED_ADDRESSES) {
    if (typeof value[field] !== 'string' || !addressPattern.test(value[field])) {
      fail(`${field} must be a 20-byte address`)
    }
  }
  if (value.factory.toLowerCase() !== EXPECTED_FACTORY) fail('Factory address mismatch')
  if (value.usdt0.toLowerCase() !== EXPECTED_USDT0) fail('USDT0 address mismatch')
  if (typeof value.netlistHash !== 'string' || value.netlistHash.toLowerCase() !== EXPECTED_NETLIST_HASH) {
    fail('canonical netlist hash mismatch')
  }
  if (!/^\d+$/.test(String(value.circuitId)) || BigInt(value.circuitId) < 0n) {
    fail('circuitId must be an unsigned integer')
  }
  if (!Number.isInteger(value.deploymentBlock) || value.deploymentBlock <= 0) {
    fail('deploymentBlock must be a positive integer')
  }
  if (
    !Number.isInteger(value.safeConfirmations)
    || value.safeConfirmations < 1
    || value.safeConfirmations > 256
  ) {
    fail('safeConfirmations must be an integer from 1 through 256')
  }
  if (value.endpointCoordinate !== `${EXPECTED_CHAIN_ID}:${value.container}`) {
    fail('endpointCoordinate must match the X Layer chain and checksummed Container')
  }
  for (const [, hashField] of REQUIRED_CODE_HASHES) {
    if (typeof value[hashField] !== 'string' || !hashPattern.test(value[hashField])) {
      fail(`${hashField} must be a 32-byte hash`)
    }
  }
  if (!value.site || typeof value.site !== 'object' || Array.isArray(value.site)) {
    fail('site must be an object')
  }
  if (value.site.status === 'published') {
    if (typeof value.site.manifestHash !== 'string' || !hashPattern.test(value.site.manifestHash)) {
      fail('published site manifestHash must be a 32-byte hash')
    }
  } else if (value.site.status === 'unpublished') {
    if (Object.hasOwn(value.site, 'manifestHash')) {
      fail('unpublished site must not contain manifestHash')
    }
  } else {
    fail('site status must be unpublished or published')
  }
  if (!Array.isArray(value.transactions)) fail('transactions must be an array')

  const transactionKinds = new Set()
  for (const transaction of value.transactions) {
    if (!transaction || typeof transaction !== 'object') fail('transaction entries must be objects')
    if (typeof transaction.kind !== 'string' || transactionKinds.has(transaction.kind)) {
      fail('transaction kinds must be unique strings')
    }
    if (typeof transaction.hash !== 'string' || !hashPattern.test(transaction.hash)) {
      fail(`${transaction.kind} transaction hash must be 32 bytes`)
    }
    transactionKinds.add(transaction.kind)
  }
  for (const kind of REQUIRED_TRANSACTIONS) {
    if (!transactionKinds.has(kind)) fail(`missing ${kind} transaction`)
  }

  return value
}

const execFileAsync = promisify(execFile)
const defaultRunner = async (command, args) => execFileAsync(command, args, { encoding: 'utf8' })

const cast = async (runner, args) => {
  const result = await runner('cast', args)
  return result.stdout.trim()
}

const expectEqual = (actual, expected, label, rpcUrl) => {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label} mismatch from ${new URL(rpcUrl).hostname}`)
  }
}

export async function verifyDeploymentEvidence(manifest, runner = defaultRunner) {
  for (const rpcUrl of XLAYER_RPC_URLS) {
    const chainId = await cast(runner, ['chain-id', '--rpc-url', rpcUrl])
    if (Number(chainId) !== EXPECTED_CHAIN_ID) {
      throw new Error(`chainId mismatch from ${new URL(rpcUrl).hostname}`)
    }

    const registered = await cast(runner, [
      'call',
      manifest.factory,
      'isCPU(address)(bool)',
      manifest.processor,
      '--rpc-url',
      rpcUrl,
    ])
    if (registered.toLowerCase() !== 'true') {
      throw new Error(`Factory registration mismatch from ${new URL(rpcUrl).hostname}`)
    }

    const metadata = await cast(runner, [
      'call',
      manifest.processor,
      'circuitInfo(uint256)(uint32,uint32,uint32,uint32)',
      manifest.circuitId,
      '--rpc-url',
      rpcUrl,
    ])
    const values = metadata.match(/\d+/g)?.map(Number)
    if (!values || values.length !== 4 || values.join(',') !== '6,2,0,13') {
      throw new Error(`Circuit metadata mismatch from ${new URL(rpcUrl).hostname}`)
    }

    const netlist = await cast(runner, [
      'call',
      manifest.processor,
      'netlist(uint256)(bytes)',
      manifest.circuitId,
      '--rpc-url',
      rpcUrl,
    ])
    const netlistHash = await cast(runner, ['keccak', netlist])
    expectEqual(netlistHash, manifest.netlistHash, 'netlistHash', rpcUrl)

    for (const [addressField, hashField] of REQUIRED_CODE_HASHES) {
      const code = await cast(runner, ['code', manifest[addressField], '--rpc-url', rpcUrl])
      if (!code || code === '0x') {
        throw new Error(`${addressField} runtime code is missing from ${new URL(rpcUrl).hostname}`)
      }
      const codeHash = await cast(runner, ['keccak', code])
      expectEqual(codeHash, manifest[hashField], hashField, rpcUrl)
    }
  }
}

export async function buildDeploymentManifest(
  inputPath = defaultInput,
  outputPath = defaultOutput,
  { runner = defaultRunner } = {},
) {
  const source = JSON.parse(await readFile(inputPath, 'utf8'))
  const manifest = validateDeployment(source)
  await verifyDeploymentEvidence(manifest, runner)
  const temporaryPath = `${outputPath}.tmp`
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, outputPath)
  return outputPath
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputPath = process.argv[2] ? resolve(process.argv[2]) : defaultInput
  const outputPath = process.argv[3] ? resolve(process.argv[3]) : defaultOutput
  buildDeploymentManifest(inputPath, outputPath)
    .then((writtenPath) => console.log(`Wrote ${writtenPath}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
