// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {Safe} from "@safe/Safe.sol";
import {SafeProxy} from "@safe/proxies/SafeProxy.sol";
import {Enum} from "@safe/common/Enum.sol";
import {PolicyModule} from "../../src/PolicyModule.sol";
import {IPolicyModule} from "../../src/interfaces/IPolicyModule.sol";
import {MockERC20} from "@testkit/MockERC20.sol";
import {MockRouter} from "@testkit/MockRouter.sol";
import {MockPriceOracle} from "@testkit/MockPriceOracle.sol";
import {MockVault4626} from "@testkit/MockVault4626.sol";

abstract contract PolicyFixture is Test {
    uint256 internal constant OWNER_KEY = 0xA11CE;
    uint256 internal constant USD = 1e8;
    address internal owner;
    address internal agent = address(0xB0B);
    address internal stranger = address(0xBAD);
    Safe internal safe;
    PolicyModule internal module;
    MockERC20 internal usdc;
    MockERC20 internal token;
    MockPriceOracle internal oracle;
    MockRouter internal router;
    MockVault4626 internal vault;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        owner = vm.addr(OWNER_KEY);
        Safe singleton = new Safe();
        safe = Safe(payable(address(new SafeProxy(address(singleton)))));
        address[] memory owners = new address[](1);
        owners[0] = owner;
        safe.setup(owners, 1, address(0), "", address(0), address(0), 0, payable(address(0)));

        usdc = new MockERC20("Mock USDC", "USDC", 6);
        token = new MockERC20("Mock token A", "A", 18);
        oracle = new MockPriceOracle();
        router = new MockRouter(address(oracle));
        vault = new MockVault4626(usdc, "Mock lending vault", "vUSDC", 500);
        module = new PolicyModule(address(safe), address(oracle), IPolicyModule.Policy(100 * uint192(USD), 3600, 100));
        _ownerExec(address(safe), abi.encodeCall(safe.enableModule, (address(module))));
        _govern(abi.encodeCall(module.setTokenAllowed, (address(usdc), true)));
        _govern(abi.encodeCall(module.setTokenAllowed, (address(token), true)));
        _govern(abi.encodeCall(module.setRouterAllowed, (address(router), true)));
        _govern(abi.encodeCall(module.setVaultAllowed, (address(vault), true)));
        _govern(abi.encodeCall(module.grantSession, (agent, uint64(block.timestamp + 30 days))));
        _refreshPrices();
        usdc.mint(address(safe), 1_000e6);
        token.mint(address(safe), 100e18);
    }

    function _ownerExec(address target, bytes memory data) internal {
        bytes memory signatures = _sign(target, data);
        bool success = safe.execTransaction(
            target, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), signatures
        );
        assertTrue(success, "signed owner transaction failed");
    }

    function _sign(address target, bytes memory data) private view returns (bytes memory) {
        bytes32 hash = safe.getTransactionHash(
            target, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), address(0), safe.nonce()
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, hash);
        return abi.encodePacked(r, s, v);
    }

    function _govern(bytes memory data) internal {
        _ownerExec(address(module), data);
    }

    function _refreshPrices() internal {
        oracle.setPrice(address(usdc), USD);
        oracle.setPrice(address(token), 10 * USD);
    }

    function _request(uint256 amount) internal view returns (IPolicyModule.SwapRequest memory) {
        return IPolicyModule.SwapRequest(
            address(router),
            address(usdc),
            address(token),
            amount,
            amount * 1e11 * 99 / 100,
            address(safe),
            block.timestamp + 60
        );
    }

    function _swap(uint256 amount) internal returns (uint256) {
        IPolicyModule.SwapRequest memory request = _request(amount);
        vm.prank(agent);
        return module.executeSwap(request);
    }

    function _deposit(uint256 assets) internal returns (uint256) {
        IPolicyModule.DepositRequest memory request =
            IPolicyModule.DepositRequest(address(vault), assets, assets, address(safe), block.timestamp + 60);
        vm.prank(agent);
        return module.executeVaultDeposit(request);
    }
}
