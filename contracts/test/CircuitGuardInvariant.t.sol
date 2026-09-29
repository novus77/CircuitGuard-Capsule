// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { CircuitGuardTreasury } from "../src/CircuitGuardTreasury.sol";
import { Decision, PolicyError } from "../src/interfaces/IPolicyAdapter.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { MockPolicyAdapter } from "./mocks/MockPolicyAdapter.sol";

contract CircuitGuardInvariantHandler {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    CircuitGuardTreasury public immutable treasury;
    MockERC20 public immutable usdt0;

    uint256 public executionsWhilePaused;
    uint256 public executionsToBlockedRecipient;
    uint256 public executionsWithoutAllow;

    address[4] private _recipients =
        [address(0x1001), address(0x1002), address(0x1003), address(0x1004)];

    constructor() payable {
        usdt0 = new MockERC20("Invariant USDT0", "iUSD0", 6);
        MockPolicyAdapter adapter = new MockPolicyAdapter();
        treasury = new CircuitGuardTreasury(
            address(this),
            address(0xCAFE),
            address(usdt0),
            address(adapter),
            address(this),
            0.02 ether,
            1 ether,
            10e6,
            1_000e6
        );

        (bool funded,) = address(treasury).call{ value: msg.value }("");
        require(funded, "native funding failed");
        usdt0.mint(address(treasury), 10_000e6);
    }

    function request(uint256 seed, uint128 rawAmount) external {
        CircuitGuardTreasury.Asset asset = CircuitGuardTreasury.Asset(seed % 2);
        address recipient = _recipients[(seed >> 8) % _recipients.length];
        uint128 maximum = asset == CircuitGuardTreasury.Asset.OKB ? uint128(0.2 ether) : 200e6;
        uint128 amount = uint128(1 + rawAmount % maximum);
        bool wasPaused = treasury.paused();
        CircuitGuardTreasury.RecipientStatus status = treasury.recipientStatus(recipient);

        try treasury.requestTransfer(asset, recipient, amount, bytes32(seed)) returns (
            uint256 proposalId
        ) {
            _auditExecution(proposalId, wasPaused, status);
        } catch { }
    }

    function approveAndExecute(uint256 seed, uint32 rawDuration) external {
        uint256 nextId = treasury.nextProposalId();
        if (nextId <= 1) return;
        uint256 proposalId = 1 + seed % (nextId - 1);
        uint32 duration = uint32(1 + rawDuration % treasury.MAX_APPROVAL_DURATION());

        try treasury.approveProposal(proposalId, duration) {
            CircuitGuardTreasury.Proposal memory proposal = treasury.getProposal(proposalId);
            bool wasPaused = treasury.paused();
            CircuitGuardTreasury.RecipientStatus status =
                treasury.recipientStatus(proposal.recipient);
            try treasury.executeApproved(proposalId) {
                _auditExecution(proposalId, wasPaused, status);
            } catch { }
        } catch { }
    }

    function setRecipientStatus(uint256 seed, uint8 rawStatus) external {
        address recipient = _recipients[seed % _recipients.length];
        CircuitGuardTreasury.RecipientStatus status =
            CircuitGuardTreasury.RecipientStatus(rawStatus % 3);
        treasury.setRecipientStatus(recipient, status);
    }

    function setBudget(uint256 seed, uint128 rawDaily, uint128 rawInstant) external {
        CircuitGuardTreasury.Asset asset = CircuitGuardTreasury.Asset(seed % 2);
        uint128 maximumDaily = asset == CircuitGuardTreasury.Asset.OKB ? uint128(2 ether) : 2_000e6;
        uint128 dailyLimit = uint128(rawDaily % maximumDaily);
        uint128 instantLimit = dailyLimit == 0 ? 0 : uint128(rawInstant % (dailyLimit + 1));
        try treasury.setBudget(asset, instantLimit, dailyLimit) { } catch { }
    }

    function setPaused(bool value) external {
        if (value && !treasury.paused()) {
            treasury.pause();
        } else if (!value && treasury.paused()) {
            treasury.unpause();
        }
    }

    function advanceTime(uint32 rawSeconds) external {
        VM.warp(block.timestamp + rawSeconds % 3 days);
    }

    function _auditExecution(
        uint256 proposalId,
        bool wasPaused,
        CircuitGuardTreasury.RecipientStatus status
    ) private {
        CircuitGuardTreasury.Proposal memory proposal = treasury.getProposal(proposalId);
        if (proposal.state != CircuitGuardTreasury.ProposalState.Executed) return;

        if (wasPaused) executionsWhilePaused++;
        if (status == CircuitGuardTreasury.RecipientStatus.Blocked) {
            executionsToBlockedRecipient++;
        }
        if (
            proposal.decision != Decision.Allow || proposal.outputs != 1
                || proposal.error != PolicyError.None
        ) {
            executionsWithoutAllow++;
        }
    }
}

contract CircuitGuardInvariantTest is StdInvariant, Test {
    CircuitGuardInvariantHandler private handler;
    CircuitGuardTreasury private treasury;

    function setUp() public {
        vm.deal(address(this), 20 ether);
        handler = new CircuitGuardInvariantHandler{ value: 10 ether }();
        treasury = handler.treasury();
        targetContract(address(handler));
    }

    function invariant_spendNeverExceedsDailyLimit() public view {
        CircuitGuardTreasury.Budget memory okb =
            treasury.currentBudget(CircuitGuardTreasury.Asset.OKB);
        CircuitGuardTreasury.Budget memory usdt0 =
            treasury.currentBudget(CircuitGuardTreasury.Asset.USDT0);
        assertLe(okb.spent, okb.dailyLimit);
        assertLe(usdt0.spent, usdt0.dailyLimit);
    }

    function invariant_forbiddenExecutionsNeverOccur() public view {
        assertEq(handler.executionsWhilePaused(), 0);
        assertEq(handler.executionsToBlockedRecipient(), 0);
        assertEq(handler.executionsWithoutAllow(), 0);
    }
}
