// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ITapeOutFactory } from "../../src/interfaces/ITapeOutFactory.sol";
import { ITapeOutProcessor } from "../../src/interfaces/ITapeOutProcessor.sol";

contract MockTapeOutFactory is ITapeOutFactory {
    mapping(address processor => bool registered) private _processors;

    function setCPU(address processor, bool registered) external {
        _processors[processor] = registered;
    }

    function isCPU(address processor) external view returns (bool) {
        return _processors[processor];
    }
}

contract MockTapeOutProcessor is ITapeOutProcessor {
    bool private _circuitExists = true;
    bool private _stepReverts;
    uint32 private _nIn = 6;
    uint32 private _nOut = 2;
    uint32 private _nState;
    uint32 private _gateCount = 13;
    bytes private _netlist;
    bytes private _newState;
    bytes private _outputs = hex"00";

    constructor(bytes memory initialNetlist) {
        _netlist = initialNetlist;
    }

    function setCircuitExists(bool exists) external {
        _circuitExists = exists;
    }

    function setMetadata(uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount) external {
        _nIn = nIn;
        _nOut = nOut;
        _nState = nState;
        _gateCount = gateCount;
    }

    function setNetlist(bytes calldata newNetlist) external {
        _netlist = newNetlist;
    }

    function setStepResult(bytes calldata newState, bytes calldata outputs) external {
        _newState = newState;
        _outputs = outputs;
    }

    function setStepReverts(bool value) external {
        _stepReverts = value;
    }

    function ownerOf(uint256) external view returns (address) {
        require(_circuitExists, "missing circuit");
        return address(this);
    }

    function circuitInfo(uint256)
        external
        view
        returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)
    {
        require(_circuitExists, "missing circuit");
        return (_nIn, _nOut, _nState, _gateCount);
    }

    function netlist(uint256) external view returns (bytes memory) {
        require(_circuitExists, "missing circuit");
        return _netlist;
    }

    function step(uint256, bytes calldata, bytes calldata)
        external
        view
        returns (bytes memory newState, bytes memory outputs)
    {
        require(!_stepReverts, "step reverted");
        return (_newState, _outputs);
    }
}
