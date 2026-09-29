#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultInput = resolve(projectRoot, 'deployments/xlayer.json')
const defaultOutput = resolve(projectRoot, 'web/src/generated/deployment.json')

const EXPECTED_CHAIN_ID = 196
const EXPECTED_FACTORY = '0x1f09daefa827f02cbb40967cc91b259763760761'
const EXPECTED_USDT0 = '0x779ded0c9e1022225f8e0630b35a9b54be713736'
const EXPECTED_NETLIST_HASH = '0xd722aa6af62aa44c485ec471d4234803c859aec19684caa2a510bdca1675c269'
const REQUIRED_ADDRESSES = ['factory', 'usdt0', 'processor', 'container', 'adapter', 'treasury', 'merchant']
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

export async function buildDeploymentManifest(inputPath = defaultInput, outputPath = defaultOutput) {
  const source = JSON.parse(await readFile(inputPath, 'utf8'))
  const manifest = validateDeployment(source)
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
