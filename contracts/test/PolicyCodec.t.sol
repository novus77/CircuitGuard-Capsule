// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Decision, PolicyError, PolicyEvaluation } from "../src/interfaces/IPolicyAdapter.sol";
import { PolicyCodec } from "../src/libraries/PolicyCodec.sol";

contract PolicyCodecTest is Test {
    function test_packMapsFactsToBitsZeroThroughFive() public pure {
        uint8 packed = PolicyCodec.pack(true, true, false, true, true, false);

        assertEq(packed, 0x1B);
    }

    function test_packMapsEachFactIndependently() public pure {
        assertEq(PolicyCodec.pack(true, false, false, false, false, false), 1 << 0);
        assertEq(PolicyCodec.pack(false, true, false, false, false, false), 1 << 1);
        assertEq(PolicyCodec.pack(false, false, true, false, false, false), 1 << 2);
        assertEq(PolicyCodec.pack(false, false, false, true, false, false), 1 << 3);
        assertEq(PolicyCodec.pack(false, false, false, false, true, false), 1 << 4);
        assertEq(PolicyCodec.pack(false, false, false, false, false, true), 1 << 5);
    }

    function test_decodeMapsWellFormedOutputs() public pure {
        _assertEvaluation(PolicyCodec.decode(0x00), Decision.Deny, 0x00, PolicyError.None);
        _assertEvaluation(PolicyCodec.decode(0x01), Decision.Allow, 0x01, PolicyError.None);
        _assertEvaluation(PolicyCodec.decode(0x02), Decision.Review, 0x02, PolicyError.None);
    }

    function test_decodeRejectsConflictingAndHighBits() public pure {
        _assertEvaluation(
            PolicyCodec.decode(0x03), Decision.Invalid, 0x03, PolicyError.OutputMalformed
        );
        _assertEvaluation(
            PolicyCodec.decode(0x04), Decision.Invalid, 0x04, PolicyError.OutputMalformed
        );
        _assertEvaluation(
            PolicyCodec.decode(0xFF), Decision.Invalid, 0xFF, PolicyError.OutputMalformed
        );
    }

    function _assertEvaluation(
        PolicyEvaluation memory actual,
        Decision decision,
        uint8 outputs,
        PolicyError error
    ) private pure {
        assertEq(uint8(actual.decision), uint8(decision));
        assertEq(actual.outputs, outputs);
        assertEq(uint8(actual.error), uint8(error));
    }
}
