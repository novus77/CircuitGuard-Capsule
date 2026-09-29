# CircuitGuard Capsule — Product and Technical Design Specification

**Status:** Design approved for specification review

**Date:** 2026-09-29

**Target network:** X Layer mainnet (`chainId = 196`)

**Document language:** Chinese; code, ABI, identifiers, and event names use English

## 1. Executive Summary

CircuitGuard Capsule 是一个面向 AI Agent 和自动化程序的链上资金防火墙。Agent 可以提出付款请求，但只有当 TapeOut Policy Circuit 返回允许结果时，Treasury 才能转出资金。

项目同时展示 TapeOut/DeWEB 栈的三个核心能力：

1. **Policy as a Circuit**：资金策略以 TapeOut NAND Circuit 表达和执行。
2. **Verified frontend**：静态前端写入同一枚 Circuit NFT 的 ERC-6551 Container，由 TapeKit 从 X Layer 读取并校验 SHA-256。
3. **On-chain execution evidence**：请求、策略输入、Circuit 输出和付款结果均产生链上记录。

MVP 固定支持两种资产：

- X Layer 原生资产 OKB；
- X Layer USDT0，固定地址 `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`。

两种资产使用独立即时限额、日预算和消费统计，但共用同一枚 Policy Circuit。不接价格预言机，不允许调用者传入任意 ERC-20 地址。

TapeSend 是 stretch goal。核心资金流程不依赖 TapeSend、中心化 API、私有服务端或 API Key。

## 2. Product Positioning

### 2.1 One-line pitch

> CircuitGuard is an on-chain spending firewall for autonomous agents: agents decide what they want to buy, while a verifiable TapeOut circuit decides what they are allowed to pay.

### 2.2 Primary demonstration scenario

一个 AI Research Agent 使用受限预算购买数据和计算服务：

- 可信服务商的小额订单自动执行；
- 新服务商或大额订单进入人工复核；
- 被阻止地址、暂停状态或超预算订单直接拒绝。

### 2.3 Target users

- AI Agent developers；
- DAO operations teams；
- 自动采购、退款或赏金系统；
- DePIN、游戏 NPC 和机器支付应用；
- 需要把自动化决策与资金权限分离的组织。

### 2.4 Core value

- Agent compromise does not imply unlimited treasury access.
- Policy inputs are derived by the contract, not supplied by the Agent or frontend.
- The policy artifact, frontend container, and circuit identity are publicly inspectable.
- A modified frontend cannot silently impersonate the on-chain version when loaded through a conforming TapeKit shell.

## 3. Goals and Non-goals

### 3.1 Goals

- Deploy a Processor through the official X Layer TapeOut Factory.
- Publish transistor supply, cap, and mint price.
- Tape out at least one stateless Policy Circuit.
- Use the real on-chain `step` result to authorize or reject transfers.
- Support OKB and USDT0 with independent limits.
- Record `ALLOW`, `REVIEW`, and `DENY` outcomes on chain.
- Publish the web application into the Policy Circuit's own Container.
- Provide a reliable three-minute mainnet demonstration.
- Keep contracts small enough to audit during the hackathon.

### 3.2 Non-goals

- General-purpose smart account or account abstraction.
- ERC-4337, ERC-7702, session keys, or paymasters.
- Arbitrary ERC-20 support.
- Token swaps or price-oracle-based aggregate budgets.
- Arbitrary calldata or contract execution.
- Cross-chain asset movement.
- Upgradeable CircuitGuard contracts.
- Production custody of material funds.
- A hosted AI model or a fully autonomous LLM Agent.
- TapeSend as an approval or execution dependency.

## 4. Verified External Facts and Mainnet Constants

The following snapshot was rechecked on 2026-09-29. Dynamic fees must be queried again immediately before deployment.

| Item | Value |
|---|---|
| X Layer chain ID | `196` |
| Native gas token | `OKB` |
| Public RPC | `https://rpc.xlayer.tech` |
| Alternate public RPC | `https://xlayerrpc.okx.com` |
| TapeOut Factory | `0x1f09daefa827f02cbb40967cc91b259763760761` |
| Container Opener | `0x536add8f30f03b69f6fbf29d425a816a0dc50106` |
| SiteRegistry | `0xd6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6` |
| DomainBinding | `0x68809fd2fb343aa57d0aeb7f33defe477c9666f9` |
| USDT0 | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` |
| USDT0 symbol | `USD₮0` |
| USDT0 decimals | `6` |
| Factory `deployFee()` snapshot | `0.0066 OKB` |
| Processor `TAPEOUT_FEE()` observed value | `0.0013 OKB` |
| Material `protocolFee()` observed value | `0.00066 OKB` per non-zero mint call |
| DomainBinding `monthlyFee()` snapshot | `0.026 OKB` per 30 days |
| Factory `cpuCount()` snapshot | `252` |

The current TapeOut X Layer deployment is experimental. The factory and related implementations are not independently audited or sealed at the time of this design. CircuitGuard must therefore be presented as a hackathon prototype using limited funds, not as production custody infrastructure.

## 5. System Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ TapeKit Gateway / Kernel                                     │
│ Resolves circuit name, reads SiteRegistry, verifies hashes   │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ CircuitGuard Web App                                         │
│ Preact + TypeScript + viem; static assets only               │
└──────────────────────────────┬───────────────────────────────┘
                               │ wallet transaction / eth_call
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ CircuitGuardTreasury                                         │
│ - Holds OKB and USDT0                                        │
│ - Derives trusted policy inputs                              │
│ - Tracks independent budgets                                 │
│ - Stores proposals and approvals                             │
└──────────────────────────────┬───────────────────────────────┘
                               │ evaluate(inputs)
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ TapeOutPolicyAdapter                                         │
│ - Pins Processor, Circuit ID, netlist hash                   │
│ - Packs six input bits                                       │
│ - Calls Processor.step(...)                                  │
│ - Decodes and validates two output bits                      │
└──────────────────────────────┬───────────────────────────────┘
                               │ step(circuitId, 0x, inputs)
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ TapeOut Policy Circuit                                       │
│ 6 inputs → NAND netlist → 2 outputs; no LATCH state          │
└──────────────────────────────────────────────────────────────┘
```

