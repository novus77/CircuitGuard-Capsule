// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface ITapeOutFactory {
    function isCPU(address processor) external view returns (bool);

    function deployFee() external view returns (uint256);

    function cpuCount() external view returns (uint256);

    function cpuAt(uint256 index) external view returns (address);

    function createCPU(
        string calldata name,
        string calldata symbol,
        string calldata story,
        uint256 transistorSupply,
        uint256 mintPrice
    ) external payable returns (address transistors, address circuits);
}
