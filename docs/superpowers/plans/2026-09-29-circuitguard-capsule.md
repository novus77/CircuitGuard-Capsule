# CircuitGuard Capsule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish an X Layer Agent treasury whose OKB and USDT0 transfers are authorized by a canonical TapeOut NAND circuit and whose static frontend is verified through TapeKit.

**Architecture:** A canonical 13-NAND stateless circuit produces `ALLOW`, `REVIEW`, or `DENY` from six contract-derived bits. A non-upgradeable Adapter pins the TapeOut Processor, Circuit ID, metadata, and netlist hash; a non-upgradeable Treasury owns the balances, derives inputs, tracks per-asset budgets, and executes only valid `ALLOW` results. A static Preact application reads the contracts, drives wallet transactions, and is published in the same Circuit NFT's Container.

**Tech Stack:** Solidity 0.8.26, Foundry, OpenZeppelin Contracts 5.x, Node.js 20+, Preact, TypeScript, Vite, viem, Vitest, Testing Library, Playwright, X Layer mainnet, TapeOut, TapeKit.

---

## Scope and execution rules

- Implement only the MVP defined in `docs/superpowers/specs/2026-09-29-circuitguard-capsule-design.md`.
- TapeSend starts only after every MVP acceptance check passes; it is not part of Tasks 1–15.
- Use TDD for circuit, contracts, domain logic, and transaction state handling.
- Do not send a mainnet transaction until the user has reviewed the live quote and explicitly authorized that transaction batch.
- Never print, commit, or persist a private key. Deployment scripts read credentials from the execution environment or use a hardware/browser wallet.
- Keep mainnet addresses and receipts in `deployments/xlayer.json`; do not hard-code deployment outputs in source files.

## Locked file structure

```text
.
├── .github/workflows/ci.yml
├── .gitignore
├── Makefile
├── README.md
├── circuits/
│   ├── generated/policy.json
│   ├── src/policy.mjs
│   └── test/policy.test.mjs
├── contracts/
│   ├── foundry.toml
│   ├── remappings.txt
│   ├── script/
│   │   ├── CreateProcessor.s.sol
│   │   ├── TapeoutPolicy.s.sol
│   │   └── DeployCircuitGuard.s.sol
│   ├── src/
│   │   ├── CircuitGuardTreasury.sol
│   │   ├── DemoMerchant.sol
│   │   ├── TapeOutPolicyAdapter.sol
│   │   ├── interfaces/
│   │   │   ├── IPolicyAdapter.sol
│   │   │   ├── ITapeOutFactory.sol
│   │   │   └── ITapeOutProcessor.sol
│   │   └── libraries/PolicyCodec.sol
│   └── test/
│       ├── CircuitGuardTreasury.t.sol
│       ├── CircuitGuardInvariant.t.sol
│       ├── TapeOutPolicyAdapter.t.sol
│       ├── XLayerFork.t.sol
│       └── mocks/
│           ├── MaliciousRecipient.sol
│           ├── MockERC20.sol
│           ├── MockPolicyAdapter.sol
│           └── MockTapeOut.sol
├── deployments/xlayer.json
├── scripts/
│   ├── build-deployment-manifest.mjs
│   ├── build-site-manifest.mjs
│   └── verify-site.mjs
└── web/
    ├── playwright.config.ts
    ├── src/
    │   ├── app/App.tsx
    │   ├── chain/abis.ts
    │   ├── chain/client.ts
    │   ├── components/CircuitDecision.tsx
    │   ├── components/ProposalForm.tsx
    │   ├── components/TreasuryPanel.tsx
    │   ├── components/VerificationBar.tsx
    │   ├── domain/amount.ts
    │   ├── domain/policy.ts
    │   ├── generated/deployment.json
    │   ├── hooks/useCircuitGuard.ts
    │   ├── state/transactionJournal.ts
    │   └── styles.css
    ├── test/
    │   ├── amount.test.ts
    │   ├── app.test.tsx
    │   ├── policy.test.ts
    │   └── transactionJournal.test.ts
    └── tests/demo.spec.ts
```

## Task 1: Scaffold deterministic circuit, contract, and web workspaces

**Files:**
- Create: `.gitignore`
- Create: `Makefile`
- Create: `contracts/foundry.toml`
- Create: `contracts/remappings.txt`
- Create: `web/package.json` and Vite/TypeScript bootstrap files

- [x] **Step 1: Create the Foundry workspace without a nested Git repository**

Run:

```bash
forge init contracts --no-git --force
cd contracts && forge install OpenZeppelin/openzeppelin-contracts --no-git
```

Expected: `contracts/src`, `contracts/test`, and `contracts/lib/openzeppelin-contracts` exist; repository root remains the only Git repository.

- [x] **Step 2: Pin compiler and remapping**

Create `contracts/foundry.toml`:

```toml
[profile.default]
src = "src"
test = "test"
script = "script"
out = "out"
libs = ["lib"]
solc_version = "0.8.26"
optimizer = true
optimizer_runs = 200
evm_version = "cancun"

[fmt]
line_length = 100
tab_width = 4
bracket_spacing = true
```

Create `contracts/remappings.txt`:

```text
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
```

