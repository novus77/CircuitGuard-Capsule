import type { DeployedManifest } from './deployment'

const CODE_HASH = '0x07ad118d6cc8642c86c03827f276d8b791a65e5c99a3845faf186be720a1455d'

export const e2eDeployment: DeployedManifest = {
  schemaVersion: 1,
  chainId: 196,
  factory: '0x1f09daefa827f02cbb40967cc91b259763760761',
  usdt0: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
  status: 'deployed',
  processor: '0x1111111111111111111111111111111111111111',
  circuitId: '7',
  netlistHash: '0xd722aa6af62aa44c485ec471d4234803c859aec19684caa2a510bdca1675c269',
  container: '0x2222222222222222222222222222222222222222',
  adapter: '0x3333333333333333333333333333333333333333',
  treasury: '0x4444444444444444444444444444444444444444',
  merchant: '0x5555555555555555555555555555555555555555',
  deploymentBlock: 1,
  safeConfirmations: 12,
  endpointCoordinate: '196:0x2222222222222222222222222222222222222222',
  processorCodeHash: CODE_HASH,
  containerCodeHash: CODE_HASH,
  adapterCodeHash: CODE_HASH,
  treasuryCodeHash: CODE_HASH,
  site: {
    status: 'published',
    manifestHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
  transactions: [],
}
