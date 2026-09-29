// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { CircuitGuardTreasury } from "../src/CircuitGuardTreasury.sol";
import { DemoMerchant } from "../src/DemoMerchant.sol";
import { Decision, PolicyError } from "../src/interfaces/IPolicyAdapter.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { MockPolicyAdapter } from "./mocks/MockPolicyAdapter.sol";
import { MaliciousRecipient } from "./mocks/MaliciousRecipient.sol";

contract CircuitGuardTreasuryHarness is CircuitGuardTreasury {
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
    )
        CircuitGuardTreasury(
            initialOwner,
            recoveryAddress,
            usdt0,
            policyAdapter,
            initialAgent,
            okbInstantLimit,
            okbDailyLimit,
            usdt0InstantLimit,
            usdt0DailyLimit
        )
    { }

    function recordSpend(Asset asset, uint128 amount) external {
        _recordSpend(asset, amount);
    }
}

contract CircuitGuardTreasuryTest is Test {
    event TreasuryFunded(
        CircuitGuardTreasury.Asset indexed asset, address indexed from, uint256 amount
    );

    address private owner = makeAddr("owner");
    address private recovery = makeAddr("recovery");
    address private agent = makeAddr("agent");
    address private depositor = makeAddr("depositor");
    address private recipient = makeAddr("recipient");

    MockERC20 private usdt0;
    MockPolicyAdapter private adapter;
    CircuitGuardTreasuryHarness private treasury;

    function setUp() public {
        usdt0 = new MockERC20("Mock USDT0", "USD0", 6);
        adapter = new MockPolicyAdapter();
        treasury = _deploy(address(owner), recovery, address(usdt0), address(adapter), agent);
        vm.deal(depositor, 10 ether);
        usdt0.mint(depositor, 1_000e6);
    }

    function test_constructorStoresImmutableDependenciesAndInitialState() public view {
        assertEq(treasury.owner(), owner);
        assertEq(treasury.recoveryAddress(), recovery);
        assertEq(address(treasury.usdt0()), address(usdt0));
        assertEq(address(treasury.policyAdapter()), address(adapter));
        assertTrue(treasury.agents(agent));

        CircuitGuardTreasury.Budget memory okb =
            treasury.currentBudget(CircuitGuardTreasury.Asset.OKB);
        CircuitGuardTreasury.Budget memory token =
            treasury.currentBudget(CircuitGuardTreasury.Asset.USDT0);
        assertEq(okb.instantLimit, 0.02 ether);
        assertEq(okb.dailyLimit, 0.1 ether);
        assertEq(token.instantLimit, 10e6);
        assertEq(token.dailyLimit, 100e6);
    }

    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert();
        _deploy(address(0), recovery, address(usdt0), address(adapter), agent);

        vm.expectRevert(CircuitGuardTreasury.ZeroAddress.selector);
        _deploy(owner, address(0), address(usdt0), address(adapter), agent);

        vm.expectRevert(CircuitGuardTreasury.ZeroAddress.selector);
        _deploy(owner, recovery, address(0), address(adapter), agent);

        vm.expectRevert(CircuitGuardTreasury.ZeroAddress.selector);
        _deploy(owner, recovery, address(usdt0), address(0), agent);

        vm.expectRevert(CircuitGuardTreasury.ZeroAddress.selector);
        _deploy(owner, recovery, address(usdt0), address(adapter), address(0));
    }

    function test_constructorRejectsInstantLimitAboveDailyLimit() public {
        vm.expectRevert(CircuitGuardTreasury.InvalidBudget.selector);
        new CircuitGuardTreasuryHarness(
            owner, recovery, address(usdt0), address(adapter), agent, 2 ether, 1 ether, 10e6, 100e6
        );
    }

    function test_ownershipTransferRequiresPendingOwnerAcceptance() public {
        address nextOwner = makeAddr("nextOwner");

        vm.prank(owner);
        treasury.transferOwnership(nextOwner);
        assertEq(treasury.owner(), owner);
        assertEq(treasury.pendingOwner(), nextOwner);

        vm.prank(nextOwner);
        treasury.acceptOwnership();
        assertEq(treasury.owner(), nextOwner);
        assertEq(treasury.pendingOwner(), address(0));
    }

    function test_ownerControlsAgentsAndRecipientStatus() public {
        address secondAgent = makeAddr("secondAgent");

        vm.startPrank(owner);
        treasury.setAgent(secondAgent, true);
        treasury.setRecipientStatus(recipient, CircuitGuardTreasury.RecipientStatus.Trusted);
        vm.stopPrank();

        assertTrue(treasury.agents(secondAgent));
        assertEq(
            uint8(treasury.recipientStatus(recipient)),
            uint8(CircuitGuardTreasury.RecipientStatus.Trusted)
        );

        vm.prank(owner);
        treasury.setRecipientStatus(recipient, CircuitGuardTreasury.RecipientStatus.Blocked);
        assertEq(
            uint8(treasury.recipientStatus(recipient)),
            uint8(CircuitGuardTreasury.RecipientStatus.Blocked)
        );

        vm.prank(agent);
        vm.expectRevert();
        treasury.setAgent(secondAgent, false);
    }

    function test_budgetsRemainIndependent() public {
        vm.prank(owner);
        treasury.setBudget(CircuitGuardTreasury.Asset.OKB, 0.03 ether, 0.2 ether);

        CircuitGuardTreasury.Budget memory okb =
            treasury.currentBudget(CircuitGuardTreasury.Asset.OKB);
        CircuitGuardTreasury.Budget memory token =
            treasury.currentBudget(CircuitGuardTreasury.Asset.USDT0);
        assertEq(okb.instantLimit, 0.03 ether);
        assertEq(okb.dailyLimit, 0.2 ether);
        assertEq(token.instantLimit, 10e6);
        assertEq(token.dailyLimit, 100e6);
    }

    function test_budgetSpendResetsAtUtcDayBoundary() public {
        treasury.recordSpend(CircuitGuardTreasury.Asset.USDT0, 25e6);
        CircuitGuardTreasury.Budget memory beforeRollover =
            treasury.currentBudget(CircuitGuardTreasury.Asset.USDT0);
        assertEq(beforeRollover.spent, 25e6);

        vm.warp((block.timestamp / 1 days + 1) * 1 days);

        CircuitGuardTreasury.Budget memory afterRollover =
            treasury.currentBudget(CircuitGuardTreasury.Asset.USDT0);
        assertEq(afterRollover.spent, 0);
        assertEq(afterRollover.epochDay, uint64(block.timestamp / 1 days));
    }

    function test_cannotLowerDailyLimitBelowCurrentSpend() public {
        treasury.recordSpend(CircuitGuardTreasury.Asset.USDT0, 50e6);
        vm.prank(owner);
        vm.expectRevert(CircuitGuardTreasury.BudgetExceeded.selector);
        treasury.setBudget(CircuitGuardTreasury.Asset.USDT0, 10e6, 40e6);
    }

    function test_receiveAcceptsOkbAndEmitsFunding() public {
        vm.expectEmit(true, true, false, true, address(treasury));
        emit TreasuryFunded(CircuitGuardTreasury.Asset.OKB, depositor, 1 ether);

        vm.prank(depositor);
        (bool success,) = address(treasury).call{ value: 1 ether }("");

        assertTrue(success);
        assertEq(address(treasury).balance, 1 ether);
    }

    function test_depositUSDT0RequiresExactBalanceDelta() public {
        vm.prank(depositor);
        usdt0.approve(address(treasury), 100e6);

        vm.prank(depositor);
        treasury.depositUSDT0(100e6);

        assertEq(usdt0.balanceOf(address(treasury)), 100e6);

        usdt0.setFeeBps(100);
        vm.prank(depositor);
        usdt0.approve(address(treasury), 100e6);
        vm.prank(depositor);
        vm.expectRevert(CircuitGuardTreasury.UnexpectedTokenDelta.selector);
        treasury.depositUSDT0(100e6);
    }

    function test_emergencyRecoveryRequiresPauseAndUsesFixedRecipient() public {
        vm.prank(depositor);
        (bool funded,) = address(treasury).call{ value: 2 ether }("");
        assertTrue(funded);
        usdt0.mint(address(treasury), 200e6);

        vm.prank(owner);
        vm.expectRevert();
        treasury.emergencyRecover(CircuitGuardTreasury.Asset.OKB, 1 ether);

        vm.startPrank(owner);
        treasury.pause();
        treasury.emergencyRecover(CircuitGuardTreasury.Asset.OKB, 1 ether);
        treasury.emergencyRecover(CircuitGuardTreasury.Asset.USDT0, 50e6);
        vm.stopPrank();

        assertEq(recovery.balance, 1 ether);
        assertEq(usdt0.balanceOf(recovery), 50e6);
        assertEq(address(treasury).balance, 1 ether);
        assertEq(usdt0.balanceOf(address(treasury)), 150e6);
    }

    function test_onlyOwnerCanConfigurePauseOrRecover() public {
        vm.startPrank(agent);
        vm.expectRevert();
        treasury.setBudget(CircuitGuardTreasury.Asset.OKB, 1, 2);
        vm.expectRevert();
        treasury.setRecipientStatus(recipient, CircuitGuardTreasury.RecipientStatus.Trusted);
        vm.expectRevert();
        treasury.pause();
        vm.expectRevert();
        treasury.emergencyRecover(CircuitGuardTreasury.Asset.OKB, 1);
        vm.stopPrank();
    }

    function test_trustedLowOkbExecutesImmediately() public {
        _fundOkb(1 ether);
        vm.prank(owner);
        treasury.setRecipientStatus(recipient, CircuitGuardTreasury.RecipientStatus.Trusted);

        vm.prank(agent);
        uint256 proposalId = treasury.requestTransfer(
            CircuitGuardTreasury.Asset.OKB, recipient, 0.01 ether, keccak256("okb order")
        );

        CircuitGuardTreasury.Proposal memory proposal = treasury.getProposal(proposalId);
        assertEq(recipient.balance, 0.01 ether);
        assertEq(uint8(proposal.state), uint8(CircuitGuardTreasury.ProposalState.Executed));
        assertEq(uint8(proposal.decision), uint8(Decision.Allow));
        assertEq(proposal.inputs, 0x1B);
        assertEq(proposal.outputs, 0x01);
    }

    function test_trustedLowUsdt0ExecutesImmediately() public {
        usdt0.mint(address(treasury), 200e6);
        vm.prank(owner);
        treasury.setRecipientStatus(recipient, CircuitGuardTreasury.RecipientStatus.Trusted);

        vm.prank(agent);
        uint256 proposalId = treasury.requestTransfer(
            CircuitGuardTreasury.Asset.USDT0, recipient, 3e6, keccak256("token order")
        );

        CircuitGuardTreasury.Proposal memory proposal = treasury.getProposal(proposalId);
        assertEq(usdt0.balanceOf(recipient), 3e6);
        assertEq(uint8(proposal.state), uint8(CircuitGuardTreasury.ProposalState.Executed));
        assertEq(uint8(proposal.decision), uint8(Decision.Allow));
    }

    function test_unknownOrHighAmountRequiresReview() public {
        usdt0.mint(address(treasury), 200e6);

        vm.prank(agent);
        uint256 unknownId = treasury.requestTransfer(
            CircuitGuardTreasury.Asset.USDT0, recipient, 3e6, keccak256("unknown")
        );

        vm.prank(owner);
        treasury.setRecipientStatus(recipient, CircuitGuardTreasury.RecipientStatus.Trusted);
        vm.prank(agent);
        uint256 highId = treasury.requestTransfer(
            CircuitGuardTreasury.Asset.USDT0, recipient, 30e6, keccak256("high")
        );

        assertEq(
            uint8(treasury.getProposal(unknownId).state),
            uint8(CircuitGuardTreasury.ProposalState.PendingReview)
        );
        assertEq(
            uint8(treasury.getProposal(highId).state),
            uint8(CircuitGuardTreasury.ProposalState.PendingReview)
        );
        assertEq(usdt0.balanceOf(recipient), 0);
    }

    function test_blockedPausedAndOverBudgetRequestsAreRecordedAsDenied() public {
        usdt0.mint(address(treasury), 300e6);
        address blocked = makeAddr("blocked");
        vm.prank(owner);
        treasury.setRecipientStatus(blocked, CircuitGuardTreasury.RecipientStatus.Blocked);

        vm.prank(agent);
        uint256 blockedId = treasury.requestTransfer(
            CircuitGuardTreasury.Asset.USDT0, blocked, 1e6, keccak256("blocked")
        );

        vm.prank(owner);
        treasury.pause();
        vm.prank(agent);
        uint256 pausedId = treasury.requestTransfer(
            CircuitGuardTreasury.Asset.USDT0, recipient, 1e6, keccak256("paused")
        );
        vm.prank(owner);
        treasury.unpause();

        treasury.recordSpend(CircuitGuardTreasury.Asset.USDT0, 100e6);
        vm.prank(agent);
        uint256 budgetId = treasury.requestTransfer(
            CircuitGuardTreasury.Asset.USDT0, recipient, 1, keccak256("budget")
        );

        _assertState(blockedId, CircuitGuardTreasury.ProposalState.Rejected);
        _assertState(pausedId, CircuitGuardTreasury.ProposalState.Rejected);
        _assertState(budgetId, CircuitGuardTreasury.ProposalState.Rejected);
    }

    function test_ownerApprovalIsReevaluatedThenExecuted() public {
        usdt0.mint(address(treasury), 200e6);
        vm.prank(agent);
        uint256 proposalId = treasury.requestTransfer(
            CircuitGuardTreasury.Asset.USDT0, recipient, 30e6, keccak256("review")
        );

        vm.prank(owner);
        treasury.approveProposal(proposalId, 10 minutes);
        assertEq(usdt0.balanceOf(recipient), 0);

        vm.prank(agent);
        treasury.executeApproved(proposalId);

        CircuitGuardTreasury.Proposal memory proposal = treasury.getProposal(proposalId);
        assertEq(usdt0.balanceOf(recipient), 30e6);
        assertEq(uint8(proposal.state), uint8(CircuitGuardTreasury.ProposalState.Executed));
        assertEq(uint8(proposal.decision), uint8(Decision.Allow));
        assertEq(proposal.inputs & 0x20, 0x20);
    }

    function test_approvalCannotOverrideBlockedRecipientAndIsCleared() public {
        usdt0.mint(address(treasury), 200e6);
        vm.prank(agent);
        uint256 proposalId = treasury.requestTransfer(
            CircuitGuardTreasury.Asset.USDT0, recipient, 30e6, keccak256("review")
        );
        vm.prank(owner);
        treasury.approveProposal(proposalId, 10 minutes);
        vm.prank(owner);
        treasury.setRecipientStatus(recipient, CircuitGuardTreasury.RecipientStatus.Blocked);

        vm.prank(agent);
        treasury.executeApproved(proposalId);

        CircuitGuardTreasury.Proposal memory proposal = treasury.getProposal(proposalId);
        assertEq(uint8(proposal.state), uint8(CircuitGuardTreasury.ProposalState.PendingReview));
        assertEq(uint8(proposal.decision), uint8(Decision.Deny));
        assertEq(proposal.approvalExpiresAt, 0);
        assertEq(usdt0.balanceOf(recipient), 0);
    }

    function test_approvalCannotOverridePauseOrBudget() public {
        usdt0.mint(address(treasury), 300e6);
        vm.prank(agent);
        uint256 pausedId = treasury.requestTransfer(
            CircuitGuardTreasury.Asset.USDT0, recipient, 30e6, keccak256("paused review")
        );
        vm.prank(owner);
        treasury.approveProposal(pausedId, 10 minutes);
        vm.prank(owner);
        treasury.pause();
        vm.prank(agent);
        treasury.executeApproved(pausedId);
        assertEq(treasury.getProposal(pausedId).approvalExpiresAt, 0);

        vm.prank(owner);
        treasury.unpause();
        vm.prank(agent);
        uint256 budgetId = treasury.requestTransfer(
            CircuitGuardTreasury.Asset.USDT0, recipient, 30e6, keccak256("budget review")
        );
        vm.prank(owner);
        treasury.approveProposal(budgetId, 10 minutes);
        treasury.recordSpend(CircuitGuardTreasury.Asset.USDT0, 100e6);
        vm.prank(agent);
        treasury.executeApproved(budgetId);

        _assertState(pausedId, CircuitGuardTreasury.ProposalState.PendingReview);
        _assertState(budgetId, CircuitGuardTreasury.ProposalState.PendingReview);
        assertEq(treasury.getProposal(budgetId).approvalExpiresAt, 0);
        assertEq(usdt0.balanceOf(recipient), 0);
    }

    function test_approvalAndProposalExpiryAndCancellation() public {
        usdt0.mint(address(treasury), 300e6);
        vm.prank(agent);
        uint256 approvalId = treasury.requestTransfer(
            CircuitGuardTreasury.Asset.USDT0, recipient, 30e6, keccak256("approval expiry")
        );
        vm.prank(owner);
        treasury.approveProposal(approvalId, 1 minutes);
        vm.warp(block.timestamp + 1 minutes + 1);
        vm.prank(agent);
        vm.expectRevert(CircuitGuardTreasury.ApprovalExpired.selector);
        treasury.executeApproved(approvalId);

        vm.prank(agent);
        uint256 expiryId = treasury.requestTransfer(
            CircuitGuardTreasury.Asset.USDT0, recipient, 30e6, keccak256("proposal expiry")
        );
        vm.warp(block.timestamp + treasury.PROPOSAL_LIFETIME());
        treasury.expireProposal(expiryId);
        _assertState(expiryId, CircuitGuardTreasury.ProposalState.Expired);

        vm.prank(agent);
        uint256 cancelId = treasury.requestTransfer(
            CircuitGuardTreasury.Asset.USDT0, recipient, 30e6, keccak256("cancel")
        );
        vm.prank(agent);
        treasury.cancelProposal(cancelId);
        _assertState(cancelId, CircuitGuardTreasury.ProposalState.Cancelled);

        vm.prank(owner);
        vm.expectRevert(CircuitGuardTreasury.InvalidProposalState.selector);
        treasury.approveProposal(cancelId, 10 minutes);
    }

    function test_reentrantNativeRecipientCannotReenterTreasury() public {
        _fundOkb(1 ether);
        MaliciousRecipient malicious = new MaliciousRecipient(address(treasury));
        vm.prank(owner);
        treasury.setRecipientStatus(
            address(malicious), CircuitGuardTreasury.RecipientStatus.Trusted
        );
        vm.prank(owner);
        treasury.setAgent(address(malicious), true);

        vm.prank(agent);
        treasury.requestTransfer(
            CircuitGuardTreasury.Asset.OKB, address(malicious), 0.01 ether, keccak256("reentrancy")
        );

        assertTrue(malicious.reentryAttempted());
        assertFalse(malicious.reentrySucceeded());
        assertEq(address(malicious).balance, 0.01 ether);
    }

    function test_failedNativeAndTokenTransfersRollBackStateAndSpend() public {
        _fundOkb(1 ether);
        MaliciousRecipient rejecting = new MaliciousRecipient(address(treasury));
        rejecting.setRejectNative(true);
        vm.prank(owner);
        treasury.setRecipientStatus(
            address(rejecting), CircuitGuardTreasury.RecipientStatus.Trusted
        );

        vm.prank(agent);
        vm.expectRevert(CircuitGuardTreasury.NativeTransferFailed.selector);
        treasury.requestTransfer(
            CircuitGuardTreasury.Asset.OKB,
            address(rejecting),
            0.01 ether,
            keccak256("failed native")
        );
        assertEq(treasury.nextProposalId(), 1);
        assertEq(treasury.currentBudget(CircuitGuardTreasury.Asset.OKB).spent, 0);

        usdt0.mint(address(treasury), 100e6);
        usdt0.setTransfersRevert(true);
        vm.prank(owner);
        treasury.setRecipientStatus(recipient, CircuitGuardTreasury.RecipientStatus.Trusted);
        vm.prank(agent);
        vm.expectRevert();
        treasury.requestTransfer(
            CircuitGuardTreasury.Asset.USDT0, recipient, 1e6, keccak256("failed token")
        );
        assertEq(treasury.nextProposalId(), 1);
        assertEq(treasury.currentBudget(CircuitGuardTreasury.Asset.USDT0).spent, 0);
    }

    function test_demoMerchantReportsNativeOrderAndTokenBalance() public {
        DemoMerchant merchant = new DemoMerchant(address(usdt0));
        usdt0.mint(address(merchant), 7e6);
        vm.deal(address(this), 1 ether);

        (bool success,) = address(merchant).call{ value: 0.1 ether }("");

        assertTrue(success);
        assertEq(merchant.okbBalance(), 0.1 ether);
        assertEq(merchant.usdt0Balance(), 7e6);
        assertEq(merchant.nextOrderId(), 2);
    }

    function test_requestValidationAndAuthorization() public {
        usdt0.mint(address(treasury), 1e6);
        vm.prank(depositor);
        vm.expectRevert(CircuitGuardTreasury.UnauthorizedAgent.selector);
        treasury.requestTransfer(CircuitGuardTreasury.Asset.USDT0, recipient, 1, bytes32(0));

        vm.startPrank(agent);
        vm.expectRevert(CircuitGuardTreasury.ZeroAddress.selector);
        treasury.requestTransfer(CircuitGuardTreasury.Asset.USDT0, address(0), 1, bytes32(0));
        vm.expectRevert(CircuitGuardTreasury.ZeroAmount.selector);
        treasury.requestTransfer(CircuitGuardTreasury.Asset.USDT0, recipient, 0, bytes32(0));
        vm.expectRevert(CircuitGuardTreasury.InsufficientBalance.selector);
        treasury.requestTransfer(CircuitGuardTreasury.Asset.USDT0, recipient, 2e6, bytes32(0));
        vm.stopPrank();
    }

    function test_adapterRevertIsRecordedAsInvalidAndNeverTransfers() public {
        usdt0.mint(address(treasury), 10e6);
        adapter.setReverts(true);

        vm.prank(agent);
        uint256 proposalId = treasury.requestTransfer(
            CircuitGuardTreasury.Asset.USDT0, recipient, 1e6, keccak256("adapter failure")
        );

        CircuitGuardTreasury.Proposal memory proposal = treasury.getProposal(proposalId);
        assertEq(uint8(proposal.state), uint8(CircuitGuardTreasury.ProposalState.Rejected));
        assertEq(uint8(proposal.decision), uint8(Decision.Invalid));
        assertEq(uint8(proposal.error), uint8(PolicyError.StepReverted));
        assertEq(proposal.outputs, type(uint8).max);
        assertEq(usdt0.balanceOf(recipient), 0);
    }

    function _fundOkb(uint256 amount) private {
        vm.prank(depositor);
        (bool success,) = address(treasury).call{ value: amount }("");
        assertTrue(success);
    }

    function _assertState(uint256 proposalId, CircuitGuardTreasury.ProposalState state)
        private
        view
    {
        assertEq(uint8(treasury.getProposal(proposalId).state), uint8(state));
    }

    function _deploy(
        address initialOwner,
        address recoveryAddress,
        address token,
        address policyAdapter,
        address initialAgent
    ) private returns (CircuitGuardTreasuryHarness) {
        return new CircuitGuardTreasuryHarness(
            initialOwner,
            recoveryAddress,
            token,
            policyAdapter,
            initialAgent,
            0.02 ether,
            0.1 ether,
            10e6,
            100e6
        );
    }
}
