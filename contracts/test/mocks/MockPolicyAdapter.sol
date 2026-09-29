// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    Decision,
    IPolicyAdapter,
    PolicyError,
    PolicyEvaluation
} from "../../src/interfaces/IPolicyAdapter.sol";

contract MockPolicyAdapter is IPolicyAdapter {
    bool private _useOverride;
    PolicyEvaluation private _overrideEvaluation;

    function setEvaluation(Decision decision, uint8 outputs, PolicyError error) external {
        _useOverride = true;
        _overrideEvaluation = PolicyEvaluation(decision, outputs, error);
    }

    function clearEvaluation() external {
        _useOverride = false;
    }

    function evaluate(uint8 inputs) external view returns (PolicyEvaluation memory) {
        if (_useOverride) return _overrideEvaluation;

        bool active = inputs & (1 << 0) != 0;
        bool trusted = inputs & (1 << 1) != 0;
        bool blocked = inputs & (1 << 2) != 0;
        bool low = inputs & (1 << 3) != 0;
        bool within = inputs & (1 << 4) != 0;
        bool approved = inputs & (1 << 5) != 0;
        bool hardOk = active && !blocked && within;

        if (hardOk && (approved || (trusted && low))) {
            return PolicyEvaluation(Decision.Allow, 1, PolicyError.None);
        }
        if (hardOk) return PolicyEvaluation(Decision.Review, 2, PolicyError.None);
        return PolicyEvaluation(Decision.Deny, 0, PolicyError.None);
    }

    function health() external pure returns (bool, bytes32, uint32, uint32, uint32, uint32) {
        return (true, bytes32(0), 6, 2, 0, 13);
    }
}