### 5.1 Architectural decisions

- `CircuitGuardTreasury` and `TapeOutPolicyAdapter` are non-upgradeable.
- Processor address, Circuit ID, expected netlist hash, and USDT0 address are immutable.
- Emergency recovery address is immutable and cannot be selected at withdrawal time.
- Replacing the policy requires deploying a new Adapter and Treasury.
- The Adapter is separated from the Treasury so TapeOut encoding and provenance checks remain independently testable.
- A single Treasury supports exactly `OKB` and `USDT0`; no arbitrary token address enters the transfer path.
- Recipient trust status is shared across both assets; spending limits are per asset.

## 6. TapeOut Processor and Asset Design

### 6.1 Processor parameters

| Parameter | Decision |
|---|---|
| Name | `CircuitGuard Policy Foundry` |
| Symbol | `CGPOL` |
| Story | `Verifiable spending policies for autonomous agents and DeWEB treasuries.` |
| Shared NAND/LATCH supply cap | `1,000,000` units |
| Material mint price | `0.000066 OKB` per unit |

The price and cap are fixed at Processor creation and disclosed in the README, submission, and demo. The Factory's dynamic deployment fee and protocol fees are not controlled by CircuitGuard and are quoted from chain before signing.

### 6.2 Policy Circuit constraints

- `nIn = 6`
- `nOut = 2`
- `nState = 0`
- NAND-only netlist; no LATCH material required.
- Exact gate count: `13 NAND`, `0 LATCH`.
- Inputs and outputs use TapeOut's little-endian bit packing: bit 0 is the least significant bit of the first byte.
- All 64 input combinations must match the reference truth table before and after tapeout.

## 7. Policy Circuit Specification

### 7.1 Input bits

| Bit | Identifier | Meaning | Source |
|---:|---|---|---|
| 0 | `systemActive` | Treasury is not paused | `!paused()` |
| 1 | `recipientTrusted` | Recipient status is `Trusted` | Treasury storage |
| 2 | `recipientBlocked` | Recipient status is `Blocked` | Treasury storage |
| 3 | `amountLow` | Amount does not exceed the selected asset's instant limit | Asset budget config |
| 4 | `withinDailyBudget` | Current spend plus amount does not exceed the selected asset's daily limit | Asset accounting |
| 5 | `humanApproved` | Proposal has an unexpired owner approval | Proposal storage |

The frontend and Agent never submit these bits. They submit only asset, recipient, amount, and an optional memo hash. The Treasury derives all six bits from current on-chain state.

### 7.2 Output bits

| Packed bits | `allow` | `review` | Decision |
|---|---:|---:|---|
| `00` | 0 | 0 | `DENY` |
| `01` | 1 | 0 | `ALLOW` |
| `10` | 0 | 1 | `REVIEW` |
| `11` | 1 | 1 | Invalid; fail closed |

### 7.3 Boolean policy

```text
hardOk = systemActive
         AND NOT recipientBlocked
         AND withinDailyBudget

allow = hardOk
        AND (humanApproved
             OR (recipientTrusted AND amountLow))

review = hardOk AND NOT allow
```

The canonical NAND graph is fixed as follows. `g11` and `g12` are deliberately emitted last because TapeOut treats the final `nOut` signals as outputs.

```text
g0  = NAND(recipientBlocked, recipientBlocked)  // notBlocked
g1  = NAND(systemActive, g0)
g2  = NAND(g1, g1)                              // activeAndNotBlocked
g3  = NAND(g2, withinDailyBudget)
g4  = NAND(g3, g3)                              // hardOk

g5  = NAND(recipientTrusted, amountLow)         // notTrustedAndLow
g6  = NAND(humanApproved, humanApproved)         // notApproved
g7  = NAND(g6, g5)                              // eligible
g8  = NAND(g7, g7)                              // notEligible

g9  = NAND(g4, g7)                              // notAllow
g10 = NAND(g4, g8)                              // notReview
g11 = NAND(g9, g9)                              // output bit 0: allow
g12 = NAND(g10, g10)                            // output bit 1: review
```

This graph was exhaustively checked against the Boolean policy for all 64 input combinations. The implementation must serialize this exact graph deterministically; a different netlist requires a new reviewed hash even if it claims equivalent behavior.

