# CircuitGuard Trust Envelope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-closed Trust Envelope that binds the TapeKit Site, TapeOut policy identity, contract bytecode, wallet preflight, transaction finality, and selected Proposal evidence without changing Solidity bytecode.

**Architecture:** Pure domain modules classify verification and finality, while network adapters read immutable identity from two official X Layer RPC hosts and dynamic state from the primary host. `useCircuitGuard` orchestrates these modules and exposes one derived signing gate; Preact components only render the resulting state. Production Site attestation defaults to unverified until Task 14 supplies a trustworthy TapeKit-controlled signal.

**Tech Stack:** Preact, TypeScript 6, viem, Vitest, Testing Library, Playwright, Node.js 20+, X Layer chain 196.

---

## Locked file structure

```text
scripts/
├── build-deployment-manifest.mjs
└── build-deployment-manifest.test.mjs
web/src/
├── chain/
│   ├── abis.ts
│   ├── client.ts
│   ├── evidence.ts
│   ├── finality.ts
│   └── quorum.ts
├── components/
│   ├── EvidenceTimeline.tsx
│   ├── TrustEnvelopePanel.tsx
│   └── VerificationBar.tsx
├── config/
│   ├── deployment.ts
│   └── xlayer.ts
├── domain/
│   ├── endpoint.ts
│   └── trustEnvelope.ts
├── hooks/useCircuitGuard.ts
├── site/siteAttestation.ts
└── state/transactionJournal.ts
web/test/
├── endpoint.test.ts
├── evidence.test.ts
├── finality.test.ts
├── quorum.test.ts
├── siteAttestation.test.ts
├── transactionJournal.test.ts
└── trustEnvelope.test.ts
web/tests/demo.spec.ts
```

## Task 1: Implement endpoint and Trust Envelope domain rules

**Files:**
- Create: `web/src/domain/endpoint.ts`
- Create: `web/src/domain/trustEnvelope.ts`
- Create: `web/test/endpoint.test.ts`
- Create: `web/test/trustEnvelope.test.ts`

- [x] **Step 1: Write failing endpoint and classification tests**

Cover checksum normalization, invalid chain/container input, classification priority, and the shared signing gate:

```typescript
const CONTAINER = '0x2222222222222222222222222222222222222222'
const verified = { status: 'verified', summary: 'Verified' } as const
const unverified = { status: 'unverified', summary: 'Unverified' } as const
const degraded = { status: 'degraded', summary: 'Degraded' } as const
const blocked = { status: 'blocked', summary: 'Blocked' } as const

expect(formatEndpointCoordinate(196, CONTAINER)).toBe(`196:${getAddress(CONTAINER)}`)
expect(() => formatEndpointCoordinate(0, CONTAINER)).toThrow('positive integer')
expect(classifyOverall({ site: verified, policy: verified, execution: verified })).toBe('verified')
expect(classifyOverall({ site: unverified, policy: degraded, execution: verified })).toBe('unverified')
expect(classifyOverall({ site: verified, policy: blocked, execution: degraded })).toBe('blocked')
expect(canSign({ overall: 'verified', walletReady: true, modelReady: true, unresolved: false })).toBe(true)
expect(canSign({ overall: 'verified', walletReady: true, modelReady: true, unresolved: true })).toBe(false)
```

- [x] **Step 2: Run the focused tests and verify failure**

Run:

```bash
cd web && npm test -- --run endpoint.test.ts trustEnvelope.test.ts
```

Expected: FAIL because the domain modules do not exist.

- [x] **Step 3: Implement pure domain types and rules**

`endpoint.ts` exports `formatEndpointCoordinate(chainId, container)`. `trustEnvelope.ts` exports:

```typescript
export type VerificationStatus = 'loading' | 'verified' | 'unverified' | 'degraded' | 'blocked'
export type VerificationLayer = {
  status: VerificationStatus
  summary: string
  detail?: string
  verifiedAtBlock?: bigint
}
export type TrustEnvelope = {
  coordinate: string
  site: VerificationLayer
  policy: VerificationLayer
  execution: VerificationLayer
  overall: VerificationStatus
  signingEnabled: boolean
}

export function classifyOverall(layers: Pick<TrustEnvelope, 'site' | 'policy' | 'execution'>) {
  const statuses = [layers.site.status, layers.policy.status, layers.execution.status]
  if (statuses.includes('blocked')) return 'blocked'
  if (statuses.includes('unverified')) return 'unverified'
  if (statuses.includes('degraded')) return 'degraded'
  if (statuses.includes('loading')) return 'loading'
  return 'verified'
}
```

`canSign` returns true only for an all-verified envelope, ready X Layer wallet, ready dynamic model, and no unresolved transaction.

```typescript
export function canSign(input: {
  overall: VerificationStatus
  walletReady: boolean
  modelReady: boolean
  unresolved: boolean
}): boolean {
  return input.overall === 'verified' && input.walletReady && input.modelReady && !input.unresolved
}
```

- [x] **Step 4: Run focused tests**

Expected: both test files PASS.

- [x] **Step 5: Commit**

```bash
git add web/src/domain/endpoint.ts web/src/domain/trustEnvelope.ts web/test/endpoint.test.ts web/test/trustEnvelope.test.ts
git commit -m "feat: define CircuitGuard trust envelope"
```

## Task 2: Centralize deployment and official dual-RPC configuration

**Files:**
- Create: `web/src/config/deployment.ts`
- Create: `web/src/config/xlayer.ts`
- Modify: `web/src/chain/client.ts`
- Modify: `web/src/hooks/useCircuitGuard.ts`
- Create: `web/test/deployment.test.ts`

- [x] **Step 1: Write failing configuration tests**

Assert that production RPC hosts are distinct, both clients target chain 196, a non-deployed manifest remains valid, and deployed-only access rejects incomplete evidence:

```typescript
expect(new URL(XLAYER_PRIMARY_RPC_URL).hostname).not.toBe(new URL(XLAYER_SECONDARY_RPC_URL).hostname)
expect(xLayer.id).toBe(196)
expect(isDeployedManifest({ schemaVersion: 1, chainId: 196, status: 'not-deployed', transactions: [] })).toBe(false)
expect(() => requireDeployedManifest({
  schemaVersion: 1,
  chainId: 196,
  status: 'deployed',
  transactions: [],
})).toThrow('deploymentBlock')
```

- [x] **Step 2: Run the test and verify failure**

Run: `cd web && npm test -- --run deployment.test.ts`

Expected: FAIL because configuration modules do not exist.

- [x] **Step 3: Implement configuration modules**

Use the two official mainnet endpoints documented by X Layer:

```typescript
export const XLAYER_PRIMARY_RPC_URL = 'https://rpc.xlayer.tech'
export const XLAYER_SECONDARY_RPC_URL = 'https://xlayerrpc.okx.com'
```

Reference: `https://web3.okx.com/onchainos/dev-docs/xlayer/developer/rpc-endpoints/rpc-endpoints`.

`deployment.ts` owns `DeploymentManifest`, `DeployedManifest`, `isDeployedManifest`, `requireDeployedManifest`, the canonical netlist hash, and environment selection. A deployed manifest permits `site.status = 'unpublished'`; only `site.status = 'published'` requires `manifestHash`. The E2E fixture is selected only when `import.meta.env.MODE === 'e2e'`; a production build must tree-shake its marker string.

- [x] **Step 4: Refactor clients without changing behavior**

`client.ts` exports `primaryClient`, `secondaryClient`, and `xLayer`. Replace existing `publicClient` imports with `primaryClient`. Preserve the current wallet client and receipt behavior until Task 5.

- [x] **Step 5: Run tests and build**

```bash
cd web && npm test -- --run
cd web && npm run build
```

Expected: all current tests PASS and the production build contains neither the E2E manifest marker nor fake deployment addresses.

