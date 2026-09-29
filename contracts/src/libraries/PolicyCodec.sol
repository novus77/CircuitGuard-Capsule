// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Decision, PolicyError, PolicyEvaluation } from "../interfaces/IPolicyAdapter.sol";

library PolicyCodec {
    function pack(bool active, bool trusted, bool blocked, bool low, bool within, bool approved)
        internal
        pure
        returns (uint8 value)
    {
        if (active) value |= 1 << 0;
        if (trusted) value |= 1 << 1;
        if (blocked) value |= 1 << 2;
        if (low) value |= 1 << 3;
        if (within) value |= 1 << 4;
        if (approved) value |= 1 << 5;
    }

    function decode(uint8 outputs) internal pure returns (PolicyEvaluation memory) {
        if (outputs == 0) {
            return PolicyEvaluation(Decision.Deny, outputs, PolicyError.None);
        }
        if (outputs == 1) {
            return PolicyEvaluation(Decision.Allow, outputs, PolicyError.None);
        }
        if (outputs == 2) {
            return PolicyEvaluation(Decision.Review, outputs, PolicyError.None);
        }
        return PolicyEvaluation(Decision.Invalid, outputs, PolicyError.OutputMalformed);
    }
}