TapeOut reserves signal `0` for false and signal `1` for true. The six inputs occupy signals `2...7`; the 13 NAND outputs occupy signals `8...20`; final signals `19` and `20` are therefore output bits 0 and 1. A NAND record is `0x00` followed by two big-endian `uint24` signal IDs, so the canonical 91-byte netlist is:

```text
0x0000000400000400000002000008000000090000090000000a0000060000000b00000b00000003000005000000070000070000000e00000d0000000f00000f0000000c00000f0000000c0000100000001100001100000012000012
```

Its expected `keccak256` is:

```text
0xd722aa6af62aa44c485ec471d4234803c859aec19684caa2a510bdca1675c269
```

The tapeout and Adapter deployment must reject any byte sequence or hash that differs from these values.

Consequences:

- Paused, blocked, or over-budget requests are always denied.
- Human approval cannot override hard constraints.
- Trusted low-value requests are automatically allowed.
- Unknown recipients and high-value requests enter review when hard constraints pass.
- A contradictory `Trusted + Blocked` state is impossible in Treasury storage, but the truth table still treats `Blocked` as dominant.

### 7.4 Packing

Conceptual encoder:

```solidity
uint8 flags = 0;
flags |= systemActive       ? 1 << 0 : 0;
flags |= recipientTrusted   ? 1 << 1 : 0;
flags |= recipientBlocked   ? 1 << 2 : 0;
flags |= amountLow          ? 1 << 3 : 0;
flags |= withinDailyBudget  ? 1 << 4 : 0;
flags |= humanApproved      ? 1 << 5 : 0;

bytes memory inputs = abi.encodePacked(bytes1(flags));
```

The Adapter calls:

```solidity
step(circuitId, hex"", inputs)
    returns (bytes memory newState, bytes memory outputs)
```

Acceptance requirements:

- `newState.length == 0`
- `outputs.length == 1`
- `(uint8(outputs[0]) & 0xFC) == 0`
- output `0b11` is invalid and never authorizes a transfer.

## 8. Smart Contract Design

### 8.1 Contract set

```text
contracts/
├── CircuitGuardTreasury.sol
├── TapeOutPolicyAdapter.sol
├── DemoMerchant.sol
├── interfaces/
│   ├── ITapeOutFactory.sol
│   ├── ITapeOutProcessor.sol
│   └── IPolicyAdapter.sol
└── libraries/
    └── PolicyCodec.sol
```

OpenZeppelin dependencies:

- `Ownable2Step`
- `Pausable`
- `ReentrancyGuard`
- `SafeERC20`

### 8.2 Supported assets

```solidity
enum Asset {
    OKB,
    USDT0
}
```

Rules:

- `Asset.OKB` uses native value transfer.
- `Asset.USDT0` always resolves to the immutable X Layer USDT0 address.
- No public method accepts a token address for payment.
- USDT0 amounts use 6 decimals; OKB uses 18 decimals.
- Limits and spend counters are never converted between assets.

### 8.3 Recipient status

```solidity
enum RecipientStatus {
    Unknown,
    Trusted,
    Blocked
}
```

A single enum prevents a recipient from being simultaneously trusted and blocked. Status applies to both assets.

### 8.4 Budget model

Each asset has independent state:

```solidity
struct Budget {
    uint128 instantLimit;
    uint128 dailyLimit;
    uint128 spent;
    uint64 epochDay;
}
```

- `epochDay = uint64(block.timestamp / 1 days)`.
- The counter resets lazily when the observed day differs from `epochDay`.
- `withinDailyBudget` is true only when `spent + amount <= dailyLimit` without overflow.
- Pending review proposals do not reserve budget.
- Budget is checked again immediately before execution.
- Default demo configuration:

| Asset | Instant limit | Daily limit |
|---|---:|---:|
| OKB | `0.02 OKB` | `0.10 OKB` |
| USDT0 | `10 USDT0` | `100 USDT0` |

### 8.5 Proposal model

```solidity
enum Decision {
    Deny,
    Allow,
    Review,
    Invalid
}

enum PolicyError {
    None,
    NetlistMismatch,
    StepReverted,
    StateMismatch,
    OutputMalformed
}

enum ProposalState {
    PendingReview,
    Executed,
    Rejected,
    Cancelled,
    Expired
}
```

Each proposal records:

- monotonically increasing ID;
- requesting Agent;
- asset;
- recipient;
- amount;
- `memoHash` only, not arbitrary text;
- creation and expiry timestamps;
- latest derived input byte;
- latest Circuit output byte;
- latest decision;
- latest Policy error code;
- state;
- approval expiry timestamp.

Proposal lifetime is 24 hours. Owner approval is valid for at most 30 minutes. These values are contract constants in MVP.

### 8.6 Request flow

`requestTransfer(asset, recipient, amount, memoHash)`:

1. Require `msg.sender` to be an authorized Agent.
2. Validate non-zero recipient and amount.
3. Validate amount fits `uint128`.
4. Validate current Treasury balance is sufficient.
5. Derive six policy bits with `humanApproved = false`.
6. Call `TapeOutPolicyAdapter.evaluate`.
7. Store the proposal and evidence.
8. Branch:
   - `ALLOW`: update spend and state, then transfer;
   - `REVIEW`: set `PendingReview`, move no funds;
   - `DENY`: set `Rejected`, move no funds;
   - invalid Adapter/Circuit result: set `Rejected` with `Invalid` and a non-zero `PolicyError`, move no funds.

