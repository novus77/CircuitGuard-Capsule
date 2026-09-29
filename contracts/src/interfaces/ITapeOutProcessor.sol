// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface ITapeOutProcessor {
    function transistors() external view returns (address);

    function TAPEOUT_FEE() external view returns (uint256);

    function ownerOf(uint256 id) external view returns (address);

    function circuitInfo(uint256 id)
        external
        view
        returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);

    function netlist(uint256 id) external view returns (bytes memory);

    function step(uint256 id, bytes calldata state, bytes calldata inputs)
        external
        view
        returns (bytes memory newState, bytes memory outputs);

    function tapeout(bytes calldata netlist_, uint32 nIn, uint32 nOut)
        external
        payable
        returns (uint256 circuitId);
}
