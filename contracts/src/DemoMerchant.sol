// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DemoMerchant {
    error ZeroAddress();

    event NativeOrderPaid(address indexed payer, uint256 amount, uint256 indexed orderId);

    IERC20 public immutable usdt0;
    uint256 public nextOrderId = 1;

    constructor(address usdt0Address) {
        if (usdt0Address == address(0)) revert ZeroAddress();
        usdt0 = IERC20(usdt0Address);
    }

    receive() external payable {
        uint256 orderId = nextOrderId++;
        emit NativeOrderPaid(msg.sender, msg.value, orderId);
    }

    function okbBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function usdt0Balance() external view returns (uint256) {
        return usdt0.balanceOf(address(this));
    }
}
