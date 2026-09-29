// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { CircuitGuardTreasury } from "../src/CircuitGuardTreasury.sol";
import { DemoMerchant } from "../src/DemoMerchant.sol";
import { TapeOutPolicyAdapter } from "../src/TapeOutPolicyAdapter.sol";

contract DeployCircuitGuard is Script {
    address internal constant FACTORY = 0x1f09DAeFA827f02CBb40967cc91b259763760761;
    address internal constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;

    function run()
        external
        returns (TapeOutPolicyAdapter adapter, CircuitGuardTreasury treasury, DemoMerchant merchant)
    {
        address processor = vm.envAddress("PROCESSOR");
        uint256 circuitId = vm.envUint("CIRCUIT_ID");
        address initialOwner = vm.envAddress("OWNER");
        address recoveryAddress = vm.envAddress("RECOVERY_ADDRESS");
        address initialAgent = vm.envAddress("AGENT");

        vm.startBroadcast();
        adapter = new TapeOutPolicyAdapter(FACTORY, processor, circuitId);
        treasury = new CircuitGuardTreasury(
            initialOwner,
            recoveryAddress,
            USDT0,
            address(adapter),
            initialAgent,
            0.02 ether,
            0.1 ether,
            10e6,
            100e6
        );
        merchant = new DemoMerchant(USDT0);
        treasury.setRecipientStatus(address(merchant), CircuitGuardTreasury.RecipientStatus.Trusted);
        vm.stopBroadcast();

        console2.log("Policy Adapter", address(adapter));
        console2.log("Treasury", address(treasury));
        console2.log("Demo Merchant", address(merchant));
    }
}
