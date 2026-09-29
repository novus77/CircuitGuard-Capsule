// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { ITapeOutProcessor } from "../src/interfaces/ITapeOutProcessor.sol";

interface ITapeOutMaterial {
    function circuits() external view returns (address);
    function mintPrice() external view returns (uint256);
    function protocolFee() external view returns (uint256);
    function mint(uint256 materialId, uint256 amount) external payable;
}

contract TapeoutPolicy is Script {
    uint256 internal constant NAND_MATERIAL_ID = 0;
    uint256 internal constant NAND_COUNT = 13;
    bytes internal constant CANONICAL_NETLIST =
        hex"0000000400000400000002000008000000090000090000000a0000060000000b00000b00000003000005000000070000070000000e00000d0000000f00000f0000000c00000f0000000c0000100000001100001100000012000012";

    function quote(address processorAddress)
        public
        view
        returns (address materialAddress, uint256 mintValue, uint256 tapeoutFee)
    {
        ITapeOutProcessor processor = ITapeOutProcessor(processorAddress);
        ITapeOutMaterial material = ITapeOutMaterial(processor.transistors());
        require(material.circuits() == address(processor), "material provenance mismatch");

        uint256 materialPrice = material.mintPrice();
        uint256 protocolFee = material.protocolFee();
        tapeoutFee = processor.TAPEOUT_FEE();
        mintValue = materialPrice * NAND_COUNT + protocolFee;
        materialAddress = address(material);

        console2.log("Processor", address(processor));
        console2.log("Material", materialAddress);
        console2.log("NAND material price (wei)", materialPrice);
        console2.log("Material protocol fee (wei)", protocolFee);
        console2.log("Mint total (wei)", mintValue);
        console2.log("Tapeout fee (wei)", tapeoutFee);
    }

    function run() external returns (uint256 circuitId) {
        ITapeOutProcessor processor = ITapeOutProcessor(vm.envAddress("PROCESSOR"));
        (address materialAddress, uint256 mintValue, uint256 tapeoutFee) = quote(address(processor));
        require(mintValue <= vm.envUint("MAX_MINT_VALUE_WEI"), "mint cost exceeds cap");
        require(tapeoutFee <= vm.envUint("MAX_TAPEOUT_FEE_WEI"), "tapeout fee exceeds cap");
        ITapeOutMaterial material = ITapeOutMaterial(materialAddress);

        vm.startBroadcast();
        material.mint{ value: mintValue }(NAND_MATERIAL_ID, NAND_COUNT);
        circuitId = processor.tapeout{ value: tapeoutFee }(CANONICAL_NETLIST, 6, 2);
        vm.stopBroadcast();

        console2.log("Circuit ID", circuitId);
    }
}