Unauthorized or malformed requests revert. Valid policy denials do not revert, so their evidence remains on chain.

### 8.7 Approval and execution

- `approveProposal(id, approvalDuration)` is `onlyOwner` and accepts only a live `PendingReview` proposal.
- `approvalDuration` must be greater than zero and no more than 30 minutes.
- Approval never transfers funds.
- `executeApproved(id)` can be called by the owner or an authorized Agent.
- Execution derives all inputs again using current recipient status, pause state, budget, balance, and approval expiry.
- Only a fresh `ALLOW` can transfer funds.
- If re-evaluation does not return `ALLOW`, the approval is cleared and the proposal stays `PendingReview`; a new explicit approval is required.
- Owner or original Agent can cancel a pending proposal.
- Anyone can mark a proposal expired after its 24-hour lifetime.

This design prevents stale approval from silently becoming executable after a policy or recipient-status change.

### 8.8 Transfer mechanics

OKB:

```solidity
(bool success, ) = recipient.call{value: amount}("");
if (!success) revert NativeTransferFailed();
```

USDT0:

```solidity
USDT0.safeTransfer(recipient, amount);
```

Both paths execute under `nonReentrant`. Spend and proposal state are updated before the external transfer; a transfer revert rolls the entire transaction back.

### 8.9 Funding

- `receive()` accepts OKB and emits `TreasuryFunded`.
- `depositUSDT0(amount)` uses `safeTransferFrom` and verifies the balance delta equals `amount`.
- Direct USDT0 transfers to the Treasury are accepted by the token contract but cannot emit a Treasury funding event; the UI reads the actual balance.

### 8.10 Administration

Owner may:

- authorize or remove Agents;
- change recipient status;
- change per-asset limits;
- pause or unpause;
- approve or cancel proposals;
- set a two-step owner through `Ownable2Step`;
- perform emergency recovery only while paused and only to the immutable `recoveryAddress`.

The owner cannot choose an arbitrary recovery recipient during an emergency call. `recoveryAddress` is non-zero, fixed in the Treasury constructor, and should be a project multisig or fresh recovery wallet. Emergency recovery is outside Policy Circuit control and is an explicit trust assumption. The owner is governance, not an untrusted Agent. A production deployment should use a multisig or timelocked owner.

`Pausable` is used as policy state, not as a `whenNotPaused` gate on `requestTransfer`. An authorized Agent may submit while paused, but the derived `systemActive = false` forces a recorded `DENY`. No transfer can execute while paused.

### 8.11 Policy Adapter

Constructor immutables:

- Factory address;
- Processor address;
- Circuit ID;
- expected netlist `keccak256`;
- expected `nIn = 6`;
- expected `nOut = 2`;
- expected `nState = 0`;
- expected gate count `13`.

Adapter result:

```solidity
struct PolicyEvaluation {
    Decision decision;
    uint8 outputs;
    PolicyError error;
}
```

`outputs = 0xFF` when no well-formed one-byte output exists. `PolicyError.None` is valid only for the three well-formed decisions `Deny`, `Allow`, and `Review`.

Deployment validation:

1. `factory.isCPU(processor) == true`.
2. `processor.ownerOf(circuitId)` succeeds.
3. `circuitInfo(circuitId)` matches the expected metadata.
4. `keccak256(processor.netlist(circuitId))` matches the expected hash.

Runtime validation:

- Re-read and hash the small netlist before evaluation.
- Call `step` in `try/catch`.
- Validate state and output lengths.
- Reject high output bits and `0b11`.
- Return `Invalid` plus a specific `PolicyError` rather than authorizing on any error.

The Adapter cannot protect against a protocol-level upgrade that changes `step` semantics while preserving the same external ABI. Until the TapeOut factory and circuit implementation are sealed and audited, limited demo funds are mandatory.

### 8.12 Events

Required event set:

```solidity
event AgentAuthorizationChanged(address indexed agent, bool authorized);
event RecipientStatusChanged(address indexed recipient, RecipientStatus status);
event BudgetChanged(Asset indexed asset, uint128 instantLimit, uint128 dailyLimit);
event TreasuryFunded(Asset indexed asset, address indexed from, uint256 amount);
event ProposalCreated(
    uint256 indexed proposalId,
    address indexed agent,
    Asset indexed asset,
    address recipient,
    uint256 amount,
    bytes32 memoHash
);
event PolicyEvaluated(
    uint256 indexed proposalId,
    uint8 inputs,
    uint8 outputs,
    Decision decision,
    PolicyError error
);
event ProposalApproved(uint256 indexed proposalId, uint64 approvalExpiresAt);
event ProposalCancelled(uint256 indexed proposalId);
event ProposalExpired(uint256 indexed proposalId);
event TransferExecuted(
    uint256 indexed proposalId,
    Asset indexed asset,
    address indexed recipient,
    uint256 amount
);
event EmergencyRecovery(Asset indexed asset, address indexed recipient, uint256 amount);
```

### 8.13 Public interface

The MVP contract surface is intentionally small:

