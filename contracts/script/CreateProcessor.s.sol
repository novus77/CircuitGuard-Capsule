// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { ITapeOutFactory } from "../src/interfaces/ITapeOutFactory.sol";

contract CreateProcessor is Script {
    address internal constant FACTORY_ADDRESS = 0x1f09DAeFA827f02CBb40967cc91b259763760761;
    uint256 internal constant SUPPLY = 1_000_000;
    uint256 internal constant MINT_PRICE = 66_000_000_000_000;

    function quote() public view returns (uint256 deployFee) {
        deployFee = ITapeOutFactory(FACTORY_ADDRESS).deployFee();
        console2.log("Factory", FACTORY_ADDRESS);
        console2.log("Processor deployment fee (wei)", deployFee);
        console2.log("Material supply", SUPPLY);
        console2.log("Material mint price (wei)", MINT_PRICE);
    }

    function run() external returns (address transistors, address processor) {
        ITapeOutFactory factory = ITapeOutFactory(FACTORY_ADDRESS);
        uint256 deployFee = quote();
        require(deployFee <= vm.envUint("MAX_DEPLOY_FEE_WEI"), "deployment fee exceeds cap");

        vm.startBroadcast();
        (transistors, processor) = factory.createCPU{ value: deployFee }(
            "CircuitGuard Policy Foundry",
            "CGPOL",
            "NAND policy material for CircuitGuard Capsule on X Layer",
            SUPPLY,
            MINT_PRICE
        );
        vm.stopBroadcast();

        require(factory.isCPU(processor), "processor registration failed");
        console2.log("Material", transistors);
        console2.log("Processor", processor);
    }
}