- [x] **Step 6: Commit**

```bash
git add web/src/config web/src/chain/client.ts web/src/hooks/useCircuitGuard.ts web/test/deployment.test.ts
git commit -m "refactor: centralize X Layer deployment configuration"
```

## Task 3: Read and compare immutable identity through two RPC clients

**Files:**
- Modify: `web/src/chain/abis.ts`
- Create: `web/src/chain/quorum.ts`
- Create: `web/test/quorum.test.ts`

- [ ] **Step 1: Write failing snapshot comparison tests**

Test matching snapshots, primary failure, secondary failure, chain mismatch, missing bytecode, manifest mismatch, and deterministic first-conflict reporting:

```typescript
const HASH_A = `0x${'11'.repeat(32)}` as Hash
const HASH_B = `0x${'22'.repeat(32)}` as Hash
const okSnapshot = makeIdentitySnapshot({ treasuryCodeHash: HASH_A })
const expected = makeDeployedManifest({ treasuryCodeHash: HASH_A })

expect(compareIdentitySnapshots(expected, okSnapshot, okSnapshot)).toMatchObject({ status: 'verified' })
expect(compareIdentitySnapshots(expected, okSnapshot, undefined)).toMatchObject({ status: 'degraded' })
expect(compareIdentitySnapshots(expected, okSnapshot, { ...okSnapshot, treasuryCodeHash: HASH_B })).toEqual({
  status: 'blocked',
  summary: 'Identity mismatch',
  detail: 'treasuryCodeHash differs between RPC endpoints',
})
```

- [ ] **Step 2: Run and verify failure**

Run: `cd web && npm test -- --run quorum.test.ts`

Expected: FAIL because `quorum.ts` does not exist.

- [ ] **Step 3: Extend minimal read ABIs**

Add Factory `isCPU(address)`, Processor `circuitInfo(uint256)` and `netlist(uint256)`, and reuse Adapter `health()`. Do not add write methods.

- [ ] **Step 4: Implement the reader and pure comparator**

`readIdentitySnapshot(client, manifest)` performs:

```typescript
const [chainId, registered, metadata, netlist, processorCode, containerCode, adapterCode, treasuryCode] =
  await Promise.all([
    client.getChainId(),
    client.readContract({ address: manifest.factory, abi: factoryAbi, functionName: 'isCPU', args: [manifest.processor] }),
    client.readContract({ address: manifest.processor, abi: processorAbi, functionName: 'circuitInfo', args: [BigInt(manifest.circuitId)] }),
    client.readContract({ address: manifest.processor, abi: processorAbi, functionName: 'netlist', args: [BigInt(manifest.circuitId)] }),
    client.getCode({ address: manifest.processor }),
    client.getCode({ address: manifest.container }),
    client.getCode({ address: manifest.adapter }),
    client.getCode({ address: manifest.treasury }),
  ])
```

Reject chain IDs other than 196 and empty code. Hash bytecode and netlist with `keccak256`. `verifyIdentityQuorum` catches each endpoint independently and passes optional snapshots to the pure comparator.

- [ ] **Step 5: Run tests and TypeScript build**

Expected: quorum tests and `npm run build` PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/chain/abis.ts web/src/chain/quorum.ts web/test/quorum.test.ts
git commit -m "feat: verify deployment identity across X Layer RPCs"
```

## Task 4: Add strict Site attestation and the shared signing gate

**Files:**
- Create: `web/src/site/siteAttestation.ts`
- Create: `web/test/siteAttestation.test.ts`
- Modify: `web/src/config/deployment.ts`

- [ ] **Step 1: Write failing Site-attestation tests**

```typescript
const expected = makeDeployedManifest()