```solidity
constructor(
    address initialOwner,
    address recoveryAddress,
    address usdt0,
    address policyAdapter,
    address initialAgent,
    uint128 okbInstantLimit,
    uint128 okbDailyLimit,
    uint128 usdt0InstantLimit,
    uint128 usdt0DailyLimit
);

receive() external payable;

function depositUSDT0(uint256 amount) external;

function requestTransfer(
    Asset asset,
    address recipient,
    uint128 amount,
    bytes32 memoHash
) external returns (uint256 proposalId);

function approveProposal(uint256 proposalId, uint32 approvalDuration) external;
function executeApproved(uint256 proposalId) external;
function cancelProposal(uint256 proposalId) external;
function expireProposal(uint256 proposalId) external;

function setAgent(address agent, bool authorized) external;
function setRecipientStatus(address recipient, RecipientStatus status) external;
function setBudget(Asset asset, uint128 instantLimit, uint128 dailyLimit) external;
function pause() external;
function unpause() external;
function emergencyRecover(Asset asset, uint128 amount) external;

function previewRequest(
    Asset asset,
    address recipient,
    uint128 amount
) external view returns (uint8 inputs, PolicyEvaluation memory evaluation);

function previewProposal(
    uint256 proposalId
) external view returns (uint8 inputs, PolicyEvaluation memory evaluation);

function assetBalance(Asset asset) external view returns (uint256);
function currentBudget(Asset asset) external view returns (Budget memory);
function getProposal(uint256 proposalId) external view returns (Proposal memory);
```

Administrative functions are `onlyOwner`; request execution functions enforce the Agent/owner rules defined above; transfer-bearing functions are `nonReentrant`. `emergencyRecover` accepts an exact amount and always sends to the immutable recovery address. There is no magic “all funds” sentinel and no normal owner withdrawal method.

Adapter interface:

```solidity
function evaluate(uint8 inputs)
    external
    view
    returns (PolicyEvaluation memory);

function health()
    external
    view
    returns (
        bool healthy,
        bytes32 currentNetlistHash,
        uint32 nIn,
        uint32 nOut,
        uint32 nState,
        uint32 gateCount
    );
```

The exact Solidity representation of return structs may be flattened if required for ABI ergonomics, but the information and validation semantics cannot be removed.

### 8.14 Demo Merchant

`DemoMerchant` is not part of the security boundary. It accepts OKB and USDT0 payments and emits a human-readable order event so the demo can prove that funds reached the intended service endpoint.

It must not call back into the Treasury, hold privileged roles, or be required for ordinary recipient payments. The reentrancy test suite includes a separate malicious recipient contract rather than adding adversarial behavior to `DemoMerchant`.

## 9. Proposal State Machine

```text
requestTransfer
      │
      ├── ALLOW ───────────────────────────────→ Executed
      │
      ├── DENY / Invalid ──────────────────────→ Rejected
      │
      └── REVIEW ─→ PendingReview
                           │
                           ├── approve → execute → ALLOW → Executed
                           │                    └→ not ALLOW → PendingReview
                           ├── cancel ─────────────────────→ Cancelled
                           └── 24h elapsed ─────────────────→ Expired
```

Terminal states are immutable. No executed, rejected, cancelled, or expired proposal can be reused.

## 10. Web Application Design

### 10.1 Technology

- Vite
- Preact
- TypeScript
- viem
- CSS bundled locally
- Vitest for unit tests
- Playwright for the critical demo path

Reasons for Preact + viem:

- smaller static bundle than a Next.js/wagmi stack;
- no server runtime or SSR assumptions;
- explicit wallet and RPC state handling;
- tree-shakable ABI clients;
- easier publication through SiteRegistry.

### 10.2 Runtime modes

1. **Read-only mode**
   - use the configured X Layer public RPC;
   - show balances, budgets, policy identity, and historical proposals;
   - never request wallet access on page load.

2. **Wallet mode**
   - request wallet only after an explicit user action;
   - require `chainId = 196` before signing;
   - use wallet transport for transactions;
   - cross-check immutable deployment metadata against read-only RPC data.

### 10.3 Single-page layout

#### Verification Bar

- TapeKit site identity;
- X Layer chain ID;
- Processor address;
- Circuit ID and netlist hash;
- Circuit Container address;
- Treasury and Adapter addresses;
- connected wallet and chain;
- paused/running state.

#### Treasury panel

- OKB and USDT0 balances;
- instant limits;
- daily limits and spend;
- authorized Agent;
- owner and recovery trust notice.

#### Agent Proposal panel

- fixed asset selector: OKB or USDT0;
- recipient;
- amount;
- local memo hashed to `bytes32`;
- presets for trusted-small, unknown-large, and blocked-recipient scenarios;
- preview before transaction.

#### Circuit Decision panel

- six named input bits;
- packed input byte;
- two output bits;
- decoded decision;
- proposal state;
- transaction hash and copy buttons.

### 10.4 Static publication rules

- Root `index.html`.
- Relative asset paths only.
- No external fonts, analytics, CDN scripts, remote images, or API keys.
- No source maps in the production artifact.
- No hard-coded third-party application backend.
- Chain reads may use X Layer public RPCs permitted by TapeKit policy.
- External explorer links are omitted from the on-chain build to preserve a clean DeWEB status; transaction hashes remain copyable.
- The repository README may contain explorer links.

Suggested artifact layout:

```text
dist/
├── index.html
├── assets/app.js
├── assets/app.css
└── deployment.json
```

`deployment.json` contains chain ID, Factory, Processor, Circuit ID, netlist hash, Container, Adapter, Treasury, USDT0, and deployment transaction hashes. It contains no secret or mutable server URL.

