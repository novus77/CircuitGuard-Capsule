// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { CircuitGuardTreasury } from "../../src/CircuitGuardTreasury.sol";

contract MaliciousRecipient {
    CircuitGuardTreasury private immutable _treasury;

    bool public rejectNative;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(address treasuryAddress) {
        _treasury = CircuitGuardTreasury(payable(treasuryAddress));
    }

    function setRejectNative(bool value) external {
        rejectNative = value;
    }

    receive() external payable {
        if (rejectNative) revert("native rejected");

        reentryAttempted = true;
        (reentrySucceeded,) = address(_treasury)
            .call(
                abi.encodeCall(
                    CircuitGuardTreasury.requestTransfer,
                    (CircuitGuardTreasury.Asset.OKB, address(this), uint128(1), bytes32(0))
                )
            );
    }
}
