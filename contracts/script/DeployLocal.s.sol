// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Script, console2} from "forge-std/Script.sol";
import {Safe} from "@safe/Safe.sol";
import {SafeProxy} from "@safe/proxies/SafeProxy.sol";
import {Enum} from "@safe/common/Enum.sol";
import {PolicyModule} from "../src/PolicyModule.sol";
import {IPolicyModule} from "../src/interfaces/IPolicyModule.sol";
import {MockERC20} from "@testkit/MockERC20.sol";
import {MockRouter} from "@testkit/MockRouter.sol";
import {MockPriceOracle} from "@testkit/MockPriceOracle.sol";
import {MockVault4626} from "@testkit/MockVault4626.sol";

/// @dev Local only: deploy and seed the entire contract integration, without storing any private key.
contract DeployLocal is Script {
    Safe private safe;
    uint256 private ownerKey;

    function run() external {
        require(block.chainid == _expectedChainId(), "DeployDemo: wrong chain");
        ownerKey = vm.envUint(_keyVariable());
        address owner = vm.addr(ownerKey);
        address session = vm.envAddress("SESSION_ADDRESS");
        require(session != owner, "DeployLocal: use a separate session key");

        vm.startBroadcast(ownerKey);
        Safe singleton = new Safe();
        safe = Safe(payable(address(new SafeProxy(address(singleton)))));
        address[] memory owners = new address[](1);
        owners[0] = owner;
        safe.setup(owners, 1, address(0), "", address(0), address(0), 0, payable(address(0)));
        MockERC20 usdc = new MockERC20("Mock USDC", "USDC", 6);
        MockERC20 token = new MockERC20("Mock staked AVAX", "sAVAX-MOCK", 18);
        MockPriceOracle oracle = new MockPriceOracle();
        MockRouter router = new MockRouter(address(oracle));
        MockVault4626 vault = new MockVault4626(usdc, "Mock lending vault", "vUSDC", 500);
        PolicyModule module = new PolicyModule(address(safe), address(oracle), IPolicyModule.Policy(100e8, 3600, 100));

        _safeCall(address(safe), abi.encodeCall(safe.enableModule, (address(module))));
        _safeCall(address(module), abi.encodeCall(module.setTokenAllowed, (address(usdc), true)));
        _safeCall(address(module), abi.encodeCall(module.setTokenAllowed, (address(token), true)));
        _safeCall(address(module), abi.encodeCall(module.setRouterAllowed, (address(router), true)));
        _safeCall(address(module), abi.encodeCall(module.setVaultAllowed, (address(vault), true)));
        _safeCall(address(module), abi.encodeCall(module.grantSession, (session, uint64(block.timestamp + 7 days))));
        oracle.setPrice(address(usdc), 1e8);
        oracle.setPrice(address(token), 10e8);
        usdc.mint(address(safe), 600e6);
        token.mint(address(safe), 40e18);
        vm.stopBroadcast();

        console2.log("Safe", address(safe));
        console2.log("PolicyModule", address(module));
        console2.log("MockUSDC", address(usdc));
        console2.log("MockTokenA", address(token));
        console2.log("MockPriceOracle", address(oracle));
        console2.log("MockRouter", address(router));
        console2.log("MockVault4626", address(vault));
        console2.log("Session", session);
    }

    function _expectedChainId() internal pure virtual returns (uint256) {
        return 31337;
    }

    function _keyVariable() internal pure virtual returns (string memory) {
        return "DEPLOYER_PRIVATE_KEY";
    }

    function _safeCall(address target, bytes memory data) private {
        bytes memory signatures = _sign(target, data);
        require(
            safe.execTransaction(
                target, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), signatures
            ),
            "Safe owner call failed"
        );
    }

    function _sign(address target, bytes memory data) private view returns (bytes memory) {
        bytes32 hash = safe.getTransactionHash(
            target, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), address(0), safe.nonce()
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, hash);
        return abi.encodePacked(r, s, v);
    }
}