### 10.5 Transaction UX

- Simulate before prompting the wallet.
- Show exact asset, recipient, amount, and expected decision.
- Keep a local pending-transaction journal.
- Never offer a resend while the original transaction is unresolved.
- Poll receipts with a bounded timeout; after timeout, retain the hash as pending.
- Re-read proposal state from chain after confirmation.
- Decode custom errors into actionable messages.

## 11. TapeKit and Container Publication

The Policy Circuit NFT's own ERC-6551 Container hosts the application.

Publication sequence:

1. Tape out the Policy Circuit.
2. Resolve its Container through `accountOf(processor, circuitId)`.
3. Open the Container through the official console/opener flow.
4. Build the final static application after all deployment addresses are known.
5. Compute SHA-256 for every file.
6. Upload first chunks through `SiteRegistry.putFile`.
7. Upload remaining 24,000-byte chunks through `appendChunk` with strict indices.
8. Set fallback to `index.html` only if client-side routes are introduced; the MVP uses a single route and does not require fallback.
9. Read every file back from multiple X Layer node operators and compare bytes and SHA-256.
10. Query `DomainBinding.monthlyFee()` and activate the computed tape name.
11. Verify the gateway `/.tape/status` page before publishing the demo URL.

X Layer TapeKit naming follows the area-code form. If the Circuit ID is `C` and Processor factory index is `P`, the name is:

```text
C.2.P.tape
```

The official HTTPS gateway form is expected to be:

```text
https://C-2-P.tapekit.org/
```

Final names are derived after Processor and Circuit creation; they are deployment outputs, not configurable product settings.

## 12. Error Handling and Fail-closed Rules

| Failure | Required behavior |
|---|---|
| Wrong chain | Disable signing; offer explicit switch to X Layer |
| Wallet unavailable | Remain in read-only mode |
| Public RPC unavailable | Show unavailable state; do not fabricate cached balances |
| Wallet/public RPC disagreement | Stop before signing and ask the user to refresh/review |
| Adapter call reverts | Record `Invalid` with `PolicyError.StepReverted`; never transfer |
| Netlist hash mismatch | Return `Invalid`; surface critical policy health warning |
| Malformed Circuit output | Return `Invalid`; never transfer |
| Treasury balance insufficient | Revert before creating an executable proposal |
| USDT0 transfer reverts/freezes | Entire execution reverts; budget and proposal remain unchanged |
| Native recipient rejects OKB | Entire execution reverts |
| Proposal approval expires | Re-evaluation cannot set `humanApproved`; require new approval |
| Budget or recipient config changes | Execution uses new state, not creation-time state |
| Receipt timeout | Keep transaction pending; do not encourage resubmission |
| TapeKit node disagreement | Shell refuses the inconsistent content according to TapeKit policy |

## 13. Security Model

### 13.1 Protected against

- Compromised or malfunctioning Agent attempting unauthorized transfers.
- Agent-supplied forged policy flags.
- Spending beyond per-asset instant or daily limits.
- Payments to blocked recipients.
- Stale approvals after state changes.
- Reentrancy during native-token payment.
- Accidental arbitrary-token or fake-USDT selection.
- Silent frontend-byte substitution in a conforming TapeKit shell.
- Circuit netlist substitution under the same configured ID.

### 13.2 Explicit trust assumptions

- The owner can change Agents, recipient status, limits, pause state, and perform emergency recovery.
- X Layer sequencer and RPC availability affect liveness.
- TapeOut X Layer infrastructure is currently unsealed and not independently audited.
- A protocol upgrade could alter Circuit execution semantics.
- USDT0 is an issuer-controlled, potentially upgradeable/freezable asset.
- TapeKit gateway/bootstrap availability affects convenient browser access, although the files remain readable from chain.
- The Circuit NFT holder controls frontend updates in its Container.

### 13.3 Operational limits

- Use only small demonstration balances.
- Show an experimental-risk banner in the UI and README.
- Never describe the MVP as audited, immutable, trustless, or production-ready.
- Verify deployed source and publish all addresses and hashes.
- Use a fresh project wallet or multisig with no unrelated assets.

## 14. Testing Strategy

### 14.1 Circuit tests

- Exhaustively evaluate all 64 input combinations locally.
- Assert output matches the Boolean specification.
- Assert outputs never equal `0b11`.
- Assert `nState = 0` and no LATCH opcodes.
- Assert gate count is exactly 13.
- After tapeout, execute all 64 vectors through mainnet `step` at a pinned block.
- Compare local output, mainnet output, metadata, and netlist hash.

### 14.2 Contract unit tests

- Both assets: trusted low payment executes.
- Both assets: unknown recipient enters review.
- Both assets: high amount enters review.
- Both assets: blocked recipient is denied.
- Pause dominates every other input.
- Daily budget dominates human approval.
- Owner approval allows unknown/high requests only while hard constraints pass.
- Approval expiry clears the effective approval bit.
- Pending proposals do not reserve budget.
- Day rollover resets each asset independently.
- OKB and USDT0 counters never affect each other.
- Unauthorized Agent and owner calls revert.
- Zero recipient, zero amount, overflow amount, and insufficient balance fail.
- Circuit revert, malformed state, high output bits, and `0b11` fail closed.
- Native recipient reentrancy cannot create or execute a second transfer.
- USDT0 false-return/revert mocks roll back all state.
- Terminal proposals cannot be replayed.
- Emergency recovery is impossible while unpaused.