- [x] **Step 3: Create the Preact workspace**

Run:

```bash
npm create vite@latest web -- --template preact-ts
cd web
npm install
npm install viem
npm install --save-dev vitest jsdom @testing-library/preact @testing-library/jest-dom @playwright/test
npm pkg set 'scripts.test=vitest --passWithNoTests' 'scripts.test:e2e=playwright test'
```

Move the generated `src/app.tsx` implementation to `src/app/App.tsx`, update `src/main.tsx` to import it, and remove the unused template assets. Expected: `npm test -- --run` exits 0 with no tests yet and `npm run build` produces a static `web/dist` directory.

- [x] **Step 4: Add root commands and ignore generated secrets/build output**

Create `Makefile`:

```makefile
.PHONY: test test-circuit test-contracts test-web build-web

test: test-circuit test-contracts test-web

test-circuit:
	node --test circuits/test/policy.test.mjs

test-contracts:
	forge test --root contracts -vv

test-web:
	cd web && npm test -- --run

build-web:
	cd web && npm run build
```

Create `.gitignore`:

```text
.DS_Store
.env
.env.*
!.env.example
contracts/cache/
contracts/out/
contracts/broadcast/
contracts/lib/
web/node_modules/
web/dist/
web/playwright-report/
web/test-results/
```

- [x] **Step 5: Verify the empty workspaces**

Run:

```bash
forge build --root contracts
cd web && npm run build
```

Expected: both commands exit 0.

- [x] **Step 6: Commit**

```bash
git add .gitignore Makefile contracts/foundry.toml contracts/remappings.txt contracts/src contracts/test web
git commit -m "chore: scaffold CircuitGuard workspaces"
```

## Task 2: Implement and freeze the canonical 13-NAND policy

**Files:**
- Create: `circuits/src/policy.mjs`
- Create: `circuits/test/policy.test.mjs`
- Create: `circuits/generated/policy.json`

- [x] **Step 1: Write the exhaustive failing circuit test**

Create `circuits/test/policy.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  CANONICAL_NETLIST,
  EXPECTED_HASH,
  compilePolicy,
  evaluateGraph,
  evaluateReference,
} from '../src/policy.mjs';

test('canonical netlist and hash are stable', () => {
  assert.equal(compilePolicy(), CANONICAL_NETLIST);
  assert.equal((CANONICAL_NETLIST.length - 2) / 2, 91);
  const hash = execFileSync('cast', ['keccak', CANONICAL_NETLIST], { encoding: 'utf8' }).trim();
  assert.equal(hash, EXPECTED_HASH);
});

test('all 64 vectors match and never produce invalid output', () => {
  for (let inputs = 0; inputs < 64; inputs += 1) {
    const actual = evaluateGraph(inputs);
    const expected = evaluateReference(inputs);
    assert.equal(actual, expected, `vector ${inputs.toString(2).padStart(6, '0')}`);
    assert.notEqual(actual, 3);
  }
});
```

- [x] **Step 2: Run the test and verify it fails**

Run: `node --test circuits/test/policy.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `circuits/src/policy.mjs`.

- [x] **Step 3: Implement the canonical graph and serializer**

Create `circuits/src/policy.mjs`:

```javascript
export const CANONICAL_NETLIST = '0x0000000400000400000002000008000000090000090000000a0000060000000b00000b00000003000005000000070000070000000e00000d0000000f00000f0000000c00000f0000000c0000100000001100001100000012000012';
export const EXPECTED_HASH = '0xd722aa6af62aa44c485ec471d4234803c859aec19684caa2a510bdca1675c269';

const GATES = [
  [4, 4], [2, 8], [9, 9], [10, 6], [11, 11], [3, 5], [7, 7],
  [14, 13], [15, 15], [12, 15], [12, 16], [17, 17], [18, 18],
];

const nand = (a, b) => 1 - (a & b);
const u24 = (value) => [(value >>> 16) & 255, (value >>> 8) & 255, value & 255];