expect(await noSiteAttestation.read(expected)).toMatchObject({ status: 'unverified' })
expect(await createE2ESiteAttestation('e2e').read(expected)).toMatchObject({ status: 'verified' })
expect(() => createE2ESiteAttestation('production')).toThrow('test-only')
```

Also build the production bundle and assert that `CIRCUITGUARD_E2E_SITE_VERIFIED` is absent from `dist`.

- [ ] **Step 2: Run and verify failure**

Run: `cd web && npm test -- --run siteAttestation.test.ts`

Expected: FAIL because the attestation boundary does not exist.

- [ ] **Step 3: Implement the boundary**

```typescript
export type SiteAttestationSource = {
  read(expected: Pick<DeployedManifest, 'container' | 'site'>): Promise<VerificationLayer>
}

export const noSiteAttestation: SiteAttestationSource = {
  async read() {
    return {
      status: 'unverified',
      summary: 'Site origin is not externally attested',
      detail: 'Open this deployment with a verified TapeKit client to enable signing.',
    }
  },
}
```

The E2E implementation is behind `import.meta.env.MODE === 'e2e'`. Do not inspect hostname, query parameters, or mutable globals.

- [ ] **Step 4: Run tests and artifact scan**

```bash
cd web && npm test -- --run siteAttestation.test.ts
cd web && npm run build
rg -n 'CIRCUITGUARD_E2E_SITE_VERIFIED' web/dist
```

Expected: tests PASS and `rg` returns no matches.

- [ ] **Step 5: Commit**

```bash
git add web/src/site web/src/config/deployment.ts web/test/siteAttestation.test.ts
git commit -m "feat: add strict TapeKit attestation boundary"
```

## Task 5: Upgrade the transaction journal and finality tracker

**Files:**
- Modify: `web/src/state/transactionJournal.ts`
- Modify: `web/test/transactionJournal.test.ts`
- Create: `web/src/chain/finality.ts`
- Create: `web/test/finality.test.ts`
- Modify: `web/src/chain/client.ts`

- [ ] **Step 1: Write failing journal and finality tests**

Cover migration and every state transition:

```typescript
const submitted = makeEvidence({ status: 'submitted' })
const minedAt100 = makeEvidence({ status: 'mined', blockNumber: 100n, blockHash: HASH_A })
const successReceiptAt100 = makeReceipt({ status: 'success', blockNumber: 100n, blockHash: HASH_A })
const revertedReceipt = makeReceipt({ status: 'reverted', blockNumber: 100n, blockHash: HASH_A })

expect(deriveFinality(submitted, null, 100n, 12)).toMatchObject({ status: 'submitted' })
expect(deriveFinality(submitted, successReceiptAt100, 105n, 12)).toMatchObject({ status: 'mined', confirmations: 6 })
expect(deriveFinality(submitted, successReceiptAt100, 111n, 12)).toMatchObject({ status: 'final', confirmations: 12 })
expect(deriveFinality(minedAt100, null, 106n, 12)).toMatchObject({ status: 'submitted', reorgDetected: true })
expect(deriveFinality(submitted, revertedReceipt, 100n, 12)).toMatchObject({ status: 'reverted' })
```

Persisted V1 `pending` becomes V2 `submitted`; V1 `confirmed` becomes V2 `final`.

- [ ] **Step 2: Run and verify failure**

Run: `cd web && npm test -- --run transactionJournal.test.ts finality.test.ts`

Expected: FAIL on missing statuses and finality functions.

- [ ] **Step 3: Implement V2 journal entries**

Use storage key `circuitguard.transactions.v2`, read V2 first, and migrate valid V1 entries once. `unresolved()` returns `submitted` or `mined`. `update(evidence)` replaces the matching entry while preserving a maximum of 30 entries.

- [ ] **Step 4: Implement bounded finality polling**

`waitForJournaledFinality(client, journal, hash, requiredConfirmations, timeoutMs)` repeatedly reads receipt and latest block, updates the journal on each state change, and exits on `final`, `reverted`, or timeout. It never resubmits. Poll interval remains bounded and injectable for tests.

- [ ] **Step 5: Run focused and existing tests**

Expected: journal, finality, client, and all existing frontend tests PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/state/transactionJournal.ts web/src/chain/finality.ts web/src/chain/client.ts web/test/transactionJournal.test.ts web/test/finality.test.ts
git commit -m "feat: track mined and final transaction evidence"
```

