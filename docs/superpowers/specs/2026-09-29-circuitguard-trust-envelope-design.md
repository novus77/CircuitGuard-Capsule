# CircuitGuard Trust Envelope Design

**Status:** Approved for implementation  
**Date:** 2026-09-29  
**Target release:** CircuitGuard Capsule V1.1  
**Source concept:** TapeUP's verifiable ledger model: write on the source chain, read independently, and accept content only when its fingerprint matches.

## 1. Summary

CircuitGuard Capsule currently proves that an Agent can propose an OKB or USDT0 transfer while a pinned TapeOut NAND circuit produces the authoritative `ALLOW`, `REVIEW`, or `DENY` decision. V1.1 adds a read-only Trust Envelope around that execution path.

The Trust Envelope binds three independently inspectable layers:

1. **Site:** the rendered application belongs to the published TapeKit Container and matches the registered content fingerprint.
2. **Policy:** two independent X Layer RPC endpoints agree on the Processor, Circuit metadata, canonical netlist hash, Container identity, Adapter code, and Treasury code.
3. **Execution:** the wallet RPC agrees with the verified deployment identity before signing, and transaction evidence progresses through explicit confirmation states.

The envelope is fail-closed. A degraded or contradictory verification result remains readable but cannot request a wallet signature. This change does not modify the Treasury contract, policy circuit, ownership model, recovery model, asset limits, or transfer semantics.

## 2. Goals

- Give the CircuitGuard deployment one visible coordinate that binds the page, policy, and execution contracts.
- Prevent the application from presenting a green verification state based only on its own JavaScript or a single RPC response.
- Compare immutable deployment identity across two independently configured X Layer RPC hosts.
- Require wallet-RPC agreement with the verified identity immediately before every write.
- Distinguish a submitted transaction, a mined transaction, and final evidence at a configured confirmation depth.
- Reconstruct a selected Proposal's evidence timeline directly from Treasury events without a hosted indexer.
- Preserve read-only access when verification is incomplete while disabling every signing action.
- Keep all existing circuit, contract, frontend, and deterministic browser tests passing.

## 3. Non-goals

- No cross-chain asset movement, remote contract execution, wrapped asset, or bridge integration.
- No TapeSend dependency in the signing or policy decision path.
- No validator-station economy, staking mechanism, or station identity circuit.
- No general multi-chain inbox or full TapeUP ledger implementation.
- No change to the 13-NAND policy, Adapter, Treasury, Demo Merchant, or deployed Solidity bytecode.
- No claim that the application can cryptographically prove its own JavaScript integrity.
- No runtime fallback that silently treats a single RPC response as verified.

## 4. Locked decisions

### 4.1 Layered dual-RPC verification

Two RPC endpoints verify immutable identity. Dynamic values such as balances, budgets, and the latest Proposal state continue to come from the primary client. The wallet provider independently checks the chain and relevant contract bytecode before signing.

If the secondary RPC is unavailable, the application becomes `DEGRADED`: read-only values may remain visible, but signing is disabled. If the two RPCs disagree, the application becomes `BLOCKED`, clears actionable dynamic values, and surfaces the conflicting field.

### 4.2 Three-stage confirmation evidence

Successful transactions use these evidence stages:

- `SUBMITTED`: a transaction hash exists and duplicate submission is forbidden.
- `MINED`: a successful receipt exists, but the block has fewer than `safeConfirmations` confirmations.
- `FINAL`: the successful receipt has reached `safeConfirmations` and can be presented as final evidence.

`REVERTED` is terminal but is never successful evidence. A receipt that disappears before `FINAL` is treated as a reorganization: the journal returns to `SUBMITTED`, the execution layer becomes `BLOCKED`, and no automatic resend is offered.

### 4.3 Strict Site verification

The application does not infer Site verification from hostname, URL parameters, a global JavaScript variable, a generated manifest, or a hash calculated by the page itself.

The default browser implementation returns `UNVERIFIED`. A production Site can return `VERIFIED` only through a TapeKit-controlled external attestation mechanism that binds the Container, path, and registered content hash. The exact adapter is completed during Task 14 after the official TapeKit environment is available for integration testing. If TapeKit exposes no trustworthy page-to-shell attestation, the application remains read-only and the verified state remains visible in TapeKit's own trusted browser chrome rather than being imitated inside the application.

Test fixtures may inject a verified Site attestation only in Vitest or Playwright builds. Production bundles must not contain that fixture path.

## 5. Architecture

### 5.1 Endpoint coordinate

The human-readable coordinate is:

```text
<chainId>:<checksummedContainerAddress>
```

For example:

```text
196:0x1234...ABCD
```

This is a CircuitGuard display coordinate, not a claim of compatibility with an unpublished binary TapeUP endpoint encoding. The coordinate binds a deployment record containing:

- chain ID;
- Factory;
- Processor;
- Circuit ID;
- canonical netlist hash;
- Container;
- Adapter;
- Treasury;
- USDT0;
- deployment block;
- expected runtime bytecode hashes.

### 5.2 Module boundaries

```text
SiteAttestationSource ───────────────┐
                                     │
PrimaryIdentityReader ─┐             ▼
                       ├─ Quorum ─> TrustEnvelope ─> SigningGate
SecondaryIdentityReader┘             ▲
                                     │
WalletPreflightReader ───────────────┘

Primary event logs ─> EvidenceReader ─> ProposalTimeline
Transaction receipts ─> FinalityTracker ─> TransactionJournal
```

The modules are deliberately separate:

- `endpoint.ts` formats the coordinate and normalizes deployment identity.
- `trustEnvelope.ts` classifies Site, Policy, and Execution layers without performing network calls.
- `quorum.ts` reads and compares immutable identity snapshots.
- `siteAttestation.ts` defines the external Site-attestation boundary and the default unverified implementation.
- `finality.ts` derives transaction evidence state from receipts and block depth.
- `evidence.ts` reconstructs a selected Proposal timeline from Treasury events.
- `useCircuitGuard.ts` orchestrates the modules and exposes a render model; it does not implement their comparison rules inline.

### 5.3 Static RPC configuration

RPC hosts are reviewed build configuration, not mutable deployment data. `web/src/config/xlayer.ts` contains exactly two HTTPS origins:

- a primary X Layer RPC used for dynamic reads and event history;
- a secondary RPC on a distinct host used only for immutable identity comparison.

Both clients must return chain ID `196`. The production build fails if the two origins share the same hostname. If a second independent public endpoint cannot be established, V1.1 ships in `DEGRADED` read-only mode rather than weakening the classification rules.

## 6. Data model

### 6.1 Trust status

```typescript
export type VerificationStatus =
  | 'loading'
  | 'verified'
  | 'unverified'
  | 'degraded'
  | 'blocked'

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
```

`signingEnabled` is derived, never assigned by UI code. It is true only when all three layers are `verified`, the wallet is connected to chain `196`, no transaction is unresolved, and the dynamic read model is ready.

### 6.2 Immutable identity snapshot

```typescript
export type IdentitySnapshot = {
  chainId: number
  factoryRecognizesProcessor: boolean
  processor: Address
  circuitId: bigint
  nIn: number
  nOut: number
  nState: number
  gateCount: number
  netlistHash: Hash
  container: Address
  containerCodeHash: Hash
  adapter: Address
  adapterCodeHash: Hash
  treasury: Address
  treasuryCodeHash: Hash
}
```

Comparison is field-by-field after address checksum normalization. The verifier returns the first conflicting field and both normalized values. It never chooses one endpoint as correct after a conflict.

### 6.3 Transaction evidence

```typescript
export type TransactionEvidenceStatus =
  | 'submitted'
  | 'mined'
  | 'final'
  | 'reverted'

export type TransactionEvidence = {
  hash: Hash
  label: string
  status: TransactionEvidenceStatus
  submittedAt: number
  blockNumber?: bigint
  blockHash?: Hash
  confirmations: number
  requiredConfirmations: number
  reorgDetected: boolean
}
```

Local storage is a recovery journal, not authority. Every page load reconciles unresolved entries with chain receipts before enabling another write.

### 6.4 Proposal evidence timeline

```typescript
export type ProposalEvidenceItem = {
  kind:
    | 'created'
    | 'evaluated'
    | 'approved'
    | 'cancelled'
    | 'expired'
    | 'executed'
  transactionHash: Hash
  blockNumber: bigint
  blockHash: Hash
  transactionIndex: number
  logIndex: number
  confirmations: number
  final: boolean
}
```

The timeline covers the currently selected Proposal only. It does not implement a global history browser. Events are ordered by block number, transaction index, and log index, then compared with `getProposal(proposalId)`. A disagreement blocks Proposal actions and is displayed as an evidence error.

## 7. Verification flows

### 7.1 Initial read-only verification

1. Parse and validate the generated deployment manifest.
2. Obtain the external Site attestation; default to `UNVERIFIED` when absent.
3. Read immutable identity independently from the primary and secondary clients.
4. Reject either snapshot if its chain ID is not `196` or required code is empty.
5. Compare every snapshot field with the deployment manifest and with the other snapshot.
6. Classify Policy and Execution layers.
7. Only after immutable verification, read owner, pause state, balances, budgets, and Adapter health from the primary client.
8. Derive `signingEnabled`; components consume this value rather than duplicating conditions.

Immutable reads may occur at each endpoint's latest block because every compared field is immutable or deployment identity. Dynamic balances are never compared across nodes with different heads.