export function compilePolicy() {
  const bytes = GATES.flatMap(([a, b]) => [0, ...u24(a), ...u24(b)]);
  return `0x${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function evaluateGraph(inputByte) {
  const signals = Array(21).fill(0);
  signals[1] = 1;
  for (let bit = 0; bit < 6; bit += 1) signals[bit + 2] = (inputByte >> bit) & 1;
  GATES.forEach(([a, b], index) => { signals[index + 8] = nand(signals[a], signals[b]); });
  return signals[19] | (signals[20] << 1);
}

export function evaluateReference(inputByte) {
  const active = (inputByte >> 0) & 1;
  const trusted = (inputByte >> 1) & 1;
  const blocked = (inputByte >> 2) & 1;
  const low = (inputByte >> 3) & 1;
  const within = (inputByte >> 4) & 1;
  const approved = (inputByte >> 5) & 1;
  const hardOk = active && !blocked && within;
  const allow = Number(hardOk && (approved || (trusted && low)));
  const review = Number(hardOk && !allow);
  return allow | (review << 1);
}
```

- [x] **Step 4: Generate the committed policy manifest**

Create `circuits/generated/policy.json`:

```json
{
  "version": 1,
  "nIn": 6,
  "nOut": 2,
  "nState": 0,
  "nand": 13,
  "latch": 0,
  "netlist": "0x0000000400000400000002000008000000090000090000000a0000060000000b00000b00000003000005000000070000070000000e00000d0000000f00000f0000000c00000f0000000c0000100000001100001100000012000012",
  "keccak256": "0xd722aa6af62aa44c485ec471d4234803c859aec19684caa2a510bdca1675c269",
  "inputs": ["systemActive", "recipientTrusted", "recipientBlocked", "amountLow", "withinDailyBudget", "humanApproved"],
  "outputs": ["allow", "review"]
}
```

- [x] **Step 5: Run tests**

Run: `node --test circuits/test/policy.test.mjs`

Expected: 2 tests PASS and report no invalid vector.

- [x] **Step 6: Commit**

```bash
git add circuits
git commit -m "feat: define canonical CircuitGuard policy circuit"
```

## Task 3: Implement TapeOut interfaces, policy types, and codec

**Files:**
- Create: `contracts/src/interfaces/ITapeOutFactory.sol`
- Create: `contracts/src/interfaces/ITapeOutProcessor.sol`
- Create: `contracts/src/interfaces/IPolicyAdapter.sol`
- Create: `contracts/src/libraries/PolicyCodec.sol`
- Create: `contracts/test/PolicyCodec.t.sol`

- [x] **Step 1: Write failing codec tests**

Create `contracts/test/PolicyCodec.t.sol` with tests asserting that all six booleans map to bits `0...5`, `0x01` decodes to `Allow`, `0x02` to `Review`, `0x00` to `Deny`, and `0x03`/high bits return `Invalid` with `OutputMalformed`.

Core assertion:

```solidity
uint8 packed = PolicyCodec.pack(true, true, false, true, true, false);
assertEq(packed, 0x1B);
```

- [x] **Step 2: Run the test and verify it fails**

Run: `forge test --root contracts --match-contract PolicyCodecTest -vv`

Expected: FAIL because `PolicyCodec.sol` and policy types do not exist.

- [x] **Step 3: Define exact TapeOut interfaces and shared policy types**

`ITapeOutProcessor.sol` must expose exactly:

```solidity
interface ITapeOutProcessor {
    function ownerOf(uint256 id) external view returns (address);
    function circuitInfo(uint256 id)
        external view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);
    function netlist(uint256 id) external view returns (bytes memory);
    function step(uint256 id, bytes calldata state, bytes calldata inputs)
        external view returns (bytes memory newState, bytes memory outputs);
}
```

`IPolicyAdapter.sol` defines `Decision`, `PolicyError`, and `PolicyEvaluation` exactly as in the approved Spec, plus `evaluate(uint8)` and `health()`.

- [x] **Step 4: Implement `PolicyCodec`**

```solidity
library PolicyCodec {
    function pack(bool active, bool trusted, bool blocked, bool low, bool within, bool approved)
        internal pure returns (uint8 value)
    {
        if (active) value |= 1 << 0;
        if (trusted) value |= 1 << 1;
        if (blocked) value |= 1 << 2;
        if (low) value |= 1 << 3;
        if (within) value |= 1 << 4;
        if (approved) value |= 1 << 5;
    }
}
```

- [x] **Step 5: Run and format**

Run:

```bash
forge fmt --root contracts --check
forge test --root contracts --match-contract PolicyCodecTest -vv
```

Expected: all codec tests PASS.

- [x] **Step 6: Commit**

```bash
git add contracts/src/interfaces contracts/src/libraries contracts/test/PolicyCodec.t.sol
git commit -m "feat: add TapeOut policy interfaces and codec"
```

## Task 4: Implement the fail-closed TapeOut Policy Adapter

**Files:**
- Create: `contracts/src/TapeOutPolicyAdapter.sol`
- Create: `contracts/test/mocks/MockTapeOut.sol`
- Create: `contracts/test/TapeOutPolicyAdapter.t.sol`

- [x] **Step 1: Write failing constructor and evaluation tests**

Cover these exact cases:

```text
reject unregistered processor
reject missing circuit
reject metadata other than 6/2/0/13
reject netlist hash mismatch
decode 0x00, 0x01, and 0x02
return Invalid/OutputMalformed for 0x03 or high bits
return Invalid/StateMismatch for non-empty newState
return Invalid/StepReverted when step reverts
return Invalid/NetlistMismatch after runtime mutation
```

- [x] **Step 2: Run and verify failure**

Run: `forge test --root contracts --match-contract TapeOutPolicyAdapterTest -vv`

Expected: FAIL because the Adapter does not exist.

- [x] **Step 3: Implement immutable provenance checks**

Use these constants in `TapeOutPolicyAdapter.sol`:

```solidity
bytes32 public constant EXPECTED_NETLIST_HASH =
    0xd722aa6af62aa44c485ec471d4234803c859aec19684caa2a510bdca1675c269;
uint32 public constant EXPECTED_INPUTS = 6;
uint32 public constant EXPECTED_OUTPUTS = 2;
uint32 public constant EXPECTED_STATE = 0;
uint32 public constant EXPECTED_GATES = 13;
uint8 internal constant UNAVAILABLE_OUTPUT = type(uint8).max;
```

The constructor stores immutable Factory, Processor, and Circuit ID after checking `isCPU`, `ownerOf`, metadata, and netlist hash.

- [x] **Step 4: Implement `evaluate` with no authorizing failure path**

The decision mapping must be:

```solidity
if (raw == 0) return PolicyEvaluation(Decision.Deny, raw, PolicyError.None);
if (raw == 1) return PolicyEvaluation(Decision.Allow, raw, PolicyError.None);
if (raw == 2) return PolicyEvaluation(Decision.Review, raw, PolicyError.None);
return PolicyEvaluation(Decision.Invalid, raw, PolicyError.OutputMalformed);
```

Before `step`, re-read and hash the netlist. Wrap `step` in `try/catch`; require empty state, one output byte, and zero high bits.

- [x] **Step 5: Run Adapter tests and the full contract suite**

Run:

```bash
forge test --root contracts --match-contract TapeOutPolicyAdapterTest -vv
forge test --root contracts -vv
```

Expected: all tests PASS.

- [x] **Step 6: Commit**

```bash
git add contracts/src/TapeOutPolicyAdapter.sol contracts/test/mocks/MockTapeOut.sol contracts/test/TapeOutPolicyAdapter.t.sol
git commit -m "feat: add fail-closed TapeOut policy adapter"
```

## Task 5: Implement Treasury administration, funding, and independent budgets

**Files:**
- Create: `contracts/src/CircuitGuardTreasury.sol`
- Create: `contracts/test/mocks/MockERC20.sol`
- Create: `contracts/test/mocks/MockPolicyAdapter.sol`
- Create: `contracts/test/CircuitGuardTreasury.t.sol`

- [x] **Step 1: Write failing administration and accounting tests**

Test constructor validation, immutable recovery/USDT0/Adapter addresses, two-step ownership, Agent authorization, recipient enum exclusivity, independent budgets, UTC day rollover, OKB receive, exact-delta USDT0 deposit, owner-only configuration, and emergency recovery only while paused.

- [x] **Step 2: Run and verify failure**

Run: `forge test --root contracts --match-contract CircuitGuardTreasuryTest -vv`

Expected: FAIL because Treasury is missing.

- [x] **Step 3: Implement enums and storage**

Use the approved shapes:

```solidity
enum Asset { OKB, USDT0 }
enum RecipientStatus { Unknown, Trusted, Blocked }
enum ProposalState { PendingReview, Executed, Rejected, Cancelled, Expired }

struct Budget {
    uint128 instantLimit;
    uint128 dailyLimit;
    uint128 spent;
    uint64 epochDay;
}
```

Use `mapping(Asset => Budget)`, `mapping(address => bool) agents`, and `mapping(address => RecipientStatus) recipientStatus`.

- [x] **Step 4: Implement funding and administration**

Use `SafeERC20`, `Ownable2Step`, `Pausable`, and `ReentrancyGuard`. `receive()` emits funding. `depositUSDT0` compares `balanceAfter - balanceBefore` to the requested amount. `emergencyRecover` sends an exact amount only to immutable `recoveryAddress` and only while paused.

- [x] **Step 5: Run tests**

Run:

```bash
forge fmt --root contracts
forge test --root contracts --match-contract CircuitGuardTreasuryTest -vv
```

Expected: administration/funding/budget tests PASS.

- [x] **Step 6: Commit**

```bash
git add contracts/src/CircuitGuardTreasury.sol contracts/test/mocks/MockERC20.sol contracts/test/mocks/MockPolicyAdapter.sol contracts/test/CircuitGuardTreasury.t.sol
git commit -m "feat: add dual-asset CircuitGuard treasury"
```

## Task 6: Implement proposals, policy evaluation, approvals, and transfers

**Files:**
- Modify: `contracts/src/CircuitGuardTreasury.sol`
- Modify: `contracts/test/CircuitGuardTreasury.t.sol`
- Create: `contracts/test/mocks/MaliciousRecipient.sol`
- Create: `contracts/src/DemoMerchant.sol`

- [x] **Step 1: Add failing proposal lifecycle tests**

Add tests for:

```text
trusted low OKB -> Allow -> Executed
trusted low USDT0 -> Allow -> Executed
unknown or high amount -> Review -> PendingReview
blocked, paused, or over-budget -> Deny -> Rejected
owner approval -> fresh reevaluation -> execution
approval cannot override blocked/paused/over-budget
non-Allow reevaluation clears approval and remains PendingReview
approval expiry, proposal expiry, cancellation, and terminal replay rejection
reentrant native recipient cannot call Treasury again
failed native/ERC20 transfer rolls back proposal and spend
```

- [x] **Step 2: Run and verify the new tests fail**

Run: `forge test --root contracts --match-contract CircuitGuardTreasuryTest -vv`

Expected: FAIL at missing proposal methods.

- [x] **Step 3: Implement proposal storage and derivation**

`requestTransfer` accepts only `Asset`, recipient, `uint128 amount`, and `bytes32 memoHash`. Derive policy flags from Treasury state; never accept flags from calldata. Store the packed input byte, raw output byte, decision, and error in every proposal.

- [x] **Step 4: Implement state transitions**

Use constants:

```solidity
uint64 public constant PROPOSAL_LIFETIME = 24 hours;
uint32 public constant MAX_APPROVAL_DURATION = 30 minutes;
```

Only a fresh `Allow` calls `_execute`. A non-Allow approved execution clears approval and retains `PendingReview`. Terminal states cannot transition.

- [x] **Step 5: Implement transfer paths and Demo Merchant**

Use a single `_execute` function for both assets. Update state and spend before the external transfer under `nonReentrant`; rely on transaction rollback on failure. `DemoMerchant` emits `NativeOrderPaid(payer, amount, orderId)` from a payable OKB entry point and exposes read-only OKB/USDT0 balance helpers. Because ERC-20 `transfer` has no recipient callback, prove USDT0 delivery using the Treasury `TransferExecuted` event, token `Transfer` event, and merchant balance delta. The merchant has no Treasury privilege.

- [x] **Step 6: Run the complete lifecycle suite**

Run:

```bash
forge test --root contracts --match-contract CircuitGuardTreasuryTest -vv
forge test --root contracts -vv
```

Expected: all contract tests PASS.

- [x] **Step 7: Commit**

```bash
git add contracts/src contracts/test
git commit -m "feat: enforce circuit decisions on treasury transfers"
```

## Task 7: Add fuzz, invariant, and security regression coverage

**Files:**
- Create: `contracts/test/CircuitGuardInvariant.t.sol`
- Modify: `contracts/test/CircuitGuardTreasury.t.sol`

- [ ] **Step 1: Write invariants before handlers**

Define invariants that assert:

```solidity
CircuitGuardTreasury.Budget memory okb = treasury.currentBudget(Asset.OKB);
CircuitGuardTreasury.Budget memory usdt0 = treasury.currentBudget(Asset.USDT0);
assertLe(okb.spent, okb.dailyLimit);
assertLe(usdt0.spent, usdt0.dailyLimit);
assertEq(handler.executionsWhilePaused(), 0);
assertEq(handler.executionsToBlockedRecipient(), 0);
assertEq(handler.executionsWithoutAllow(), 0);
```

- [ ] **Step 2: Run and observe handler/setup failures**

Run: `forge test --root contracts --match-contract CircuitGuardInvariantTest -vv`

Expected: FAIL until the invariant handler is wired.

- [ ] **Step 3: Implement a bounded handler**

The handler may fund, request, approve, execute, pause, advance time, and change recipient status. Bound amounts to available balances and retain counters for forbidden executions.

- [ ] **Step 4: Run fuzz and invariant suites**

Run:

```bash
forge test --root contracts -vv
forge test --root contracts --match-contract CircuitGuardInvariantTest --fuzz-runs 1000
```

Expected: all tests PASS; no invariant failure after 1,000 runs.

- [ ] **Step 5: Generate coverage**

Run: `forge coverage --root contracts --report summary`

Expected: security-critical Treasury and Adapter branches are covered; any uncovered fail-closed branch receives a targeted test before commit.

- [ ] **Step 6: Commit**

```bash
git add contracts/test
git commit -m "test: add CircuitGuard fuzz and invariant coverage"
```

## Task 8: Add deterministic deployment and X Layer fork verification

**Files:**
- Create: `contracts/script/CreateProcessor.s.sol`
- Create: `contracts/script/TapeoutPolicy.s.sol`
- Create: `contracts/script/DeployCircuitGuard.s.sol`
- Create: `contracts/test/XLayerFork.t.sol`
- Create: `deployments/xlayer.json`

- [ ] **Step 1: Write the fork test against known X Layer infrastructure**

Assert Factory code exists at `0x1f09daefa827f02cbb40967cc91b259763760761`, USDT0 code exists at `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`, and USDT0 reports 6 decimals and symbol `USD₮0`.

- [ ] **Step 2: Run the fork test**

Run:

```bash
forge test --root contracts --match-contract XLayerForkTest --fork-url https://rpc.xlayer.tech -vv
```

Expected: infrastructure assertions PASS without sending a transaction.

- [ ] **Step 3: Implement quote-first Processor creation script**

`CreateProcessor.s.sol` must read `deployFee()`, log the exact value, and create:

```text
name: CircuitGuard Policy Foundry
symbol: CGPOL
supply: 1000000
mint price: 66000000000000 wei (0.000066 OKB)
```

The script must not contain a key or fixed nonce.

- [ ] **Step 4: Implement exact material/tapeout script**

`TapeoutPolicy.s.sol` reads material price, protocol fee, and tapeout fee; mints exactly 13 units of material ID `0`; calls `tapeout(CANONICAL_NETLIST, 6, 2)`; and logs the resulting Circuit ID.

- [ ] **Step 5: Implement contract deployment script**

`DeployCircuitGuard.s.sol` reads Processor, Circuit ID, owner, recovery address, and Agent from environment variables, deploys Adapter then Treasury and DemoMerchant, configures the merchant as trusted, and logs all addresses.

- [ ] **Step 6: Add an empty deployment schema, not fake addresses**

Create `deployments/xlayer.json`:

```json
{
  "schemaVersion": 1,
  "chainId": 196,
  "factory": "0x1f09daefa827f02cbb40967cc91b259763760761",
  "usdt0": "0x779Ded0c9e1022225f8E0630b35a9b54bE713736",
  "status": "not-deployed",
  "transactions": []
}
```

- [ ] **Step 7: Test scripts locally without broadcasting**

Run:

```bash
forge build --root contracts
forge test --root contracts -vv
```

Expected: compilation and all tests PASS; no mainnet transaction is sent.

- [ ] **Step 8: Commit**

```bash
git add contracts/script contracts/test/XLayerFork.t.sol deployments/xlayer.json
git commit -m "feat: add quote-first X Layer deployment scripts"
```

## Task 9: Implement frontend domain logic and deployment configuration

**Files:**
- Create: `web/src/domain/policy.ts`
- Create: `web/src/domain/amount.ts`
- Create: `web/src/generated/deployment.json`
- Create: `web/test/policy.test.ts`
- Create: `web/test/amount.test.ts`

- [ ] **Step 1: Write failing policy and amount tests**

Assert the same bit layout as Solidity, decision decoding, strict decimal parsing, no exponent notation, no negative values, maximum 6 decimals for USDT0, and maximum 18 decimals for OKB.

- [ ] **Step 2: Run and verify failure**

Run: `cd web && npm test -- --run`

Expected: FAIL because domain modules are missing.

- [ ] **Step 3: Implement policy encoding**

```typescript
export type PolicyFacts = {
  systemActive: boolean;
  recipientTrusted: boolean;
  recipientBlocked: boolean;
  amountLow: boolean;
  withinDailyBudget: boolean;
  humanApproved: boolean;
};

export const encodePolicyFacts = (facts: PolicyFacts): number =>
  Number(facts.systemActive) |
  (Number(facts.recipientTrusted) << 1) |
  (Number(facts.recipientBlocked) << 2) |
  (Number(facts.amountLow) << 3) |
  (Number(facts.withinDailyBudget) << 4) |
  (Number(facts.humanApproved) << 5);

export const decodeDecision = (value: number) =>
  value === 0 ? 'DENY' : value === 1 ? 'ALLOW' : value === 2 ? 'REVIEW' : 'INVALID';
```

- [ ] **Step 4: Implement strict amount parsing with viem**

Use `parseUnits` only after validating `/^(0|[1-9]\d*)(\.\d+)?$/`, rejecting excess fractional digits and zero. Export `parseAssetAmount(asset, text)` and `formatAssetAmount(asset, value)`.

- [ ] **Step 5: Add a non-deployed generated manifest**

Mirror `deployments/xlayer.json` into `web/src/generated/deployment.json`; the app must render an explicit “not deployed” state rather than invented addresses.

- [ ] **Step 6: Run tests and commit**

```bash
cd web && npm test -- --run
git add web/src/domain web/src/generated web/test
git commit -m "feat: add CircuitGuard frontend domain model"
```

## Task 10: Implement chain clients and transaction journal

**Files:**
- Create: `web/src/chain/abis.ts`
- Create: `web/src/chain/client.ts`
- Create: `web/src/state/transactionJournal.ts`
- Create: `web/test/transactionJournal.test.ts`

- [ ] **Step 1: Write failing journal tests**

Test pending insertion, receipt confirmation, reverted state, persistence round-trip, duplicate-hash rejection, and refusal to start a second transaction while one is unresolved.

- [ ] **Step 2: Run and verify failure**

Run: `cd web && npm test -- --run transactionJournal`

Expected: FAIL because the journal is missing.

- [ ] **Step 3: Define minimal ABIs**

Include only Treasury reads/writes/events, Adapter `health`, Processor `circuitInfo/netlist`, ERC-20 `balanceOf/allowance/approve`, and standard ownership/paused reads. Do not import a generated full ABI bundle into the client.

- [ ] **Step 4: Implement read-only and wallet clients**

`client.ts` creates a public X Layer client with `https://rpc.xlayer.tech`, requests the wallet only after user action, switches to chain `196`, and refuses to send if wallet and public clients disagree on chain or configured contract code.

- [ ] **Step 5: Implement bounded receipt polling**

Journal state is `pending | confirmed | reverted`; after timeout the entry remains pending. The UI must never automatically resubmit.

- [ ] **Step 6: Run tests and commit**

```bash
cd web && npm test -- --run
git add web/src/chain web/src/state web/test/transactionJournal.test.ts
git commit -m "feat: add X Layer clients and transaction journal"
```

## Task 11: Build the single-page dashboard and wallet flows

**Files:**
- Create: `web/src/hooks/useCircuitGuard.ts`
- Create: `web/src/components/VerificationBar.tsx`
- Create: `web/src/components/TreasuryPanel.tsx`
- Create: `web/src/components/ProposalForm.tsx`
- Create: `web/src/components/CircuitDecision.tsx`
- Modify: `web/src/app/App.tsx`
- Create: `web/src/styles.css`
- Create: `web/test/app.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Test read-only rendering, both balances/budgets, six named policy bits, ALLOW/REVIEW/DENY states, wrong-chain warning, no automatic wallet request, pending button lock, and experimental-risk banner.

- [ ] **Step 2: Run and verify failure**

Run: `cd web && npm test -- --run app.test.tsx`

Expected: FAIL because dashboard components are missing.

- [ ] **Step 3: Implement the read model hook**

`useCircuitGuard` reads deployment health, Treasury balances, budgets, owner, pause state, Adapter health, and selected proposal. It returns explicit `loading`, `ready`, `unavailable`, and `wrong-network` states; it never substitutes stale values after an RPC error.

- [ ] **Step 4: Implement the four focused components**

- `VerificationBar`: chain, Processor, Circuit, hash, Container, Adapter, Treasury, wallet.
- `TreasuryPanel`: separate OKB/USDT0 balances, limits, spend, owner/Agent warning.
- `ProposalForm`: fixed asset selector, recipient, amount, memo hash, three presets, preview then send.
- `CircuitDecision`: named inputs, packed byte, raw outputs, decision, policy error, proposal state.

- [ ] **Step 5: Implement approve/execute/cancel actions**

Show each wallet confirmation as a separate explicit action. Approval duration defaults to 10 minutes and cannot exceed the contract maximum. Refresh from chain after every confirmed receipt.

- [ ] **Step 6: Test, build, and enforce artifact constraints**

Run:

```bash
cd web && npm test -- --run
cd web && npm run build
find web/dist -name '*.map' -print
rg -n 'fonts\.googleapis|googletagmanager|cdn\.|api[_-]?key' web/dist || true
```

Expected: tests and build PASS; `find` prints nothing; scan finds no forbidden dependency.

- [ ] **Step 7: Commit**

```bash
git add web/src web/test
git commit -m "feat: build CircuitGuard verification dashboard"
```

## Task 12: Add browser demo coverage, CI, and release manifests

**Files:**
- Create: `web/playwright.config.ts`
- Create: `web/tests/demo.spec.ts`
- Create: `.github/workflows/ci.yml`
- Create: `scripts/build-deployment-manifest.mjs`

- [ ] **Step 1: Write Playwright tests for the three demo paths**

Use deterministic mocked JSON-RPC fixtures for browser CI and assert:

```text
trusted 3 USDT0 -> ALLOW
unknown 30 USDT0 -> REVIEW, approval controls visible
blocked recipient -> DENY, no execute control
trusted 0.01 OKB -> ALLOW with independent budget
```

- [ ] **Step 2: Run and fix the E2E tests**

Run:

```bash
cd web
npx playwright install chromium
npm run build
npx playwright test
```

Expected: all browser scenarios PASS.

- [ ] **Step 3: Implement manifest generation**

`build-deployment-manifest.mjs` validates chain ID, address format, canonical netlist hash, USDT0 address, required transaction hashes, and `status = deployed` before writing `web/src/generated/deployment.json`. It exits non-zero on a missing or malformed field.

- [ ] **Step 4: Add CI**

CI jobs run:

```text
node --test circuits/test/policy.test.mjs
forge test --root contracts -vv
cd web && npm ci && npm test -- --run && npm run build
```

Fork and mainnet-read tests remain opt-in because public RPC availability must not make ordinary CI flaky.

- [ ] **Step 5: Run the root verification suite**

Run: `make test && make build-web`

Expected: all local suites PASS.

- [ ] **Step 6: Commit**

```bash
git add .github web/playwright.config.ts web/tests scripts/build-deployment-manifest.mjs
git commit -m "test: add CircuitGuard browser and CI verification"
```

## Task 13: Mainnet deployment, readback, and contract verification

**Files:**
- Modify: `deployments/xlayer.json`
- Modify: `web/src/generated/deployment.json`
- Create: `docs/deployment.md`
- Create: `docs/security.md`

- [ ] **Step 1: Produce a read-only fee quote**

Query and record Factory deployment fee, material price/protocol fee, tapeout fee, DomainBinding monthly fee, current nonce, wallet balances, and estimated gas. Present the quote to the user. Do not broadcast.

- [ ] **Step 2: Obtain explicit authorization for the mainnet batch**

The authorization must cover Processor creation, 13 NAND mint, tapeout, Adapter/Treasury/Merchant deployment, limited funding, and name activation. If authorization is not granted, stop with the plan and local test evidence intact.

- [ ] **Step 3: Create Processor and verify provenance**

Run the Processor script with `--broadcast` only after authorization. Parse `CPUCreated`, then verify `factory.isCPU(processor)`, reciprocal Processor/material links, supply cap, mint price, and deployed bytecode.

- [ ] **Step 4: Mint and tape out the canonical policy**

Mint exactly 13 NAND units and tape out the 91-byte netlist. Parse `TapedOut`, read `circuitInfo` and `netlist`, compare the canonical hash, and run all 64 vectors through mainnet `step` at a pinned block.

- [ ] **Step 5: Deploy Adapter, Treasury, and Merchant**

Use the verified Processor and Circuit ID. Configure the specified owner, immutable recovery wallet, initial Agent, limits, and trusted merchant. Verify source code on the X Layer explorer when supported.

- [ ] **Step 6: Fund and execute evidence scenarios**

Fund only the reviewed demo amounts. Execute one ALLOW, one REVIEW, one approved execution, one OKB ALLOW, and one DENY. Confirm balances, spend, proposal states, and events.

- [ ] **Step 7: Write exact deployment evidence**

Replace `status: not-deployed` in `deployments/xlayer.json` with checksummed addresses, Processor index, Circuit ID, Container, netlist hash, block numbers, transaction hashes, bytecode/source verification links, dynamic fees paid, and demo evidence transactions. Generate the web manifest from this file.

- [ ] **Step 8: Run post-deployment fork/read tests**

Run:

```bash
node --test circuits/test/policy.test.mjs
forge test --root contracts --fork-url https://rpc.xlayer.tech -vv
cd web && npm test -- --run && npm run build
```

Expected: all tests PASS against the deployed identities.

- [ ] **Step 9: Commit deployment evidence**

```bash
git add deployments/xlayer.json web/src/generated/deployment.json docs/deployment.md docs/security.md
git commit -m "docs: record CircuitGuard X Layer deployment"
```

## Task 14: Publish and verify the TapeKit site

**Files:**
- Create: `scripts/build-site-manifest.mjs`
- Create: `scripts/verify-site.mjs`
- Create: `deployments/site-manifest.json`
- Modify: `deployments/xlayer.json`

- [ ] **Step 1: Implement deterministic site manifest generation**

The script walks `web/dist`, rejects symlinks, source maps, non-NFC paths, files above 8.4 MB, and forbidden remote assets; computes MIME type and SHA-256; and splits data into 24,000-byte chunks in the manifest.

- [ ] **Step 2: Test the manifest against the production build**

Run:

```bash
make build-web
node scripts/build-site-manifest.mjs web/dist deployments/site-manifest.json
```

Expected: manifest lists every artifact with non-zero hash and deterministic chunk indices.

- [ ] **Step 3: Open the Circuit Container**

Resolve `accountOf(processor, circuitId)`, compare with the deployment manifest, and use the official console/opener flow. Record the opening transaction.

- [ ] **Step 4: Publish files through SiteRegistry**

Use the official wallet-signed console or reviewed direct calls. For every file, call `putFile` with the first chunk and `appendChunk` with exact indices for the remainder. Do not activate the name until readback passes.

- [ ] **Step 5: Verify every byte from chain**

`verify-site.mjs` reads `fileInfo` and `readRange` from at least the OKX and dRPC operator groups, reconstructs each file, and compares size and SHA-256 with `site-manifest.json`. Any disagreement exits non-zero.

- [ ] **Step 6: Activate and verify the TapeKit name**

Query `monthlyFee()`, bind the computed `C.2.P.tape` name for 30 days, open the gateway and `/.tape/status`, and record the binding transaction and final URL.

- [ ] **Step 7: Commit publication evidence**

```bash
git add scripts/build-site-manifest.mjs scripts/verify-site.mjs deployments/site-manifest.json deployments/xlayer.json
git commit -m "feat: publish CircuitGuard as a verified TapeKit site"
```

## Task 15: Finish README, demo package, and submission checklist

**Files:**
- Create: `README.md`
- Create: `docs/architecture.md`
- Create: `docs/demo-script.md`
- Create: `docs/submission-checklist.md`

- [ ] **Step 1: Write the primary README**

Include product pitch, live URL, three-minute path, architecture, exact Processor economics, addresses, local commands, threat model summary, experimental warning, and an English-first/Chinese-summary structure.

- [ ] **Step 2: Write the architecture and security evidence**

Document six inputs, two outputs, canonical netlist/hash, Adapter checks, dual-asset accounting, proposal state machine, owner trust, unsealed TapeOut risk, USDT0 issuer risk, and why TapeSend is not required.

- [ ] **Step 3: Record the three-minute demo**

Follow the approved timing: verified site, automatic USDT0, reviewed USDT0, automatic OKB, blocked denial, evidence and limitations. Use the deployed transactions rather than simulated success screens.

- [ ] **Step 4: Complete the submission checklist**

Require Processor contract, deployment wallet, Circuit ID, Container, Adapter, Treasury, live demo, GitHub repository, public X post, video, supply/cap/price, and explicit limitations.

- [ ] **Step 5: Run final verification**

Run:

```bash
make test
make build-web
git diff --check
git status --short
```

Expected: all tests/builds PASS; no accidental secret, build artifact, or unrelated change is staged.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md docs/architecture.md docs/demo-script.md docs/submission-checklist.md
git commit -m "docs: complete CircuitGuard hackathon package"
```

## Final MVP verification gate

Do not start TapeSend until all items are true:

- [ ] Canonical circuit is 91 bytes, 13 NAND, 0 LATCH, hash `0xd722...c269`.
- [ ] Local and mainnet `step` pass all 64 vectors.
- [ ] Adapter fails closed for every malformed or reverted path.
- [ ] Treasury independently enforces OKB and USDT0 budgets.
- [ ] ALLOW, REVIEW, approved execution, and DENY evidence exists on X Layer.
- [ ] Contract, frontend, fork, invariant, and browser suites pass.
- [ ] Site bytes and SHA-256 match through independent X Layer operator groups.
- [ ] TapeKit URL and status page work without an application backend.
- [ ] README, video, X post, and submission fields contain all required addresses.
- [ ] UI and documentation disclose experimental, owner, TapeOut, RPC, and USDT0 risks.