## Task 6: Reconstruct selected Proposal evidence from Treasury logs

**Files:**
- Modify: `web/src/chain/abis.ts`
- Create: `web/src/chain/evidence.ts`
- Create: `web/test/evidence.test.ts`

- [ ] **Step 1: Write failing event timeline tests**

Create decoded log fixtures out of order and with a duplicate. Assert ordering, deduplication, confirmation counts, final labels, and state conflict:

```typescript
const logs = makeProposalLifecycleLogs({ proposalId: 7n, terminalState: 'Executed' })
const executedLogs = logs

expect(buildProposalTimeline(logs, 120n, 12, 'Executed').map(({ kind }) => kind)).toEqual([
  'created', 'evaluated', 'approved', 'evaluated', 'executed',
])
expect(buildProposalTimeline(logs, 120n, 12, 'Executed').at(-1)).toMatchObject({ final: true })
expect(() => buildProposalTimeline(executedLogs, 120n, 12, 'PendingReview')).toThrow('Proposal state conflicts')
```

- [ ] **Step 2: Run and verify failure**

Run: `cd web && npm test -- --run evidence.test.ts`

Expected: FAIL because evidence functions are missing.

- [ ] **Step 3: Add the six Treasury event ABIs**

Add exact indexed fields for `ProposalCreated`, `PolicyEvaluated`, `ProposalApproved`, `ProposalCancelled`, `ProposalExpired`, and `TransferExecuted` from `CircuitGuardTreasury.sol`.

- [ ] **Step 4: Implement event loading and pure timeline assembly**

`loadProposalEvidence(client, manifest, proposalId)` scans inclusive 10,000-block windows from `deploymentBlock` to latest, queries each event with indexed `proposalId`, deduplicates `(transactionHash, logIndex)`, and calls `buildProposalTimeline`. Reject negative or zero proposal IDs and manifest blocks above the current head.

- [ ] **Step 5: Run focused tests and build**

Expected: evidence tests and TypeScript build PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/chain/abis.ts web/src/chain/evidence.ts web/test/evidence.test.ts
git commit -m "feat: reconstruct proposal evidence from chain logs"
```

## Task 7: Integrate verification, finality, and evidence into the read model

**Files:**
- Modify: `web/src/hooks/useCircuitGuard.ts`
- Modify: `web/src/app/App.tsx`
- Modify: `web/test/app.test.tsx`

- [ ] **Step 1: Extend failing component-model tests**

Add `trustEnvelope`, `signingDisabledReason`, `transactionEvidence`, and `proposalEvidence` to the fixture. Assert:

```typescript
expect(screen.getByText('196:0x2222222222222222222222222222222222222222')).toBeInTheDocument()
expect(screen.getByText('Endpoint verified')).toBeInTheDocument()
expect(screen.getByRole('button', { name: 'Preview transfer' })).toBeDisabled()
expect(screen.getByText('Open this deployment with a verified TapeKit client to enable signing.')).toBeInTheDocument()
```

Use separate verified and unverified fixtures so the existing wallet-flow tests remain explicit.

- [ ] **Step 2: Run and verify failure**

Run: `cd web && npm test -- --run app.test.tsx`

Expected: FAIL because the model and components do not expose Trust Envelope data.

- [ ] **Step 3: Refactor hook orchestration**

On mount, `useCircuitGuard`:

1. validates deployment;
2. resolves Site attestation;
3. verifies identity quorum;
4. reads dynamic state only when no layer is blocked;
5. derives one `signingEnabled` flag.

All write actions call a shared preflight that rechecks envelope status, wallet chain, and wallet-visible code hashes. `loadProposal` fetches both contract state and event evidence. A blocked result calls `clearChainReads` and preserves only immutable diagnostic fields.

- [ ] **Step 4: Replace receipt waiting with finality tracking**

After transaction submission, begin the V2 journal, call `waitForJournaledFinality`, refresh dynamic state at `mined`, and expose depth until `final`. Never clear `pending` while the journal reports an unresolved entry.

- [ ] **Step 5: Run all frontend tests and build**

Expected: tests and TypeScript build PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/useCircuitGuard.ts web/src/app/App.tsx web/test/app.test.tsx
git commit -m "feat: enforce Trust Envelope signing gate"
```

