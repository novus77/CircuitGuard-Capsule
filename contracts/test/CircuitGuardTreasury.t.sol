// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { CircuitGuardTreasury } from "../src/CircuitGuardTreasury.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { MockPolicyAdapter } from "./mocks/MockPolicyAdapter.sol";

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

    function test_loweredDailyLimitFailsClosedWithoutArithmeticPanic() public {
        treasury.recordSpend(CircuitGuardTreasury.Asset.USDT0, 50e6);
        vm.prank(owner);
        treasury.setBudget(CircuitGuardTreasury.Asset.USDT0, 10e6, 40e6);

        vm.expectRevert(CircuitGuardTreasury.BudgetExceeded.selector);
        treasury.recordSpend(CircuitGuardTreasury.Asset.USDT0, 1);
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