### 14.3 Fuzz and invariant tests

- `spent(asset) <= dailyLimit(asset)` after every successful call.
- No executed proposal has a blocked recipient at execution time.
- No transfer executes while paused.
- Every successful transfer has exactly one preceding valid `ALLOW` evaluation in the same transaction.
- Executed amount equals the amount deducted from the corresponding Treasury asset balance, excluding independently received funds in the test model.
- Proposal IDs are strictly monotonic and terminal states never change.

### 14.4 Fork and mainnet-read tests

- X Layer fork test against the deployed Policy Circuit.
- Factory registration and Processor/material reciprocal link.
- Circuit metadata and netlist hash.
- USDT0 symbol, decimals, code presence, and transfer behavior using funded fork state.
- TapeKit Container resolution and SiteRegistry file hashes.

### 14.5 Frontend tests

- Input and output bit rendering.
- Decimal parsing for 18-decimal OKB and 6-decimal USDT0.
- Wrong-chain and no-wallet states.
- Preview/result consistency.
- Pending transaction recovery.
- Proposal state transitions.
- Read-only rendering from an RPC fixture.
- Playwright happy paths for `ALLOW`, `REVIEW → approval → ALLOW`, and `DENY`.
- Production build contains no source maps, private keys, API keys, remote fonts, analytics, or CDN scripts.

## 15. Acceptance Criteria

### 15.1 On-chain

- Processor created by the official X Layer Factory.
- Processor supply cap and mint price match this Spec.
- Policy Circuit taped out with `6/2/0` metadata.
- Netlist and all 64 vectors verified against mainnet.
- Adapter pins Processor, Circuit ID, and netlist hash.
- Treasury holds and transfers both OKB and USDT0.
- Mainnet evidence exists for at least one `ALLOW`, one `REVIEW`, and one `DENY`.

### 15.2 DeWEB

- Static app stored in the Policy Circuit Container.
- Every published file has a non-zero SHA-256 declaration.
- Every byte reads back and hashes correctly through TapeKit.
- The tape name is active for at least 30 days.
- Gateway status reports no missing or incomplete file.
- No application backend is required for the three-minute demo.

### 15.3 Submission

- Public repository.
- English primary README with a concise Chinese section.
- Architecture, threat model, deployed addresses, fees, processor economics, and limitations documented.
- Public demo URL and optional conventional HTTPS mirror.
- Three-minute video.
- Public X post.
- Submission form contains Processor, wallet, Circuit, Container, Adapter, Treasury, demo, repository, and description.

## 16. Deployment Sequence

1. Build and exhaustively test the local NAND netlist.
2. Query Factory `deployFee()` and create `CircuitGuard Policy Foundry`.
3. Read back Processor and material addresses; verify reciprocal links.
4. Query material price, protocol fee, inventory, and tapeout fee.
5. Mint exactly 13 NAND material units; mint no LATCH material.
6. Tape out with `tapeout(netlist, 6, 2)`.
7. Parse `TapedOut`, read back the Circuit, and verify all 64 vectors.
8. Resolve and open the Circuit Container.
9. Deploy `TapeOutPolicyAdapter` with pinned provenance.
10. Deploy `CircuitGuardTreasury` with owner, initial Agents, Adapter, and USDT0.
11. Configure recipient statuses and independent asset budgets.
12. Fund with limited OKB and USDT0.
13. Execute and record the three demonstration scenarios.
14. Generate `deployment.json` from verified receipts and addresses.
15. Build and test the static web artifact.
16. Upload files to SiteRegistry and read them back.
17. Activate the tape name using the current on-chain monthly fee.
18. Verify TapeKit status and record the demo video.

Every state-changing step requires an explicit quote/review in the deployment tooling. Pending transactions block duplicate sends until their receipts are resolved.

## 17. Three-minute Demo Script

### 0:00–0:30 — Verifiable application

- Open the TapeKit URL.
- Show X Layer, Processor, Circuit ID, Container, netlist hash, and Treasury.
- Explain that the frontend and policy share the same Circuit identity.

### 0:30–1:05 — Automatic USDT0 payment

- Select `Trusted Data Provider`.
- Request `3 USDT0`.
- Show six inputs, output `01`, and `ALLOW`.
- Confirm `TransferExecuted` and updated USDT0 spend.

### 1:05–1:45 — Human-reviewed USDT0 payment

- Select an unknown provider and request `30 USDT0`.
- Show output `10` and `REVIEW`.
- Owner approves for a short window.
- Re-evaluate and execute; show that the fresh Circuit result is required.

### 1:45–2:15 — Automatic OKB payment

- Select a trusted provider and request `0.01 OKB`.
- Show independent OKB limits and spend.
- Execute with the same Policy Circuit.

### 2:15–2:40 — Hard denial

- Select a blocked address with either asset.
- Show `recipientBlocked = 1`, output `00`, and `DENY`.
- Explain that owner approval cannot override hard constraints.

### 2:40–3:00 — Evidence and limitations

- Show the on-chain evidence summary and addresses.
- State that TapeSend is a future notification layer, not an execution dependency.
- State that the current deployment is experimental and uses limited funds.