### 7.2 Wallet preflight

Immediately before every `requestTransfer`, `approveProposal`, `executeApproved`, or `cancelProposal` write:

1. Verify wallet chain ID `196`.
2. Read Adapter and Treasury code through the wallet provider.
3. Compute runtime code hashes and compare them with the verified manifest.
4. Re-read the Processor/Circuit identity through the primary client.
5. Abort if the verified snapshot has changed or the read-only quorum is no longer `verified`.
6. Simulate the requested write through the wallet transport when supported.
7. Prompt the wallet only after all preflight checks pass.

### 7.3 Finality tracking

After submission:

1. Store the transaction hash as `SUBMITTED` before beginning receipt polling.
2. A successful receipt changes the state to `MINED` and records block number and block hash.
3. Calculate confirmations as `latestBlock - receipt.blockNumber + 1`.
4. Change to `FINAL` only when confirmations are at least `safeConfirmations`.
5. Re-read the receipt on every refresh until final.
6. If a pre-final receipt disappears or its block hash changes, mark `reorgDetected`, return to `SUBMITTED`, and block writes pending manual review.
7. A failed receipt becomes `REVERTED` and clears the duplicate-send lock after the error is presented.

The UI may refresh dynamic balances after `MINED`, but the evidence timeline cannot label the transaction final until the configured depth is reached.

### 7.4 Proposal evidence reconstruction

The manifest supplies `deploymentBlock`. The reader queries Treasury events in inclusive 10,000-block windows from `deploymentBlock` to the latest primary block, filtering by indexed `proposalId` where supported. It decodes:

- `ProposalCreated`;
- `PolicyEvaluated`;
- `ProposalApproved`;
- `ProposalCancelled`;
- `ProposalExpired`;
- `TransferExecuted`.

The reader deduplicates by `(transactionHash, logIndex)`, calculates confirmation depth, and compares the terminal event with the Proposal state. No cached timeline is accepted without revalidation.

## 8. Status classification

### 8.1 Layer rules

- **Site `verified`:** a TapeKit-controlled attestation binds the loaded path and bytes to the expected Container and site manifest hash.
- **Site `unverified`:** no trusted external attestation exists.
- **Site `blocked`:** an attestation exists but conflicts with the deployment manifest.
- **Policy `verified`:** both RPC snapshots agree on Factory registration, Circuit metadata, and canonical netlist hash.
- **Policy `degraded`:** exactly one valid RPC snapshot is available.
- **Policy `blocked`:** snapshots conflict or either valid snapshot conflicts with the manifest.
- **Execution `verified`:** both snapshots agree on Container, Adapter, Treasury, and runtime code hashes.
- **Execution `degraded`:** exactly one valid snapshot is available.
- **Execution `blocked`:** deployment identity conflicts, code is missing, or selected Proposal evidence contradicts contract state.

### 8.2 Overall rules

Priority is deterministic:

1. Any `blocked` layer makes overall status `blocked`.
2. Otherwise, any `unverified` layer makes overall status `unverified`.
3. Otherwise, any `degraded` layer makes overall status `degraded`.
4. All three layers `verified` makes overall status `verified`.
5. `loading` is used only while an active verification request is unresolved.

## 9. UI design

### 9.1 Verification header

The header shows:

- `CircuitGuard Capsule`;
- endpoint coordinate;
- overall status;
- last verified block;
- wallet state.

The status is text plus color. Green is never the only indicator.

### 9.2 Trust cards

Three compact cards show Site, Policy, and Execution. Each card includes:

- status;
- one-sentence summary;
- expandable technical detail;
- relevant fingerprint or block number.

The existing Processor, Circuit, Container, Adapter, and Treasury addresses move into these details rather than consuming the full header width.

### 9.3 Signing gate

Every write button receives one shared `signingEnabled` flag and an explicit disabled reason. A disabled action never calls `connectWallet`, `eth_requestAccounts`, simulation, or write methods.

Read-only Proposal loading remains available when the envelope is `UNVERIFIED` or `DEGRADED`. A `BLOCKED` envelope clears dynamic data and disables Proposal evidence actions that could present contradictory state.

### 9.4 Evidence timeline

The selected Proposal panel shows:

- event name;
- transaction hash in compact copyable form;
- block number;
- confirmation depth;
- `Pending` or `Final` evidence label.

The timeline does not imply that a `REVIEW` decision has executed. Approval and execution remain separate events.

## 10. Deployment manifest

`deployments/xlayer.json` and the generated web manifest add these deployment-derived fields:

| Field | Type and source |
|---|---|
| `deploymentBlock` | Positive JSON integer from the first CircuitGuard deployment receipt |
| `safeConfirmations` | JSON integer from 1 through 256, fixed during release review |
| `endpointCoordinate` | `<chainId>:<checksummedContainerAddress>` |
| `processorCodeHash` | Keccak-256 of Processor runtime bytecode |
| `containerCodeHash` | Keccak-256 of Container runtime bytecode |
| `adapterCodeHash` | Keccak-256 of Adapter runtime bytecode |
| `treasuryCodeHash` | Keccak-256 of Treasury runtime bytecode |
| `siteManifestHash` | Keccak-256 of the deterministic Site manifest bytes |

The manifest generator requires:

- positive integer `deploymentBlock`;
- integer `safeConfirmations` between 1 and 256;
- coordinate equal to `chainId + ':' + checksummed container`;
- 32-byte hashes for every code and Site fingerprint;
- hashes recomputed from both configured RPC clients before release;
- `siteManifestHash` only after deterministic Site manifest generation.

The current `not-deployed` manifest stays minimal and renders the existing unavailable state.

## 11. Error handling

| Condition | Classification | User-visible behavior |
|---|---|---|
| No TapeKit attestation | Site `unverified` | Read-only; show “Open with a verified TapeKit client to sign” |
| One identity RPC unavailable | Policy/Execution `degraded` | Preserve read-only primary data; disable signing |
| Identity snapshots disagree | Relevant layer `blocked` | Clear actionable data; name the conflicting field |
| Wrong chain from either RPC | Relevant layer `blocked` | Refuse snapshot |
| Wallet chain mismatch | Wallet `wrong-network` | Disable signing; offer explicit X Layer switch |
| Wallet code hash mismatch | Execution `blocked` | Abort before signature request |
| Dynamic primary read fails | Model `unavailable` | Clear balances and Proposal state; never show stale values |
| Receipt timeout | Transaction `submitted` | Keep hash pending; never suggest resend |
| Receipt successful below depth | Transaction `mined` | Show depth `x/N`; do not label final |
| Pre-final receipt disappears | Execution `blocked` | Mark reorganization; require refresh/review |
| Proposal event/state conflict | Execution `blocked` | Show evidence mismatch; disable Proposal writes |

Errors are safe to display and contain no raw provider credentials or complete RPC request payloads.

## 12. Testing strategy

### 12.1 Unit tests

- Endpoint coordinate formatting and address normalization.
- All overall-status priority combinations.
- Signing gate derivation.
- Snapshot equality and first-conflict reporting.
- One endpoint unavailable versus two conflicting valid responses.
- Transaction progression from submitted to mined to final.
- Reverted transaction and pre-final reorganization behavior.
- Proposal event ordering, deduplication, and state conflict detection.
- Deployment manifest rejection for missing confirmation, block, coordinate, or hash fields.

### 12.2 Component tests

- Three trust cards and overall endpoint status.
- Explicit disabled reason for every write action.
- Unverified Site never requests wallet access.
- Degraded RPC state preserves read-only rendering and disables signing.
- Blocked state clears actionable dynamic values.
- Evidence timeline distinguishes mined and final events.

### 12.3 Browser tests

Deterministic Playwright RPC fixtures cover:

1. fully verified Site and matching RPC identities;
2. secondary RPC unavailable;
3. RPC identity conflict;
4. wallet preflight code mismatch;
5. submitted, mined, and final transaction evidence;
6. non-TapeKit environment locked to read-only;
7. the four existing ALLOW, REVIEW, DENY, and independent OKB-budget paths.

No browser test depends on public RPC uptime.

## 13. Rollout sequence

1. Add pure domain types and classification tests.
2. Add dual-RPC immutable snapshot readers and deterministic fixtures.
3. Upgrade the transaction journal and finality tracker.
4. Add Proposal event evidence reconstruction.
5. Refactor the hook to orchestrate the new modules.
6. Add Trust cards, endpoint coordinate, signing gate, and timeline UI.
7. Extend manifest validation without fabricating undeployed values.
8. Run the full circuit, contract, frontend, and browser suites.
9. Continue Task 13 mainnet deployment only after a fresh fee quote and explicit transaction authorization.
10. Complete real Site-attestation integration during Task 14; remain read-only if no trustworthy TapeKit signal exists.

## 14. Acceptance criteria

- No write action can reach a wallet request unless all three Trust Envelope layers are verified.
- A single available RPC never produces a verified Policy or Execution layer.
- Conflicting immutable identity produces a blocked state with the conflicting field named.
- The page never self-asserts Site verification from local JavaScript state.
- A successful receipt below the required depth is shown as mined, not final.
- A pre-final reorganization cannot produce final evidence or an automatic resend.
- A selected Proposal timeline is derived from chain events and reconciled with contract state.
- The non-deployed build remains honest and usable as a read-only project preview.
- The existing Solidity bytecode and circuit hash remain unchanged.
- All existing and new automated tests pass before mainnet deployment resumes.