## Task 8: Build Trust cards and the Proposal evidence timeline

**Files:**
- Create: `web/src/components/TrustEnvelopePanel.tsx`
- Create: `web/src/components/EvidenceTimeline.tsx`
- Modify: `web/src/components/VerificationBar.tsx`
- Modify: `web/src/components/ProposalForm.tsx`
- Modify: `web/src/components/CircuitDecision.tsx`
- Modify: `web/src/app/App.tsx`
- Modify: `web/src/styles.css`
- Modify: `web/test/app.test.tsx`

- [ ] **Step 1: Write failing accessibility and state tests**

Assert all status text is available without color, technical details are expandable, disabled actions expose their reason, and timeline entries show depth:

```typescript
expect(screen.getByRole('status', { name: 'Endpoint verification' })).toHaveTextContent('Verified')
expect(screen.getByText('Site verified')).toBeInTheDocument()
expect(screen.getByText('Policy verified')).toBeInTheDocument()
expect(screen.getByText('Execution verified')).toBeInTheDocument()
expect(screen.getByText('Mined · 6/12 confirmations')).toBeInTheDocument()
expect(screen.getByText('Final · 12/12 confirmations')).toBeInTheDocument()
```

- [ ] **Step 2: Run and verify failure**

Run: `cd web && npm test -- --run app.test.tsx`

Expected: FAIL on missing Trust and timeline components.

- [ ] **Step 3: Implement the UI components**

`TrustEnvelopePanel` renders three cards with status, summary, details, and verified block. `EvidenceTimeline` renders semantic ordered-list items. `VerificationBar` shows the coordinate and overall state; full addresses move into the Trust detail sections.

All transaction buttons use `model.trustEnvelope.signingEnabled`. Native `title` and visible helper text explain the disabled reason. Loading and blocked states do not animate indefinitely.

- [ ] **Step 4: Implement responsive styling**

Desktop uses a three-card Trust row; below 760px it becomes one column. Preserve the dark circuit-grid visual system, existing focus indicators, and minimum 44px interactive targets. Avoid remote fonts and images.

- [ ] **Step 5: Test, build, and visually inspect**

```bash
cd web && npm test -- --run
cd web && npm run build
find web/dist -name '*.map' -print
rg -n 'fonts\.googleapis|googletagmanager|cdn\.|api[_-]?key' web/dist
```

Expected: all tests and build PASS; both scans print nothing. Inspect verified, unverified, degraded, and blocked screens at desktop and mobile widths.

- [ ] **Step 6: Commit**

```bash
git add web/src/components web/src/app/App.tsx web/src/styles.css web/test/app.test.tsx
git commit -m "feat: present verifiable endpoint and evidence timeline"
```

## Task 9: Extend deployment evidence validation

**Files:**
- Modify: `scripts/build-deployment-manifest.mjs`
- Create: `scripts/build-deployment-manifest.test.mjs`
- Modify: `Makefile`

- [ ] **Step 1: Write failing manifest tests**

Use temporary directories and assert acceptance of complete unpublished and published manifests plus rejection of each missing or malformed field:

```javascript
const valid = makeValidDeployment({ site: { status: 'unpublished' } })

assert.throws(() => validateDeployment({ ...valid, deploymentBlock: 0 }), /deploymentBlock/)
assert.throws(() => validateDeployment({ ...valid, safeConfirmations: 0 }), /safeConfirmations/)
assert.throws(() => validateDeployment({ ...valid, endpointCoordinate: '196:wrong' }), /endpointCoordinate/)
assert.throws(() => validateDeployment({ ...valid, adapterCodeHash: '0x12' }), /adapterCodeHash/)
assert.throws(() => validateDeployment({ ...valid, site: { status: 'published' } }), /manifestHash/)
assert.equal(validateDeployment(valid), valid)
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/build-deployment-manifest.test.mjs`

Expected: FAIL because the additional fields are not validated.

- [ ] **Step 3: Add exact validation**

Validate positive `deploymentBlock`, confirmation range 1–256, exact coordinate derivation, four contract code hashes, the two-stage Site record, and existing addresses/transactions. A published Site record requires its 32-byte manifest hash; an unpublished record forbids that field. Preserve atomic output replacement. The `not-deployed` source remains hand-maintained and is never passed as a successful deployed manifest.

Before writing, `verifyDeploymentEvidence` invokes `cast` against both official RPC URLs to verify chain ID, Factory registration, Circuit metadata, canonical netlist hash, non-empty runtime code, and all four code hashes. The command runner is injected in tests so no unit test uses the network. A mismatch or unavailable secondary RPC exits non-zero and leaves the previous generated file untouched.

- [ ] **Step 4: Add manifest tests to root verification**

Add a `test-manifest` target and include it in `make test`:

```makefile
test: test-circuit test-contracts test-web test-manifest

test-manifest:
	node --test scripts/build-deployment-manifest.test.mjs
```

- [ ] **Step 5: Run tests and commit**

```bash
node --test scripts/build-deployment-manifest.test.mjs
make test
git add scripts/build-deployment-manifest.mjs scripts/build-deployment-manifest.test.mjs Makefile
git commit -m "test: validate Trust Envelope deployment evidence"
```

## Task 10: Upgrade deterministic browser coverage and release checks

**Files:**
- Modify: `web/playwright.config.ts`
- Modify: `web/tests/demo.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/superpowers/plans/2026-09-29-circuitguard-capsule.md`

- [ ] **Step 1: Replace mutable global fixtures with E2E build mode**

Run the Playwright server with `vite --mode e2e`. Route both official RPC origins. Remove `window.__CIRCUITGUARD_E2E_DEPLOYMENT__` from application source and Playwright initialization.

- [ ] **Step 2: Add failing Trust Envelope browser scenarios**

Assert:

```text
matching primary + secondary + E2E Site attestation -> VERIFIED, signing controls available
secondary RPC unavailable -> DEGRADED, read-only balances visible, signing controls disabled
immutable identity mismatch -> BLOCKED, actionable balances cleared
wallet preflight code mismatch -> no eth_sendTransaction request
receipt at 6/12 -> MINED, not FINAL
receipt at 12/12 -> FINAL
production mode without TapeKit attestation -> UNVERIFIED, no wallet request
```

Keep the four existing policy scenarios.

- [ ] **Step 3: Run and fix E2E tests**

Run: `cd web && npm run test:e2e`

Expected: all deterministic browser scenarios PASS without public RPC access.

- [ ] **Step 4: Extend CI and release artifact checks**

CI runs manifest unit tests and scans the production bundle for E2E marker strings, source maps, remote assets, and secrets. Browser tests continue using only mocked RPC responses.

- [ ] **Step 5: Run final local verification**

```bash
make test
make build-web
cd web && npm run test:e2e
git diff --check
```

Expected: circuit tests, 43 Solidity tests including 2 invariant suites, all frontend tests, manifest tests, browser tests, and production build PASS.

- [ ] **Step 6: Update the parent plan and commit**

Record Trust Envelope V1.1 as complete before resuming Task 13. Do not mark mainnet deployment, TapeKit publication, or submission tasks complete.

```bash
git add .github web docs/superpowers/plans/2026-09-29-circuitguard-capsule.md
git commit -m "test: verify CircuitGuard Trust Envelope end to end"
```
