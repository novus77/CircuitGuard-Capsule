// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { ITapeOutFactory } from "../src/interfaces/ITapeOutFactory.sol";

contract XLayerForkTest is Test {
    address private constant FACTORY = 0x1f09DAeFA827f02CBb40967cc91b259763760761;
    address private constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;

    function test_xLayerInfrastructureMatchesExpectedContracts() public view {
        if (block.chainid != 196) return;

        assertEq(block.chainid, 196);
        assertGt(FACTORY.code.length, 0);
        assertGt(USDT0.code.length, 0);
        assertGt(ITapeOutFactory(FACTORY).deployFee(), 0);
        assertGt(ITapeOutFactory(FACTORY).cpuCount(), 0);
        assertEq(IERC20Metadata(USDT0).decimals(), 6);
        assertEq(IERC20Metadata(USDT0).symbol(), unicode"USD₮0");
    }
}
