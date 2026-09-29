// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface ITapeOutFactory {
    function isCPU(address processor) external view returns (bool);
}
