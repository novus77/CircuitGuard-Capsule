// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {
    Decision,
    IPolicyAdapter,
    PolicyError,
    PolicyEvaluation
} from "./interfaces/IPolicyAdapter.sol";
import { PolicyCodec } from "./libraries/PolicyCodec.sol";

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

    struct Proposal {
        uint256 id;
        address agent;
        Asset asset;
        address recipient;
        uint128 amount;
        bytes32 memoHash;
        uint64 createdAt;
        uint64 expiresAt;
        uint8 inputs;
        uint8 outputs;
        Decision decision;
        PolicyError error;
        ProposalState state;
        uint64 approvalExpiresAt;
    }

    uint64 public constant PROPOSAL_LIFETIME = 24 hours;
    uint32 public constant MAX_APPROVAL_DURATION = 30 minutes;

    error ZeroAddress();
    error ZeroAmount();
    error InvalidBudget();
    error BudgetExceeded();
    error UnexpectedTokenDelta();
    error NativeTransferFailed();
    error UnauthorizedAgent();
    error InsufficientBalance();
    error ProposalNotFound();
    error InvalidProposalState();
    error InvalidApprovalDuration();
    error ApprovalRequired();
    error ApprovalExpired();
    error ProposalNotExpired();
    error UnauthorizedCancellation();

    event AgentAuthorizationChanged(address indexed agent, bool authorized);
    event RecipientStatusChanged(address indexed recipient, RecipientStatus status);
    event BudgetChanged(Asset indexed asset, uint128 instantLimit, uint128 dailyLimit);
    event TreasuryFunded(Asset indexed asset, address indexed from, uint256 amount);
    event EmergencyRecovery(Asset indexed asset, address indexed recipient, uint256 amount);
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
        uint256 indexed proposalId, Asset indexed asset, address indexed recipient, uint256 amount
    );

    address public immutable recoveryAddress;
    IERC20 public immutable usdt0;
    IPolicyAdapter public immutable policyAdapter;

    mapping(Asset asset => Budget budget) private _budgets;
    mapping(address agent => bool authorized) public agents;
    mapping(address recipient => RecipientStatus status) public recipientStatus;
    mapping(uint256 proposalId => Proposal proposal) private _proposals;

    uint256 public nextProposalId = 1;

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

    function requestTransfer(Asset asset, address recipient, uint128 amount, bytes32 memoHash)
        external
        nonReentrant
        returns (uint256 proposalId)
    {
        if (!agents[msg.sender]) revert UnauthorizedAgent();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (assetBalance(asset) < amount) revert InsufficientBalance();

        proposalId = nextProposalId++;
        uint64 createdAt = uint64(block.timestamp);
        uint8 inputs = _deriveInputs(asset, recipient, amount, false);
        PolicyEvaluation memory evaluation = _evaluate(inputs);

        Proposal storage proposal = _proposals[proposalId];
        proposal.id = proposalId;
        proposal.agent = msg.sender;
        proposal.asset = asset;
        proposal.recipient = recipient;
        proposal.amount = amount;
        proposal.memoHash = memoHash;
        proposal.createdAt = createdAt;
        proposal.expiresAt = createdAt + PROPOSAL_LIFETIME;
        proposal.state = ProposalState.PendingReview;
        _storeEvaluation(proposal, inputs, evaluation);

        emit ProposalCreated(proposalId, msg.sender, asset, recipient, amount, memoHash);
        emit PolicyEvaluated(
            proposalId, inputs, evaluation.outputs, evaluation.decision, evaluation.error
        );

        if (evaluation.decision == Decision.Allow) {
            _execute(proposal);
        } else if (evaluation.decision != Decision.Review) {
            proposal.state = ProposalState.Rejected;
        }
    }

    function approveProposal(uint256 proposalId, uint32 approvalDuration) external onlyOwner {
        Proposal storage proposal = _pendingProposal(proposalId);
        if (block.timestamp >= proposal.expiresAt) revert ProposalNotExpired();
        if (approvalDuration == 0 || approvalDuration > MAX_APPROVAL_DURATION) {
            revert InvalidApprovalDuration();
        }

        proposal.approvalExpiresAt = uint64(block.timestamp + approvalDuration);
        emit ProposalApproved(proposalId, proposal.approvalExpiresAt);
    }

    function executeApproved(uint256 proposalId) external nonReentrant {
        if (msg.sender != owner() && !agents[msg.sender]) revert UnauthorizedAgent();
        Proposal storage proposal = _pendingProposal(proposalId);
        if (block.timestamp >= proposal.expiresAt) revert ProposalNotExpired();
        if (proposal.approvalExpiresAt == 0) revert ApprovalRequired();
        if (block.timestamp > proposal.approvalExpiresAt) revert ApprovalExpired();
        if (assetBalance(proposal.asset) < proposal.amount) revert InsufficientBalance();

        uint8 inputs = _deriveInputs(proposal.asset, proposal.recipient, proposal.amount, true);
        PolicyEvaluation memory evaluation = _evaluate(inputs);
        _storeEvaluation(proposal, inputs, evaluation);
        emit PolicyEvaluated(
            proposalId, inputs, evaluation.outputs, evaluation.decision, evaluation.error
        );

        if (evaluation.decision == Decision.Allow) {
            _execute(proposal);
        } else {
            proposal.approvalExpiresAt = 0;
        }
    }

    function cancelProposal(uint256 proposalId) external {
        Proposal storage proposal = _pendingProposal(proposalId);
        if (msg.sender != owner() && msg.sender != proposal.agent) {
            revert UnauthorizedCancellation();
        }
        proposal.state = ProposalState.Cancelled;
        proposal.approvalExpiresAt = 0;
        emit ProposalCancelled(proposalId);
    }

    function expireProposal(uint256 proposalId) external {
        Proposal storage proposal = _pendingProposal(proposalId);
        if (block.timestamp < proposal.expiresAt) revert ProposalNotExpired();
        proposal.state = ProposalState.Expired;
        proposal.approvalExpiresAt = 0;
        emit ProposalExpired(proposalId);
    }

    function previewRequest(Asset asset, address recipient, uint128 amount)
        external
        view
        returns (uint8 inputs, PolicyEvaluation memory evaluation)
    {
        inputs = _deriveInputs(asset, recipient, amount, false);
        evaluation = _evaluate(inputs);
    }

    function previewProposal(uint256 proposalId)
        external
        view
        returns (uint8 inputs, PolicyEvaluation memory evaluation)
    {
        Proposal storage proposal = _proposal(proposalId);
        bool approved = proposal.approvalExpiresAt != 0
            && block.timestamp <= proposal.approvalExpiresAt && block.timestamp < proposal.expiresAt;
        inputs = _deriveInputs(proposal.asset, proposal.recipient, proposal.amount, approved);
        evaluation = _evaluate(inputs);
    }

    function getProposal(uint256 proposalId) public view returns (Proposal memory) {
        return _proposal(proposalId);
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

    function _execute(Proposal storage proposal) private {
        _recordSpend(proposal.asset, proposal.amount);
        proposal.state = ProposalState.Executed;
        proposal.approvalExpiresAt = 0;

        if (proposal.asset == Asset.OKB) {
            (bool success,) = proposal.recipient.call{ value: proposal.amount }("");
            if (!success) revert NativeTransferFailed();
        } else {
            usdt0.safeTransfer(proposal.recipient, proposal.amount);
        }

        emit TransferExecuted(proposal.id, proposal.asset, proposal.recipient, proposal.amount);
    }

    function _deriveInputs(Asset asset, address recipient, uint128 amount, bool approved)
        private
        view
        returns (uint8)
    {
        RecipientStatus status = recipientStatus[recipient];
        Budget memory budget = currentBudget(asset);
        bool within =
            budget.spent <= budget.dailyLimit && amount <= budget.dailyLimit - budget.spent;

        return PolicyCodec.pack(
            !paused(),
            status == RecipientStatus.Trusted,
            status == RecipientStatus.Blocked,
            amount <= budget.instantLimit,
            within,
            approved
        );
    }

    function _evaluate(uint8 inputs) private view returns (PolicyEvaluation memory evaluation) {
        try policyAdapter.evaluate(inputs) returns (PolicyEvaluation memory result) {
            evaluation = _normalizeEvaluation(result);
        } catch {
            evaluation =
                PolicyEvaluation(Decision.Invalid, type(uint8).max, PolicyError.StepReverted);
        }
    }

    function _normalizeEvaluation(PolicyEvaluation memory evaluation)
        private
        pure
        returns (PolicyEvaluation memory)
    {
        bool coherent = evaluation.error == PolicyError.None
            && ((evaluation.decision == Decision.Deny && evaluation.outputs == 0)
                || (evaluation.decision == Decision.Allow && evaluation.outputs == 1)
                || (evaluation.decision == Decision.Review && evaluation.outputs == 2));
        if (coherent) return evaluation;
        if (evaluation.decision == Decision.Invalid && evaluation.error != PolicyError.None) {
            return evaluation;
        }
        return PolicyEvaluation(Decision.Invalid, evaluation.outputs, PolicyError.OutputMalformed);
    }

    function _storeEvaluation(
        Proposal storage proposal,
        uint8 inputs,
        PolicyEvaluation memory evaluation
    ) private {
        proposal.inputs = inputs;
        proposal.outputs = evaluation.outputs;
        proposal.decision = evaluation.decision;
        proposal.error = evaluation.error;
    }

    function _proposal(uint256 proposalId) private view returns (Proposal storage proposal) {
        proposal = _proposals[proposalId];
        if (proposal.id == 0) revert ProposalNotFound();
    }

    function _pendingProposal(uint256 proposalId) private view returns (Proposal storage proposal) {
        proposal = _proposal(proposalId);
        if (proposal.state != ProposalState.PendingReview) revert InvalidProposalState();
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
