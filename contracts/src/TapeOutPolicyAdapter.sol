// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    Decision,
    IPolicyAdapter,
    PolicyError,
    PolicyEvaluation
} from "./interfaces/IPolicyAdapter.sol";
import { ITapeOutFactory } from "./interfaces/ITapeOutFactory.sol";
import { ITapeOutProcessor } from "./interfaces/ITapeOutProcessor.sol";
import { PolicyCodec } from "./libraries/PolicyCodec.sol";

contract TapeOutPolicyAdapter is IPolicyAdapter {
    error ProcessorNotRegistered();
    error CircuitUnavailable();
    error CircuitMetadataMismatch();
    error NetlistHashMismatch();

    bytes32 public constant EXPECTED_NETLIST_HASH =
        0xd722aa6af62aa44c485ec471d4234803c859aec19684caa2a510bdca1675c269;
    uint32 public constant EXPECTED_INPUTS = 6;
    uint32 public constant EXPECTED_OUTPUTS = 2;
    uint32 public constant EXPECTED_STATE = 0;
    uint32 public constant EXPECTED_GATES = 13;
    uint8 internal constant UNAVAILABLE_OUTPUT = type(uint8).max;

    ITapeOutFactory public immutable factory;
    ITapeOutProcessor public immutable processor;
    uint256 public immutable circuitId;

    constructor(address factoryAddress, address processorAddress, uint256 expectedCircuitId) {
        factory = ITapeOutFactory(factoryAddress);
        processor = ITapeOutProcessor(processorAddress);
        circuitId = expectedCircuitId;

        if (!factory.isCPU(processorAddress)) revert ProcessorNotRegistered();

        try processor.ownerOf(expectedCircuitId) returns (address owner) {
            if (owner == address(0)) revert CircuitUnavailable();
        } catch {
            revert CircuitUnavailable();
        }

        try processor.circuitInfo(expectedCircuitId) returns (
            uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount
        ) {
            if (!_metadataMatches(nIn, nOut, nState, gateCount)) {
                revert CircuitMetadataMismatch();
            }
        } catch {
            revert CircuitMetadataMismatch();
        }

        try processor.netlist(expectedCircuitId) returns (bytes memory currentNetlist) {
            if (keccak256(currentNetlist) != EXPECTED_NETLIST_HASH) {
                revert NetlistHashMismatch();
            }
        } catch {
            revert NetlistHashMismatch();
        }
    }

    function evaluate(uint8 inputs) external view returns (PolicyEvaluation memory) {
        try processor.netlist(circuitId) returns (bytes memory currentNetlist) {
            if (keccak256(currentNetlist) != EXPECTED_NETLIST_HASH) {
                return _invalid(PolicyError.NetlistMismatch);
            }
        } catch {
            return _invalid(PolicyError.NetlistMismatch);
        }

        try processor.step(circuitId, hex"", abi.encodePacked(inputs)) returns (
            bytes memory newState, bytes memory outputs
        ) {
            if (newState.length != 0) return _invalid(PolicyError.StateMismatch);
            if (outputs.length != 1) return _invalid(PolicyError.OutputMalformed);
            return PolicyCodec.decode(uint8(outputs[0]));
        } catch {
            return _invalid(PolicyError.StepReverted);
        }
    }

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
        )
    {
        bool registered;
        bool circuitExists;

        try factory.isCPU(address(processor)) returns (bool isRegistered) {
            registered = isRegistered;
        } catch { }

        try processor.ownerOf(circuitId) returns (address owner) {
            circuitExists = owner != address(0);
        } catch { }

        try processor.circuitInfo(circuitId) returns (
            uint32 currentInputs,
            uint32 currentOutputs,
            uint32 currentState,
            uint32 currentGateCount
        ) {
            nIn = currentInputs;
            nOut = currentOutputs;
            nState = currentState;
            gateCount = currentGateCount;
        } catch { }

        try processor.netlist(circuitId) returns (bytes memory currentNetlist) {
            currentNetlistHash = keccak256(currentNetlist);
        } catch { }

        healthy = registered && circuitExists && _metadataMatches(nIn, nOut, nState, gateCount)
            && currentNetlistHash == EXPECTED_NETLIST_HASH;
    }

    function _metadataMatches(uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)
        private
        pure
        returns (bool)
    {
        return nIn == EXPECTED_INPUTS && nOut == EXPECTED_OUTPUTS && nState == EXPECTED_STATE
            && gateCount == EXPECTED_GATES;
    }

    function _invalid(PolicyError error) private pure returns (PolicyEvaluation memory) {
        return PolicyEvaluation(Decision.Invalid, UNAVAILABLE_OUTPUT, error);
    }
}
