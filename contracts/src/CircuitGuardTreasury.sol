// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IPolicyAdapter } from "./interfaces/IPolicyAdapter.sol";

contract CircuitGuardTreasury is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Asset {
        OKB,
        USDT0
    }

    enum RecipientStatus {
        Unknown,
        Trusted,
        Blocked
    }

    enum ProposalState {
        PendingReview,
        Executed,
        Rejected,
        Cancelled,
        Expired
    }

    struct Budget {
        uint128 instantLimit;
        uint128 dailyLimit;
        uint128 spent;
        uint64 epochDay;
    }

    error ZeroAddress();
    error ZeroAmount();
    error InvalidBudget();
    error BudgetExceeded();
    error UnexpectedTokenDelta();
    error NativeTransferFailed();

    event AgentAuthorizationChanged(address indexed agent, bool authorized);
    event RecipientStatusChanged(address indexed recipient, RecipientStatus status);
    event BudgetChanged(Asset indexed asset, uint128 instantLimit, uint128 dailyLimit);
    event TreasuryFunded(Asset indexed asset, address indexed from, uint256 amount);
    event EmergencyRecovery(Asset indexed asset, address indexed recipient, uint256 amount);

    address public immutable recoveryAddress;
    IERC20 public immutable usdt0;
    IPolicyAdapter public immutable policyAdapter;

    mapping(Asset asset => Budget budget) private _budgets;
    mapping(address agent => bool authorized) public agents;
    mapping(address recipient => RecipientStatus status) public recipientStatus;

    constructor(
        address initialOwner,
        address recoveryAddress_,
        address usdt0Address,
        address policyAdapterAddress,
        address initialAgent,
        uint128 okbInstantLimit,
        uint128 okbDailyLimit,
        uint128 usdt0InstantLimit,
        uint128 usdt0DailyLimit
    ) Ownable(initialOwner) {
        if (
            initialOwner == address(0) || recoveryAddress_ == address(0)
                || usdt0Address == address(0) || policyAdapterAddress == address(0)
                || initialAgent == address(0)
        ) revert ZeroAddress();
        _validateBudget(okbInstantLimit, okbDailyLimit);
        _validateBudget(usdt0InstantLimit, usdt0DailyLimit);

        recoveryAddress = recoveryAddress_;
        usdt0 = IERC20(usdt0Address);
        policyAdapter = IPolicyAdapter(policyAdapterAddress);
        agents[initialAgent] = true;

        uint64 today = _currentDay();
        _budgets[Asset.OKB] = Budget(okbInstantLimit, okbDailyLimit, 0, today);
        _budgets[Asset.USDT0] = Budget(usdt0InstantLimit, usdt0DailyLimit, 0, today);

        emit AgentAuthorizationChanged(initialAgent, true);
        emit BudgetChanged(Asset.OKB, okbInstantLimit, okbDailyLimit);
        emit BudgetChanged(Asset.USDT0, usdt0InstantLimit, usdt0DailyLimit);
    }

    receive() external payable {
        emit TreasuryFunded(Asset.OKB, msg.sender, msg.value);
    }

    function depositUSDT0(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 balanceBefore = usdt0.balanceOf(address(this));
        usdt0.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = usdt0.balanceOf(address(this));
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != amount) {
            revert UnexpectedTokenDelta();
        }

        emit TreasuryFunded(Asset.USDT0, msg.sender, amount);
    }

    function setAgent(address agent, bool authorized) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        agents[agent] = authorized;
        emit AgentAuthorizationChanged(agent, authorized);
    }

    function setRecipientStatus(address recipient, RecipientStatus status) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        recipientStatus[recipient] = status;
        emit RecipientStatusChanged(recipient, status);
    }

    function setBudget(Asset asset, uint128 instantLimit, uint128 dailyLimit) external onlyOwner {
        _validateBudget(instantLimit, dailyLimit);
        Budget storage budget = _budgets[asset];
        _syncBudget(budget);
        budget.instantLimit = instantLimit;
        budget.dailyLimit = dailyLimit;
        emit BudgetChanged(asset, instantLimit, dailyLimit);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function emergencyRecover(Asset asset, uint128 amount)
        external
        onlyOwner
        whenPaused
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();

        if (asset == Asset.OKB) {
            (bool success,) = recoveryAddress.call{ value: amount }("");
            if (!success) revert NativeTransferFailed();
        } else {
            usdt0.safeTransfer(recoveryAddress, amount);
        }

        emit EmergencyRecovery(asset, recoveryAddress, amount);
    }

    function assetBalance(Asset asset) public view returns (uint256) {
        return asset == Asset.OKB ? address(this).balance : usdt0.balanceOf(address(this));
    }

    function currentBudget(Asset asset) public view returns (Budget memory budget) {
        budget = _budgets[asset];
        uint64 today = _currentDay();
        if (budget.epochDay != today) {
            budget.spent = 0;
            budget.epochDay = today;
        }
    }

    function _recordSpend(Asset asset, uint128 amount) internal {
        Budget storage budget = _budgets[asset];
        _syncBudget(budget);
        if (budget.spent > budget.dailyLimit || amount > budget.dailyLimit - budget.spent) {
            revert BudgetExceeded();
        }
        budget.spent += amount;
    }

    function _syncBudget(Budget storage budget) internal {
        uint64 today = _currentDay();
        if (budget.epochDay != today) {
            budget.spent = 0;
            budget.epochDay = today;
        }
    }

    function _validateBudget(uint128 instantLimit, uint128 dailyLimit) private pure {
        if (instantLimit > dailyLimit) revert InvalidBudget();
    }

    function _currentDay() private view returns (uint64) {
        return uint64(block.timestamp / 1 days);
    }
}
