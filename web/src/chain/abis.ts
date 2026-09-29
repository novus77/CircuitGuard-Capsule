export const treasuryAbi = [
  {
    type: 'function',
    name: 'paused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'agents',
    stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'assetBalance',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'uint8' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'currentBudget',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'uint8' }],
    outputs: [
      {
        name: 'budget',
        type: 'tuple',
        components: [
          { name: 'instantLimit', type: 'uint128' },
          { name: 'dailyLimit', type: 'uint128' },
          { name: 'spent', type: 'uint128' },
          { name: 'epochDay', type: 'uint64' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getProposal',
    stateMutability: 'view',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'agent', type: 'address' },
          { name: 'asset', type: 'uint8' },
          { name: 'recipient', type: 'address' },
          { name: 'amount', type: 'uint128' },
          { name: 'memoHash', type: 'bytes32' },
          { name: 'createdAt', type: 'uint64' },
          { name: 'expiresAt', type: 'uint64' },
          { name: 'inputs', type: 'uint8' },
          { name: 'outputs', type: 'uint8' },
          { name: 'decision', type: 'uint8' },
          { name: 'error', type: 'uint8' },
          { name: 'state', type: 'uint8' },
          { name: 'approvalExpiresAt', type: 'uint64' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'previewProposal',
    stateMutability: 'view',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [
      { name: 'inputs', type: 'uint8' },
      {
        name: 'evaluation',
        type: 'tuple',
        components: [
          { name: 'decision', type: 'uint8' },
          { name: 'outputs', type: 'uint8' },
          { name: 'error', type: 'uint8' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'requestTransfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'uint8' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint128' },
      { name: 'memoHash', type: 'bytes32' },
    ],
    outputs: [{ name: 'proposalId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approveProposal',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'proposalId', type: 'uint256' },
      { name: 'approvalDuration', type: 'uint32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'executeApproved',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelProposal',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'event',
    name: 'TransferExecuted',
    anonymous: false,
    inputs: [
      { name: 'proposalId', type: 'uint256', indexed: true },
      { name: 'asset', type: 'uint8', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const

export const adapterAbi = [
  {
    type: 'function',
    name: 'health',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'healthy', type: 'bool' },
      { name: 'currentNetlistHash', type: 'bytes32' },
      { name: 'nIn', type: 'uint32' },
      { name: 'nOut', type: 'uint32' },
      { name: 'nState', type: 'uint32' },
      { name: 'gateCount', type: 'uint32' },
    ],
  },
] as const

export const factoryAbi = [
  {
    type: 'function',
    name: 'isCPU',
    stateMutability: 'view',
    inputs: [{ name: 'processor', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

export const processorAbi = [
  {
    type: 'function',
    name: 'circuitInfo',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'nIn', type: 'uint32' },
      { name: 'nOut', type: 'uint32' },
      { name: 'nState', type: 'uint32' },
      { name: 'gateCount', type: 'uint32' },
    ],
  },
  {
    type: 'function',
    name: 'netlist',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
] as const

export const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const
