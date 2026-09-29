// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Decision, PolicyError, PolicyEvaluation } from "../src/interfaces/IPolicyAdapter.sol";
import { TapeOutPolicyAdapter } from "../src/TapeOutPolicyAdapter.sol";
import { MockTapeOutFactory, MockTapeOutProcessor } from "./mocks/MockTapeOut.sol";

contract TapeOutPolicyAdapterTest is Test {
    uint256 private constant CIRCUIT_ID = 7;
    bytes private constant NETLIST =
        hex"0000000400000400000002000008000000090000090000000a0000060000000b00000b00000003000005000000070000070000000e00000d0000000f00000f0000000c00000f0000000c0000100000001100001100000012000012";

    MockTapeOutFactory private factory;
    MockTapeOutProcessor private processor;

    function setUp() public {
        factory = new MockTapeOutFactory();
        processor = new MockTapeOutProcessor(NETLIST);
        factory.setCPU(address(processor), true);
    }

    function test_constructorRejectsUnregisteredProcessor() public {
        factory.setCPU(address(processor), false);

        vm.expectRevert(TapeOutPolicyAdapter.ProcessorNotRegistered.selector);
        _deploy();
    }

    function test_constructorRejectsMissingCircuit() public {
        processor.setCircuitExists(false);

        vm.expectRevert(TapeOutPolicyAdapter.CircuitUnavailable.selector);
        _deploy();
    }

    function test_constructorRejectsWrongMetadata() public {
        processor.setMetadata(6, 2, 1, 13);

        vm.expectRevert(TapeOutPolicyAdapter.CircuitMetadataMismatch.selector);
        _deploy();
    }

    function test_constructorRejectsNetlistHashMismatch() public {
        processor.setNetlist(hex"01");

        vm.expectRevert(TapeOutPolicyAdapter.NetlistHashMismatch.selector);
        _deploy();
    }

    function test_evaluateDecodesWellFormedOutputs() public {
        TapeOutPolicyAdapter adapter = _deploy();

        processor.setStepResult(hex"", hex"00");
        _assertEvaluation(adapter.evaluate(0x11), Decision.Deny, 0x00, PolicyError.None);

        processor.setStepResult(hex"", hex"01");
        _assertEvaluation(adapter.evaluate(0x11), Decision.Allow, 0x01, PolicyError.None);

        processor.setStepResult(hex"", hex"02");
        _assertEvaluation(adapter.evaluate(0x11), Decision.Review, 0x02, PolicyError.None);
    }

    function test_evaluateRejectsConflictingOrHighOutputBits() public {
        TapeOutPolicyAdapter adapter = _deploy();

        processor.setStepResult(hex"", hex"03");
        _assertEvaluation(adapter.evaluate(0), Decision.Invalid, 0x03, PolicyError.OutputMalformed);

        processor.setStepResult(hex"", hex"80");
        _assertEvaluation(adapter.evaluate(0), Decision.Invalid, 0x80, PolicyError.OutputMalformed);
    }

    function test_evaluateRejectsNonEmptyNewState() public {
        TapeOutPolicyAdapter adapter = _deploy();
        processor.setStepResult(hex"01", hex"01");

        _assertEvaluation(adapter.evaluate(0), Decision.Invalid, 0xFF, PolicyError.StateMismatch);
    }

    function test_evaluateRejectsMissingOrLongOutput() public {
        TapeOutPolicyAdapter adapter = _deploy();

        processor.setStepResult(hex"", hex"");
        _assertEvaluation(adapter.evaluate(0), Decision.Invalid, 0xFF, PolicyError.OutputMalformed);

        processor.setStepResult(hex"", hex"0100");
        _assertEvaluation(adapter.evaluate(0), Decision.Invalid, 0xFF, PolicyError.OutputMalformed);
    }

    function test_evaluateRejectsStepRevert() public {
        TapeOutPolicyAdapter adapter = _deploy();
        processor.setStepReverts(true);

        _assertEvaluation(adapter.evaluate(0), Decision.Invalid, 0xFF, PolicyError.StepReverted);
    }

    function test_evaluateRejectsRuntimeNetlistMutation() public {
        TapeOutPolicyAdapter adapter = _deploy();
        processor.setNetlist(hex"01");

        _assertEvaluation(adapter.evaluate(0), Decision.Invalid, 0xFF, PolicyError.NetlistMismatch);
    }

    function test_healthReportsCurrentProvenance() public {
        TapeOutPolicyAdapter adapter = _deploy();

        (
            bool healthy,
            bytes32 currentHash,
            uint32 nIn,
            uint32 nOut,
            uint32 nState,
            uint32 gateCount
        ) = adapter.health();

        assertTrue(healthy);
        assertEq(currentHash, adapter.EXPECTED_NETLIST_HASH());
        assertEq(nIn, 6);
        assertEq(nOut, 2);
        assertEq(nState, 0);
        assertEq(gateCount, 13);
    }

    function _deploy() private returns (TapeOutPolicyAdapter) {
        return new TapeOutPolicyAdapter(address(factory), address(processor), CIRCUIT_ID);
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