## 18. Repository Structure

```text
.
├── README.md
├── docs/
│   ├── architecture.md
│   ├── deployment.md
│   ├── security.md
│   └── superpowers/specs/
│       └── 2026-09-29-circuitguard-capsule-design.md
├── circuits/
│   ├── policy.json
│   ├── truth-table.json
│   ├── compiler/
│   └── test/
├── contracts/
│   ├── foundry.toml
│   ├── src/
│   ├── script/
│   └── test/
├── web/
│   ├── src/
│   ├── public/
│   ├── test/
│   └── vite.config.ts
└── deployments/
    └── xlayer.json
```

The final implementation plan may split documentation differently, but the boundaries between circuit compiler, contracts, web app, and deployment evidence must remain explicit.

## 19. TapeSend Stretch Goal

TapeSend integration starts only after every MVP acceptance criterion passes.

Permitted additions:

- Notify an administrator Container when a proposal enters `REVIEW`.
- Send encrypted execution/rejection receipts.
- Display source chain, finality, Hub implementation, and seal warnings.

Forbidden coupling:

- Treasury never waits for a TapeSend message to execute.
- TapeSend messages never directly authorize funds.
- A TapeSend outage never blocks proposal creation, owner approval through the web app, or execution.
- Cross-chain messages are described as client-read communication, not cross-chain contract calls.

No Treasury contract change is required. A client-side notifier can observe events and send messages later.

## 20. Cost and Schedule

### 20.1 Development estimate

| Workstream | Estimate |
|---|---:|
| Circuit compiler/netlist, truth table, tapeout verification | 1.0–1.5 days |
| Adapter and Treasury contracts, unit/fuzz/invariant tests | 2.0–2.5 days |
| Preact web app and transaction UX | 1.5–2.0 days |
| Mainnet deployment and Container publication | 0.5–1.0 day |
| README, security review, video, submission buffer | 1.0–1.5 days |
| Total MVP | 6.0–8.5 days |
| Optional TapeSend | +1.0–2.0 days |

### 20.2 On-chain budget

Fees are dynamic. Before every signed action, tooling must query the live contract and show a quote. Based on the 2026-09-29 snapshot, reserve approximately `0.2–0.5 OKB` for Processor creation, material/protocol fees, tapeout, contract deployments, SiteRegistry byte storage, name activation, and retries. Demo Treasury balances are separate and intentionally small.

SiteRegistry upload is the least predictable component because cost scales with deployed bytes. The web bundle must be measured and minimized before publishing.

## 21. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| TapeOut implementation upgrade | Circuit semantics may change | Limited funds, pinned metadata/netlist, health UI, explicit warning |
| TapeKit/RPC outage | Demo unavailable or stale | Multiple public RPCs, conventional mirror, prerecorded video |
| Large web bundle | High upload cost | Preact, tree shaking, no source maps/fonts/CDNs, size budget |
| USDT0 freeze or upgrade | Transfer failure | SafeERC20, rollback, clear issuer-risk disclosure |
| Owner compromise | Limits or recovery abused | Immutable recovery recipient, fresh wallet/multisig, small balances, production roadmap |
| Agent compromise | Repeated malicious requests | Authorization, hard Circuit constraints, daily limits, events |
| Pending proposal race | Budget consumed by another request | Fresh evaluation at execution, no reservation assumptions |
| Approval replay | Stale transfer executes | Proposal ID binding, short expiry, terminal states, fresh evaluation |
| Price volatility | OKB and USDT0 combined budget becomes meaningless | Independent budgets; no cross-asset conversion |
| Judge has no wallet | Cannot submit transactions | Read-only evidence view plus prepared demo wallet/video |

## 22. Design Decisions Summary

- Product: AI Agent spending firewall.
- Primary scenario: research Agent purchasing data/compute.
- Network: X Layer mainnet.
- Assets: native OKB and fixed-address USDT0.
- Accounting: independent per-asset limits and UTC-day spend.
- Policy: one stateless 6-input/2-output NAND Circuit.
- Runtime: real TapeOut `step` result is authoritative; invalid results fail closed.
- Contracts: non-upgradeable; policy and assets are immutable bindings.
- Frontend: static Preact app stored in the Policy Circuit Container.
- Communication: TapeSend is optional and client-side.
- Security posture: experimental, limited funds, explicit trust boundaries.

## 23. References

- Hackathon rules: <https://ignix.bot/x_campaign#hackathon-rules>
- TapeKit repository: <https://github.com/TapeOutProtocol/TapeKit>
- TapeKit specification: <https://github.com/TapeOutProtocol/TapeKit/blob/main/SPEC.md>
- TapeKit X Layer configuration: <https://github.com/TapeOutProtocol/TapeKit/blob/main/kernel/src/config.js>
- TapeSend chain configuration: <https://github.com/TapeOutProtocol/TapeKit/blob/main/send/module/src/chain.js>
- X Layer official contracts: <https://web3.okx.com/onchainos/dev-docs/xlayer/developer/build-on-xlayer/contracts>
- Circle USDC on X Layer: <https://www.circle.com/multi-chain-usdc/xlayer>
- OKX USDT0 FAQ: <https://www.okx.com/en-sg/help/usdt0-faq>
- Public X Layer TapeOut implementation reference: <https://github.com/tizerluo/neon-reliquary-xlayer>
